// RPG Battle v2, stat shifts in a fight (B4: "New stat-shift effects refresh identical source/effect/target, distinct sources add with
// effective stats at least 1; base stats and gear requirements stay unchanged"). A shift is a closed condition record on the
// combatant: { name: 'stat-shift', stat, amount, rounds, power: 0, key }, `key` = "<actor>|<form>|<effect index>" (the source and the
// effect; the target is the combatant that holds it). The combatant's effective stats and the numbers the engine derived from them at
// setup (attack, magic, defence, magic defence, crit) are always worked out again from the baseline taken when the first shift landed:
// base + the sum of the shifts it holds, no stat below 1. Nothing here touches the sheet, the gear or what the fight writes back. Pure.

import { DEFAULT_RULES } from '../../rules.js';

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** The fight's own numbers of a combatant as they stand, taken once before any shift: stats and derived numbers. */
function baselineOf(c) {
    return { stats: { ...c.stats }, patk: c.patk, matk: c.matk, pdef: c.pdef, mdef: c.mdef, crit: c.crit };
}

/**
 * Sets a combatant's stats and derived numbers from its baseline and the stat-shift conditions it holds. A combatant that never held
 * one is left exactly as it is (no baseline is taken). `rules`: the derived-number table (v1's defaults when not given).
 */
export function syncShifts(c, rules = DEFAULT_RULES) {
    if (!c.conditions.length && !c.baseline) return;
    const shifts = c.conditions.filter(cond => cond.name === 'stat-shift');
    if (!c.baseline) {
        if (!shifts.length) return;
        c.baseline = baselineOf(c);
    }
    const base = c.baseline.stats;
    const stats = { ...base };
    const touched = new Set();
    for (const cond of shifts) {
        stats[cond.stat] = (stats[cond.stat] ?? 0) + cond.amount;
        touched.add(cond.stat);
    }
    for (const name of touched) stats[name] = Math.max(1, stats[name]);
    const d = rules.derived;
    const a = rules.attack;
    const delta = name => stats[name] - base[name];
    c.stats = stats;
    c.patk = Math.max(0, Math.round(c.baseline.patk + delta('STR') * d.atkPerStr));
    c.matk = Math.max(0, Math.round(c.baseline.matk + delta('INT') * d.matkPerInt));
    c.pdef = Math.max(0, Math.round(c.baseline.pdef + delta('VIT')));
    c.mdef = Math.max(0, Math.round(c.baseline.mdef + (delta('INT') + delta('VIT')) / 2));
    c.crit = clamp(c.baseline.crit + delta('DEX') * a.critPerDex + delta('LUK') * a.critPerLuk, 0, a.critMax);
    if (!shifts.length) delete c.baseline;
}

/** Adds a shift (or refreshes the identical one: same key and stat) and works the numbers out again. */
export function addShift(c, { key, stat, amount, rounds }) {
    const same = c.conditions.find(cond => cond.name === 'stat-shift' && cond.key === key);
    if (same) {
        same.rounds = rounds;
        same.amount = amount;
        same.stat = stat;
    } else {
        c.conditions.push({ name: 'stat-shift', rounds, power: 0, stat, amount, key });
    }
    syncShifts(c);
}
