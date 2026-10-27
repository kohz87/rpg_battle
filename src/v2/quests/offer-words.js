// RPG Battle v2, generative offers: the words an offer line is read with (GENERATIVE_OFFERS_SPEC §3.2). English, built in; a rules
// manifest adds its own in `offerWords` (checked first). Pure: no ctx, no state.

import { singular } from './parse.js';

/** The job types, in the order the table reads. `kind` is the template objective kind each one is made from. */
export const TYPES = Object.freeze({
    hunt: { kind: 'kill', words: ['hunt', 'slay', 'kill', 'bounty', 'monster', 'beast'],
        verbs: ['kill', 'slay', 'hunt', 'hunt down', 'defeat', 'vanquish', 'banish', 'exorcise', 'take down', 'put down', 'bring down', 'fight', 'dispatch'] },
    cull: { kind: 'kill', words: ['cull', 'clear', 'purge', 'exterminate', 'pest', 'pests', 'vermin'],
        verbs: ['cull', 'clear', 'purge', 'exterminate', 'eliminate', 'wipe out', 'drive off', 'drive out', 'destroy'] },
    gather: { kind: 'collect', words: ['gather', 'collect', 'harvest', 'forage', 'fetch'],
        verbs: ['gather', 'collect', 'harvest', 'forage', 'fetch', 'find', 'get', 'obtain', 'procure', 'pick'] },
    deliver: { kind: 'collect', words: ['deliver', 'delivery', 'courier', 'supply', 'bring'],
        verbs: ['deliver', 'bring', 'bring back', 'hand over', 'turn in', 'return', 'retrieve', 'recover'] },
    explore: { kind: 'visit', words: ['explore', 'scout', 'travel', 'visit', 'journey'],
        verbs: ['explore', 'scout', 'visit', 'reach', 'travel to'] },
    escort: { kind: 'story', words: ['escort', 'protect', 'guard'],
        verbs: ['escort', 'protect', 'guard', 'rescue'] },
    task: { kind: 'story', words: ['task', 'errand', 'favour', 'favor', 'investigate', 'investigation', 'mystery', 'message', 'story'],
        verbs: ['find out', 'learn', 'discover', 'investigate', 'ask about', 'talk to', 'help', 'settle', 'convince', 'persuade', 'watch'] },
});
export const TYPE_ORDER = Object.freeze(Object.keys(TYPES));
/** `bounty` counts as a hunt; `side`, `main` and `contract` name no type, so the goal's first verb decides. */
export const DIFFICULTIES = Object.freeze({
    easy: ['easy', 'simple', 'trivial', 'minor', 'light', 'low', 'beginner', 'novice'],
    normal: ['normal', 'medium', 'moderate', 'standard', 'average', 'routine', 'fair'],
    hard: ['hard', 'difficult', 'tough', 'dangerous', 'challenging', 'high', 'risky', 'perilous'],
    nightmare: ['nightmare', 'deadly', 'extreme', 'lethal', 'impossible', 'brutal'],
});

/** Lower case, Unicode-folded words of a text (letters, digits, apostrophes and hyphens stay inside a word). */
export const wordsOf = text => String(text ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];

/** The pack's words for a list, lower case and clean, or []. */
const packList = (words, name) => (Array.isArray(words?.[name]) ? words[name].filter(word => typeof word === 'string' && word) : []);

/** The type a `type:` value names: the first of its words found in a pack list, else in the built-in table; null for none (side, main, contract). */
export function typeFromLabel(value, words = null) {
    for (const word of wordsOf(value)) {
        for (const name of TYPE_ORDER) if (packList(words, name).includes(word)) return name;
        for (const name of TYPE_ORDER) if (TYPES[name].words.includes(word)) return name;
    }
    return null;
}

// The other forms of a verb's first word: -s, -es, -ed, -d, -ing, the doubled consonant of a short verb and a few irregular ones.
const IRREGULAR = Object.freeze({ slay: ['slew', 'slain'], take: ['took', 'taken'], bring: ['brought'], fight: ['fought'], find: ['found'], drive: ['drove', 'driven'],
    put: ['putting'], get: ['got', 'getting', 'gotten'], hand: ['handed'], turn: ['turned'], pick: ['picked'], help: ['helped'], learn: ['learnt'] });
function formsOf(word) {
    const out = new Set([word, `${word}s`, `${word}es`, `${word}ed`, `${word}d`, `${word}ing`, ...(IRREGULAR[word] ?? [])]);
    if (word.endsWith('e')) out.add(`${word.slice(0, -1)}ing`);
    if (/[^aeiou][aeiou][^aeiouwxy]$/.test(word) && word.length <= 4) out.add(`${word}${word.at(-1)}ing`).add(`${word}${word.at(-1)}ed`);
    if (word.endsWith('y')) out.add(`${word.slice(0, -1)}ied`).add(`${word.slice(0, -1)}ies`);
    return out;
}
const VERB_ENTRIES = TYPE_ORDER.flatMap(name => TYPES[name].verbs.map(phrase => {
    const [head, ...tail] = phrase.split(' ');
    return { type: name, phrase, forms: formsOf(head), tail };
}));

/**
 * The first goal verb in `text`: `{ type, start, end }` (character offsets of the verb phrase in `text`), the earliest one, and at one place the
 * longest phrase ("find out" before "find", "bring down" before "bring"). A pack's words are verbs too, as written. Null for none.
 * `kind`: only the verbs of that objective kind ('kill', 'collect', 'visit', 'story'), else every verb.
 */
