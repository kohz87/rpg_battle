// Story Director v2, part **checks**: the words a check is read by (contract §3 P09: "Resolve explicit stat first, else transferred
// statForCheck(skill) (unknown -> LUK)" and "the transferred topic table"). Moved from RPG Battle's party/checks.js and checks/modifiers.js
// with their patterns unchanged. Pure.

export const STATS = Object.freeze(['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA']);

// Skill words -> the stat that answers them; a stat's own name works too. Anything else is luck.
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

/** The fixed topics and the skill words that fall under each (tested against the skill word). */
export const TOPICS = Object.freeze({
    perception: /\b(?:percep\w*|notic\w*|spot\w*|search\w*|look\w*|listen\w*|investigat\w*|insight\w*|awareness|watch\w*|scout\w*)\b/,
    stealth: /\b(?:stealth\w*|sneak\w*|hid(?:e|es|ing)|hidden|creep\w*|prowl\w*|skulk\w*)\b/,
    lock: /\b(?:lock\w*|pick\w*|disarm\w*|trap\w*|sleight\w*|pickpocket\w*)\b/,
    climb: /\b(?:climb\w*|scal(?:e|es|ing)|swim\w*|jump\w*|leap\w*|athlet\w*)\b/,
    strength: /\b(?:strength|lift\w*|carry\w*|break\w*|smash\w*|push\w*|pull\w*|forc(?:e|es|ing)|grappl\w*|wrestl\w*|haul\w*)\b/,
    speed: /\b(?:run|runs|running|chas\w*|dodg\w*|escap\w*|evad\w*|acrobat\w*|reflex\w*|balanc\w*|tumbl\w*|speed)\b/,
    endurance: /\b(?:endur\w*|stamina|fortitude|resist\w*|poison\w*|toughness|constitution|march\w*)\b/,
    will: /\b(?:will|willpower|resolve|courage|fear|nerve|resist\w*|steel\w*)\b/,
    social: /\b(?:social|persua\w*|decept\w*|deceiv\w*|bluff\w*|charm\w*|negotiat\w*|haggl\w*|barter\w*|convinc\w*|perform\w*|intimidat\w*|lie|lying|diplomac\w*|etiquette)\b/,
    lore: /\b(?:lore|arcan\w*|knowledge|histor\w*|recall\w*|deciph\w*|stud\w*|magic|religion|medicine|read\w*)\b/,
    nature: /\b(?:nature|surviv\w*|track\w*|forag\w*|navigat\w*|hunt\w*|wilderness|herb\w*)\b/,
    animals: /\b(?:animals?|ride|rides|riding|tam(?:e|es|ing)|handl\w*|calm\w*|horse\w*)\b/,
    craft: /\b(?:craft\w*|repair\w*|mend\w*|forg(?:e|es|ing)|tinker\w*|build\w*|smith\w*)\b/,
    luck: /\b(?:luck\w*|chance|gambl\w*|fortune|guess\w*)\b/,
});

export const TOPIC_NAMES = Object.freeze(Object.keys(TOPICS));

/** The topics a skill word falls under, in the table's order. */
export const topicsOf = skill => {
    const word = String(skill ?? '').toLowerCase();
    return TOPIC_NAMES.filter(name => TOPICS[name].test(word));
};

/** The outcome of a d20 `die` + `mod` against `dc`: natural 20 crit, natural 1 critfail, then success, cost within `margin`, fail. */
export function outcomeOf(die, mod, dc, margin = 2) {
    if (die === 20) return 'crit';
    if (die === 1) return 'critfail';
    const total = die + mod;
    if (total >= dc) return 'success';
    return total >= dc - margin ? 'cost' : 'fail';
}

export const DC_WORDS = Object.freeze({
    trivial: 5, easy: 10, normal: 15, ordinary: 15, medium: 15, moderate: 15, average: 15,
    hard: 20, difficult: 20, tough: 20, 'very hard': 25, heroic: 25, 'near-impossible': 30, 'nearly impossible': 30, impossible: 30,
});

/** The difficulty a change line writes: a word of the table or a number from 1 to 40 -> the number, else null. */
export function dcOf(value) {
    if (Number.isInteger(value)) return value >= 1 && value <= 40 ? value : null;
    const text = String(value ?? '').trim().toLowerCase().replace(/^dc\s*/, '');
    if (/^\d+$/.test(text)) return Number(text) >= 1 && Number(text) <= 40 ? Number(text) : null;
    return Object.hasOwn(DC_WORDS, text) ? DC_WORDS[text] : null;
}
