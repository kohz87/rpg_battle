// The cards under replies and the active tabs (UI 8f): the start card (creation, until a character exists or the reader
// skips it: creation.skipStart), the battle card (board, while a fight is on), and the Fight screen's `active` (its tab
// shows while there is something to act on). Each answer is checked against Story Block's own card reader
// (reply-cards.js, vendored) and the module's definition checks (registry.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { definitionProblems } from '../../vendor/story-block/src/v2/registry.js';
import { normalizeCard } from '../../vendor/story-block/src/v2/reply-cards.js';
import { createModule } from '../../../src/v2/module.js';
import { part as creationPart, validateCreation } from '../../../src/v2/creation/index.js';
import { START_CARD_ID, START_SCREEN_ID, startCardFor } from '../../../src/v2/creation/start-card.js';
import { part as boardPart } from '../../../src/v2/board/index.js';
import { BATTLE_CARD_ID, FIGHT_SCREEN, battleCardFor } from '../../../src/v2/board/cards.js';
import { fightActive, fightScreen } from '../../../src/v2/board/screen.js';
import { makeHost } from '../creation/helpers/fake-host.js';
import { liveFight } from '../board/helpers.js';

const elf = { name: 'Ren', race: 'rpg-battle/elf', talents: ['rpg-battle/keen-eyes'], points: { STR: 4, DEX: 5, AGI: 0, VIT: 0, INT: 0, LUK: 0, CHA: 0 } };
const fake = (values = {}) => ({ query: name => (name in values ? values[name] : null) });

test('start card: under the greeting until a character exists; Create opens the Party screen, Skip is a command', () => {
    const host = makeHost();
    const card = startCardFor(host.state);
    assert.equal(card.title, 'Make your character');
    assert.deepEqual(card.actions.map(action => [action.id, action.label, action.open ?? null, action.command ?? null]), [
        ['create', 'Create', START_SCREEN_ID, null],
        ['skip', 'Skip', null, 'creation.skipStart'],
    ]);
    assert.equal(START_SCREEN_ID, 'rpg-battle/party', 'the Party screen has the wizard\'s button for an empty party');
    const read = normalizeCard(card);
    assert.ok(read, 'Story Block reads it as a card');
    assert.equal(read.actions.length, 2);
    assert.equal(read.actions[1].command, 'creation.skipStart');
});

test('start card: never on the greeting (message 0), under the first reply; gone once a character exists', () => {
    const host = makeHost();
    assert.equal(creationPart.cards.start.for(host.state, null, { index: 0 }), null, 'Story Block draws no card under the greeting');
    assert.equal(creationPart.cards.start.for(host.state, null, { index: 2 })?.title, 'Make your character');
    assert.equal(host.command('creation.finish', elf).ok, true);
    assert.equal(startCardFor(host.state), null);
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

test('battle card: gone when the fight is settled; a long foe list is cut to the title limit', () => {
    assert.equal(battleCardFor({}, null, fake({ 'combat.session': { status: 'won', combatants: [] } })), null);
    assert.equal(battleCardFor({}, null, fake({ 'combat.session': { status: 'lost', combatants: [] } })), null);
    assert.equal(battleCardFor({}, null, fake({ 'combat.session': { status: 'fled', combatants: [] } })), null);
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

test('fight screen: active is on while a fight is on or an offer waits, and the red dot marks a move or an offer', () => {
    assert.equal(fightScreen.active, fightActive);
    assert.deepEqual(fightActive({}, fake({ 'combat.session': null, 'combat.offers': [] })), { on: false });
    assert.deepEqual(fightActive({}, fake({ 'combat.session': { status: 'won' }, 'combat.offers': [] })), { on: false }, 'settled: off');
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
