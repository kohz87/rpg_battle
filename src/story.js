// The story's side of the numbers: wounds the story deals outside a fight, and the fights it
// starts (DESIGN §8.6, §4.2).
//
// A fight in RPG Battle is resolved in code, but the story also hurts people between fights: a
// fall into a ravine, a poisoned cup, a healer's poultice. Left alone, the sheet says "unhurt"
// while the prose says "bleeding", and the State line then tells the model to portray the
// wrong thing. So the model may add a hidden <Wounds> block naming who was hurt and how badly
// in a few fixed words, and code turns the words into HP with a share of max HP per word
// (rules.wounds). The model never writes a number. Likewise a fight the story starts is named
// in an <Encounter> block ("3 bandit, bandit captain (boss)"), parsed here into the rows of a
// fight the reader takes or leaves but never changes: the engagement and its stakes ("| to the
// death") are the story's (0.4.2). Both parsers are lenient, because they read what a model wrote.
//
// An encounter may also say how dangerous a foe is in one word, relative to the party
// ("3 marsh wolf (weak)", "wolf matriarch (boss, strong)"): a threat, which threatLevel turns
// into a level from the party's own, so the model judges the danger and code sets the number.
// A power written outright (a rank, a level, a tier in the reader's terms) wins over it. Pure.

import { DEFAULT_RULES, RANKS, STATS } from './rules.js';
import { DEFAULT_BESTIARY, findCreature } from './enemies.js';
import { maxLevel, parseLevelLabel, termsOf } from './terms.js';
import { creatureSingular } from './templates.js';

/**
 * What the model is told every reply while you have a character (index.js injects it at
 * depth 1, apart from the fight hand-off). It is paid for on every reply, so it stays near 185
 * tokens (tests/story.test.js holds it there): the hidden blocks by example, each only when
 * the story makes it true, and the judgement calls (which wound word, which threat word, a fight
 * to the death or not, how big an achievement). "Stop at the first blow" leaves the fight itself to RPG Battle, so the
 * prose does not resolve what the buttons are about to. Every block is only an offer: the
 * reader accepts it or not.
 */
export const STORY_INSTRUCTION = 'Hidden blocks, only when the story makes them true (not for an RPG Battle fight). Someone on the Party sheet hurt or healed: <Wounds>, a line each, Name — scratch|wound|severe|grievous: cause (or heal wound, or poisoned; mildest fitting word). A fight starts: <Encounter>3 wolf (weak); then: wolf matriarch (boss, strong)</Encounter> (then: more foes join; then at <place>: next fight, elsewhere; threat vs party: trivial|weak|even|strong|deadly; | to the death if defeat is death), then stop at the first blow. Also: <Joins>Lyra — healer, level 6</Joins>, <Leaves>Lyra: went home</Leaves>, <Learned>Lyra — Frost Lance: ice magic, hits all</Learned>, <XP>minor|major|milestone: why</XP>, <Rest>short|long: why</Rest> when the party rests.';

// Mildest first, so "the worst word mentioned" is the one with the highest index.
export const SEVERITIES = Object.freeze(['scratch', 'wound', 'severe', 'grievous']);
const ROLES = ['brute', 'skirmisher', 'caster', 'tank', 'support'];

// A heal written without a word ("Ren — healed: the priest's blessing") is taken as the
// mildest one: under-healing is fixed with a rest, over-healing would hide the story.
const DEFAULT_HEAL = 'scratch';

const HEAL_WORDS = /^(?:heal|heals|healed|healing|treat|treats|treated)$/;
const CURE_WORDS = /^(?:cure|cures|cured|curing)$/;
// "Ren — unhurt: dodged the arrow" is not a condition, it is nothing at all.
const NOTHING = /^(?:none|nothing|fine|ok|okay|unhurt|unharmed|unscathed|safe|no change|no effect|-+)$/;
const MAX_CAUSE = 160;
const MAX_CONDITION = 40;

const clean = value => String(value ?? '').normalize('NFKC').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const stripBullet = line => line.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '');
const isTagLine = line => /^\s*<\/?[A-Za-z][\w-]*>\s*$/.test(line);

