// The trade part's wave-4 rules: market shortages from the story (MODULES §F36: no restock, dearer
// until lifted), the carry limit before goods come in (§F39, asked of the items part), a pack's
// own shops for its places, and prices that start from an item's own value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part, tradeTail, validateTrade } from '../../../src/v2/trade/index.js';
import { part as items } from '../../../src/v2/items/index.js';
import { DAY, currentShops, currentShortages, shortageAt, shortageKey } from '../../../src/v2/trade/core.js';
import { baseState, createHost, def, stack } from './helpers/fake-ctx.js';

const coin = host => host.state.domains.inventory.wallets.party.coin;
const snapshot = host => JSON.stringify(host.state);
const BLOCKADE = { op: '!', kind: 'market', name: 'Bluewatch', text: 'blockade on the river', labels: { until: 'the bridge is cleared' } };
const LIFT = { op: '~', kind: 'market', name: 'Bluewatch', text: 'supplies back' };

/** The trade part with the items part's carry query beside it (as in the merged module). */
const withCarry = { ...part, queries: { ...part.queries, 'items.carry': items.queries['items.carry'] } };

// ---------------------------------------------------------------------------------------
// Shortages (MODULES §F36)

test('! market marks a shortage at a place: dearer to buy, the same to sell, told, not narrated', () => {
    const host = createHost(part, { state: baseState({ minutes: 3 * DAY }), time: 3 * DAY });
    const before = host.query('trade.stock', { kind: 'general' }).items.map(item => [item.def.id, item.price]);
    const sell = host.query('trade.quote', { type: 'sell', stack: 'it_00000001', qty: 1 }).each;
    const r = host.capture(BLOCKADE);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.receipt.narrate, false, 'the reply told it');
    assert.equal(r.receipt.summary, 'Shortage at Bluewatch (blockade on the river): its shops do not restock and charge 150% of their usual prices until it is lifted (expected: the bridge is cleared).');
    assert.deepEqual(currentShortages(host.state.domains.trade.shortages), { bluewatch: { place: 'Bluewatch', reason: 'blockade on the river', until: 'the bridge is cleared', day: 3, rev: 1 } });
    assert.deepEqual(Object.keys(host.state.domains.trade.shortages), ['bluewatch#1'], 'a write of its own (B-b1r2-13)');
    // "Bluewatch" holds at "Bluewatch Village".
    assert.deepEqual(host.query('trade.market').shortage, { place: 'Bluewatch', reason: 'blockade on the river', until: 'the bridge is cleared', prices: 150 });
    const during = host.query('trade.stock', { kind: 'general' });
    assert.equal(during.shortage, true);
    assert.ok(during.items.every((item, index) => item.price >= before[index][1]), 'nothing is cheaper');
    assert.ok(during.items.some((item, index) => item.price > before[index][1]), 'something is dearer');
    assert.equal(host.query('trade.quote', { type: 'sell', stack: 'it_00000001', qty: 1 }).each, sell, 'what they pay is unchanged');
    assert.deepEqual(validateTrade(host.state.domains.trade), []);
    assert.deepEqual(tradeTail(host.view()).lines, ['[Trade] Shortage at Bluewatch (blockade on the river, until the bridge is cleared): shops there do not restock and charge more until the story lifts it.']);
});

test('a shortage pauses the restock: the stock of the day it began, less what was bought, until lifted', () => {
    const host = createHost(part, { state: baseState({ minutes: 3 * DAY, coin: 5000 }), time: 3 * DAY });
    host.capture(BLOCKADE);
    const day3 = host.query('trade.stock', { kind: 'smith' });
    assert.equal(day3.day, 3);
    const bought = day3.items[0];
    assert.equal(host.command('trade.buy', { shop: day3.shop, def: bought.def.id, qty: 1 }).ok, true);
    // Days pass: no restock, the bought piece stays gone.
    host.state.domains.director.time.minutes = 6 * DAY;
    host.time = 6 * DAY;
    const day6 = host.query('trade.stock', { kind: 'smith' });
    assert.equal(day6.day, 3, 'still the stock of day 3');
    assert.deepEqual(day6.items.map(item => item.def.id), day3.items.slice(1).map(item => item.def.id));
    // Lifted: the shops restock today, at their usual prices.
    const lifted = host.capture(LIFT);
    assert.equal(lifted.ok, true, lifted.message);
    assert.equal(lifted.receipt.summary, 'Supplies are back at Bluewatch: its shops restock and their prices are back to usual.');
    assert.deepEqual(currentShortages(host.state.domains.trade.shortages), {}, 'lifted: its writes removed');
    const after = host.query('trade.stock', { kind: 'smith' });
    assert.equal(after.day, 6);
    assert.equal(after.shortage, false);
    assert.deepEqual(tradeTail(host.view()).lines, []);
});

