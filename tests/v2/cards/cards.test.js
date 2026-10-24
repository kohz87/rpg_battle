// The cards under replies and the active tabs (UI 8f): the start card (creation, until a character exists or the reader
// skips it: creation.skipStart), the battle card (board, while a fight is on), and the Fight screen's `active` (its tab
// shows while there is something to act on). Each answer is checked against Story Block's own card reader
// (reply-cards.js, vendored) and the module's definition checks (registry.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { definitionProblems } from '../../vendor/story-block/src/v2/registry.js';
import { normalizeCard } from '../../vendor/story-block/src/v2/reply-cards.js';
import { createModule } from '../../../src/v2/module.js';
import { CREATE_SCREEN_ID, createScreen, part as creationPart, validateCreation } from '../../../src/v2/creation/index.js';
import { START_CARD_ID, START_SCREEN_ID, startCardFor } from '../../../src/v2/creation/start-card.js';
import { part as boardPart } from '../../../src/v2/board/index.js';
import { BATTLE_CARD_ID, FIGHT_SCREEN, battleCardFor, fightTitle } from '../../../src/v2/board/cards.js';
import { fightActive, fightScreen } from '../../../src/v2/board/screen.js';
import { makeHost } from '../creation/helpers/fake-host.js';
import { liveFight } from '../board/helpers.js';
import { actor } from '../combat/helpers/fake-ctx.js';

const elf = { name: 'Ren', race: 'rpg-battle/elf', talents: ['rpg-battle/keen-eyes'], points: { STR: 4, DEX: 5, AGI: 0, VIT: 0, INT: 0, LUK: 0, CHA: 0 } };
const fake = (values = {}) => ({ query: name => (name in values ? values[name] : null) });

test('start card: until a character exists; Create opens the wizard (the Start step fills the persona\'s draft when it opens), Skip is a command', () => {
    const host = makeHost();
    const card = startCardFor(host.state);
    assert.equal(card.title, 'Make your character');
    assert.deepEqual(card.actions.map(action => [action.id, action.label, action.open ?? null, action.command ?? null]), [
        ['create', 'Create', START_SCREEN_ID, null],
        ['skip', 'Skip', null, 'creation.skipStart'],
    ]);
    assert.equal(START_SCREEN_ID, CREATE_SCREEN_ID);
    assert.deepEqual(createScreen.mounts, ['dialog'], 'the wizard is dialog-only: Story Block opens its dialog');
    const read = normalizeCard(card);
    assert.ok(read, 'Story Block reads it as a card');
    assert.equal(read.actions.length, 2);
    assert.equal(read.actions[0].open, CREATE_SCREEN_ID);
    assert.deepEqual(read.actions[0].payload, {}, 'no persona in the payload: it is read when the wizard opens, not when the card is drawn');
    assert.equal(read.actions[1].command, 'creation.skipStart');
});

test('start card: asked on the head state, the greeting of a greeting-only chat or the newest reply of an existing chat; gone once a character exists', () => {
    const host = makeHost();
    const greeting = creationPart.cards.start.for(host.state, { is_user: false, mes: 'Welcome.' }, { index: 0, head: true });
    assert.equal(greeting?.title, 'Make your character', 'the greeting is the head of a greeting-only chat');
    // An existing chat with no character: the head is a later reply, not the greeting.
    const reply = creationPart.cards.start.for(host.state, { is_user: false, mes: 'The ferry bell rings.' }, { index: 6, head: true });
    assert.equal(reply?.title, 'Make your character', 'the newest reply carries the card');
    assert.deepEqual(reply, greeting, 'the same card wherever the head is');
    assert.ok(normalizeCard(reply).actions.every(action => action.open || action.command), 'with actions Story Block can run');
    assert.equal(host.command('creation.finish', elf).ok, true);
    assert.equal(startCardFor(host.state), null);
    assert.equal(creationPart.cards.start.for(host.state, null, { index: 6, head: true }), null);
});

test('creation.skipStart: sets the card aside (a game-state flag); refused once a character exists', () => {
    const host = makeHost();
    const out = host.command('creation.skipStart', {});
    assert.equal(out.ok, true, out.message);
    assert.equal(host.state.domains.creation.skipped, true);
    assert.equal(out.receipt.summary, 'Skipped making a character for now.');
    assert.equal(startCardFor(host.state), null, 'the card stays away');
    assert.equal(host.command('creation.finish', elf).ok, true, 'the wizard still makes the character');
    const refused = host.command('creation.skipStart', {});
    assert.equal(refused.ok, false);
    assert.match(refused.message, /already have a character/);
});

