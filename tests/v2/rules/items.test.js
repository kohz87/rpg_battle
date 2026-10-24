// rules.item, rules.registerItem and the generation bounds (contract §3; B3 "complete rule inputs", C18 generated inputs, and the B3
// acceptance: "malicious generated huge stats/effects, wrong template, generated legendary, unknown area ... reject").
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TIERS, realWorld } from '../progress/helpers/world.js';
import { inputsPin } from '../progress/helpers/fixture.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { assessItem } from '../../../src/v2/rules/items.js';
import { indexOf } from '../../../src/v2/rules/graph.js';
import { pinOf } from '../../../src/v2/rules/pin.js';
import { DEFAULT_RULES } from '../../../src/rules.js';
import * as bounds from '../../../src/v2/rules/bounds.js';
import { STORY_EFFECT_MAX } from '../../../src/v2/limits.js';
import { REPAIR_MAX } from '../../../src/v2/items/define.js';

const HAVEN = 'pack.fixture/haven';
const WRITE = 'wr_00000001';
const sys = (w, type, payload) => w.host.bus.command(type, payload, { cause: 'system' });
const def = (id, over = {}) => ({ id, name: 'Thing', kind: 'goods', rarity: 'common', value: 2, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '', ...over });
const blade = (over = {}) => def('craft/iron-blade', { name: 'Iron Blade', kind: 'equipment', rarity: 'uncommon', value: 20, stack: false, slot: 'weapon', stats: { ATK: 4 }, ...over });
const BLADE_RULE = { def: 'craft/iron-blade', allowedSlots: ['weapon'], hands: 1, requires: {}, weight: 4 };
const register = (w, payload) => sys(w, 'test.register', { write: WRITE, def: blade(), rule: BLADE_RULE, template: 'pack.fixture/forge-blade', area: null, rulesHash: null, ...payload });
const tier = n => { AREA_TIERS[HAVEN] = n; };
const generated = w => w.slice('rules').generated;
const answer = out => { const { def, hash, ruleHash, created } = out.receipt.data; return { def, hash, ruleHash, created }; };

async function ready(t, at = 4) {
    for (const key of Object.keys(AREA_TIERS)) delete AREA_TIERS[key];
    tier(at);
    const w = await realWorld(t, { given: inputsPin(), sd: true });
    await w.say('Haven.', ['~ time 3000', `~ here ${HAVEN}`]);
    return w;
}

test('the bounds are v1\'s numbers, frozen: they equal DEFAULT_RULES today and fail the day v1 is retuned (a running timeline keeps them)', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(bounds.RARITY_BUDGET)), DEFAULT_RULES.rarityBudget);
    assert.deepEqual(JSON.parse(JSON.stringify(bounds.STAT_COST)), DEFAULT_RULES.statCost);
    assert.equal(bounds.NEGATIVE_REFUND, DEFAULT_RULES.negativeRefund);
    assert.deepEqual([0, 1, 2, 5, 9].map(bounds.levelCeiling), [10, 20, 30, 60, 99]);
    assert.deepEqual([0, 1, 2, 3, 4, 6, 7, 9].map(bounds.rarityCeiling), ['common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'epic', 'epic']);
    assert.equal(bounds.budgetOf('rare', 50), 6 + 1.2 * 50);
    assert.equal(bounds.spendOf({ ATK: 4, DEF: -2 }), 4, 'a negative stat refunds nothing');
    // The effect ceilings are the story's own (items/define.js), not a second copy that can drift.
    assert.equal(bounds.EFFECT_MAX.heal, STORY_EFFECT_MAX.heal);
    assert.equal(bounds.EFFECT_MAX.mp, STORY_EFFECT_MAX.mp);
    assert.equal(bounds.EFFECT_MAX.damage, STORY_EFFECT_MAX.damage);
    assert.equal(bounds.EFFECT_MAX.repair, REPAIR_MAX);
    assert.equal(bounds.GEAR_PER_POINT, DEFAULT_RULES.trade.gearPerPoint);
    assert.deepEqual(JSON.parse(JSON.stringify(bounds.RARITY_FACTOR)), DEFAULT_RULES.trade.rarityFactor);
    assert.equal(bounds.valueCeiling('rare', 50), Math.round(4 * (6 + 1.2 * 50) * 10 * 2.5));
    assert.equal(bounds.statCeiling('ATK', 66), 66);
    assert.equal(bounds.statCeiling('STR', 66), 33);
});

