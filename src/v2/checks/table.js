// The ready-made check table (the user's decision after the beta.1 live test): the default way checks are
// handed to the narrator. Before each reply (and each swipe or regenerate) code rolls two d20s per party
// member, seeded with that reply's prepare (commands.js `checks.prepare`), and works the results out in
// advance with code's modifiers (modifiers.js) for every stat and for each skill topic the member has an
// extra for, plus a social row against each person here NPC State Delta has an opinion on. The tail gives
// one compact line per member, results grouped:
//
//   Checks — Wessel (you) 1st: STR AGI N~H · DEX VIT E · INT CHA LUK ✗ | 2nd: STR V · AGI DEX H~V · …
//
// A cell names the hardest difficulty the roll reaches (E easy 10, N normal 15, H hard 20, V very hard 25),
// `~X` when X is missed by 1 or 2 (a success at a cost), `✗` when even easy is missed by more, `★` a
// natural 20 (always succeeds), `✗!` a natural 1 (always fails). The first uncertain attempt of the reply
// reads the actor's 1st column, the second the 2nd; at most two per reply. The capture works the check
// out again from the same die and the same modifiers (commands.js), so what the table said is what the
// card records, and a written result that disagrees is flagged as before. Other modules' hooks
// (`checkModifiers`, outside.js) need a command to ask and are applied at the capture only.
// Pure.

import { STATS } from '../../rules.js';
import { TOPICS, modifiersFor } from './modifiers.js';
import { socialSkill } from './outside.js';
import { sumOf } from './shared.js';

export const TIERS = Object.freeze([['E', 10], ['N', 15], ['H', 20], ['V', 25]]);
/** Members in the table at most (two dice each: 8 of the 10 a prepare may hold). */
export const MAX_TABLE_ACTORS = 4;
/** People here asked about for a social row, at most. */
export const MAX_SOCIAL_ROWS = 2;
export const DICE_PER_ACTOR = 2;

const ORDER = ['★', 'V', 'H~V', 'H', 'N~H', 'N', 'E~N', 'E', '~E', '✗', '✗!'];
const flat = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const title = word => word[0].toUpperCase() + word.slice(1);

/** The cell for a die and its total: '★' | '✗!' | 'N~H' | 'E' | '~E' | '✗' … */
export function cell(die, total) {
    if (die === 20) return '★';
    if (die === 1) return '✗!';
    let best = null;
    for (const [letter, dc] of TIERS) if (total >= dc) best = letter;
    const next = TIERS.find(([, dc]) => total < dc);
    const cost = next && total >= next[1] - 2 ? `~${next[0]}` : '';
    return best ? `${best}${cost}` : cost || '✗';
}

/**
 * A member's rows: [{ label, skill, mod }]: every stat (its skill word is the stat, as `? check STR`), then
 * each topic the member has an extra or an effect for (`? check Perception`), then `vs <Name>` for each
 * `social` answer ({ name, mod }: CHA with Delta's opinion on top, held to ±cap).
 */
export function rowsFor(member, rules, social = [], cap = 5) {
    const rows = STATS.map(stat => ({ label: stat, skill: stat, mod: sumOf(modifiersFor(member, stat, stat, rules)) }));
    const topics = new Set();
    for (const extra of member?.extras ?? []) for (const topic of extra.topics ?? []) topics.add(topic);
    for (const effect of member?.effects ?? []) for (const entry of effect.checks ?? []) if (Object.hasOwn(TOPICS, entry.on)) topics.add(entry.on);
    for (const topic of [...topics].filter(name => Object.hasOwn(TOPICS, name)).sort()) {
        rows.push({ label: title(topic), skill: topic, mod: sumOf(modifiersFor(member, topic, null, rules)) });
    }
    const cha = rows.find(row => row.label === 'CHA')?.mod ?? 0;
    for (const answer of social.slice(0, MAX_SOCIAL_ROWS)) {
        const extra = Math.max(-cap, Math.min(cap, Math.round(Number(answer?.mod) || 0)));
        if (extra && answer?.name) rows.push({ label: `vs ${flat(answer.name, 30)}`, skill: 'social', mod: cha + extra });
    }
    return rows;
}

/** "STR AGI N~H · DEX E · INT ✗" for one die over the rows, best first; "all ★" / "all ✗!" for a natural 20 / 1. */
export function dieText(die, rows) {
    if (die === 20) return 'all ★';
    if (die === 1) return 'all ✗!';
    const groups = new Map();
    for (const row of rows) {
        const key = cell(die, die + row.mod);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row.label);
    }
    return [...groups].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])).map(([key, labels]) => `${labels.join(' ')} ${key}`).join(' · ');
}

/** One member's line: "Checks — Wessel (you) 1st: … | 2nd: …". `dice`: [1st, 2nd]. */
export function tableLine(name, dice, rows, { you = false } = {}) {
    const [first, second] = dice;
    return `Checks — ${flat(name, 40)}${you ? ' (you)' : ''} 1st: ${dieText(first, rows)}${Number.isInteger(second) ? ` | 2nd: ${dieText(second, rows)}` : ''}`;
}

/** The two dice of the member at `index` in a prepared entry (`actors` order), or null. */
export function diceOf(prepared, actorId) {
    const actors = Array.isArray(prepared?.actors) ? prepared.actors : null;
    if (!actors) return null;
    const at = actors.indexOf(actorId);
    if (at < 0) return null;
    const dice = (prepared.rolls ?? []).slice(at * DICE_PER_ACTOR, at * DICE_PER_ACTOR + DICE_PER_ACTOR);
    return dice.length === DICE_PER_ACTOR ? dice : null;
}

/** Whether a skill word asks Delta (exported for the tail's social rows). */
export const isSocial = skill => socialSkill(skill) !== null;
