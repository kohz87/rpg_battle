// The party card's EQUIPMENT (UI 8h, 8f): the tiles the item rules define (Main hand, Off hand, Body, Worn, Accessory 1
// and 2, counted by items.slots) and anything worn that does not count, each tile with only its slot, item, stats and
// condition; the card with a member's compact card (the hero) and a fold button; the rest folds away. The builder is
// pure; the card needs Story Block's template renderer (helpers/runtime.js) and is skipped with the reason otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { partyScreen } from '../../../src/v2/screens/index.js';
import { EQUIPMENT_WIDGET, MEMBER_TOGGLE_WIDGET } from '../../../src/v2/screens/equipment.js';
import { SLOT_GROUPS, SLOT_LABEL, keyNumber, paperdollOf } from '../../../src/v2/screens/paperdoll.js';
import { renderer, rendererMissing } from './helpers/runtime.js';
import { LYRA, PC, makeState } from './helpers/state.js';

const skip = renderer ? false : rendererMissing;
const helpers = renderer ? await import('./helpers/render.js') : null;
const { all, draw, propsOf, text } = helpers ?? {};

const piece = (stack, slot, extra = {}) => ({ stack, name: `${stack} name`, slot, slotLabel: SLOT_LABEL[slot], rarity: 'common', stats: '', counted: true, why: '', condition: null, refine: null, ...extra });

// ---------------------------------------------------------------------------------------------------
// The builder (pure)

test('paperdoll: with nothing worn the tiles are the rules\' slots, in order, named as the card names them, all empty', () => {
    const card = paperdollOf({ limits: { worn: 1, accessory: 2 } });
    assert.deepEqual(card.tiles.map(tile => tile.key), ['weapon', 'offhand', 'armour', 'worn-1', 'accessory-1', 'accessory-2']);
    assert.deepEqual(card.tiles.map(tile => tile.label), ['Main hand', 'Off hand', 'Body', 'Worn', 'Accessory 1', 'Accessory 2']);
    assert.equal(card.filled, 0);
    assert.equal(card.empty, 6);
    assert.deepEqual(SLOT_GROUPS, ['weapon', 'offhand', 'armour', 'worn', 'accessory'], 'the groups the rules define, and no tool');
});

test('paperdoll: the tiles follow items.slots, so a rules split adds tiles without a change here', () => {
    const card = paperdollOf({ limits: { worn: 2, accessory: 3 } });
    assert.equal(card.tiles.filter(tile => tile.group === 'worn').length, 2);
    assert.equal(card.tiles.filter(tile => tile.group === 'accessory').length, 3);
    assert.deepEqual(card.tiles.filter(tile => tile.group === 'accessory').map(tile => tile.label), ['Accessory 1', 'Accessory 2', 'Accessory 3']);
});

test('paperdoll: a filled tile carries its item, its stats and its condition; a refined piece shows its level in the name', () => {
    const card = paperdollOf({
        limits: { worn: 1, accessory: 2 },
        pieces: [piece('s1', 'weapon', { name: 'Iron Dagger', stats: 'ATK +3', refine: { label: '+2' }, condition: { band: 'worn', label: 'Worn', cur: 52, max: 100 } })],
        keys: { s1: 'weapon' },
    });
    const weapon = card.tiles[0];
    assert.equal(weapon.filled, true);
    assert.equal(weapon.name, 'Iron Dagger +2');
    assert.equal(weapon.stats, 'ATK +3');
    assert.equal(weapon.stack, 's1');
    assert.equal(weapon.cond, 'Worn 52/100');
    assert.equal(weapon.condTone, 'warn');
    assert.deepEqual([weapon.meter, weapon.cur, weapon.max], [true, 52, 100]);
    assert.equal(card.filled, 1);
    assert.equal(card.tiles[1].empty, true);
    assert.equal(card.tiles[1].name, '', 'an empty tile has no item');
});

test('paperdoll: a broken piece is red and says so; a piece without wear has no condition', () => {
    const card = paperdollOf({
        limits: { worn: 1, accessory: 2 },
        pieces: [piece('a1', 'accessory', { condition: { band: 'broken', label: 'Broken', cur: 0, max: 100 } }), piece('b1', 'armour')],
        keys: { a1: 'accessory-1', b1: 'armour' },
    });
    const accessory = card.tiles.find(tile => tile.key === 'accessory-1');
    assert.equal(accessory.condTone, 'bad');
    assert.equal(accessory.condBroken, true);
    assert.equal(card.tiles.find(tile => tile.key === 'armour').meter, false);
});

test('paperdoll: an off-hand beside a two-handed weapon reads Two-handed; no item to fill it', () => {
    const card = paperdollOf({ limits: { worn: 1, accessory: 2 }, twoHanded: true, pieces: [piece('s1', 'weapon')], keys: { s1: 'weapon' } });
    const offhand = card.tiles.find(tile => tile.key === 'offhand');
    assert.equal(offhand.empty, true);
    assert.equal(offhand.note, 'Two-handed');
});

test('paperdoll: the worn pieces and the accessories fill their numbered tiles in key order', () => {
    const card = paperdollOf({
        limits: { worn: 1, accessory: 2 },
        pieces: [piece('a2', 'accessory'), piece('a1', 'accessory'), piece('w1', 'worn')],
        keys: { a2: 'accessory-2', a1: 'accessory-1', w1: 'worn-1' },
    });
    assert.deepEqual(card.tiles.filter(tile => tile.group === 'accessory').map(tile => [tile.key, tile.stack]), [['accessory-1', 'a1'], ['accessory-2', 'a2']]);
    assert.equal(card.tiles.find(tile => tile.key === 'worn-1').stack, 'w1');
    assert.equal(keyNumber('accessory-12'), 12);
    assert.equal(keyNumber('weapon'), 1);
});

