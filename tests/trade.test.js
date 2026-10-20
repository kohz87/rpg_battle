// The Trade tab's numbers and what a trade does to the Inventory (src/trade.js, 0.5.37).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES } from '../src/rules.js';
import { craftPlan } from '../src/craft.js';
import { parseInventory, purseOf, spendMoney } from '../src/items.js';
import { buyerKind, collectIn, craftFee, craftIn, itemWorth, kindOf, ordersIn, placePrices, sellIn, sellPrice, sellable, tradeHandoff, tradeLine, commissionHours, craftSpan, readyAt, readyDateText, readyWords, orderReadyAt, orderDue } from '../src/trade.js';

const INV = [
    'Coin Pouch | 1 | 6 silver, 5 copper',
    '[Equipment > Weapons]',
    'Cane-Blade | 1 | Equipped · Common · ATK +2',
    '[Gear]',
    'Rope | 1 | 30 ft',
    '[Loot]',
    'Minor Healing Draught | 2 | heal 20',
    'Brood-Mother Skull | 1 | uncommon material · MDEF',
    'Rat Tail | 5 | material · AGI, poison',
    'Grave Ring | 1 | rare · MDEF +6, INT +2',
].join('\n');
const item = name => parseInventory(INV).items.find(entry => entry.name === name);

test('worth: gear by its stats and rarity, a potion by what it does, a material by rarity', () => {
    assert.equal(kindOf(item('Grave Ring')), 'equipment');
    assert.equal(kindOf(item('Minor Healing Draught')), 'consumable');
    assert.equal(kindOf(item('Brood-Mother Skull')), 'material');
    assert.equal(kindOf(item('Rope')), 'goods');
    assert.equal(itemWorth(item('Minor Healing Draught')), 20 * DEFAULT_RULES.trade.effect.heal);
    assert.equal(itemWorth(item('Brood-Mother Skull')), DEFAULT_RULES.trade.material.uncommon);
    assert.ok(itemWorth(item('Grave Ring'), { level: 5 }) > itemWorth(item('Brood-Mother Skull')));
});

test('a place prices by its name; the reader\'s word for it scales both ways', () => {
    assert.deepEqual(placePrices('Bluewatch Village | Adventurer Guild Post'), { tier: 'village', buy: 0.9, sell: 0.85, level: null });
    // The settlement's own name first: a market square in a village is still the village.
    assert.equal(placePrices('Bluewatch Village | Market Square').tier, 'village');
    assert.equal(placePrices('Auvoth City').tier, 'city');
    assert.equal(placePrices('Somewhere new').tier, 'town');
    const dear = placePrices('Bluewatch Village', { level: 'dear' });
    assert.equal(dear.sell, 0.85 * DEFAULT_RULES.trade.levels.dear);
});

test('who trades: by name; a specialist pays more in their line, a fence less for all', () => {
    assert.equal(buyerKind('the bone-carver'), 'crafter');
    assert.equal(buyerKind('Village apothecary'), 'apothecary');
    assert.equal(buyerKind('Guild clerk Elke'), 'guild');
    assert.equal(buyerKind('Elke'), 'general');
    const prices = placePrices('Bluewatch Village');
    const draught = buyer => sellPrice(item('Minor Healing Draught'), { buyer, prices });
    assert.ok(draught('apothecary') > draught('general'));
    assert.ok(draught('general') > draught('fence'));
    const ring = buyer => sellPrice(item('Grave Ring'), { buyer, prices, level: 5 });
    assert.ok(ring('smith') > ring('apothecary'));
});

test('selling: the row comes down and the purse goes up; worn gear, the purse and orders are not for sale', () => {
    assert.deepEqual(sellable(INV).map(entry => entry.name), ['Rope', 'Minor Healing Draught', 'Brood-Mother Skull', 'Rat Tail', 'Grave Ring']);
    const { text, total } = sellIn(INV, { name: 'Rat Tail', qty: 3, each: 2 });
    assert.equal(total, 6);
    assert.match(text, /^Rat Tail \| 2 \| material · AGI, poison$/m);
    assert.equal(purseOf(text).total, purseOf(INV).total + 6);
    assert.doesNotMatch(sellIn(INV, { name: 'Grave Ring', qty: 1, each: 50 }).text, /Grave Ring/);
});

