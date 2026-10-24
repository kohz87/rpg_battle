// Checks outside a fight (SPEC §4.5 "stop at the check"): the story writes `? check stealth — …
// | dc: hard` and stops; code rolls a d20 for the member, adds v1's check modifier for the stat
// the skill word names, and reads the total against the difficulty the way Story Block's dice
// have always read it (5 trivial · 10 easy · 15 ordinary · 20 hard · 25 very hard · 30
// near-impossible; total ≥ DC success, DC−1 or DC−2 success at a cost, lower a fail, a natural
// 20 critical, a natural 1 a critical fail). Pure.

import { STATS } from '../../rules.js';

export const DC_WORDS = Object.freeze({
    trivial: 5, easy: 10, normal: 15, ordinary: 15, medium: 15, moderate: 15, average: 15,
    hard: 20, difficult: 20, tough: 20, 'very hard': 25, heroic: 25, 'near-impossible': 30, 'nearly impossible': 30, impossible: 30,
});

export const OUTCOMES = Object.freeze({
    crit: 'critical success',
    success: 'success',
    cost: 'success, at a cost',
    fail: 'fail',
    critfail: 'critical fail',
});

// Skill words → the stat that answers them; a stat's own name works too. Anything else is luck.
const STAT_WORDS = [
    ['STR', /\b(?:athletic\w*|strength|str|climb\w*|lift\w*|force\w*|break\w*|smash\w*|push\w*|pull\w*|swim\w*|grapple\w*|wrestl\w*|carry\w*|bend\w*)\b/],
    ['VIT', /\b(?:endur\w*|vit|vitality|constitution|resist\w*|stamina|toughness|fortitude|surviv\w*|hold (?:out|breath)|drink\w*|march\w*)\b/],
    ['AGI', /\b(?:acrobat\w*|agi|agility|dodg\w*|balanc\w*|tumbl\w*|jump\w*|leap\w*|run\w*|chase\w*|reflex\w*|escape\w*|evad\w*)\b/],
    ['DEX', /\b(?:stealth\w*|dex|dexterity|sneak\w*|hide|hiding|lock\w*|pick\w*|sleight\w*|aim\w*|throw\w*|craft\w*|disarm\w*|pickpocket\w*|thiev\w*|ride|riding)\b/],
    ['INT', /\b(?:int|intelligence|lore|arcan\w*|knowledge|history|investigat\w*|search\w*|study\w*|recall\w*|decipher\w*|magic|medicine|heal\w*|notice\w*|percept\w*|spot\w*|track\w*|insight\w*)\b/],
    ['CHA', /\b(?:cha|charisma|persua\w*|decept\w*|deceiv\w*|lie|lying|bluff\w*|intimidat\w*|charm\w*|haggl\w*|barter\w*|perform\w*|negotiat\w*|convinc\w*|seduc\w*|command\w*|lead\w*)\b/],
    ['LUK', /\b(?:luk|luck\w*|chance|gambl\w*|fortune|guess\w*)\b/],
];

/** The stat a check uses: a written stat name, else the one its skill word suggests, else LUK. */
export function statForCheck(skill, stat = null) {
    const written = String(stat ?? '').trim().toUpperCase();
    if (STATS.includes(written)) return written;
    const word = String(skill ?? '').trim();
    if (STATS.includes(word.toUpperCase())) return word.toUpperCase();
    const text = ` ${word.toLowerCase()} `;
    return STAT_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'LUK';
}

/** { dc, word } for 'easy' | 'normal' | 'hard' | … | a number (1–40), or null when it is neither. */
export function dcOf(value) {
    if (Number.isInteger(value)) return value >= 1 && value <= 40 ? { dc: value, word: '' } : null;
    const text = String(value ?? '').trim().toLowerCase().replace(/^dc\s*/, '');
    if (!text) return { dc: DC_WORDS.normal, word: 'normal' };
    if (/^\d+$/.test(text)) {
        const dc = Number(text);
        return dc >= 1 && dc <= 40 ? { dc, word: '' } : null;
    }
    return text in DC_WORDS ? { dc: DC_WORDS[text], word: text } : null;
}

/** The outcome of a d20 roll `die` + `mod` against `dc` (Story Block's dice rules). */
export function outcomeOf(die, mod, dc) {
    if (die === 20) return 'crit';
    if (die === 1) return 'critfail';
    const total = die + mod;
    if (total >= dc) return 'success';
    return total >= dc - 2 ? 'cost' : 'fail';
}