test('paperdoll: a worn piece the rules do not count is shown after the slots, dashed, with why it does not count', () => {
    const card = paperdollOf({
        limits: { worn: 0, accessory: 2 },
        pieces: [piece('h1', 'worn', { counted: false, why: 'no worn pieces count', slotLabel: 'Worn' })],
        keys: { h1: 'worn' },
    });
    assert.equal(card.tiles.some(tile => tile.key === 'worn-1'), false, 'no worn tile when none count');
    const extra = card.tiles.at(-1);
    assert.equal(extra.extra, true);
    assert.equal(extra.filled, true);
    assert.equal(extra.why, 'no worn pieces count');
});

// ---------------------------------------------------------------------------------------------------
// The rendered card: the compact card, the fold, the EQUIPMENT tiles

const heroName = card => propsOf(all(card, 'ss-widget').find(widget => widget.getAttribute('name') === 'ss.hero'))?.value?.name ?? '';
const cardOf = (root, name) => all(root, 'article.actor').find(card => heroName(card).startsWith(name));
const widgetOf = (root, name) => all(root, 'ss-widget').find(widget => widget.getAttribute('name') === name) ?? null;
// The two RPG Battle widgets draw for real (screens/widgets.js), so the tests read what they draw.
const toggleOf = card => all(card, '.rpg-toggle')[0] ?? null;
const tilesOf = card => all(widgetOf(card, EQUIPMENT_WIDGET) ?? card, '.rpg-eq-tile').map(node => ({
    label: text(node.querySelector('.rpg-eq-slot')), filled: node.classList.contains('filled'), empty: node.classList.contains('empty'),
}));

test('party card: the member header has the fold button (the lead open, the others folded); the hero is the compact card', { skip }, () => {
    const drawn = draw(partyScreen, makeState());
    assert.deepEqual(drawn.warnings, []);
    const [ren, lyra] = all(drawn.el, 'article.actor');
    assert.ok(widgetOf(ren.querySelector('.member-head'), MEMBER_TOGGLE_WIDGET), 'the fold button is in the header');
    assert.equal(toggleOf(ren).getAttribute('aria-expanded'), 'true');
    assert.equal(toggleOf(ren).getAttribute('aria-label'), 'Hide Ren');
    assert.equal(ren.getAttribute('data-open'), 'true', 'the lead opens');
    assert.equal(toggleOf(lyra).getAttribute('aria-expanded'), 'false');
    assert.equal(toggleOf(lyra).getAttribute('aria-label'), 'Show Lyra');
    assert.equal(lyra.getAttribute('data-open'), 'false', 'the others fold');
    // The hero stands outside the folding part: it stays when the card folds.
    assert.equal(widgetOf(ren, 'ss.hero').parentNode.classList.contains('rest'), false);
    assert.equal(all(ren.querySelector('.rest'), 'ss-widget[name="ss.hero"]').length, 0);
    assert.equal(all(ren, '.member-head ss-widget[name="ss.hero"]').length, 0);
});

test('party card: EQUIPMENT is the heading and the tiles, all inside the part that folds; no portrait or name block', { skip }, () => {
    const drawn = draw(partyScreen, makeState());
    for (const card of all(drawn.el, 'article.actor')) {
        const heading = all(card, '.doll-block h4.ss-section-label');
        assert.equal(heading.length, 1);
        assert.equal(text(heading[0]), 'Equipment');
        assert.equal(card.querySelector('.rest').contains(widgetOf(card, EQUIPMENT_WIDGET)), true, 'folded with the rest');
        assert.equal(all(card, '.doll-name').length, 0, 'the character is on the card above, not here');
        assert.equal(all(card, 'ss-widget[name="ss.hero"]').length, 1, 'the compact card (the hero) once');
    }
    const [ren, lyra] = all(drawn.el, 'article.actor');
    // items.slots now answers the contract's compatibility counts (worn: 4, accessory: 2, §3). This six-slot card
    // reads `worn` as the pieces beside the Body tile, so it draws four Worn tiles until the eight-slot equipment
    // widget (track C, draft #139, which reads the slots list) replaces it.
    assert.equal(tilesOf(ren).length, 9, 'Main hand, Off hand, Body, 4 x Worn, Accessory 1, Accessory 2');
    assert.deepEqual(tilesOf(ren).map(tile => tile.label), ['Main hand', 'Off hand', 'Body', 'Worn', 'Worn', 'Worn', 'Worn', 'Accessory 1', 'Accessory 2']);
    assert.equal(tilesOf(ren).filter(tile => tile.filled).length, 1, 'Ren has one piece on');
    assert.equal(tilesOf(lyra).filter(tile => tile.filled).length, 0, 'Lyra wears nothing');
    assert.equal(all(drawn.el, '.gear').length, 0);
    assert.equal(all(drawn.el, '.piece').length, 0);
});

test('party card: the tiles hold no commands: the unequip is the widget\'s own, on a second tap', { skip }, () => {
    const drawn = draw(partyScreen, makeState());
    for (const command of ['item.unequip', 'item.equip', 'item.give', 'inventory.drop']) {
        assert.equal(all(drawn.el, 'button').filter(button => button.getAttribute('data-command') === command).length, 0, command);
    }
    assert.deepEqual(drawn.commands, []);
});
