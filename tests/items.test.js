import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, rarityBudget } from '../src/rules.js';
import {
    addLoot, capItem, consumables, equipped, formatGearEntry, formatMoney, gearBonuses, gearLimits, gearSummary, parseGearEntry, parseInventory, parseMoney, purseOf,
    effectByName, keepNotes, restoreLoot, spendMoney, useItems,
} from '../src/items.js';

const R = DEFAULT_RULES;
const COINS = R.currency;
const SINGLE = { ...R.currency, mode: 'single', single: 'coins' };
const CUSTOM = { mode: 'tiers', tiers: [{ name: 'bits', rate: 1 }, { name: 'marks', rate: 12 }, { name: 'crowns', rate: 20 }], row: 'Purse' };

const INVENTORY = [
    'Coins | 1 gold, 3 silver, 4 copper',
    'Rope | 1 | coiled',
    '',
    '[Equipment > Weapons]',
    'Iron Longsword | 1 | equipped · uncommon · ATK +6, DEX -1',
    'Hunter\'s Bow | 1 | rare · ATK +5, DEX +2, range',
    '',
    '[Equipment > Armour]',
    'Studded Jerkin | 1 | equipped · common · DEF +4',
    'Oak Buckler | 1 | equipped',
    '',
    '[Consumables]',
    'Healing Draught | 3 | heal 30',
    'Ember Flask | 1 | fire 25, all enemies',
    'Ether | 2 | mp 20',
    'Antidote | 1 | cure poison, burn',
    '',
    '[Keepsakes]',
    'Mother\'s Ring | 1 | silver, worn smooth',
].join('\n');

const byName = (items, name) => items.find(item => item.name === name);

test('a section marked "(empty)" holds no item, and loads its loot without the mark (0.5.19)', () => {
    const text = 'Rope | 1 | coiled\n\n[Loot]\n(empty)\n\n[Spare]\n*(None)*\n\n[Gear]\n- none\nKnife | 1 | work';
    assert.deepEqual(parseInventory(text).items.map(item => [item.name, item.category]), [['Rope', ''], ['Knife', 'Gear']]);
    const looted = addLoot(text, { items: [{ name: 'Wolf Pelt', qty: 2, category: 'Loot' }] });
    assert.match(looted, /\[Loot\]\nWolf Pelt \| 2/);
    assert.doesNotMatch(looted, /\(empty\)/);
    assert.match(looted, /\[Spare\]\n\*\(None\)\*/, 'a section still empty keeps its mark');
    assert.doesNotMatch(looted, /- none/);
});

test('parseInventory reads every row with its category and raw text', () => {
    const { items } = parseInventory(INVENTORY);
    assert.equal(items.length, 11);
    assert.deepEqual(items.map(item => item.category), [
        '', '', 'Equipment > Weapons', 'Equipment > Weapons', 'Equipment > Armour', 'Equipment > Armour',
        'Consumables', 'Consumables', 'Consumables', 'Consumables', 'Keepsakes',
    ]);
    assert.equal(byName(items, 'Rope').raw, 'Rope | 1 | coiled');
    assert.equal(byName(items, 'Healing Draught').qty, 3);
});

test('equipment: slot from category, equipped mark, rarity, stats and tags', () => {
    const { items } = parseInventory(INVENTORY);
    const sword = byName(items, 'Iron Longsword');
    assert.deepEqual(
        [sword.slot, sword.equipped, sword.rarity, sword.stats, sword.tags, sword.effect],
        ['weapon', true, 'uncommon', { ATK: 6, DEX: -1 }, [], null],
    );
    const bow = byName(items, 'Hunter\'s Bow');
    assert.deepEqual([bow.slot, bow.equipped, bow.rarity, bow.tags], ['weapon', false, 'rare', ['range']]);
    assert.equal(byName(items, 'Studded Jerkin').slot, 'armour');
    // A shield listed under Armour is still an off-hand.
    assert.equal(byName(items, 'Oak Buckler').slot, 'offhand');
    assert.equal(byName(items, 'Oak Buckler').rarity, 'common');
    // A keepsake ring outside an equipment category, with no mark or stats, is not gear.
    assert.equal(byName(items, 'Mother\'s Ring').slot, null);
    assert.equal(byName(items, 'Rope').slot, null);
});

test('equipment is recognised from note words, slot: and the stat forms', () => {
    const text = [
        '[Bag]',
        '- **Ember Wand** | 1 | equipped · epic · MATK +8, fire, crit +3%',
        'Lucky Feather | 1 | equipped, slot: accessory, LUK +2',
        'Greataxe | 1 | +9 ATK, -2 AGI, two-handed',
        'Old Cloak | 1 | not equipped, rare',
        'Strange Idol | 1 | INT +2',
        'Mana Potion | 2 | MP +20',
    ].join('\n');
    const { items } = parseInventory(text);
    const wand = byName(items, 'Ember Wand');
    assert.deepEqual([wand.slot, wand.equipped, wand.rarity, wand.stats, wand.tags], ['weapon', true, 'epic', { MATK: 8, crit: 3 }, ['fire']]);
    assert.deepEqual([byName(items, 'Lucky Feather').slot, byName(items, 'Lucky Feather').stats], ['accessory', { LUK: 2 }]);
    const axe = byName(items, 'Greataxe');
    assert.deepEqual([axe.slot, axe.stats, axe.tags], ['weapon', { ATK: 9, AGI: -2 }, ['two-handed']]);
    assert.deepEqual([byName(items, 'Old Cloak').slot, byName(items, 'Old Cloak').equipped], ['armour', false]);
    assert.equal(byName(items, 'Strange Idol').slot, 'accessory');
    const potion = byName(items, 'Mana Potion');
    assert.deepEqual([potion.slot, potion.effect], [null, { mp: 20 }]);
});