test('making and ordering: the fee is paid, the materials go, the piece is made or waits on order; collecting it', () => {
    const [plan] = craftPlan(INV, [{ name: 'Skull Ring', materials: [{ name: 'Brood-Mother Skull', qty: 1 }], slot: null }], { level: 2 });
    const fee = craftFee(plan.item, { prices: placePrices('Bluewatch Village'), level: 2 });
    assert.ok(fee > 0);
    const made = craftIn(INV, plan, { fee });
    assert.ok(made.ok);
    assert.equal(purseOf(made.text).total, purseOf(INV).total - fee);
    assert.match(made.text, /Skull Ring \| 1 \| uncommon · MDEF \+\d+/);
    assert.doesNotMatch(made.text, /Brood-Mother Skull/);
    const ordered = craftIn(INV, { ...plan, order: 'Goldwane 14' }, { fee, from: 'the bone-carver' });
    assert.match(ordered.text, /\[On Order\]\nSkull Ring \| 1 \| uncommon · MDEF \+\d+ · on order with the bone-carver, ready Goldwane 14/);
    assert.deepEqual(ordersIn(ordered.text).map(entry => entry.name), ['Skull Ring']);
    const collected = collectIn(ordered.text, 'Skull Ring').text;
    assert.match(collected, /^Skull Ring \| 1 \| uncommon · MDEF \+\d+$/m);
    assert.deepEqual(ordersIn(collected), []);
    assert.doesNotMatch(collected, /\[On Order\]/, 'no empty section left');
    // A purse that cannot pay: nothing changes.
    assert.deepEqual(craftIn(INV, plan, { fee: 99999 }), { text: INV, ok: false });
    assert.equal(spendMoney(INV, 99999).ok, false);
});

test('the note the next reply gets: one errand run, grouped by trader, amounts as they are (0.5.38)', () => {
    const entries = [
        { kind: 'sell', name: 'Rat Tail', qty: 3, total: 6, who: 'the apothecary' },
        { kind: 'order', name: 'Skull Ring', from: ['Brood-Mother Skull'], ready: 'Goldwane 14, 01:15 pm', fee: 12, who: 'the bone-carver' },
        { kind: 'buy', name: 'Antidote', total: 7, who: 'the apothecary' },
    ];
    assert.equal(tradeLine(entries[0]), 'sold 3 Rat Tail to the apothecary for 6 copper');
    const note = tradeHandoff(entries, { name: 'Astra', place: 'Bluewatch Village' });
    assert.match(note, /^\[Trade\] Since the last reply, Astra went round Bluewatch Village: at the apothecary, sold 3 Rat Tail for 6 copper, bought Antidote for 7 copper; at the bone-carver, ordered Skull Ring, made from Brood-Mother Skull, ready Goldwane 14, 01:15 pm, for 1 silver, 2 copper\./);
    assert.match(note, /Tell it briefly as part of the scene.*No menus or game terms/);
    assert.ok(note.split('\n').length <= 3, 'a few lines');
    // One trader: plain lines that say who.
    assert.match(tradeHandoff([entries[2]], { name: 'Astra' }), /^\[Trade\] Since the last reply, Astra bought Antidote from the apothecary for 7 copper\./);
    assert.equal(tradeHandoff([]), '');
});

test('shop stock: by trade and place, the same all day, something new after what they offered before (0.5.38)', async () => {
    const { shopStock, rememberStock, buyIn } = await import('../src/trade.js');
    const village = placePrices('Bluewatch Village');
    const one = shopStock({ kind: 'smith', prices: village, seed: 'bluewatch|smith|12', level: 2 });
    assert.deepEqual(shopStock({ kind: 'smith', prices: village, seed: 'bluewatch|smith|12', level: 2 }), one, 'same seed, same stock');
    assert.ok(one.length >= 5 && one.every(item => item.kind === 'equipment' && Object.keys(item.stats).length === 1 && item.price > 0));
    assert.ok(!one.some(item => item.name === 'Longsword' || item.name === 'Chain Shirt'), 'town goods are not in a village');
    const next = shopStock({ kind: 'smith', prices: village, seed: 'bluewatch|smith|13', level: 2, seen: rememberStock([], one) });
    assert.ok(next.filter(item => !one.some(old => old.name === item.name)).length >= 2, 'a restock brings what they did not have');
    const potions = shopStock({ kind: 'apothecary', prices: village, seed: 'x' });
    assert.ok(potions.every(item => item.kind === 'consumable' && item.effect));
    const draught = potions.find(item => item.name === 'Minor Healing Draught') ?? potions[0];
    const bought = buyIn(INV, draught);
    assert.ok(bought.ok);
    assert.equal(purseOf(bought.text).total, purseOf(INV).total - draught.price);
    assert.ok(parseInventory(bought.text).items.some(entry => entry.name === draught.name && entry.effect));
    assert.equal(buyIn(INV, { ...draught, price: 99999 }).ok, false);
    assert.equal(tradeLine({ kind: 'buy', name: 'Antidote', total: 7, who: 'Elke' }), 'bought Antidote from Elke for 7 copper');
    assert.equal(rememberStock(Array.from({ length: 50 }, (_, i) => `x${i}`), []).length, 40);
});

test('selling a companion\'s item: from their section, the coin into your purse (0.5.40)', () => {
    const text = 'Coin Pouch | 1 | 2 silver\n[Lyra > Herbs]\nWolfsbane | 3 | material';
    const members = ['Lyra'];
    const { text: sold, total } = sellIn(text, { name: 'Wolfsbane', qty: 2, each: 3 }, DEFAULT_RULES.currency, { members, owner: 'Lyra' }, { members, owner: null });
    assert.equal(total, 6);
    assert.match(sold, /\[Lyra > Herbs\]\nWolfsbane \| 1 \| material/);
    assert.match(sold, /^Coin Pouch \| 1 \| 2 silver, 6 copper$/m);
});

