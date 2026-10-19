// Open-ended builds (0.4): a companion is made from what the story says they are, not from a
// class. The reader (or the story's words) names up to three focus stats in order, and every
// point the companion has is spread over them by weight, 3, 2 and 1; with none, evenly. The
// same spreading raises a companion that levels up on their own (spendByBuild), in proportion
// to how they are built so far, so a healer who joined a healer stays one.
//
// A role's words suggest the focus ("healer" → INT, VIT, CHA), from a small table of generic
// words that know no one world; the reader can always change it. The skills a new companion
// starts with come from the library, only ones their built stats allow, and suggestSkills
// offers three that fit the focus. Pure.

import { DEFAULT_RULES, STATS, statCap } from './rules.js';
import { canLearn } from './skills.js';
import { maxLevel } from './terms.js';

// Weights of the first, second and third focus stat.
export const FOCUS_WEIGHTS = Object.freeze([3, 2, 1]);
export const MAX_FOCUS = FOCUS_WEIGHTS.length;

// Generic role words → focus stats, and the skill types such a member reaches for first.
export const ROLE_FOCUS = Object.freeze([
    { words: ['healer', 'cleric', 'priest', 'priestess', 'medic', 'physician', 'nurse', 'acolyte'], focus: ['INT', 'VIT', 'CHA'], types: ['heal', 'buff'] },
    { words: ['mage', 'wizard', 'sorcerer', 'sorceress', 'caster', 'witch', 'warlock', 'magician', 'spellcaster'], focus: ['INT', 'DEX'], types: ['magic'] },
    { words: ['warrior', 'knight', 'fighter', 'guard', 'soldier', 'swordsman', 'swordswoman', 'mercenary', 'sellsword'], focus: ['STR', 'VIT'], types: ['physical'] },
    { words: ['tank', 'defender', 'protector', 'guardian', 'bodyguard', 'sentinel'], focus: ['VIT', 'STR'], types: ['buff', 'physical'] },
    { words: ['rogue', 'thief', 'assassin', 'scout', 'spy', 'burglar'], focus: ['AGI', 'DEX', 'LUK'], types: ['physical'] },
    { words: ['archer', 'ranger', 'hunter', 'marksman', 'markswoman', 'sniper', 'bowman'], focus: ['DEX', 'AGI'], types: ['physical'] },
    { words: ['bard', 'diplomat', 'merchant', 'envoy', 'minstrel', 'trader'], focus: ['CHA', 'LUK'], types: ['buff', 'debuff'] },
    { words: ['monk', 'brawler', 'pugilist', 'boxer', 'wrestler'], focus: ['STR', 'AGI'], types: ['physical'] },
]);

const WORDS = new Map(ROLE_FOCUS.flatMap(entry => entry.words.map(word => [word, entry])));

/** The table entry the first role word in `text` names ("a wandering healer" → the healer entry), or null. */
function roleEntry(text) {
    for (const raw of String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/)) {
        if (!raw) continue;
        const found = WORDS.get(raw) ?? (raw.endsWith('s') ? WORDS.get(raw.slice(0, -1)) : null) ?? (raw.endsWith('es') ? WORDS.get(raw.slice(0, -2)) : null);
        if (found) return found;
    }
    return null;
}

/** Focus stats a role's words suggest, in order (`[]` when no word is known). */
export function focusFromRole(text) {
    return [...(roleEntry(text)?.focus ?? [])];
}

/**
 * The focus for someone the story describes: the role's words first, then the longer
 * description's (an NPC's summary), `[]` when neither names a known role.
 */
export function guessFocus(role, summary = '') {
    const fromRole = focusFromRole(role);
    return fromRole.length ? fromRole : focusFromRole(summary);
}

/** Up to three distinct known stats, in order; anything else dropped. */
export function cleanFocus(focus) {
    const out = [];
    for (const stat of Array.isArray(focus) ? focus : []) {
        const name = String(stat ?? '').toUpperCase();
        if (STATS.includes(name) && !out.includes(name)) out.push(name);
        if (out.length >= MAX_FOCUS) break;
    }
    return out;
}

/**
 * `total` points spread over the stats by weight ({ STR: 3, … }; nothing weighted → evenly),
 * largest remainder so the shares add up exactly; ties go to the heavier weight, then the
 * stat order. { STR: n, … } for every stat.
 */
export function spreadByWeights(total, weights = {}) {
    const points = Math.max(0, Math.round(Number(total) || 0));
    const raw = STATS.map(stat => Math.max(0, Number(weights?.[stat]) || 0));
    const used = raw.some(Boolean) ? raw : raw.map(() => 1);
    const sum = used.reduce((a, b) => a + b, 0);
    const shares = STATS.map((stat, index) => {
        const exact = (points * used[index]) / sum;
        return { stat, index, weight: used[index], whole: Math.floor(exact), rest: exact - Math.floor(exact) };
    });
    let left = points - shares.reduce((a, entry) => a + entry.whole, 0);
    for (const entry of [...shares].sort((a, b) => b.rest - a.rest || b.weight - a.weight || a.index - b.index)) {
        if (left <= 0) break;
        if (!entry.weight) continue;
        entry.whole += 1;
        left -= 1;
    }
    return Object.fromEntries(shares.map(entry => [entry.stat, entry.whole]));
}

/**
 * (0.5.14) Like spreadByWeights, with `room` the most each stat may take ({ STR: n, … };
 * missing: no limit): a stat that is full passes its share to the others by their weights
 * (evenly when none of those left has one); points nobody has room for stay unspent.
 */