test('lenient rows: tables, bullets, escaped pipes, bracketed rows, wrapper tags', () => {
    const text = [
        '<Inventory>',
        '| Item | Qty | Note |',
        '|---|---|---|',
        '| Rope | 2 | coiled |',
        '* Map | 1 | North \\| South roads',
        '[Spare Rope | 1 | frayed]',
        '**[Armor]**',
        '1. Chainmail | 1 | equipped',
        '</Inventory>',
    ].join('\n');
    const { items } = parseInventory(text);
    assert.deepEqual(items.map(item => [item.name, item.qty, item.category, item.note]), [
        ['Rope', 2, '', 'coiled'],
        ['Map', 1, '', 'North | South roads'],
        ['Spare Rope', 1, '', 'frayed'],
        ['Chainmail', 1, 'Armor', 'equipped'],
    ]);
    assert.deepEqual([items[3].slot, items[3].equipped], ['armour', true]);
});

test('consumables: heal, mp, cure and damage effects', () => {
    const { items } = parseInventory(INVENTORY);
    assert.deepEqual(consumables(items).map(item => [item.name, item.effect]), [
        ['Healing Draught', { heal: 30 }],
        ['Ember Flask', { damage: { amount: 25, element: 'fire', target: 'all' } }],
        ['Ether', { mp: 20 }],
        ['Antidote', { cure: ['poison', 'burn'] }],
    ]);
    const more = parseInventory('Frost Bomb | 2 | ice 15\nElixir | 1 | heals 50, restores 10 mp, cures poisoned\nEmpty Vial | 0 | heal 5').items;
    assert.deepEqual(more[0].effect, { damage: { amount: 15, element: 'ice', target: 'one' } });
    assert.deepEqual(more[1].effect, { heal: 50, mp: 10, cure: ['poison'] });
    assert.deepEqual(consumables(more).map(item => item.name), ['Frost Bomb', 'Elixir'], 'none left, not usable');
});

test('capItem keeps an item within budget, scales proportionally and never raises a stat', () => {
    const level = 5;
    const within = capItem({ name: 'Iron Longsword', rarity: 'uncommon', slot: 'weapon', stats: { ATK: 6, DEX: -1 } }, level, R);
    assert.deepEqual(within, { stats: { ATK: 6, DEX: -1 }, capped: false, budget: rarityBudget('uncommon', level, R), cost: 5 });

    const huge = capItem({ name: 'Godslayer', rarity: 'uncommon', slot: 'weapon', stats: { ATK: 50 } }, level, R);
    assert.equal(huge.capped, true);
    assert.equal(huge.cost, 50);
    assert.deepEqual(huge.stats, { ATK: 8 });

    const mixed = capItem({ name: 'Axe', rarity: 'common', slot: 'weapon', stats: { ATK: 10, STR: 2, DEX: -2 } }, 4, R);
    assert.equal(mixed.capped, true);
    assert.deepEqual(mixed.stats, { ATK: 4, STR: 1, DEX: -2 }, 'negatives stay; positives shrink together');
    for (const name of ['ATK', 'STR']) assert.ok(mixed.stats[name] <= { ATK: 10, STR: 2 }[name]);

    const spread = capItem({ name: 'Crown', rarity: 'rare', slot: 'accessory', stats: { HP: 100, MP: 40, crit: 10, LUK: 3 } }, 1, R);
    const cost = s => (s.HP ?? 0) * 0.2 + (s.MP ?? 0) * 0.25 + (s.crit ?? 0) * 0.5 + (s.LUK ?? 0) * 2;
    assert.ok(cost(spread.stats) <= spread.budget);
    assert.ok(Object.values(spread.stats).every(Number.isInteger));
});

test('capItem gives a stat-less item its budget on its kind\'s main stat', () => {
    const at5 = (name, slot, rarity = 'common', category = '') => capItem({ name, slot, rarity, category, stats: {} }, 5, R).stats;
    assert.deepEqual(at5('Iron Sword', 'weapon'), { ATK: 4 });
    assert.deepEqual(at5('Hunting Bow', 'weapon', 'uncommon'), { ATK: 8 });
    assert.deepEqual(at5('Ashwood Staff', 'weapon', 'rare'), { MATK: 12 });
    assert.deepEqual(at5('Old Tome', 'offhand'), { MATK: 4 });
    assert.deepEqual(at5('Chainmail', 'armour'), { DEF: 4 });
    assert.deepEqual(at5('Kite Shield', 'offhand'), { DEF: 4 });
    assert.deepEqual(at5('Wool Robe', 'armour'), { MDEF: 4 });
    assert.deepEqual(at5('Silver Ring', 'accessory', 'rare'), { LUK: 6 });
    assert.deepEqual(at5('Thing', 'armour', 'common', 'Equipment > Armour'), { DEF: 4 });
    assert.deepEqual(capItem({ name: 'Rope', slot: null, stats: {} }, 5, R), { stats: {}, capped: false, budget: rarityBudget('common', 5, R), cost: 0 });
});

