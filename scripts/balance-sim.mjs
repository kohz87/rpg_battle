// Balance simulation (B-b4-11): how often a fresh level-1 character of every creation preset, on
// auto, beats an offer of each tier, alone and in groups, through v2's real encounter → offer →
// combat.start path (the QA harness on Story Block's real bus). Slow: run by hand.
//
//   node scripts/balance-sim.mjs                 # 200 seeds from 1000, every preset
//   SEEDS=40 FIRST=1 PRESETS=caster node scripts/balance-sim.mjs
//   JSON=1 node scripts/balance-sim.mjs          # one JSON row per case
//
// The targets (a tier means the same whatever the headcount): trivial ≥ 98% won, weak ≥ 90%,
// even 50–75%, strong 20–50%, deadly < 20%.
import { withHero } from '../tests/v2/qa/helpers/harness.js';
import { PRESETS } from '../src/skills.js';

export const TARGETS = Object.freeze({ trivial: [98, 100], weak: [90, 100], even: [50, 75], strong: [20, 50], deadly: [0, 19.99] });
export const TIERS = Object.freeze(['trivial', 'weak', 'even', 'strong', 'deadly']);
export const FOES = Object.freeze(['Wolf', 'Giant Rat', 'Bandit', 'Goblin', 'Cellar Rat Swarm', 'Marsh Ghoul']);
export const COUNTS = Object.freeze([1, 2, 3, 4, 6, 9]);

/** One fight on auto: 'won', 'lost', 'fled', 'refused' or 'stuck'. */
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

/** Win rate in % over `seeds` seeds from `first`. */
export function winRate(words, tier, preset, { seeds = 200, first = 1000 } = {}) {
    let won = 0;
    for (let seed = first; seed < first + seeds; seed++) if (fight(words, tier, preset, seed) === 'won') won += 1;
    return Math.round(won / seeds * 1000) / 10;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const seeds = Number(process.env.SEEDS ?? 200);
    const first = Number(process.env.FIRST ?? 1000);
    const presets = (process.env.PRESETS ?? PRESETS.map(entry => entry.id).join(',')).split(',');
    const tiers = (process.env.TIERS ?? TIERS.join(',')).split(',');
    const foes = (process.env.FOES ?? FOES.join(',')).split(',');
    const counts = (process.env.COUNTS ?? COUNTS.join(',')).split(',').map(Number);
    const misses = [];
    for (const tier of tiers) {
        const [lo, hi] = TARGETS[tier];
        for (const foe of foes) {
            for (const count of counts) {
                const words = `${count} ${foe}`;
                const rates = Object.fromEntries(presets.map(preset => [preset, winRate(words, tier, preset, { seeds, first })]));
                const off = Object.entries(rates).filter(([, rate]) => rate < lo || rate > hi).map(([preset]) => preset);
                if (off.length) misses.push(`${tier} ${words}: ${off.join(', ')}`);
                if (process.env.JSON) console.log(JSON.stringify({ tier, words, seeds, ...rates }));
                else console.log(`${tier.padEnd(8)} ${words.padEnd(20)} ${presets.map(preset => `${preset} ${String(rates[preset]).padStart(5)}`).join('  ')}${off.length ? '   ✗' : ''}`);
            }
        }
    }
    console.log(misses.length ? `\nOff target (${misses.length}):\n${misses.join('\n')}` : '\nEvery case is on target.');
}
