// A new companion's level and stats by formula (MODULES §F91): code's numbers, never the model's.
// Pure.
//
// * **Level.** When the story (or the caller) gives one, it is used, held to 1 … your
//   character's level + COMPANION_LEVELS_ABOVE (B-b3-16) and the level cap. Without one, the
//   companion comes within one level of your character: your character's level − 1, the same or
//   + 1, picked by the receipt's dice (so a replay never picks again), never below 1.
// * **Stats.** Every stat starts at the start value (5); a companion of level L has, in all,
//   `base + perLevel × L` stat points (the Character settings `companionBase`, 55, and
//   `companionPerLevel`, 5), and what is over the start values is spread by weights, largest
//   remainder, held to the stat cap (v1 spreadByWeights / withinCap):
//   1. a preset's points when the join names one (`preset: archer`, or a role that is a preset's
//      id or name: Fighter, Skirmisher, Caster, Healer, Archer, or a pack preset given by the caller);
//   2. else the focus (written `focus:` stats, else the stats the role's words mean) as weights
//      4, 3, 2 and every other stat 1, so the build leans without leaving a stat at the start
//      value (a companion with base VIT falls over by level 10);
//   3. else an even spread.
//   Stats, HP, MP and SP are worked out here and by v1's rules; a number the story writes for
//   them is never read.

import { STATS } from '../../rules.js';
import { PRESETS } from '../../skills.js';
import { cleanFocus, focusWeights, spreadByWeights, withinCap } from '../../builds.js';
import { maxLevel } from '../../terms.js';

export const COMPANION_FORMULA = Object.freeze({ base: 55, perLevel: 5 });
// How far above your character's level a companion may join when a level is given.
export const COMPANION_LEVELS_ABOVE = 2;

const whole = (value, fallback, min, max) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** The formula's numbers from the Character settings: { base, perLevel }. */
export function formulaOf(settings) {
    return {
        base: whole(settings?.companionBase, COMPANION_FORMULA.base, 0, 500),
        perLevel: whole(settings?.companionPerLevel, COMPANION_FORMULA.perLevel, 0, 50),
    };
}

/** The stat points a companion of `level` has in all: base + perLevel × level. */
export function companionTotal(level, settings = null) {
    const { base, perLevel } = formulaOf(settings);
    return base + perLevel * Math.max(1, Math.round(Number(level) || 1));
}

const key = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The preset a join means, or null: `preset` (an id or name of v1's PRESETS, or a record with
 * `points` a caller found in a pack), else a role that is a preset's id or name.
 */
export function presetFor({ preset = null, role = '' } = {}) {
    if (preset && typeof preset === 'object' && preset.points && typeof preset.points === 'object') return preset;
    for (const word of [preset, role]) {
        const want = key(word);
        if (!want) continue;
        const found = PRESETS.find(entry => key(entry.id) === want || key(entry.name) === want);
        if (found) return found;
    }
    return null;
}

/** The weights the points are spread by (see above): { STR: w, … }; {} means an even spread. */
export function companionWeights({ preset = null, role = '', focus = [] } = {}) {
    const chosen = presetFor({ preset, role });
    if (chosen) {
        const out = Object.fromEntries(STATS.map(stat => [stat, Math.max(0, Number(chosen.points?.[stat]) || 0)]).filter(([, w]) => w > 0));
        if (Object.keys(out).length) return out;
    }
    const clean = cleanFocus(focus);
    if (!clean.length) return {};
    const lean = focusWeights(clean);
    return Object.fromEntries(STATS.map(stat => [stat, 1 + (lean[stat] ?? 0)]));
}

/** The stats of a new companion at `level` by the formula: { STR: n, … }. */
export function companionStats({ level = 1, weights = {}, rules, settings = null }) {
    const start = rules.character.startStat;
    const lv = Math.max(1, Math.min(maxLevel(rules), Math.round(Number(level) || 1)));
    const spare = Math.max(0, companionTotal(lv, settings) - start * STATS.length);
    const spread = spreadByWeights(spare, weights);
    return withinCap(Object.fromEntries(STATS.map(stat => [stat, start + (spread[stat] ?? 0)])), weights, rules);
}

/**
 * A new companion's level (see above). `asked` is the level the story or the caller gave (null
 * for none), `pcLevel` your character's, `rng` the receipt's dice.
 */
export function joinLevel({ asked = null, pcLevel = 1, rules, rng = () => 0.5 }) {
    const pc = Math.max(1, Math.round(Number(pcLevel) || 1));
    const cap = maxLevel(rules);
    if (Number.isInteger(asked) && asked >= 1) return Math.max(1, Math.min(cap, pc + COMPANION_LEVELS_ABOVE, asked));
    const step = Math.min(2, Math.floor(rng() * 3)) - 1;
    return Math.max(1, Math.min(cap, pc + step));
}
