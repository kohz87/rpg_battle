// QA (B-b4-11): a tier means the same whatever the headcount. A fresh level-1 character of every
// creation preset, on auto, against a group of each tier, 40 seeds (the long run is
// scripts/balance-sim.mjs, 200 seeds and every count). Floors, a little wider than the targets for
// 40 seeds: trivial ≥ 95 % won (target 98), weak ≥ 85 % (target 90), deadly ≤ 25 % (target < 20);
// even and strong as the presets' median, 40–85 % and 15–60 % (targets 50–75 and 20–50: the
// presets differ more than those bands, see the PR).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../../../src/skills.js';
import { GROUP_SHIFT, headcountShift, offerRows } from '../../../src/v2/combat/setup.js';
import { DEFAULT_BESTIARY } from '../../../src/enemies.js';
import { fight } from '../../../scripts/balance-sim.mjs';

const SEEDS = 40;
const presets = PRESETS.map(preset => preset.id);

function rates(words, tier) {
    return Object.fromEntries(presets.map(preset => {
        let won = 0;
        for (let seed = 1000; seed < 1000 + SEEDS; seed += 1) if (fight(words, tier, preset, seed) === 'won') won += 1;
        return [preset, Math.round(won / SEEDS * 100)];
    }));
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const [words, tier, check] of [
    ['6 Giant Rat', 'trivial', rate => rate >= 95],
    ['6 Giant Rat', 'weak', rate => rate >= 85],
    ['6 Cellar Rat Swarm', 'weak', rate => rate >= 85],
    ['9 Wolf', 'weak', rate => rate >= 85],
    ['3 Goblin', 'deadly', rate => rate <= 25],
]) {
    test(`every preset against "${words}" (${tier})`, () => {
        const won = rates(words, tier);
        for (const [preset, rate] of Object.entries(won)) assert.ok(check(rate), `${preset}: ${rate} % won (${JSON.stringify(won)})`);
    });
}

for (const [words, tier, [lo, hi]] of [['3 Bandit', 'even', [40, 85]], ['6 Wolf', 'even', [40, 85]], ['2 Wolf', 'strong', [15, 60]], ['4 Bandit', 'strong', [15, 60]]]) {
    test(`the presets' median against "${words}" (${tier}) is in the tier's band`, () => {
        const won = rates(words, tier);
        const middle = median(Object.values(won));
        assert.ok(middle >= lo && middle <= hi, `median ${middle} % (${JSON.stringify(won)})`);
    });
}

test('a lone foe keeps v1\'s tier; a group moves each foe, never past the table', () => {
    for (const tier of Object.keys(GROUP_SHIFT)) {
        assert.equal(headcountShift(tier, 1), 0, tier);
        assert.equal(GROUP_SHIFT[tier].length, 9, tier);
        assert.equal(headcountShift(tier, 30), GROUP_SHIFT[tier][8], tier);
    }
    assert.equal(headcountShift('nonsense', 4), 0);
});

test('the budget is the party\'s: four foes against two members are two each', () => {
    const rows = (count, partySize) => offerRows({ foes: [{ name: 'Wolf', count, tier: 'deadly' }] }, { pcLevel: 1, bestiary: DEFAULT_BESTIARY, partySize });
    const pick = list => list.map(row => [row.count, row.level, row.scale ?? 1]);
    assert.deepEqual(pick(rows(4, 2)).map(([, level, scale]) => [level, scale]), pick(rows(2, 1)).map(([, level, scale]) => [level, scale]));
    assert.equal(rows(4, 2)[0].count, 4, 'all four come');
    assert.equal(rows(9, 1)[0].count, 4, 'a lone character meets four deadly foes at most (MAX_FIELDED)');
});
