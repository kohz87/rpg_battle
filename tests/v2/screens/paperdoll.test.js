// The party card's EQUIPMENT (UI 8h): one card per member; the tiles the item rules define (weapon, off-hand,
// armour, the worn piece, two accessories) and anything worn that does not count; a filled tile's actions (Take
// off, Give…, Drop) and an empty tile's Equip… chooser, with the commands the items part keeps; several members; the
// phone and tap-target rules in the CSS. The builder is pure; the rendering needs Story Block's template renderer
// (helpers/runtime.js) and is skipped with the reason otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { partyScreen } from '../../../src/v2/screens/index.js';
import { SLOT_GROUPS, SLOT_LABEL, keyNumber, paperdollOf } from '../../../src/v2/screens/paperdoll.js';
import { renderer, rendererMissing } from './helpers/runtime.js';
import { LYRA, PC, makeState } from './helpers/state.js';

const skip = renderer ? false : rendererMissing;
const helpers = renderer ? await import('./helpers/render.js') : null;
const { all, click, draw, propsOf, text } = helpers ?? {};

const CHARM = 'Silver Charm of the Northern Winds, Blessed by the Old Watch of Bluewatch Village';
const piece = (stack, slot, extra = {}) => ({ stack, name: `${stack} name`, slot, slotLabel: SLOT_LABEL[slot], rarity: 'common', stats: '', counted: true, why: '', condition: null, refine: null, ...extra });

// ---------------------------------------------------------------------------------------------------
// The builder (pure)

test('paperdoll: with nothing worn the tiles are the rules\' slots, in order, all empty (weapon, off-hand, armour, worn, two accessories)', () => {
    const card = paperdollOf({ actorId: PC, limits: { worn: 1, accessory: 2 } });
    assert.deepEqual(card.tiles.map(tile => tile.key), ['weapon', 'offhand', 'armour', 'worn-1', 'accessory-1', 'accessory-2']);
    assert.deepEqual(card.tiles.map(tile => tile.label), ['Weapon', 'Off-hand', 'Armour', 'Worn', 'Accessory', 'Accessory']);
    assert.equal(card.filled, 0);
    assert.equal(card.empty, 6);
    assert.deepEqual(SLOT_GROUPS, ['weapon', 'offhand', 'armour', 'worn', 'accessory'], 'the groups the rules define, and no tool');
});

test('paperdoll: a filled tile carries its piece, its quantity and the other members to give it to; an empty one the bag\'s pieces for it', () => {
    const members = [{ id: PC, name: 'Ren' }, { id: LYRA, name: 'Lyra' }];
    const card = paperdollOf({
        actorId: PC, members, limits: { worn: 1, accessory: 2 }, qtys: { s1: 3 },
        pieces: [piece('s1', 'weapon', { name: 'Iron Dagger' })], keys: { s1: 'weapon' },
        bag: { accessory: [{ id: 's9', name: CHARM }] },
    });
    const [weapon, offhand, , , accessory1] = card.tiles;
    assert.equal(weapon.filled, true);
    assert.equal(weapon.name, 'Iron Dagger');
    assert.equal(weapon.qty, 3);
    assert.deepEqual(weapon.givers, [{ id: LYRA, name: 'Lyra' }], 'not to the wearer');
    assert.equal(offhand.empty, true);
    assert.deepEqual(offhand.equip, [], 'nothing in the bag for an off-hand');
    assert.deepEqual(accessory1.equip, [{ id: 's9', name: CHARM }]);
});

test('paperdoll: an off-hand beside a two-handed weapon is not a slot to fill; the card says why', () => {
    const card = paperdollOf({ actorId: PC, limits: { worn: 1, accessory: 2 }, twoHanded: true, pieces: [piece('s1', 'weapon')], keys: { s1: 'weapon' }, bag: { offhand: [{ id: 's2', name: 'Buckler' }] } });
    const offhand = card.tiles.find(tile => tile.key === 'offhand');
    assert.equal(offhand.empty, true);
    assert.equal(offhand.note, 'Two-handed weapon');
    assert.deepEqual(offhand.equip, [], 'no chooser');
});

