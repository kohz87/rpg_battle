// The v2 trade part (MODULES §B4) against a fake host: selling, buying, the market rule, the
// reader's price levels, shop stock, commissions and collecting them, the slice's validator,
// the tail and the queries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part, validateTrade, initialTrade, tradeTail } from '../../../src/v2/trade/index.js';
import { makeWorld, worldFromState, stockOf, legacyItem, DAY } from '../../../src/v2/trade/core.js';
import { commissionHours, placePrices, readyAt, sellPrice } from '../../../src/trade.js';
import { baseState, createHost } from './helpers/fake-ctx.js';

const coin = host => host.state.domains.inventory.wallets.party.coin;
const stackQty = (host, id) => host.state.domains.inventory.stacks[id]?.qty ?? 0;
const snapshot = host => JSON.stringify(host.state);
const rejected = (host, type, payload, code) => {
    const before = snapshot(host);
    const result = host.command(type, payload);
    assert.equal(result.ok, false, `${type} should be refused`);
    if (code) assert.equal(result.code, code, result.message);
    assert.equal(snapshot(host), before, 'nothing is saved on a rejection');
    return result;
};

test('part shape: domain, commands, queries, settings, tab', () => {
    assert.deepEqual(Object.keys(part.domains), ['trade']);
    assert.deepEqual(part.domains.trade.initial(), { orders: {}, shops: {} });
    assert.deepEqual(Object.keys(part.commands).sort(), ['craft.collect', 'craft.commission', 'trade.buy', 'trade.sell']);
    assert.deepEqual(Object.keys(part.queries).sort(), ['trade.market', 'trade.orders', 'trade.quote', 'trade.stock']);
    assert.equal(part.settings.section, 'Trade');
    assert.deepEqual(part.settings.defaults, { placePrices: [] });
    assert.deepEqual(part.settings.schema.placePrices.of.level.choices, ['cheap', 'fair', 'dear']);
    assert.equal(part.tabs[0].id, 'trade');
    assert.equal(typeof part.tabs[0].render, 'function');
    assert.equal(part.context.static(), '');
    assert.equal(part.context.budget, 100);
});

// ---------------------------------------------------------------------------------------
// Selling

test('trade.sell: the stack goes down, the purse up by v1 pricing, told in one line', () => {
    const host = createHost(part, { state: baseState() });
    const world = makeWorld({ scene: host.state.domains.scene, inventory: host.state.domains.inventory, party: host.state.domains.party });
    const each = sellPrice(legacyItem(host.state.domains.inventory.defs['story/rat-tail']), { buyer: 'general', prices: world.prices, level: 3 });
    const result = host.command('trade.sell', { stack: 'it_00000001', qty: 3 });
    assert.equal(result.ok, true, result.message);
    assert.equal(stackQty(host, 'it_00000001'), 2);
    assert.equal(coin(host), 500 + each * 3);
    assert.equal(result.receipt.data.total, each * 3);
    assert.equal(result.receipt.narrate, true);
    assert.match(result.receipt.summary, /^Ren sold 3 Rat Tail to the general store for /);
    assert.deepEqual(host.calls.map(call => call.type), ['inventory.consume', 'wallet.receive']);
});

test('trade.sell: who buys changes the price (an apothecary pays well for parts, a fence little)', () => {
    const host = createHost(part, { state: baseState() });
    const quote = kind => host.query('trade.quote', { type: 'sell', stack: 'it_00000002', qty: 1, kind }).each;
    assert.ok(quote('apothecary') > quote('general'));
    assert.ok(quote('fence') < quote('general'));
    assert.equal(host.query('trade.quote', { type: 'sell', stack: 'it_00000002', qty: 1, who: 'Hesk the bone-carver' }).buyer, 'crafter');
    const result = host.command('trade.sell', { stack: 'it_00000002', qty: 1, kind: 'apothecary' });
    assert.equal(result.receipt.data.total, quote('apothecary'));
    assert.match(result.receipt.summary, /to the apothecary/);
});

