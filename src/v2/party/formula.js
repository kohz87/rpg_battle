// A new companion's level and stats by formula (MODULES §F91): code's numbers, never the model's.
// Pure.
//
// * **Level.** When the story (or the caller) gives one, it is used, held to 1 … your
//   character's level + COMPANION_LEVELS_ABOVE (B-b3-16) and the level cap. Without one, the
//   companion comes within one level of your character: your character's level − 1, the same or
//   + 1, picked by the receipt's dice (so a replay never picks again), never below 1.
// * **Stats.** Every stat starts at the start value (5); a companion of level L has, in all, the
//   stat points your character's rule gives a character of level L (rx-combat: tier and level
//   decide strength, so a companion of your level is never stronger than you): the start values,
//   the creation points, and the points of every level after the first (7 × 5 + 10 + 4 × (L − 1)
//   with the defaults). What is over the start values is spread by weights, largest remainder,
//   held to the stat cap (v1 spreadByWeights / withinCap):
//   1. a preset's points when the join names one (`preset: archer`, or a role that is a preset's
//      id or name: Fighter, Skirmisher, Caster, Healer, Archer, or a pack preset given by the caller);
//   2. else the focus (written `focus:` stats, else the stats the role's words mean) as v1's
//      weights 3, 2, 1 (so a companion without a preset is v1's newCompanion build);
//   3. else an even spread.
//   Stats, HP, MP and SP are worked out here and by v1's rules; a number the story writes for
//   them is never read.

import { STATS } from '../../rules.js';
import { PRESETS } from '../../skills.js';
import { cleanFocus, focusWeights, spreadByWeights, withinCap } from '../../builds.js';
import { maxLevel } from '../../terms.js';

// How far above your character's level a companion may join when a level is given.
export const COMPANION_LEVELS_ABOVE = 2;

/** The stat points a character of `level` has in all by `rules` (your character's rule): start values + creation points + points per level after the first. */
export function companionTotal(level, rules) {
    const c = rules.character;
    return c.startStat * STATS.length + c.startPoints + c.pointsPerLevel * (Math.max(1, Math.round(Number(level) || 1)) - 1);
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
    return focusWeights(clean);
}

/** The stats of a new companion at `level` by the formula: { STR: n, … }. */
export function companionStats({ level = 1, weights = {}, rules }) {
    const start = rules.character.startStat;
    const lv = Math.max(1, Math.min(maxLevel(rules), Math.round(Number(level) || 1)));
    const spare = Math.max(0, companionTotal(lv, rules) - start * STATS.length);
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
