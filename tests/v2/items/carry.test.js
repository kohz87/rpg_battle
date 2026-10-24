// The carry limit (MODULES §F39, items/carry.js): weights by kind, capacity from STR, what fits,
// the settings, the items.carry query, item.give refused when the taker cannot carry it; and the
// accessory slot keys (one per allowed copy).
import test from 'node:test';
import assert from 'node:assert/strict';
import { part } from '../../../src/v2/items/index.js';
import { CAPACITY, WEIGHTS, canCarry, capacityOf, carrySettings, carryView, weightOf } from '../../../src/v2/items/carry.js';
import { makeCtx } from './helpers/fake-ctx.js';
import { LYRA, PC, makeState } from './helpers/state.js';

const harness = (state = makeState(), settings = {}) => makeCtx({ state, settings, handlers: part.commands, queries: part.queries });

test('weights: a def\'s own, else by kind and slot; capacity is (20 + 4 × STR) × size', () => {
    assert.equal(weightOf({ kind: 'goods', weight: 7 }), 7);
    assert.equal(weightOf({ kind: 'goods' }), WEIGHTS.goods);
    assert.equal(weightOf({ kind: 'consumable' }), 1);
    assert.equal(weightOf({ kind: 'material' }), 1);
    assert.equal(weightOf({ kind: 'money' }), 0);
    assert.equal(weightOf({ kind: 'quest' }), 0);
    assert.equal(weightOf({ kind: 'equipment', slot: 'weapon' }), 4);
    assert.equal(weightOf({ kind: 'equipment', slot: 'weapon', tags: ['two-handed'] }), 8);
    assert.equal(weightOf({ kind: 'equipment', slot: 'armour' }), 10);
    assert.equal(weightOf({ kind: 'equipment', slot: 'accessory' }), 0);
    assert.equal(weightOf({ kind: 'equipment', slot: 'cloak' }), 3);
    assert.deepEqual(CAPACITY, { base: 20, perStr: 4 });
    assert.equal(capacityOf({ stats: { STR: 5 } }), 40);
    assert.equal(capacityOf({ stats: { STR: 10 } }), 60);
    assert.equal(capacityOf({ stats: { STR: 5 } }, { carrySize: 50 }), 20);
    assert.equal(capacityOf({}), 40, 'no STR: the start value');
    assert.deepEqual(carrySettings(null), { on: true, size: 100 }, 'on by default');
    assert.deepEqual(carrySettings({ carryLimit: false, carrySize: 9999 }), { on: false, size: 500 });
});

test('carryView and canCarry: the party\'s whole load against its members\' capacities', () => {
    const { inventory, party } = makeState().domains;
    const view = carryView(inventory, party, {});
    assert.deepEqual(view.people.map(person => [person.name, person.capacity]), [['Ren', 48], ['Lyra', 40]]);
    assert.equal(view.capacity, 88);
    assert.equal(view.load, view.bag + view.people.reduce((sum, person) => sum + person.load, 0));
    const anvil = { name: 'Anvil', kind: 'goods', weight: 80 };
    const no = canCarry(inventory, party, { owner: 'party', add: [{ def: anvil, qty: 1 }] });
    assert.equal(no.ok, false);
    assert.equal(no.message, `The party cannot carry that: ${view.load} of 88 carried, and the Anvil weighs 80.`);
    assert.equal(canCarry(inventory, party, { owner: 'party', add: [{ def: anvil, qty: 1 }], settings: { carryLimit: false } }).ok, true);
    const lyra = canCarry(inventory, party, { owner: LYRA, add: [{ def: { name: 'Stone', kind: 'goods', weight: 39 }, qty: 1 }], move: true });
    assert.equal(lyra.ok, true, 'a hand-over checks only the taker');
    const heavy = canCarry(inventory, party, { owner: LYRA, add: [{ def: { name: 'Stone', kind: 'goods', weight: 20 }, qty: 2 }], move: true });
    assert.equal(heavy.message, 'Lyra cannot carry that: 1 of 40 carried, and 2 Stone weigh 40.');
    assert.equal(canCarry({ defs: {}, stacks: {} }, { actors: {} }, { add: [{ def: anvil }] }).on, false, 'no party, no limit');
});

test('items.carry: the overview, and a check of things not yet in the inventory or by def id', () => {
    const state = makeState();
    const view = part.queries['items.carry'](state, { settings: {} });
    assert.equal(view.on, true);
    assert.equal(view.capacity, 88);
    const byId = part.queries['items.carry'](state, { owner: LYRA, add: [{ defId: 'story/greatsword', qty: 1 }], move: true, settings: { carrySize: 10 } });
    assert.deepEqual([byId.ok, byId.message], [false, 'Lyra cannot carry that: 1 of 4 carried, and the Greatsword weighs 8.']);
    assert.equal(part.queries['items.carry'](state, { add: [], settings: {} }).ok, true);
    assert.deepEqual(part.settings.defaults, { carryLimit: true, carrySize: 100, carryItems: [] });
    assert.equal(part.settings.schema.carryLimit.type, 'bool');
});

test('item.give is refused when the taker cannot carry it; it stays with the giver', () => {
    const h = harness(makeState(), { carrySize: 10 });
    const before = h.state();
    const r = h.run('item.give', { stack: 'it_great001', to: LYRA });
    assert.deepEqual([r.ok, r.code, r.message], [false, 'REFUSED', 'Lyra cannot carry that: 1 of 4 carried, and the Greatsword weighs 8.']);
    assert.deepEqual(h.state(), before);
    assert.deepEqual(h.calls, []);
    assert.equal(harness(makeState(), { carryLimit: false, carrySize: 10 }).run('item.give', { stack: 'it_great001', to: LYRA }).ok, true);
    assert.equal(h.run('item.give', { stack: 'it_draught1', to: LYRA }).ok, true, 'a draught fits');
});

test('item.equip: each accessory slot holds one piece, in the slot its def names; the receipt names what came off', () => {
    const state = makeState();
    state.domains.inventory.stacks.it_ring0001.equipped = null;
    state.domains.inventory.stacks.it_ring0002.equipped = null;
    const h = harness(state);
    const first = h.run('item.equip', { stack: 'it_ring0001' });
    assert.deepEqual(h.calls, [{ type: 'inventory.equipOn', payload: { stack: 'it_ring0001', actor: PC } }]);
    assert.deepEqual([first.receipt.data.slot, first.receipt.data.key, first.receipt.data.removed], ['accessory-1', 'accessory-1', []]);
    const second = h.run('item.equip', { stack: 'it_ring0002' });
    assert.equal(second.receipt.data.key, 'accessory-2');
    assert.doesNotMatch(second.receipt.summary, /puts away/);
    // A third accessory made for accessory-1 takes the first ring's place, and the ring comes off.
    const third = h.run('item.equip', { stack: 'it_charm001' });
    assert.equal(third.receipt.data.key, 'accessory-1');
    assert.deepEqual(third.receipt.data.removed, ['it_ring0001']);
    // The gear query reads the keys as the accessory slots: both count.
    const gear = part.queries['items.gear'](h.state(), { settings: {} });
    assert.deepEqual(gear.counted.filter(row => row.slot === 'accessory').map(row => [row.stack, row.key]).sort(), [['it_charm001', 'accessory-1'], ['it_ring0002', 'accessory-2']]);
    // A worn piece too: head.
    const worn = makeState();
    worn.domains.inventory.stacks.it_boots001.equipped = null;
    const w = harness(worn);
    assert.equal(w.run('item.equip', { stack: 'it_helm0001' }).receipt.data.key, 'head');
});
