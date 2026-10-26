// The stat word used by RB's read-only modifier projection. SD owns difficulties, outcomes and dice.
import { STATS } from '../../rules.js';

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