export function firstVerb(text, { words = null, kind = null } = {}) {
    const found = [...String(text ?? '').matchAll(/[\p{L}][\p{L}'’-]*/gu)].map(match => ({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length }));
    for (let i = 0; i < found.length; i += 1) {
        let best = null;
        for (const name of TYPE_ORDER) {
            if (kind && TYPES[name].kind !== kind) continue;
            if (packList(words, name).includes(found[i].word)) best = best ?? { type: name, start: found[i].start, end: found[i].end, size: 1 };
        }
        for (const entry of VERB_ENTRIES) {
            if (kind && TYPES[entry.type].kind !== kind) continue;
            if (!entry.forms.has(found[i].word)) continue;
            if (entry.tail.some((word, n) => found[i + 1 + n]?.word !== word)) continue;
            const size = 1 + entry.tail.length;
            if (!best || size > best.size) best = { type: entry.type, start: found[i].start, end: found[i + size - 1].end, size };
        }
        if (best) return { type: best.type, start: best.start, end: best.end };
    }
    return null;
}

/** The difficulty word a `difficulty:` value holds: the first of its words found in a pack list, else the built-in table; null for none. */
export function difficultyFromLabel(value, words = null) {
    const names = Object.keys(DIFFICULTIES);
    for (const word of wordsOf(value)) {
        for (const name of names) if (packList(words, name).includes(word)) return name;
        for (const name of names) if (DIFFICULTIES[name].includes(word)) return name;
    }
    return null;
}

/** Amount of time words: a duration in minutes from `in 3 days`, `2 weeks`, `a day`, `tomorrow`, `half a day`; null for anything else. */
const UNIT = Object.freeze({ minute: 1, hour: 60, day: 1440, week: 10080 });
const NUMBER = Object.freeze({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 });
export function minutesOf(value) {
    const text = String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
    if (/^(?:by |until )?tomorrow$/.test(text)) return 1440;
    if (/^(?:in )?half a day$/.test(text)) return 720;
    const match = /^(?:in |within |after )?(\d+|[a-z]+)\s*(minute|hour|day|week)s?$/.exec(text);
    if (!match) return null;
    const n = /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER[match[1]];
    if (!Number.isSafeInteger(n) || n < 1) return null;
    const minutes = n * UNIT[match[2]];
    return Number.isSafeInteger(minutes) ? minutes : null;
}

/** "7 days", "2 days", "10 hours", "45 minutes": a duration in the units it divides into. */
export function durationText(minutes) {
    const unit = (n, name) => `${n} ${name}${n === 1 ? '' : 's'}`;
    if (minutes % 1440 === 0) return unit(minutes / 1440, 'day');
    if (minutes % 60 === 0) return unit(minutes / 60, 'hour');
    return unit(minutes, 'minute');
}

// Words an offer skips or stops at when it reads the target of a goal (§4.2).
export const SKIPPED = Object.freeze(['the', 'a', 'an', 'some', 'all', 'every', 'any', 'those', 'these', 'its', 'their', 'at least']);
export const EXTRA_STOPS = Object.freeze(['north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western', 'northwards', 'southwards',
    'beneath', 'below', 'above', 'past', 'through', 'off']);
/** Words a phrase is matched without. */
export const FILLER = Object.freeze(['the', 'a', 'an', 'of', 'some', 'all', 'pack', 'band', 'group', 'horde', 'nest']);
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/** A phrase in title case ("culvert rats" → "Culvert Rats", "alpha of the pack" → "Alpha of the Pack"), cut to `max` code points. */
export function titleCase(phrase, max = 80) {
    const out = String(phrase ?? '').trim().split(/\s+/).map((word, i) => (i > 0 && SMALL.has(word.toLowerCase()) ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())).join(' ');
    return [...out].slice(0, max).join('');
}

/** Trainer subjects (§3.2): each family's words fold to its first. */
export const FAMILIES = Object.freeze({
    blade: ['sword', 'swordplay', 'swordsmanship', 'fencing', 'rapier', 'duelling'],
    spear: ['pike', 'polearm', 'halberd', 'lance'],
    shield: ['buckler', 'guard', 'defence'],
    magic: ['spell', 'arcane', 'sorcery', 'wizardry', 'hedge', 'ward', 'mana'],
    street: ['knife', 'dagger', 'thief', 'rogue', 'stealth', 'alley', 'gutter', 'cane'],
    bow: ['archery', 'arrow', 'marksman'],
    fist: ['unarmed', 'boxing', 'brawling', 'wrestling'],
    flame: ['fire', 'holy', 'prayer', 'faith', 'temple'],
});
const FAMILY_OF = new Map(Object.entries(FAMILIES).flatMap(([head, list]) => list.map(word => [word, head])));
const NOISE = new Set(['and', 'the', 'a', 'an', 'of', 'to', 'with', 'for', 'in', 'on', 'at', 'by', 'from', 'teach', 'teaches', 'teaching', 'work', 'works']);

/** The folded words of a text for matching a trainer: singular, family heads, no noise. A hyphenated word counts as its parts. */
export function subjectWords(text) {
    const out = new Set();
    for (const raw of String(text ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) {
        if (NOISE.has(raw)) continue;
        const word = singular(raw);
        if (NOISE.has(word)) continue;
        out.add(FAMILY_OF.get(raw) ?? FAMILY_OF.get(word) ?? word);
    }
    return out;
}