test('equipped picks the first per slot, two accessories, and respects two-handed weapons', () => {
    const items = [
        { name: 'A', slot: 'weapon', equipped: true, tags: ['two-handed'] },
        { name: 'B', slot: 'weapon', equipped: true, tags: [] },
        { name: 'C', slot: 'offhand', equipped: true, tags: [] },
        { name: 'D', slot: 'armour', equipped: false, tags: [] },
        { name: 'E', slot: 'armour', equipped: true, tags: [] },
        { name: 'F', slot: 'accessory', equipped: true, tags: [] },
        { name: 'G', slot: 'accessory', equipped: true, tags: [] },
        { name: 'H', slot: 'accessory', equipped: true, tags: [] },
    ];
    const gear = equipped(items);
    assert.equal(gear.weapon.name, 'A');
    assert.equal(gear.offhand, null);
    assert.equal(gear.armour.name, 'E');
    assert.deepEqual(gear.accessory.map(item => item.name), ['F', 'G']);
    assert.equal(equipped(items.slice(1)).offhand.name, 'C');
    assert.deepEqual(equipped([]), { weapon: null, offhand: null, armour: null, worn: [], accessory: [], unused: [] });
    assert.deepEqual(gear.unused.map(({ item, why }) => [item.name, why]), [
        ['B', 'one weapon counts'],
        ['C', 'A is two-handed'],
        ['H', 'only 2 accessories count'],
    ]);
});

test('helms, gloves, boots and belts are worn pieces, a slot of their own', () => {
    const { items } = parseInventory([
        '[Equipment > Armour]',
        'Iron Helm | 1 | equipped',
        'Chainmail | 1 | equipped',
        'Kite Shield | 1 | equipped',
        '[Equipment]',
        'Leather Gauntlet | 1 | equipped',
        'Travel Boots | 1 | equipped · uncommon',
        'Silver Ring | 1 | equipped',
        '[Gear > Footwear]',
        'Wading Things | 1 | equipped',
        '[Keepsakes]',
        'Plain Band | 1 | slot: worn, equipped',
    ].join('\n'));
    const slot = name => byName(items, name).slot;
    assert.equal(slot('Iron Helm'), 'worn', 'a helm in [Armour] is not the body armour');
    assert.equal(slot('Chainmail'), 'armour');
    assert.equal(slot('Kite Shield'), 'offhand');
    assert.equal(slot('Leather Gauntlet'), 'worn', 'singular names count too');
    assert.equal(slot('Travel Boots'), 'worn');
    assert.equal(slot('Silver Ring'), 'accessory');
    assert.equal(slot('Wading Things'), 'worn', 'from the category');
    assert.equal(slot('Plain Band'), 'worn', 'from slot: worn');
    const gear = equipped(items);
    assert.deepEqual(gear.worn.map(item => item.name), ['Iron Helm']);
    assert.deepEqual(gear.accessory.map(item => item.name), ['Silver Ring'], 'boots and gloves no longer push rings out');
    assert.deepEqual(gear.unused.map(({ item, why }) => [item.name, why]), [
        ['Leather Gauntlet', 'only 1 worn piece counts'],
        ['Travel Boots', 'only 1 worn piece counts'],
        ['Wading Things', 'only 1 worn piece counts'],
        ['Plain Band', 'only 1 worn piece counts'],
    ]);
});

test('the reader sets how many worn pieces and accessories count', () => {
    assert.deepEqual(gearLimits(R), { worn: 1, accessory: 2 });
    assert.deepEqual(gearLimits({ gear: { worn: 3.4, accessories: 20 } }), { worn: 3, accessory: 9 });
    assert.deepEqual(gearLimits({ gear: { worn: -1, accessories: 'x' } }), { worn: 0, accessory: 2 });
    assert.deepEqual(gearLimits({}), { worn: 1, accessory: 2 });
    const rings = ['Ring A', 'Ring B', 'Ring C', 'Ring D'].map(name => ({ name, slot: 'accessory', equipped: true, rarity: 'common', stats: { LUK: 1 }, tags: [] }));
    const four = { ...R, gear: { worn: 1, accessories: 4 } };
    assert.equal(gearBonuses(rings, 5, R).LUK, 2);
    assert.equal(gearBonuses(rings, 5, four).LUK, 4);
    const none = equipped(rings, { ...R, gear: { worn: 1, accessories: 0 } });
    assert.deepEqual(none.accessory, []);
    assert.equal(none.unused[0].why, 'no accessories count');
});

test('gearSummary lists what the fight uses, capped, and what it leaves out', () => {
    const { items } = parseInventory(`${INVENTORY}\n[Equipment > Accessories]\nRing of Giants | 1 | equipped · common · STR +20\nRing B | 1 | equipped\nRing C | 1 | equipped`);
    const summary = gearSummary(items, 4, R);
    const giants = summary.counted.find(piece => piece.name === 'Ring of Giants');
    assert.deepEqual(giants, { name: 'Ring of Giants', slot: 'accessory', rarity: 'common', stats: { STR: 2 }, capped: true, from: { STR: 20 } });
    assert.ok(summary.counted.every(piece => piece.name !== 'Ring C'));
    assert.deepEqual(summary.unused, [{ name: 'Ring C', slot: 'accessory', rarity: 'common', why: 'only 2 accessories count' }]);
});

