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
    onReply: (callback, { priority = 0 } = {}) => { if (priority <= 0) hooks.reply = callback; },
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
    'Level: 4 | XP: 31/100 | Points: 2',
    'HP: 58/62 | MP: 21/30',
    'STR: 9 | VIT: 7 | AGI: 8 | DEX: 8 | INT: 4 | LUK: 5 | CHA: 6',
    'Checks: STR +2 | VIT +1 | AGI +1 | DEX +1 | INT -1 | LUK +0 | CHA +0',
    'State: unhurt',
    'Skills: Rending Strike (Lv 2) | Guard Break',
    'Conditions: none',
].join('\n');
const LYRA = [
    '## Lyra — healer | control: auto',
    'Level: 4 | XP: 12/100 | Points: 0',
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

// ---------------------------------------------------------------------------
// 0.4.2: the engagement and its stakes are the story's; the hand-off clears once narrated

const drawTab = id => {
    const pane = doc.createElement('div');
    hooks.tabs[id].render(pane);
    return pane;
};
const find = (pane, selector) => pane.querySelector(selector);
// (0.5.38) Trade is the Party tab's second page; the first is the party.
const drawParty = () => {
    const pane = drawTab('rpg-party');
    const party = pane.querySelectorAll('.rpg-battle-page')[0];
    if (party && !party.className.includes('is-current')) party.click();
    return pane;
};
const drawTrade = () => {
    const pane = drawTab('rpg-party');
    pane.querySelectorAll('.rpg-battle-page')[1]?.click();
    return pane;
};
const pickTrader = (pane, value) => {
    const picker = pane.querySelector('.rpg-trade-person');
    picker.value = value;
    picker.dispatch('change');
};
const findAll = (pane, selector) => pane.querySelectorAll(selector);
const userMessage = text => ({ mes: text, is_user: true, is_system: false });

test('Fight? opens the story\'s engagement read-only; Start fights it as written, to the death when it says so', async () => {
    openChat('fight-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('We ride on.'), reply('Bandits block the road.\n<Encounter>2 bandit; then: bandit captain (boss) | to the death</Encounter>')]);
    hooks.update();
    await settle();
    let pane = drawTab('rpg-battle');
    assert.match(find(pane, '.rpg-battle-encounter-stakes').textContent, /To the death/);
    find(pane, '.rpg-battle-encounter-fight').click();
    pane = drawTab('rpg-battle');
    assert.equal(find(pane, 'input'), null, 'nothing to edit');
    assert.equal(find(pane, 'select'), null);
    assert.deepEqual(findAll(pane, '.rpg-battle-enemy-name').map(node => node.textContent), ['Bandit', 'Bandit Captain']);
    assert.deepEqual(findAll(pane, '.rpg-battle-enemy-power').map(node => node.textContent), ['Lv 3', 'Lv 6'], 'the bestiary\'s own ranks, as their levels');
    // What one is worth to Ren (level 4, needs 100), as the result counts it: a tenth, 10, × the
    // level-gap band: a bandit (level 3: even) and the captain (level 6: even, boss ×3).
    assert.deepEqual(findAll(pane, '.rpg-battle-enemy-xp').map(node => node.textContent), ['~10 XP each', '~30 XP']);
    assert.deepEqual(findAll(pane, '.rpg-battle-threat').map(node => node.textContent), ['even', 'even'], 'a foe with its own level shows the band its gap is (0.5.3)');
    assert.deepEqual(findAll(pane, '.rpg-battle-enemy-role').map(node => node.textContent), ['skirmisher', 'brute']);
    assert.equal(find(pane, '.rpg-battle-stakes').textContent, 'Stakes: To the death — defeat is death.');
    // A page changed by hand changes nothing: the glue builds the fight from its own offer.
    for (const node of findAll(pane, '.rpg-battle-enemy-name')) node.textContent = 'Slime';
    find(pane, '.rpg-battle-stakes').textContent = 'Stakes: Normal';
    find(pane, '.rpg-battle-begin').click();
    await settle();
    const fight = ctx.chatMetadata.rpgBattle.fight;
    assert.ok(fight, 'the fight started');
    assert.equal(fight.setup.stakes, 'death');
    assert.deepEqual(fight.setup.enemies.map(enemy => enemy.name), ['Bandit A', 'Bandit B']);
    assert.deepEqual(fight.setup.waves.map(wave => wave.enemies.map(enemy => [enemy.name, enemy.boss])), [[['Bandit Captain', true]]]);
    assert.ok(ctx.chatMetadata.rpgBattle.dismissed.some(key => key.endsWith('| to the death')), 'the offer is spent');
});

test('0.5.2: the XP rate setting reaches the setup\'s XP per foe; a weak foe below level 1 is scaled and its card says so', async () => {
    ctx.extensionSettings.rpgBattle = { ...(ctx.extensionSettings.rpgBattle ?? {}), xpRate: 2 };
    try {
        openChat('rate-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('Into the ditch.'), reply('Dogs snarl.\n<Encounter>2 wolf (weak); then: wolf (trivial)</Encounter>')]);
        hooks.update();
        await settle();
        let pane = drawTab('rpg-battle');
        find(pane, '.rpg-battle-encounter-fight').click();
        pane = drawTab('rpg-battle');
        // Ren is level 4 (needs 100): weak is level 0 before it is held at 1 (×½), trivial −4 (×¼); ×2.
        assert.deepEqual(findAll(pane, '.rpg-battle-enemy-power').map(node => node.textContent), ['Lv 1', 'Lv 1']);
        assert.deepEqual(findAll(pane, '.rpg-battle-threat').map(node => node.textContent), ['weak', 'trivial']);
        assert.deepEqual(findAll(pane, '.rpg-battle-enemy-xp').map(node => node.textContent), ['~10 XP each', '~5 XP']);
        find(pane, '.rpg-battle-begin').click();
        await settle();
        const fight = ctx.chatMetadata.rpgBattle.fight;
        assert.deepEqual(fight.setup.enemies.map(enemy => [enemy.level, enemy.scale, enemy.xpLevel, enemy.threat]), [[1, 0.88, 0, 'weak'], [1, 0.88, 0, 'weak']]);
        assert.deepEqual(fight.setup.waves[0].enemies.map(enemy => [enemy.level, enemy.scale, enemy.xpLevel]), [[1, 0.528, -4]]);
        pane = drawTab('rpg-battle');
        assert.equal(find(pane, '.rpg-battle-card.is-enemy .rpg-battle-badge').textContent, 'Lv 1 · weak · skirmisher');
    } finally {
        ctx.extensionSettings.rpgBattle = { ...ctx.extensionSettings.rpgBattle, xpRate: 1 };
    }
});

test('a Story Director fight carries its stakes marker too; without one the stakes are normal', async () => {
    openChat('director-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('To the weir.'), reply('Mist on the water.')]);
    globalThis.StoryDirector = { encountersAt: () => [{ key: 'Ambush at the weir', encounter: '2 wolves | to the death', status: 'due', place: 'the weir' }] };
    try {
        hooks.update();
        await settle();
        let pane = drawTab('rpg-battle');
        assert.match(find(pane, '.rpg-battle-encounter-label').textContent, /Ambush at the weir/);
        assert.match(find(pane, '.rpg-battle-encounter-stakes').textContent, /To the death/);
        find(pane, '.rpg-battle-encounter-fight').click();
        pane = drawTab('rpg-battle');
        assert.deepEqual(findAll(pane, '.rpg-battle-enemy-name').map(node => node.textContent), ['Wolf']);
        assert.equal(find(pane, '.rpg-battle-stakes').textContent, 'Stakes: To the death — defeat is death.');
        // Not now, from the setup: put away, back to nothing on offer.
        find(pane, '.rpg-battle-encounter-dismiss').click();
        assert.equal(hooks.tabs['rpg-battle'].badge(), 0);
        globalThis.StoryDirector = { encountersAt: () => [{ key: 'Wolves', encounter: '3 wolves', status: 'due' }] };
        pane = drawTab('rpg-battle');
        assert.equal(find(pane, '.rpg-battle-encounter-stakes'), null, 'normal stakes');
        find(pane, '.rpg-battle-encounter-fight').click();
        assert.match(drawTab('rpg-battle').querySelector('.rpg-battle-stakes').textContent, /^Stakes: Normal/);
    } finally {
        delete globalThis.StoryDirector;
    }
});

test('a Story Director fight is offered only when the story reached it in this reply (0.5.18)', async () => {
    openChat('director-reached', [reply(`<Party>\n${REN}\n</Party>`), userMessage('I stay at the guild.'), reply('The clerk files the ledgers.')]);
    // Due across the village, the scene elsewhere: nothing to fight.
    globalThis.StoryDirector = { encountersAt: () => [{ key: 'Guards sack the Stray Oar', encounter: '3 desperate drover, mercenary veteran (boss)', status: 'due', place: 'Bluewatch Village', on: 'Goldwane 13, 10:30 pm', reached: false }] };
    try {
        hooks.update();
        await settle();
        assert.equal(hooks.tabs['rpg-battle'].badge(), 0);
        assert.equal(drawTab('rpg-battle').querySelector('.rpg-battle-encounter-label'), null);
        // The reply fired it: the scene got there.
        globalThis.StoryDirector = { encountersAt: () => [{ key: 'Guards sack the Stray Oar', encounter: '3 desperate drover, mercenary veteran (boss)', status: 'due', place: 'Bluewatch Village', on: 'Goldwane 13, 10:30 pm', reached: true }] };
        const label = find(drawTab('rpg-battle'), '.rpg-battle-encounter-label').textContent;
        assert.equal(label, 'Planned by Story Director: Guards sack the Stray Oar at Bluewatch Village.');
    } finally {
        delete globalThis.StoryDirector;
    }
});

test('the hand-off: waiting until given to a reply, gone once that reply is in, waiting again if it is deleted, spent after a newer one', async () => {
    const handoff = '[Battle resolved by RPG Battle: narrate this outcome, do not change it]\nVictory in 3 rounds.';
    openChat('handoff-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('Onward.'), reply('The bandits fall back.')], {
        pending: { handoff, fightId: 'f1', attachedTo: null },
    });
    hooks.update();
    await settle();
    const notice = () => find(drawTab('rpg-party'), '.rpg-battle-notice.is-pending');
    assert.ok(notice(), 'waiting: Return to story');
    // The next reply is generated with the hand-off: being narrated.
    ctx.chat.push(userMessage('What now?'));
    await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
    assert.equal(ctx.chatMetadata.rpgBattle.pending.attachedTo, 4);
    assert.equal(notice(), null);
    assert.ok(find(drawTab('rpg-party'), '.rpg-battle-narrating'), 'being narrated');
    // The reply is in: narrated, nothing more to show, and a fight that reply starts is offered.
    ctx.chat.push(reply('They bind their wounds. Then wolves howl.\n<Encounter>2 wolves</Encounter>'));
    await hooks.reply({ messageIndex: 4 });
    await settle();
    assert.equal(notice(), null);
    assert.equal(find(drawTab('rpg-party'), '.rpg-battle-narrating'), null);
    assert.ok(ctx.chatMetadata.rpgBattle.pending, 'kept for swipes of that reply');
    assert.equal(hooks.tabs['rpg-battle'].badge(), 1, 'a narrated result does not hold back the next fight');
    // A swipe of the narrating reply narrates the same result.
    await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'swipe');
    assert.match(ctx.chatMetadata.rpgBattle.pending.handoff, /Victory/);
    await hooks.reply({ messageIndex: 4 });
    // The narrating reply deleted: the result waits again, for the next reply.
    ctx.chat.pop();
    hooks.update();
    await settle();
    assert.ok(notice(), 'waiting again');
    assert.equal(hooks.tabs['rpg-battle'].badge(), 0, 'no new fight while a result waits');
    await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
    assert.equal(ctx.chatMetadata.rpgBattle.pending.attachedTo, 4, 'given to the new reply');
    ctx.chat.push(reply('They bind their wounds.'));
    await hooks.reply({ messageIndex: 4 });
    // A newer reply: the hand-off is spent, at once.
    ctx.chat.push(userMessage('Sleep.'), reply('Morning comes.'));
    await hooks.reply({ messageIndex: 6 });
    await settle();
    assert.equal(ctx.chatMetadata.rpgBattle.pending, null);
    assert.equal(notice(), null);
});

test('a fight and its result go back with the reply the fight started from (0.4.3)', async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value) => { prompts[key] = value; };
    try {
        const handoff = '[Battle resolved by RPG Battle: narrate this outcome, do not change it]\nVictory. Loot: 7 copper.';
        const offer = { ...reply('A quill-dog bursts from the gorse.'), send_date: 'd2', swipe_id: 0 };
        const hello = () => reply(`Hello.\n<Party>\n${REN}\n</Party>`);
        // The result of a fight started from reply 2, narrated in reply 4.
        openChat('origin-chat', [hello(), userMessage('I hunt it.'), offer, userMessage('Onward.'), reply('The dog lies dead.')], {
            pending: { handoff, fightId: 'f1', attachedTo: 4, origin: { index: 2, date: 'd2', swipe: 0 } },
        });
        // A swipe of the narrating reply narrates the same fight.
        await globalThis.rpgBattleInterceptor(ctx.chat.slice(0, 4), 0, null, 'swipe');
        assert.match(prompts.story_suite_tail_3_rpg_battle, /7 copper/);
        // Back to before the fight: everything from the fight's reply on is deleted and the turn sent again.
        ctx.chat.splice(2);
        hooks.update();
        await settle();
        ctx.chat.push(userMessage('I hunt it.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle, /7 copper/, 'no stale result');
        assert.match(prompts.story_suite_static_rpg_battle, /<Encounter>/, 'the story instruction is there, so a new fight can be offered');
        assert.equal(ctx.chatMetadata.rpgBattle.pending, null);
        // The same from a chat saved before 0.4.3: no origin, but foughtAt says where the fight started.
        openChat('legacy-chat', [hello(), userMessage('I hunt it.'), offer, userMessage('Onward.')], {
            pending: { handoff, fightId: 'f1', attachedTo: null },
            foughtAt: { index: 2, text: 'x' },
        });
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.match(prompts.story_suite_tail_3_rpg_battle, /7 copper/, 'still waiting while its reply is there');
        ctx.chat.splice(1);
        ctx.chat.push(userMessage('I hunt it.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle, /7 copper/);
        assert.equal(ctx.chatMetadata.rpgBattle.pending, null);
        // A fight under way whose reply was swiped away is gone too.
        openChat('fight-chat', [hello(), userMessage('I hunt it.'), offer], {
            fight: { setup: { id: 'f2', seed: 's', party: [], enemies: [] }, actions: [], origin: { index: 2, date: 'd2', swipe: 0 } },
        });
        ctx.chat[2] = { ...offer, swipe_id: 1, send_date: 'd7' };
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        hooks.update();
        await settle();
        assert.equal(hooks.tabs['rpg-battle'].badge(), 0);
    } finally {
        ctx.setExtensionPrompt = before;
    }
});

// ---------------------------------------------------------------------------
// 0.5: plans, fights in stages

const modeOf = pane => pane.firstElementChild?.dataset.mode;
/** The Battle tab until it leaves the fight: Auto pressed for every turn of yours. */
async function fightOut() {
    for (let step = 0; step < 300; step++) {
        const pane = drawTab('rpg-battle');
        if (modeOf(pane) !== 'fight') return pane;
        const auto = find(pane, '.rpg-battle-act.is-auto');
        if (auto) auto.click();
        await settle();
    }
    throw new Error('the fight did not end');
}
/** Seeds come from the chat id and the time a fight starts: fixed here, so every fight is the same each run. */
async function withClock(run) {
    const real = Date.now;
    let now = 1_760_000_000_000;
    Date.now = () => (now += 1000);
    try {
        await run();
    } finally {
        Date.now = real;
    }
}
const meta = () => ctx.chatMetadata.rpgBattle;
const planReply = text => ({ ...reply(text), send_date: 'd2', swipe_id: 0 });
const PLAN_TEXT = '<Encounter>at the gate: 2 giant rat (trivial); then at the yard: giant rat (trivial); then: giant rat (trivial); then at the tower: giant rat (boss, trivial)</Encounter>';

for (const mode of ['manual', 'automatic', 'changed-chat']) test(`disconnected battle recovery: ${mode}`, async t => withClock(async () => {
    const sb = globalThis.StoryBlock;
    const automatic = mode !== 'manual';
    let repaired = false, evidenceWrites = 0, repairWrites = 0;
    const plan = { chatId: 'regenerated-battle', messageIndex: 2, owner: 'new-root', head: 'old-root' };
    sb.journalVersion = 1; sb.transactionVersion = 1;
    sb.journal = () => repaired ? { availability: 'available', prefix: [], key: '' }
        : { availability: 'incomplete', reason: 'No retained reply matches the saved quest history.' };
    sb.regeneratedReplyRecovery = () => repaired ? null : plan;
    sb.recoverRegeneratedReply = async expected => { assert.equal(expected, plan); repairWrites++; repaired = true; return { status: 'durable' }; };
    if (automatic) sb.reconnectRegeneratedReply = async () => {
        await sb.recoverRegeneratedReply(plan);
        if (mode === 'changed-chat') openChat('another-chat', [reply('Another story.')]);
    };
    sb.messageIdentity = index => ctx.chat[index]?.extra?.owner;
    sb.commitBlocks = async request => {
        assert.equal(repaired, true);
        evidenceWrites++;
        ctx.chat[request.messageIndex].extra[request.namespace] = structuredClone(request.value);
        return { status: 'durable' };
    };
    t.after(() => { for (const key of ['journalVersion', 'transactionVersion', 'journal', 'regeneratedReplyRecovery', 'recoverRegeneratedReply', 'reconnectRegeneratedReply', 'messageIdentity', 'commitBlocks']) delete sb[key]; });
    openChat('regenerated-battle', [reply(`<Party>\n${REN}\n</Party>`), userMessage('Hunt.'),
        { ...planReply('<Encounter>giant rat (trivial)</Encounter>'), extra: { owner: 'new-root' } }]);
    hooks.update(); await settle();
    find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
    find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
    await settle();
    const before = partyText();
    const original = meta();
    const fightId = meta().fight.setup.id;
    let pane = await fightOut();
    if (mode === 'changed-chat') {
        assert.equal(ctx.chatId, 'another-chat');
        assert.equal(original.fight.setup.id, fightId);
        assert.equal(evidenceWrites, 0, 'switching chats during repair cannot settle the old fight');
        assert.equal(repairWrites, 1);
        return;
    }
    if (!automatic) {
        assert.equal(modeOf(pane), 'recovery');
        assert.equal(partyText(), before);
        assert.equal(evidenceWrites, 0);
        assert.equal(repairWrites, 0);
        find(pane, '.rpg-battle-recover-replacement').click();
    }
    await settle();
    pane = drawTab('rpg-battle');
    assert.equal(modeOf(pane), 'result');
    assert.equal(meta().last.fightId, fightId, 'the stored battle is resumed, not replayed');
    assert.equal(evidenceWrites, 1);
    assert.equal(repairWrites, 1);
    const paid = partyText();
    assert.notEqual(paid, before);
    drawTab('rpg-battle'); await settle();
    assert.equal(partyText(), paid);
    assert.equal(evidenceWrites, 1);
}));

test('a plan in three stages: Fight?, the stages read-only, Start, each stage fought, Go on between, one result and one hand-off', async () => withClock(async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    const sb = globalThis.StoryBlock;
    let evidenceWrites = 0;
    sb.transactionVersion = 1;
    sb.messageIdentity = index => `${ctx.chatId}:reply:${index}`;
    sb.commitBlocks = async request => {
        evidenceWrites++;
        assert.equal(request.namespace, 'rpgBattleEvidence');
        // Redraws during an asynchronous save must not try to finish this stage again.
        drawTab('rpg-battle');
        await settle();
        const message = ctx.chat[request.messageIndex];
        message.extra = { ...message.extra, [request.namespace]: structuredClone(request.value) };
        return { status: 'durable' };
    };
    ctx.setExtensionPrompt = (key, value) => { prompts[key] = value; };
    try {
        openChat('plan-chat', [reply(`<Party>\n${REN.replace('HP: 58/62', 'HP: 102/102')}\n</Party>`), userMessage('We storm the keep.'), planReply(`They reach the gate.\n${PLAN_TEXT}`)]);
        hooks.update();
        await settle();
        let pane = drawTab('rpg-battle');
        assert.equal(find(pane, '.rpg-battle-encounter-text').textContent, 'A plan in 3 stages: the gate, the yard, the tower');
        find(pane, '.rpg-battle-encounter-fight').click();
        pane = drawTab('rpg-battle');
        assert.equal(find(pane, 'input'), null);
        assert.deepEqual(findAll(pane, '.rpg-battle-stage-title').map(node => node.textContent), ['Stage 1 of 3: the gate', 'Stage 2 of 3: the yard', 'Stage 3 of 3: the tower']);
        assert.deepEqual(findAll(pane, '.rpg-battle-stage')[1].querySelectorAll('.rpg-battle-wave').map(node => node.textContent), ['Engagement 1', 'Then, engagement 2']);
        assert.deepEqual(findAll(pane, 'button').map(node => node.textContent.trim()), ['Not now', 'Start']);
        find(pane, '.rpg-battle-begin').click();
        await settle();
        assert.equal(meta().plan.at, 0);
        assert.equal(meta().fight.setup.id, `${meta().plan.id}-1`);
        assert.deepEqual(meta().fight.setup.enemies.map(enemy => enemy.name), ['Giant Rat A', 'Giant Rat B']);
        // During the plan the story is told no <Wounds> or <Encounter> (0.5.41: the instruction
        // itself stays, unchanged, so the prompt's start is the same reply after reply).
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.match(prompts.story_suite_tail_3_rpg_battle, /A fight is under way in RPG Battle: write no <Wounds> and no <Encounter>/);
        pane = await fightOut();
        assert.equal(modeOf(pane), 'between');
        assert.match(find(pane, '.rpg-battle-between-cleared').textContent, /^The gate is cleared \(\d+ rounds?\)\.$/);
        assert.equal(find(pane, '.rpg-battle-between-next').textContent, 'Next: the yard — giant rat (trivial); then: giant rat (trivial)');
        assert.deepEqual(findAll(pane, 'button').map(node => node.textContent.trim()), ['Fall back', 'Go on']);
        assert.equal(meta().fight, null);
        assert.doesNotMatch(ctx.chat[2].mes, /<Party>/, 'nothing written between stages');
        const carried = meta().plan.carry.find(unit => unit.id === 'pc').hp;
        find(pane, '.rpg-battle-go-on').click();
        await settle();
        assert.equal(meta().plan.at, 1);
        assert.deepEqual(meta().fight.setup.party.find(unit => unit.id === 'pc').hp, carried, 'stage 2 starts as stage 1 ended');
        assert.equal(meta().fight.setup.waves.length, 1, 'the stage\'s wave');
        pane = await fightOut();
        assert.equal(modeOf(pane), 'between');
        assert.equal(find(pane, '.rpg-battle-between-next').textContent, 'Next: the tower — giant rat (boss, trivial)');
        find(pane, '.rpg-battle-go-on').click();
        await settle();
        pane = await fightOut();
        assert.equal(modeOf(pane), 'result');
        assert.equal(find(pane, '.rpg-battle-outcome').textContent, 'Victory');
        assert.deepEqual(findAll(pane, '.rpg-battle-stage-line').map(node => node.textContent.replace(/\d+ rounds?/, 'N')), ['Stage 1, the gate: victory in N', 'Stage 2, the yard: victory in N', 'Stage 3, the tower: victory in N']);
        assert.equal(meta().plan, null);
        assert.equal(evidenceWrites, 3, 'one durable evidence write per stage, no aggregate duplication');
        const evidence = storySuite().api('rpg-battle').quests.evidence({ version: 1, anchor: sb.messageIdentity(2), excluded: [] });
        assert.equal(evidence.availability, 'available');
        assert.equal(evidence.events.length, 3);
        assert.equal(new Set(evidence.events.flatMap(event => event.defeated.map(enemy => enemy.id))).size, 5);
        const handoff = meta().pending.handoff;
        assert.match(handoff, /^Stage 1, the gate: victory in \d+ rounds?\.\nStage 2, the yard: victory in \d+ rounds?\.\nStage 3, the tower: victory in \d+ rounds?\.$/m);
        assert.doesNotMatch(handoff, /Not reached/);
        assert.equal(meta().pending.origin.index, 2);
        // Written once, into the latest reply: XP of all three stages, the loot.
        assert.match(ctx.chat[2].mes, /<Inventory>/);
        assert.doesNotMatch(ctx.chat[2].mes, /^Level: 4 \| XP: 31\/100/m);
        // The next reply narrates it, once.
        ctx.chat.push(userMessage('And then?'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.ok(prompts.story_suite_tail_3_rpg_battle.startsWith(handoff));
        find(pane, '.rpg-battle-done').click();
        ctx.chat.push(reply('The tower falls silent.'));
        await hooks.reply({ messageIndex: 4 });
        await settle();
        assert.equal(hooks.tabs['rpg-battle'].isAvailable(), false, 'the Battle tab goes with the battle');
    } finally {
        ctx.setExtensionPrompt = before;
        delete sb.transactionVersion;
        delete sb.messageIdentity;
        delete sb.commitBlocks;
    }
}));

test('a plan survives a reload between stages; Fall back ends it, keeping what the cleared stage gave', async () => withClock(async () => {
    const chat = [reply(`<Party>\n${REN}\n</Party>`), userMessage('On.'), planReply(PLAN_TEXT)];
    openChat('fallback-chat', chat);
    hooks.update();
    await settle();
    find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
    find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
    await settle();
    // A reload mid-fight: the stage is replayed from the stored setup and actions.
    const saved = JSON.parse(JSON.stringify(ctx.chatMetadata));
    openChat('elsewhere', [reply('Elsewhere.')]);
    drawTab('rpg-battle');
    openChat('fallback-chat', chat, saved.rpgBattle);
    assert.equal(modeOf(drawTab('rpg-battle')), 'fight');
    let pane = await fightOut();
    assert.equal(modeOf(pane), 'between');
    // A reload between stages: only chat state, nothing in memory.
    const between = JSON.parse(JSON.stringify(meta()));
    openChat('elsewhere', [reply('Elsewhere.')]);
    drawTab('rpg-battle');
    openChat('fallback-chat', chat, between);
    pane = drawTab('rpg-battle');
    assert.equal(modeOf(pane), 'between');
    assert.equal(hooks.tabs['rpg-battle'].badge(), 1);
    assert.deepEqual(findAll(pane, 'button').map(node => node.textContent.trim()), ['Fall back', 'Go on']);
    find(pane, '.rpg-battle-fall-back').click();
    await settle();
    pane = drawTab('rpg-battle');
    assert.equal(modeOf(pane), 'result');
    assert.equal(find(pane, '.rpg-battle-outcome').textContent, 'Fell back');
    assert.deepEqual(findAll(pane, '.rpg-battle-stage-line').map(node => node.textContent.replace(/\d+ rounds?/, 'N')), ['Stage 1, the gate: victory in N', 'Stage 2, the yard: not attempted', 'Stage 3, the tower: not attempted']);
    assert.match(meta().pending.handoff, /^Fell back after the gate; the yard and the tower were not attempted\.$/m);
    assert.equal(meta().last.result.outcome, 'withdrew');
    // Stage 1's XP and loot are on the sheets and in the Inventory.
    const [, level, xp] = ctx.chat[2].mes.match(/^Level: (\d+) \| XP: (\d+)\/100/m) ?? [];
    assert.ok(Number(level) * 100 + Number(xp) > 4 * 100 + 31, `Level ${level}, XP ${xp}`);
    assert.equal(meta().plan, null);
}));

test('a plan goes back with the reply it started from, between stages and in a stage', async () => withClock(async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value) => { prompts[key] = value; };
    try {
        const start = () => {
            openChat('rollback-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('On.'), planReply(PLAN_TEXT)]);
            hooks.update();
        };
        start();
        await settle();
        find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
        find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
        await settle();
        assert.equal(modeOf(await fightOut()), 'between');
        // The reply the plan started from is deleted, and the turn sent again.
        ctx.chat.splice(2);
        hooks.update();
        await settle();
        assert.equal(hooks.tabs['rpg-battle'].badge(), 0);
        assert.equal(hooks.tabs['rpg-battle'].isAvailable(), false);
        ctx.chat.push(userMessage('On.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle, /Battle resolved by RPG Battle/, 'no result to narrate');
        assert.match(prompts.story_suite_static_rpg_battle, /<Encounter>/, 'the story instruction is back');
        ctx.chat.push(reply('A quiet road.'));
        await hooks.reply({ messageIndex: 3 });
        await settle();
        assert.equal(meta().plan, null, 'cleared');
        assert.equal(meta().fight, null);
        assert.match(ctx.chat.map(message => message.mes).join('\n'), /^HP: 58\/62/m, 'the sheets as they were');
        // In stage 2, the reply swiped to another version: the plan and its fight go.
        start();
        await settle();
        find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
        find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
        await settle();
        await fightOut();
        find(drawTab('rpg-battle'), '.rpg-battle-go-on').click();
        await settle();
        assert.equal(meta().plan.at, 1);
        ctx.chat[2] = { ...ctx.chat[2], swipe_id: 1, send_date: 'd9', mes: 'They turn back.' };
        await hooks.reply({ messageIndex: 2 });
        await settle();
        assert.equal(meta().plan, null);
        assert.equal(meta().fight, null);
        assert.equal(meta().pending, null);
        assert.equal(hooks.tabs['rpg-battle'].badge(), 0);
    } finally {
        ctx.setExtensionPrompt = before;
    }
}));

test('a Story Director planned fight may be a plan too', async () => withClock(async () => {
    openChat('director-plan', [reply(`<Party>\n${REN}\n</Party>`), userMessage('To the mill.'), planReply('The mist lifts.')]);
    globalThis.StoryDirector = { encountersAt: () => [{ key: 'The mill raid', encounter: 'at the ford: 2 wolf (trivial); then at the mill: bandit (trivial) | to the death', status: 'due', place: 'the mill' }] };
    try {
        hooks.update();
        await settle();
        let pane = drawTab('rpg-battle');
        assert.equal(find(pane, '.rpg-battle-encounter-text').textContent, 'A plan in 2 stages: the ford, the mill');
        assert.match(find(pane, '.rpg-battle-encounter-label').textContent, /The mill raid/);
        assert.match(find(pane, '.rpg-battle-encounter-stakes').textContent, /To the death/);
        find(pane, '.rpg-battle-encounter-fight').click();
        pane = drawTab('rpg-battle');
        assert.deepEqual(findAll(pane, '.rpg-battle-stage-title').map(node => node.textContent), ['Stage 1 of 2: the ford', 'Stage 2 of 2: the mill']);
        find(pane, '.rpg-battle-begin').click();
        await settle();
        assert.equal(meta().plan.stakes, 'death');
        assert.deepEqual(meta().plan.stages.map(stage => [stage.place, stage.rows.map(row => row.name)]), [['the ford', ['Wolf']], ['the mill', ['Bandit']]]);
        assert.equal(meta().fight.setup.stakes, 'death');
        assert.ok(meta().dismissed.some(key => key.includes('then at the mill')), 'the offer is spent');
    } finally {
        delete globalThis.StoryDirector;
    }
}));

test('a plan to the death lost at stage 2 is a fight lost to the death; stage 1\'s gains are kept, stage 3 never happens', async () => withClock(async () => {
    openChat('death-plan', [reply(`<Party>\n${REN}\n</Party>`), userMessage('Into the dark.'), planReply('<Encounter>at the gate: giant rat (trivial); then at the hall: ogre (boss, deadly); then at the crypt: wraith | to the death</Encounter>')]);
    hooks.update();
    await settle();
    find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
    find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
    await settle();
    assert.equal(modeOf(await fightOut()), 'between');
    find(drawTab('rpg-battle'), '.rpg-battle-go-on').click();
    await settle();
    const pane = await fightOut();
    assert.equal(modeOf(pane), 'result');
    assert.equal(find(pane, '.rpg-battle-outcome').textContent, 'Defeated');
    const handoff = meta().pending.handoff;
    assert.match(handoff, /^Stage 2, the hall: defeated — Ren is killed\. Ren is dead and does not come back; narrate the death, not a rescue\.$/m);
    assert.match(handoff, /^Not reached: the crypt\. Do not narrate it\.$/m);
    assert.match(ctx.chat[2].mes, /^State: dead$/m, 'dead, as after a fight lost to the death');
    assert.deepEqual(findAll(pane, '.rpg-battle-stage-line').map(node => node.textContent.replace(/\d+ rounds?/, 'N')), ['Stage 1, the gate: victory in N', 'Stage 2, the hall: defeated after N', 'Stage 3, the crypt: not reached']);
}));

// ---------------------------------------------------------------------------
// 0.5: what a reply carried goes back with it (found live)

const sent = (text, date) => ({ ...reply(text), send_date: date, swipe_id: 0 });
const partyOffers = () => findAll(drawTab('rpg-party'), '.rpg-battle-offer-text').map(node => node.textContent);

test('quest XP is prepared without mutation and its settlement receipt prevents re-awarding after index shifts', async t => {
    const sb = globalThis.StoryBlock;
    const quests = storySuite().api('rpg-battle').quests;
    const ready = REN.replace('XP: 31/100', 'XP: 99/100');
    openChat('atomic-quest-xp', [reply(`<Party>\n${ready}\n\n${LYRA}\n</Party>`), reply('Quest report.')]);
    const before = partyText();
    const award = quests.prepareAward({ id: 'long hunt', fields: { difficulty: 'hard' } });
    assert.equal(partyText(), before, 'preparation must not write sheets');
    assert.equal(award.changes[0].tag, 'Party');
    assert.ok(award.xp.gains.some(gain => gain.memberId === 'pc' && gain.levelsGained > 0));
    ctx.chat[1].extra = { owner: 'paid-owner', storyDirectorQuest: { receipts: [{ owner: 'paid-owner', xp: award.xp }] } };
    await sb.setBlockText(1, 'Party', award.changes[0].text);
    const paid = partyText();
    const previous = globalThis.StoryDirector;
    globalThis.StoryDirector = { apiVersion: 1, questsDoneAt: () => [{ id: 'long hunt', name: 'Long hunt', difficulty: 'hard' }] };
    t.after(() => { globalThis.StoryDirector = previous; delete sb.messageIdentity; });
    sb.messageIdentity = index => ctx.chat[index]?.extra?.owner;
    for (const shift of [false, true]) {
        if (shift) { ctx.chat.shift(); delete ctx.chatMetadata.rpgBattle; }
        await hooks.reply({ messageIndex: ctx.chat.length - 1 });
        await settle();
        assert.equal(partyText(), paid, 'the stable XP receipt survives a shifted message index and missing metadata offer flags');
        assert.ok(!partyOffers().some(text => text.includes('Long hunt')));
    }
});

test('story XP saves Party and its stable receipt once even when metadata flags disappear', async t => {
    const sb = globalThis.StoryBlock;
    sb.journalVersion = 1;
    sb.messageIdentity = index => ctx.chat[index]?.extra?.owner;
    let writes = 0;
    sb.commitBlocks = async request => {
        writes++;
        assert.equal(request.namespace, 'rpgBattleAwards');
        assert.equal(request.changes[0].tag, 'Party');
        const message = ctx.chat[request.messageIndex];
        assert.equal(request.expectedText, message.mes);
        await sb.setBlockText(request.messageIndex, 'Party', request.changes[0].text);
        message.extra[request.namespace] = structuredClone(request.value);
        return { status: 'durable' };
    };
    t.after(() => { delete sb.journalVersion; delete sb.messageIdentity; delete sb.commitBlocks; });
    openChat('durable-story-xp', [reply(`<Party>\n${REN}\n</Party>`), { ...reply('<XP>minor: found the cellar</XP>'), extra: { owner: 'story-xp' } }]);
    await hooks.reply({ messageIndex: 1 });
    const paid = partyText();
    assert.equal(writes, 1);
    assert.equal(ctx.chat[1].extra.rpgBattleAwards.owner, 'story-xp');
    delete ctx.chatMetadata.rpgBattle;
    await hooks.reply({ messageIndex: 1 });
    assert.equal(partyText(), paid);
    assert.equal(writes, 1);
});

test('a fight rolled back with its reply leaves no trace: the identical reply sent again offers it again, and Not now goes back too', async () => withClock(async () => {
    const offerText = 'A rat bolts from the sacks.\n<Encounter>giant rat (trivial)</Encounter>\n<XP>minor: found the cellar</XP>';
    openChat('resend-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('Down to the cellar.'), sent(offerText, 'd2')]);
    hooks.update();
    await settle();
    // (0.5.21) Story XP is awarded at once, with a toast, not offered.
    hooks.tabs['rpg-party'].badge();
    await settle();
    assert.ok(toasts.some(text => /Story XP awarded: .*\(found the cellar\)/.test(text)), 'the reply\'s XP is awarded');
    assert.ok(!partyOffers().some(text => /found the cellar/.test(text)), 'and not offered');
    find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
    find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
    await settle();
    assert.equal(modeOf(await fightOut()), 'result');
    assert.ok(meta().pending);
    assert.ok(meta().dismissed.includes(`2:${blockAt(2)}`), 'the offer is spent');
    assert.ok(!partyOffers().some(text => /found the cellar/.test(text)), 'no XP from before the fight');
    // Delete the user turn and the reply, then send the same turn and get the very same reply.
    ctx.chat.splice(1);
    hooks.update();
    await settle();
    ctx.chat.push(userMessage('Down to the cellar.'));
    await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
    ctx.chat.push(sent(offerText, 'd5'));
    await hooks.reply({ messageIndex: 2 });
    await settle();
    assert.equal(meta().pending, null);
    assert.equal(hooks.tabs['rpg-battle'].isAvailable(), true, 'the Battle tab is back');
    assert.equal(hooks.tabs['rpg-battle'].badge(), 1);
    assert.ok(toasts.some(text => /A fight is starting: giant rat/.test(text)), 'toasted again');
    assert.equal(toasts.filter(text => /Story XP awarded: .*\(found the cellar\)/.test(text)).length, 2, 'the new reply\'s XP is awarded: the first went with its reply');
    let pane = drawTab('rpg-battle');
    find(pane, '.rpg-battle-encounter-fight').click();
    pane = drawTab('rpg-battle');
    assert.deepEqual(findAll(pane, '.rpg-battle-enemy-name').map(node => node.textContent), ['Giant Rat']);
    // Not now on this reply, then the reply replaced by the same text: offered again.
    find(pane, '.rpg-battle-encounter-dismiss').click();
    assert.equal(hooks.tabs['rpg-battle'].badge(), 0, 'put away');
    ctx.chat[2] = sent(offerText, 'd6');
    hooks.update();
    await settle();
    assert.equal(hooks.tabs['rpg-battle'].badge(), 1, 'a Not now went with its reply');
    find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
    find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
    await settle();
    assert.ok(meta().fight, 'and it can be fought');
    // An older chat's key, without a record of its reply, still holds.
    openChat('legacy-keys', [reply(`<Party>\n${REN}\n</Party>`), userMessage('On.'), sent(offerText, 'd9')], { dismissed: [`2:${'giant rat (trivial)'}`] });
    hooks.update();
    await settle();
    assert.equal(hooks.tabs['rpg-battle'].badge(), 0);
}));

function blockAt(index) {
    return globalThis.StoryBlock.blockInText(ctx.chat[index].mes, 'Encounter').text;
}

test('the reply that narrated a fight never offers its XP or rest, even after a later fight\'s hand-off is spent and rolled back', async () => withClock(async () => {
    openChat('narrated-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('To the weir.'), sent('Wolves at the weir.\n<Encounter>giant rat (trivial)</Encounter>', 'd2')]);
    hooks.update();
    await settle();
    find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
    find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
    await settle();
    await fightOut();
    find(drawTab('rpg-battle'), '.rpg-battle-done').click();
    // Reply 4 narrates fight A and claims XP for it: the fight already gave it.
    ctx.chat.push(userMessage('We won?'));
    await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
    assert.equal(meta().pending.attachedTo, 4);
    const narration = sent('The pack scatters.\n<XP>major: drove off the weir pack</XP>\n<Rest>short: caught their breath</Rest>', 'd4');
    ctx.chat.push(narration);
    await hooks.reply({ messageIndex: 4 });
    await settle();
    assert.deepEqual(meta().narrated.map(entry => [entry.index, entry.date, entry.swipe]), [[4, 'd4', 0]]);
    assert.equal(partyOffers().filter(text => /weir pack|caught their breath/.test(text)).length, 0, 'not while it narrates');
    // A later fight from reply 6, narrated by 8, spent by 10.
    ctx.chat.push(userMessage('On.'), sent('More rats.\n<Encounter>giant rat (trivial)</Encounter>', 'd6'));
    await hooks.reply({ messageIndex: 6 });
    await settle();
    assert.equal(meta().pending, null, 'fight A\'s hand-off is spent');
    assert.equal(partyOffers().filter(text => /weir pack/.test(text)).length, 0);
    find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
    find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
    await settle();
    await fightOut();
    find(drawTab('rpg-battle'), '.rpg-battle-done').click();
    ctx.chat.push(userMessage('And?'));
    await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
    ctx.chat.push(sent('Done.', 'd8'), userMessage('Rest.'));
    await hooks.reply({ messageIndex: 8 });
    await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
    ctx.chat.push(sent('Morning.', 'd10'));
    await hooks.reply({ messageIndex: 10 });
    await settle();
    assert.equal(meta().pending, null, 'fight B\'s hand-off is spent');
    // Back to reply 4: it is the latest again, and still the reply that narrated fight A.
    ctx.chat.splice(5);
    hooks.update();
    await settle();
    assert.equal(meta().pending, null);
    assert.deepEqual(partyOffers().filter(text => /weir pack|caught their breath/.test(text)), [], 'never offered');
    assert.equal(hooks.tabs['rpg-party'].badge(), 0);
    // Swiped to a new reply in its place, which was given no hand-off: that one's XP is the story's own.
    ctx.chat[4] = { ...narration, swipe_id: 1, send_date: 'd11' };
    hooks.update();
    await settle();
    hooks.tabs['rpg-party'].badge();
    await settle();
    assert.ok(toasts.some(text => /Story XP awarded: .*\(drove off the weir pack\)/.test(text)), 'a new reply at that place is no narration');
}));

test('the story instruction names the creatures this story has met (0.5.1)', async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value) => { prompts[key] = value; };
    try {
        openChat('foes-chat', [reply(`Hello.\n<Party>\n${REN}\n</Party>`), userMessage('On.')], {
            bestiary: [{ name: 'Feral Ditch-Dog', rank: 'F', role: 'skirmisher' }, { name: 'Inside The Den: Old Dog Wolf', rank: 'F', role: 'brute' }, { name: 'Scrub Quill-Dog', rank: 'F', role: 'brute' }],
        });
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.match(prompts.story_suite_static_rpg_battle, /<Encounter>/);
        assert.match(prompts.story_suite_tail_3_rpg_battle, /Foes this story has met \(the same creature keeps its name\): Feral Ditch-Dog, Scrub Quill-Dog\./);
        openChat('no-foes-chat', [reply(`Hello.\n<Party>\n${REN}\n</Party>`), userMessage('On.')], {});
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle, /Foes this story has met/);
    } finally {
        ctx.setExtensionPrompt = before;
    }
});

test('after a fight (0.5.4): next moves from the model, else written from the result; a move goes to the message box', async () => withClock(async () => {
    const fight = async (id, text) => {
        openChat(id, [reply(`<Party>\n${REN}\n</Party>`), userMessage('Down to the cellar.'), sent(`A rat bolts from the sacks.\n<Encounter>${text}</Encounter>`, 'd2')]);
        hooks.update();
        await settle();
        find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
        find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
        await settle();
        const pane = await fightOut();
        assert.equal(modeOf(pane), 'result');
        for (let i = 0; i < 5; i++) await settle();
        return drawTab('rpg-battle');
    };
    // No model here (no generateRaw): the moves are written from the result.
    let pane = await fight('moves-code', 'giant rat (trivial)');
    let moves = findAll(pane, '.rpg-battle-next-move').map(node => node.textContent.trim());
    assert.ok(moves.length >= 2 && moves.length <= 4, moves.join(' | '));
    assert.ok(moves.includes('Press on before anything else arrives.'));
    assert.equal(find(pane, '.rpg-battle-return').textContent.trim(), 'Just continue');
    // With a model: its moves.
    const before = ctx.generateRaw;
    ctx.generateRaw = async ({ systemPrompt, prompt }) => {
        assert.match(systemPrompt, /outcome is settled/);
        assert.match(prompt, /How the fight ended:/);
        return '1. Wipe the blade on a sack.\n2. Check the cellar for more rats.\n3. Call up the stairs that it is done.';
    };
    try {
        pane = await fight('moves-model', 'giant rat (trivial)');
        moves = findAll(pane, '.rpg-battle-next-move').map(node => node.textContent.trim());
        assert.deepEqual(moves, ['Wipe the blade on a sack.', 'Check the cellar for more rats.', 'Call up the stairs that it is done.']);
        // A move: the result screen closes for the story (the message box is SillyTavern's).
        findAll(pane, '.rpg-battle-next-move')[1].click();
        await settle();
        assert.notEqual(modeOf(drawTab('rpg-battle')), 'result');
        assert.ok(meta().pending, 'the hand-off still waits for the reply');
        // Off: no moves, Return to story as before.
        ctx.extensionSettings.rpgBattle.nextMoves = false;
        pane = await fight('moves-off', 'giant rat (trivial)');
        assert.equal(findAll(pane, '.rpg-battle-next-move').length, 0);
        assert.equal(find(pane, '.rpg-battle-return').textContent.trim(), 'Return to story');
    } finally {
        ctx.generateRaw = before;
        ctx.extensionSettings.rpgBattle.nextMoves = true;
    }
}));

test('Story Suite is told which reply tells a fight, so Story Block rolls no dice for it (0.5.22)', async () => withClock(async () => {
    const api = () => storySuite().api('rpg-battle');
    openChat('narrates-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('To the weir.'), sent('Rats.\n<Encounter>giant rat (trivial)</Encounter>', 'd2')]);
    hooks.update();
    await settle();
    assert.equal(api().narratesFight('normal'), false, 'no fight fought yet');
    find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
    find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
    await settle();
    await fightOut();
    find(drawTab('rpg-battle'), '.rpg-battle-done').click();
    assert.equal(api().narratesFight('normal'), true, 'the next reply tells it');
    assert.equal(api().narratesFight('quiet'), false, 'a summary is no reply');
    ctx.chat.push(userMessage('We won?'));
    await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
    assert.equal(api().narratesFight('normal'), true, 'still, once the hand-off is given to it');
    ctx.chat.push(sent('The rats scatter.', 'd4'));
    await hooks.reply({ messageIndex: 4 });
    await settle();
    assert.equal(api().narratesFight('swipe'), true, 'a swipe of the narration tells it again');
    assert.equal(api().narratesFight('normal'), false, 'the reply after it does not');
}));

test('a chat with hidden messages: the hand-off goes to the reply that tells the fight, and again after it is deleted and re-run (0.5.23)', async () => withClock(async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value) => { prompts[key] = value; };
    // SillyTavern hands interceptors the chat without its hidden (is_system) messages.
    const intercept = () => globalThis.rpgBattleInterceptor(ctx.chat.filter(message => !message.is_system), 0, null, 'normal');
    try {
        const hidden = { ...reply('A note kept out of the prompt.'), is_system: true };
        openChat('hidden-chat', [hidden, { ...hidden }, reply(`<Party>\n${REN}\n</Party>`), userMessage('To the weir.'), sent('Rats.\n<Encounter>giant rat (trivial)</Encounter>', 'd4')]);
        hooks.update();
        await settle();
        find(drawTab('rpg-battle'), '.rpg-battle-encounter-fight').click();
        find(drawTab('rpg-battle'), '.rpg-battle-begin').click();
        await settle();
        await fightOut();
        find(drawTab('rpg-battle'), '.rpg-battle-done').click();
        ctx.chat.push(userMessage('I take their purses.'));
        await intercept();
        assert.match(prompts.story_suite_tail_3_rpg_battle ?? '', /Battle resolved by RPG Battle/);
        assert.equal(meta().pending.attachedTo, 6, 'the reply about to be written, counted in the whole chat');
        ctx.chat.push(sent('The rats lie still.', 'd6'));
        await hooks.reply({ messageIndex: 6 });
        await settle();
        assert.ok(meta().pending, 'still the narration\'s: a swipe of it tells the fight again');
        // The narration deleted, the turn sent again: the result is told again.
        ctx.chat.splice(6);
        hooks.update();
        await settle();
        await intercept();
        assert.match(prompts.story_suite_tail_3_rpg_battle ?? '', /Battle resolved by RPG Battle/, 'the re-run reply is given the result');
        ctx.chat.push(sent('The rats lie still, again.', 'd7'));
        await hooks.reply({ messageIndex: 6 });
        await settle();
        // The story moves on: the reply after the narration gets nothing.
        ctx.chat.push(userMessage('On to the village.'));
        await intercept();
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle ?? '', /Battle resolved by RPG Battle/, 'spent once the story moves past it');
    } finally {
        ctx.setExtensionPrompt = before;
    }
}));

test('a rest the story tells is applied at once, with a toast, and goes with its reply (0.5.24)', async () => withClock(async () => {
    const hurt = REN.replace('HP: 58/62 | MP: 21/30', 'HP: 20/62 | MP: 5/30');
    openChat('rest-chat', [reply(`<Party>\n${hurt}\n</Party>`), userMessage('I rest in the garret.')]);
    hooks.update();
    await settle();
    toasts.length = 0;
    ctx.chat.push(sent('You sleep a little.\n<Rest>short: rested in Mother Karr\'s garret</Rest>', 'd2'));
    await hooks.reply({ messageIndex: 2 });
    await settle();
    assert.ok(toasts.some(text => /^Rested \(short\): rested in Mother Karr's garret\. Ren HP \+\d+, MP \+\d+\.$/.test(text)), toasts.join(' / '));
    assert.ok(!partyOffers().some(text => /Recover\?/.test(text)), 'not offered');
    const after = partyText(3);
    const hp = Number(after.match(/HP: (\d+)\//)[1]);
    assert.ok(hp > 20, `HP back up (${hp})`);
    // Refreshing does not rest twice.
    hooks.tabs['rpg-party'].badge();
    await settle();
    assert.equal(toasts.filter(text => /^Rested/.test(text)).length, 1);
    assert.equal(Number(partyText(3).match(/HP: (\d+)\//)[1]), hp);
    // The reply deleted: the sheets are as they were.
    ctx.chat.splice(2);
    hooks.update();
    await settle();
    assert.match(partyText(2), /HP: 20\/62/);
}));

test('the story is told the purse in one sum, so it cannot sell what the party cannot pay for (0.5.25)', async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value) => { prompts[key] = value; };
    try {
        openChat('purse-chat', [reply(`<Party>\n${REN}\n</Party>\n<Inventory>\nCoin Pouch | 1 | 1 Gold, 35 Silver, 14 Copper\n</Inventory>`), userMessage('I buy the jerkin.')]);
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.match(prompts.story_suite_tail_3_rpg_battle, /Purse: 4 gold, 6 silver, 4 copper in all; nothing dearer can be paid for/);
        openChat('purse-none', [reply(`<Party>\n${REN}\n</Party>`), userMessage('On.')]);
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle, /Purse:/, 'no purse, no line');
    } finally {
        ctx.setExtensionPrompt = before;
    }
});

test('one purse line: Story Block writes it while it keeps the items, in RPG Battle\'s coins (0.5.26)', async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value) => { prompts[key] = value; };
    const suite = storySuite();
    try {
        assert.deepEqual(suite.api('rpg-battle').currency().tiers.map(tier => tier.name), ['copper', 'silver', 'gold'], 'the currency is shared');
        openChat('purse-shared', [reply(`<Party>\n${REN}\n</Party>\n<Inventory>\nCoin Pouch | 1 | 1 Gold, 35 Silver, 14 Copper\n</Inventory>`), userMessage('I buy the jerkin.')]);
        suite.announce({ id: 'story-block', name: 'Story Block', version: '0.9.12', owns: ['items'], enabled: true, api: { printsPurse: () => true } });
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle, /Purse:/, 'Story Block writes it');
        suite.announce({ id: 'story-block', name: 'Story Block', version: '0.9.12', owns: ['items'], enabled: true, api: { printsPurse: () => false } });
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.match(prompts.story_suite_tail_3_rpg_battle, /Purse: 4 gold, 6 silver, 4 copper in all/, 'otherwise RPG Battle does');
    } finally {
        suite.withdraw('story-block');
        ctx.setExtensionPrompt = before;
    }
});

test('the story is told the conditions the party carries and how to end one, and the cure lifts it (0.5.27)', async () => withClock(async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value) => { prompts[key] = value; };
    try {
        const poisoned = REN.replace('Conditions: none', 'Conditions: poisoned');
        openChat('poison-chat', [reply(`<Party>\n${poisoned}\n</Party>`), userMessage('I drink the nettle broth.')]);
        hooks.update();
        await settle();
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.match(prompts.story_suite_tail_3_rpg_battle, /Lasting conditions: Ren poisoned\. When the story ends one: <Wounds>Ren — cure poisoned: how<\/Wounds>\./);
        assert.match(prompts.story_suite_static_rpg_battle, /cure poison;/, 'the instruction names the cure');
        ctx.chat.push(sent('The broth burns its way down; the venom sweats out.\n<Wounds>\nRen — cure poisoned: Mother Greta\'s nettle broth\n</Wounds>', 'd2'));
        await hooks.reply({ messageIndex: 2 });
        await settle();
        assert.match(partyText(3), /Conditions: none/, 'the sheet is clear');
        ctx.chat.push(userMessage('On.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle, /Lasting conditions/, 'nothing carried, nothing said');
    } finally {
        ctx.setExtensionPrompt = before;
    }
}));

test('a trade in the Trade tab: written into the latest reply, told once at depth 0 (again to a swipe), spent after, gone with its reply (0.5.37)', async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value, _position, depth) => { prompts[key] = { value, depth }; };
    try {
        const world = '<World_State>\n**📅 Time:** day | **🌤 Loc:** Bluewatch Village | Guild Post | [1, 2] | **🌡 Wx:** grey\n\n**👥 NPCs Present:**\n**Elke:**\n* *Mood:* tired\n\n---\n</World_State>';
        const inventory = '<Inventory>\nCoin Pouch | 1 | 2 silver\n[Loot]\nRat Tail | 5 | material\n</Inventory>';
        openChat('trade-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('To the guild.'), reply(`Elke waits.\n${world}\n${inventory}`)]);
        hooks.update();
        await settle();
        let pane = drawTrade();
        assert.match(find(pane, '.rpg-trade-place').textContent, /village prices/);
        pickTrader(pane, 'person:Elke');
        find(pane, '.rpg-trade-sell').click();
        await settle();
        const latest = ctx.chat[2].mes;
        assert.match(latest, /Rat Tail \| 4 \| material/);
        assert.doesNotMatch(latest, /Coin Pouch \| 1 \| 2 silver\n/);
        assert.match(ctx.chatMetadata.rpgBattle.trade.handoff, /sold Rat Tail to Elke for/);
        assert.equal(hooks.tabs['rpg-party'].badge(), 1, 'a trade waiting is on the Party badge');
        pane = drawTrade();
        assert.match(find(pane, '.rpg-trade-told li').textContent, /sold Rat Tail to Elke/);
        // The next reply is told, at depth 0; a swipe of it is told again.
        ctx.chat.push(userMessage('Thanks.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.match(prompts.story_suite_tail_3_rpg_battle.value, /^\[Trade\] Since the last reply, Ren sold Rat Tail to Elke/m);
        assert.equal(prompts.story_suite_tail_3_rpg_battle.depth, 0);
        ctx.chat.push(reply('Elke counts the tails.'));
        await hooks.reply({ messageIndex: 4 });
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'swipe');
        assert.match(prompts.story_suite_tail_3_rpg_battle.value, /sold Rat Tail/);
        // A newer reply: spent, and cleared from the prompt.
        ctx.chat.push(userMessage('Onward.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle.value, /\[Trade\]/);
        assert.equal(ctx.chatMetadata.rpgBattle.trade, null);
        // A trade whose reply is deleted goes with it: nothing is told.
        openChat('trade-chat-2', [reply(`<Party>\n${REN}\n</Party>`), userMessage('To the guild.'), { ...reply(`Elke waits.\n${world}\n${inventory}`), send_date: 'first' }]);
        hooks.update();
        await settle();
        find(drawTrade(), '.rpg-trade-sell').click();
        await settle();
        ctx.chat.pop();
        ctx.chat.push({ ...reply('Elke waits again.'), send_date: 'second' });
        hooks.update();
        await settle();
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle.value, /\[Trade\]/);
    } finally {
        ctx.setExtensionPrompt = before;
    }
});

test('an item used outside a fight: applied at once into the latest reply, the next reply told, at depth 0 (0.5.47)', async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value, _position, depth) => { prompts[key] = { value, depth }; };
    try {
        const hurt = REN.replace('HP: 58/62', 'HP: 30/62');
        openChat('item-chat', [{ ...reply(`<Party>\n${hurt}\n</Party>\n<Inventory>\n[Loot]\nMinor Healing Draught | 2 | heal 20\n</Inventory>`), send_date: 'zero' }]);
        hooks.update();
        await settle();
        find(drawParty(), '.rpg-battle-items').click();
        await settle();
        find(drawParty(), '.rpg-battle-use').click();
        await settle();
        // At once: the sheet and the Inventory of the latest reply.
        assert.match(partyText(), /HP: 50\/62/);
        assert.match(ctx.chat[0].mes, /Minor Healing Draught \| 1 \| heal 20/);
        // The Items page stays open for another dose; Back, and What's sent shows the note.
        assert.ok(findAll(drawParty(), '.rpg-battle-use').length, 'still on the Items page');
        find(drawParty(), '.rpg-battle-back').click();
        await settle();
        assert.ok(findAll(drawParty(), '.rpg-battle-sent-text').some(node => /Minor Healing Draught: \+20 HP \(now 50\/62 HP\)/.test(node.textContent)));
        ctx.chat.push(userMessage('I rest a moment.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.match(prompts.story_suite_tail_3_rpg_battle.value, /^\[Item\] Ren uses the Minor Healing Draught: \+20 HP \(now 50\/62 HP\)\./m);
        assert.equal(prompts.story_suite_tail_3_rpg_battle.depth, 0);
        // A swipe of that reply is told again; a newer reply finds it spent.
        ctx.chat.push({ ...reply('Ren drinks.'), send_date: 'one' });
        await hooks.reply({ messageIndex: 2 });
        await settle();
        assert.match(partyText(), /HP: 50\/62/, 'not applied a second time with the reply');
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'swipe');
        assert.match(prompts.story_suite_tail_3_rpg_battle.value, /\[Item\]/);
        ctx.chat.push(userMessage('On.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle.value, /\[Item\]/);
        assert.equal(ctx.chatMetadata.rpgBattle.itemUse, null);
    } finally {
        ctx.setExtensionPrompt = before;
    }
});

test('several doses: each click one dose, until the stock or full HP stops it; one note tells them all (0.5.47)', async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value, _position, depth) => { prompts[key] = { value, depth }; };
    const use = async () => {
        if (!findAll(drawParty(), '.rpg-battle-use').length && findAll(drawParty(), '.rpg-battle-items').length) {
            find(drawParty(), '.rpg-battle-items').click();
            await settle();
        }
        const button = findAll(drawParty(), '.rpg-battle-use')[0];
        if (button) button.click();
        await settle();
    };
    try {
        const hurt = REN.replace('HP: 58/62', 'HP: 10/62');
        openChat('doses-chat', [{ ...reply(`<Party>\n${hurt}\n</Party>\n<Inventory>\n[Loot]\nMinor Healing Draught | 2 | heal 20\n</Inventory>`), send_date: 'zero' }]);
        hooks.update();
        await settle();
        await use();
        await use();
        await use();
        assert.match(partyText(), /HP: 50\/62/, 'two draughts, two doses; nothing left for a third');
        assert.doesNotMatch(ctx.chat[0].mes, /Minor Healing Draught \|/);
        ctx.chat.push(userMessage('I drink.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        const told = prompts.story_suite_tail_3_rpg_battle.value;
        assert.match(told, /\+20 HP \(now 30\/62 HP\)/);
        assert.match(told, /\+20 HP \(now 50\/62 HP\)/);
        // Full HP: the draught is kept.
        openChat('doses-full', [{ ...reply(`<Party>\n${REN.replace('HP: 58/62', 'HP: 62/62')}\n</Party>\n<Inventory>\n[Loot]\nMinor Healing Draught | 2 | heal 20\n</Inventory>`), send_date: 'zero' }]);
        hooks.update();
        await settle();
        await use();
        assert.match(ctx.chat[0].mes, /Minor Healing Draught \| 2 \| heal 20/);
        assert.equal(ctx.chatMetadata.rpgBattle.itemUse ?? null, null);
    } finally {
        ctx.setExtensionPrompt = before;
    }
});

test('an item used, then its reply deleted or swiped away: the note goes with it (0.5.47)', async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value, _position, depth) => { prompts[key] = { value, depth }; };
    try {
        const hurt = REN.replace('HP: 58/62', 'HP: 30/62');
        openChat('item-gone', [reply(`<Party>\n${REN}\n</Party>`), userMessage('Wait.'), { ...reply(`<Party>\n${hurt}\n</Party>\n<Inventory>\n[Loot]\nMinor Healing Draught | 2 | heal 20\n</Inventory>`), send_date: 'first' }]);
        hooks.update();
        await settle();
        find(drawParty(), '.rpg-battle-items').click();
        await settle();
        find(drawParty(), '.rpg-battle-use').click();
        await settle();
        ctx.chat.pop();
        ctx.chat.push({ ...reply('Ren waits again.'), send_date: 'second' });
        hooks.update();
        await settle();
        ctx.chat.push(userMessage('On.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.story_suite_tail_3_rpg_battle.value, /\[Item\]/);
    } finally {
        ctx.setExtensionPrompt = before;
    }
});

test('buying: each kind of trader at the place has stock, nobody need be present, and no stock is ever put in the prompt (0.5.38)', async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value, _position, depth) => { prompts[key] = { value, depth }; };
    try {
        const world = `<World_State>\n**🌤 Loc:** Bluewatch Village | Square\n\n**👥 NPCs Present:**\n**Ren:**\n* *Mood:* curious\n\n---\n</World_State>`;
        openChat('shop-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('To the market.'), reply(`A stall.\n${world}\n<Inventory>\nCoin Pouch | 1 | 9 gold\n</Inventory>`)]);
        hooks.update();
        await settle();
        let pane = drawTrade();
        // Your own party is no trader.
        assert.ok(!findAll(pane, '.rpg-trade-person option').some(node => /^Ren/.test(node.textContent)));
        pickTrader(pane, 'kind:apothecary');
        const buy = findAll(pane, '.rpg-trade-buy');
        assert.ok(buy.length >= 4, 'the apothecary has stock');
        buy[0].click();
        await settle();
        assert.match(ctx.chatMetadata.rpgBattle.trade.handoff, /bought .+ from the apothecary for/);
        pane = drawTrade();
        pickTrader(pane, 'kind:apothecary');
        assert.equal(findAll(pane, '.rpg-trade-buy').length, buy.length - 1, 'bought: gone from the stock');
        ctx.chat.push(userMessage('What else?'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.match(prompts.story_suite_tail_3_rpg_battle.value, /bought .+ from the apothecary/);
        assert.ok(!Object.keys(prompts).some(key => /shop/.test(key)), 'no stock in the prompt');
    } finally {
        ctx.setExtensionPrompt = before;
    }
});

test('a companion\'s items: their Inventory section is their gear and potions in a fight; Give moves a row there; their old Equipped line is read until then (0.5.40)', async () => {
    const lyraOld = `${LYRA}\nEquipped: Willow Wand (common) · MATK +3`;
    const inventory = '<Inventory>\nCoin Pouch | 1 | 2 silver\n[Equipment > Accessories]\nBone Charm | 1 | common · LUK +1\n</Inventory>';
    openChat('items-chat', [reply(`<Party>\n${REN}\n\n${lyraOld}\n</Party>\n${inventory}`)]);
    hooks.update();
    await settle();
    // No section yet: the Equipped line is her gear.
    let pane = drawParty();
    assert.ok(findAll(pane, '.rpg-battle-record-name').some(node => node.textContent === 'Willow Wand'));
    // Give: the charm goes into her section, her old line's wand with it, and the line is not written again.
    find(pane, '.rpg-battle-give-open').click();
    pane = drawParty();
    find(pane, '.rpg-battle-give-confirm').click();
    await settle();
    const text = ctx.chat[0].mes;
    assert.match(text, /\[Lyra\]\nWillow Wand \| 1 \| equipped · common · MATK \+3\nBone Charm \| 1 \| equipped · common · LUK \+1/);
    assert.doesNotMatch(text, /\[Equipment > Accessories\]\nBone Charm/);
    assert.doesNotMatch(text, /Equipped: Willow Wand/);
    pane = drawParty();
    assert.ok(findAll(pane, '.rpg-battle-record-name').some(node => node.textContent === 'Bone Charm'), 'her card shows her section\'s gear');
    // A fight: her gear and potions are her section's.
    ctx.chat[0].mes = ctx.chat[0].mes.replace('</Inventory>', '[Lyra > Herbs]\nMinor Healing Draught | 2 | heal 20\n</Inventory>');
    ctx.chat.push(userMessage('Onward.'), reply('Wolves!\n<Encounter>2 wolf (weak)</Encounter>'));
    hooks.update();
    await settle();
    pane = drawTab('rpg-battle');
    find(pane, '.rpg-battle-encounter-fight').click();
    pane = drawTab('rpg-battle');
    find(pane, '.rpg-battle-begin').click();
    await settle();
    const her = ctx.chatMetadata.rpgBattle.fight.setup.party.find(unit => unit.name === 'Lyra');
    assert.deepEqual(her.items.map(item => item.name), ['Minor Healing Draught']);
    const ren = ctx.chatMetadata.rpgBattle.fight.setup.party.find(unit => unit.memberId === 'pc');
    assert.deepEqual(ren.items.map(item => item.name), [], 'her potions are not yours');
});

test('laid out for prompt caching: the instruction after the main prompt, the rest at the very end, old keys emptied (0.5.41)', async () => withClock(async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
    ctx.setExtensionPrompt = (key, value, position, depth) => { prompts[key] = { value, position, depth }; };
    try {
        openChat('cache-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('On.')]);
        hooks.update();
        await settle();
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        const first = prompts.story_suite_static_rpg_battle;
        assert.equal(first.position, 0, 'IN_PROMPT: right after the main prompt');
        assert.match(first.value, /<Encounter>/);
        assert.equal(prompts.story_suite_tail_3_rpg_battle.position, 1);
        assert.equal(prompts.story_suite_tail_3_rpg_battle.depth, 0);
        for (const key of ['rpg_battle', 'rpg_battle_rules', 'rpg_battle_trade', 'rpg_battle_item']) assert.equal(prompts[key]?.value, '', `${key} emptied`);
        // The next reply, with the story moved on: the instruction is the same text.
        ctx.chat.push(sent('The road bends.', 'd2'));
        ctx.chat.push(userMessage('Onward.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.equal(prompts.story_suite_static_rpg_battle.value, first.value);
        // A quiet generation (a summary) gets neither.
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'quiet');
        assert.equal(prompts.story_suite_static_rpg_battle.value, '');
        assert.equal(prompts.story_suite_tail_3_rpg_battle.value, '');
    } finally {
        ctx.setExtensionPrompt = before;
    }
}));

const inventoryAt = index => globalThis.StoryBlock.blockInText(ctx.chat[index].mes, 'Inventory').text;

test('each trade waiting to be told can be undone, exactly; not once something else changed the Inventory (0.5.43)', async () => {
    const world = '<World_State>\n**📅 Time:** day | **🌤 Loc:** Bluewatch Village | Guild Post | [1, 2] | **🌡 Wx:** grey\n\n**👥 NPCs Present:**\n**Elke:**\n* *Mood:* tired\n\n---\n</World_State>';
    const inventory = '<Inventory>\nCoin Pouch | 1 | 2 silver\n[Loot]\nRat Tail | 5 | material\n</Inventory>';
    openChat('undo-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('To the guild.'), reply(`Elke waits.\n${world}\n${inventory}`)]);
    hooks.update();
    await settle();
    const start = inventoryAt(2);
    let pane = drawTrade();
    pickTrader(pane, 'person:Elke');
    find(pane, '.rpg-trade-sell').click();
    await settle();
    pane = drawTrade();
    pickTrader(pane, 'person:Elke');
    find(pane, '.rpg-trade-sell').click();
    await settle();
    const twice = inventoryAt(2);
    assert.match(twice, /Rat Tail \| 3 \| material/);
    pane = drawTrade();
    assert.equal(findAll(pane, '.rpg-trade-told li').length, 2);
    assert.equal(findAll(pane, '.rpg-trade-undo').length, 2);
    // The first taken back: the second still made, from the first Inventory.
    findAll(pane, '.rpg-trade-undo')[0].click();
    await settle();
    assert.match(inventoryAt(2), /Rat Tail \| 4 \| material/);
    assert.equal(ctx.chatMetadata.rpgBattle.trade.entries.length, 1);
    // The last taken back: the Inventory exactly as it was, nothing to tell.
    findAll(drawTrade(), '.rpg-trade-undo')[0].click();
    await settle();
    assert.equal(inventoryAt(2), start);
    assert.equal(ctx.chatMetadata.rpgBattle.trade, null);
    // Something else changed the Inventory after a trade: no Undo offered.
    pane = drawTrade();
    pickTrader(pane, 'person:Elke');
    find(pane, '.rpg-trade-sell').click();
    await settle();
    ctx.chat[2].mes = ctx.chat[2].mes.replace('Rat Tail | 4 | material', 'Rat Tail | 4 | material\nTorch | 1');
    hooks.update();
    await settle();
    assert.equal(findAll(drawTrade(), '.rpg-trade-undo').length, 0);
});
