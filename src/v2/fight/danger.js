// A danger word is a proposal. Resolve it once, during capture, against the party that heard it.
// Replay applies the offer's recorded opposition; combat.start never calibrates an old offer.
import { makeRngCache } from '../../rng.js';
import { startFight, actInPlace, prepareAuto } from '../../combat.js';
import { buildSetup, partyCombatants, scaleFoe } from '../combat/setup.js';
import { fightRules, packSetup } from '../combat/stored.js';
import { areaPolicyNow } from '../rules/items.js';
import { pinnedSetup } from './index.js';

export const DANGER_TARGETS = Object.freeze({ trivial: 0.995, weak: 0.97, even: 0.625, strong: 0.35, deadly: 0.1 });
// Fixed private samples, disjoint from the regression's seeds. No receipt draws, wall clock or
// installed content enters the search. At most 22 × 256 engine runs, each with the engine's turn cap.
const SAMPLES = 256;
const STEPS = 12;

/** Legacy's below-level-one / normalizedFoe rule: scale HP and attack, never the pack's seven
 * stats, skills, elements or loot. The source has already passed foeToEngine's area/stat budget.
 */
function scaled(setup, factor) {
    const foe = enemy => enemy.pack ? scaleFoe(enemy, factor) : enemy;
    return { ...setup, enemies: setup.enemies.map(foe), waves: (setup.waves ?? []).map(wave => ({ ...wave, enemies: wave.enemies.map(foe) })) };
}