test('gearBonuses sums capped stats of what is equipped and lists the capped items', () => {
    const { items } = parseInventory(`${INVENTORY}\n[Equipment > Accessories]\nRing of Giants | 1 | equipped · common · STR +20`);
    const bonus = gearBonuses(items, 4, R);
    assert.equal(bonus.ATK, 6);
    assert.equal(bonus.DEX, -1);
    // Jerkin DEF 4 plus the bare buckler's common budget at level 4 (4 DEF).
    assert.equal(bonus.DEF, 8);
    assert.equal(bonus.STR, 2);
    assert.equal(bonus.MATK, 0);
    assert.deepEqual(bonus.capped, [{ name: 'Ring of Giants', from: { STR: 20 }, to: { STR: 2 } }]);
});

test('gear entries for the Party block round-trip', () => {
    const staff = parseGearEntry('Ashwood Staff (rare) · MATK +7, INT +1');
    assert.deepEqual([staff.name, staff.rarity, staff.slot, staff.equipped, staff.stats], ['Ashwood Staff', 'rare', 'weapon', true, { MATK: 7, INT: 1 }]);
    assert.equal(formatGearEntry(staff), 'Ashwood Staff (rare) · MATK +7, INT +1');
    const feather = parseGearEntry('Lucky Feather (uncommon) · LUK +2, slot: accessory');
    assert.equal(feather.slot, 'accessory');
    assert.equal(formatGearEntry(feather), 'Lucky Feather (uncommon) · LUK +2, slot: accessory');
    assert.equal(formatGearEntry(parseGearEntry('Plain Dagger')), 'Plain Dagger (common)');
});

test('formatMoney: tiers, single and custom currencies', () => {
    assert.equal(formatMoney(134, COINS), '1 gold, 3 silver, 4 copper');
    assert.equal(formatMoney(14, COINS), '1 silver, 4 copper');
    assert.equal(formatMoney(100, COINS), '1 gold');
    assert.equal(formatMoney(1204, COINS), '12 gold, 4 copper');
    assert.equal(formatMoney(0, COINS), '0 copper');
    assert.equal(formatMoney(-5, COINS), '0 copper');
    assert.equal(formatMoney(134, SINGLE), '134 coins');
    assert.equal(formatMoney(134, { mode: 'single', single: 'credits' }), '134 credits');
    assert.equal(formatMoney(2 * 240 + 5 * 12, CUSTOM), '2 crowns, 5 marks');
    assert.equal(formatMoney(240 + 12 + 1, CUSTOM), '1 crown, 1 mark, 1 bit');
});

test('parseMoney is the lenient inverse', () => {
    for (const amount of [0, 7, 14, 100, 134, 9999]) assert.equal(parseMoney(formatMoney(amount, COINS), COINS), amount);
    for (const amount of [0, 13, 545, 1000]) assert.equal(parseMoney(formatMoney(amount, CUSTOM), CUSTOM), amount);
    assert.equal(parseMoney('1g 3s', COINS), 130);
    assert.equal(parseMoney('13 silver', COINS), 130);
    assert.equal(parseMoney('5gp and 2 coppers', COINS), 502);
    assert.equal(parseMoney('1.5 gold', COINS), 150);
    assert.equal(parseMoney('134', COINS), 134);
    assert.equal(parseMoney('1,200 coins', SINGLE), 1200);
    assert.equal(parseMoney('2 crown, 1 bit', CUSTOM), 481);
    assert.equal(parseMoney('', COINS), 0);
});

test('addLoot adds money to the currency row and stacks or files items; other rows byte-identical', () => {
    const before = INVENTORY.split('\n');
    const out = addLoot(INVENTORY, {
        money: 14,
        items: [
            { name: 'Healing Draught', qty: 2, kind: 'consumable', rarity: 'common' },
            { name: 'Rusty Dagger', qty: 1, kind: 'equipment', rarity: 'uncommon', stats: { ATK: 3 } },
            { name: 'Bone Fetish', qty: 1, kind: 'material', rarity: 'common' },
            { name: 'Lucky Feather', qty: 1, kind: 'equipment', rarity: 'rare', stats: { LUK: 2 } },
            { name: 'Bone Fetish', qty: 2, kind: 'material' },
        ],
    }, COINS);
    const lines = out.split('\n');
    assert.equal(lines[0], 'Coins | 1 gold, 4 silver, 8 copper');
    assert.ok(lines.includes('Healing Draught | 5 | heal 30'));
    assert.equal(lines[lines.indexOf('Hunter\'s Bow | 1 | rare · ATK +5, DEX +2, range') + 1], 'Rusty Dagger | 1 | uncommon · ATK +3');
    assert.deepEqual(lines.slice(-4), ['', '[Loot]', 'Bone Fetish | 3', 'Lucky Feather | 1 | rare · LUK +2, slot: accessory']);
    for (const line of before.filter(line => !/^(?:Coins|Healing Draught)/.test(line))) assert.ok(lines.includes(line), line);
    // The new rows read back as what they are.
    const parsed = parseInventory(out).items;
    assert.deepEqual([byName(parsed, 'Rusty Dagger').slot, byName(parsed, 'Rusty Dagger').rarity], ['weapon', 'uncommon']);
    assert.deepEqual([byName(parsed, 'Lucky Feather').slot, byName(parsed, 'Lucky Feather').stats], ['accessory', { LUK: 2 }]);
    assert.equal(byName(parsed, 'Bone Fetish').slot, null);
});

