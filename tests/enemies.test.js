// The bestiary, the rank × role projection and loot (src/enemies.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, RANKS, RARITIES, makeRules } from '../src/rules.js';
import { makeRng } from '../src/rng.js';
import { DEFAULT_SKILLS, findSkill } from '../src/skills.js';
import { DEFAULT_BESTIARY, LOOT_TABLES, MONSTER_SKILLS, carriesCoin, findCreature, projectEnemy, rollLoot } from '../src/enemies.js';
import { generateCreature } from '../src/templates.js';
import { act, foeXpWorth, startFight, summarize } from '../src/combat.js';
import { resolveThreats } from '../src/story.js';
import { enemiesFromRows, engagements } from '../src/party.js';
import { newPlan } from '../src/plan.js';

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
    // 0.4.2: a name nobody wrote up carries no coin; one that does (`coins`) pays by its rank.
    const unknown = projectEnemy({ name: 'Bog Wight', rank: 'C' }, { rng: makeRng('t') });
    assert.equal(unknown.coins, false);
    assert.equal(rollLoot(unknown, { rng: makeRng('m0') }).money, 0);
    const thing = { ...unknown, coins: true };
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

test('rankRowForLevel interpolates the rank table by level, extrapolates past the top', async () => {
    const { rankRowForLevel } = await import('../src/enemies.js');
    const R = DEFAULT_RULES;
    for (const rank of RANKS) {
        const row = rankRowForLevel(R.ranks[rank].level, R);
        assert.equal(row.rank, rank);
        for (const key of ['hp', 'attack', 'defence', 'xp']) assert.equal(row[key], R.ranks[rank][key], `${rank} ${key}`);
    }
    // Level 11 is a fifth of the way from C (10) to B (15).
    const eleven = rankRowForLevel(11, R);
    assert.equal(eleven.rank, 'C');
    assert.ok(Math.abs(eleven.hp - (52 + (70 - 52) * 0.2)) < 1e-9);
    assert.ok(Math.abs(eleven.attack - (29.5 + (38 - 29.5) * 0.2)) < 1e-9);
    assert.equal(eleven.xp, 168);
    assert.deepEqual(rankRowForLevel(0, R), { level: 1, hp: 20, attack: 14.5, defence: 4, xp: 15, rank: 'F' });
    const past = rankRowForLevel(75, R);
    assert.equal(past.rank, 'SSS');
    assert.ok(past.hp > R.ranks.SSS.hp && past.attack > R.ranks.SSS.attack, 'a cap past SSS still grows');
});

test('projectEnemy with a level: interpolated numbers, the rank at or below for loot; ranks unchanged', () => {
    const at11 = projectEnemy({ name: 'Bog Wight', level: 11, role: 'brute' }, { rules: DEFAULT_RULES });
    assert.equal(at11.level, 11);
    assert.equal(at11.rank, 'C');
    assert.equal(at11.loot, 'rank-C');
    assert.equal(at11.hp.max, Math.round((52 + 18 * 0.2) * 1.3));
    assert.equal(at11.xp, 168);
    const c = projectEnemy({ name: 'Bog Wight', rank: 'C', role: 'brute' }, { rules: DEFAULT_RULES });
    const b = projectEnemy({ name: 'Bog Wight', rank: 'B', role: 'brute' }, { rules: DEFAULT_RULES });
    assert.ok(at11.hp.max > c.hp.max && at11.hp.max < b.hp.max);
    assert.ok(at11.patk >= c.patk && at11.patk <= b.patk);
    // A row level wins over the bestiary's rank; the creature keeps its skills and role.
    const goblin = projectEnemy({ name: 'Goblin', level: 41 }, { rules: DEFAULT_RULES });
    assert.equal(goblin.rank, 'S');
    assert.equal(goblin.role, 'skirmisher');
    assert.ok(goblin.hp.max > projectEnemy({ name: 'Goblin' }, { rules: DEFAULT_RULES }).hp.max * 5);
    // No level: exactly as before.
    assert.deepEqual(projectEnemy({ name: 'Bog Wight', rank: 'C', role: 'brute', level: null }, { rules: DEFAULT_RULES }), c);
});

// ---------------------------------------------------------------------------
// Who carries coin (0.4.2)