/** "Ren", "ren", "Rén" and "REN" are one name; quotes and stray marks are not part of it. */
function nameKey(name) {
    return clean(name)
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/["'“”‘’]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

const firstName = name => nameKey(name).split(' ')[0] ?? '';

function severityOf(word) {
    if (word.startsWith('scratch')) return 'scratch';
    if (word.startsWith('wound')) return 'wound';
    if (word.startsWith('sever')) return 'severe';
    if (word.startsWith('grievous')) return 'grievous';
    return null;
}

/** The worst severity word among `words`, or null. */
function worst(words) {
    let best = -1;
    for (const word of words) best = Math.max(best, SEVERITIES.indexOf(severityOf(word)));
    return best >= 0 ? SEVERITIES[best] : null;
}

/** "wound: fell down the ravine", "wound — fell", "wound (fell)", "wound, fell" → [effect, cause]. */
function splitCause(rest) {
    const colon = rest.indexOf(':');
    if (colon >= 0) return [rest.slice(0, colon), rest.slice(colon + 1)];
    const dash = rest.match(/^(.*?)\s+[—–-]+\s+(.*)$/);
    if (dash) return [dash[1], dash[2]];
    const paren = rest.match(/^(.*?)\s*\((.*)\)\s*\.?$/);
    if (paren) return [paren[1], paren[2]];
    const comma = rest.indexOf(',');
    if (comma >= 0) return [rest.slice(0, comma), rest.slice(comma + 1)];
    return [rest, ''];
}

function tidyCause(text) {
    return clean(text).replace(/^[\s.,;:—–-]+/, '').replace(/[\s.]+$/, '').slice(0, MAX_CAUSE);
}

/** One <Wounds> line, or null when it says nothing RPG Battle can use. */
function parseWoundLine(raw) {
    const line = clean(stripBullet(raw));
    if (!line || isTagLine(line)) return null;
    // Em dash, en dash, a double hyphen, or a hyphen after a space; "Mary-Jane" keeps her hyphen.
    const parts = line.match(/^(.+?)\s*(?:[—–]|--|\s-)\s*(.+)$/);
    if (!parts) return null;
    const name = clean(parts[1]).replace(/[:,]+$/, '');
    if (!name) return null;
    const [effectText, causeText] = splitCause(parts[2]);
    const effect = clean(effectText).toLowerCase().replace(/[.!]+$/, '');
    const cause = tidyCause(causeText);
    if (!effect || NOTHING.test(effect)) return null;
    const words = effect.split(/[\s,]+/).filter(Boolean);

    const cureAt = words.findIndex(word => CURE_WORDS.test(word));
    if (cureAt >= 0) {
        const condition = words.filter((_, index) => index !== cureAt).join(' ').replace(/^of\s+/, '').trim();
        return condition ? { name, kind: 'cure', condition: condition.slice(0, MAX_CONDITION), cause } : null;
    }
    if (words.some(word => HEAL_WORDS.test(word))) {
        return { name, kind: 'heal', severity: worst(words) ?? DEFAULT_HEAL, cause };
    }
    const severity = worst(words);
    // "severe wound", "grievously wounded": a few words around a severity are still that severity.
    if (severity && words.length <= 3) return { name, kind: 'harm', severity, cause };
    // Anything else short is a condition the story put on them, kept as written.
    if (words.length <= 3 && /^[a-z][a-z' -]*$/.test(effect)) return { name, kind: 'condition', condition: effect.slice(0, MAX_CONDITION), cause };
    return null;
}

/**
 * The lines of a <Wounds> block: [{ name, kind: 'harm' | 'heal' | 'condition' | 'cure',
 * severity?, condition?, cause }]. One line per person:
 *   `Name — scratch|wound|severe|grievous: cause`      harm
 *   `Name — heal <word>: cause` (also healed, treated)  healing
 *   `Name — poisoned: cause`                            a condition added
 *   `Name — cure poison: cause`                         a condition removed
 * Bullets, bold, an en or em dash or a spaced hyphen, and any case are accepted; a line it
 * cannot read is skipped. Never throws.
 */
export function parseWounds(text) {
    const out = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const wound = parseWoundLine(raw);
        if (wound) out.push(wound);
    }
    return out;
}

// Condition names compared by stem, so a written "poisoned" and a fight's "poison" are one
// condition, and "cure exhaustion" lifts "exhausted".
const STEMS = { poisoned: 'poison', poisoning: 'poison', bleeding: 'bleed', burned: 'burn', burning: 'burn', burnt: 'burn', stunned: 'stun', slowed: 'slow', weakened: 'weaken' };

function conditionStem(name) {
    const key = clean(name).toLowerCase();
    if (STEMS[key]) return STEMS[key];
    const stripped = key.replace(/(?:ion|ed|ing)$/, '');
    return stripped.length >= 3 ? stripped : key;
}

function sameCondition(a, b) {
    const x = conditionStem(a);
    const y = conditionStem(b);
    return x === y || (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x)));
}

/** The person a written name means: the full name first, then the first name; your character before the companions. */
export function findTarget(targets, name) {
    const wanted = nameKey(name);
    if (!wanted) return null;
    return targets.find(target => nameKey(target.name) === wanted)
        ?? targets.find(target => firstName(target.name) && firstName(target.name) === firstName(wanted))
        ?? null;
}

function shareOf(severity, rules) {
    const table = { ...DEFAULT_RULES.wounds, ...(rules?.wounds ?? {}) };
    const share = Number(table[severity]);
    return Number.isFinite(share) && share > 0 ? share : 0;
}

/**
 * The wounds applied to copies of the sheets: { pc, members, applied }. Harm takes a share of
 * max HP by its word (rules.wounds) and may take someone to 0 HP (down); healing gives the same
 * share back, never above max. At most one harm-or-heal line per person counts (the first; a
 * model that writes "wound" and then "severe" for one fall is not dealing two blows), while
 * conditions and cures may come alongside. Names match the Character sheet's or a Party
 * member's, case-insensitively, also by first name; anyone else is ignored. A line that would
 * change nothing (a heal at full HP, a cure of nothing) is left out of `applied`.
 * applied: [{ name, memberId, kind, severity, hp (signed change), condition, cause, down }]. Pure:
 * the sheets passed in are never changed.
 */
export function applyWounds({ pc = null, members = [] } = {}, wounds = [], rules = DEFAULT_RULES) {
    const nextPc = pc ? structuredClone(pc) : null;
    const nextMembers = (members ?? []).map(member => structuredClone(member));
    const targets = [
        ...(nextPc ? [{ id: 'pc', name: nextPc.name, sheet: nextPc }] : []),
        ...nextMembers.map(member => ({ id: member.id, name: member.name ?? member.sheet?.name, sheet: member.sheet })),
    ].filter(target => target.sheet && nameKey(target.name));
    const struck = new Set();
    const applied = [];
    for (const wound of wounds ?? []) {
        const target = findTarget(targets, wound?.name);
        if (!target) continue;
        const sheet = target.sheet;
        sheet.conditions = Array.isArray(sheet.conditions) ? sheet.conditions : [];
        const entry = { name: target.name, memberId: target.id, kind: wound.kind, severity: wound.severity ?? null, hp: 0, condition: wound.condition ?? null, cause: wound.cause ?? '' };
        if (wound.kind === 'harm' || wound.kind === 'heal') {
            if (struck.has(target.id)) continue;
            struck.add(target.id);
            const max = Math.max(0, Number(sheet.hp?.max) || 0);
            const cur = Math.min(max, Math.max(0, Number(sheet.hp?.cur) || 0));
            const amount = Math.max(1, Math.round(max * shareOf(wound.severity, rules)));
            const next = wound.kind === 'harm' ? Math.max(0, cur - amount) : Math.min(max, cur + amount);
            if (next === cur) continue;
            sheet.hp = { ...sheet.hp, cur: next };
            applied.push({ ...entry, hp: next - cur, down: next === 0 });
        } else if (wound.kind === 'condition') {
            if (!entry.condition || sheet.conditions.some(condition => sameCondition(condition.name, entry.condition))) continue;
            sheet.conditions.push({ name: entry.condition, rounds: null });
            applied.push(entry);
        } else if (wound.kind === 'cure') {
            const before = sheet.conditions.length;
            sheet.conditions = sheet.conditions.filter(condition => !sameCondition(condition.name, entry.condition));
            if (sheet.conditions.length !== before) applied.push(entry);
        }
    }
    return { pc: nextPc, members: nextMembers, applied };
}

/** One applied wound as the reader reads it: "Ren: wound (−29 HP), fell down the ravine." */
export function describeWound(entry) {
    const cause = entry.cause ? `, ${entry.cause}` : '';
    if (entry.kind === 'harm' || entry.kind === 'heal') {
        const word = entry.kind === 'heal' ? `heal ${entry.severity}` : entry.severity;
        const amount = entry.hp < 0 ? `−${-entry.hp} HP` : `+${entry.hp} HP`;
        return `${entry.name}: ${word} (${amount}${entry.down ? ', down' : ''})${cause}.`;
    }
    if (entry.kind === 'cure') return `${entry.name}: cured ${entry.condition}${cause}.`;
    return `${entry.name}: ${entry.condition}${cause}.`;
}

// ---------------------------------------------------------------------------
// Encounters

// Threat words, by what they mean relative to the party (rules.threat.offsets).
export const THREATS = Object.freeze(['trivial', 'weak', 'even', 'strong', 'deadly']);
const THREAT_WORDS = {
    trivial: 'trivial', feeble: 'trivial', puny: 'trivial',
    weak: 'weak', minor: 'weak', easy: 'weak', low: 'weak', lesser: 'weak',
    even: 'even', fair: 'even', matched: 'even', equal: 'even',
    strong: 'strong', tough: 'strong', dangerous: 'strong', high: 'strong',
    deadly: 'deadly', lethal: 'deadly', overwhelming: 'deadly', elite: 'deadly', calamity: 'deadly',
};
// Before a name only the words that are never part of one: "lesser demon", "high priest" and
// "elite guard" are names, so those words count only in brackets.
const LEADING_THREATS = new Set(['trivial', 'feeble', 'puny', 'weak', 'easy', 'matched', 'strong', 'tough', 'dangerous', 'deadly', 'lethal', 'overwhelming']);

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, several: 3, few: 3, pair: 2, couple: 2 };
const MAX_COUNT = 9;
// Engagements after the first (`then:`), each fought when the one before is done.
const MAX_WAVES = 3;
// What follows a bar on a line is about the fight, not a foe: "| to the death" (also "| death",
// "| stakes: death") makes defeat death; anything else there is ignored.
const DEATH_MARK = /^\s*(?:stakes\s*:?\s*)?(?:to\s+the\s+)?death\s*[.!]*\s*$/i;
const foesOnly = text => String(text ?? '').split(/\r?\n/).map(line => line.split('|')[0]).join('\n');
const nameMatch = (a, b) => nameKey(a).replace(/[^a-z0-9]+/g, ' ').trim() === nameKey(b).replace(/[^a-z0-9]+/g, ' ').trim();

