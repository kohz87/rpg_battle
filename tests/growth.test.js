// Growth outside fights: story XP awards by share of the next level, levels and points through
// the fight's own path, auto-spend for companions on auto; story rests next to story time;
// encounters in several engagements; a character with no skills still fights.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES as R, makeRules, xpToNext } from '../src/rules.js';
import { awardParty, awardShare, gainXp, questDifficulty, settleCompanions, spendByBuild, xpAward } from '../src/growth.js';
import { newSheet } from '../src/sheet.js';
import { newCompanion, combatantFromSheet, engagements, enemiesFromRows } from '../src/party.js';
import { rest, restAfter } from '../src/recovery.js';
import { DEFAULT_SKILLS } from '../src/skills.js';
import { DEFAULT_BESTIARY } from '../src/enemies.js';
import { makeRng } from '../src/rng.js';
import { act, availableActions, startFight, summarize } from '../src/combat.js';

const ren = newSheet({ name: 'Ren', stats: { STR: 4, VIT: 3, AGI: 1, DEX: 2 } }, R);

test('awards: shares from the rules, by kind or quest difficulty; XP from the next level; none at the cap', () => {
    assert.deepEqual([awardShare({ kind: 'minor' }), awardShare({ kind: 'major' }), awardShare({ kind: 'milestone' })], [0.1, 0.25, 0.5]);
    assert.deepEqual(['easy', 'normal', 'hard', 'nightmare', undefined, 'absurd'].map(difficulty => awardShare({ difficulty })), [0.05, 0.1, 0.15, 0.25, 0.1, 0.1]);
    assert.equal(questDifficulty(' HARD '), 'hard');
    assert.equal(awardShare({ kind: 'major' }, makeRules({ xpAwards: { major: 0.3 } })), 0.3, 'rules.json overrides');
    assert.equal(xpAward(0.25, 1, R), Math.round(0.25 * xpToNext(1, R)));
    assert.equal(xpAward(0.25, 9, R), Math.round(0.25 * xpToNext(9, R)));
    assert.equal(xpAward(0.5, 5, makeRules({ terms: { cap: 5 } })), 0);
});

test('gainXp levels a sheet as a fight does: points, maxima raised', () => {
    const out = gainXp(ren, xpToNext(1, R) + 5, R);
    assert.equal(out.sheet.level, 2);
    assert.equal(out.sheet.xp, 5);
    assert.equal(out.levelsGained, 1);
    assert.equal(out.sheet.points, R.character.pointsPerLevel);
    assert.ok(out.sheet.hp.max > ren.hp.max);
});

test('auto-spend: companions on auto spend by their build; commanded ones and the setting off keep points', () => {
    const lyra = newCompanion({ name: 'Lyra', focus: ['INT', 'VIT', 'CHA'], level: 2 }, { rules: R });
    const withPoints = { ...lyra, sheet: { ...lyra.sheet, points: 4 } };
    const spent = spendByBuild(withPoints.sheet, R);
    assert.equal(spent.points, 0);
    assert.ok(spent.stats.INT - lyra.sheet.stats.INT >= spent.stats.CHA - lyra.sheet.stats.CHA);
    const [auto, commanded] = settleCompanions([withPoints, { ...withPoints, id: 'b', control: 'command' }], { rules: R });
    assert.equal(auto.sheet.points, 0);
    assert.equal(commanded.sheet.points, 4);
    assert.equal(settleCompanions([withPoints], { autoSpend: false, rules: R })[0].sheet.points, 4);
});

test('awardParty: everyone at their own level, companions settle', () => {
    const lyra = newCompanion({ name: 'Lyra', focus: ['INT'], level: 6 }, { rules: R });
    const { pc, members, gains } = awardParty({ pc: ren, members: [lyra] }, 1.2, { rules: R });
    assert.deepEqual(gains.map(gain => [gain.memberId, gain.xp, gain.levelsGained]), [['pc', Math.round(1.2 * xpToNext(1, R)), 1], ['lyra', Math.round(1.2 * xpToNext(6, R)), 1]]);
    assert.equal(pc.level, 2);
    assert.equal(pc.points, 4, 'yours to spend');
    assert.equal(members[0].sheet.level, 7);
    assert.equal(members[0].sheet.points, 0, 'spent by build');
    assert.deepEqual(awardParty({}, 0.1, { rules: R }), { pc: null, members: [], gains: [] });
});

test('a story rest on a reply the clock already healed: the larger of the two, wounds kept; long fills', () => {
    const hurt = { ...ren, hp: { cur: 20, max: ren.hp.max }, mp: { cur: 0, max: ren.mp.max }, conditions: [{ name: 'poison', rounds: 2 }] };
    const share = Math.floor(ren.hp.max * R.recovery.shortRestShare);
    assert.equal(restAfter(hurt, 'short', { rules: R }).hp.cur, 20 + share, 'no clock: the whole short rest');
    assert.equal(restAfter(hurt, 'short', { rules: R, already: { hp: 5, mp: 0 } }).hp.cur, 20 + share - 5, 'only what the clock did not already give');
    assert.equal(restAfter(hurt, 'short', { rules: R, already: { hp: 999, mp: 999 } }).hp.cur, 20, 'the clock gave more: nothing added');
    assert.deepEqual(restAfter(hurt, 'long', { rules: R, already: { hp: 5 } }), rest(hurt, 'long', { rules: R }));
});