// Once attack is in range, HP gives finer steps than integer damage thresholds. Distribute
// rounding across the foes in a stable order, so six identical foes do not all gain a hit at once.
function scaledHp(setup, factor) {
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

/** Mutate a newly captured offer only. Explicit ranks and death stakes retain their old rules. */
export function resolveOpposition(ctx, offer, { numbers, chatBestiary }) {
    if (offer.stakes === 'death' || offer.foes.some(row => row.rank || !(row.tier in DANGER_TARGETS))) return;
    const party = partyCombatants(ctx, { rules: fightRules(numbers) });
    if (!party.some(c => c.hp.cur > 0)) return;
    const built = buildSetup({ id: 'fi_00000001', seed: 'pinned-danger:offer', offer, party, chatBestiary, numbers });
    const area = offer.area ?? areaPolicyNow((name, args) => ctx.query(name, args));
    const setup = pinnedSetup(ctx, built.setup, { ...offer, area });
    const enemies = [...setup.enemies, ...(setup.waves ?? []).flatMap(wave => wave.enemies)];
    // Unknown or disallowed pack foes retain the adapter's fallback, as before.
    if (!enemies.some(enemy => enemy.pack)) return;
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
    const healing = setup.party.some(c => (c.items ?? []).some(i => i.effect?.heal)
        || (c.skills ?? []).some(s => s.type === 'heal' || s.effect?.regen || s.parts?.some(p => p.op === 'heal')));
    let best = null;
    const measured = new Map();
    const rng = makeRngCache();
    const measure = (candidate, samples, bound = null) => {
        const foes = [...candidate.enemies, ...candidate.waves.flatMap(wave => wave.enemies)];
        const key = JSON.stringify(foes.map(enemy => [enemy.hp.max, enemy.patk, enemy.matk]));
        if (!measured.has(key)) measured.set(key, { candidate, wins: 0, count: 0, margins: [],
            hpById: new Map(foes.map(c => [c.id, c.hp.cur])), totalHp: foes.reduce((n, c) => n + c.hp.cur, 0),
            partyHp: candidate.party.reduce((n, c) => n + c.hp.cur, 0), trial: prepareAuto(candidate, fightRules(candidate), { rng }) });
        const sample = measured.get(key);
        while (sample.count < samples) {
            const seed = sample.count++;
            try {
                const fight = sample.trial(`pinned-danger:sample:${seed}`);
                const won = fight.status === 'victory';
                if (won) sample.wins++;
                let left = sample.totalHp, fled = 0, partyLeft = 0;
                for (const c of fight.combatants) {
                    if (c.side === 'enemy') {
                        const initial = sample.hpById.get(c.id);
                        if (initial !== undefined) left -= initial - c.hp.cur;
                        if (c.gone === 'fled') fled += c.hp.cur;
                    } else if (!c.summoned) partyLeft += c.hp.cur;
                }
                left -= fled;
                sample.margins.push(won ? Math.max(1, sample.partyHp / Math.max(1, sample.partyHp - partyLeft))
                    : Math.max(0.01, Math.min(0.999, 1 - left / Math.max(1, sample.totalHp - fled))));
            } catch (error) {
                if (error.message !== 'Fight did not settle.') throw error;
                sample.margins.push(0.5);
            }
            if (bound && sample.count >= 16 && sample.count % 16 === 0 && sample.count < samples) {
                const rate = sample.wins / sample.count;
                const center = (rate + 4 / (2 * sample.count)) / (1 + 4 / sample.count);
                const radius = 2 * Math.sqrt(rate * (1 - rate) / sample.count + 1 / sample.count ** 2) / (1 + 4 / sample.count);
                if (center - radius > target + bound.distance) return { candidate, rate, distance: Infinity };
                if (center + radius < target - bound.distance) return { candidate, rate, distance: Infinity };
            }
        }
        const rate = sample.wins / sample.count;
        const margins = [...sample.margins].sort((a, b) => a - b);
        return { candidate: sample.candidate, rate, distance: Math.abs(rate - target), hpGuess: margins[Math.min(margins.length - 1, Math.floor((1 - target) * margins.length))] };
    };
    const search = (make, low, high, steps, samples, tolerance) => {
        let lower = null, upper = null;
        const attacks = candidate => JSON.stringify([...candidate.enemies, ...candidate.waves.flatMap(w => w.enemies)].map(c => [c.patk, c.matk]));
        for (let step = 0; step < steps; step++) {
            const middle = (low + high) / 2;
            const result = measure(make(2 ** middle), samples, best);
            if (!best || result.distance < best.distance) best = result;
            if (best.distance <= tolerance) break;
            if (result.rate > target) { low = middle; lower = result.candidate; }
            else { high = middle; upper = result.candidate; }
            // Once the bracket and the incumbent all have the same integer attacks,
            // the remaining work belongs to the finer HP-only search.
            if (lower && upper && attacks(lower) === attacks(upper) && attacks(best.candidate) === attacks(lower)) break;
        }
    };
    const coarseSamples = target >= 0.97 ? 64 : 96;
    search(factor => scaled(setup, factor), -7, 7, 12, coarseSamples, 0.5 / coarseSamples);
    if (target < 0.97) {
        const groups = new Map();
        for (const sample of measured.values()) if (sample.count >= coarseSamples) {
            const key = JSON.stringify([...sample.candidate.enemies, ...sample.candidate.waves.flatMap(w => w.enemies)].map(c => [c.patk, c.matk]));
            const distance = Math.abs(sample.wins / sample.count - target);
            if (!groups.has(key) || distance < groups.get(key).distance) groups.set(key, { sample, distance });
        }
        best = null;
        for (const { sample } of [...groups.values()].sort((a, b) => a.distance - b.distance).slice(0, 2)) {
            const result = measure(sample.candidate, SAMPLES, best);
            if (!best || result.distance < best.distance) best = result;
            if (best.distance <= 0.01) break;
        }
    }
    const coarse = best.candidate;
    const fineSamples = target >= 0.97 ? 192 : SAMPLES;
    best = measure(coarse, fineSamples);
    const tolerance = target >= 0.97 ? 0.004 : 0.01;
    let point = 0, rate = best.rate, stride = 0.0625;
    let low = rate > target ? { point, rate } : null;
    let high = rate <= target ? { point, rate } : null;
    for (let step = 0; step < (target >= 0.97 ? 5 : 4) && best.distance > tolerance; step++) {
        if (step === 0) {
            const guess = Math.log2(best.hpGuess);
            if (target >= 0.97) point = guess > 0 ? Math.max(0.125, 2 * guess) : 0.5 * guess;
            else point = healing ? (rate - target) / (2 * target) : guess;
            point = Math.max(-2, Math.min(2, point));
            if (Math.abs(point) < 0.001) point = rate > target ? stride : -stride;
        } else if (low && high) {
            const fraction = Math.max(0.1, Math.min(0.9, (low.rate - target) / (low.rate - high.rate)));
            point = low.point + (high.point - low.point) * fraction;
        } else {
            point = Math.max(-2, Math.min(2, point + (rate > target ? stride : -stride)));
            stride *= 2;
        }
        const result = measure(scaledHp(coarse, 2 ** point), fineSamples, best);
        if (result.distance < best.distance) best = result;
        rate = result.rate;
        if (rate > target) low = { point, rate }; else high = { point, rate };
    }
    const { id: _id, seed: _seed, party: _party, ...stored } = packSetup(best.candidate);
    offer.area = area;
    offer.opposition = stored;
}