test('addLoot creates [Money] and [Loot], uses existing categories, and keeps wrappers and line endings', () => {
    assert.equal(addLoot('', { money: 134, items: [{ name: 'Wolf Pelt', qty: 2, kind: 'material' }] }, COINS),
        '[Money]\nCoins | 1 gold, 3 silver, 4 copper\n\n[Loot]\nWolf Pelt | 2');
    assert.equal(addLoot('Rope | 1 | coiled\n', { money: 5 }, COINS), 'Rope | 1 | coiled\n\n[Money]\nCoins | 5 copper\n');
    assert.equal(addLoot('[Money]\nGems | 2\n\n[Food]\nBread | 1', { money: 5 }, COINS), '[Money]\nGems | 2\nCoins | 5 copper\n\n[Food]\nBread | 1');
    assert.equal(addLoot('<Inventory>\nRope | 1\n</Inventory>', { items: [{ name: 'Potion', qty: 1, kind: 'consumable', effect: { heal: 20 } }] }, COINS),
        '<Inventory>\nRope | 1\n\n[Loot]\nPotion | 1 | heal 20\n</Inventory>');
    assert.equal(addLoot('[Potions]\nTonic | 1\r\n[Trophies]\r\nFang | 1', { items: [{ name: 'Potion', qty: 1, kind: 'consumable', effect: { heal: 20 } }, { name: 'Claw', qty: 1, kind: 'material' }] }, COINS),
        '[Potions]\r\nTonic | 1\r\nPotion | 1 | heal 20\r\n[Trophies]\r\nFang | 1\r\nClaw | 1');
});

test('addLoot writes loot rows as enemies.rollLoot rolls them', () => {
    const out = addLoot('[Consumables]\nTonic | 1', {
        money: 0,
        items: [
            { name: 'Minor Healing Draught', qty: 1, rarity: 'common', kind: 'consumable', stats: {}, effect: 'heal 20' },
            { name: 'Crown of Embers', qty: 1, rarity: 'legendary', kind: 'equipment', stats: { MATK: 30, INT: 4 } },
            { name: 'Worldsplitter', qty: 1, rarity: 'legendary', kind: 'equipment', stats: { ATK: 45, STR: 4 } },
            { name: 'Goblin Ear', qty: 1, rarity: 'common', kind: 'material', stats: {} },
        ],
    }, COINS);
    assert.equal(out, [
        '[Consumables]', 'Tonic | 1', 'Minor Healing Draught | 1 | heal 20',
        '', '[Loot]',
        'Crown of Embers | 1 | legendary · MATK +30, INT +4',
        'Worldsplitter | 1 | legendary · ATK +45, STR +4, slot: weapon',
        'Goblin Ear | 1',
    ].join('\n'));
    const parsed = parseInventory(out).items;
    assert.deepEqual(parsed.map(item => [item.name, item.slot, item.effect]), [
        ['Tonic', null, null],
        ['Minor Healing Draught', null, { heal: 20 }],
        ['Crown of Embers', 'accessory', null],
        ['Worldsplitter', 'weapon', null],
        ['Goblin Ear', null, null],
    ]);
});

test('addLoot handles single and custom currencies and keeps the row\'s styling', () => {
    assert.equal(addLoot('Coins | 134', { money: 20 }, SINGLE), 'Coins | 154');
    assert.equal(addLoot('Coins | 134 coins | pouch', { money: 20 }, SINGLE), 'Coins | 154 coins | pouch');
    assert.equal(addLoot('- **Purse** |  2 crowns, 5 marks  | at belt', { money: 12 * 15 }, CUSTOM), '- **Purse** |  3 crowns  | at belt');
    assert.equal(addLoot('| Coins | 3 copper | |', { money: 7 }, COINS), '| Coins | 1 silver | |');
    assert.equal(addLoot('Coins | 3', { money: 0, items: [] }, COINS), 'Coins | 3');
});

test('useItems takes used consumables out and removes empty rows', () => {
    const out = useItems(INVENTORY, { 'Healing Draught': 1, 'ember flask': 1, Ghost: 3, Antidote: 0 });
    const lines = out.split('\n');
    assert.ok(lines.includes('Healing Draught | 2 | heal 30'));
    assert.ok(!lines.some(line => line.startsWith('Ember Flask')));
    assert.ok(lines.includes('Antidote | 1 | cure poison, burn'));
    assert.equal(lines.length, INVENTORY.split('\n').length - 1);
    assert.equal(useItems('Tonic | x3 | sweet', { Tonic: 1 }), 'Tonic | x2 | sweet');
    assert.equal(useItems('Tonic |  | sweet\nRope | 1', { Tonic: 1 }), 'Rope | 1');
    assert.equal(useItems(INVENTORY, {}), INVENTORY);
});

