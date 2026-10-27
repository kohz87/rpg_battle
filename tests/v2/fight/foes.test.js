// A pinned ruleset's foe as an engine enemy (B4 foeToEngine, contract §3 P05/P24): the area's tier, level ceiling and allowlists bound it, its
// numbers are the player's formulas with no gear, its skills the frozen base forms, its loot the pack's rows; and the fight that uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TIERS, SD, realWorld } from '../progress/helpers/world.js';
import { foesPin, ref } from '../progress/helpers/fixture.js';
import { foeStatBudget, foeToEngine } from '../../../src/v2/fight/foes.js';
import { packFoes } from '../../../src/v2/fight/index.js';
import { indexOf, initialRules, pinOf, pinRules } from '../../../src/v2/rules/index.js';
import { makeRules } from '../../../src/rules.js';
import { seeded } from '../integration/helpers/host.js';

const pin = foesPin();
const slice = initialRules();
assert.equal(pinRules(slice, pin), '');
const ix = indexOf(pinOf({ domains: { rules: slice } }));
const rules = makeRules({});
const wolf = ix.foeNamed('wolf');
const items = def => ix.itemDef(def);
const AREA = { place: 'pack.fixture/haven', tier: 1, source: 'place', sourceId: 'pack.fixture/haven', allowedFoes: [], allowedTags: [], lore: [] };
const make = (foe = wolf, over = {}) => foeToEngine(foe, { rules, forms: ix, items, area: AREA, ordinal: 3, ...over });

test('the index names the pack\'s foes by ref and by name', () => {
    assert.equal(wolf.id, 'pack.fixture/wolf');
    assert.equal(ix.foe('pack.fixture/wolf'), wolf);
    assert.equal(ix.foeNamed('  WOLF '), wolf);
    assert.equal(ix.foe('pack.fixture/nobody'), null);
    assert.equal(ix.foeNamed('Nobody'), null);
});

test('a foe within the area is an engine enemy: the player\'s formulas with no gear, the frozen base forms, the pack\'s loot, an fo_ record', () => {
    const out = make();
    assert.equal(out.ok, true, out.why);
    const { enemy } = out;
    assert.equal(enemy.id, 'fo_00000003');
    assert.equal(enemy.side, 'enemy');
    assert.equal(enemy.level, 1);
    assert.deepEqual(enemy.stats, wolf.stats);
    assert.ok(enemy.hp.max > 0 && enemy.hp.cur === enemy.hp.max && enemy.patk > 0 && enemy.pdef >= 0 && enemy.crit > 0);
    assert.deepEqual(enemy.skills.map(skill => skill.formId), [ref('s01-base')]);
    assert.deepEqual(enemy.loot, [{ def: 'pack.fixture/rope', name: 'Rope', kind: 'goods', rarity: 'common', stats: {}, chance: 100, qty: [2, 2] }]);
    assert.equal(enemy.pack, 'pack.fixture/wolf');
    assert.equal(enemy.boss, false);
    assert.deepEqual(enemy.items, []);
});

test('the area bounds the foe: no tier, the level ceiling, the foe allowlist, the tag allowlist (an empty list says nothing)', () => {
    assert.equal(make(wolf, { area: { ...AREA, tier: null } }).code, 'AREA');
    assert.equal(make(wolf, { area: null }).code, 'AREA');
    const lord = ix.foeNamed('Warlord');
    assert.equal(make(lord, { area: { ...AREA, tier: 2 } }).code, 'LEVEL', 'level 40 against a ceiling of 30');
    assert.equal(make(lord, { area: { ...AREA, tier: 3 } }).ok, true, 'a ceiling of 40');
    assert.equal(make(wolf, { area: { ...AREA, allowedFoes: ['pack.fixture/warlord'] } }).code, 'FOE_NOT_ALLOWED');
    assert.equal(make(wolf, { area: { ...AREA, allowedFoes: ['pack.fixture/warlord', 'pack.fixture/wolf'] } }).ok, true);
    assert.equal(make(wolf, { area: { ...AREA, allowedTags: ['beast'] } }).code, 'TAG_NOT_ALLOWED', 'every tag must be allowed');
    assert.equal(make(wolf, { area: { ...AREA, allowedTags: ['beast', 'forest', 'war'] } }).ok, true);
});

test('R2: the foe\'s stats may not total more than a player of its level could buy, 35 + 10 + 4 x (level - 1): refused, not clamped', () => {
    const at = (level, each) => ({ ...wolf, level, stats: Object.fromEntries(Object.keys(wolf.stats).map(stat => [stat, each])) });
    assert.equal(make(at(1, 6), { area: { ...AREA, tier: 0 } }).ok, true, '42 of 45');
    assert.equal(make(at(1, 7), { area: { ...AREA, tier: 0 } }).code, 'BUDGET', '49 of 45');
    assert.equal(make(at(11, 12), { area: { ...AREA, tier: 1 } }).ok, true, '84 of 85');
    assert.equal(make(at(11, 13), { area: { ...AREA, tier: 1 } }).code, 'BUDGET', '91 of 85');
    assert.equal(make(at(20, 11), { area: { ...AREA, tier: 1 } }).ok, true, '77 of 121');
    assert.equal(foeStatBudget(1), 45);
    assert.equal(foeStatBudget(99), 45 + 4 * 98);
});