test('trade.sell: NOT_ENOUGH, NOT_FOUND, worn, quest and bad counts are refused; nothing saved', () => {
    const host = createHost(part, { state: baseState() });
    assert.match(rejected(host, 'trade.sell', { stack: 'it_00000001', qty: 6 }, 'NOT_ENOUGH').message, /only 5 Rat Tail/);
    rejected(host, 'trade.sell', { stack: 'it_nothere1', qty: 1 }, 'NOT_FOUND');
    assert.match(rejected(host, 'trade.sell', { stack: 'it_00000004', qty: 1 }, 'INVALID').message, /Take off/);
    rejected(host, 'trade.sell', { stack: 'it_00000006', qty: 1 }, 'INVALID');
    rejected(host, 'trade.sell', { stack: 'it_00000001', qty: 0 }, 'INVALID');
    rejected(host, 'trade.sell', { stack: 'it_00000001', qty: 1.5 }, 'INVALID');
});

// ---------------------------------------------------------------------------------------
// The market rule

test('no market (the wilds, nobody trading): every trade is refused, nothing saved', () => {
    const host = createHost(part, { state: baseState({ place: { name: 'Darkwood Hollow', kind: 'wild', region: '' }, present: ['Fenna'] }) });
    assert.equal(host.query('trade.market').open, false);
    for (const [type, payload] of [
        ['trade.sell', { stack: 'it_00000001', qty: 1 }],
        ['trade.buy', { shop: 'general', def: 'trade/rope', qty: 1 }],
        ['craft.commission', { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' }],
        ['craft.collect', { order: 'or_00000001' }],
    ]) assert.match(rejected(host, type, payload, 'INVALID').message, /No market here \(Darkwood Hollow\)/);
});

test('the market opens by the place name, the scene kind, a trader present, or a priced place', () => {
    const open = (place, present = [], settings = {}) => createHost(part, { state: baseState({ place, present }), settings }).query('trade.market').open;
    assert.equal(open({ name: 'Bluewatch Village', kind: '' }), true, 'a settlement word in the name');
    assert.equal(open({ name: 'The Grey Anchor', kind: 'settlement' }), true, 'the scene says settlement');
    assert.equal(open({ name: 'Old North Road', kind: 'wild' }), false);
    assert.equal(open({ name: 'Old North Road', kind: 'wild' }, ['Ossa (peddler)']), true, 'a peddler on the road');
    assert.equal(open({ name: 'Old North Road', kind: 'wild' }, [], { placePrices: [{ place: 'Old North Road', level: 'dear' }] }), true, 'the reader priced it');
    const host = createHost(part, { state: baseState({ place: { name: 'Old North Road', kind: 'wild' }, present: ['Ossa (peddler)'] }) });
    assert.equal(host.command('trade.sell', { stack: 'it_00000001', qty: 1 }).ok, true);
});

// ---------------------------------------------------------------------------------------
// Price levels

test('price levels per place from the settings: cheap < fair < dear, other places by their name', () => {
    const quote = (settings, place = { name: 'Bluewatch Village', kind: 'settlement' }) => {
        const host = createHost(part, { state: baseState({ place }), settings });
        return { sell: host.query('trade.quote', { type: 'sell', stack: 'it_00000002', qty: 1 }).each, market: host.query('trade.market'), buy: host.query('trade.stock', { kind: 'general' }).items.find(item => item.def.id === 'trade/rope')?.price };
    };
    const at = level => quote({ placePrices: [{ place: 'Bluewatch Village', level }] });
    const cheap = at('cheap');
    const fair = at('fair');
    const dear = at('dear');
    assert.equal(cheap.market.level, 'cheap');
    assert.ok(cheap.sell < fair.sell && fair.sell < dear.sell, `${cheap.sell} < ${fair.sell} < ${dear.sell}`);
    assert.equal(fair.market.buy, placePrices('Bluewatch Village', { level: 'fair' }).buy);
    assert.equal(dear.market.sell, placePrices('Bluewatch Village', { level: 'dear' }).sell);
    // Another place's entry leaves this one to its name; a bad level word is ignored.
    assert.equal(quote({ placePrices: [{ place: 'Kingsport', level: 'dear' }] }).market.level, null);
    assert.equal(quote({ placePrices: [{ place: 'Bluewatch Village', level: 'outrageous' }] }).market.level, null);
    // By the name: a village pays less than a city.
    const village = quote({});
    const city = quote({}, { name: 'Highspire City', kind: 'settlement' });
    assert.equal(village.market.tier, 'village');
    assert.equal(city.market.tier, 'city');
    assert.ok(village.sell < city.sell);
});

// ---------------------------------------------------------------------------------------
// Buying and stock

test('trade.buy: pays the stock price, grants the def, and the line leaves the shelf for the day', () => {
    const host = createHost(part, { state: baseState({ minutes: 3 * DAY + 600 }), time: 3 * DAY + 600 });
    const stock = host.query('trade.stock', { kind: 'smith' });
    assert.equal(stock.shop, 'bluewatch village|smith');
    assert.equal(stock.day, 3);
    const item = stock.items[0];
    const result = host.command('trade.buy', { shop: stock.shop, def: item.def.id, qty: 1 });
    assert.equal(result.ok, true, result.message);
    assert.equal(coin(host), 500 - item.price);
    const granted = host.calls.find(call => call.type === 'inventory.grant').payload;
    assert.deepEqual(granted.def, item.def);
    assert.equal(granted.qty, 1);
    assert.equal(granted.from, result.receipt.id);
    assert.ok(host.state.domains.inventory.defs[item.def.id]);
    assert.deepEqual(host.state.domains.trade.shops[stock.shop], { day: 3, bought: [item.def.id] });
    assert.ok(!host.query('trade.stock', { kind: 'smith' }).items.some(entry => entry.def.id === item.def.id));
    assert.match(result.receipt.summary, new RegExp(`^Ren bought ${item.def.name} from the smith for `));
    rejected(host, 'trade.buy', { shop: stock.shop, def: item.def.id, qty: 1 }, 'NOT_FOUND');
    // The next day the shop is restocked.
    host.state.domains.director.time.minutes = 4 * DAY + 600;
    host.time = 4 * DAY + 600;
    assert.equal(host.query('trade.stock', { kind: 'smith' }).day, 4);
});

test('trade.buy: a supply by the count; gear one piece; NOT_ENOUGH money; wrong shop; nothing saved', () => {
    const host = createHost(part, { state: baseState() });
    const general = host.query('trade.stock', { kind: 'general' });
    const supply = general.items.find(item => item.def.kind !== 'equipment');
    const gear = host.query('trade.stock', { kind: 'smith' }).items[0];
    assert.equal(host.command('trade.buy', { shop: 'general', def: supply.def.id, qty: 3 }).ok, true);
    assert.equal(coin(host), 500 - supply.price * 3);
    rejected(host, 'trade.buy', { shop: 'smith', def: gear.def.id, qty: 2 }, 'NOT_ENOUGH');
    rejected(host, 'trade.buy', { shop: 'kingsport|smith', def: gear.def.id, qty: 1 }, 'NOT_FOUND');
    rejected(host, 'trade.buy', { shop: 'smith', def: 'trade/no-such-thing', qty: 1 }, 'NOT_FOUND');
    rejected(host, 'trade.buy', { shop: 'smith', def: gear.def.id, qty: 0 }, 'INVALID');
    const poor = createHost(part, { state: baseState({ coin: 0 }) });
    assert.match(rejected(poor, 'trade.buy', { shop: 'smith', def: gear.def.id, qty: 1 }, 'NOT_ENOUGH').message, /money/);
});

test('stock: per trader kind, place and story day, the same every time asked', () => {
    const world = (place, minutes) => worldFromState(baseState({ place: { name: place, kind: 'settlement' }, minutes }));
    const names = (place, kind, minutes) => stockOf(world(place, minutes), kind).items.map(item => `${item.def.id}@${item.price}`);
    assert.deepEqual(names('Bluewatch Village', 'smith', 2 * DAY), names('Bluewatch Village', 'smith', 2 * DAY + 900), 'same all day');
    assert.notDeepEqual(names('Bluewatch Village', 'smith', 2 * DAY), names('Bluewatch Village', 'apothecary', 2 * DAY), 'by kind');
    const days = new Set([1, 2, 3, 4, 5].map(day => names('Bluewatch Village', 'smith', day * DAY).join(',')));
    assert.ok(days.size > 1, 'another day, another stock');
    const places = new Set(['Bluewatch Village', 'Mossford Village', 'Eastmere Village'].map(place => names(place, 'smith', DAY).join(',')));
    assert.ok(places.size > 1, 'by place');
    assert.deepEqual(names('Bluewatch Village', 'general', null), names('Bluewatch Village', 'general', null), 'no clock: one day');
    // A name is read for its trade.
    assert.equal(stockOf(world('Bluewatch Village', null), 'Mother Greta the herbalist').kind, 'apothecary');
    // Gear's id carries its rarity and the level its stats are sized to.
    const gear = stockOf(world('Bluewatch Village', null), 'smith').items[0].def;
    assert.match(gear.id, /^trade\/[a-z0-9-]+-(common|uncommon|rare|epic)-l3$/);
    assert.equal(gear.stack, false);
});

// ---------------------------------------------------------------------------------------
// Commissions

const NOW = 10 * DAY + 9 * 60;

test('craft.commission: materials and fee taken now, the order ready by the crafter\'s time', () => {
    const host = createHost(part, { state: baseState({ minutes: NOW }), time: NOW });
    const quote = host.query('trade.quote', { type: 'commission', piece: 'Skull Charm', materials: [{ stack: 'it_00000003', qty: 1 }, { stack: 'it_00000002', qty: 2 }], crafter: 'Hesk the bone-carver' });
    assert.equal(quote.ok, true, quote.message);
    const result = host.command('craft.commission', { piece: 'Skull Charm', materials: [{ stack: 'it_00000003', qty: 1 }, { stack: 'it_00000002', qty: 2 }], crafter: 'Hesk the bone-carver' });
    assert.equal(result.ok, true, result.message);
    assert.equal(stackQty(host, 'it_00000003'), 0);
    assert.equal(stackQty(host, 'it_00000002'), 1);
    assert.equal(coin(host), 500 - quote.fee);
    const [order] = Object.values(host.state.domains.trade.orders);
    assert.equal(order.id, `or_${result.receipt.id.slice(3)}`);
    assert.equal(order.piece.name, 'Skull Charm');
    assert.equal(order.piece.kind, 'equipment');
    assert.equal(order.piece.slot, 'accessory');
    // Three uncommon materials: one step up (v1 rules.craft.bumpAt).
    assert.equal(order.piece.rarity, 'rare');
    assert.ok(order.piece.stats.MDEF > 0 && order.piece.stats.ATK > 0, JSON.stringify(order.piece.stats));
    assert.deepEqual(order.piece.tags, ['poison']);
    assert.deepEqual(order.materials, [{ def: 'story/brood-mother-skull', qty: 1 }, { def: 'story/wolf-fang', qty: 2 }]);
    assert.equal(order.fee, quote.fee);
    assert.equal(order.crafter, 'Hesk the bone-carver');
    assert.equal(order.place, 'Bluewatch Village');
    const hours = commissionHours({ rarity: 'rare', slot: 'accessory' }, { crafter: 'crafter', tier: 'village', seed: `bluewatch village|crafter|skull charm|10` });
    assert.equal(order.ready, readyAt(hours, NOW));
    assert.match(result.receipt.summary, /^Ren commissioned Skull Charm from Hesk the bone-carver, made from Brood-Mother Skull, 2 Wolf Fang, for .+; Hesk the bone-carver says /);
    assert.deepEqual(validateTrade(host.state.domains.trade), []);
});

test('craft.commission: a specialist is faster in their own line; no clock leaves the ready time open', () => {
    const plan = crafter => createHost(part, { state: baseState({ minutes: NOW }), time: NOW }).query('trade.quote', { type: 'commission', piece: { name: 'Fang Blade', slot: 'weapon' }, materials: [{ stack: 'it_00000002', qty: 1 }], crafter });
    const smith = plan('smith');
    const crafter = plan('crafter');
    assert.equal(smith.piece.slot, 'weapon');
    assert.equal(smith.hours, commissionHours(smith.piece, { crafter: 'smith', tier: 'village', seed: 'bluewatch village|smith|fang blade|10' }));
    assert.equal(crafter.hours, commissionHours(crafter.piece, { crafter: 'crafter', tier: 'village', seed: 'bluewatch village|crafter|fang blade|10' }));
    // The same draw, in and out of their line: specialist ×0.75, outside ×1.25.
    const same = { tier: 'village', seed: 'x' };
    assert.ok(commissionHours(smith.piece, { ...same, crafter: 'smith' }) < commissionHours(smith.piece, { ...same, crafter: 'crafter' }));
    assert.equal(smith.ready, readyAt(smith.hours, NOW));
    const host = createHost(part, { state: baseState() });
    const result = host.command('craft.commission', { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' });
    assert.equal(result.ok, true, result.message);
    const [order] = Object.values(host.state.domains.trade.orders);
    assert.equal(order.ready, null);
    assert.equal(order.crafter, 'the bone-carver');
    assert.match(result.receipt.summary, /says (a few hours|a day|two days)/);
});

test('craft.commission: refused for a non-crafter, no piece, no or wrong materials, too few, an empty purse', () => {
    const host = createHost(part, { state: baseState() });
    const base = { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'smith' };
    assert.match(rejected(host, 'craft.commission', { ...base, crafter: 'general' }, 'INVALID').message, /Only a smith/);
    rejected(host, 'craft.commission', { ...base, crafter: '' }, 'INVALID');
    rejected(host, 'craft.commission', { ...base, piece: '  ' }, 'INVALID');
    rejected(host, 'craft.commission', { ...base, materials: [] }, 'INVALID');
    assert.match(rejected(host, 'craft.commission', { ...base, materials: [{ stack: 'it_00000005', qty: 1 }] }, 'INVALID').message, /not a material/);
    rejected(host, 'craft.commission', { ...base, materials: [{ stack: 'it_00000004', qty: 1 }] }, 'INVALID');
    rejected(host, 'craft.commission', { ...base, materials: [{ stack: 'it_nothere1', qty: 1 }] }, 'NOT_FOUND');
    rejected(host, 'craft.commission', { ...base, materials: [{ stack: 'it_00000002', qty: 2 }, { stack: 'it_00000002', qty: 2 }] }, 'NOT_ENOUGH');
    const poor = createHost(part, { state: baseState({ coin: 0 }) });
    rejected(poor, 'craft.commission', base, 'NOT_ENOUGH');
});

test('craft.collect: only when ready by the story clock, at a market, and only once (claim)', () => {
    const host = createHost(part, { state: baseState({ minutes: NOW }), time: NOW });
    const made = host.command('craft.commission', { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' });
    const id = made.receipt.data.order;
    const order = host.state.domains.trade.orders[id];
    assert.ok(order.ready > NOW);
    assert.equal(host.query('trade.orders')[0].due, false);
    assert.match(rejected(host, 'craft.collect', { order: id }, 'INVALID').message, /not ready yet/);
    // Time passes; away from a market it waits.
    host.time = order.ready;
    host.state.domains.director.time.minutes = order.ready;
    host.state.domains.scene.place = { name: 'Darkwood Hollow', kind: 'wild' };
    rejected(host, 'craft.collect', { order: id }, 'INVALID');
    host.state.domains.scene.place = { name: 'Bluewatch Village', kind: 'settlement' };
    const result = host.command('craft.collect', { order: id });
    assert.equal(result.ok, true, result.message);
    assert.equal(host.state.domains.trade.orders[id], undefined);
    assert.equal(host.state.meta.claims[`order:${id}:collected`], true);
    const granted = host.calls.filter(call => call.type === 'inventory.grant').at(-1).payload;
    assert.deepEqual(granted.def, order.piece);
    assert.match(result.receipt.summary, /^Ren collected Fang Charm from the bone-carver\.$/);
    assert.match(rejected(host, 'craft.collect', { order: id }, 'CLAIMED').message, /already been collected/);
    rejected(host, 'craft.collect', { order: 'or_zzzzzzzz' }, 'NOT_FOUND');
});

test('craft.collect: an order without a ready time (no clock) can be collected at once', () => {
    const host = createHost(part, { state: baseState() });
    const id = host.command('craft.commission', { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' }).receipt.data.order;
    assert.equal(host.command('craft.collect', { order: id }).ok, true);
});

test('the same receipt makes the same order id (replaying a receipt gives the same result)', () => {
    const run = () => {
        const host = createHost(part, { state: baseState({ minutes: NOW }), time: NOW });
        host.command('craft.commission', { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' }, { receiptId: 'rc_k3f9a2qz' });
        return host.state;
    };
    assert.deepEqual(run(), run());
    assert.ok(run().domains.trade.orders.or_k3f9a2qz);
});

// ---------------------------------------------------------------------------------------
// The validator, the tail, the queries, the coins

test('validateTrade: the initial slice passes; bad shapes are named', () => {
    assert.deepEqual(validateTrade(initialTrade()), []);
    assert.ok(validateTrade(null).length);
    const piece = { id: 'craft/abcd1234', name: 'Ring' };
    const good = { id: 'or_abcd1234', piece, materials: [{ def: 'story/wolf-fang', qty: 1 }], fee: 3, ready: null, crafter: 'the smith', place: 'X' };
    assert.deepEqual(validateTrade({ orders: { or_abcd1234: good }, shops: { 'x|smith': { day: null, bought: [] } } }), []);
    assert.ok(validateTrade({ orders: { or_abcd1234: { ...good, fee: 1.5 } }, shops: {} }).some(error => /fee/.test(error)));
    assert.ok(validateTrade({ orders: { or_abcd1234: { ...good, ready: -1 } }, shops: {} }).some(error => /ready/.test(error)));
    assert.ok(validateTrade({ orders: { bad: { ...good, id: 'bad' } }, shops: {} }).some(error => /id/.test(error)));
    assert.ok(validateTrade({ orders: { or_abcd1234: { ...good, materials: [{ def: 'x', qty: 0 }] } }, shops: {} }).some(error => /materials/.test(error)));
    assert.ok(validateTrade({ orders: {}, shops: { 'x|smith': { day: 1.5, bought: [] } } }).some(error => /day/.test(error)));
    assert.ok(validateTrade({ orders: {}, shops: { nokey: { day: 1, bought: [] } } }).some(error => /key/.test(error)));
});

test('tail: only orders ready to collect, one short line; nothing when none is ready', () => {
    const host = createHost(part, { state: baseState({ minutes: NOW }), time: NOW });
    assert.deepEqual(tradeTail(host.view()), { lines: [], optional: [] });
    host.command('trade.sell', { stack: 'it_00000001', qty: 1 });
    assert.deepEqual(tradeTail(host.view()).lines, [], 'a sale is told by its receipt, not the tail');
    const id = host.command('craft.commission', { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' }).receipt.data.order;
    assert.deepEqual(tradeTail(host.view()).lines, [], 'not ready yet');
    host.state.domains.director.time.minutes = host.state.domains.trade.orders[id].ready;
    const { lines } = tradeTail(host.view());
    assert.deepEqual(lines, ['[Trade] Ready to collect at a market: Fang Charm (the bone-carver, Bluewatch Village).']);
    assert.ok(lines.join('\n').length / 4 <= part.context.budget);
});

test('tail: many ready orders stay within the budget', () => {
    const host = createHost(part, { state: baseState() });
    for (let i = 0; i < 3; i++) host.command('craft.commission', { piece: `Rat Tail Whip ${i}`, materials: [{ stack: 'it_00000001', qty: 1 }], crafter: 'crafter' });
    host.command('craft.commission', { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' });
    host.command('craft.commission', { piece: 'Fang Ring', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' });
    assert.equal(Object.keys(host.state.domains.trade.orders).length, 5);
    const [line] = tradeTail(host.view()).lines;
    assert.match(line, /and 1 more\.$/);
    assert.ok(line.length / 4 <= part.context.budget, `${line.length} chars`);
});

test('queries: trade.market and trade.orders read the state as it is; a bad quote type says so', () => {
    const host = createHost(part, { state: baseState() });
    assert.deepEqual(host.query('trade.market'), { open: true, by: 'place', place: 'Bluewatch Village', tier: 'village', buy: 0.9, sell: 0.85, level: null, day: null });
    assert.deepEqual(host.query('trade.orders'), []);
    assert.equal(host.query('trade.quote', { type: 'steal' }).ok, false);
    assert.equal(host.query('trade.quote', { type: 'sell', stack: 'it_00000001', qty: 9 }).code, 'NOT_ENOUGH');
});

test('coins: the currency hook words the summary; without it, the rules\' copper, silver, gold', () => {
    const crowns = { tiers: [{ name: 'penny', rate: 1 }, { name: 'crown', rate: 100 }], single: 'coins' };
    const host = createHost(part, { state: baseState(), hook: name => (name === 'currency' ? crowns : null) });
    const result = host.command('trade.sell', { stack: 'it_00000002', qty: 3 });
    assert.match(result.receipt.summary, /penny|crown/);
    const plain = createHost(part, { state: baseState() });
    assert.match(plain.command('trade.sell', { stack: 'it_00000002', qty: 3 }).receipt.summary, /copper|silver|gold/);
});