test('! market again updates the words and keeps the day it began; another place is not touched', () => {
    const host = createHost(part, { state: baseState({ minutes: 3 * DAY }), time: 3 * DAY });
    host.capture(BLOCKADE);
    host.time = 5 * DAY;
    host.capture({ op: '!', kind: 'market', name: 'Bluewatch Village', text: 'the granary burned', labels: {} });
    assert.deepEqual(currentShortages(host.state.domains.trade.shortages).bluewatch, { place: 'Bluewatch', reason: 'the granary burned', until: 'the bridge is cleared', day: 3, rev: 2 });
    assert.equal(shortageAt(currentShortages(host.state.domains.trade.shortages), 'Kingsport'), null);
    assert.equal(shortageKey('Bluewatch  Village | Docks'), 'bluewatch village');
    const elsewhere = createHost(part, { state: { ...baseState({ place: { name: 'Kingsport', kind: 'settlement' } }) } });
    elsewhere.state.domains.trade.shortages = structuredClone(host.state.domains.trade.shortages);
    assert.equal(elsewhere.query('trade.market').shortage, null);
});

test('the shortage price is a setting; a lift of no shortage and a nameless line are refused, nothing saved', () => {
    const host = createHost(part, { state: baseState(), settings: { shortagePrices: 200 } });
    assert.match(host.capture(BLOCKADE).receipt.summary, /charge 200% of their usual prices/);
    assert.equal(host.query('trade.market').shortage.prices, 200);
    const fresh = createHost(part, { state: baseState() });
    const before = snapshot(fresh);
    const lift = fresh.capture(LIFT);
    assert.deepEqual([lift.ok, lift.code, lift.message], [false, 'REFUSED', 'There is no shortage at Bluewatch to lift.']);
    assert.equal(fresh.capture({ op: '!', kind: 'market', name: '  ', text: 'x' }).code, 'INVALID');
    assert.equal(snapshot(fresh), before, 'nothing saved');
    const full = createHost(part, { state: baseState() });
    for (let n = 0; n < 20; n++) assert.equal(full.capture({ op: '!', kind: 'market', name: `Town ${n}`, text: 'short' }).ok, true);
    assert.equal(full.capture({ op: '!', kind: 'market', name: 'Town 99', text: 'short' }).code, 'REFUSED');
    assert.equal(full.capture({ op: '!', kind: 'market', name: 'Town 3', text: 'worse' }).ok, true, 'an existing one can still change');
});

test('validateTrade: shortages are a record of place keys with short words and a day', () => {
    const good = { place: 'Bluewatch', reason: 'r', until: '', day: null, rev: 1 };
    assert.deepEqual(validateTrade({ orders: {}, shops: {}, shortages: { bluewatch: good } }), []);
    assert.deepEqual(validateTrade({ orders: {}, shops: {} }), [], 'an older slice without shortages');
    assert.ok(validateTrade({ orders: {}, shops: {}, shortages: [] }).length);
    assert.ok(validateTrade({ orders: {}, shops: {}, shortages: { 'Blue|watch': good } }).length);
    assert.ok(validateTrade({ orders: {}, shops: {}, shortages: { bluewatch: { ...good, day: -1 } } }).length);
    assert.ok(validateTrade({ orders: {}, shops: {}, shortages: { bluewatch: { ...good, place: '' } } }).length);
});

// ---------------------------------------------------------------------------------------
// The carry limit (MODULES §F39)