test('a purse kept under its own name is the party\'s money, and loot coins go into it (0.5.25)', () => {
    const inventory = 'Coin Pouch | 1 | 1 Gold, 35 Silver, 14 Copper\nGuild Badge (F-Rank) | 1 | Stamped lead token\nWolf Bounty Voucher | 1 | Stamped council slip for 1 gold\n\n[Gear]\nKnife | 1 | Work knife';
    const purse = purseOf(inventory);
    assert.equal(purse.total, 464);
    assert.equal(formatMoney(purse.total), '4 gold, 6 silver, 4 copper');
    assert.deepEqual(purse.rows, [{ name: 'Coin Pouch', cell: 'note' }], 'a voucher worth gold is not money in hand');
    assert.equal(addLoot(inventory, { money: 250 }).split('\n')[0], 'Coin Pouch | 1 | 7 gold, 1 silver, 4 copper', 'no second "Coins" row');
    assert.equal(purseOf('Coins | 3 gold, 2 silver\nPurse | 1 | 5 silver').total, 370, 'every purse counts');
    assert.equal(purseOf('Rope | 1 | coiled'), null);
    assert.equal(purseOf('Coin Pouch | 1 | empty'), null, 'a purse with no coins written is not read as money');
});

test('a rarer find that is not gear keeps its rarity in the Inventory, and stays what it is (0.5.32)', async () => {
    const { addLoot, parseInventory } = await import('../src/items.js');
    const inv = addLoot('', { items: [
        { name: 'Brood-Mother Skull', qty: 1, rarity: 'uncommon', kind: 'material', stats: {} },
        { name: 'Iron Gauntlet Shard', qty: 1, rarity: 'rare', kind: 'material', stats: {} },
        { name: 'Greater Healing Draught', qty: 1, rarity: 'uncommon', kind: 'consumable', effect: { heal: 60 } },
        { name: 'Wolf Pelt', qty: 1, rarity: 'common', kind: 'material', stats: {} },
    ] });
    assert.match(inv, /Brood-Mother Skull \| 1 \| uncommon material/);
    assert.match(inv, /Iron Gauntlet Shard \| 1 \| rare material/);
    assert.match(inv, /Greater Healing Draught \| 1 \| uncommon · heal 60/);
    assert.match(inv, /Wolf Pelt \| 1\s*$/m, 'a common one says nothing more');
    const items = parseInventory(inv).items;
    assert.equal(items.find(item => item.name === 'Iron Gauntlet Shard').slot, null, 'a material is never worn, whatever its name');
    assert.equal(items.find(item => item.name === 'Brood-Mother Skull').rarity, 'uncommon');
    assert.equal(items.find(item => item.name === 'Greater Healing Draught').effect.heal, 60);
});

test('a swarm\'s parts are its creatures\', for a swarm the chat kept from before too (0.5.32)', async () => {
    const { rollLoot } = await import('../src/enemies.js');
    const { makeRng } = await import('../src/rng.js');
    const enemy = { name: 'Granary Cellar Rat Swarm', rank: 'F', coins: false, loot: [{ name: 'Granary Cellar Rat Swarm Tail', chance: 100, qty: [1, 1], kind: 'material' }] };
    assert.deepEqual(rollLoot(enemy, { rng: makeRng('x') }).items.map(item => item.name), ['Granary Cellar Rat Tail']);
});

test('restoreLoot puts back the loot the narrating reply dropped or retold, and nothing else (0.5.33)', () => {
    const written = addLoot('[Gear]\nRope | 1', { items: [
        { name: 'Wolf-fang Charm', qty: 1, rarity: 'uncommon', kind: 'equipment', stats: { LUK: 2 } },
        { name: 'Brood-Mother Skull', qty: 1, rarity: 'uncommon', kind: 'material', stats: {} },
    ] });
    const items = [
        { name: 'Wolf-fang Charm', qty: 1, rarity: 'uncommon', kind: 'equipment', stats: { LUK: 2 } },
        { name: 'Brood-Mother Skull', qty: 1, rarity: 'uncommon', kind: 'material', stats: {} },
    ];
    const retold = '[Gear]\nRope | 1\nWolf-fang Charm | 1 | A yellowed fang on a cord\nTorch | 2';
    const fixed = restoreLoot(retold, items, undefined, written);
    assert.match(fixed, /Wolf-fang Charm \| 1 \| uncommon · LUK \+2/);
    assert.match(fixed, /Brood-Mother Skull \| 1 \| uncommon material/);
    assert.match(fixed, /Torch \| 2/);
    assert.equal(restoreLoot(fixed, items, undefined, written), fixed);
    // A note that keeps what the fight wrote, with more said, stays the story's.
    const kept = '[Gear]\nWolf-fang Charm | 1 | uncommon · LUK +2 (on a cord)\nBrood-Mother Skull | 1 | uncommon material';
    assert.equal(restoreLoot(kept, items, undefined, written), kept);
});

test('an element on what strikes works in a fight; on armour it is only a word (0.5.33)', () => {
    const gear = [
        { name: 'Ember Sword', slot: 'weapon', equipped: true, rarity: 'rare', stats: { ATK: 6 }, tags: ['fire'] },
        { name: 'Frost Coat', slot: 'armour', equipped: true, rarity: 'rare', stats: { DEF: 6 }, tags: ['ice'] },
    ];
    assert.deepEqual(gearBonuses(gear, 5).onHit, ['fire']);
});

