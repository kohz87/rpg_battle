// index.js against a fake SillyTavern and Story Block: mastery progress lives in the Party block
// (an older chat's metadata progress moved into it once), and a companion follows their NPC's
// rename in NPC State Delta on its own, into the latest reply, once per change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './ui-fake-dom.js';
import { storySuite } from '../src/suite.js';

const doc = installFakeDom();
const host = doc.createElement('div');
host.id = 'extensions_settings';
doc.body.appendChild(host);

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blockPattern = tag => new RegExp(`<${escapeRegExp(tag)}>\\n?([\\s\\S]*?)\\n?</${escapeRegExp(tag)}>`);

// Story Block, as far as RPG Battle uses it: a kept block is the latest copy in a message's text.
const hooks = { tabs: {}, reply: null, update: null };
globalThis.StoryBlock = {
    apiVersion: 1,
    version: '0.9.1',
    registerBlock: () => ({ ok: true }),
    registerTab: tab => { hooks.tabs[tab.id] = tab; },
    onReply: callback => { hooks.reply = callback; },
    onUpdate: callback => { hooks.update = callback; },
    refresh: () => {},
    blockInText: (text, tag) => {
        const match = String(text ?? '').match(blockPattern(tag));
        return match ? { text: match[1] } : null;
    },
    getBlock: (tag, { beforeIndex = null } = {}) => {
        const chat = ctx.chat;
        for (let index = Math.min(chat.length, beforeIndex ?? chat.length) - 1; index >= 0; index--) {
            const found = globalThis.StoryBlock.blockInText(chat[index].mes, tag);
            if (found) return { text: found.text, messageIndex: index };
        }
        return null;
    },
    setBlockText: async (index, tag, text) => {
        const message = ctx.chat[index];
        const block = `<${tag}>\n${text}\n</${tag}>`;
        message.mes = blockPattern(tag).test(message.mes) ? message.mes.replace(blockPattern(tag), () => block) : `${message.mes}\n${block}`;
    },
};

const toasts = [];
globalThis.toastr = Object.fromEntries(['info', 'success', 'warning', 'error'].map(level => [level, message => { toasts.push(String(message)); return null; }]));

const ctx = {
    chat: [],
    chatMetadata: {},
    chatId: 'chat-0',
    extensionSettings: {},
    name1: 'Ren',
    getCurrentChatId: () => ctx.chatId,
    saveMetadataDebounced: () => {},
    saveMetadata: async () => {},
    saveSettingsDebounced: () => {},
    setExtensionPrompt: () => {},
    eventSource: { on: () => {} },
    event_types: {},
};
globalThis.SillyTavern = { getContext: () => ctx };

let npcs = [];
storySuite().announce({ id: 'npc-state-delta', name: 'NPC State Delta', version: '1.2.2', owns: [], enabled: true, api: { npcProfiles: () => npcs } });

await import('../index.js');

const settle = async () => {
    for (let round = 0; round < 6; round++) await new Promise(resolve => setTimeout(resolve, 2));
};
const reply = text => ({ mes: text, is_user: false, is_system: false });
const partyText = (index = ctx.chat.length) => globalThis.StoryBlock.getBlock('Party', { beforeIndex: index })?.text ?? '';

const REN = [
    '## Ren (you)',
    'Level: 4 | XP: 310/800 | Points: 2',
    'HP: 58/62 | MP: 21/30',
    'STR: 9 | VIT: 7 | AGI: 8 | DEX: 8 | INT: 4 | LUK: 5 | CHA: 6',
    'Checks: STR +2 | VIT +1 | AGI +1 | DEX +1 | INT -1 | LUK +0 | CHA +0',
    'State: unhurt',
    'Skills: Rending Strike (Lv 2) | Guard Break',
    'Conditions: none',
].join('\n');
const LYRA = [
    '## Lyra — healer | control: auto',
    'Level: 4 | XP: 120/800 | Points: 0',
    'HP: 44/44 | MP: 38/38',
    'State: unhurt',
    'STR: 4 | VIT: 5 | AGI: 7 | DEX: 6 | INT: 10 | LUK: 4 | CHA: 7',
    'Skills: Mend | Ward (Lv 2)',
].join('\n');

function openChat(id, chat, meta = {}) {
    ctx.chatId = id;
    ctx.chat = chat;
    ctx.chatMetadata = { rpgBattle: meta };
    toasts.length = 0;
}

