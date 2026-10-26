// A danger word is a proposal. Resolve it once, during capture, against the party that heard it.
// Replay applies the offer's recorded opposition; combat.start never calibrates an old offer.
import { startFight, actInPlace, prepareAuto } from '../../combat.js';
import { hashSeed } from '../../rng.js';
import { leanAuto } from './lean.js';
import { buildSetup, partyCombatants, scaleFoe } from '../combat/setup.js';
import { fightRules, packSetup } from '../combat/stored.js';
import { areaPolicyNow } from '../rules/items.js';
import { pinnedSetup } from './index.js';

export const DANGER_TARGETS = Object.freeze({ trivial: 0.995, weak: 0.97, even: 0.625, strong: 0.35, deadly: 0.1 });
// Fixed private samples, disjoint from the regression's seeds. No receipt draws, wall clock or
// installed content enters the search. At most 22 × 256 fights, each with the engine's turn cap, played by the lean player
// (lean.js: the engine's own Auto, fight for fight) and, for what it does not take, by the engine's prepared trials.
const SAMPLES = 256;
const STEPS = 12;
const sampleSeed = n => `pinned-danger:sample:${n}`;
// What the generator starts from for each sample: the fight's opening, and Auto's own draws (the action's id, as combat.act gives it).
const OPENING = Uint32Array.from({ length: SAMPLES }, (_, n) => hashSeed(sampleSeed(n)));
const AUTO = Uint32Array.from({ length: SAMPLES }, (_, n) => hashSeed(`${sampleSeed(n)}|ca_00000001`));

/** Legacy's below-level-one / normalizedFoe rule: scale HP and attack, never the pack's seven
 * stats, skills, elements or loot. The source has already passed foeToEngine's area/stat budget.
 */
export function scaled(setup, factor) {
    const foe = enemy => enemy.pack ? scaleFoe(enemy, factor) : enemy;
    return { ...setup, enemies: setup.enemies.map(foe), waves: (setup.waves ?? []).map(wave => ({ ...wave, enemies: wave.enemies.map(foe) })) };
}

// Once attack is in range, HP gives finer steps than integer damage thresholds. Distribute
// rounding across the foes in a stable order, so six identical foes do not all gain a hit at once.
export function scaledHp(setup, factor) {
    const count = setup.enemies.length + (setup.waves ?? []).reduce((n, wave) => n + wave.enemies.length, 0);
    let ordinal = 0;
    const foe = enemy => {
        const fraction = (++ordinal - 0.5) / count;
        if (!enemy.pack) return enemy;
        const hp = Math.max(1, Math.floor(enemy.hp.max * factor + fraction));
        return { ...enemy, hp: { cur: hp, max: hp } };
    };
    return { ...setup, enemies: setup.enemies.map(foe), waves: (setup.waves ?? []).map(wave => ({ ...wave, enemies: wave.enemies.map(foe) })) };
}

/** The same Auto path used by combat.act, including pinned forms, opening turns and waves. */
export function autoOutcome(setup, seed, actionId = 'ca_00000001') {
    const rules = fightRules(setup);
    try {
        const fight = startFight({ ...setup, seed, rules });
        if (fight.status === 'active') actInPlace(fight, { type: 'auto', id: actionId }, rules);
        return fight.status;
    } catch (error) {
        if (error.message === 'Fight did not settle.') return 'unsettled';
        throw error;
    }
}

/**
 * What a new offer is calibrated from: { setup, target, area } with the pack foes at the relative
 * danger legacy gave each row, or null when the offer keeps its old rules (death stakes, explicit
 * ranks, no standing party, no pack foe).
 */
