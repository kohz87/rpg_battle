// Track C fixtures C08 (roster) and C09 (hands), and the Roster page: PC plus two active, reserve, temporary units, eight
// lean slot tiles (tap to arm, tap again to unequip), what the bag would do from the read-only equip plan, and collapsible
// companions. Every button's payload is asserted exactly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rosterScreen } from '../../../../src/v2/screens/rules/screens.js';
import { rosterView, slotList } from '../../../../src/v2/screens/rules/roster.js';
import { ARM_MS } from '../../../../src/v2/screens/equipment.js';
import {
    BRAM, CASS, DAGGER, DOV, GREAT, LYRA, MISSING, PC, SHIELD, SPARK, SWORD, TITAN, WOLF, answers, c08, c09, companionOf, partyOf, sheetOf,
} from './fixtures.js';
import { makeState } from '../helpers/state.js';
import { all, drawOver, settle, skip, text, viewOf, widgetsIn } from './helpers.js';

const drawn = (table, options) => drawOver(rosterScreen, table, options);
const tilesIn = card => all(card, '.rpg-eq-tile');
const commandButtons = card => all(card, '.rpg-cb-go');
const labelOf = button => text(button);

// ---- C08 roster -----------------------------------------------------------------------------------------------------

test('C08 roster: PC plus two active, two reserves, two temporary units; temporary stay outside the limit', { skip }, () => {
    const { answers: table, party } = c08();
    const view = viewOf(rosterView, table);
    assert.equal(view.state, 'ready');
    assert.deepEqual(view.active.map(member => member.id), [PC, LYRA, BRAM]);
    assert.deepEqual(view.reserve.map(member => member.id), [CASS, DOV]);
    assert.deepEqual(view.temporary.map(unit => unit.id), [WOLF, SPARK]);
    assert.equal(view.limit, 3);
    assert.equal(view.activeText, '3 / 3 active', 'the two temporary units are not counted');
    assert.equal(view.full, true);
    assert.equal(party.temporary.length, 2);
    assert.match(view.temporaryNote, /outside the party limit, carry nothing and cannot save you from a wipe/);
    assert.deepEqual(view.active.map(member => member.open), [true, false, false], 'your card opens, companions fold');
});

test('C08 roster: moving someone sends party.setActive with the ids after the change; a full party disables Make active', { skip }, async () => {
    const { answers: table } = c08();
    const view = viewOf(rosterView, table);
    const [pc, lyra, bram] = view.active;
    assert.equal(pc.canRest, false, 'you do not rest yourself');
    assert.equal(lyra.canRest, true);
    assert.deepEqual(lyra.restButton, { command: 'party.setActive', payload: { actors: [PC, BRAM] }, label: 'Rest in reserve', tone: 'quiet', disabled: false, title: '' });
    assert.deepEqual(bram.restButton.payload, { actors: [PC, LYRA] });
    const [cass] = view.reserve;
    assert.equal(cass.canActivate, true);
    assert.equal(cass.activateButton.disabled, true, 'full');
    assert.match(cass.activateButton.title, /active party is full/);
    assert.deepEqual(cass.activateButton.payload, { actors: [PC, LYRA, BRAM, CASS] }, 'the payload is still what it would be; the rules refuse more than the limit');

    const { drawn: d } = drawn(table);
    assert.deepEqual(d.warnings, []);
    assert.equal(all(d.el, 'article.member').length, 5);
    assert.equal(all(d.el, 'section.group.active article.member').length, 3);
    assert.equal(all(d.el, 'section.group.reserve article.member').length, 2);
    assert.equal(all(d.el, 'section.group.temporary .unit').length, 2);
    // Companions collapse; yours is open.
    assert.deepEqual(all(d.el, 'article.member').map(card => card.getAttribute('data-open')), ['true', 'false', 'false', 'false', 'false']);
    assert.equal(widgetsIn(d.el, 'rpg-battle.member-toggle').length, 5);
    // Rest Lyra.
    const restButtons = all(d.el, '.rpg-cb-go').filter(button => labelOf(button) === 'Rest in reserve');
    assert.equal(restButtons.length, 2);
    restButtons[0].dispatch('click');
    await settle();
    assert.deepEqual(d.commands, [{ type: 'party.setActive', payload: { actors: [PC, BRAM] } }]);
    // A disabled Make active sends nothing.
    const makeButtons = all(d.el, '.rpg-cb-go').filter(button => labelOf(button) === 'Make active');
    assert.equal(makeButtons.length, 2);
    assert.equal(makeButtons[0].disabled, true);
    makeButtons[0].dispatch('click');
    await settle();
    assert.equal(d.commands.length, 1);
});