test('rules.item: a pack item\'s rule from the pin, a generated item\'s from what was registered, null for the rest', async t => {
    const w = await ready(t);
    const sword = w.q('rules.item', { def: 'pack.fixture/sword' });
    assert.deepEqual(sword, { def: 'pack.fixture/sword', allowedSlots: ['weapon'], hands: 1, requires: { STR: 3 }, weight: 5, unique: false });
    assert.equal(w.q('rules.item', { def: 'pack.fixture/rope' }).hands, 0);
    assert.equal(w.q('rules.item', { def: 'craft/iron-blade' }), null, 'not registered yet');
    assert.equal(register(w).ok, true);
    assert.deepEqual(w.q('rules.item', { def: 'craft/iron-blade' }), BLADE_RULE);
    for (const bad of [undefined, null, {}, { def: 5 }, { def: 'nothing/here' }, { def: 'story/x', extra: 1 }, 'x']) assert.equal(w.q('rules.item', bad), null);
    assert.equal((await realWorld(t, { pin: false })).q('rules.item', { def: 'pack.fixture/rope' }), null, 'no ruleset');
    // A copy: nothing a caller does to the answer moves the rule.
    w.q('rules.item', { def: 'craft/iron-blade' }).allowedSlots.push('head');
    assert.deepEqual(w.q('rules.item', { def: 'craft/iron-blade' }).allowedSlots, ['weapon']);
});

test('activation registers the pack\'s frozen ItemDefs with Story Block, byte for byte, with no stack; again is a no-op', async t => {
    const w = await ready(t);
    const first = sys(w, 'test.packDefs', {});
    assert.equal(first.ok, true, first.message);
    assert.deepEqual(first.receipt.data.registered, [{ def: 'pack.fixture/rope', created: true }, { def: 'pack.fixture/sword', created: true }]);
    const defs = w.q('inventory.definitions', { ids: ['pack.fixture/sword', 'pack.fixture/rope'] });
    assert.deepEqual(defs.map(item => item.id), ['pack.fixture/rope', 'pack.fixture/sword'], 'ID-sorted');
    assert.deepEqual(defs[1], w.slice('rules').pin.defs['pack.fixture/sword']);
    assert.deepEqual(w.slice('inventory').stacks, {}, 'no stack');
    assert.deepEqual(sys(w, 'test.packDefs', {}).receipt.data.registered.map(item => item.created), [false, false]);
});

test('Story Block\'s item grant routes a story item through rules.registerItem: the plain rule, its provenance and one claim; the def is the module\'s', async t => {
    const w = await ready(t);
    await w.say('She finds a charm.', ['+ item Moon Charm | qty: 1']);
    const entry = generated(w)['story/moon-charm'];
    assert.deepEqual(entry.rule, { def: 'story/moon-charm', allowedSlots: [], hands: 0, requires: {}, weight: 0, unique: false });
    assert.equal(entry.template, null);
    assert.deepEqual(entry.area, { place: HAVEN, tier: 4, source: 'place', sourceId: HAVEN });
    assert.equal(entry.rulesHash, w.slice('rules').rulesHash);
    assert.equal(entry.defHash, hashJson(entry.def));
    assert.equal(entry.ruleHash, hashJson(entry.rule));
    assert.deepEqual(w.q('inventory.definitions', { ids: ['story/moon-charm'] })[0], entry.def, 'the registered definition is the stored one');
    assert.equal(w.q('rules.item', { def: 'story/moon-charm' }).weight, 0);
    assert.ok(w.head().meta.claims['rb:ep_00000000:item:story/moon-charm']);
    assert.deepEqual(w.problems(), []);
    // The same item again in another reply: found, not registered twice.
    await w.say('Another.', ['+ item Moon Charm | qty: 1']);
    assert.equal(Object.keys(generated(w)).length, 1);
    assert.deepEqual(w.problems(), []);
});