test('trade.buy is refused, nothing paid, when the party cannot carry it; without the items part no limit', () => {
    const state = baseState({ coin: 100000 });
    state.domains.party.actors.ac_ren00001.stats = { STR: 5 };
    const host = createHost(withCarry, { state });
    const rope = host.query('trade.stock', { kind: 'general' }).items.find(item => item.def.kind !== 'equipment');
    const before = snapshot(host);
    const r = host.command('trade.buy', { shop: 'general', def: rope.def.id, qty: 30 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'REFUSED');
    assert.match(r.message, /^The party cannot carry that: \d+ of 40 carried, and 30 .* weigh \d+\.$/);
    assert.equal(snapshot(host), before, 'nothing paid, nothing taken');
    assert.equal(host.query('items.carry', { add: [{ def: rope.def, qty: 1 }] }).ok, true, 'one would fit');
    // The limit off in the items part's settings: it fits.
    host.settings = { carryLimit: false };
    assert.equal(host.command('trade.buy', { shop: 'general', def: rope.def.id, qty: 30 }).ok, true);
    // No items part at all: no limit.
    const bare = createHost(part, { state: baseState({ coin: 100000 }) });
    assert.equal(bare.command('trade.buy', { shop: 'general', def: rope.def.id, qty: 30 }).ok, true);
});

test('craft.collect is refused when the piece will not fit: it stays with the crafter', () => {
    const state = baseState({ coin: 1000 });
    state.domains.party.actors.ac_ren00001.stats = { STR: 5 };
    const host = createHost(withCarry, { state });
    const order = host.command('craft.commission', { piece: { name: 'Fang Plate', slot: 'armour' }, materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'smith' });
    assert.equal(order.ok, true, order.message);
    host.state.domains.inventory.stacks.it_00000099 = stack('it_00000099', 'story/rope', 15);
    const before = snapshot(host);
    const r = host.command('craft.collect', { order: order.receipt.data.order });
    assert.equal(r.code, 'REFUSED');
    assert.match(r.message, /cannot carry that.*The Fang Plate stays with the smith for now\.$/);
    assert.equal(snapshot(host), before, 'not collected, not claimed');
    delete host.state.domains.inventory.stacks.it_00000099;
    assert.equal(host.command('craft.collect', { order: order.receipt.data.order }).ok, true);
});

// ---------------------------------------------------------------------------------------
// Pack shops and item values

const PACK_ITEMS = [
    { id: 'pack.e/trail-rations', name: 'Trail Rations', kind: 'consumable', rarity: 'common', value: 20, stack: true, slot: null, stats: {}, effect: { heal: 2 }, tags: [], note: 'dry' },
    { id: 'pack.e/minor-healing-draught', name: 'Minor Healing Draught', kind: 'consumable', rarity: 'common', value: 2000, stack: true, slot: null, stats: {}, effect: { heal: 20 }, tags: [], note: '' },
];
const PACK_SHOPS = [
    { name: 'Watch Stores', kind: 'general goods', place: 'Bluewatch Village', stock: [{ item: 'pack.e/trail-rations', qty: 3 }, { item: 'pack.e/minor-healing-draught', qty: 2, price: 3000 }] },
    { name: 'Salt-and-Ash Dispensary', kind: 'apothecary', place: 'Bluewatch Village', stock: ['pack.e/minor-healing-draught'] },
    { name: 'Harbour Chandlery', kind: 'general', place: 'Kingsport', stock: ['pack.e/trail-rations'] },
];
const withPacks = { ...part, queries: { ...part.queries, 'packs.content': (state, args) => structuredClone(args?.kind === 'shops' ? PACK_SHOPS : args?.kind === 'items' ? PACK_ITEMS : []) } };

test('a pack\'s shops for the place stand in for the generic traders, each line priced by the pack or by value', () => {
    // The scene calls Bluewatch a village: its settlement type (MODULES §F107).
    const host = createHost(withPacks, { state: baseState({ coin: 20000, place: { name: 'Bluewatch Village', kind: 'village' } }) });
    assert.deepEqual(host.query('trade.shops'), [
        { slug: 'watch-stores', name: 'Watch Stores', kind: 'general' },
        { slug: 'salt-and-ash-dispensary', name: 'Salt-and-Ash Dispensary', kind: 'apothecary' },
    ]);
    const stores = host.query('trade.stock', { kind: 'watch-stores' });
    assert.equal(stores.shop, 'bluewatch village|watch-stores');
    assert.equal(stores.name, 'Watch Stores');
    assert.equal(stores.pack, true);
    // Village buy prices are × 0.9: Trail Rations' value 20 → 18; the pack's own price stands.
    assert.deepEqual(stores.items.map(item => [item.def.id, item.price, item.left]), [['pack.e/trail-rations', 18, 3], ['pack.e/minor-healing-draught', 3000, 2]]);
    assert.deepEqual(Object.keys(stores.items[0].def).sort(), ['effect', 'id', 'kind', 'name', 'note', 'rarity', 'slot', 'stack', 'stats', 'tags', 'value']);
    // A trader kind finds the pack shop of that kind; the generic one still answers elsewhere.
    assert.equal(host.query('trade.stock', { kind: 'general' }).shop, 'bluewatch village|watch-stores');
    assert.equal(host.query('trade.stock', { kind: 'apothecary' }).name, 'Salt-and-Ash Dispensary');
    assert.equal(host.query('trade.stock', { kind: 'smith' }).pack, undefined);

    const r = host.command('trade.buy', { shop: stores.shop, def: 'pack.e/trail-rations', qty: 2 });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.receipt.summary, 'Ren bought 2 Trail Rations from Watch Stores for 36 gold.');
    assert.equal(coin(host), 20000 - 36);
    assert.deepEqual(currentShops(host.state.domains.trade.shops)[stores.shop], { day: null, bought: ['pack.e/trail-rations', 'pack.e/trail-rations'] });
    assert.equal(host.query('trade.stock', { kind: 'watch-stores' }).items[0].left, 1);
    const more = host.command('trade.buy', { shop: stores.shop, def: 'pack.e/trail-rations', qty: 2 });
    assert.deepEqual([more.code, more.message], ['NOT_ENOUGH', 'Watch Stores has only 1 Trail Rations left today.']);
    assert.deepEqual(validateTrade(host.state.domains.trade), []);
});