test('carriesCoin: people carry coin, beasts and the dead do not, a drake boss sits on a hoard', () => {
    const shipped = name => carriesCoin(findCreature(DEFAULT_BESTIARY, name));
    for (const name of ['Bandit', 'Bandit Captain', 'Cultist', 'Goblin', 'Goblin Shaman', 'Orc Warrior', 'Ogre', 'Cult Priest']) assert.equal(shipped(name), true, name);
    for (const name of ['Wolf', 'Dire Wolf', 'Bear', 'Slime', 'Giant Rat', 'Giant Spider', 'Skeleton', 'Wraith', 'Wight', 'Troll', 'Wyvern']) assert.equal(shipped(name), false, name);
    assert.equal(carriesCoin(findCreature(DEFAULT_BESTIARY, 'Wyvern'), { boss: true }), true, 'a wyvern boss has its hoard');
    for (const c of DEFAULT_BESTIARY) assert.ok(c.coins === true || c.coins === false || c.coins === 'boss', c.name);
    const made = (name, boss = false) => carriesCoin(generateCreature({ name, level: 5 }), { boss });
    for (const name of ['Marsh Thug', 'Orc Chief', 'Bog Witch']) assert.equal(made(name), true, name);
    for (const name of ['Marsh Wolf', 'Bog Wight', 'Skeleton Soldier', 'Bandit Ghost', 'Cave Spider', 'Acid Jelly', 'Iron Golem', 'Thorn Treant', 'Marsh Drake', 'Wolf Matriarch']) assert.equal(made(name), false, name);
    assert.equal(made('Marsh Drake', true), true, 'a drake boss');
    assert.equal(made('Marsh Wolf', true), false, 'a beast boss still has none');
    assert.equal(carriesCoin(null), false);
    // The projected enemy carries the answer for the loot roll.
    assert.equal(projectEnemy({ name: 'Wolf' }).coins, false);
    assert.equal(projectEnemy({ name: 'Bandit' }).coins, true);
    assert.equal(projectEnemy({ name: 'Wyvern', boss: true }).coins, true);
});

test('rollLoot: a coinless foe drops no money but something of itself, more often; carriers pay as before', () => {
    for (const name of ['Wolf', 'Bear', 'Slime', 'Giant Spider', 'Skeleton']) {
        const enemy = projectEnemy({ name }, { rng: makeRng(name) });
        const table = LOOT_TABLES[enemy.loot].map(row => row.name);
        let money = 0;
        let withItem = 0;
        const rng = makeRng(`${name}:loot`);
        for (let i = 0; i < 100; i++) {
            const drop = rollLoot(enemy, { rng });
            money += drop.money;
            if (drop.items.length) withItem += 1;
            for (const item of drop.items) assert.ok(table.includes(item.name), `${name}: ${item.name}`);
        }
        assert.equal(money, 0, name);
        assert.ok(withItem >= 75, `${name}: ${withItem}/100 kills leave something`);
    }
    // The same enemy carrying coin: money, and its materials at their own chances.
    const wolf = projectEnemy({ name: 'Wolf' }, { rng: makeRng('w') });
    let pelts = { coinless: 0, carrier: 0 };
    let paid = 0;
    for (let i = 0; i < 200; i++) {
        pelts.coinless += rollLoot(wolf, { rng: makeRng(`p${i}`) }).items.some(item => item.name === 'Wolf Pelt') ? 1 : 0;
        const carrier = rollLoot({ ...wolf, coins: true }, { rng: makeRng(`p${i}`) });
        pelts.carrier += carrier.items.some(item => item.name === 'Wolf Pelt') ? 1 : 0;
        paid += carrier.money;
    }
    assert.ok(pelts.coinless > pelts.carrier, JSON.stringify(pelts));
    assert.ok(paid > 0);
    for (const name of ['Bandit', 'Bandit Captain', 'Cultist']) {
        const enemy = projectEnemy({ name }, { rng: makeRng(name) });
        let money = 0;
        for (let i = 0; i < 20; i++) money += rollLoot(enemy, { rng: makeRng(`${name}${i}`) }).money;
        assert.ok(money > 0, name);
    }
    // A drake boss made up for the story pays (a hoard); its kin that is no boss does not.
    const drake = generateCreature({ name: 'Marsh Drake', level: 10 });
    const bestiary = [drake];
    const boss = projectEnemy({ name: 'Marsh Drake', boss: true }, { bestiary, rng: makeRng('d') });
    const plain = projectEnemy({ name: 'Marsh Drake' }, { bestiary, rng: makeRng('d') });
    assert.ok(rollLoot(boss, { rng: makeRng('hoard') }).money > 0);
    assert.equal(rollLoot(plain, { rng: makeRng('hoard') }).money, 0);
    // A fight stored before 0.4.2 (no `coins`) pays as it did.
    const { coins, ...older } = wolf;
    assert.equal(coins, false);
    assert.ok(rollLoot(older, { rng: makeRng('old') }).money > 0);
    // Deterministic: the same seed, the same drop.
    assert.deepEqual(rollLoot(wolf, { rng: makeRng('same') }), rollLoot(wolf, { rng: makeRng('same') }));
});