test('an adapter registers a crafted piece: def + rule + provenance, answer { def, hash, ruleHash, created }, once; other bytes under the id are a CONFLICT', async t => {
    const w = await ready(t);
    const out = register(w);
    assert.equal(out.ok, true, out.message);
    assert.deepEqual(answer(out), { def: 'craft/iron-blade', hash: hashJson(blade()), ruleHash: hashJson(BLADE_RULE), created: true });
    assert.equal(generated(w)['craft/iron-blade'].template, 'pack.fixture/forge-blade');
    assert.equal(generated(w)['craft/iron-blade'].write, WRITE);
    assert.deepEqual(w.q('inventory.definitions', { ids: ['craft/iron-blade'] })[0], blade());
    assert.deepEqual(answer(register(w)), { def: 'craft/iron-blade', hash: hashJson(blade()), ruleHash: hashJson(BLADE_RULE), created: false });
    assert.equal(Object.keys(w.head().meta.claims).filter(key => key.includes(':item:')).length, 1);
    assert.equal(register(w, { def: blade({ stats: { ATK: 5 } }) }).code, 'CONFLICT');
    assert.equal(register(w, { rule: { ...BLADE_RULE, weight: 9 } }).code, 'CONFLICT');
    assert.equal(generated(w)['craft/iron-blade'].def.stats.ATK, 4, 'a definition never changes once it exists');
    // A trade item from a shop, a loot item from nothing but the story.
    const ale = def('trade/ale-common-l3', { name: 'Ale', kind: 'consumable', effect: { heal: 10 } });
    assert.equal(sys(w, 'test.register', { write: 'wr_00000002', def: ale, rule: null, template: 'pack.fixture/market', area: null, rulesHash: null }).ok, true);
    assert.equal(w.q('rules.item', { def: 'trade/ale-common-l3' }).hands, 0);
    assert.deepEqual(w.problems(), []);
});

test('the source template must be in the ruleset: a craft needs a recipe, a trade a shop; a story item needs none', async t => {
    const w = await ready(t);
    assert.equal(register(w, { template: null }).code, 'RULES_MISMATCH', 'a crafted piece with no recipe');
    assert.equal(register(w, { template: 'pack.fixture/market' }).code, 'RULES_MISMATCH', 'a shop is not a recipe');
    assert.equal(register(w, { template: 'pack.fixture/forge-nothing' }).code, 'RULES_MISMATCH', 'not in the ruleset');
    const trade = (template, id = 'trade/rope-common-l1') => sys(w, 'test.register', { write: WRITE, def: def(id), rule: null, template, area: null, rulesHash: null });
    assert.equal(trade(null).code, 'RULES_MISMATCH');
    assert.equal(trade('pack.fixture/forge-blade').code, 'RULES_MISMATCH');
    assert.equal(trade('pack.fixture/market').ok, true);
    const story = (template, id) => sys(w, 'test.register', { write: WRITE, def: def(id), rule: null, template, area: null, rulesHash: null });
    assert.equal(story(null, 'story/a').ok, true);
    assert.equal(story('pack.fixture/bell', 'story/b').ok, true, 'a quest is a source');
    assert.equal(story('pack.fixture/nothing', 'story/c').code, 'RULES_MISMATCH');
    assert.deepEqual(Object.keys(generated(w)).sort(), ['story/a', 'story/b', 'trade/rope-common-l1']);
});