test('creation: the skipped flag is a boolean field of the creation slice, and nothing else is', () => {
    assert.deepEqual(validateCreation({ rolled: [], skipped: true }), []);
    assert.deepEqual(validateCreation({ rolled: [], skipped: false }), []);
    assert.equal(validateCreation({ rolled: [], skipped: 'yes' }).length, 1);
    assert.equal(validateCreation({ rolled: [], other: 1 }).length, 1);
});

test('battle card: while a fight is on, with the foes, the round, Fight (the Fight screen), Flee and Later', () => {
    const world = liveFight('3 Cellar Rats');
    const state = world.state;
    const card = battleCardFor(state, null, { query: (name, args) => world.query(name, args, state) });
    assert.ok(card, 'a fight on gives a card');
    assert.equal(card.tone, 'bad');
    assert.match(card.title, /^Fight: /);
    assert.ok(card.title.length <= 60);
    assert.match(card.text, /Round \d+/);
    assert.equal(card.later, true);
    assert.equal(card.actions[0].id, 'fight');
    assert.equal(card.actions[0].open, FIGHT_SCREEN);
    assert.equal(card.actions[0].primary, true);
    const session = world.query('combat.session', {}, state);
    if (session.actions.canFlee === true) {
        const flee = card.actions.find(action => action.id === 'flee');
        assert.deepEqual([flee.command, flee.payload], ['combat.flee', { session: session.id }]);
    } else {
        assert.equal(card.actions.some(action => action.id === 'flee'), false, 'no Flee when the party cannot get away now');
    }
    assert.ok(card.rows.length >= 1 && card.rows.length <= 4);
    assert.ok(normalizeCard(card), 'Story Block reads it as a card');
    assert.equal(battleCardFor(state, null, fake({ 'combat.session': null })), null, 'no fight, no card');
});

test('battle card: a fight that is over is a result card, no session is no card; a long foe list is cut to the title limit', () => {
    assert.equal(battleCardFor({}, null, fake({ 'combat.session': null })), null, 'settled: the session is gone, so is the card');
    assert.equal(battleCardFor({}, null, fake({ 'combat.session': { status: 'settled', combatants: [] } })), null);
    const kinds = battleCardFor({}, null, fake({ 'combat.session': { id: 's2', status: 'active', round: 1, combatants: [
        { side: 'enemy', name: 'Cellar Rat A' }, { side: 'enemy', name: 'Cellar Rat B' }, { side: 'enemy', name: 'Cellar Rat C' }, { side: 'enemy', name: 'Bat' },
    ], actions: { actor: null } } }));
    assert.equal(kinds.title, 'Fight: Cellar Rat ×3, Bat', 'the foes of one kind as one name');
    const long = 'A very long monster name that goes on and on and on'.repeat(3);
    const card = battleCardFor({}, null, fake({ 'combat.session': { id: 's1', status: 'active', round: 2, combatants: [{ side: 'enemy', name: long, hp: { cur: 3, max: 9 } }], actions: { actor: 'ac_1', canFlee: true }, turn: { name: 'Ren' } } }));
    assert.ok(card.title.length <= 60, card.title);
    assert.equal(card.rows[0].text, `${long} · HP 3/9`);
    assert.equal(card.rows.at(-1).tag, 'Your turn', 'the reader\'s move is a row');
    assert.equal(card.actions.at(-1).command, 'combat.flee');
    assert.ok(normalizeCard(card));
});

