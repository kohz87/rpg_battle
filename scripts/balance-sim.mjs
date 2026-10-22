// Balance simulation (B-b4-11, wave C): how often a standard character of every creation preset, on
// auto, beats an offer of each tier, across creatures (the bestiary's, the Ersveil pack's, made-up
// ones), headcounts and levels. Fights run through v2's encounter → setup code and v1's engine
// (scripts/balance-lib.mjs), split over worker threads. Slow: run by hand.
//
//   node scripts/balance-sim.mjs                         # the whole matrix, 200 seeds a cell
//   SEEDS=40 LEVELS=1,10 TIERS=even node scripts/balance-sim.mjs
//   CREATURES=Wolf,Troll PRESETS=caster COUNTS=1,3 node scripts/balance-sim.mjs
//   OUT=rows.jsonl node scripts/balance-sim.mjs          # one JSON row per cell into OUT
//   WORKERS=4 (default: the CPUs)
//   REPORT=a.jsonl,b.jsonl node scripts/balance-sim.mjs  # the summary of OUT files already run
//
// A cell is one tier × level × headcount × preset × creature. The targets: trivial ≥ 98 % won,
// weak ≥ 90 %, even 50–75 %, strong 20–50 %, deadly < 20 %. The pass rule: about 90 % of cells
// on target. The fast version with floors is tests/v2/qa/balance-tiers.test.js (npm test).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { withHero } from '../tests/v2/qa/helpers/harness.js';
import { CREATURES, LEVELS, PRESET_IDS, TIERS, cellRate, cells, onTarget } from './balance-lib.mjs';

export { TARGETS, TIERS } from './balance-lib.mjs';

/** One fight on auto through the QA harness (Story Block's real bus): 'won', 'lost', 'fled', 'refused' or 'stuck'. */
export function fight(words, tier, preset, seed) {
    const { h } = withHero({ seed, preset });
    const offered = h.capture({ op: '!', kind: 'encounter', name: words, text: '', labels: { tier } });
    if (!offered.ok) return 'refused';
    const offer = h.query('combat.offers').at(-1);
    if (!h.command('combat.start', { offer: offer.id }).ok) return 'refused';
    for (let n = 0; n < 400; n++) {
        const session = h.query('combat.session');
        if (session.status !== 'active') return session.status;
        h.command('combat.act', { action: { type: 'auto' } });
    }
    return 'stuck';
}

/** Win rate in % over `seeds` seeds from `first` (through the harness). */
export function winRate(words, tier, preset, { seeds = 200, first = 1000 } = {}) {
    let won = 0;
    for (let seed = first; seed < first + seeds; seed++) if (fight(words, tier, preset, seed) === 'won') won += 1;
    return Math.round(won / seeds * 1000) / 10;
}

const key = cell => `${cell.creature.set}:${cell.creature.name}`;

/** The cells' win rates over worker threads: [{ tier, level, count, preset, creature, rate }]. */
export async function runCells(list, { seeds = 200, first = 1000, workers = availableParallelism(), progress = false } = {}) {
    const plain = list.map(cell => ({ tier: cell.tier, level: cell.level, count: cell.count, preset: cell.preset, creature: key(cell), ...(cell.shift !== undefined && cell.shift !== null ? { shift: cell.shift } : {}), ...(cell.settings ? { settings: cell.settings } : {}) }));
    // Slowest first (high levels, many foes), handed out one at a time.
    const order = plain.map((cell, index) => index).sort((a, b) => (plain[b].level * plain[b].count) - (plain[a].level * plain[a].count));
    const out = new Array(plain.length);
    let next = 0;
    let done = 0;
    await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, plain.length)) }, () => new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { seeds, first } });
        const feed = () => {
            if (next >= order.length) { worker.postMessage(null); return; }
            const index = order[next++];
            worker.postMessage({ index, cell: plain[index] });
        };
        worker.on('message', ({ index, rate }) => {
            out[index] = { ...plain[index], rate };
            done += 1;
            if (progress && done % 500 === 0) console.error(`${done}/${plain.length} cells ${new Date().toISOString()}`);
            feed();
        });
        worker.on('error', reject);
        worker.on('exit', resolve);
        feed();
    })));
    return out;
}

/** The summary: per tier and level, cells on target / cells, and the whole matrix. */
export function summary(rows) {
    const table = {};
    let on = 0;
    for (const row of rows) {
        const slot = (table[row.tier] ??= {})[row.level] ??= { on: 0, all: 0 };
        slot.all += 1;
        if (onTarget(row.tier, row.rate)) { slot.on += 1; on += 1; }
    }
    return { table, on, all: rows.length, share: rows.length ? on / rows.length * 100 : 0 };
}

export function printSummary({ table, on, all, share }, log = console.log) {
    const levels = [...new Set(Object.values(table).flatMap(entry => Object.keys(entry).map(Number)))].sort((a, b) => a - b);
    log(`${'tier'.padEnd(8)} ${levels.map(level => `L${level}`.padStart(9)).join('')}`);
    for (const tier of TIERS) {
        if (!table[tier]) continue;
        log(`${tier.padEnd(8)} ${levels.map(level => {
            const slot = table[tier][level];
            return (slot ? `${Math.round(slot.on / slot.all * 100)}%` : '—').padStart(9);
        }).join('')}`);
    }
    log(`on target: ${on}/${all} cells (${share.toFixed(1)} %)`);
}

if (!isMainThread) {
    const { seeds, first } = workerData;
    const byKey = Object.fromEntries(CREATURES.map(creature => [key({ creature }), creature]));
    parentPort.on('message', message => {
        if (!message) process.exit(0);
        const { index, cell } = message;
        const rate = cellRate({ ...cell, creature: byKey[cell.creature], seeds, first });
        parentPort.postMessage({ index, rate });
    });
} else if (import.meta.url === `file://${process.argv[1]}` && process.env.REPORT) {
    // REPORT=a.jsonl,b.jsonl: the summary of rows already run (OUT files), without running anything.
    const read = files => files.split(',').flatMap(file => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
    printSummary(summary(read(process.env.REPORT)));
} else if (import.meta.url === `file://${process.argv[1]}`) {
    const list = (name, all, map = value => value) => (process.env[name] ? process.env[name].split(',').map(map) : all);
    const wanted = list('CREATURES', null);
    const chosen = cells({
        tiers: list('TIERS', TIERS),
        levels: list('LEVELS', LEVELS, Number),
        presets: list('PRESETS', PRESET_IDS),
        counts: process.env.COUNTS ? process.env.COUNTS.split(',').map(Number) : null,
        creatures: wanted ? CREATURES.filter(creature => wanted.includes(creature.name)) : CREATURES,
    });
    const seeds = Number(process.env.SEEDS ?? 200);
    const started = Date.now();
    const rows = await runCells(chosen, { seeds, first: Number(process.env.FIRST ?? 1000), workers: Number(process.env.WORKERS) || availableParallelism(), progress: true });
    if (process.env.OUT) writeFileSync(process.env.OUT, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    printSummary(summary(rows));
    console.log(`${rows.length} cells × ${seeds} seeds in ${Math.round((Date.now() - started) / 1000)} s`);
}