test('who may register: not a click, not another module; the caller\'s numbers are never trusted (area, rules hash)', async t => {
    const w = await ready(t);
    const payload = { write: WRITE, def: blade(), rule: BLADE_RULE, template: 'pack.fixture/forge-blade', area: null, rulesHash: null };
    assert.equal(w.ui('rules.registerItem', payload).code, 'REFUSED');
    assert.equal((await w.internal('rules.registerItem', payload)).code, 'REFUSED', 'another module');
    assert.equal(register(w, { rulesHash: 'f'.repeat(64) }).code, 'RULES_MISMATCH', 'other rules than the pinned');
    assert.equal(register(w, { rulesHash: w.slice('rules').rulesHash }).ok, true);
    const other = def('craft/other', { name: 'Other' });
    const mismatch = area => sys(w, 'test.register', { write: WRITE, def: other, rule: null, template: 'pack.fixture/forge-blade', area, rulesHash: null });
    assert.equal(mismatch({ place: HAVEN, tier: 9 }).code, 'RULES_MISMATCH', 'a tier the caller named is not Story Director\'s');
    assert.equal(mismatch({ place: 'pack.fixture/mill', tier: 4 }).code, 'RULES_MISMATCH');
    assert.equal(mismatch({ place: HAVEN, tier: 4 }).ok, true, 'the same as Story Director\'s answer is fine');
    for (const bad of [{ extra: 1 }, { write: 'x' }, { template: 5 }, { rulesHash: 'x' }, { def: 5 }]) assert.equal(register(w, bad).code, 'INVALID', JSON.stringify(bad));
    assert.equal(sys(w, 'test.register', { write: WRITE, def: blade() }).code, 'INVALID', 'every field, null where there is none');
});

test('B3 bounds: generated legendary, a rarity above the place\'s ceiling, stats over the budget, huge effects and an unknown place all reject', async t => {
    const w = await ready(t, 4);   // tier 4: rare at most, level ceiling 50, a rare budget of 66
    const reg = (over, rule = BLADE_RULE, id = 'craft/iron-blade') => sys(w, 'test.register', { write: WRITE, def: blade({ id, ...over }), rule: { ...rule, def: id }, template: 'pack.fixture/forge-blade', area: null, rulesHash: null });
    assert.equal(reg({ rarity: 'legendary' }).code, 'RULES_MISMATCH');
    assert.match(reg({ rarity: 'legendary' }).message, /never legendary/);
    assert.equal(reg({ rarity: 'epic' }).code, 'RULES_MISMATCH', 'above a tier 4 place');
    assert.equal(reg({ stats: { ATK: 9999 } }).code, 'RULES_MISMATCH');
    assert.equal(reg({ stats: { ATK: 70 } }).code, 'RULES_MISMATCH', 'a rare\'s 66 is not 70');
    assert.equal(reg({ rarity: 'rare', stats: { ATK: 66 } }, BLADE_RULE, 'craft/ok-blade').ok, true, 'exactly the budget');
    assert.equal(reg({ stats: { NOPE: 1 } }).code, 'RULES_MISMATCH', 'a stat items do not have');
    assert.equal(reg({ stats: { ATK: 1.5 } }).code, 'RULES_MISMATCH');
    assert.equal(reg({ stats: { ATK: -1000 } }).code, 'RULES_MISMATCH', 'a huge negative is out of range, and no refund');
    // B4 of the review: a refund must not pay for an offence. +999 ATK with -999 on the base stats is no longer a pass.
    assert.equal(reg({ stats: { ATK: 999, STR: -999, VIT: -999, AGI: -999 } }).code, 'RULES_MISMATCH');
    assert.equal(reg({ rarity: 'rare', stats: { ATK: 66, STR: -30, VIT: -30 } }, BLADE_RULE, 'craft/pen-blade').ok, true, 'within the budget alone, penalties are allowed but refund nothing');
    assert.equal(reg({ rarity: 'rare', stats: { ATK: 67, STR: -30 } }, BLADE_RULE, 'craft/over-blade').code, 'RULES_MISMATCH');
    assert.equal(reg({ rarity: 'rare', stats: { STR: 34 } }, BLADE_RULE, 'craft/str-blade').code, 'RULES_MISMATCH', 'a stat past budget / its cost (66 / 2)');
    assert.equal(reg({ value: 1e9 }, BLADE_RULE, 'craft/dear-blade').code, 'RULES_MISMATCH', 'a value past the ceiling');
    assert.match(reg({ value: 1e9 }, BLADE_RULE, 'craft/dear-blade').message, /worth at most/);
    assert.equal(reg({ value: bounds.valueCeiling('rare', 50), rarity: 'rare' }, BLADE_RULE, 'craft/fine-blade').ok, true, 'exactly the ceiling');
    const potion = (effect, id = 'craft/potion') => sys(w, 'test.register', { write: WRITE, def: def(id, { kind: 'consumable', effect }), rule: null, template: 'pack.fixture/forge-blade', area: null, rulesHash: null });
    assert.equal(potion({ heal: 999999 }).code, 'RULES_MISMATCH');
    assert.equal(potion({ mp: 41 }).code, 'RULES_MISMATCH');
    assert.equal(potion({ damage: { amount: 251, element: 'fire', target: 'one' } }).code, 'RULES_MISMATCH');
    assert.equal(potion({ damage: { amount: 20, element: 'fire', target: 'everyone' } }).code, 'RULES_MISMATCH');
    assert.equal(potion({ repair: 51 }).code, 'RULES_MISMATCH');
    assert.equal(potion({ godmode: true }).code, 'RULES_MISMATCH', 'no other effect');
    assert.equal(potion({ cure: Array(9).fill('poison') }).code, 'RULES_MISMATCH');
    assert.equal(potion({ heal: 250, mp: 40, damage: { amount: 250, element: 'fire', target: 'all' }, repair: 50, cure: ['poison'] }, 'craft/potion-max').ok, true, 'the ceilings themselves');
    assert.equal(sys(w, 'test.register', { write: WRITE, def: def('craft/rock', { stats: { ATK: 1 } }), rule: null, template: 'pack.fixture/forge-blade', area: null, rulesHash: null }).code, 'RULES_MISMATCH', 'stats only on equipment');
    assert.equal(sys(w, 'test.register', { write: WRITE, def: def('craft/rock2', { effect: { heal: 5 } }), rule: null, template: 'pack.fixture/forge-blade', area: null, rulesHash: null }).code, 'RULES_MISMATCH', 'an effect only on a consumable');
    assert.deepEqual(Object.keys(generated(w)).sort(), ['craft/fine-blade', 'craft/ok-blade', 'craft/pen-blade', 'craft/potion-max']);
});