test('battle card title: cut at a word boundary, never inside a surrogate pair, "+N more" for the kinds left out', () => {
    const wolves = ['Grey Wolf', 'Dire Wolf', 'Frost Wolf', 'Cave Bear', 'Giant Spider', 'Skeleton Warrior'];
    const title = fightTitle(wolves);
    assert.equal(title, 'Fight: Grey Wolf, Dire Wolf, Frost Wolf, Cave Bear +2 more');
    assert.ok(Array.from(title).length <= 60);
    assert.equal(fightTitle(wolves.slice(0, 3)), 'Fight: Grey Wolf, Dire Wolf, Frost Wolf', 'all fit: nothing is dropped');
    const one = fightTitle(['Goblin Chieftain of the Broken Tooth Clan and Warlord of the Marsh', 'Bat']);
    assert.match(one, /^Fight: Goblin Chieftain of the Broken Tooth( Clan)?\.\.\. \+1 more$/, one);
    assert.ok(Array.from(one).length <= 60, one);
    // Emoji are two UTF-16 units: a cut between them leaves a lone surrogate.
    for (const emoji of ['😀', '👨‍👩‍👧']) {
        const cut = fightTitle([emoji.repeat(40)]);
        assert.ok(Array.from(cut).length <= 60, cut);
        assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(cut), false, 'no lone surrogate');
    }
    const through = battleCardFor({}, null, fake({ 'combat.session': { id: 's3', status: 'active', round: 1, actions: { actor: null }, combatants: wolves.map(name => ({ side: 'enemy', name })) } }));
    assert.equal(through.title, title, 'the card uses it');
    assert.ok(normalizeCard(through).title.endsWith('+2 more'), 'and Story Block keeps all of it');
});

test('battle card title: a lone foe whose name ends in a letter keeps it; the letter goes only where the same name repeats', () => {
    const title = (...names) => battleCardFor({}, null, fake({ 'combat.session': { id: 's4', status: 'active', round: 1, actions: { actor: null }, combatants: names.map(name => ({ side: 'enemy', name })) } })).title;
    assert.equal(title('Agent K'), 'Fight: Agent K');
    assert.equal(title('Agent K', 'Cellar Rat A', 'Cellar Rat B'), 'Fight: Agent K, Cellar Rat ×2');
    assert.equal(title('Agent K', 'Agent L'), 'Fight: Agent ×2', 'two of a kind');
    assert.equal(title('Agent K', 'Agent'), 'Fight: Agent K, Agent', 'a lettered name beside a plain one is its own kind');
    assert.equal(title('K'), 'Fight: K');
});

test('battle card: the card is asked once, on the head reply\'s state, and answers there with its actions (Story Block\'s head rule)', () => {
    const world = liveFight('3 Cellar Rats');
    // Story Block asks once, about the head reply (ctx.index is the head, ctx.head true), also after a new reply was written.
    const query = (name, args) => world.query(name, args, world.state);
    const asked = battleCardFor(world.state, { is_user: false }, { query, index: 4, head: true });
    assert.equal(asked.title.startsWith('Fight: '), true);
    assert.equal(asked.actions[0].open, FIGHT_SCREEN);
    const read = normalizeCard(asked);
    assert.ok(read.actions.length >= 1 && read.actions.every(action => action.open || action.command));
    // The same answer without a ctx.index/head (older hosts): nothing in the card reads them.
    assert.deepEqual(battleCardFor(world.state, null, { query }), asked);
});

// Plays `commands` on a world until the fight is no longer on; the card and the tab as the head state gives them.
function ended(world, step) {
    for (let n = 0; n < 300 && world.query('combat.session', {}, world.state)?.status === 'active'; n += 1) step();
    return world.query('combat.session', {}, world.state);
}
const headCard = world => battleCardFor(world.state, null, { query: (name, args) => world.query(name, args, world.state), index: 3, head: true });
const headTab = world => fightActive(world.state, { query: (name, args) => world.query(name, args, world.state) });

test('a fight won and not yet settled: the Fight tab stays on with its dot and the card says "Fight won" with Finish; settled, both go', () => {
    const world = liveFight('3 Cellar Rats', { tier: 'weak' });
    assert.equal(headCard(world).title.startsWith('Fight: '), true, 'while it is on, the battle card');
    const over = ended(world, () => assert.equal(world.run('combat.act', { action: { type: 'auto' } }).ok, true));
    assert.equal(over.status, 'won');
    const card = headCard(world);
    assert.equal(card.title, 'Fight won');
    assert.equal(card.tone, 'good');
    assert.equal(card.later, false, 'no Later: the reader must see it');
    assert.deepEqual(card.actions.map(action => [action.id, action.label, action.primary === true, action.open ?? null, action.command ?? null]), [['finish', 'Finish', true, FIGHT_SCREEN, null]]);
    assert.equal(card.rows, undefined);
    assert.ok(normalizeCard(card), 'Story Block reads it');
    assert.equal(normalizeCard(card).actions[0].open, 'rpg-battle/fight');
    assert.deepEqual(headTab(world), { on: true, badge: 'alert' }, 'the tab stays, with its dot');

    // Finish (the board\'s button runs combat.end) settles it: no card, no tab.
    assert.equal(world.run('combat.end', { session: over.id }).ok, true);
    assert.equal(headCard(world), null);
    assert.deepEqual(headTab(world), { on: false });
});

