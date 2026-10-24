// Old saves and old packs under the eight slots (contract §9): what a real six-slot save and a real old pack
// look like when read through the adapters. The save is tests/v2/items/fixtures/old-six-slot-save.json, written
// untouched by the six-slot runtime itself (its provenance is in the file). Reading never writes: every state
// below is frozen, the adapters name the slot an `armour` key stands for, and a key that names no single v2 slot
// (`worn-1`, a bare `accessory`) is shown as unplaced, kept exactly as stored and never guessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { part } from '../../../src/v2/items/index.js';
import { defineItem } from '../../../src/v2/items/define.js';
import { interimItemRule } from '../../../src/v2/items/equip-query.js';
import { normalizeSlot, readSlot, slotsForLegacy } from '../../../src/v2/items/slots.js';
import { makeCtx } from './helpers/fake-ctx.js';

const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const save = load('old-six-slot-save.json');
const { pc, lyra } = save;
const clone = value => JSON.parse(JSON.stringify(value));
function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
}
const stateOf = () => ({ v: 2, meta: { rev: 1, claims: {} }, domains: clone(save.domains) });
const idOf = name => {
    const def = Object.values(save.domains.inventory.defs).find(entry => entry.name === name);
    return Object.values(save.domains.inventory.stacks).find(stack => stack.def === def.id).id;
};
const q = (state, name, args) => part.queries[name](deepFreeze(clone(state)), args, undefined);

test('the fixture is a real six-slot save: the old runtime\'s own keys, and nothing hand-edited', () => {
    const stacks = save.domains.inventory.stacks;
    const keys = Object.values(stacks).filter(stack => stack.equipped).map(stack => [save.domains.inventory.defs[stack.def].name, stack.owner === lyra ? 'lyra' : 'pc', stack.equipped]);
    assert.deepEqual(keys.sort(), [
        ['Chain Shirt', 'pc', 'armour'], ['Hunting Knife', 'lyra', 'weapon'], ['Iron Helm', 'pc', 'worn-1'], ['Iron Sword', 'pc', 'weapon'],
        ['Jade Ring', 'pc', 'accessory-2'], ['Silver Ring', 'pc', 'accessory-1'], ['Traveller Cloak', 'lyra', 'armour'], ['Wooden Shield', 'pc', 'offhand'],
    ].sort());
    assert.match(save.provenance, /six-slot runtime/);
});

test('reading the save shows each piece in its v2 slot: armour reads as body, the numbered accessories stay, worn-1 is unplaced', () => {
    const state = deepFreeze(stateOf());
    const gear = part.queries['items.gear'](state, { settings: {} });
    assert.equal(gear.actor, pc);
    assert.deepEqual(gear.counted.map(row => [row.name, row.key, row.slotLabel]), [
        ['Iron Sword', 'weapon', 'Main hand'], ['Wooden Shield', 'offhand', 'Off hand'], ['Chain Shirt', 'body', 'Body'],
        ['Silver Ring', 'accessory-1', 'Accessory 1'], ['Jade Ring', 'accessory-2', 'Accessory 2'],
    ].sort((a, b) => ['weapon', 'offhand', 'body', 'accessory-1', 'accessory-2'].indexOf(a[1]) - ['weapon', 'offhand', 'body', 'accessory-1', 'accessory-2'].indexOf(b[1])));
    assert.equal(gear.bonuses.ATK > 0 && gear.bonuses.DEF > 0, true, 'what counted before still counts');
    // The helm was stored as worn-1: no single v2 slot, so it is listed, not counted, and told why.
    const helm = gear.unused.find(row => row.name === 'Iron Helm');
    assert.equal(helm.stack, idOf('Iron Helm'));
    assert.match(helm.why, /"worn-1" does not name one of the eight slots/);
    assert.equal(gear.counted.some(row => row.name === 'Iron Helm'), false);
    // Lyra's pieces are hers: the knife in the main hand, the cloak (armour) in the body.
    const hers = part.queries['items.gear'](state, { actor: lyra, settings: {} });
    assert.deepEqual(hers.counted.map(row => [row.name, row.key]), [['Hunting Knife', 'weapon'], ['Traveller Cloak', 'body']]);
    assert.deepEqual(hers.unused, []);
});

test('the eight slots of the old save: nothing blocks, and reading changed nothing', () => {
    const before = stateOf();
    const state = deepFreeze(clone(before));
    const view = part.queries['items.slots'](state, { actor: pc });
    assert.deepEqual(view.slots.map(slot => [slot.key, slot.blockedBy]), [['weapon', null], ['offhand', null], ['head', null], ['body', null], ['legs', null], ['feet', null], ['accessory-1', null], ['accessory-2', null]]);
    assert.deepEqual(state, before);
    part.queries['items.gear'](state, {});
    part.queries['rules.equipPlan'](state, { stack: idOf('Iron Sword'), actor: pc });
    assert.deepEqual(state, before, 'queries never write');
});

test('adapters: aliases read as their slot; the generic words and numbered old keys name no slot and are never guessed', () => {
    for (const [word, slot] of [['mainhand', 'weapon'], ['main-hand', 'weapon'], ['off-hand', 'offhand'], ['armour', 'body'], ['armor', 'body'], ['accessory-1', 'accessory-1'], ['accessory-2', 'accessory-2']]) {
        assert.equal(normalizeSlot(word), slot, word);
    }
    for (const word of ['worn', 'worn-1', 'hands', 'waist', 'accessory', 'accessory-3', 'weapon-1', '', null, undefined, 7]) {
        assert.equal(normalizeSlot(word), null, String(word));
        assert.equal(readSlot(word).unplaced, true);
    }
    assert.deepEqual(readSlot('armour'), { slot: 'body', legacy: true, unplaced: false });
    assert.deepEqual(readSlot('body'), { slot: 'body', legacy: false, unplaced: false });
});