// A plural's last word in its likely singular forms, most likely first.
function singulars(name) {
    const words = name.split(' ');
    const last = words.at(-1);
    const lower = last.toLowerCase();
    const stems = [];
    if (lower.endsWith('ves')) stems.push(`${last.slice(0, -3)}f`, `${last.slice(0, -3)}fe`);
    if (lower.endsWith('ies')) stems.push(`${last.slice(0, -3)}y`);
    if (lower.endsWith('men')) stems.push(`${last.slice(0, -3)}man`);
    if (/(?:ch|sh|x|ss|z)es$/.test(lower)) stems.push(last.slice(0, -2));
    if (lower.endsWith('s') && !lower.endsWith('ss')) stems.push(last.slice(0, -1));
    return stems.map(stem => [...words.slice(0, -1), stem].join(' '));
}

const titleCase = text => (text === text.toLowerCase() ? text.replace(/\b[a-z]/g, letter => letter.toUpperCase()) : text);

/**
 * The name a row gets: the bestiary's own spelling when it is a creature (also for a plural,
 * "3 bandits" → Bandit), the written singular of an alias, the singular when the last word
 * is the plural of a creature word the templates know ("3 bog wights" → Bog Wight, so the
 * creature made up for it is not called a plural), or the name as written.
 */
function rowName(name, bestiary) {
    const candidates = [name, ...singulars(name)];
    for (const candidate of candidates) {
        const creature = findCreature(bestiary, candidate, { close: false });
        if (creature) return nameMatch(creature.name, candidate) ? creature.name : titleCase(candidate);
    }
    // A differently worded creature ("young wolves" → Wolf) keeps the story's words, singular.
    for (const candidate of [...candidates].reverse()) {
        if (findCreature(bestiary, candidate)) return titleCase(candidate);
    }
    const words = name.split(' ');
    const singular = creatureSingular(words.at(-1));
    if (singular) return titleCase([...words.slice(0, -1), words.at(-1).toLowerCase() === words.at(-1) ? singular : singular.replace(/^[a-z]/, letter => letter.toUpperCase())].join(' '));
    return titleCase(name);
}