export function spreadWithin(total, weights = {}, room = {}) {
    const out = Object.fromEntries(STATS.map(stat => [stat, 0]));
    const space = stat => (Number.isFinite(Number(room?.[stat])) ? Math.max(0, Number(room[stat])) : Infinity) - out[stat];
    let left = Math.max(0, Math.round(Number(total) || 0));
    for (let guard = 0; left > 0 && guard < STATS.length + 1; guard++) {
        const open = STATS.filter(stat => space(stat) > 0);
        if (!open.length) break;
        const own = Object.fromEntries(open.map(stat => [stat, Math.max(0, Number(weights?.[stat]) || 0)]));
        const spread = spreadByWeights(left, Object.values(own).some(Boolean) ? own : Object.fromEntries(open.map(stat => [stat, 1])));
        for (const stat of STATS) {
            const take = Math.min(spread[stat] ?? 0, space(stat));
            out[stat] += take;
            left -= take;
        }
    }
    return out;
}

/** (0.5.14) Stats with what lies past the stat cap moved to the stats still below it, by `weights`. */
export function withinCap(stats, weights = {}, rules = DEFAULT_RULES) {
    const cap = statCap(rules);
    const excess = STATS.reduce((sum, stat) => sum + Math.max(0, (Number(stats[stat]) || 0) - cap), 0);
    if (!excess) return stats;
    const capped = Object.fromEntries(STATS.map(stat => [stat, Math.min(Number(stats[stat]) || 0, cap)]));
    const more = spreadWithin(excess, weights, Object.fromEntries(STATS.map(stat => [stat, cap - capped[stat]])));
    return Object.fromEntries(STATS.map(stat => [stat, capped[stat] + more[stat]]));
}

/** The focus as weights: first ×3, second ×2, third ×1 ({} with no focus: an even spread). */
export function focusWeights(focus) {
    return Object.fromEntries(cleanFocus(focus).map((stat, index) => [stat, FOCUS_WEIGHTS[index]]));
}

/**
 * The stats a companion built on `focus` has at `level`: every stat at the start value, the
 * starting points spread by the focus weights, then the points of every level after the first
 * spread the same way (largest remainder each time, as a new companion has always been raised).
 */
export function buildStats(focus, level = 1, rules = DEFAULT_RULES) {
    const c = rules.character;
    const lv = Math.max(1, Math.min(maxLevel(rules), Math.round(Number(level) || 1)));
    const weights = focusWeights(focus);
    const start = spreadByWeights(c.startPoints, weights);
    const extra = spreadByWeights((lv - 1) * c.pointsPerLevel, weights);
    return withinCap(Object.fromEntries(STATS.map(stat => [stat, c.startStat + start[stat] + extra[stat]])), weights, rules);
}

/**
 * A sheet's unspent points spent in proportion to its build: each stat's points above the
 * start value is its weight (a sheet still at the start spreads evenly), largest remainder.
 * Returns the allocation ({ STR: n, … }, only stats that get something) for spendPoints.
 */
export function buildAllocation(sheet, rules = DEFAULT_RULES) {
    const start = rules.character.startStat;
    const weights = Object.fromEntries(STATS.map(stat => [stat, Math.max(0, (Number(sheet?.stats?.[stat]) || 0) - start)]));
    // (0.5.14) Never past the stat cap: a full stat's share goes to the others.
    const cap = statCap(rules);
    const room = Object.fromEntries(STATS.map(stat => [stat, cap - (Number(sheet?.stats?.[stat]) || 0)]));
    const spread = spreadWithin(Math.max(0, Math.round(Number(sheet?.points) || 0)), weights, room);
    return Object.fromEntries(Object.entries(spread).filter(([, value]) => value > 0));
}

/**
 * Three skills (or `count`) from the library for a companion with these stats and focus: only
 * ones the stats allow, the types the role reaches for first, then skills of the first focus
 * stat, the second…, a higher tier before a lower one, and no more than two of a type, so the
 * suggestion is a working kit rather than three ways to do one thing. Names, in that order.
 */
export function suggestSkills(stats, focus, library, { role = '', count = 3 } = {}) {
    const order = cleanFocus(focus);
    const types = roleEntry(role)?.types ?? [];
    const ranked = (library ?? [])
        .map((skill, index) => ({ skill, index }))
        .filter(({ skill }) => skill?.name && canLearn(stats, skill).ok)
        .sort((a, b) => {
            const typeRank = entry => (types.includes(entry.skill.type) ? types.indexOf(entry.skill.type) : types.length);
            const statRank = entry => (order.includes(entry.skill.stat) ? order.indexOf(entry.skill.stat) : order.length);
            return typeRank(a) - typeRank(b) || statRank(a) - statRank(b) || (Number(b.skill.tier) || 1) - (Number(a.skill.tier) || 1) || a.index - b.index;
        });
    const picked = [];
    const perType = {};
    for (const { skill } of ranked) {
        if (picked.length >= count) break;
        if ((perType[skill.type] ?? 0) >= 2) continue;
        perType[skill.type] = (perType[skill.type] ?? 0) + 1;
        picked.push(skill.name);
    }
    for (const { skill } of ranked) {
        if (picked.length >= count) break;
        if (!picked.includes(skill.name)) picked.push(skill.name);
    }
    return picked;
}

/** Why a skill cannot be taken with these stats ("needs INT 9 (has 7)"), or '' when it can. */
export function lockedReason(stats, skill) {
    const { ok, missing } = canLearn(stats, skill);
    if (ok) return '';
    return `needs ${Object.keys(missing).map(stat => `${stat} ${skill.requires[stat]} (has ${Number(stats?.[stat]) || 0})`).join(', ')}`;
}