test('C08 roster: with room, Make active sends the new list; a downed reserve member cannot be made active; Dismiss ends a summon', { skip }, async () => {
    const pc = sheetOf();
    const lyra = companionOf(LYRA, 'Lyra');
    const cass = companionOf(CASS, 'Cass');
    const dov = companionOf(DOV, 'Dov', { life: 'downed' });
    const table = answers({ 'rules.party': partyOf({ active: [pc, lyra], reserve: [cass, dov], temporary: c08().party.temporary }) });
    const view = viewOf(rosterView, table);
    assert.equal(view.full, false);
    assert.equal(view.reserve[0].activateButton.disabled, false);
    assert.equal(view.reserve[1].canActivate, false, 'downed');
    assert.equal(view.reserve[1].lifeText, 'Downed');
    const { drawn: d } = drawn(table);
    all(d.el, '.rpg-cb-go').find(button => labelOf(button) === 'Make active').dispatch('click');
    await settle();
    all(d.el, '.rpg-cb-go').filter(button => labelOf(button) === 'Dismiss')[0].dispatch('click');
    await settle();
    assert.deepEqual(d.commands, [
        { type: 'party.setActive', payload: { actors: [PC, LYRA, CASS] } },
        { type: 'summon.end', payload: { actor: WOLF, reason: 'dismissed' } },
    ]);
});

test('C08 roster: a refusal from the rules (a fight is on, too many) is said in the card, and the roster is not changed', { skip }, async () => {
    const { answers: table } = c08();
    table['rules.party'] = partyOf({ active: [sheetOf(), companionOf(LYRA, 'Lyra')], reserve: [companionOf(CASS, 'Cass')] });
    const { drawn: d } = drawn(table, { result: () => ({ ok: false, code: 'REFUSED', message: 'You cannot change the party during a fight.' }) });
    const button = all(d.el, '.rpg-cb-go').find(item => labelOf(item) === 'Make active');
    button.dispatch('click');
    await settle();
    assert.equal(text(all(d.el, '.rpg-cb-problem').find(node => text(node) !== '')), 'You cannot change the party during a fight.');
    assert.equal(all(d.el, 'section.group.active article.member').length, 2);
});

test('Roster: the rules not answering, or no character yet, are states; markup in names stays text', { skip }, () => {
    assert.equal(viewOf(rosterView, answers({ 'rules.party': MISSING })).state, 'unavailable');
    assert.equal(viewOf(rosterView, answers({ 'rules.party': partyOf({ active: [], pc: null }) })).state, 'no-character');
    const odd = companionOf(LYRA, 'Lyra <b>x</b>', { role: '<i>ranger</i>' });
    const { drawn: d } = drawn(answers({ 'rules.party': partyOf({ active: [sheetOf(), odd] }) }));
    assert.equal(all(d.el, 'b').filter(node => text(node) === 'x').length, 0);
    assert.equal(all(d.el, 'i').filter(node => !node.classList.contains('fa-solid')).length, 0);
    const labels = all(d.el, '.rpg-toggle').map(node => node.getAttribute('aria-label'));
    assert.ok(labels.includes('Show Lyra <b>x</b>'), 'the name travels as a prop, not as markup');
});

// ---- C09 hands ---------------------------------------------------------------------------------------------------------