/** One comma-separated group of an encounter: a row, or null. */
function parseGroup(raw, bestiary, rules) {
    let text = clean(stripBullet(raw)).replace(/[.!]+$/, '').trim();
    if (!text || isTagLine(text)) return null;
    let boss = false;
    let rank = null;
    let role = null;
    let level = null;
    let threat = null;
    // "(boss)", "(boss, rank D)", "[caster]", "(Soul Class II)": what is in brackets is about the
    // row, not its name. A power in the reader's terms (or "level 12", "Lv 12") needs its name
    // written, so a stray numeral is not taken for one.
    text = text.replace(/[([]([^)\]]*)[)\]]/g, (_, inside) => {
        for (const part of inside.split(/[,;/]/)) {
            // "rank D" stays an F–SSS rank, even in a world whose levels are called "Rank".
            if (/^\s*rank\s+(?:sss|ss|s|a|b|c|d|e|f)\s*$/i.test(part)) continue;
            const found = parseLevelLabel(part, rules, { strict: true });
            if (found !== null && level === null) level = found;
        }
        const words = inside.toLowerCase().split(/[\s,;/]+/).filter(Boolean);
        words.forEach((word, index) => {
            if (word === 'boss') boss = true;
            else if (ROLES.includes(word)) role = word;
            else if (THREAT_WORDS[word] && !threat) threat = THREAT_WORDS[word];
            else if (word === 'rank' && RANKS.includes(words[index + 1]?.toUpperCase())) rank = words[index + 1].toUpperCase();
        });
        return ' ';
    }).replace(/\s+/g, ' ').trim();
    // A colon never belongs in a name: "inside the den: old dog wolf", "round 3: 2 wolf" (a
    // place or a note the stage marks did not take) leave only what follows it.
    text = text.replace(/^.*:\s*/, '').trim();
    text = text.replace(/\brank\s+(sss|ss|s|a|b|c|d|e|f)\b/i, (_, value) => {
        rank = value.toUpperCase();
        return ' ';
    }).replace(/\s+/g, ' ').trim();
    let count = 1;
    const leading = text.match(/^(\d+)\s*(?:×\s*|[x*]\s+)?(.+)$/i);
    const trailing = text.match(/^(.+?)\s*[×x*]\s*(\d+)$/i);
    const worded = text.match(/^(?:a\s+)?(an?|one|two|three|four|five|six|seven|eight|nine|ten|several|few|pair|couple)\s+(?:of\s+)?(.+)$/i);
    if (leading) [count, text] = [Number(leading[1]), leading[2]];
    else if (trailing) [count, text] = [Number(trailing[2]), trailing[1]];
    else if (worded) [count, text] = [NUMBER_WORDS[worded[1].toLowerCase()], worded[2]];
    text = text.replace(/^the\s+/i, '').trim();
    // "3 weak marsh wolves": a threat word before the name, unless the whole name is a creature.
    const lead = text.match(/^(\S+)\s+(.+)$/);
    if (lead && LEADING_THREATS.has(lead[1].toLowerCase()) && !findCreature(bestiary, text)) {
        threat = threat ?? THREAT_WORDS[lead[1].toLowerCase()];
        text = lead[2];
    }
    // A role written last ("bandit caster"); a name that is only a role word stays a name.
    const words = text.split(' ');
    if (words.length > 1 && ROLES.includes(words.at(-1).toLowerCase())) {
        role = words.at(-1).toLowerCase();
        text = words.slice(0, -1).join(' ');
    }
    if (!text || NOTHING.test(text.toLowerCase())) return null;
    const row = {
        name: rowName(text, bestiary),
        count: Math.min(MAX_COUNT, Math.max(1, Math.round(count) || 1)),
        rank,
        role,
        boss,
    };
    if (level !== null) row.level = level;
    // A power written outright is the power; the threat word only stands in for a missing one.
    else if (threat && !rank) row.threat = threat;
    return row;
}