test('a won fight against wolves gives pelts and fangs, not coin, across seeds', () => {
    const rules = DEFAULT_RULES;
    const hero = {
        id: 'pc', memberId: 'pc', name: 'Ren', side: 'party', controller: 'player', level: 8, rank: null, role: null, boss: false,
        stats: { STR: 14, VIT: 12, AGI: 10, DEX: 10, INT: 5, LUK: 5, CHA: 5 }, hp: { cur: 400, max: 400 }, mp: { cur: 0, max: 0 },
        patk: 60, matk: 10, pdef: 20, mdef: 10, crit: 0, skills: [], items: [], conditions: [], morale: 0, talks: false, fleesBelow: 0, xp: 0, loot: null, gone: null,
    };
    for (const seed of ['w1', 'w2', 'w3', 'w4', 'w5']) {
        const rng = makeRng(`${seed}:enemies`);
        const enemies = ['e1', 'e2', 'e3'].map((id, n) => ({ ...projectEnemy({ name: 'Wolf' }, { rng, id }), name: `Wolf ${'ABC'[n]}`, fleesBelow: 0 }));
        let fight = startFight({ id: seed, seed, party: [hero], enemies, stakes: 'normal', rules });
        fight = act(fight, { type: 'auto' }, rules);
        assert.equal(fight.status, 'victory', seed);
        const { loot } = summarize(fight, rules);
        assert.equal(loot.money, 0, seed);
        assert.ok(loot.items.length > 0, `${seed}: something of the wolves`);
        for (const item of loot.items) assert.ok(['Wolf Pelt', 'Fang'].includes(item.name), `${seed}: ${item.name}`);
        assert.ok(loot.items.every(item => item.qty >= 1 && item.qty <= 6), `${seed}: modest`);
    }
});