test('paperdoll: the worn pieces and the accessories fill their numbered tiles in key order', () => {
    const card = paperdollOf({
        actorId: PC, limits: { worn: 1, accessory: 2 },
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
        actorId: PC, limits: { worn: 0, accessory: 2 },
        pieces: [piece('h1', 'worn', { counted: false, why: 'no worn pieces count', slotLabel: 'Worn' })],
        keys: { h1: 'worn' },
    });
    assert.equal(card.tiles.some(tile => tile.key === 'worn-1'), false, 'no worn tile when none count');
    const extra = card.tiles.at(-1);
    assert.equal(extra.extra, true);
    assert.equal(extra.filled, true);
    assert.equal(extra.why, 'no worn pieces count');
});

test('paperdoll: with several members each card has its own tiles (the members are the others, for Give…)', () => {
    const members = [{ id: PC, name: 'Ren' }, { id: LYRA, name: 'Lyra' }];
    const ren = paperdollOf({ actorId: PC, members, limits: { worn: 1, accessory: 2 }, pieces: [piece('s1', 'weapon')], keys: { s1: 'weapon' } });
    const lyra = paperdollOf({ actorId: LYRA, members, limits: { worn: 1, accessory: 2 }, pieces: [piece('s2', 'weapon')], keys: { s2: 'weapon' } });
    assert.equal(ren.filled, 1);
    assert.equal(lyra.filled, 1);
    assert.deepEqual(lyra.tiles[0].givers, [{ id: PC, name: 'Ren' }], 'a filled tile gives to the others');
    assert.deepEqual(ren.tiles[0].givers, [{ id: LYRA, name: 'Lyra' }]);
    assert.deepEqual(ren.tiles[1].givers, [], 'an empty tile has nobody to give to');
});

// ---------------------------------------------------------------------------------------------------
// The rendered cards

// A member's card: the one whose hero (ss.hero) is named so.
const heroName = card => propsOf(all(card, 'ss-widget').find(widget => widget.getAttribute('name') === 'ss.hero'))?.value?.name ?? '';
const cardOf = (root, name) => all(root, 'article.actor').find(card => heroName(card).startsWith(name));
const dollOf = card => all(card, '.doll')[0];
const buttonsIn = (root, command) => all(root, 'button').filter(button => button.getAttribute('data-command') === command);

/** Ren's state with a charm in the party's bag that fits the empty accessory slot (its name is 70+ characters). */
function withCharm() {
    const state = makeState();
    const inventory = state.domains.inventory;
    inventory.defs['story/silver-charm'] = { ...inventory.defs['story/steel-blade'], id: 'story/silver-charm', name: CHARM, slot: 'accessory', tags: [] };
    inventory.stacks.it_charm001 = { id: 'it_charm001', def: 'story/silver-charm', qty: 1, owner: 'party', equipped: null, note: '', from: 'rc_seed0001' };
    return state;
}

test('party card: EQUIPMENT is a section per member: the portrait and name, then a tile per slot the rules define', { skip }, () => {
    const drawn = draw(partyScreen, makeState());
    assert.deepEqual(drawn.warnings, []);
    const cards = all(drawn.el, 'article.actor');
    assert.equal(cards.length, 2, 'one card per party member');
    for (const card of cards) {
        const heading = all(card, '.doll-block h4.ss-section-label');
        assert.equal(heading.length, 1);
        assert.equal(text(heading[0]), 'Equipment');
        assert.equal(all(card, '.doll .slot').length, 6, 'weapon, off-hand, armour, worn, two accessories');
        assert.equal(all(card, '.doll .figure ss-widget[name="ss.portrait"]').length, 1, 'the portrait (initials when there is none)');
    }
    const [ren, lyra] = cards;
    assert.equal(text(all(ren, '.doll .doll-name')[0]), 'Ren');
    assert.equal(text(all(lyra, '.doll .doll-name')[0]), 'Lyra');
    assert.equal(all(ren, '.doll .tile.filled').length, 1, 'Ren has one piece on');
    assert.equal(all(lyra, '.doll .tile.filled').length, 0, 'Lyra wears nothing');
    assert.equal(all(lyra, '.doll .tile.empty').length, 6);
    // The old list of worn pieces and its labels are gone.
    assert.equal(all(drawn.el, '.gear').length, 0);
    assert.equal(all(drawn.el, '.piece').length, 0);
});

test('party card: an empty slot reads Empty (muted) and is inert when the bag has nothing for it', { skip }, () => {
    const drawn = draw(partyScreen, makeState());
    const empty = all(cardOf(drawn.el, 'Ren'), '.doll .tile.empty');
    assert.equal(empty.length, 5);
    for (const tile of empty) {
        assert.equal(text(tile.querySelector('.item-name')), 'Empty');
        assert.equal(tile.querySelector('details.equip'), null, 'no chooser without a piece for it');
    }
});