// A plan (0.5): a place after "then" and before a colon starts the next stage, a separate
// fight somewhere else: "then at the yard:", "then inside the den:", "then across the ford:",
// "then the tower:" (also "then, …" and "and then …", any case). Models write any place phrase,
// so the rule is the shape, not the preposition: a prefix of one to MAX_PLACE_WORDS words with
// no digit. A leading "at" is dropped from the name ("the yard"); any other word stays ("inside
// the den"). The same prefix before the first group names stage 1. A plain "then:" stays a wave
// of the same stage, and so does a "then …:" whose prefix cannot be a place (a digit, too long).
const STAGE_MARK = /(?<![^\s,;])(?:and\s+)?then\b\s*,?\s*([^:;,\n()[\]]*?)\s*:/gi;
const FIRST_PLACE = /^[\s,;]*(?:[-*•]\s*)?([^:;,\n()[\]]+?)\s*:\s*/;
const MAX_PLACE_WORDS = 6;
// A plan of more fights than this is cut there: each stage is a whole fight to play.
const MAX_STAGES = 5;
const MAX_PLACE = 40;

const tidyPlace = text => clean(text).replace(/^[\s"'“”‘’]+|[\s"'“”‘’:,.;]+$/g, '').slice(0, MAX_PLACE).trim() || null;
/** Whether a prefix before a colon can be a place: some words, not too many, no digit. */
function isPlace(prefix) {
    const words = clean(prefix).split(' ').filter(Boolean);
    return words.length >= 1 && words.length <= MAX_PLACE_WORDS && !/\d/.test(prefix);
}
/** The place a prefix names: "at the gate" → "the gate"; "inside the den" as written. */
const placeOf = prefix => tidyPlace(clean(prefix).replace(/^at\s+/i, ''));
// A stage's own words for the reader ("3 guard (even)"): its groups, separators tidied.
const stageWords = text => clean(String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('; '))
    .replace(/^(?:[\s,;]|and\b|&|\+)+|(?:[\s,;]|\band|&|\+)+$/gi, '').trim();

/** The foes-only text cut at its stage marks: [{ place, text }], stage 1 first. */
function stageTexts(text) {
    const foes = foesOnly(text);
    const parts = [];
    let start = 0;
    let place = null;
    for (const mark of foes.matchAll(STAGE_MARK)) {
        // "then:" or "then round 3:": a wave of this stage (the prefix is dropped with the rest).
        if (!isPlace(mark[1])) continue;
        parts.push({ place, text: foes.slice(start, mark.index) });
        place = placeOf(mark[1]);
        start = mark.index + mark[0].length;
    }
    parts.push({ place, text: foes.slice(start) });
    const first = parts[0].text.match(FIRST_PLACE);
    if (first && isPlace(first[1])) parts[0] = { place: placeOf(first[1]), text: parts[0].text.slice(first[0].length) };
    return parts;
}

/** One stage's groups as rows, `wave` counted within the stage. */
function stageRows(text, bestiary, rules) {
    const rows = [];
    // "(boss, rank D)" is one group's note, so separators inside brackets are kept for it.
    const guarded = String(text ?? '').replace(/[([][^)\]]*[)\]]/g, inside => inside.replace(/[,;]/g, '\u0001'));
    let wave = 0;
    for (const raw of guarded.split(/\r?\n|[,;]|\s+(?:and|&|\+)\s+/i)) {
        // "then:" starts the next engagement, fought straight after this one.
        let group = raw;
        const then = group.match(/^\s*(?:[-*•]\s*)?(?:and\s+)?then\b\s*:?\s*/i);
        if (then) {
            wave = Math.min(MAX_WAVES, wave + 1);
            group = group.slice(then[0].length);
        }
        const row = parseGroup(group.replace(/\u0001/g, ','), bestiary ?? DEFAULT_BESTIARY, rules ?? DEFAULT_RULES);
        if (row && wave) row.wave = wave;
        if (row) rows.push(row);
    }
    return rows;
}

/**
 * An encounter as its stages (0.5): [{ place, text, rows }], one per stage with foes, in order.
 * Without stage marks there is one stage (place null unless "at <place>:" opens the text),
 * its rows exactly as parseEncounter gives them. With two or more, each is a separate fight of
 * a plan, somewhere else ("at the gate: 2 guard; then at the yard: 3 guard"), and every row
 * carries `stage` (1, 2, …, at most MAX_STAGES); its `wave` counts within its stage. `text` is
 * the stage's own words, for the reader. A stage that names no foe is left out.
 */
export function parsePlan(text, bestiary = DEFAULT_BESTIARY, rules = DEFAULT_RULES) {
    const stages = stageTexts(text)
        .map(part => ({ place: part.place, text: stageWords(part.text), rows: stageRows(part.text, bestiary, rules) }))
        .filter(stage => stage.rows.length)
        .slice(0, MAX_STAGES);
    if (stages.length > 1) stages.forEach((stage, index) => stage.rows.forEach(row => { row.stage = index + 1; }));
    return stages;
}