test('the planner on the old save: a body piece takes the old armour off, a head piece leaves worn-1 where it is', () => {
    const base = stateOf();
    const defs = base.domains.inventory.defs;
    defs['story/plate'] = defineItem({ id: 'story/plate', name: 'Plate', kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' }, { note: 'DEF +5, slot: body', settings: {} });
    defs['story/cap'] = defineItem({ id: 'story/cap', name: 'Steel Cap', kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' }, { note: 'DEF +1, slot: head', settings: {} });
    for (const [id, def] of [['it_plate001', 'story/plate'], ['it_steelcap', 'story/cap']]) base.domains.inventory.stacks[id] = { id, def, qty: 1, owner: 'party', equipped: null, note: '', from: 'rc_seed0001' };
    const h = makeCtx({ state: base, handlers: part.commands, queries: part.queries });
    const body = h.run('item.equip', { stack: 'it_plate001' });
    assert.equal(body.ok, true, body.message);
    assert.equal(body.receipt.data.slot, 'body');
    assert.deepEqual(body.receipt.data.removed, [idOf('Chain Shirt')], 'the piece stored as armour is the body it replaces');
    const head = h.run('item.equip', { stack: 'it_steelcap' });
    assert.equal(head.ok, true, head.message);
    assert.deepEqual(head.receipt.data.removed, [], 'the old worn-1 record is not displaced: it names no slot');
    const stacks = h.state().domains.inventory.stacks;
    assert.equal(stacks[idOf('Iron Helm')].equipped, 'worn-1', 'kept exactly as stored');
    assert.equal(stacks[idOf('Chain Shirt')].equipped, null, 'taken off, not lost');
    assert.equal(Object.keys(stacks).length, Object.keys(save.domains.inventory.stacks).length + 2, 'nothing deleted');
    // Lyra's pieces and the rest are untouched.
    for (const name of ['Iron Sword', 'Wooden Shield', 'Silver Ring', 'Jade Ring', 'Hunting Knife', 'Traveller Cloak']) {
        assert.equal(stacks[idOf(name)].equipped, save.domains.inventory.stacks[idOf(name)].equipped, name);
        assert.equal(stacks[idOf(name)].owner, save.domains.inventory.stacks[idOf(name)].owner, name);
    }
});

test('a def whose old slot is generic cannot be worn until it names one of the eight: refused in words, never guessed', () => {
    const h = makeCtx({ state: stateOf(), handlers: part.commands, queries: part.queries });
    for (const name of ['Leather Boots', 'Bone Charm']) {
        const before = JSON.stringify(h.state());
        const result = h.run('item.equip', { stack: idOf(name) });
        assert.equal(result.ok, false, name);
        assert.equal(result.code, 'REFUSED');
        assert.match(result.message, /needs a v2 slot before it can be worn/);
        assert.equal(JSON.stringify(h.state()), before);
    }
    const asked = q(stateOf(), 'items.canWear', { actor: pc, stack: idOf('Leather Boots') });
    assert.equal(asked.ok, false);
    assert.match(asked.why, /old "worn" slot/);
    // Taking it off needs no plan.
    assert.equal(h.run('item.unequip', { stack: idOf('Iron Helm') }).ok, true);
    assert.equal(h.state().domains.inventory.stacks[idOf('Iron Helm')].equipped, null);
});

test('the old pack: Ersveil Bluewatch\'s weapon, armour and off-hand read as their v2 slots; its worn pieces name none', () => {
    const pack = JSON.parse(readFileSync(new URL('../craft/fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8'));
    const items = pack.content.items.filter(item => item.kind === 'equipment' && item.slot);
    assert.ok(items.length >= 9);
    const rules = items.map((item, at) => ({ item, ...interimItemRule({ id: `pack.ersveil-bluewatch/item-${at}`, name: item.name, kind: 'equipment', slot: item.slot, tags: item.tags ?? [] }) }));
    for (const { item, rule, note } of rules) {
        if (item.slot === 'weapon') assert.deepEqual([rule.allowedSlots, rule.hands], [['weapon'], 1], item.name);
        if (item.slot === 'armour') assert.deepEqual([rule.allowedSlots, rule.hands], [['body'], 0], item.name);
        if (item.slot === 'offhand') assert.deepEqual([rule.allowedSlots, rule.hands], [['offhand'], 1], item.name);
        if (item.slot === 'worn') {
            assert.deepEqual(rule.allowedSlots, [], item.name);
            assert.match(note, /needs a v2 slot/);
        }
        assert.equal(rule.requires && Object.keys(rule.requires).length, 0, 'the interim rule invents no requirement');
    }
    assert.equal(rules.filter(entry => entry.item.slot === 'worn').length, 3);
});

test('slotsForLegacy: the five legacy SB slots map to the eight rule slots, ambiguous ones to null (track B calls this)', () => {
    assert.deepEqual(['weapon', 'offhand', 'armour', 'worn', 'accessory'].map(slotsForLegacy), ['weapon', 'offhand', 'body', null, null]);
    assert.deepEqual(['mainhand', 'main-hand', 'off-hand', 'armor', 'head', 'accessory-2'].map(slotsForLegacy), ['weapon', 'weapon', 'offhand', 'body', 'head', 'accessory-2']);
    for (const word of ['hands', 'waist', 'worn-1', '', null, undefined, 4, {}]) assert.equal(slotsForLegacy(word), null);
});