test('C09 hands: a two-handed weapon blocks the off hand; the tile says by what, and the shield is refused in the query\'s own words', { skip }, () => {
    const fixture = c09('two-handed');
    const view = viewOf(rosterView, fixture.answers, {}, fixture.state);
    const [pc] = view.active;
    assert.deepEqual(pc.tiles.map(tile => tile.label), ['Main hand', 'Off hand', 'Head', 'Body', 'Legs', 'Feet', 'Accessory 1', 'Accessory 2'], 'the fixed eight, in order');
    assert.deepEqual(pc.tiles.map(tile => tile.key), ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2']);
    const [weapon, offhand] = pc.tiles;
    assert.equal(weapon.filled, true);
    assert.equal(weapon.stack, GREAT);
    assert.equal(weapon.name, 'Greatsword');
    assert.equal(offhand.filled, false);
    assert.equal(offhand.note, 'Blocked by Greatsword');
    assert.equal(pc.slotsKnown, true);

    const bag = Object.fromEntries(pc.bag.map(row => [row.stack, row]));
    assert.equal(bag[SHIELD].blocked, 'The Greatsword takes both hands, so there is no off hand.', 'an off hand beside a two-hander is refused, in the query\'s words');
    assert.equal(bag[SHIELD].default, null);
    assert.deepEqual(bag[SHIELD].options, []);
    // The dagger would take the main hand and put the greatsword away, said before it is pressed.
    assert.equal(bag[DAGGER].default.label, 'Equip to Main hand');
    assert.equal(bag[DAGGER].default.swapsText, 'Takes off Greatsword.');
    assert.deepEqual(bag[DAGGER].default.payload, { stack: DAGGER, to: PC });
    assert.deepEqual(bag[DAGGER].options, [], 'the off hand is not offered beside a two-hander');
});

test('C09 hands: gear never qualifies itself; the helm\'s refusal is the query\'s, and no Equip button exists for it', { skip }, () => {
    const fixture = c09('two-handed');
    const [pc] = viewOf(rosterView, fixture.answers, {}, fixture.state).active;
    const helm = pc.bag.find(row => row.stack === TITAN);
    assert.equal(helm.blocked, 'Needs STR 18. Astra has 15 (the helm\'s own bonus does not count).');
    assert.equal(helm.default, null);
    assert.deepEqual(helm.options, []);
    const { drawn: d } = drawn(fixture.answers, { state: fixture.state });
    const rowOf = name => all(d.el, '.bag-row').find(row => text(row.querySelector('.bag-name')) === name);
    assert.equal(rowOf('Titan Helm').querySelectorAll('.rpg-cb-go').length, 0);
    assert.equal(rowOf('Round Shield').querySelectorAll('.rpg-cb-go').length, 0);
    assert.match(text(rowOf('Titan Helm').querySelector('.refused')), /own bonus does not count/);
    assert.equal(rowOf('Dagger').querySelectorAll('.rpg-cb-go').length, 1);
});

test('C09 hands: with a one-handed weapon the off hand is a legal default, and dual wielding is an explicit targetSlot', { skip }, async () => {
    const fixture = c09('one-handed');
    const view = viewOf(rosterView, fixture.answers, {}, fixture.state);
    const [pc] = view.active;
    assert.equal(pc.tiles[1].note, '', 'nothing blocks the off hand');
    const dagger = pc.bag.find(row => row.stack === DAGGER);
    assert.deepEqual(dagger.default.payload, { stack: DAGGER, to: PC }, 'no targetSlot unless the reader picks one');
    assert.equal(dagger.default.label, 'Equip to Off hand');
    assert.equal(dagger.default.swapsText, '');
    assert.deepEqual(dagger.options.map(option => [option.slot, option.label, option.swapsText, option.payload]), [
        ['weapon', 'Put on Main hand', 'Takes off Sword.', { stack: DAGGER, to: PC, targetSlot: 'weapon' }]]);

    const { drawn: d } = drawn(fixture.answers, { state: fixture.state });
    const daggerRow = all(d.el, '.bag-row').find(row => text(row.querySelector('.bag-name')) === 'Dagger');
    const pressed = all(daggerRow, '.rpg-cb-go');
    assert.deepEqual(pressed.map(labelOf), ['Equip to Off hand', 'Put on Main hand']);
    pressed[1].dispatch('click');
    await settle();
    assert.deepEqual(d.commands, [{ type: 'item.equip', payload: { stack: DAGGER, to: PC, targetSlot: 'weapon' } }]);
    const shieldRow = all(d.el, '.bag-row').find(row => text(row.querySelector('.bag-name')) === 'Round Shield');
    all(shieldRow, '.rpg-cb-go')[0].dispatch('click');
    await settle();
    assert.deepEqual(d.commands[1], { type: 'item.equip', payload: { stack: SHIELD, to: PC } });
    assert.equal(d.commands.length, 2);
});

test('C09 hands: a stale page that sends an off hand beside a two-hander gets the refusal in words and nothing else', { skip }, async () => {
    const fixture = c09('one-handed');
    const { drawn: d } = drawn(fixture.answers, { state: fixture.state, result: () => ({ ok: false, code: 'REFUSED', message: 'The Greatsword takes both hands.' }) });
    const shieldRow = all(d.el, '.bag-row').find(row => text(row.querySelector('.bag-name')) === 'Round Shield');
    all(shieldRow, '.rpg-cb-go')[0].dispatch('click');
    await settle();
    assert.equal(text(shieldRow.querySelector('.rpg-cb-problem')), 'The Greatsword takes both hands.');
    assert.equal(d.commands.length, 1);
});

test('C09 hands: the slot tiles are lean; tap once to arm, tap again to unequip, and an empty or blocked tile is inert', { skip }, async () => {
    const fixture = c09('two-handed');
    const { drawn: d } = drawn(fixture.answers, { state: fixture.state });
    const grid = tilesIn(d.el);
    assert.equal(grid.length, 8);
    assert.deepEqual(grid.map(tile => tile.classList.contains('filled')), [true, false, false, false, false, false, false, false]);
    assert.equal(all(d.el, '.rpg-eq-tile.note').length, 1, 'only the blocked off hand carries a note');
    assert.equal(text(all(d.el, '.rpg-eq-tile.note .rpg-eq-name')[0]), 'Blocked by Greatsword');
    assert.match(text(d.el.querySelector('.rpg-eq-help')), /Tap a piece once to mark it, tap again to take it off\./);
    assert.ok(!/Inventory/.test(text(d.el.querySelector('.rpg-eq-help'))), 'this page equips from the list below');
    const weapon = grid[0];
    weapon.dispatch('click');
    assert.equal(weapon.getAttribute('aria-pressed'), 'true', 'armed');
    assert.deepEqual(d.commands, []);
    grid[1].dispatch('click');
    assert.deepEqual(d.commands, [], 'an empty tile is inert');
    weapon.dispatch('click');
    await settle();
    assert.deepEqual(d.commands, [{ type: 'item.unequip', payload: { stack: GREAT } }]);
    assert.ok(ARM_MS > 0);
});

test('C09 hands: without the eight-slot descriptor (the old counts, or nothing) the tiles still show the eight names and nothing is blocked', { skip }, () => {
    const fixture = c09('two-handed');
    for (const legacy of [{ accessory: 2, worn: 4 }, MISSING]) {
        fixture.answers['items.slots'] = legacy;
        const [pc] = viewOf(rosterView, fixture.answers, {}, fixture.state).active;
        assert.equal(pc.slotsKnown, false);
        assert.equal(pc.tiles.length, 8);
        assert.equal(pc.tiles[1].note, '');
    }
    assert.deepEqual(slotList({ status: 'missing' }).slots.map(slot => slot.key), ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2']);
});

test('C09 hands: the page never writes items or flags: no rules.registerItem or rules.flagSet is sent from a button', { skip }, async () => {
    const fixture = c09('one-handed');
    const { drawn: d } = drawn(fixture.answers, { state: fixture.state });
    for (const button of all(d.el, '.rpg-cb-go')) { button.dispatch('click'); await settle(); }
    for (const tile of tilesIn(d.el).filter(node => node.classList.contains('filled'))) { tile.dispatch('click'); tile.dispatch('click'); await settle(); }
    const sent = new Set(d.commands.map(command => command.type));
    assert.ok([...sent].every(type => ['item.equip', 'item.unequip', 'party.setActive'].includes(type)), [...sent].join());
    assert.ok(!sent.has('rules.registerItem') && !sent.has('rules.flagSet') && !sent.has('inventory.registerDefinition'));
});

test('C09 hands: every bag piece is asked about with the actor and (only for a picked slot) its slot', { skip }, () => {
    const fixture = c09('one-handed');
    const asked = [];
    const table = { ...fixture.answers, 'rules.equipPlan': args => { asked.push(args); return fixture.answers['rules.equipPlan'](args); }, 'items.canWear': args => { asked.push(args); return fixture.answers['items.canWear'](args); } };
    viewOf(rosterView, table, {}, fixture.state);
    assert.ok(asked.every(args => args.actor === PC && typeof args.stack === 'string'));
    assert.ok(asked.some(args => args.targetSlot === 'weapon'), 'alternatives are read-only plans');
    assert.ok(makeState().domains.inventory.stacks.it_dagger01, 'the shared fixture state was not edited');
});