test('the tier sets the ceilings: tier 0-1 common, 2-3 uncommon, a rare at 4, an epic at 7; an unknown place holds generation', async t => {
    const w = await ready(t, 1);
    const rarity = (r, id) => sys(w, 'test.register', { write: WRITE, def: def(id, { rarity: r }), rule: null, template: 'pack.fixture/forge-blade', area: null, rulesHash: null });
    assert.equal(rarity('uncommon', 'craft/u1').code, 'RULES_MISMATCH', 'tier 1');
    tier(2);
    assert.equal(rarity('uncommon', 'craft/u2').ok, true);
    assert.equal(rarity('rare', 'craft/r2').code, 'RULES_MISMATCH');
    tier(7);
    assert.equal(rarity('epic', 'craft/e7').ok, true);
    assert.equal(rarity('legendary', 'craft/l7').code, 'RULES_MISMATCH', 'never legendary, whatever the tier');
    delete AREA_TIERS[HAVEN];
    assert.equal(rarity('common', 'craft/c-unknown').code, 'RULES_MISMATCH', 'an unknown tier holds generation, whatever the item (contract §5)');
    assert.equal(rarity('uncommon', 'craft/u-unknown').code, 'RULES_MISMATCH');
    assert.equal(register(w).code, 'RULES_MISMATCH', 'budgeted stats in a place nobody knows');
    assert.match(register(w).message, /no tier/);
    tier(9);
    assert.equal(register(w, { def: blade({ stats: { ATK: 84 } }) }).code, 'RULES_MISMATCH', 'tier 9: level 99, an uncommon budget of 83.2, and 84 is over');
    assert.equal(register(w, { def: blade({ stats: { ATK: 83 } }) }).ok, true);
});

