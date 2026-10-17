// The bestiary, the rank × role projection and loot (src/enemies.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, RANKS, RARITIES, makeRules } from '../src/rules.js';
import { makeRng } from '../src/rng.js';
import { DEFAULT_SKILLS, findSkill } from '../src/skills.js';
import { DEFAULT_BESTIARY, LOOT_TABLES, MONSTER_SKILLS, findCreature, projectEnemy, rollLoot } from '../src/enemies.js';

const ROLES = ['brute', 'skirmisher', 'caster', 'tank', 'support'];

test('the bestiary has at least 15 creatures across F..C with known skills and loot tables', () => {
    assert.ok(DEFAULT_BESTIARY.length >= 15);
    for (const rank of ['F', 'E', 'D', 'C']) assert.ok(DEFAULT_BESTIARY.some(c => c.rank === rank), rank);
    for (const c of DEFAULT_BESTIARY) {
        assert.ok(RANKS.includes(c.rank), c.name);
        assert.ok(ROLES.includes(c.role), c.name);
        assert.equal(typeof c.talks, 'boolean');
        assert.ok(Number.isFinite(c.morale) && Number.isFinite(c.fleesBelow));
        assert.ok(LOOT_TABLES[c.loot], `${c.name} loot ${c.loot}`);
        for (const name of c.skills) assert.ok(findSkill(DEFAULT_SKILLS, name) || findSkill(MONSTER_SKILLS, name), `${c.name}: ${name}`);
    }
});

test('loot tables have valid rows, consumables carry an effect, every rank has a default', () => {
    for (const rank of RANKS) assert.ok(LOOT_TABLES[`rank-${rank}`], rank);
    let equipment = 0;
    for (const [id, table] of Object.entries(LOOT_TABLES)) {
        for (const row of table) {
            assert.ok(['material', 'consumable', 'equipment'].includes(row.kind), `${id}: ${row.name}`);
            assert.ok(row.chance > 0 && row.chance <= 100);
            assert.ok(row.qty[0] >= 1 && row.qty[1] >= row.qty[0]);
            if (row.kind === 'consumable') assert.match(row.effect, /^(heal|mp|cure|fire|ice|holy|poison)\b/);
            if (row.kind === 'equipment') {
                equipment += 1;
                assert.ok(RARITIES.includes(row.rarity));
                assert.ok(Object.keys(row.stats).length);
            }
        }
    }
    assert.ok(equipment >= 5);
});

test('findCreature matches names and aliases, ignoring case and a row number', () => {
    assert.equal(findCreature(DEFAULT_BESTIARY, 'goblin shaman').name, 'Goblin Shaman');
    assert.equal(findCreature(DEFAULT_BESTIARY, 'Goblin 2').name, 'Goblin');
    assert.equal(findCreature(DEFAULT_BESTIARY, 'Goblin #3').name, 'Goblin');
    assert.equal(findCreature(DEFAULT_BESTIARY, 'brigand').name, 'Bandit');
    assert.equal(findCreature(DEFAULT_BESTIARY, 'Bog Wight'), null);
    assert.equal(findCreature(DEFAULT_BESTIARY, ''), null);
});

test('a bestiary creature brings its numbers; the row can override its rank', () => {
    const rng = makeRng('shaman');
    const shaman = projectEnemy({ name: 'Goblin Shaman' }, { rng, id: 'e1', library: DEFAULT_SKILLS });
    assert.equal(shaman.id, 'e1');
    assert.equal(shaman.side, 'enemy');
    assert.equal(shaman.controller, 'auto');
    assert.equal(shaman.rank, 'E');
    assert.equal(shaman.role, 'caster');
    assert.equal(shaman.level, DEFAULT_RULES.ranks.E.level);
    assert.equal(shaman.talks, true);
    assert.equal(shaman.morale, 4);
    assert.equal(shaman.fleesBelow, 0.3);
    assert.equal(shaman.loot, 'goblin-caster');
    assert.equal(shaman.xp, DEFAULT_RULES.ranks.E.xp);
    assert.deepEqual(shaman.skills.map(s => s.name), ['Hex', 'Spark']);
    assert.ok(shaman.skills.every(s => s.mastery === 1 && s.cooldownLeft === 0));
    assert.ok(shaman.matk > shaman.patk);
    assert.equal(shaman.gone, null);
    assert.equal(shaman.hp.cur, shaman.hp.max);
    const tough = projectEnemy({ name: 'Goblin Shaman', rank: 'C' }, { rng: makeRng('x'), id: 'e2' });
    assert.equal(tough.rank, 'C');
    assert.ok(tough.hp.max > shaman.hp.max);
});