/**
 * An encounter as setup rows: "3 bandit, bandit captain (boss)" → [{ name: 'Bandit', count: 3,
 * rank: null, role: null, boss: false }, { name: 'Bandit Captain', count: 1, …, boss: true }].
 * Groups are separated by commas, semicolons, new lines or "and"; each is
 * `[N ×|N x|N ]name[ (boss)][ rank X][ role]` (also "a"/"two"… and "name ×3"). A plural is
 * made singular when the singular is a bestiary creature; rank and role only when written.
 * A power written in brackets in the reader's terms ("3 wolf (Soul Class I)", "bandit captain
 * (boss, Soul Class II)", "(level 12)") adds `level` to the row (only then). A threat word in
 * brackets or before the name ("(weak)", "(boss, strong)", "3 deadly wyverns") adds `threat`
 * ('trivial' | 'weak' | 'even' | 'strong' | 'deadly'), only when no rank or level is written.
 * `then:` before a group starts the next engagement ("3 bandit; then: bandit captain (boss)"):
 * its rows and the ones after carry `wave` (1, 2, at most 3), fought back to back. What follows
 * a bar on a line is the fight's, not a foe (parseStakes). (0.5) `then at <place>:` starts the
 * next stage of a plan: the rows carry `stage` (parsePlan has the places).
 */
export function parseEncounter(text, bestiary = DEFAULT_BESTIARY, rules = DEFAULT_RULES) {
    return parsePlan(text, bestiary, rules).flatMap(stage => stage.rows);
}

/** A place for a sentence: "the gate", or "here" for a stage the story did not name. */
export function placeName(place) {
    return String(place ?? '').trim() || 'here';
}

/**
 * What the story's fight says, for the offer line: each line without its `| …` notes (the
 * stakes are shown on their own); (0.5) a plan as "A plan in 3 stages: the gate, the yard,
 * the tower".
 */
export function encounterSummary(text) {
    const stages = parsePlan(text);
    if (stages.length > 1) return `A plan in ${stages.length} stages: ${stages.map(stage => placeName(stage.place)).join(', ')}`;
    return String(text ?? '').split(/\r?\n/).map(line => line.split('|')[0].trim()).filter(Boolean).join('; ');
}

/**
 * An encounter's stakes, from the story: 'death' when a line ends with `| to the death` (also
 * `| death`, `| stakes: death`, any case), else 'normal' (defeat means the story decides). A
 * plan's stakes are the whole plan's.
 */
export function parseStakes(text) {
    const notes = String(text ?? '').split(/\r?\n/).flatMap(line => line.split('|').slice(1));
    return notes.some(note => DEATH_MARK.test(note)) ? 'death' : 'normal';
}

/**
 * The fight to build, from the offer Fight? opened ({ rows, stakes, stages? }, parsed from the
 * story), never from what the Battle tab sends: { rows, stakes } as copies, stakes 'death' or
 * 'normal'. Without a story's rows it refuses, since fights come from the story. (0.5) Rows
 * of two or more stages (`stage`) are a plan: `stages: [{ place, text, rows }]` in order, the
 * places and words from the offer's `stages` ([{ place, text }], by stage number).
 */
export function storyFight(offer) {
    const rows = (Array.isArray(offer?.rows) ? offer.rows : []).filter(row => row && String(row.name ?? '').trim());
    if (!rows.length) throw new Error('Fights come from the story: fight one it offers.');
    const fight = { rows: rows.map(row => ({ ...row })), stakes: offer.stakes === 'death' ? 'death' : 'normal' };
    const numbers = [...new Set(fight.rows.map(row => Number(row.stage)).filter(value => Number.isInteger(value) && value >= 1))].sort((a, b) => a - b);
    if (numbers.length < 2 || fight.rows.some(row => !(Number(row.stage) >= 1))) return fight;
    const meta = Array.isArray(offer.stages) ? offer.stages : [];
    fight.stages = numbers.map(number => ({
        place: tidyPlace(meta[number - 1]?.place ?? '') ?? null,
        text: String(meta[number - 1]?.text ?? '').trim(),
        rows: fight.rows.filter(row => Number(row.stage) === number),
    }));
    return fight;
}

/**
 * The level a threat word means for a party of `partyLevel`: the party's level plus the word's
 * offset (rules.threat.offsets) in steps, a step being one tier with tier titles on, else
 * rules.threat.step levels; within 1 and the level cap. Null for an unknown word.
 */
export function threatLevel(threat, partyLevel, rules = DEFAULT_RULES) {
    const t = rules?.threat ?? DEFAULT_RULES.threat;
    const offset = Number(t.offsets?.[threat]);
    if (!Number.isFinite(offset)) return null;
    const terms = termsOf(rules);
    const step = terms.tiers ? terms.tiers.size : Math.max(1, Number(t.step) || DEFAULT_RULES.threat.step);
    const base = Math.max(1, Math.round(Number(partyLevel) || 1));
    return Math.min(terms.cap, Math.max(1, Math.round(base + offset * step)));
}

/**
 * Encounter rows with each threat turned into a level for this party (the row keeps its
 * `threat`, for the reader); rows with a rank or level of their own, or no threat, unchanged.
 */
export function resolveThreats(rows, partyLevel, rules = DEFAULT_RULES) {
    return (rows ?? []).map(row => {
        if (!row?.threat || Number(row.level) >= 1 || row.rank) return row;
        const level = threatLevel(row.threat, partyLevel, rules);
        return level === null ? row : { ...row, level };
    });
}

// ---------------------------------------------------------------------------
// The party's story (0.4): who joins or leaves, what someone learns, an achievement, a rest.
// Each line becomes an offer the reader accepts or not (index.js); nothing here applies it.

