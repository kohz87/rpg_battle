// Pure pieces the checks part shares (MODULES §F16): the domain's limits and validator, the
// automatic stat modifier (v1 rules.checkModifier on the actor's base stats, as v1's Checks
// line), the words a check and a skill, ability or item have in common (for suggestions), and
// the plain-words text of a check and its modifiers. The difficulty words, the stat a skill word
// means and the outcome rule are the party part's pure check helpers (party/checks.js), used as
// they are so both ways of rolling read a check alike.

import { DEFAULT_RULES, STATS, checkModifier } from '../../rules.js';
import { OUTCOMES } from '../party/checks.js';

export const MAX_LOG = 30;
export const MAX_PENDING = 20;
export const MAX_EXTRA = 8;                // modifiers the reader may add to one check
export const MOD_MIN = -10;
export const MOD_MAX = 10;
export const SOURCES = Object.freeze(['stat', 'skill', 'ability', 'item', 'custom']);
export const READER_SOURCES = Object.freeze(['skill', 'ability', 'item', 'custom']);
export const OUTCOME_KEYS = Object.freeze(Object.keys(OUTCOMES));

const CHECK_ID = /^ck_[0-9a-z]{8}$/;
const ACTOR_ID = /^ac_[0-9a-z]{8}$/;

export const initialChecks = () => ({ pending: [], log: [] });

const nameKey = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
export { nameKey };

/** Text cut to `max` characters on one line. */
export const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The automatic modifier of `stat` for an actor record (base stats; an unknown stat counts as the start value). */
export function statModifier(actor, stat, rules = DEFAULT_RULES) {
    const value = actor?.stats?.[stat];
    return checkModifier(Number.isFinite(value) ? value : rules.character.startStat, rules);
}

export const sumOf = modifiers => (modifiers ?? []).reduce((sum, entry) => sum + entry.amount, 0);

/** "+ 3" / "− 2" for a summary's sum. */
export const signed = amount => (amount < 0 ? `− ${-amount}` : `+ ${amount}`);

/** "+3" / "−2" for a short list. */
export const short = amount => (amount < 0 ? `−${-amount}` : `+${amount}`);

/** "DEX +3, Shadow Step +2" */
export const modifierList = modifiers => (modifiers ?? []).map(entry => `${entry.reason} ${short(entry.amount)}`).join(', ');

/** "stealth (slipping past the guard)" */
export const attemptText = check => `${check.skill || check.stat}${check.what ? ` (${check.what})` : ''}`;

/** "20 (hard)" */
export const dcText = check => `${check.dc}${check.word ? ` (${check.word})` : ''}`;

// ---------------------------------------------------------------------------------------
// Words in common (checks.suggest)

const STOP = new Set(('the and for with from into onto over under past through that this then than was were are '
    + 'his her its their your you our out off not but who what when where how why all any one two some '
    + 'try tries trying attempt attempts get gets make makes made use uses using can could would should '
    + 'has have had him them they she him upon about while very more most just also only own').split(' '));

/** A word's plain stem: lower case, a few English endings off ("slipping" → "slip", "guards" → "guard"). */
export function stem(word) {
    let w = word.toLowerCase();
    for (const end of ['ing', 'ed', 'es', 's', 'ly', 'er']) {
        if (w.length - end.length >= 3 && w.endsWith(end)) {
            w = w.slice(0, -end.length);
            break;
        }
    }
    if (w.length >= 4 && w.at(-1) === w.at(-2)) w = w.slice(0, -1);   // "slipp" → "slip"
    return w;
}

/** The stems of a text's words of three letters or more, stop words left out. */
export function stems(...texts) {
    const out = new Set();
    for (const text of texts) {
        for (const word of String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
            if (word.length < 3 || STOP.has(word)) continue;
            out.add(stem(word));
        }
    }
    return out;
}

/** The stems two sets share, sorted. */
export const shared = (a, b) => [...a].filter(word => b.has(word)).sort();