test('engagements: "then:" rows fight back to back as waves; a fight runs through them and ends once', () => {
    const rows = [{ name: 'Goblin', count: 1, rank: 'F' }, { name: 'Goblin', count: 1, rank: 'F', wave: 1 }];
    const all = enemiesFromRows(rows, { bestiary: DEFAULT_BESTIARY, library: DEFAULT_SKILLS, rules: R, rng: makeRng('w') });
    const { enemies, waves } = engagements(all);
    assert.deepEqual(enemies.map(enemy => enemy.id), ['e1']);
    assert.deepEqual(waves.map(wave => wave.enemies.map(enemy => enemy.id)), [['e2']]);
    assert.deepEqual(engagements([{ id: 'x', wave: 2 }]), { enemies: [{ id: 'x', wave: 2 }], waves: [] });
    const strong = { ...ren, level: 10, stats: { ...ren.stats, STR: 30, VIT: 20 }, hp: { cur: 300, max: 300 } };
    const party = [combatantFromSheet(strong, { controller: 'auto', library: DEFAULT_SKILLS, rules: R })];
    const fight = startFight({ id: 'w', seed: 'w', party, enemies, waves, stakes: 'normal', rules: R });
    const result = summarize(fight, R);
    assert.equal(result.outcome, 'victory');
    assert.equal(result.defeated.length, 2, 'both engagements in one result');
});

test('a character with no skills fights: attack, defend, flee and parley are there, the skill list is empty', () => {
    const plain = newSheet({ name: 'Ren', stats: { STR: 10 } }, R);
    assert.deepEqual(plain.skills, []);
    const party = [combatantFromSheet(plain, { library: DEFAULT_SKILLS, rules: R })];
    const enemies = enemiesFromRows([{ name: 'Goblin', count: 1, rank: 'F' }], { bestiary: DEFAULT_BESTIARY, library: DEFAULT_SKILLS, rules: R, rng: makeRng('n') });
    let fight = startFight({ id: 'n', seed: 'n', party, enemies, stakes: 'normal', rules: R });
    const actions = availableActions(fight, R);
    assert.deepEqual(actions.skills, []);
    assert.ok(actions.targets.enemies.length);
    let guard = 0;
    while (fight.status === 'active' && guard++ < 100) fight = act(fight, { type: 'attack', target: availableActions(fight, R).targets.enemies[0] }, R);
    assert.notEqual(fight.status, 'active');
});

test('story awards at the XP rate (0.5.2): the offer\'s number is the one given, at least 1', () => {
    const fast = makeRules({ xpRate: 2 });
    assert.equal(xpAward(0.25, 1, fast), 50);
    assert.equal(xpAward(0.25, 1, makeRules({ xpRate: 0.5 })), 13);
    assert.equal(xpAward(0.05, 1, makeRules({ xpRate: 0.25 })), 1, '5 × 0.25 is 1.25: 1');
    assert.equal(xpAward(0.25, 1, makeRules({ xpRate: 99 })), 125, 'the rate is clamped to 5');
    assert.equal(xpAward(0.25, 99, fast), 0, 'nothing at the cap');
    const pc = newSheet({ name: 'Ren', stats: { STR: 5, VIT: 5 } }, fast);
    const out = awardParty({ pc, members: [] }, awardShare({ kind: 'major' }, fast), { rules: fast });
    assert.deepEqual(out.gains.map(gain => gain.xp), [50]);
    assert.equal(out.pc.xp, 50);
    // Quests too, by difficulty.
    assert.equal(xpAward(awardShare({ difficulty: 'nightmare' }, fast), 4, fast), Math.round(0.25 * xpToNext(4, R)) * 2);
});

test('every level needs 100 (0.5.2): awards are 10/25/50 and quests 5/10/15/25 at any level; a level is 100, the rest carried', () => {
    for (const level of [1, 7, 40]) {
        assert.deepEqual(['minor', 'major', 'milestone'].map(kind => xpAward(awardShare({ kind }, R), level, R)), [10, 25, 50], `level ${level}`);
        assert.deepEqual(['easy', 'normal', 'hard', 'nightmare'].map(difficulty => xpAward(awardShare({ difficulty }, R), level, R)), [5, 10, 15, 25], `level ${level}`);
    }
    const pc = { ...newSheet({ name: 'Ren', stats: { STR: 5, VIT: 5 } }, R), xp: 80 };
    const lyra = newCompanion({ name: 'Lyra', role: 'healer', focus: ['INT'], skills: ['Mend'], level: 6 }, { rules: R });
    const out = awardParty({ pc, members: [{ ...lyra, sheet: { ...lyra.sheet, xp: 80 } }] }, awardShare({ kind: 'milestone' }, R), { autoSpend: false, rules: R });
    assert.deepEqual([out.pc.level, out.pc.xp, out.pc.points], [2, 30, R.character.pointsPerLevel]);
    assert.deepEqual([out.members[0].sheet.level, out.members[0].sheet.xp], [7, 30], 'a companion levels the same way');
    const big = gainXp({ ...newSheet({ name: 'Ren', stats: { STR: 5, VIT: 5 } }, R) }, 250, R);
    assert.deepEqual([big.sheet.level, big.sheet.xp, big.levelsGained, big.pointsGained], [3, 50, 2, 2 * R.character.pointsPerLevel]);
});
