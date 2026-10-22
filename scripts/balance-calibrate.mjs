// Calibration of setup.LEVEL_SHIFT (wave C): for each tier × band level × headcount, the one shift
// (levels added to the tier's foe) that puts the most cells — creatures × presets — on the tier's
// target. Every cell's win rate falls as the shift grows, so a bisection on a statistic of the
// cells finds it: the presets' and creatures' median for even (62.5 %) and strong (35 %), the 10th
// percentile for trivial (99 %) and weak (93 %), the 90th for deadly (13 %): about nine cells in ten
// on the one-sided targets with a little room. Slow: run by hand; it prints a LEVEL_SHIFT table.
//
//   node scripts/balance-calibrate.mjs                       # every group, 16 seeds a cell
//   TIERS=even LEVELS=1,10 COUNTS=1 SEEDS=24 node scripts/balance-calibrate.mjs
//   PROBE=-4,0,4 TIERS=even LEVELS=10 COUNTS=1 node scripts/balance-calibrate.mjs   # rates at those shifts
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { CREATURES, COUNTS, LEVELS, PRESET_IDS, TIERS, onTarget } from './balance-lib.mjs';
import { runCells } from './balance-sim.mjs';
import { LEVEL_SHIFT, HEADCOUNTS, BAND_LEVELS } from '../src/v2/combat/setup.js';

export const AIMS = Object.freeze({ trivial: [0.1, 99], weak: [0.1, 93], even: [0.5, 62.5], strong: [0.5, 35], deadly: [0.9, 13] });

const quantile = (values, q) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (sorted.length - 1) * q;
    const lo = Math.floor(at);
    return sorted[lo] + (sorted[Math.min(sorted.length - 1, lo + 1)] - sorted[lo]) * (at - lo);
};

// The creatures the search runs on (CALIBRATE=all for every one): a spread of roles, skills and
// sources, to keep a search affordable; scripts/balance-sim.mjs checks the result on all of them.
export const CALIBRATION_SET = Object.freeze(['bestiary:Giant Rat', 'bestiary:Slime', 'bestiary:Goblin', 'bestiary:Wolf', 'bestiary:Bandit', 'bestiary:Skeleton', 'bestiary:Cultist', 'bestiary:Troll', 'bestiary:Ogre', 'ersveil:Starved Crag Wolf', 'ersveil:River Drake', 'made:Cellar Rat Swarm']);
const chosen = process.env.CALIBRATE === 'all' ? CREATURES : CREATURES.filter(creature => CALIBRATION_SET.includes(`${creature.set}:${creature.name}`));

function groupCells({ tier, level, count }, shift) {
    // FIELD=n: n foes a member on the field at once (the at-once columns of LEVEL_SHIFT past four).
    const settings = process.env.FIELD ? { fieldPerMember: Number(process.env.FIELD), fieldMax: 24 } : undefined;
    return PRESET_IDS.flatMap(preset => chosen.map(creature => ({ tier, level, count, preset, creature, shift, ...(settings ? { settings } : {}) })));
}

async function rates(groups, shifts, options) {
    const list = groups.flatMap((group, index) => groupCells(group, shifts[index]));
    const rows = await runCells(list, options);
    const per = groups.map(() => []);
    let at = 0;
    groups.forEach((group, index) => {
        const n = PRESET_IDS.length * chosen.length;
        per[index] = rows.slice(at, at + n);
        at += n;
    });
    return per;
}

const stat = (group, rows) => quantile(rows.map(row => row.rate), AIMS[group.tier][0]);
const share = (group, rows) => rows.filter(row => onTarget(group.tier, row.rate)).length / rows.length * 100;

