// B4r2-3, -4, -7, -8 (all fixed; -4, -7 and -8 by wave C: lone foes on the same threat budget, each
// creature's power normalized, the budget calibrated per level band): the balance (RB-fix1 #83: a tier is a threat budget for the group, hang-back,
// stun cap) against its own targets (scripts/balance-sim.mjs TARGETS: trivial ≥ 98 %, weak ≥ 90 %,
// even 50–75 %, strong 20–50 %, deadly < 20 %, even and strong read as the presets' middle),
// measured on seeds the calibration did not use (5000+, 8000+). Numbers: r2/sim/*.jsonl.
//
// B4r2-3: each row's foes move by the WHOLE offer's headcount, whatever tier the other rows are, so
// trivial fodder makes a deadly foe small: "deadly Ogre, 5 trivial Giant Rat" fields a level-2 Ogre
// (alone: level 9) and the fighter wins 99 % (alone 19 %). A boss row is shifted too ("Ancient
// Dragon (boss), 8 Wolf": the dragon drops from level 9 to 2).
// B4r2-4: lone foes keep v1's level (setup.js groupPower: headcount < 2 → no shift), so a lone
// strong or deadly foe is far off the targets: 1 Wolf strong 88–100 %, deadly 9–60 % (median 28).
// B4r2-7: the shifts were calibrated on six bestiary foes (Wolf, Giant Rat, Bandit, Goblin, Cellar Rat
// Swarm, Marsh Ghoul); other creatures at the same tier miss by far: 5 deadly Trolls are won 55–100 %
// (median 91), 5 deadly Skeletons 45–100 %, 3 strong Trolls 96–100 % (r2/sim/other-*.jsonl).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fight, TARGETS } from '../../../scripts/balance-sim.mjs';
import { CREATURES, PRESET_IDS, cellRate } from '../../../scripts/balance-lib.mjs';

const PRESETS = ['fighter', 'skirmisher', 'caster', 'healer', 'archer'];
const rate = (words, tier, preset, first, seeds) => {
    let won = 0;
    for (let seed = first; seed < first + seeds; seed += 1) if (fight(words, tier, preset, seed) === 'won') won += 1;
    return won / seeds * 100;
};
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

test('B4r2-3: trivial fodder does not make a deadly foe easier (the deadly Ogre stays deadly)', { timeout: 600000 }, () => {
    const alone = rate('deadly Ogre', 'even', 'fighter', 8000, 60);
    const withFodder = rate('deadly Ogre, 5 trivial Giant Rat', 'even', 'fighter', 8000, 60);
    assert.ok(withFodder <= alone + 10, `the fighter wins ${withFodder.toFixed(0)} % with five trivial rats beside the deadly Ogre, ${alone.toFixed(0)} % against the Ogre alone`);
});

// Wave C: measured through scripts/balance-lib.mjs (v2's setup code and v1's engine, no bus), on
// seeds the calibration did not use (5000+, 6000+).
const creature = (name, set = 'bestiary') => CREATURES.find(entry => entry.set === set && entry.name === name);
const rates = (name, count, tier, { level = 1, seeds = 40, first = 5000, presets = PRESET_IDS, set = 'bestiary' } = {}) => presets.map(preset => cellRate({ creature: creature(name, set), count, tier, preset, level, seeds, first }));
const show = (list, presets = PRESET_IDS) => presets.map((preset, index) => `${preset} ${list[index].toFixed(0)}`).join(', ');

test('B4r2-4: a lone strong or deadly foe meets the tier targets (presets\' middle)', { timeout: 600000 }, () => {
    for (const tier of ['strong', 'deadly']) {
        const won = rates('Wolf', 1, tier);
        const [lo, hi] = TARGETS[tier];
        const mid = median(won);
        assert.ok(mid >= lo && mid <= hi, `1 Wolf (${tier}): ${show(won)}; middle ${mid.toFixed(0)} % is outside ${lo}–${hi} %`);
    }
});

test('B4r2-7: a deadly group of a creature outside the old calibration set is still deadly (five Trolls)', { timeout: 600000 }, () => {
    const won = rates('Troll', 5, 'deadly');
    assert.ok(won.every(value => value < TARGETS.deadly[1]), `5 Troll (deadly): ${show(won)} won`);
});

test('B4r2-8: weak foes stay weak at level 20 (four Cellar Rat Swarms, caster and fighter ≥ 90 %)', { timeout: 600000 }, () => {
    const presets = ['caster', 'fighter'];
    const won = rates('Cellar Rat Swarm', 4, 'weak', { level: 20, seeds: 50, first: 6000, presets, set: 'made' });
    assert.ok(won.every(value => value >= 90), `level-20 four weak Cellar Rat Swarms: ${show(won, presets)}`);
});