// 0.5: a boss rolled its whole table twice, so one Grey Wolf Matriarch could drop three pelts.
test('a boss drops its body parts once: materials roll once per creature, its extra rolls are for gear and consumables', () => {
    const library = DEFAULT_SKILLS;
    const wolf = projectEnemy({ name: 'Wolf', boss: true }, { bestiary: DEFAULT_BESTIARY, library, rules: DEFAULT_RULES, rng: makeRng('wolf'), id: 'e1' });
    const matriarch = generateCreature({ name: 'Grey Wolf Matriarch', level: 6, boss: true }, { rules: DEFAULT_RULES, seed: 'chat' });
    const madeUp = { ...projectEnemy({ name: 'Grey Wolf Matriarch', boss: true }, { bestiary: [matriarch], library, rules: DEFAULT_RULES, rng: makeRng('m'), id: 'e2' }), boss: true };
    for (const boss of [wolf, madeUp]) {
        const rows = Array.isArray(boss.loot) ? boss.loot : LOOT_TABLES[boss.loot];
        const materials = rows.filter(row => row.kind === 'material');
        assert.ok(materials.length, boss.name);
        for (let seed = 0; seed < 400; seed++) {
            const { items } = rollLoot(boss, { rng: makeRng(`boss-${seed}`), luck: 9 });
            for (const row of materials) {
                const got = items.filter(item => item.name === row.name);
                assert.ok(got.length <= 1, `${boss.name} seed ${seed}: ${row.name} rolled ${got.length} times`);
                const [, hi] = Array.isArray(row.qty) ? row.qty : [1, 1];
                assert.ok(got.reduce((sum, item) => sum + item.qty, 0) <= hi, `${row.name} within its own qty`);
            }
            if (boss === wolf) assert.ok((items.find(item => item.name === 'Wolf Pelt')?.qty ?? 0) <= 1, 'never more than one pelt');
        }
    }
    // Gear and consumables still get the boss's extra rolls; a creature without coin keeps its likely first material.
    const table = [
        { name: 'Matriarch Pelt', chance: 100, qty: [1, 1], kind: 'material' },
        { name: 'Fang', chance: 100, qty: [1, 2], kind: 'material' },
        { name: 'Torc', chance: 100, qty: [1, 1], kind: 'equipment', rarity: 'uncommon' },
        { name: 'Healing Draught', chance: 100, qty: [1, 1], kind: 'consumable' },
    ];
    const count = (enemy, name) => rollLoot(enemy, { rng: makeRng('x'), luck: 5 }).items.filter(item => item.name === name).length;
    const boss = { name: 'M', rank: 'D', boss: true, coins: false, loot: table };
    const plain = { ...boss, boss: false };
    assert.deepEqual(['Matriarch Pelt', 'Fang', 'Torc', 'Healing Draught'].map(name => count(boss, name)), [1, 1, DEFAULT_RULES.loot.bossRolls, DEFAULT_RULES.loot.bossRolls]);
    assert.deepEqual(['Matriarch Pelt', 'Fang', 'Torc', 'Healing Draught'].map(name => count(plain, name)), [1, 1, 1, 1]);
    const rare = { ...boss, loot: [{ name: 'Pelt', chance: 1, qty: [1, 1], kind: 'material' }] };
    const drops = Array.from({ length: 200 }, (_, seed) => rollLoot(rare, { rng: makeRng(`c-${seed}`), luck: 5 }).items.length);
    assert.ok(drops.filter(Boolean).length > 140, 'the coinless boost on the first material stands');
    assert.ok(drops.every(n => n <= 1));
});

// Live, three made-up "young wolf" dropped "Young Wolf Pelt ×4": the row's quantity let one
// creature give two pelts. A whole-body part is one per creature; fangs and the like are not.
test('a whole-body part is at most one per creature; fangs, claws and scales keep their quantity', async () => {
    const { wholePart } = await import('../src/enemies.js');
    for (const name of ['Young Wolf Pelt', 'Ogre Hide', 'rat tails', 'Beetle Carapace', 'Stag Antlers', 'Troll Skull', 'Bog Eye', 'Drake Heart', 'Goat Horn']) assert.ok(wholePart(name), name);
    for (const name of ['Wolf Fang', 'Bear Claws', 'Drake Scales', 'Owl Feather', 'Old Bone', 'Spider Silk', 'Teeth']) assert.ok(!wholePart(name), name);
    const young = generateCreature({ name: 'Young Wolf', level: 3 }, { rules: DEFAULT_RULES, seed: 'chat' });
    const wolf = { ...projectEnemy({ name: 'Young Wolf' }, { bestiary: [young], library: DEFAULT_SKILLS, rules: DEFAULT_RULES, rng: makeRng('y'), id: 'e1' }), loot: [
        ...young.loot,
        // As a model-flavoured or stored row might have it: a pelt row allowing more than one.
        { name: 'Young Wolf Pelt', chance: 100, qty: [1, 3], kind: 'material' },
        { name: 'Young Wolf Fang', chance: 100, qty: [1, 2], kind: 'material' },
    ] };
    let twoFangs = false;
    for (let seed = 0; seed < 500; seed++) {
        const { items } = rollLoot(wolf, { rng: makeRng(`young-${seed}`), luck: 5 });
        const count = name => items.filter(item => item.name === name).reduce((sum, item) => sum + item.qty, 0);
        for (const item of items) if (wholePart(item.name)) assert.equal(item.qty, 1, `seed ${seed}: ${item.name} ×${item.qty}`);
        assert.ok(count('Young Wolf Pelt') <= 2, 'one per row at most');
        if (items.some(item => item.name === 'Young Wolf Fang' && item.qty === 2)) twoFangs = true;
    }
    assert.ok(twoFangs, 'fangs may still come two at a time');
    // One beast with one pelt row: never more than one pelt, boss or not.
    for (const boss of [false, true]) {
        const beast = { name: 'Young Wolf', rank: 'E', boss, coins: false, loot: [{ name: 'Young Wolf Pelt', chance: 90, qty: [1, 3], kind: 'material' }, { name: 'Young Wolf Fang', chance: 60, qty: [1, 2], kind: 'material' }] };
        for (let seed = 0; seed < 300; seed++) {
            const { items } = rollLoot(beast, { rng: makeRng(`b-${seed}`), luck: 9 });
            assert.ok(items.filter(item => item.name === 'Young Wolf Pelt').reduce((sum, item) => sum + item.qty, 0) <= 1, `seed ${seed}`);
        }
    }
    // The quantity is still drawn: what comes after a capped part drops as before.
    const after = table => rollLoot({ name: 'X', rank: 'E', loot: table }, { rng: makeRng('same'), luck: 5 }).items.at(-1);
    assert.deepEqual(after([{ name: 'X Pelt', chance: 100, qty: [1, 3], kind: 'material' }, { name: 'X Fang', chance: 100, qty: [1, 5], kind: 'material' }]).qty,
        after([{ name: 'X Bone', chance: 100, qty: [1, 3], kind: 'material' }, { name: 'X Fang', chance: 100, qty: [1, 5], kind: 'material' }]).qty);
});