test('a name two pack foes share is no foe (a ref is); one name, one foe', () => {
    assert.equal(ix.foeNamed('Wolf'), wolf);
    const pin2 = foesPin();
    const copy = structuredClone(pin2.resolved.foes['pack.fixture/wolf']);
    const two = { ...pin2, resolved: { ...pin2.resolved, foes: { ...pin2.resolved.foes, 'pack.fixture/wolf-2': { ...copy, id: 'pack.fixture/wolf-2' } } } };
    const slice2 = initialRules();
    assert.equal(pinRules(slice2, two), '');
    const ix2 = indexOf(pinOf({ domains: { rules: slice2 } }));
    assert.equal(ix2.foeNamed('Wolf'), null, 'ambiguous');
    assert.equal(ix2.foe('pack.fixture/wolf-2').id, 'pack.fixture/wolf-2');
});

test('a foe that is not a record, or names what the ruleset does not have, is refused', () => {
    assert.equal(make({ ...wolf, level: 100 }).code, 'FOE');
    assert.equal(make({ ...wolf, stats: { ...wolf.stats, STR: 0 } }).code, 'FOE');
    assert.equal(make({ ...wolf, skills: [] }).code, 'FOE');
    assert.equal(make({ ...wolf, skills: ['s00', 's00'] }).code, 'FOE');
    assert.equal(make({ ...wolf, loot: Array.from({ length: 9 }, () => wolf.loot[0]) }).code, 'FOE');
    assert.equal(make({ ...wolf, loreTags: ['x'.repeat(41)] }).code, 'FOE');
    assert.equal(make(wolf, { ordinal: 0 }).code, 'FOE');
    assert.equal(make({ ...wolf, skills: ['pack.fixture/nope'] }).code, 'REF');
    assert.equal(make({ ...wolf, loot: [{ def: 'pack.fixture/nope', chance: 5, qty: 1 }] }).code, 'REF');
    assert.equal(make(wolf, { items: () => null }).code, 'REF');
});

test('the foe\'s record does not change when the same foe is made twice, and the pack\'s foe is not touched', () => {
    const before = JSON.stringify(wolf);
    assert.deepEqual(make().enemy, make().enemy);
    assert.equal(JSON.stringify(wolf), before);
});

test('R2: an offered foe that names a ref is that foe (an unknown ref is none); the adapter throwing leaves the v1 foe, so a fight always starts', () => {
    const query = (name) => {
        if (name === 'atlas.canonical') return { id: 'pack.fixture/haven' };
        if (name === 'world.areaTier') return AREA;
        return null;
    };
    const ctx = { query };
    const setup = { turns: 'timeline', hit: {}, enemies: [{ id: 'fo_00000001', name: 'Hound', questName: 'Hound', ref: 'pack.fixture/wolf' }, { id: 'fo_00000002', name: 'Wolf', questName: 'Wolf', ref: 'pack.fixture/nobody' }, { id: 'fo_00000003', name: 'Wolf', questName: 'Wolf' }] };
    const out = packFoes(ctx, ix, setup);
    assert.deepEqual(out.enemies.map(foe => foe.pack ?? null), ['pack.fixture/wolf', null, 'pack.fixture/wolf'], 'by ref; an unknown ref is no foe; by name when no ref');
    assert.equal(out.enemies[0].name, 'Hound', 'the offer\'s own name stays');
    const broken = { ...ix, itemDef() { throw new Error('boom'); } };
    const kept = packFoes(ctx, broken, setup);
    assert.deepEqual(kept.enemies.map(({ foeRef, ...enemy }) => enemy), setup.enemies, 'numbers unchanged, nothing thrown');
    assert.deepEqual(kept.enemies.map(enemy => enemy.foeRef), ['pack.fixture/wolf', null, 'pack.fixture/wolf']);
});

// --- the fight ----------------------------------------------------------------------------------------------------------------------

// (The seed of the loot test below: the dice of a fight depend on how many steps came before it.)
const SEED_LOOT = 8;
const play = (name, fn, seed = 7) => test(name, t => seeded(seed, () => fn(t)));
const ready = (t, over = {}) => realWorld(t, { given: foesPin(), sd: true, ...over });
async function begin(w, line, here = null) {
    await w.say('The wolves come.', ['~ time 3000', ...(here ? [here] : []), line]);
    const [offer] = w.q('combat.offers', {});
    const out = w.ui('combat.start', { offer: offer.id });
    assert.equal(out.ok, true, out.message);
    return w.q('combat.session', {});
}
const enemies = w => Object.values(w.slice('combat').fights).at(-1).setup.enemies;