test('an unknown name is projected from rank × role and keeps its name', () => {
    const wight = projectEnemy({ name: 'Bog Wight', rank: 'D', role: 'tank' }, { rng: makeRng('bog'), id: 'e1' });
    assert.equal(wight.name, 'Bog Wight');
    assert.equal(wight.rank, 'D');
    assert.equal(wight.role, 'tank');
    assert.equal(wight.talks, false);
    assert.equal(wight.morale, DEFAULT_RULES.enemy.moraleBase + RANKS.indexOf('D'));
    assert.equal(wight.fleesBelow, DEFAULT_RULES.enemy.fleesBelow);
    assert.equal(wight.loot, 'rank-D');
    const r = DEFAULT_RULES.ranks.D;
    const w = DEFAULT_RULES.roles.tank;
    const v = DEFAULT_RULES.variation;
    assert.ok(wight.hp.max >= Math.floor(r.hp * w.hp * (1 - v)) && wight.hp.max <= Math.ceil(r.hp * w.hp * (1 + v)));
    assert.equal(projectEnemy({ name: 'Hedge Witch', role: 'caster' }, { rng: makeRng('w') }).talks, true);
    const plain = projectEnemy({ name: 'Thing' }, {});
    assert.equal(plain.rank, 'F');
    assert.equal(plain.role, 'brute');
});

test('roles weight the rank numbers', () => {
    const exact = makeRules({ variation: 0 });
    const of = role => projectEnemy({ name: 'X', rank: 'C', role }, { rules: exact, rng: makeRng('r') });
    assert.ok(of('brute').hp.max > of('skirmisher').hp.max);
    assert.ok(of('tank').pdef > of('brute').pdef);
    assert.ok(of('skirmisher').stats.AGI > of('brute').stats.AGI);
    assert.ok(of('caster').matk > of('caster').patk);
    assert.ok(of('support').skills.some(s => s.type === 'heal'));
});

test('variation comes from the seed: same seed same enemy, another seed differs', () => {
    const a = projectEnemy({ name: 'Bandit' }, { rng: makeRng('s1'), id: 'e1' });
    const b = projectEnemy({ name: 'Bandit' }, { rng: makeRng('s1'), id: 'e1' });
    assert.deepEqual(a, b);
    const many = new Set(Array.from({ length: 20 }, (_, i) => projectEnemy({ name: 'Bandit' }, { rng: makeRng(`s${i}`) }).hp.max));
    assert.ok(many.size > 1);
});

test('bosses get the multipliers and a signature skill, and never flee', () => {
    const exact = makeRules({ variation: 0 });
    const ogre = projectEnemy({ name: 'Ogre' }, { rules: exact, rng: makeRng('o') });
    const boss = projectEnemy({ name: 'Ogre', boss: true }, { rules: exact, rng: makeRng('o') });
    assert.equal(boss.boss, true);
    assert.ok(Math.abs(boss.hp.max - ogre.hp.max * DEFAULT_RULES.boss.hp) <= DEFAULT_RULES.boss.hp);
    assert.ok(boss.patk > ogre.patk && boss.pdef >= ogre.pdef);
    assert.equal(boss.xp, ogre.xp * DEFAULT_RULES.boss.xp);
    assert.equal(boss.fleesBelow, 0);
    assert.ok(boss.skills.length > ogre.skills.length);
});

test('rollLoot is deterministic, in the smallest unit, and luck helps', () => {
    const goblin = projectEnemy({ name: 'Goblin' }, { rng: makeRng('g') });
    const a = rollLoot(goblin, { rng: makeRng('loot'), luck: 5 });
    const b = rollLoot(goblin, { rng: makeRng('loot'), luck: 5 });
    assert.deepEqual(a, b);
    const [low, high] = DEFAULT_RULES.moneyByRank.F;
    assert.ok(Number.isInteger(a.money) && a.money >= low && a.money <= high);
    for (const item of a.items) {
        assert.ok(item.name && item.qty >= 1 && RARITIES.includes(item.rarity));
        assert.ok(['material', 'consumable', 'equipment'].includes(item.kind));
    }
    const count = luck => {
        const rng = makeRng('luck');
        let items = 0;
        let money = 0;
        for (let i = 0; i < 400; i++) {
            const drop = rollLoot(goblin, { rng, luck });
            items += drop.items.length;
            money += drop.money;
        }
        return { items, money };
    };
    const unlucky = count(5);
    const lucky = count(15);
    assert.ok(lucky.items > unlucky.items);
    assert.ok(lucky.money > unlucky.money);
});

test('rollLoot falls back on the rank table, and a boss pays more', () => {
    const thing = projectEnemy({ name: 'Bog Wight', rank: 'C' }, { rng: makeRng('t') });
    const names = new Set(LOOT_TABLES['rank-C'].map(row => row.name));
    const rng = makeRng('fallback');
    for (let i = 0; i < 50; i++) for (const item of rollLoot(thing, { rng }).items) assert.ok(names.has(item.name));
    const boss = { ...thing, boss: true };
    let plain = 0;
    let big = 0;
    for (let i = 0; i < 100; i++) {
        plain += rollLoot(thing, { rng: makeRng(`m${i}`) }).money;
        big += rollLoot(boss, { rng: makeRng(`m${i}`) }).money;
    }
    assert.ok(big > plain * 2);
    const consumable = rollLoot({ loot: 'bandit-leader', rank: 'D' }, { rng: makeRng('c3') }).items.find(i => i.kind === 'consumable');
    if (consumable) assert.equal(consumable.effect, 'heal 30');
});