// A calendar of two 30-day months, written as Story Director writes it ("CY 611, Goldwane 12, 01:15 pm").
const calendarFormat = abs => {
    const day = Math.floor(abs / 1440);
    const minutes = abs % 1440;
    const month = ['Goldwane', 'Haywane'][Math.floor(day / 30) % 2];
    const hour = Math.floor(minutes / 60);
    return `CY 611, ${month} ${(day % 30) + 1}, ${String(hour % 12 || 12).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
};
const goldwane12 = 11 * 1440 + 13 * 60 + 15;

test('a commission takes the crafter\'s time: by rarity, faster in their line, slower in a small place, the same each time (0.5.44)', () => {
    const ring = { rarity: 'uncommon', slot: 'accessory' };
    const seed = 'bluewatch|crafter|skull ring|11';
    const hours = commissionHours(ring, { crafter: 'crafter', tier: 'town', seed });
    assert.equal(commissionHours(ring, { crafter: 'crafter', tier: 'town', seed }), hours, 'the same draw for the same day, place, crafter and piece');
    assert.ok(hours >= 18 * 0.75 && hours <= 30 * 0.75, `${hours}`);
    // Outside their line (a smith's ring) slower; a hamlet slower than a city.
    assert.ok(commissionHours(ring, { crafter: 'smith', tier: 'town', seed }) > hours);
    assert.ok(commissionHours(ring, { crafter: 'crafter', tier: 'remote', seed }) > commissionHours(ring, { crafter: 'crafter', tier: 'city', seed }));
    // Rarer takes longer.
    assert.ok(commissionHours({ rarity: 'common', slot: 'accessory' }, { crafter: 'crafter', seed }) < hours);
    assert.ok(commissionHours({ rarity: 'rare', slot: 'accessory' }, { crafter: 'crafter', seed }) > hours);
    assert.deepEqual([4, 20, 49, 140, 168].map(craftSpan), ['a few hours', 'a day', 'two days', 'six days', 'a week']);
});

test('the ready time on the story calendar: written on the row, read back, said from now; Collect waits for it (0.5.44)', () => {
    const at = readyAt(5, goldwane12);
    assert.equal(at, goldwane12 - 15 + 5 * 60 + 60, 'on the hour after');
    assert.equal(readyDateText(at, calendarFormat), 'Goldwane 12, 07:00 pm');
    assert.equal(readyWords(at, goldwane12, calendarFormat), 'this evening');
    assert.equal(readyWords(readyAt(20, goldwane12), goldwane12, calendarFormat), 'tomorrow morning');
    const later = readyAt(49, goldwane12);
    assert.equal(readyWords(later, goldwane12, calendarFormat), 'Goldwane 14');
    const note = `uncommon · MDEF +4 · on order with the bone-carver, ready ${readyDateText(later, calendarFormat)}`;
    assert.equal(orderReadyAt(note, { now: goldwane12, format: calendarFormat }), later);
    assert.equal(orderDue(note, { now: goldwane12, format: calendarFormat }), false);
    assert.equal(orderDue(note, { now: later, format: calendarFormat }), true);
    // No clock: a span, and Collect is not held back.
    assert.equal(readyAt(5, null), null);
    assert.equal(orderDue('on order with the bone-carver, ready in about two days', { now: goldwane12, format: calendarFormat }), true);
    assert.equal(orderDue(note, { now: null, format: null }), true);
});

test('the next reply hears the crafter\'s word: how long and when to come back (0.5.44)', () => {
    const entry = { kind: 'order', name: 'Skull Ring', from: ['Brood-Mother Skull'], fee: 9, ready: 'Goldwane 14, 03:00 pm', when: 'Goldwane 14', span: 'two days', who: 'the bone-carver' };
    assert.equal(tradeLine(entry), 'commissioned Skull Ring from the bone-carver, made from Brood-Mother Skull, for 9 copper; the bone-carver says two days, ready Goldwane 14, 03:00 pm');
    assert.equal(tradeLine({ ...entry, ready: 'Goldwane 13, 09:00 am', when: 'tomorrow morning', span: 'a day' }), 'commissioned Skull Ring from the bone-carver, made from Brood-Mother Skull, for 9 copper; the bone-carver says a day, ready tomorrow morning (Goldwane 13, 09:00 am)');
    // No story clock: the span alone.
    assert.equal(tradeLine({ ...entry, ready: 'in about two days', when: 'in about two days' }), 'commissioned Skull Ring from the bone-carver, made from Brood-Mother Skull, for 9 copper; the bone-carver says two days');
    const note = tradeHandoff([entry, { kind: 'sell', name: 'Rat Tail', qty: 3, total: 6, who: 'the general store' }], { name: 'Astra', place: 'Bluewatch' });
    assert.match(note, /at the bone-carver, commissioned Skull Ring, made from Brood-Mother Skull, for 9 copper; they say two days, ready Goldwane 14, 03:00 pm/);
});