test('a fight lost, then one fled from the card\'s Flee: each is a result card until it is settled', () => {
    const weak = actor(1, { level: 1, hp: { cur: 6, max: 6 }, stats: { STR: 3, VIT: 3, AGI: 3, DEX: 3, INT: 3, LUK: 3, CHA: 3 } });
    const lostWorld = liveFight('2 Cave Bears', { tier: 'deadly' }, { actors: [weak] });
    const gone = ended(lostWorld, () => lostWorld.run('combat.act', { action: { type: 'defend' } }));
    assert.equal(gone.status, 'lost');
    assert.equal(headCard(lostWorld).title, 'Fight lost');
    assert.equal(headCard(lostWorld).tone, 'bad');
    assert.equal(headTab(lostWorld).badge, 'alert');
    assert.equal(lostWorld.run('combat.end', { session: gone.id }).ok, true);
    assert.equal(headCard(lostWorld), null);
    assert.equal(headTab(lostWorld).on, false);

    // Flee, as the battle card\'s own button sends it, until the party gets away.
    const world = liveFight('3 Cellar Rats', { tier: 'weak' });
    for (let n = 0; n < 50; n += 1) {
        const card = headCard(world);
        const flee = card.actions?.find(action => action.id === 'flee');
        if (!flee) break;
        assert.equal(world.run(flee.command, flee.payload).ok, true);
    }
    const out = world.query('combat.session', {}, world.state);
    assert.equal(out.status, 'fled');
    const fled = headCard(world);
    assert.equal(fled.title, 'Fight fled');
    assert.equal(fled.actions[0].label, 'Finish');
    assert.deepEqual(headTab(world), { on: true, badge: 'alert' });
    assert.equal(world.run('combat.end', { session: out.id }).ok, true);
    assert.equal(headCard(world), null);
    assert.equal(headTab(world).on, false);
});

test('fight screen: active is on while a fight is on or an offer waits, and the red dot marks a move or an offer', () => {
    assert.equal(fightScreen.active, fightActive);
    assert.deepEqual(fightActive({}, fake({ 'combat.session': null, 'combat.offers': [] })), { on: false });
    for (const status of ['won', 'lost', 'fled']) {
        assert.deepEqual(fightActive({}, fake({ 'combat.session': { status }, 'combat.offers': [] })), { on: true, badge: 'alert' }, `${status} and not settled: on, with the dot`);
    }
    assert.deepEqual(fightActive({}, fake({ 'combat.session': null, 'combat.offers': [{ id: 'o1' }] })), { on: true, badge: 'alert' });
    assert.deepEqual(fightActive({}, fake({ 'combat.session': { status: 'active', actions: { actor: 'ac_1' } }, 'combat.offers': [] })), { on: true, badge: 'alert' });
    const waiting = fightActive({}, fake({ 'combat.session': { status: 'active', actions: { actor: null } }, 'combat.offers': [] }));
    assert.deepEqual(waiting, { on: true }, 'an enemy move: on, no dot');
    assert.equal('badge' in waiting, false);
    const world = liveFight('2 Cellar Rats');
    assert.equal(fightActive(world.state, { query: (name, args) => world.query(name, args, world.state) }).on, true, 'a live fight is on');
});

test('the parts hold the cards under their ids, and the module definition checks them', () => {
    assert.equal(START_CARD_ID, 'start');
    assert.equal(BATTLE_CARD_ID, 'battle');
    assert.equal(typeof creationPart.cards[START_CARD_ID].for, 'function');
    assert.equal(typeof boardPart.cards[BATTLE_CARD_ID].for, 'function');
    const module = createModule({ settings: () => ({}) });
    assert.deepEqual(Object.keys(module.cards).sort(), ['battle', 'start']);
    assert.deepEqual(definitionProblems(module), []);
});