play('in a place Story Director gives a tier, an offered pack foe keeps its identity, level and loot', async t => {
    AREA_TIERS['pack.fixture/haven'] = 1;
    t.after(() => { delete AREA_TIERS['pack.fixture/haven']; });
    const w = await ready(t);
    const v = await begin(w, '! encounter 2 Wolf — hungry | tier: weak', '~ here pack.fixture/haven');
    const foes = enemies(w);
    assert.deepEqual(foes.map(foe => foe.id), ['fo_00000001', 'fo_00000002']);
    assert.deepEqual(foes.map(foe => foe.name), ['Wolf A', 'Wolf B']);
    assert.deepEqual(foes.map(foe => foe.pack), ['pack.fixture/wolf', 'pack.fixture/wolf']);
    assert.deepEqual(foes.map(foe => foe.level), [1, 1]);
    assert.equal(v.status, 'active');
    assert.deepEqual(w.problems(), []);
});

play('where the place has no tier (or the area forbids the foe), the fight is what it was: the v1 projection', async t => {
    const w = await ready(t);
    await begin(w, '! encounter 2 Wolf — hungry | tier: weak');
    assert.ok(enemies(w).every(foe => foe.pack === undefined));
    assert.equal(enemies(w).length, 2);
});

const autoAll = async w => {
    for (let n = 0; n < 60; n += 1) {
        const v = w.q('combat.session', {});
        if (v.status !== 'active') return v;
        assert.equal(w.ui('combat.act', { action: { type: 'auto' }, session: v.id, board: v.board }).ok, true);
    }
    throw new Error('the fight did not end');
};

const fightToEnd = async (t, { register, story = false }) => {
    AREA_TIERS['pack.fixture/haven'] = 1;
    t.after(() => { delete AREA_TIERS['pack.fixture/haven']; });
    const w = await ready(t);
    if (story) await w.say('A coil of rope.', ['~ here pack.fixture/haven', '+ item Rope | qty: 1']);
    if (register) assert.equal(w.ui('test.packDefs').ok, true);
    // Settlement/definition identity needs a reliable Auto win, independent of manual tactics.
    await begin(w, '! encounter 1 Wolf — hungry | tier: trivial', '~ here pack.fixture/haven');
    const done = await autoAll(w);
    assert.equal(done.status, 'won');
    const ended = w.ui('combat.end', { session: done.id });
    assert.equal(ended.ok, true, ended.message);
    return { w, ended };
};

play('the pack\'s foe fights to the end: a win pays its XP, and its loot row is the frozen pinned definition (the pack\'s stack), never a lookup by name', async t => {
    const { w, ended } = await fightToEnd(t, { register: true });
    assert.deepEqual(ended.receipt.data.loot.items.map(item => [item.name, item.qty]), [['Rope', 2]]);
    const stacks = w.q('inventory.items', { owner: 'party' }).filter(row => row.def === 'pack.fixture/rope' || row.defId === 'pack.fixture/rope');
    assert.equal(stacks.reduce((sum, row) => sum + row.qty, 0), 2, JSON.stringify(w.q('inventory.items', { owner: 'party' })));
    assert.deepEqual(w.problems(), []);
}, SEED_LOOT);

play('a drop that names its pinned definition is that definition even when a story item has the same name', async t => {
    const { w, ended } = await fightToEnd(t, { register: true, story: true });
    assert.deepEqual(w.q('inventory.items', { owner: 'party' }).map(row => [row.def ?? row.defId, row.qty]).sort(), [['pack.fixture/rope', 2], ['story/rope', 1]]);
    assert.equal(ended.receipt.data.loot.items[0].qty, 2);
});

play('a pinned drop whose definition the chat does not hold (rules cannot register a pack id here) is held and told, never a failed end', async t => {
    const { ended } = await fightToEnd(t, { register: false });
    assert.deepEqual(ended.receipt.data.loot.items, []);
    assert.deepEqual(ended.receipt.data.loot.left.map(item => [item.name, item.reason]), [['Rope', 'held']]);
});

play('an area that does not allow the foe leaves the v1 projection in its place: the fight still begins', async t => {
    const area = (over) => ({ ...SD, queries: { ...SD.queries, 'world.areaTier': (state, { place } = {}) => ({ place, tier: 1, source: 'place', sourceId: place, allowedFoes: [], allowedTags: [], lore: [], ...over }) } });
    for (const over of [{ allowedFoes: ['pack.fixture/warlord'] }, { allowedTags: ['war'] }]) {
        const w = await realWorld(t, { given: foesPin(), sd: area(over) });
        await begin(w, '! encounter 1 Wolf — hungry | tier: weak', '~ here pack.fixture/haven');
        assert.ok(enemies(w).every(foe => foe.pack === undefined), JSON.stringify(over));
    }
});
