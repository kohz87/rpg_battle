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
    // What one is worth to Ren (level 4, needs 100), as the result counts it: a tenth, 10, × 2 per
    // 4 levels above: a bandit (level 3: ×2^−¼) and the captain (level 6: ×2^½, boss ×3).
    assert.deepEqual(findAll(pane, '.rpg-battle-enemy-xp').map(node => node.textContent), ['~8 XP each', '~42 XP']);
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
        assert.match(prompts.rpg_battle, /7 copper/);
        // Back to before the fight: everything from the fight's reply on is deleted and the turn sent again.
        ctx.chat.splice(2);
        hooks.update();
        await settle();
        ctx.chat.push(userMessage('I hunt it.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.equal(prompts.rpg_battle, '', 'no stale result');
        assert.match(prompts.rpg_battle_rules, /<Encounter>/, 'the story instruction is back, so a new fight can be offered');
        assert.equal(ctx.chatMetadata.rpgBattle.pending, null);
        // The same from a chat saved before 0.4.3: no origin, but foughtAt says where the fight started.
        openChat('legacy-chat', [hello(), userMessage('I hunt it.'), offer, userMessage('Onward.')], {
            pending: { handoff, fightId: 'f1', attachedTo: null },
            foughtAt: { index: 2, text: 'x' },
        });
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.match(prompts.rpg_battle, /7 copper/, 'still waiting while its reply is there');
        ctx.chat.splice(1);
        ctx.chat.push(userMessage('I hunt it.'));
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.equal(prompts.rpg_battle, '');
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

test('a plan in three stages: Fight?, the stages read-only, Start, each stage fought, Go on between, one result and one hand-off', async () => withClock(async () => {
    const prompts = {};
    const before = ctx.setExtensionPrompt;
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
        // During the plan no story instruction is asked for.
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.equal(prompts.rpg_battle_rules, '');
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
        assert.equal(prompts.rpg_battle, handoff);
        find(pane, '.rpg-battle-done').click();
        ctx.chat.push(reply('The tower falls silent.'));
        await hooks.reply({ messageIndex: 4 });
        await settle();
        assert.equal(hooks.tabs['rpg-battle'].isAvailable(), false, 'the Battle tab goes with the battle');
    } finally {
        ctx.setExtensionPrompt = before;
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
        assert.equal(prompts.rpg_battle, '', 'no result to narrate');
        assert.match(prompts.rpg_battle_rules, /<Encounter>/, 'the story instruction is back');
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

test('a fight rolled back with its reply leaves no trace: the identical reply sent again offers it again, and Not now goes back too', async () => withClock(async () => {
    const offerText = 'A rat bolts from the sacks.\n<Encounter>giant rat (trivial)</Encounter>\n<XP>minor: found the cellar</XP>';
    openChat('resend-chat', [reply(`<Party>\n${REN}\n</Party>`), userMessage('Down to the cellar.'), sent(offerText, 'd2')]);
    hooks.update();
    await settle();
    assert.ok(partyOffers().some(text => /found the cellar/.test(text)), 'the reply\'s XP is on offer');
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
    assert.ok(partyOffers().some(text => /found the cellar/.test(text)), 'the new reply\'s XP is offered: no fight started since it');
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
    assert.ok(partyOffers().some(text => /weir pack/.test(text)), 'a new reply at that place is no narration');
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
        assert.match(prompts.rpg_battle_rules, /<Encounter>/);
        assert.match(prompts.rpg_battle_rules, /Foes this story has met \(the same creature keeps its name\): Feral Ditch-Dog, Scrub Quill-Dog\.$/);
        openChat('no-foes-chat', [reply(`Hello.\n<Party>\n${REN}\n</Party>`), userMessage('On.')], {});
        await globalThis.rpgBattleInterceptor(ctx.chat, 0, null, 'normal');
        assert.doesNotMatch(prompts.rpg_battle_rules, /Foes this story has met/);
    } finally {
        ctx.setExtensionPrompt = before;
    }
});