test('party card: a filled slot is a disclosure whose actions send item.unequip, item.give and inventory.drop with their payloads', { skip }, async () => {
    const drawn = draw(partyScreen, makeState());
    assert.deepEqual(drawn.warnings, []);
    const tile = all(cardOf(drawn.el, 'Ren'), '.doll .tile.filled')[0];
    assert.equal(text(tile.querySelector('.item-name')).includes('Iron Dagger'), true);
    assert.equal(tile.tagName, 'DETAILS');
    assert.equal(tile.querySelector('summary').classList.contains('tile-face'), true);
    // Take off
    const takeOff = buttonsIn(tile, 'item.unequip');
    assert.equal(takeOff.length, 1);
    assert.equal(text(takeOff[0]).trim(), 'Take off');
    await click(takeOff[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'item.unequip', payload: { stack: 'it_dagger01' } });
    // Give… to the other member
    const give = all(tile, 'details.give');
    assert.equal(give.length, 1);
    const toLyra = buttonsIn(give[0], 'item.give');
    assert.deepEqual(toLyra.map(text), ['Lyra']);
    await click(toLyra[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'item.give', payload: { stack: 'it_dagger01', to: LYRA } });
    // Drop: the whole stack, after the confirm
    const drop = buttonsIn(tile, 'inventory.drop');
    assert.equal(drop.length, 1);
    await click(drop[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'inventory.drop', payload: { stack: 'it_dagger01', qty: 1 } });
});

test('party card: an empty slot with a piece for it offers Equip… (item.equip { stack }); the name is the whole 70+ characters', { skip }, async () => {
    const drawn = draw(partyScreen, withCharm());
    assert.deepEqual(drawn.warnings, []);
    assert.ok(CHARM.length >= 70, 'the fixture name is 70+ characters');
    const accessories = all(cardOf(drawn.el, 'Ren'), '.doll .tile.empty').filter(tile => tile.querySelector('details.equip'));
    assert.equal(accessories.length, 2, 'both accessory slots are empty, and the charm fits either');
    const equip = buttonsIn(accessories[1], 'item.equip');
    assert.deepEqual(equip.map(text), [CHARM]);
    await click(equip[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'item.equip', payload: { stack: 'it_charm001' } });
    assert.equal(all(cardOf(drawn.el, 'Lyra'), 'details.equip').length, 0, 'the bag\'s pieces go to the main character, so Lyra has no chooser');
});

test('party card: the tiles and their actions read the same after a redraw (the same payloads)', { skip }, async () => {
    const drawn = draw(partyScreen, makeState());
    const before = all(cardOf(drawn.el, 'Ren'), '.doll .slot').map(slot => slot.getAttribute('data-class') ?? slot.className);
    drawn.rerender(makeState());
    const after = all(cardOf(drawn.el, 'Ren'), '.doll .slot').map(slot => slot.getAttribute('data-class') ?? slot.className);
    assert.deepEqual(after, before);
    assert.equal(all(cardOf(drawn.el, 'Ren'), '.doll .tile.filled').length, 1);
});

// ---------------------------------------------------------------------------------------------------
// The CSS: the phone stacks the portrait over the grid, the tiles and the actions are 44px tall at least

test('party card CSS: under 380px of card the portrait sits on top of the grid; from 380px it is the left block (3 to 7), taller than wide', () => {
    const css = partyScreen.css;
    assert.match(css, /\.doll \{ display: grid; gap: 10px; grid-template-columns: minmax\(0, 1fr\);/, 'a phone: one column');
    assert.match(css, /@container rb-doll \(min-width: 380px\) \{\s*\.doll \{ grid-template-columns: minmax\(0, 3fr\) minmax\(0, 7fr\); \}\s*\.figure \{ aspect-ratio: 3 \/ 4;/);
    assert.match(css, /\.slots \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, 'two columns on every width');
});

test('party card CSS: every tap target (a tile, its disclosure, an action) is at least 44px tall', () => {
    const css = partyScreen.css;
    assert.match(css, /\.tile-face \{[^}]*min-height: 44px;/);
    assert.match(css, /\.tile\.empty \{[^}]*min-height: 44px;/);
    assert.match(css, /\.doll \.acts > \.ss-button, \.doll \.pick > summary \{ min-height: 44px; \}/);
    assert.match(css, /\.doll \.pick \.choices \.ss-button \{ min-height: 44px;/);
});