// ---------------------------------------------------------------------------------------
// Validator (SPEC §2.5)

function int(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

function str(value, max, { empty = true } = {}) {
    return typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0);
}

function checkModifiers(list, where, errors) {
    if (!Array.isArray(list)) return errors.push(`${where}: modifiers must be a list.`);
    if (list.length > MAX_EXTRA + 1) errors.push(`${where}: at most ${MAX_EXTRA + 1} modifiers.`);
    list.forEach((entry, index) => {
        const at = `${where}, modifier ${index + 1}`;
        if (!entry || typeof entry !== 'object') return errors.push(`${at} is not a record.`);
        if (!SOURCES.includes(entry.source)) errors.push(`${at}: the source is stat, skill, ability, item or custom.`);
        const [min, max] = entry.source === 'stat' ? [-20, 20] : [MOD_MIN, MOD_MAX];
        if (!int(entry.amount, min, max)) errors.push(`${at}: the amount must be a whole number from ${min} to ${max}.`);
        if (!str(entry.reason, 60, { empty: false })) errors.push(`${at}: a reason of up to 60 characters is needed.`);
    });
}

function checkRecord(record, where, errors) {
    if (!record || typeof record !== 'object') return errors.push(`${where} is not a record.`);
    if (!CHECK_ID.test(String(record.id))) errors.push(`${where}: the id is not a check id.`);
    if (!ACTOR_ID.test(String(record.actor))) errors.push(`${where}: the actor is not an actor id.`);
    if (!str(record.skill, 40)) errors.push(`${where}: the skill must be text of up to 40 characters.`);
    if (!STATS.includes(record.stat)) errors.push(`${where}: ${record.stat} is not a stat.`);
    if (!int(record.dc, 1, 40)) errors.push(`${where}: the difficulty must be a whole number from 1 to 40.`);
    if (!str(record.word ?? '', 20)) errors.push(`${where}: the difficulty word is too long.`);
    if (!str(record.what, 120)) errors.push(`${where}: what is attempted must be text of up to 120 characters.`);
    if (!int(record.rev, 0, Number.MAX_SAFE_INTEGER)) errors.push(`${where}: the rev must be a whole number.`);
}

/** validate(slice) → string[] for the `checks` domain. */
export function validateChecks(slice) {
    const errors = [];
    if (!slice || typeof slice !== 'object') return ['The checks are missing.'];
    if (!Array.isArray(slice.pending)) errors.push('The pending checks must be a list.');
    if (!Array.isArray(slice.log)) errors.push('The check log must be a list.');
    if (errors.length) return errors;
    if (slice.pending.length > MAX_PENDING) errors.push(`At most ${MAX_PENDING} checks can wait at once.`);
    if (slice.log.length > MAX_LOG) errors.push(`The check log keeps the last ${MAX_LOG} results only.`);
    const ids = new Set();
    slice.pending.forEach((record, index) => {
        const where = `Pending check ${index + 1}`;
        checkRecord(record, where, errors);
        checkModifiers(record?.modifiers, where, errors);
        if (ids.has(record?.id)) errors.push(`${where}: the id is used twice.`);
        ids.add(record?.id);
    });
    slice.log.forEach((entry, index) => {
        const where = `Check result ${index + 1}`;
        checkRecord(entry, where, errors);
        checkModifiers(entry?.modifiers, where, errors);
        if (!int(entry?.die, 1, 20)) errors.push(`${where}: the die must be from 1 to 20.`);
        if (!int(entry?.mod, -200, 200)) errors.push(`${where}: the modifier must be a whole number.`);
        if (!int(entry?.total, -200, 220)) errors.push(`${where}: the total must be a whole number.`);
        if (!OUTCOME_KEYS.includes(entry?.outcome)) errors.push(`${where}: ${entry?.outcome} is not an outcome.`);
    });
    return errors;
}
