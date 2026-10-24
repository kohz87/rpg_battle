import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES } from '../../../src/rules.js';
import { describeRow } from '../../../src/items.js';
import { itemWorth } from '../../../src/trade.js';
import { materialAffinity } from '../../../src/craft.js';
import { coinValue, defineItem, part } from '../../../src/v2/items/index.js';

// What Story Block makes for a `+ item Name` it does not know (SPEC §7).
const storyDef = (name, extra = {}) => ({ id: `story/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '', ...extra });
const define = (name, note = '', opts = {}) => defineItem(storyDef(name), { note, settings: {}, currency: null, ...opts });

// v1's own reading of the same row, for parity: describeRow, and trade's itemWorth of it.
const v1 = (name, note = '') => {
    const row = { name, note, ...describeRow({ name, category: '', note }) };
    return { ...row, worth: itemWorth(row, { level: 1, rules: DEFAULT_RULES }) };
};

test('item.define: potions read by note and by name, as v1 (minor, strong are sizes, not threats)', () => {
    const table = [
        ['Minor Healing Draught', '', { heal: 20, mp: 0, cure: [] }],
        ['Healing Draught', 'heal 30', { heal: 30, mp: 0, cure: [] }],
        ['Strong Healing Potion', 'weak restorative fluid', { heal: 60, mp: 0, cure: [] }],
        ['Greater Healing Draught', '', { heal: 60, mp: 0, cure: [] }],
        ['Grand Elixir', '', { heal: 250, mp: 0, cure: [] }],
        ['Mana Tonic', 'mp 20', { heal: 0, mp: 20, cure: [] }],
        ['Lesser Mana Potion', '', { heal: 0, mp: 10, cure: [] }],
        ['Antidote', 'cure poison, burn', { heal: 0, mp: 0, cure: ['poison', 'burn'] }],
        ['Antidote', '', { heal: 0, mp: 0, cure: ['poison'] }],
        ['Ember Flask', 'fire 25, all enemies', { heal: 0, mp: 0, cure: [], damage: { amount: 25, element: 'fire', target: 'all' } }],
    ];
    for (const [name, note, effect] of table) {
        const def = define(name, note);
        const old = v1(name, note);
        assert.equal(def.kind, 'consumable', name);
        assert.deepEqual(def.effect, effect, name);
        assert.equal(def.slot, null, name);
        assert.deepEqual(def.stats, {}, name);
        assert.equal(def.rarity, old.rarity, name);
        assert.equal(def.value, old.worth, `${name} worth`);
        assert.ok(Number.isInteger(def.value) && def.value > 0, name);
    }
});

test('item.define: gear with stats, slots, rarity and tags, as v1', () => {
    const table = [
        ['Iron Longsword', 'uncommon · ATK +6, DEX -1', { slot: 'weapon', rarity: 'uncommon', stats: { ATK: 6, DEX: -1 }, tags: [] }],
        ['Hunter\'s Bow', 'rare · ATK +5, DEX +2, range', { slot: 'weapon', rarity: 'rare', stats: { ATK: 5, DEX: 2 }, tags: ['range'] }],
        ['Ashwood Staff', 'rare · MATK +7, INT +1', { slot: 'weapon', rarity: 'rare', stats: { MATK: 7, INT: 1 }, tags: [] }],
        ['Oak Buckler', 'common · DEF +2', { slot: 'offhand', rarity: 'common', stats: { DEF: 2 }, tags: [] }],
        ['Studded Jerkin', 'DEF +4', { slot: 'armour', rarity: 'common', stats: { DEF: 4 }, tags: [] }],
        ['Leather Boots', 'uncommon · DEF +2, AGI +1', { slot: 'worn', rarity: 'uncommon', stats: { DEF: 2, AGI: 1 }, tags: [] }],
        ['Silver Ring', 'rare · LUK +3, holy', { slot: 'accessory', rarity: 'rare', stats: { LUK: 3 }, tags: ['holy'] }],
        ['Greatsword', 'epic · ATK +12, two-handed', { slot: 'weapon', rarity: 'epic', stats: { ATK: 12 }, tags: ['two-handed'] }],
        ['Odd Trinket', 'slot: worn · DEF +1', { slot: 'worn', rarity: 'common', stats: { DEF: 1 }, tags: [] }],
        ['Rusty Sword', 'uncommon', { slot: 'weapon', rarity: 'uncommon', stats: {}, tags: [] }],
    ];
    for (const [name, note, expected] of table) {
        const def = define(name, note);
        const old = v1(name, note);
        assert.equal(def.kind, 'equipment', name);
        assert.equal(def.slot, expected.slot, name);
        assert.equal(def.slot, old.slot, `${name} slot parity`);
        assert.equal(def.rarity, expected.rarity, name);
        assert.deepEqual(def.stats, expected.stats, name);
        assert.deepEqual(def.tags, expected.tags, name);
        assert.deepEqual(def.effect, {}, name);
        assert.equal(def.stack, false, `${name}: one piece per stack`);
        assert.equal(def.value, old.worth, `${name} worth`);
    }
});

test('item.define: a keepsake with no gear signal is goods, as v1 (a ring in a pocket is not worn into battle)', () => {
    for (const [name, note] of [['Mother\'s Ring', 'worn smooth'], ['Rope', 'coiled'], ['Moonveil Trout', 'violet-streaked, from the lake'], ['Iron Sword', '']]) {
        const def = define(name, note);
        assert.equal(def.kind, 'goods', name);
        assert.equal(def.slot, null, name);
        assert.equal(def.value, v1(name, note).worth, name);
    }
    assert.equal(define('Rope', 'coiled').value, DEFAULT_RULES.trade.goods);
    // A pack's piece that says it is gear needs no note to be one.
    const packSword = defineItem(storyDef('Iron Sword', { kind: 'equipment' }), { settings: {} });
    assert.equal(packSword.kind, 'equipment');
    assert.equal(packSword.slot, 'weapon');
});

test('item.define: materials with affinities and v1 material notes', () => {
    const skull = define('Brood-Mother Skull', 'uncommon material · MDEF, poison');
    assert.equal(skull.kind, 'material');
    assert.equal(skull.rarity, 'uncommon');
    assert.deepEqual(skull.tags, ['poison']);
    assert.equal(skull.note, 'uncommon material · MDEF, poison');
    assert.equal(skull.value, DEFAULT_RULES.trade.material.uncommon);
    assert.equal(skull.value, v1('Brood-Mother Skull', 'uncommon material · MDEF, poison').worth);
    assert.deepEqual(materialAffinity(skull.name, skull.note), { stat: 'MDEF', element: 'poison' });

    // A creature part with no note is a material by its name (v1 isMaterial); its note says what it lends.
    const fang = define('Wolf Fang');
    assert.equal(fang.kind, 'material');
    assert.equal(fang.note, 'material · ATK');
    assert.equal(fang.value, DEFAULT_RULES.trade.material.common);
    const scale = define('Salamander Scale', 'rare material');
    assert.equal(scale.kind, 'material');
    assert.equal(scale.rarity, 'rare');
    assert.deepEqual(scale.tags, ['fire']);
    assert.equal(scale.note, 'rare material');
    assert.equal(scale.value, DEFAULT_RULES.trade.material.rare);
    // "Rare Essence" carries its rarity in its name.
    const essence = define('Rare Essence', 'material');
    assert.equal(essence.rarity, 'rare');
    assert.equal(essence.kind, 'material');
});

test('item.define: an item named for the chat\'s one currency is money, one unit each (MODULES §F1)', () => {
    assert.equal(define('Gold Coins').kind, 'money');
    assert.equal(define('Gold Coins').value, 1);
    assert.equal(define('Gold').value, 1);
    assert.equal(define('Loose Gold').value, 1);
    assert.equal(define('Coins').value, 1);
    assert.equal(define('Money').value, 1);
    // No tiers: silver in a gold chat is not money.
    assert.notEqual(define('Silver Coin').kind, 'money');
    assert.equal(define('Gold Ring', 'rare · LUK +2').kind, 'equipment');
    // The reader's currency name (Story Block's inventory.currency).
    const gil = { currency: { name: 'Gil', short: 'G' } };
    assert.equal(define('Gil', '', gil).kind, 'money');
    assert.equal(define('Gil Pieces', '', gil).value, 1);
    assert.notEqual(define('Gold Coins', '', gil).kind, 'money');
    assert.equal(coinValue('Gold', { name: 'shells' }), null);
    assert.equal(coinValue('Shells', { name: 'shells' }), 1);
    // Without a currency given it asks the host, else gold.
    const saved = globalThis.StoryBlock;
    try {
        globalThis.StoryBlock = { sdk: { query: name => (name === 'inventory.currency' ? { name: 'crowns', short: 'cr' } : null), settings: () => ({}) } };
        assert.equal(defineItem(storyDef('Crowns'), { settings: {} }).kind, 'money');
        delete globalThis.StoryBlock;
        assert.equal(defineItem(storyDef('Gold Coins'), { settings: {} }).kind, 'money');
    } finally {
        if (saved === undefined) delete globalThis.StoryBlock;
        else globalThis.StoryBlock = saved;
    }
});

test('item.define: a new object; numbers a pack set are kept; quest things are left alone; a later rename is not re-priced here', () => {
    const def = Object.freeze(storyDef('Healing Draught'));
    const out = defineItem(def, { note: 'heal 30', settings: {} });
    assert.notEqual(out, def);
    assert.equal(def.kind, 'goods');
    assert.equal(out.id, def.id);
    assert.equal(out.note, 'heal 30');

    const priced = defineItem(storyDef('Healing Draught', { value: 99 }), { note: 'heal 30', settings: {} });
    assert.equal(priced.value, 99);
    const quest = defineItem(storyDef('Sealed Letter', { kind: 'quest' }), { note: 'for the reeve', settings: {} });
    assert.equal(quest.kind, 'quest');
    assert.equal(quest.value, 0);
    // The def's own note when the hook is given none.
    assert.equal(defineItem(storyDef('Healing Draught', { note: 'heal 30' }), { settings: {} }).effect.heal, 30);
});

test('item.define: values are integers in the smallest unit and plain JSON', () => {
    for (const [name, note] of [['Iron Longsword', 'uncommon · ATK +6, DEX -1'], ['Antidote', ''], ['Wolf Fang', ''], ['Rope', ''], ['Gold Coins', '']]) {
        const def = define(name, note);
        assert.ok(Number.isInteger(def.value) && def.value >= 0, name);
        assert.deepEqual(JSON.parse(JSON.stringify(def)), def, name);
        assert.ok(['goods', 'material', 'consumable', 'equipment', 'quest', 'money'].includes(def.kind), name);
        assert.ok(['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(def.rarity), name);
    }
});

test('the part registers the item.define hook with (def, { note, owner })', () => {
    const def = part.hooks['item.define'](storyDef('Mana Tonic'), { note: 'mp 20', owner: 'ac_pc000001', settings: {} });
    assert.equal(def.kind, 'consumable');
    assert.equal(def.effect.mp, 20);
});

test('the part has no currency hook: money is Story Block\'s one currency (MODULES §F1)', () => {
    assert.equal(part.hooks.currency, undefined);
    assert.deepEqual(Object.keys(part.hooks), ['item.define']);
});