test('a differently worded name finds the creature it means (0.5.1)', async () => {
    const { closeCreature, coreWords } = await import('../src/enemies.js');
    const { creaturesToMake, lookupCreature } = await import('../src/templates.js');
    assert.deepEqual(coreWords('Mangy Ditch-Dogs'), ['ditch', 'dog']);
    assert.deepEqual(coreWords('grey wolf matriarch'), ['wolf']);
    const story = [{ name: 'Feral Ditch-Dog', rank: 'F', role: 'skirmisher' }, { name: 'Grey Wolf Matriarch', rank: 'E', role: 'brute' }];
    const list = [...story, ...DEFAULT_BESTIARY];
    assert.equal(findCreature(list, 'wolf matriarch').name, 'Grey Wolf Matriarch', 'close: the same words without describing ones');
    assert.equal(findCreature(list, 'young wolf').name, 'Wolf', 'most written words in common');
    assert.equal(findCreature([{ name: 'Young Wolf' }, ...list], 'mangy young wolf').name, 'Young Wolf');
    assert.equal(lookupCreature('wolf', story).entry.name, 'Wolf', 'an exact name anywhere beats a close one');
    assert.equal(lookupCreature('young wolf', []).entry.name, 'Wolf');
    assert.equal(lookupCreature('mangy ditch-dogs', story).entry.name, 'Feral Ditch-Dog');
    assert.equal(lookupCreature('young dire wolf', []).entry.name, 'Dire Wolf');
    // A word that names a kind keeps it a creature of its own.
    assert.equal(findCreature(DEFAULT_BESTIARY, 'Bog Wight'), null);
    assert.equal(lookupCreature('scrub quill-dog', story), null);
    assert.equal(closeCreature(list, 'the old'), null, 'nothing but describing words');
    // Nothing is made up for a reworded creature.
    assert.deepEqual([lookupCreature('young wolf', story).entry.name, lookupCreature('young wolf', story).source], ['Wolf', 'default'], 'the closest over both');
    assert.deepEqual([lookupCreature('wolf matriarch', story).entry.name, lookupCreature('wolf matriarch', story).source], ['Grey Wolf Matriarch', 'chat']);
    const rows = [{ name: 'Young Wolf', level: 1 }, { name: 'Mangy Ditch-Dog', level: 1 }, { name: 'Scrub Quill-Dog', level: 1 }];
    assert.deepEqual(creaturesToMake(rows, { chatBestiary: story, seed: 's' }).map(entry => entry.name), ['Scrub Quill-Dog']);
});

// ---------------------------------------------------------------------------
// Threat words at low levels (0.5.2)

const threatened = (threat, partyLevel, rules = DEFAULT_RULES, extra = {}) =>
    enemiesFromRows(resolveThreats([{ name: 'Wolf', count: 1, rank: null, threat, ...extra }], partyLevel, rules), { bestiary: DEFAULT_BESTIARY, library: DEFAULT_SKILLS, rules, rng: null })[0];