test('a potion the story retold still works by its name (0.5.35)', () => {
    const { items } = parseInventory('[Consumables]\nMinor Healing Draught | 4 | Weak restorative fluid (heals minor wounds)\nMana Tonic | 1 | blue and fizzing\nAntidote | 1 | bitter\nHealing Herbs | 2 | fragrant\n[Loot]\nBrood-Mother Skull | 1 | uncommon material');
    assert.deepEqual(items.map(item => [item.name, item.effect]), [
        ['Minor Healing Draught', { heal: 20 }], ['Mana Tonic', { mp: 20 }], ['Antidote', { cure: ['poison'] }], ['Healing Herbs', null], ['Brood-Mother Skull', null],
    ]);
    assert.deepEqual(consumables(items).map(item => item.name), ['Minor Healing Draught', 'Mana Tonic', 'Antidote']);
    // The note's own number wins over the name's.
    assert.deepEqual(parseInventory('Healing Draught | 1 | heal 45').items[0].effect, { heal: 45 });
    for (const [name, effect] of [['Healing Draught', { heal: 30 }], ['Greater Healing Draught', { heal: 60 }], ['Elixir', { heal: 120 }], ['Grand Elixir', { heal: 250 }], ['Regeneration Tonic', { heal: 60 }], ['Empty Flask', null]]) {
        assert.deepEqual(effectByName(name), effect, name);
    }
});

test('keepNotes puts back what a retold note did, in front of the story\'s words (0.5.35)', () => {
    const before = '[Weapons]\nShort Sword | 1 | Equipped · Common · ATK +4, fire · Notched\n[Consumables]\nWolfsbane Tonic | 2 | heal 25\nMinor Healing Draught | 4 | heal 20\n[Loot]\nBrood-Mother Skull | 1 | uncommon material · MDEF\nRope | 1 | 30 ft';
    const now = '[Weapons]\nShort Sword | 1 | A notched blade, still keen\n[Consumables]\nWolfsbane Tonic | 1 | Bitter green tonic\nMinor Healing Draught | 4 | Weak restorative fluid\n[Loot]\nBrood-Mother Skull | 1 | A cracked yellow skull\nRope | 1 | coiled\nTorch | 1 | new';
    const kept = keepNotes(now, before);
    assert.match(kept, /Short Sword \| 1 \| equipped · common · ATK \+4, fire · A notched blade, still keen/);
    assert.match(kept, /Wolfsbane Tonic \| 1 \| heal 25 · Bitter green tonic/);
    // A potion that works by its name gets its number shown again too.
    assert.match(kept, /Minor Healing Draught \| 4 \| heal 20 · Weak restorative fluid/);
    assert.match(kept, /Brood-Mother Skull \| 1 \| uncommon material · MDEF · A cracked yellow skull/);
    assert.match(kept, /Rope \| 1 \| coiled/);
    assert.equal(keepNotes(kept, before), kept);
    // New numbers are the story's; a piece it says was stowed is not put back on.
    assert.equal(keepNotes('Wolfsbane Tonic | 2 | heal 40, bitter', before), 'Wolfsbane Tonic | 2 | heal 40, bitter');
    assert.equal(keepNotes('Short Sword | 1 | stowed in the pack', before), 'Short Sword | 1 | common · ATK +4, fire · stowed in the pack');
});

test('a party member\'s items are the sections named for them; loot and use stay with the right owner (0.5.40)', async () => {
    const { sectionOwner, inScope } = await import('../src/items.js');
    const text = [
        'Coin Pouch | 1 | 2 silver',
        '[Consumables]',
        'Minor Healing Draught | 1 | heal 20',
        '[Lyra]',
        'Ash Staff | 1 | equipped · uncommon · MATK +6',
        '[Lyra > Herbs]',
        'Minor Healing Draught | 2 | heal 20',
        'Lyra\'s Purse | 1 | 5 silver',
    ].join('\n');
    const members = ['Lyra Vane'];
    assert.equal(sectionOwner('Lyra > Herbs', members), 'Lyra Vane', 'by first name too');
    assert.equal(sectionOwner('Consumables', members), null);
    const mine = { members, owner: null };
    const hers = { members, owner: 'Lyra Vane' };
    const items = parseInventory(text).items;
    assert.deepEqual(items.filter(item => inScope(item, hers)).map(item => item.name), ['Ash Staff', 'Minor Healing Draught', 'Lyra\'s Purse']);
    assert.deepEqual(items.filter(item => inScope(item, mine)).map(item => item.name), ['Coin Pouch', 'Minor Healing Draught']);
    // Using hers takes from her section, not yours.
    assert.match(useItems(text, { 'Minor Healing Draught': 1 }, hers), /\[Lyra > Herbs\]\nMinor Healing Draught \| 1 \| heal 20/);
    assert.match(useItems(text, { 'Minor Healing Draught': 1 }, hers), /\[Consumables\]\nMinor Healing Draught \| 1 \| heal 20/);
    // Loot is yours: stacked on your row, into your sections, never hers; your coin is your purse.
    const looted = addLoot(text, { items: [{ name: 'Minor Healing Draught', qty: 1, kind: 'consumable', effect: 'heal 20' }, { name: 'Wolf Pelt', qty: 1, kind: 'material' }], money: 5 }, R.currency, mine);
    assert.match(looted, /\[Consumables\]\nMinor Healing Draught \| 2 \| heal 20/);
    assert.match(looted, /\[Lyra > Herbs\]\nMinor Healing Draught \| 2 \| heal 20/);
    assert.match(looted, /\[Loot\]\nWolf Pelt \| 1/);
    assert.match(looted, /^Coin Pouch \| 1 \| 2 silver, 5 copper$/m);
    assert.equal(purseOf(text, R.currency, mine).total, 20);
    // Given to her: into her section.
    assert.match(addLoot(text, { items: [{ name: 'Bone Charm', qty: 1, kind: 'equipment', note: 'equipped · common · LUK +1' }] }, R.currency, hers), /\[Lyra\]\nAsh Staff \| 1 \| .*\nBone Charm \| 1 \| equipped · common · LUK \+1/);
    // Only a sub-section of hers ([Lyra > Herbs]): gear goes to her own top section, made for it.
    const herbs = 'Coin Pouch | 1 | 2 silver\n[Lyra Vane > Herbs]\nWolfsbane | 1 | material';
    assert.match(addLoot(herbs, { items: [{ name: 'Bone Charm', qty: 1, kind: 'equipment', note: 'equipped · common · LUK +1' }] }, R.currency, hers), /\[Lyra\]\nBone Charm \| 1/);
});