test('the rule must fit the def: non-equipment has no slots or hands, hands follow the slot, two hands only for a weapon alone, the def\'s slot is the rule\'s', async t => {
    const w = await ready(t);
    const rule = over => sys(w, 'test.register', { write: WRITE, def: blade(), rule: { ...BLADE_RULE, ...over }, template: 'pack.fixture/forge-blade', area: null, rulesHash: null });
    assert.equal(rule({ hands: 0 }).code, 'RULES_MISMATCH', 'a weapon is held');
    assert.equal(rule({ allowedSlots: [] }).code, 'RULES_MISMATCH', 'equipment is worn somewhere');
    assert.equal(rule({ allowedSlots: ['head'], hands: 0 }).code, 'RULES_MISMATCH', 'the def says weapon');
    assert.equal(rule({ allowedSlots: ['weapon', 'offhand'], hands: 2 }).code, 'RULES_MISMATCH', 'two hands only for a weapon alone');
    assert.equal(rule({ allowedSlots: ['weapon', 'weapon'] }).code, 'RULES_MISMATCH');
    assert.equal(rule({ allowedSlots: ['weapon', 'offhand', 'head'] }).code, 'RULES_MISMATCH', 'at most two');
    assert.equal(rule({ allowedSlots: ['elbow'] }).code, 'RULES_MISMATCH');
    assert.equal(rule({ hands: 3 }).code, 'RULES_MISMATCH');
    assert.equal(rule({ weight: -1 }).code, 'RULES_MISMATCH');
    assert.equal(rule({ weight: 10001 }).code, 'RULES_MISMATCH');
    assert.equal(rule({ requires: { STR: 100 } }).code, 'RULES_MISMATCH');
    assert.equal(rule({ requires: { LUCK: 3 } }).code, 'RULES_MISMATCH');
    assert.equal(rule({ unique: 'yes' }).code, 'RULES_MISMATCH');
    assert.equal(rule({ def: 'craft/another' }).code, 'RULES_MISMATCH', 'a rule for another item');
    assert.equal(rule({ extra: 1 }).code, 'RULES_MISMATCH');
    assert.equal(rule({ hands: 2 }).ok, true, 'a two-handed weapon');
    const ring = sys(w, 'test.register', { write: WRITE, def: def('craft/ring', { kind: 'equipment', slot: 'accessory-1', stack: false, stats: { LUK: 1 } }), rule: { def: 'craft/ring', allowedSlots: ['accessory-1', 'accessory-2'], hands: 0, requires: {}, weight: 1 }, template: 'pack.fixture/forge-blade', area: null, rulesHash: null });
    assert.equal(ring.ok, true, ring.message);
    const glove = sys(w, 'test.register', { write: WRITE, def: def('craft/glove', { slot: null }), rule: { def: 'craft/glove', allowedSlots: ['head'], hands: 0, requires: {}, weight: 1 }, template: 'pack.fixture/forge-blade', area: null, rulesHash: null });
    assert.equal(glove.code, 'RULES_MISMATCH', 'goods have no slots');
});

test('equipment from a story line has no rule to read: it is refused (no rule is inferred from a name), and a pack\'s id cannot be registered again', async t => {
    const w = await ready(t);
    const gear = sys(w, 'test.register', { write: WRITE, def: blade({ id: 'story/rusty-sword' }), rule: null, template: null, area: null, rulesHash: null });
    assert.equal(gear.code, 'RULES_MISMATCH');
    assert.match(gear.message, /needs its rule/);
    assert.equal(sys(w, 'test.register', { write: WRITE, def: def('pack.fixture/rope'), rule: null, template: null, area: null, rulesHash: null }).code, 'REFUSED');
    assert.equal(sys(w, 'test.register', { write: WRITE, def: def('Bad Id'), rule: null, template: null, area: null, rulesHash: null }).code, 'INVALID');
    assert.deepEqual(generated(w), {});
});

