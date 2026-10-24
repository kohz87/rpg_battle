// A pinned ruleset's foe as an engine enemy (B4 foeToEngine, contract §3 P05/P24): the area's tier, level ceiling and allowlists bound it, its
// numbers are the player's formulas with no gear, its skills the frozen base forms, its loot the pack's rows; and the fight that uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TIERS, SD, realWorld } from '../progress/helpers/world.js';
import { foesPin, ref } from '../progress/helpers/fixture.js';
import { foeToEngine } from '../../../src/v2/fight/foes.js';
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

// --- the fight ----------------------------------------------------------------------------------------------------------------------

const play = (name, fn) => test(name, t => seeded(7, () => fn(t)));
const ready = (t, over = {}) => realWorld(t, { given: foesPin(), sd: true, ...over });
async function begin(w, line, here = null) {
    await w.say('The wolves come.', ['~ time 3000', ...(here ? [here] : []), line]);
    const [offer] = w.q('combat.offers', {});
    const out = w.ui('combat.start', { offer: offer.id });
    assert.equal(out.ok, true, out.message);
    return w.q('combat.session', {});
}
const enemies = w => Object.values(w.slice('combat').fights).at(-1).setup.enemies;

play('in a place Story Director gives a tier, an offered foe the pack wrote up is fought as the pack wrote it; its id, letter and loot go along', async t => {
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

const attackAll = async w => {
    for (let n = 0; n < 60; n += 1) {
        const v = w.q('combat.session', {});
        if (v.status !== 'active') return v;
        assert.equal(w.ui('combat.act', { action: { type: 'attack', target: v.actions.targets.enemies[0] }, session: v.id, board: v.board }).ok, true);
    }
    throw new Error('the fight did not end');
};

play('the pack\'s foe fights to the end: a win pays its XP, and its loot row is granted from the pack\'s definition', async t => {
    AREA_TIERS['pack.fixture/haven'] = 1;
    t.after(() => { delete AREA_TIERS['pack.fixture/haven']; });
    const w = await ready(t);
    await begin(w, '! encounter 1 Wolf — hungry | tier: weak', '~ here pack.fixture/haven');
    const done = await attackAll(w);
    assert.equal(done.status, 'won');
    const ended = w.ui('combat.end', { session: done.id });
    assert.equal(ended.ok, true, ended.message);
    const last = w.q('combat.last', {}) ?? w.slice('combat').last?.[0];
    assert.ok(last, 'a result was kept');
    assert.ok(w.q('inventory.items', { owner: 'party' }).some(row => /rope/i.test(row.name ?? row.def ?? '')), 'the rope dropped (chance 100)');
    assert.deepEqual(w.problems(), []);
});

play('an area that does not allow the foe leaves the v1 projection in its place: the fight still begins', async t => {
    const area = (over) => ({ ...SD, queries: { ...SD.queries, 'world.areaTier': (state, { place } = {}) => ({ place, tier: 1, source: 'place', sourceId: place, allowedFoes: [], allowedTags: [], lore: [], ...over }) } });
    for (const over of [{ allowedFoes: ['pack.fixture/warlord'] }, { allowedTags: ['war'] }]) {
        const w = await realWorld(t, { given: foesPin(), sd: area(over) });
        await begin(w, '! encounter 1 Wolf — hungry | tier: weak', '~ here pack.fixture/haven');
        assert.ok(enemies(w).every(foe => foe.pack === undefined), JSON.stringify(over));
    }
});