const SKILL_TYPES = ['physical', 'magic', 'heal', 'buff', 'debuff'];
const SKILL_TARGETS = ['one', 'all', 'self', 'ally', 'allies'];
// What a skill's words or an `effect:` hint name, as the template's element (skills.ELEMENTS).
const EFFECT_ELEMENTS = [
    [/\b(?:fire|flames?|burn(?:s|ing)?|blaze|ember|inferno)\b/, 'fire'],
    [/\b(?:ice|icy|frost|cold|freez\w*|slow(?:s|ing)?|chill\w*)\b/, 'ice'],
    [/\b(?:lightning|thunder\w*|shock\w*|storm|stun(?:s|ning)?|daze\w*)\b/, 'lightning'],
    [/\b(?:poison\w*|venom\w*|toxic|toxin)\b/, 'poison'],
];
const XP_KINDS = ['minor', 'major', 'milestone'];
const MAX_ROLE = 30;
const MAX_SKILL_NAME = 40;
const MAX_WORDS = 120;
const HINT_KEYS = /\b(type|stat|target|effect|element|focus|level|skills?|role)\s*:/gi;

const lineList = text => String(text ?? '').split(/\r?\n/).map(raw => clean(stripBullet(raw))).filter(line => line && !isTagLine(line));
const splitDash = line => line.match(/^(.+?)\s*(?:[—–]|--|\s-)\s*(.+)$/);
const tidyName = (text, max = 40) => clean(text).replace(/^[\s"'“”‘’]+|[\s"'“”‘’:,.]+$/g, '').slice(0, max).trim();

/**
 * Optional hints after a bar: "type: physical, stat: AGI, target: one, effect: stun",
 * "focus: INT, VIT", "level: 3", "skills: Frost Lance, Mend". Only known keys and, for type,
 * stat, target and effect, known words; anything else is dropped.
 * { type?, stat?, target?, element?, focus?: [stats], level?: number, skills?: [names], role? }
 */
export function parseHints(text) {
    const source = clean(text).replace(/\|/g, ',');
    const marks = [...source.matchAll(HINT_KEYS)];
    const hints = {};
    marks.forEach((mark, index) => {
        const key = mark[1].toLowerCase();
        const value = source.slice(mark.index + mark[0].length, marks[index + 1]?.index ?? source.length).replace(/^[\s,;]+|[\s,;.]+$/g, '');
        const words = value.split(/[\s,;/]+/).filter(Boolean);
        if (key === 'type') {
            const type = words.map(word => word.toLowerCase()).find(word => SKILL_TYPES.includes(word));
            if (type) hints.type = type;
        } else if (key === 'stat') {
            const stat = words.map(word => word.toUpperCase()).find(word => STATS.includes(word));
            if (stat) hints.stat = stat;
        } else if (key === 'target') {
            const target = words.map(word => word.toLowerCase()).find(word => SKILL_TARGETS.includes(word));
            if (target) hints.target = target;
        } else if (key === 'effect' || key === 'element') {
            const element = EFFECT_ELEMENTS.find(([pattern]) => pattern.test(value.toLowerCase()))?.[1];
            if (element) hints.element = element;
        } else if (key === 'focus') {
            const focus = [...new Set(words.map(word => word.toUpperCase()).filter(word => STATS.includes(word)))].slice(0, 3);
            if (focus.length) hints.focus = focus;
        } else if (key === 'level') {
            const level = Number(value.match(/\d+/)?.[0]);
            if (level >= 1) hints.level = level;
        } else if (key === 'skills' || key === 'skill') {
            const skills = value.split(/\s*[,;]\s*/).map(name => tidyName(name, MAX_SKILL_NAME)).filter(Boolean).slice(0, 3);
            if (skills.length) hints.skills = skills;
        } else if (key === 'role') {
            const role = tidyName(value, MAX_ROLE);
            if (role) hints.role = role;
        }
    });
    return hints;
}

/** "head | hints" → [head, hints]: the first bar starts the hints. */
function withHints(line) {
    const at = line.indexOf('|');
    return at < 0 ? [line, {}] : [line.slice(0, at).trim(), parseHints(line.slice(at + 1))];
}

/**
 * <Joins> lines: `Lyra — healer, level 6 | focus: INT, VIT | skills: Frost Lance, Mend` →
 * [{ name, role, level: number | null, focus: [stats], skills: [names], line }]. The level may be
 * written in the reader's terms ("Soul Class II"), as "level 6", "Lv 6" or a bare number; the
 * hints' level and focus win; the role is whatever else follows the name. Never throws.
 */
export function parseJoins(text, rules = DEFAULT_RULES) {
    const out = [];
    for (const line of lineList(text)) {
        const [head, hints] = withHints(line);
        const parts = splitDash(head);
        const name = tidyName(parts ? parts[1] : head.split(/[,:]/)[0]);
        if (!name || NOTHING.test(name.toLowerCase())) continue;
        let level = null;
        const role = [];
        for (const part of (parts ? parts[2] : head.slice(head.split(/[,:]/)[0].length)).split(/\s*[,;:]\s*/).map(clean).filter(Boolean)) {
            const written = parseLevelLabel(part, rules, { strict: true }) ?? (/^(?:lv\.?|level)?\s*\d+$/i.test(part) ? Number(part.match(/\d+/)[0]) : null);
            if (written !== null && level === null) level = written;
            else role.push(part);
        }
        const cap = maxLevel(rules);
        const pick = hints.level ?? level;
        out.push({
            name,
            role: tidyName(hints.role ?? role.join(', '), MAX_ROLE),
            level: pick ? Math.min(cap, Math.max(1, Math.round(pick))) : null,
            focus: hints.focus ?? [],
            skills: hints.skills ?? [],
            line,
        });
    }
    return out;
}

/** <Leaves> lines: `Lyra: returned to her village` (or a dash) → [{ name, reason, line }]. */
export function parseLeaves(text) {
    const out = [];
    for (const line of lineList(text)) {
        const colon = line.indexOf(':');
        const dash = splitDash(line);
        const [name, reason] = colon >= 0 && (!dash || colon < dash[1].length) ? [line.slice(0, colon), line.slice(colon + 1)] : dash ? [dash[1], dash[2]] : [line, ''];
        const who = tidyName(name);
        if (who && !NOTHING.test(who.toLowerCase())) out.push({ name: who, reason: tidyCause(reason), line });
    }
    return out;
}

/**
 * <Learned> lines: `Lyra — Frost Lance: ice magic, hits all | type: magic, stat: INT` (or
 * `You — …`) → [{ name, skill, words, hints, line }]. The hints are parseHints'.
 */
export function parseLearned(text) {
    const out = [];
    for (const line of lineList(text)) {
        const [head, hints] = withHints(line);
        const parts = splitDash(head);
        if (!parts) continue;
        const colon = parts[2].indexOf(':');
        const skill = tidyName(colon >= 0 ? parts[2].slice(0, colon) : parts[2], MAX_SKILL_NAME);
        const name = tidyName(parts[1]);
        if (!name || !skill) continue;
        out.push({ name, skill, words: colon >= 0 ? clean(parts[2].slice(colon + 1)).slice(0, MAX_WORDS) : '', hints, line });
    }
    return out;
}

/**
 * A story-taught skill's template guessed from its words, the hints first: { type, stat,
 * target, element } (element 'none' or one of skills.ELEMENTS). Heal, guard and curse words set
 * the type, magic and element words make it magic, "all", "every", "area" a wide target; code
 * still sets every number (skills.skillFromTemplate).
 */
export function guessSkill(words, hints = {}) {
    const text = ` ${clean(words).toLowerCase()} ${clean(hints.name ?? '').toLowerCase()} `;
    const has = pattern => pattern.test(text);
    let type = hints.type;
    if (!type) {
        if (has(/\b(?:heal\w*|mend\w*|cure\w*|restor\w*|revive\w*|regenerat\w*|soothe\w*)\b/)) type = 'heal';
        else if (has(/\b(?:shield\w*|ward\w*|guard\w*|protect\w*|bless\w*|barrier|haste|inspir\w*|fortif\w*|buff)\b/)) type = 'buff';
        else if (has(/\b(?:curse\w*|hex\w*|weaken\w*|debuff|fear|terrif\w*|intimidat\w*|blind\w*)\b/)) type = 'debuff';
        else if (has(/\b(?:magic\w*|spell|arcane|fire|flames?|ice|frost|lightning|thunder|shadow|holy|light|dark|psychic)\b/)) type = 'magic';
        else type = 'physical';
    }
    const element = hints.element ?? (type === 'physical' || type === 'magic' ? EFFECT_ELEMENTS.find(([pattern]) => has(pattern))?.[1] ?? 'none' : 'none');
    const wide = has(/\b(?:all|every\w*|area|wave|sweep\w*|whole|crowd|enemies|foes|party|allies)\b/);
    let target = hints.target;
    if (!target) {
        if (type === 'heal') target = wide ? 'allies' : has(/\b(?:self|own|oneself|herself|himself|themselves)\b/) ? 'self' : 'ally';
        else if (type === 'buff') target = wide ? 'allies' : has(/\b(?:ally|friend|another|other)\b/) ? 'ally' : 'self';
        else target = wide ? 'all' : 'one';
    }
    let stat = hints.stat;
    if (!stat) {
        if (type === 'physical') stat = has(/\b(?:arrow\w*|shot|shoot\w*|bow|throw\w*|dagger\w*|knife|knives|quick|dash\w*|precise|aim\w*|stealth\w*|backstab)\b/) ? 'DEX' : 'STR';
        else stat = 'INT';
    }
    return { type, stat, target, element };
}

/** <XP> lines: `major: rescued the caravan` → [{ kind: 'minor' | 'major' | 'milestone', reason, line }]. */
export function parseXp(text) {
    const out = [];
    for (const line of lineList(text)) {
        const match = line.match(/^(minor|major|milestone)\b\s*[:—–-]?\s*(.*)$/i);
        if (match && XP_KINDS.includes(match[1].toLowerCase())) out.push({ kind: match[1].toLowerCase(), reason: tidyCause(match[2]), line });
    }
    return out;
}

/** <Rest> lines: `long: slept at the inn` → [{ kind: 'short' | 'long', reason, line }] (the first counts). */
export function parseRest(text) {
    for (const line of lineList(text)) {
        const match = line.match(/^(short|long)\b(?:\s+rest)?\s*[:—–-]?\s*(.*)$/i);
        if (match) return [{ kind: match[1].toLowerCase(), reason: tidyCause(match[2]), line }];
    }
    return [];
}

/** "You", "me", "myself" (and the like) in a line: your character, whatever they are called. */
export function meansYou(name) {
    return /^(?:you|me|myself|yourself|the player|player|pc)$/i.test(clean(name));
}
