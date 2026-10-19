// Open-ended builds: role words to focus stats, points spread by focus weights (largest
// remainder), a companion's own level-up spending, and skill suggestions within the stats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES as R, STATS, makeRules } from '../src/rules.js';
import { DEFAULT_SKILLS } from '../src/skills.js';
import {
    ROLE_FOCUS, buildAllocation, buildStats, cleanFocus, focusFromRole, focusWeights, guessFocus, lockedReason, spreadByWeights, suggestSkills,
} from '../src/builds.js';
import { newCompanion } from '../src/party.js';

const sum = stats => Object.values(stats).reduce((a, b) => a + b, 0);

test('role words suggest focus stats from a small generic table', () => {
    assert.deepEqual(focusFromRole('healer'), ['INT', 'VIT', 'CHA']);
    assert.deepEqual(focusFromRole('Village Priestess'), ['INT', 'VIT', 'CHA']);
    assert.deepEqual(focusFromRole('court wizard'), ['INT', 'DEX']);
    assert.deepEqual(focusFromRole('knight'), ['STR', 'VIT']);
    assert.deepEqual(focusFromRole('tank'), ['VIT', 'STR']);
    assert.deepEqual(focusFromRole('a thief'), ['AGI', 'DEX', 'LUK']);
    assert.deepEqual(focusFromRole('Rangers'), ['DEX', 'AGI'], 'plurals read');
    assert.deepEqual(focusFromRole('travelling bard'), ['CHA', 'LUK']);
    assert.deepEqual(focusFromRole('monk'), ['STR', 'AGI']);
    assert.deepEqual(focusFromRole('archer and healer'), ['DEX', 'AGI'], 'the first role word wins');
    assert.deepEqual(focusFromRole('companion'), []);
    assert.deepEqual(focusFromRole(''), []);
    assert.deepEqual(guessFocus('companion', 'A wandering cleric who mends wounds.'), ['INT', 'VIT', 'CHA'], 'the summary when the role says nothing');
    assert.deepEqual(guessFocus('scout', 'A healer once.'), ['AGI', 'DEX', 'LUK'], 'the role first');
    for (const entry of ROLE_FOCUS) assert.ok(entry.focus.every(stat => STATS.includes(stat)) && entry.focus.length <= 3);
    assert.deepEqual(cleanFocus(['int', 'INT', 'x', 'dex', 'LUK', 'CHA']), ['INT', 'DEX', 'LUK']);
    assert.deepEqual(focusWeights(['INT', 'VIT', 'CHA']), { INT: 3, VIT: 2, CHA: 1 });
});

test('points spread by weight with the largest remainder; no weights spread evenly', () => {
    assert.deepEqual(spreadByWeights(10, { INT: 3, VIT: 2, CHA: 1 }), { STR: 0, VIT: 3, AGI: 0, DEX: 0, INT: 5, LUK: 0, CHA: 2 });
    assert.deepEqual(spreadByWeights(4, { STR: 3, VIT: 2 }), { STR: 2, VIT: 2, AGI: 0, DEX: 0, INT: 0, LUK: 0, CHA: 0 });
    const even = spreadByWeights(10, {});
    assert.equal(sum(even), 10);
    assert.deepEqual(Object.values(even), [2, 2, 2, 1, 1, 1, 1]);
    assert.equal(sum(spreadByWeights(0, { STR: 1 })), 0);
    for (const total of [1, 7, 13, 40]) assert.equal(sum(spreadByWeights(total, { AGI: 3, DEX: 2, LUK: 1 })), total);
});

test('buildStats: start points then each level\'s points by the focus weights, within the cap', () => {
    const healer = buildStats(['INT', 'VIT', 'CHA'], 6, R);
    assert.equal(sum(healer), 7 * R.character.startStat + R.character.startPoints + 5 * R.character.pointsPerLevel);
    assert.ok(healer.INT > healer.VIT && healer.VIT > healer.CHA && healer.CHA > healer.STR);
    assert.deepEqual(buildStats([], 1, R), { STR: 7, VIT: 7, AGI: 7, DEX: 6, INT: 6, LUK: 6, CHA: 6 });
    assert.deepEqual(buildStats(['STR'], 99, makeRules({ terms: { cap: 3 } })), buildStats(['STR'], 3, R));
});

test('buildAllocation: unspent points in proportion to the build so far, evenly from the start', () => {
    const sheet = { points: 4, stats: { STR: 5, VIT: 7, AGI: 5, DEX: 5, INT: 11, LUK: 5, CHA: 6 } };
    assert.deepEqual(buildAllocation(sheet, R), { VIT: 1, INT: 3 });
    assert.equal(sum(buildAllocation({ ...sheet, points: 9 }, R)), 9);
    assert.equal(sum(buildAllocation({ points: 4, stats: Object.fromEntries(STATS.map(stat => [stat, 5])) }, R)), 4);
    assert.deepEqual(buildAllocation({ ...sheet, points: 0 }, R), {});
});

