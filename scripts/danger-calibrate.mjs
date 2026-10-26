// Real capture, then isolated synchronous calibration with the same party and recorded offer.
// Run from either revision with this script + tests/v2/fight/helpers/danger.js.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PACK, SEEDS, world, offer, setupOf } from '../tests/v2/fight/helpers/danger.js';
import { seeded } from '../tests/v2/integration/helpers/host.js';
import { resolveOpposition, autoOutcome } from '../src/v2/fight/danger.js';
import { fightNumbers } from '../src/v2/combat/setup.js';
import { packBestiary } from '../src/v2/combat/index.js';
import { bestiaryList, fightRules } from '../src/v2/combat/stored.js';
const runs = Number(process.env.DANGER_RUNS ?? 10);
const classes = PACK.content.rules[0].classes.filter(klass => klass.tier === 0);
for (const klass of classes.filter(k => !process.env.DANGER_CLASS || k.slug === process.env.DANGER_CLASS)) await seeded(7, async () => {
    const cleanup = [];
    try {
        const h = await world({ after: fn => cleanup.push(fn) }, klass.slug);
        for (const tier of ['weak', 'normal', 'strong'].filter(t => !process.env.DANGER_TIER || t === process.env.DANGER_TIER)) {
            const captured = await offer(h, tier);
            const fresh = structuredClone(captured);
            delete fresh.opposition;
            const options = { numbers: fightNumbers({}), chatBestiary: [...bestiaryList(h.ctxForFight.read('bestiary')), ...packBestiary(h.ctxForFight, fightRules(fightNumbers({})))] };
            // Untimed warmup; every call starts from an unresolved offer (no result cache).
            const repeat = () => {
                const next = structuredClone(fresh);
                const start = performance.now();
                resolveOpposition(h.ctxForFight, next, options);
                const ms = performance.now() - start;
                assert.deepEqual(next.opposition, captured.opposition);
                return ms;
            };
            repeat();
            const timings = Array.from({ length: runs }, repeat).sort((a, b) => a - b);
            const median = (timings[Math.floor((runs - 1) / 2)] + timings[Math.floor(runs / 2)]) / 2;
            const setup = setupOf(h, captured);
            let wins = 0;
            for (let seed = 1000; seed < 1000 + SEEDS; seed++) if (autoOutcome(setup, seed) === 'victory') wins++;
            console.log(JSON.stringify({ class: klass.slug, tier, wins, seeds: SEEDS, rate: wins / SEEDS * 100, medianMs: median, timingsMs: timings }));
        }
    } finally { for (const fn of cleanup.reverse()) await fn(); }
});
