// The State line: what a sheet's numbers mean for the story, in words the model can portray.
//
// The model reads the Character and Party blocks every reply, but `HP: 21/98` does not say
// how to play someone; left to read the numbers, a model writes a character at a fifth of
// their HP fighting on unbothered, and the mechanics and the narrative drift apart. So code
// turns HP, MP and conditions into a few fixed words ("badly hurt (bleeding, slow to move) ·
// drained of magic · poisoned") with the bands in rules.narrative. The line is derived: the
// sheet writes it out and never reads it back, so editing it changes nothing. Pure.

import { DEFAULT_RULES } from './rules.js';

// A portrayal hint for the bands where a bare word leaves too much to the model's taste;
// "unhurt" and "bruised" need none. Keyed by word, so a band renamed in rules.json simply
// goes without a hint.
const HP_HINTS = {
    hurt: 'aching, favouring a wound',
    'badly hurt': 'bleeding, slow to move',
    'barely standing': 'staggering, could fall at any moment',
    down: 'unconscious or unable to fight',
};

const DOWN = 'down';
const DRAINED = 'drained';

// Condition names as the story should say them; anything else is shown as written.
// The words map to themselves so a hand-written "Poisoned" and a fight's "poison" agree.
const CONDITION_WORDS = {
    poison: 'poisoned',
    burn: 'burned',
    bleed: 'bleeding',
    stun: 'stunned',
    slow: 'slowed',
    weaken: 'weakened',
    exhausted: 'exhausted',
};
for (const word of Object.values(CONDITION_WORDS)) CONDITION_WORDS[word] = word;

const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

function narrativeRules(rules) {
    return (rules ?? DEFAULT_RULES).narrative ?? DEFAULT_RULES.narrative;
}

/** The first band whose share the value reaches; bands run from the best down. */
function band(share, bands, fallback) {
    for (const [atLeast, word] of bands ?? []) if (share >= Number(atLeast)) return word;
    return fallback;
}

function hpWord(hp, n) {
    const cur = num(hp?.cur);
    const max = num(hp?.max);
    if (cur <= 0) return DOWN;
    // Anyone above 0 HP is still standing, however small the share, so the last band catches it.
    return band(max > 0 ? cur / max : 1, n.hpBands, n.hpBands?.at(-1)?.[1] ?? DOWN);
}

function mpWord(mp, n) {
    const max = num(mp?.max);
    if (max <= 0) return n.mpBands?.[0]?.[1] ?? 'fresh';
    return band(num(mp?.cur) / max, n.mpBands, DRAINED);
}

function conditionWords(conditions) {
    const words = [];
    for (const condition of conditions ?? []) {
        const name = String(condition?.name ?? '').trim();
        if (!name) continue;
        const word = CONDITION_WORDS[name.toLowerCase()] ?? name;
        // Rounds are mechanics; only the condition itself is for the story.
        if (!words.some(other => other.toLowerCase() === word.toLowerCase())) words.push(word);
    }
    return words;
}

/**
 * A sheet's (or a fight result member's) HP, MP and conditions in words:
 * { hp, mp, conditions: [words], text }. `text` is the State line: the HP word (with its
 * hint), the MP word only when not at the top band, and the conditions, joined with ' · '.
 * MP is left out for someone with a tiny MP pool (they are no caster) and for someone down
 * (magic is not what the story needs to know about them).
 */
export function stateWords(sheet, rules = DEFAULT_RULES) {
    // A fight lost to the death (0.4) leaves "dead" on the sheet: nothing else is to be portrayed.
    if ((sheet?.conditions ?? []).some(condition => String(condition?.name ?? '').trim().toLowerCase() === 'dead')) return { hp: 'dead', mp: '', conditions: [], text: 'dead' };
    const n = narrativeRules(rules);
    const hp = hpWord(sheet?.hp, n);
    const mp = mpWord(sheet?.mp, n);
    const conditions = conditionWords(sheet?.conditions);
    const parts = [HP_HINTS[hp] ? `${hp} (${HP_HINTS[hp]})` : hp];
    const caster = num(sheet?.mp?.max) >= num(n.mpQuietBelow);
    if (caster && hp !== DOWN && mp !== n.mpBands?.[0]?.[1]) parts.push(`${mp} of magic`);
    parts.push(...conditions);
    return { hp, mp, conditions, text: parts.join(' · ') };
}