test('an older chat\'s metadata progress moves into the Party block once; the block is what counts after', async () => {
    openChat('old-chat', [reply(`Once upon a time.\n<Party>\n${REN}\n\n${LYRA}\n</Party>`), reply('They walk on.')], {
        uses: { pc: { 'Rending Strike': 6, 'Guard Break': 2 }, lyra: { Ward: 4 } },
        npcLinks: {},
    });
    hooks.update();
    await settle();
    const written = partyText();
    assert.match(written, /^Skills: Rending Strike \(Lv 2, 6\/12\) \| Guard Break \(Lv 1, 2\/5\)$/m);
    assert.match(written, /^Skills: Mend \(Lv 1, 0\/5\) \| Ward \(Lv 2, 4\/12\)$/m);
    assert.match(ctx.chat[1].mes, /<Party>/, 'written into the latest reply');
    assert.equal('uses' in ctx.chatMetadata.rpgBattle, false, 'the metadata record is gone');
    // Deleting that reply rolls the block back: the older copy, as it was written then.
    ctx.chat.pop();
    hooks.update();
    await settle();
    assert.doesNotMatch(partyText(), /\(Lv[^)]*\//, 'nothing written back from metadata');
    assert.equal('uses' in ctx.chatMetadata.rpgBattle, false);
});

test('a block already carrying progress is not rewritten from older metadata', async () => {
    const block = `${REN.replace('Skills: Rending Strike (Lv 2) | Guard Break', 'Skills: Rending Strike (Lv 2, 1/12) | Guard Break (Lv 1, 0/5)')}`;
    openChat('new-chat', [reply(`<Party>\n${block}\n</Party>`), reply('On.')], { uses: { pc: { 'Rending Strike': 9 } } });
    hooks.update();
    await settle();
    assert.equal(ctx.chat[1].mes, 'On.', 'nothing to move');
    assert.match(partyText(), /Rending Strike \(Lv 2, 1\/12\)/);
});

test('a companion follows their NPC\'s rename in NPC State Delta, into the latest reply, once', async () => {
    openChat('npc-chat', [reply(`<Party>\n${REN}\n\n${LYRA}\n</Party>`)], { npcLinks: { lyra: 'n1' } });
    npcs = [{ id: 'n1', name: 'Lyra', aliases: [] }];
    hooks.update();
    await settle();
    assert.match(partyText(), /^## Lyra — healer/m, 'same name: nothing to follow');
    // A reply in which NPC State Delta learns her full name.
    ctx.chat.push(reply('"Vance," she says. "Lyra Vance."'));
    npcs = [{ id: 'n1', name: 'Lyra Vance', aliases: ['Lyra'] }];
    await hooks.reply({ messageIndex: 1 });
    await settle();
    assert.match(ctx.chat[1].mes, /^## Lyra Vance — healer \| control: auto$/m, 'renamed in the latest reply');
    assert.ok(toasts.includes('Lyra is now Lyra Vance (from NPC State Delta).'), toasts.join(' / '));
    assert.deepEqual(ctx.chatMetadata.rpgBattle.npcLinks, { lyra: 'n1', 'lyra-vance': 'n1' }, 'the link follows the new id (and stays for the old one)');
    assert.equal(hooks.tabs['rpg-party'].badge(), 0, 'no rename offer');
    // Once per change: the Party tab drawing again, another reply, the suite announcing.
    const count = toasts.length;
    hooks.update();
    ctx.chat.push(reply('They rest.'));
    await hooks.reply({ messageIndex: 2 });
    await settle();
    assert.equal(toasts.filter(text => /is now/.test(text)).length, 1);
    assert.equal(toasts.length, count);
    // The reply with the rename deleted: the block is back to Lyra, and she stays Lyra.
    ctx.chat.splice(1);
    hooks.update();
    await settle();
    assert.match(partyText(), /^## Lyra — healer/m);
    assert.equal(toasts.filter(text => /is now/.test(text)).length, 1, 'a rename followed is not followed again');
    // Still linked, so a later change is followed again.
    npcs = [{ id: 'n1', name: 'Lyra Moon', aliases: [] }];
    hooks.update();
    await settle();
    assert.match(partyText(), /^## Lyra Moon — healer/m);
    assert.ok(toasts.includes('Lyra is now Lyra Moon (from NPC State Delta).'));
});
