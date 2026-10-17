// The story's side of the numbers: wounds the story deals outside a fight, and the fights it
// starts (DESIGN §8.6, §4.2).
//
// A fight in RPG Battle is resolved in code, but the story also hurts people between fights: a
// fall into a ravine, a poisoned cup, a healer's poultice. Left alone, the sheet says "unhurt"
// while the prose says "bleeding", and the State line then tells the model to portray the
// wrong thing. So the model may add a hidden <Wounds> block naming who was hurt and how badly
// in a few fixed words, and code turns the words into HP with a share of max HP per word
// (rules.wounds). The model never writes a number. Likewise a fight the story starts is named
// in an <Encounter> block ("3 bandit, bandit captain (boss)"), parsed here into setup rows the
// reader confirms. Both parsers are lenient, because they read what a model wrote. Pure.

import { DEFAULT_RULES, RANKS } from './rules.js';
import { DEFAULT_BESTIARY, findCreature } from './enemies.js';

/**
 * What the model is told every reply while a Character block exists (index.js injects it at
 * depth 1, apart from the fight hand-off). It is paid for on every reply, so it stays near 90
 * tokens (tests/story.test.js holds it there): the two tags, their grammar by example, and
 * the one judgement call, which word. "Stop at the first blow" leaves the fight itself to RPG
 * Battle, so the prose does not resolve what the buttons are about to.
 */
export const STORY_INSTRUCTION = 'If the story (not an RPG Battle fight) hurts or heals someone on the Character or Party sheet, add <Wounds>, a line each: Name — scratch|wound|severe|grievous: cause (or heal wound, or poisoned). Mildest fitting word; severe/grievous only for crippling blows. If a fight starts, add <Encounter>3 bandit, bandit captain (boss)</Encounter> and stop at the first blow.';

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

/** The person a written name means: the full name first, then the first name; the Character before the Party. */
function findTarget(targets, name) {
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

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, several: 3, few: 3, pair: 2, couple: 2 };
const MAX_COUNT = 9;
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
 * "3 bandits" → Bandit), the written singular of an alias, or the name as written.
 */
function rowName(name, bestiary) {
    for (const candidate of [name, ...singulars(name)]) {
        const creature = findCreature(bestiary, candidate);
        if (creature) return nameMatch(creature.name, candidate) ? creature.name : titleCase(candidate);
    }
    return titleCase(name);
}

/** One comma-separated group of an encounter: a row, or null. */
function parseGroup(raw, bestiary) {
    let text = clean(stripBullet(raw)).replace(/[.!]+$/, '').trim();
    if (!text || isTagLine(text)) return null;
    let boss = false;
    let rank = null;
    let role = null;
    // "(boss)", "(boss, rank D)", "[caster]": what is in brackets is about the row, not its name.
    text = text.replace(/[([]([^)\]]*)[)\]]/g, (_, inside) => {
        const words = inside.toLowerCase().split(/[\s,;/]+/).filter(Boolean);
        words.forEach((word, index) => {
            if (word === 'boss') boss = true;
            else if (ROLES.includes(word)) role = word;
            else if (word === 'rank' && RANKS.includes(words[index + 1]?.toUpperCase())) rank = words[index + 1].toUpperCase();
        });
        return ' ';
    }).replace(/\s+/g, ' ').trim();
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
    // A role written last ("bandit caster"); a name that is only a role word stays a name.
    const words = text.split(' ');
    if (words.length > 1 && ROLES.includes(words.at(-1).toLowerCase())) {
        role = words.at(-1).toLowerCase();
        text = words.slice(0, -1).join(' ');
    }
    if (!text || NOTHING.test(text.toLowerCase())) return null;
    return {
        name: rowName(text, bestiary),
        count: Math.min(MAX_COUNT, Math.max(1, Math.round(count) || 1)),
        rank,
        role,
        boss,
    };
}

/**
 * An encounter as setup rows: "3 bandit, bandit captain (boss)" → [{ name: 'Bandit', count: 3,
 * rank: null, role: null, boss: false }, { name: 'Bandit Captain', count: 1, …, boss: true }].
 * Groups are separated by commas, semicolons, new lines or "and"; each is
 * `[N ×|N x|N ]name[ (boss)][ rank X][ role]` (also "a"/"two"… and "name ×3"). A plural is
 * made singular when the singular is a bestiary creature; rank and role only when written.
 */
export function parseEncounter(text, bestiary = DEFAULT_BESTIARY) {
    const rows = [];
    // "(boss, rank D)" is one group's note, so separators inside brackets are kept for it.
    const guarded = String(text ?? '').replace(/[([][^)\]]*[)\]]/g, inside => inside.replace(/[,;]/g, '\u0001'));
    for (const group of guarded.split(/\r?\n|[,;]|\s+(?:and|&|\+)\s+/i)) {
        const row = parseGroup(group.replace(/\u0001/g, ','), bestiary ?? DEFAULT_BESTIARY);
        if (row) rows.push(row);
    }
    return rows;
}