test('failed validation, spend or grant rolls everything back: the definition, the rule, the claim and the provenance go together', async t => {
    const w = await ready(t);
    const failed = sys(w, 'test.registerThenFail', { write: WRITE, def: blade(), rule: BLADE_RULE, template: 'pack.fixture/forge-blade', area: null, rulesHash: null });
    assert.equal(failed.code, 'REFUSED');
    assert.deepEqual(generated(w), {});
    assert.deepEqual(w.q('inventory.definitions', { ids: ['craft/iron-blade'] }), []);
    assert.equal(Object.keys(w.head().meta.claims).filter(key => key.includes(':item:')).length, 0);
    assert.equal(register(w).ok, true, 'and it can be registered after');
});

test('a deleted reply takes the registration with it, and a Re-read puts it back; a rebuild is the live state', async t => {
    const w = await ready(t);
    await w.say('A charm.', ['+ item Moon Charm | qty: 1']);
    const reply = w.host.ctx.chat.length - 1;
    assert.equal(Object.keys(generated(w)).length, 1);
    const live = JSON.stringify([w.slice('rules'), w.slice('inventory')]);
    w.host.store.rebuild();
    assert.equal(JSON.stringify([w.slice('rules'), w.slice('inventory')]), live);
    await w.host.st.deleteMessage(reply);
    await w.host.st.deleteMessage(reply - 1);
    assert.deepEqual(generated(w), {});
    assert.deepEqual(w.slice('inventory').defs, {});
    assert.equal(Object.keys(w.head().meta.claims).filter(key => key.includes(':item:')).length, 0);
    assert.deepEqual(w.problems(), []);
});

test('a chat with no ruleset: the story\'s items are Story Block\'s own, nothing is written to the rules domain', async t => {
    const w = await realWorld(t, { pin: false });
    await w.say('A charm.', ['+ item Moon Charm | qty: 1']);
    assert.equal(w.slice('inventory').defs['story/moon-charm'].name, 'Moon Charm');
    assert.deepEqual(w.slice('rules').generated, {});
    assert.deepEqual(w.problems(), []);
    // Only Story Block\'s own grant may use the pass-through; nobody else registers in a chat that runs no rules.
    const out = sys(w, 'test.register', { write: WRITE, def: def('craft/x'), rule: null, template: null, area: null, rulesHash: null });
    assert.equal(out.code, 'REFUSED');
});

test('the closure: a ruleset holds at most 1000 item rules, the pack\'s and the generated together; more is refused, not truncated', async t => {
    const w = await ready(t);
    const ix = indexOf(pinOf({ domains: { rules: w.slice('rules') } }));
    const payload = { write: WRITE, def: def('story/one'), rule: { def: 'story/one', allowedSlots: [], hands: 0, requires: {}, weight: 0, unique: false }, template: null, area: { place: HAVEN, tier: 4 }, rulesHash: ix.rulesHash };
    const crowded = count => ({ generated: Object.fromEntries(Array.from({ length: count }, (_, n) => [`story/n${n}`, {}])) });
    assert.equal(assessItem({ ix, rules: crowded(1000 - ix.itemRuleCount - 1) }, payload).ok, true);
    const full = assessItem({ ix, rules: crowded(1000 - ix.itemRuleCount) }, payload);
    assert.equal(full.code, 'REFUSED');
    assert.match(full.why, /at most 1000/);
});

test('C18: queries never assign ids or write anything: reading flags, rules, definitions and the training offers leaves the chat byte for byte as it was', async t => {
    const w = await ready(t);
    assert.equal(register(w).ok, true);
    const before = JSON.stringify(w.head());
    for (const [name, args] of [['rules.item', { def: 'craft/iron-blade' }], ['rules.flags', {}], ['inventory.definitions', {}], ['rules.training', { actor: w.pc }], ['rules.party', {}], ['rules.progress', {}], ['rules.identity', {}]]) w.q(name, args);
    assert.equal(JSON.stringify(w.head()), before);
});