test('suggestSkills: only what the stats allow, the role\'s types first, at most two of a type', () => {
    const healer = buildStats(['INT', 'VIT', 'CHA'], 1, R);
    const picks = suggestSkills(healer, ['INT', 'VIT', 'CHA'], DEFAULT_SKILLS, { role: 'healer' });
    assert.equal(picks.length, 3);
    assert.ok(picks.some(name => /Heal|Mend/.test(name)), picks.join(', '));
    const library = Object.fromEntries(DEFAULT_SKILLS.map(skill => [skill.name, skill]));
    for (const name of picks) assert.equal(lockedReason(healer, library[name]), '', name);
    const fighter = suggestSkills(buildStats(['STR', 'VIT'], 1, R), ['STR', 'VIT'], DEFAULT_SKILLS, { role: 'warrior' });
    assert.ok(fighter.every(name => library[name].type !== 'heal' || fighter.length === 3));
    assert.equal(fighter.filter(name => library[name].type === 'physical').length, 2, 'two of a type at most while others fit');
    assert.equal(lockedReason({ INT: 7 }, library.Fireball), 'needs INT 9 (has 7)');
});

test('newCompanion: open-ended, focus and skills from the library, refused with why', () => {
    const library = DEFAULT_SKILLS;
    const lyra = newCompanion({ name: 'Lyra', role: 'healer', level: 6, focus: ['INT', 'VIT', 'CHA'], skills: ['Mend', 'Greater Heal', 'Rally'] }, { rules: R, library });
    assert.deepEqual(lyra.sheet.stats, buildStats(['INT', 'VIT', 'CHA'], 6, R));
    assert.equal(lyra.sheet.level, 6);
    assert.deepEqual(lyra.sheet.skills.map(skill => skill.name), ['Mend', 'Greater Heal', 'Rally']);
    assert.equal(lyra.sheet.hp.cur, lyra.sheet.hp.max);
    const plain = newCompanion({ name: 'Tor' }, { rules: R });
    assert.deepEqual(plain.sheet.stats, buildStats([], 1, R), 'no focus: an even spread');
    assert.deepEqual(plain.sheet.skills, []);
    assert.throws(() => newCompanion({ name: 'Tor', focus: ['STR'], skills: ['Fireball'] }, { rules: R, library }), /cannot take Fireball: it needs INT 9/);
    assert.throws(() => newCompanion({ name: 'Tor', skills: ['Nope'] }, { rules: R, library }), /not in the skill library/);
    assert.throws(() => newCompanion({ name: 'Tor', skills: ['Mend', 'Sweep', 'Rally', 'Ward'] }, { rules: R, library }), /3 skills at most/);
});

test('the stat cap (0.5.14): points never raise a stat past it; a full stat passes its share on', async () => {
    const { spreadWithin, withinCap, buildStats, buildAllocation } = await import('../src/builds.js');
    const { spendPoints } = await import('../src/sheet.js');
    const capped = makeRules({ character: { statCap: 20 } });
    // Room caps a stat; what it cannot take goes to the others by weight.
    assert.deepEqual(spreadWithin(10, { STR: 3, DEX: 1 }, { STR: 2 }), { STR: 2, VIT: 0, AGI: 0, DEX: 8, INT: 0, LUK: 0, CHA: 0 });
    assert.deepEqual(spreadWithin(5, { STR: 1 }, Object.fromEntries(STATS.map(stat => [stat, 0]))), Object.fromEntries(STATS.map(stat => [stat, 0])), 'no room: unspent');
    // Under the cap, nothing changes.
    assert.deepEqual(spreadWithin(7, { STR: 3, VIT: 2 }), { STR: 4, VIT: 3, AGI: 0, DEX: 0, INT: 0, LUK: 0, CHA: 0 });
    // A level-30 STR companion: STR stops at 20, the rest goes to VIT and AGI.
    const built = buildStats(['STR', 'VIT', 'AGI'], 30, capped);
    assert.equal(built.STR, 20);
    assert.ok(STATS.every(stat => built[stat] <= 20));
    const total = STATS.reduce((sum, stat) => sum + built[stat], 0);
    assert.ok(total <= 7 * 5 + 10 + 29 * 4);
    assert.equal(withinCap({ STR: 25, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, { STR: 1 }, capped).STR, 20);
    // Auto-spend skips a full stat.
    const sheet = { stats: { STR: 20, VIT: 6, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, points: 4 };
    assert.equal(buildAllocation(sheet, capped).STR, undefined);
    // Spending by hand past it throws, saying so.
    const pc = { name: 'Ren', level: 9, points: 4, stats: { STR: 19, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, hp: { cur: 10, max: 10 }, mp: { cur: 5, max: 5 }, skills: [], conditions: [] };
    assert.throws(() => spendPoints(pc, { STR: 2 }, capped), /STR can go no higher than 20/);
    assert.equal(spendPoints(pc, { STR: 1 }, capped).stats.STR, 20);
    // 0: no cap.
    assert.equal(spendPoints({ ...pc, stats: { ...pc.stats, STR: 400 } }, { STR: 4 }, makeRules({ character: { statCap: 0 } })).stats.STR, 404);
});