if (import.meta.url === `file://${process.argv[1]}`) {
    const list = (name, all, map = value => value) => (process.env[name] ? process.env[name].split(',').map(map) : all);
    const tiers = list('TIERS', TIERS);
    const levels = list('LEVELS', LEVELS, Number);
    const options = { seeds: Number(process.env.SEEDS ?? 16), first: Number(process.env.FIRST ?? 3000), workers: Number(process.env.WORKERS) || availableParallelism() };
    const groups = [];
    for (const tier of tiers) for (const level of levels) for (const count of list('COUNTS', COUNTS[tier], Number)) if (COUNTS[tier].includes(count)) groups.push({ tier, level, count });

    if (process.env.PROBE) {
        for (const shift of process.env.PROBE.split(',').map(Number)) {
            const per = await rates(groups, groups.map(() => shift), options);
            per.forEach((rows, index) => {
                const group = groups[index];
                const values = rows.map(row => row.rate);
                console.log(`${group.tier} L${group.level} ×${group.count} shift ${shift}: q10 ${quantile(values, 0.1).toFixed(0)} med ${quantile(values, 0.5).toFixed(0)} q90 ${quantile(values, 0.9).toFixed(0)} on target ${share(group, rows).toFixed(0)} %`);
                if (process.env.DETAIL) {
                    for (const preset of PRESET_IDS) console.log(`   ${preset.padEnd(10)} ${rows.filter(row => row.preset === preset).map(row => `${row.creature.split(':')[1].slice(0, 10)} ${Math.round(row.rate)}`).join(', ')}`);
                }
            });
        }
    } else {
        // Bisection, every group at once (one worker pool a step).
        const lo = groups.map(() => Number(process.env.LO ?? -30));
        const hi = groups.map(group => Number(process.env.HI ?? (group.level >= 20 ? 90 : 40)));
        const steps = Number(process.env.STEPS ?? 9);
        for (let step = 0; step < steps; step += 1) {
            const mid = groups.map((_, index) => (lo[index] + hi[index]) / 2);
            const per = await rates(groups, mid, options);
            per.forEach((rows, index) => {
                const group = groups[index];
                // Harder than the aim (the statistic below it): the shift is too high.
                if (stat(group, rows) < AIMS[group.tier][1]) hi[index] = mid[index];
                else lo[index] = mid[index];
            });
            console.error(`step ${step + 1}/${steps} done ${new Date().toISOString()}`);
        }
        let found = groups.map((_, index) => Math.round((lo[index] + hi[index]) / 2 * 4) / 4);
        // REFINE=1: around each found shift, the one that puts the most cells on target (even and
        // strong: the median aim is a proxy for that; the closest to the bisection wins a tie).
        if (process.env.REFINE) {
            const steps = (process.env.REFINE_STEPS ?? '-3,-2,-1,-0.5,0.5,1,2,3').split(',').map(Number);
            const best = groups.map((group, index) => ({ shift: found[index], share: -1, step: Infinity }));
            for (const step of [0, ...steps]) {
                const per = await rates(groups, found.map(shift => shift + step), options);
                per.forEach((rows, index) => {
                    const value = share(groups[index], rows);
                    const b = best[index];
                    if (value > b.share + 1e-9 || (Math.abs(value - b.share) < 1e-9 && Math.abs(step) < Math.abs(b.step))) Object.assign(b, { shift: found[index] + step, share: value, step });
                });
                console.error(`refine ${step} done ${new Date().toISOString()}`);
            }
            found = best.map(entry => entry.shift);
            groups.forEach((group, index) => console.error(`${group.tier} L${group.level} ×${group.count}: ${best[index].share.toFixed(0)} % on target at ${best[index].shift}`));
        }
        const table = structuredClone(LEVEL_SHIFT);
        const plain = Object.fromEntries(Object.entries(table).map(([tier, bands]) => [tier, bands.map(row => [...row])]));
        groups.forEach((group, index) => {
            plain[group.tier][BAND_LEVELS.indexOf(group.level)][HEADCOUNTS.indexOf(group.count)] = found[index];
            console.log(JSON.stringify({ ...group, shift: found[index] }));
        });
        if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(plain, null, 1));
        for (const tier of tiers) {
            console.log(`${tier}:`);
            for (const row of plain[tier]) console.log(`    [${row.join(', ')}],`);
        }
    }
}