test('a pack shop restocks by the day and pauses in a shortage; a place without pack shops trades generically', () => {
    const host = createHost(withPacks, { state: baseState({ coin: 20000, minutes: 2 * DAY }), time: 2 * DAY });
    const shop = 'bluewatch village|watch-stores';
    assert.equal(host.command('trade.buy', { shop, def: 'pack.e/trail-rations', qty: 3 }).ok, true);
    assert.equal(host.query('trade.stock', { kind: 'watch-stores' }).items.length, 1);
    host.capture(BLOCKADE);
    host.time = 3 * DAY;
    host.state.domains.director.time.minutes = 3 * DAY;
    const paused = host.query('trade.stock', { kind: 'watch-stores' });
    assert.deepEqual(paused.items.map(item => [item.def.id, item.price]), [['pack.e/minor-healing-draught', 4500]], 'no restock; the pack price × 150%');
    host.capture(LIFT);
    assert.deepEqual(host.query('trade.stock', { kind: 'watch-stores' }).items.map(item => [item.def.id, item.left]), [['pack.e/trail-rations', 3], ['pack.e/minor-healing-draught', 2]]);
    const plain = createHost(withPacks, { state: baseState({ place: { name: 'Millbrook Village', kind: 'settlement' } }) });
    assert.equal(plain.query('trade.shops'), null);
    assert.equal(plain.query('trade.stock', { kind: 'general' }).pack, undefined);
});

test('selling starts from the item\'s own value (a pack\'s numbers), then v1\'s rate, buyer and place', () => {
    const state = baseState();
    state.domains.inventory.defs['pack.e/cane-blade'] = def('pack.e/cane-blade', 'Cane-Blade', { kind: 'equipment', slot: 'weapon', stack: false, value: 600, stats: { ATK: 4 } });
    state.domains.inventory.defs['pack.e/minor-healing-draught'] = def('pack.e/minor-healing-draught', 'Minor Healing Draught', { kind: 'consumable', value: 2000, effect: { heal: 20 } });
    state.domains.inventory.stacks.it_00000009 = stack('it_00000009', 'pack.e/cane-blade', 1);
    state.domains.inventory.stacks.it_00000010 = stack('it_00000010', 'pack.e/minor-healing-draught', 1);
    state.domains.scene.place = { name: 'Bluewatch Village', kind: 'village' };
    const host = createHost(part, { state });
    // 600 × 0.5 (v1 sell rate) × 1 (general store, gear) × 0.85 (a village pays less) = 255.
    assert.equal(host.query('trade.quote', { type: 'sell', stack: 'it_00000009', qty: 1 }).each, 255);
    // 2000 × 0.5 × 1.3 (an apothecary pays well for potions) × 0.85 = 1105.
    assert.equal(host.query('trade.quote', { type: 'sell', stack: 'it_00000010', qty: 1, kind: 'apothecary' }).each, 1105);
    assert.equal(host.query('trade.quote', { type: 'sell', stack: 'it_00000009', qty: 1, kind: 'fence' }).each, 153);
});

test('pack shops resolve a place definition id before matching the current scene', () => {
    const module = { ...part, queries: { ...part.queries, 'packs.content': (_state, args) => structuredClone({
        shops: [{ ...PACK_SHOPS[0], place: 'pack.e/bluewatch-village' }],
        places: [{ id: 'pack.e/bluewatch-village', name: 'Bluewatch Village' }],
        items: PACK_ITEMS,
    }[args?.kind] ?? []) } };
    const host = createHost(module, { state: baseState({ coin: 20000, place: { name: 'Bluewatch Village', kind: 'village' } }) });
    const stores = host.query('trade.stock', { kind: 'watch-stores' });
    assert.equal(stores.pack, true);
    assert.equal(stores.shop, 'bluewatch village|watch-stores');
    assert.deepEqual(stores.items.map(item => item.def.id), PACK_ITEMS.map(item => item.id));
});