test('the short price follows the chat\'s coins: shortest unique letters, a tier\'s own short form, one coin (0.5.43)', async () => {
    const { formatMoneyShort } = await import('../src/items.js');
    assert.equal(formatMoneyShort(134), '1 g 3 s 4 c');
    assert.equal(formatMoneyShort(0), '0 c');
    const custom = { mode: 'tiers', tiers: [{ name: 'bits', rate: 1 }, { name: 'marks', rate: 12 }, { name: 'crowns', rate: 20 }] };
    assert.equal(formatMoneyShort(68, custom), '5 m 8 b');
    // Initials that clash: as many letters as tell them apart.
    assert.equal(formatMoneyShort(241, { tiers: [{ name: 'copper', rate: 1 }, { name: 'crowns', rate: 10 }] }), '24 cr 1 co');
    // A tier's own short form wins.
    assert.equal(formatMoneyShort(25, { tiers: [{ name: 'copper', rate: 1, short: 'cp' }, { name: 'silver', rate: 10, short: 'sp' }] }), '2 sp 5 cp');
    // One coin: its short form, else its first letter.
    assert.equal(formatMoneyShort(12, { mode: 'single', single: 'coins' }), '12 c');
    assert.equal(formatMoneyShort(12, { mode: 'single', single: 'shells', singleShort: 'sh' }), '12 sh');
    // The words stay formatMoney's.
    assert.equal(formatMoney(134), '1 gold, 3 silver, 4 copper');
});

// (0.5.46) The Trade page showed "Purse: 0 copper" with coins in the Inventory: the story had
// kept them under rows the purse did not read as money.
test('purse: a realistic Inventory with the money under the names a story gives it', () => {
    const inventory = [
        'Coin Pouch | 1 | 4 Silver, 4 Copper',
        'Guild Badge (F-Rank) | 1 | Stamped lead token',
        'Wolf Bounty Voucher | 1 | Stamped council slip for 1 gold',
        '[Equipment > Weapons]',
        'Cane-Blade | 1 | Equipped · Common · ATK +2',
        '[Money]',
        'Silver Coins | 3',
        'Copper | 36',
        '[Lyra]',
        'Herb Pouch | 1 | Lyra\'s, mint and yarrow',
        'Lyra\'s Purse | 1 | 2 silver',
        '[Loot]',
        'Even Trophy | 2',
        'Cellar Rat Tail | 6 | material · AGI, poison',
    ].join('\n');
    const members = { members: ['Lyra'], owner: null };
    // Yours: the pouch (44), the silver coins (30) and the loose copper (36); the voucher is no money.
    assert.equal(purseOf(inventory, DEFAULT_RULES.currency, members).total, 110);
    assert.deepEqual(purseOf(inventory, DEFAULT_RULES.currency, members).rows.map(row => row.cell), ['note', 'tier', 'tier']);
    // The whole Inventory's, as a trade pays from it: Lyra's purse too.
    assert.equal(purseOf(inventory).total, 130);
    // Spelled out, and a coin's own row with a word for its count.
    assert.equal(purseOf('Coin Pouch | 1 | eight silver, thirty-six copper').total, 116);
    assert.equal(purseOf('Gold Pieces | two').total, 200);
    // A silver ring or a gold ingot is no coin; a row with no money at all is no purse.
    assert.equal(purseOf('Silver Ring | 1 | accessory\nGold Ingot | 2'), null);
    assert.equal(purseOf('Whetstone | 1 | Worn thin'), null);
});

test('purse: paying from rows named for one coin, smallest first, the change put back', () => {
    const inventory = '[Money]\nSilver | 4\nCopper | 4\nGold Coins | 1';
    const paid = spendMoney(inventory, 15);
    assert.ok(paid.ok);
    assert.equal(paid.text, '[Money]\nSilver | 2\nCopper | 9\nGold Coins | 1');
    assert.equal(purseOf(paid.text).total, 144 - 15);
    // No copper row for the change: it goes to the currency's own row.
    const silver = spendMoney('Silver Coins | 4', 15);
    assert.equal(purseOf(silver.text).total, 25);
    assert.match(silver.text, /^Silver Coins \| 2$/m);
    // Too little: nothing changes.
    assert.deepEqual(spendMoney(inventory, 999), { text: inventory, ok: false });
    // Loot onto the copper row.
    assert.equal(addLoot('Silver | 4\nCopper | 2', { money: 13 }), 'Silver | 4\nCopper | 15');
});