export function calibrationCase(ctx, offer, { numbers, chatBestiary }) {
    if (offer.stakes === 'death' || offer.foes.some(row => row.rank || !(row.tier in DANGER_TARGETS))) return null;
    const party = partyCombatants(ctx, { rules: fightRules(numbers) });
    if (!party.some(c => c.hp.cur > 0)) return null;
    const built = buildSetup({ id: 'fi_00000001', seed: 'pinned-danger:offer', offer, party, chatBestiary, numbers });
    const area = offer.area ?? areaPolicyNow((name, args) => ctx.query(name, args));
    const setup = pinnedSetup(ctx, built.setup, { ...offer, area });
    const enemies = [...setup.enemies, ...(setup.waves ?? []).flatMap(wave => wave.enemies)];
    // Unknown or disallowed pack foes retain the adapter's fallback, as before.
    if (!enemies.some(enemy => enemy.pack)) return null;
    // Keep the relative danger legacy assigned to each row before the pack adapter supplied
    // its identity. A common multiplier then accounts for this party's actual forms and pools.
    const projected = new Map([...built.setup.enemies, ...(built.setup.waves ?? []).flatMap(wave => wave.enemies)].map(enemy => [enemy.id, enemy]));
    const base = enemy => {
        const legacy = projected.get(enemy.id);
        return enemy.pack && legacy ? scaleFoe(enemy, Math.sqrt(legacy.hp.max * legacy.patk / (enemy.hp.max * enemy.patk))) : enemy;
    };
    setup.enemies = setup.enemies.map(base);
    setup.waves = (setup.waves ?? []).map(wave => ({ ...wave, enemies: wave.enemies.map(base) }));
    // As in legacy, each tier first gets its own headcount budget. A mixed encounter aims at its
    // most dangerous row; fodder never downgrades the danger of the stronger foe.
    const target = Math.min(...offer.foes.map(row => DANGER_TARGETS[row.tier]));
    return { setup, target, area };
}

/** Mutate a newly captured offer only. Explicit ranks and death stakes retain their old rules. */
export function resolveOpposition(ctx, offer, options) {
    const found = calibrationCase(ctx, offer, options);
    if (!found) return;
    const { setup, target, area } = found;
    const { id: _id, seed: _seed, party: _party, ...stored } = packSetup(calibrate(setup, target));
    offer.area = area;
    offer.opposition = stored;
}

/** The candidate whose win rate over the fixed samples is nearest `target`: a bisection of the whole encounter's multiplier, then of the foes' HP alone. */
export function calibrate(setup, target) {
    let best = null;
    const measured = new Map();
    const rules = fightRules(setup);
    const search = (make, low, high, steps) => {
        for (let step = 0; step < steps; step += 1) {
            const middle = (low + high) / 2;
            const candidate = make(2 ** middle);
            const key = JSON.stringify([...candidate.enemies, ...candidate.waves.flatMap(wave => wave.enemies)].map(enemy => [enemy.hp.max, enemy.patk, enemy.matk]));
            if (!measured.has(key)) measured.set(key, winRate(candidate, rules, target, best ? best.distance : Infinity));
            const rate = measured.get(key);
            const distance = Math.abs(rate - target);
            if (!best || distance < best.distance) best = { candidate, distance, rate };
            if (best.distance <= 0.5 / SAMPLES) break;
            if (rate > target) low = middle; else high = middle;
        }
    };
    search(factor => scaled(setup, factor), -7, 7, STEPS);
    const coarse = best.candidate;
    if (best.distance > 0.5 / SAMPLES) search(factor => scaledHp(coarse, factor), -2, 2, 10);
    return best.candidate;
}

/**
 * Wins in the fixed samples, over their number; a fight that never settles is no win. The count stops as soon as it cannot change what
 * the search does with it: once it is certain which side of `target` the rate is on, and certain to be no nearer than `limit`, the
 * rate returned is the nearest the remaining samples could leave it, which says the same.
 */
function winRate(candidate, rules, target, limit) {
    const quick = leanAuto(candidate, rules);
    let engine = null;
    let wins = 0;
    for (let seed = 0; seed < SAMPLES; seed += 1) {
        let won = quick ? quick(OPENING[seed], AUTO[seed]) : -1;
        if (won < 0) {
            // A setup or a turn the lean player does not play is played by the engine.
            engine ??= prepareAuto(candidate, rules);
            won = 0;
            try {
                if (engine(sampleSeed(seed)).status === 'victory') won = 1;
            } catch (error) {
                if (error.message !== 'Fight did not settle.') throw error;
            }
        }
        wins += won;
        const low = wins / SAMPLES, high = (wins + SAMPLES - 1 - seed) / SAMPLES;
        if (low > target && low - target >= limit) return low;
        if (high <= target && target - high >= limit) return high;
    }
    return wins / SAMPLES;
}