test('a level-1 party: even > weak > trivial in HP, attack and XP; defence the same', () => {
    const [even, weak, trivial] = ['even', 'weak', 'trivial'].map(threat => threatened(threat, 1));
    assert.deepEqual([even.level, weak.level, trivial.level], [1, 1, 1]);
    assert.ok(even.hp.max > weak.hp.max && weak.hp.max > trivial.hp.max, `${even.hp.max} > ${weak.hp.max} > ${trivial.hp.max}`);
    assert.ok(even.patk > weak.patk && weak.patk > trivial.patk);
    assert.equal(weak.pdef, even.pdef);
    assert.equal(trivial.pdef, even.pdef);
    assert.deepEqual([even.hp.max, weak.hp.max, trivial.hp.max], [16, 10, 6]);
    assert.deepEqual([even.scale, weak.scale, trivial.scale], [undefined, 0.6, 0.36]);
    assert.deepEqual([even.xpLevel, weak.xpLevel, trivial.xpLevel], [undefined, -3, -7]);
    assert.deepEqual([even, weak, trivial].map(foe => foeXpWorth(foe, 1)), [10, 5, 3], 'XP for a level-1 PC');
    assert.equal(weak.threat, 'weak', 'the word goes along for the card');
});

test('a level-10 party: weak is level 6 and unscaled, as before; explicit powers are never scaled', () => {
    const weak = threatened('weak', 10);
    const plain = projectEnemy({ name: 'Wolf', level: 6 }, { library: DEFAULT_SKILLS });
    assert.equal(weak.level, 6);
    assert.equal(weak.scale, undefined);
    assert.equal(weak.hp.max, plain.hp.max);
    assert.equal(foeXpWorth(weak, 10), 5, 'half an even foe');
    // A level, a rank or a power written outright: the row is left alone, whatever its threat word.
    const level = threatened('trivial', 1, DEFAULT_RULES, { level: 1 });
    const rank = threatened('trivial', 1, DEFAULT_RULES, { rank: 'F' });
    const own = projectEnemy({ name: 'Wolf', level: 1 }, { library: DEFAULT_SKILLS });
    assert.equal(level.scale, undefined);
    assert.equal(rank.scale, undefined);
    assert.equal(level.hp.max, own.hp.max);
    assert.equal(rank.hp.max, own.hp.max);
    // A scale or xpLevel on a row without a level does nothing.
    const stray = enemiesFromRows([{ name: 'Wolf', count: 1, rank: 'F', scale: 0.4, xpLevel: -5 }], { bestiary: DEFAULT_BESTIARY, library: DEFAULT_SKILLS, rules: DEFAULT_RULES, rng: null })[0];
    assert.equal(stray.scale, undefined);
    assert.equal(stray.xpLevel, undefined);
});

test('waves and plan stages carry the scale onto their foes', () => {
    const rows = resolveThreats([
        { name: 'Wolf', count: 1, rank: null, threat: 'even' },
        { name: 'Wolf', count: 2, rank: null, threat: 'weak', wave: 1 },
    ], 1);
    const { enemies, waves } = engagements(enemiesFromRows(rows, { bestiary: DEFAULT_BESTIARY, library: DEFAULT_SKILLS, rules: DEFAULT_RULES, rng: null }));
    assert.equal(enemies[0].scale, undefined);
    assert.deepEqual(waves[0].enemies.map(foe => [foe.scale, foe.xpLevel, foe.hp.max]), [[0.6, -3, 10], [0.6, -3, 10]]);
    // A plan keeps its stages' rows as written (with their scale) until each stage is fought.
    const plan = newPlan({ id: 'p', stages: [{ place: 'the gate', rows: [rows[0]] }, { place: 'the yard', rows: [rows[1]] }] });
    const stage2 = plan.stages[1].rows;
    assert.deepEqual(stage2.map(row => [row.scale, row.xpLevel]), [[0.6, -3]]);
    const foes = enemiesFromRows(stage2, { bestiary: DEFAULT_BESTIARY, library: DEFAULT_SKILLS, rules: DEFAULT_RULES, rng: null });
    assert.deepEqual(foes.map(foe => [foe.scale, foe.hp.max, foeXpWorth(foe, 1)]), [[0.6, 10, 5], [0.6, 10, 5]]);
});
