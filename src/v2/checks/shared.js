// Pure pieces the checks part shares (MODULES §F80): the domain's limits and validator, the words
// the model may write for a result, and the plain-words text of a check. The difficulty words,
// the stat a skill word means and the outcome rule (a natural 20 always succeeds, a natural 1
// always fails, MODULES §F31) are the party part's pure check helpers (party/checks.js), used as
// they are so every way of rolling reads a check alike.
//
// The `checks` domain:
//   checks = {
//     prepared: { [key]: { for: reply index | null, rolls: [d20, …], rev, actors?: [actor id] } },   // actors: the
//                  check table's members, two dice each in that order (table.js)   // key: the carrier the prepare
//                  landed on (`s:<sid>`, else its "index:swipe", else `rev<n>`)
//     log:      { [check id]: { id, actor, name, skill, stat, dc, word, what, rev, carrier, roll, die,
//                  modifiers, mod, total, outcome, outcomeText, text, said, mismatch, note } },
//   }
// Bookkeeping that later replies write is keyed by the reply (or the check's id), never a list
// position or a field of an entry an earlier reply made (B-b1r2-13, SPEC §2): a reply deleted from
// the middle of the chat takes its own entries with it and every later reply's still apply on
// replay. The oldest are pruned (MAX_LOG results, MAX_PREPARED replies' rolls): Story Block 2.0.0-alpha.2
// passes over the remove of a key that is already gone. The latest reply's checks (its card) are
// read from the log: the entries of the newest carrier.
// Older shapes are accepted and turned into this one by the next checks command: a `prepared` and
// a `log` list, a `last` record (F80 before B-b1r2-13), a `pending` list (before F80).

import { STATS } from '../../rules.js';
import { OUTCOMES } from '../party/checks.js';
import { MAX_ROLLS } from './dice.js';

export const MAX_LOG = 30;
export const MAX_PREPARED = 8;
// What the validator allows (4× the kept number): the writers prune to the kept number, but a
// replay after a middle delete may keep an entry the deleted reply had pruned (its remove is gone
// with it, and a later remove of that reply's own entry is passed over); the next write prunes again.
export const slack = most => most * 4;
/** Up to 2 checks per reply (MODULES §F32); a reply gets as many rolls. */
export const MAX_PER_REPLY = 2;
export const ROLLS_PER_REPLY = MAX_PER_REPLY;
// `module`: another module's say (outside.js, Story Block MODULES §F126).
export const SOURCES = Object.freeze(['stat', 'skill', 'talent', 'item', 'ability', 'custom', 'effect', 'module']);
export const OUTCOME_KEYS = Object.freeze(Object.keys(OUTCOMES));

const CHECK_ID = /^ck_[0-9a-z]{8}$/;
const ACTOR_ID = /^ac_[0-9a-z]{8}$/;

export const initialChecks = () => ({ prepared: {}, log: {} });

const byRev = (a, b) => ((a?.rev ?? 0) - (b?.rev ?? 0)) || (String(a?.id ?? '') < String(b?.id ?? '') ? -1 : String(a?.id ?? '') > String(b?.id ?? '') ? 1 : 0);
const entriesOf = value => (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []);

/** The check results kept, oldest first (by rev; the log as a record, or an older chat's list). */
export const logEntries = checks => entriesOf(checks?.log).filter(entry => entry && typeof entry === 'object').sort(byRev);

/** The rolls kept for replies, oldest first (by rev). */
export const preparedEntries = checks => entriesOf(checks?.prepared).filter(entry => entry && typeof entry === 'object').sort((a, b) => (a.rev ?? 0) - (b.rev ?? 0));

/** The newest reply's checks (its card): its log entries, oldest first, with the reply's key and rev; null when none. */
export function latestChecks(checks) {
    const entries = logEntries(checks);
    const newest = entries.at(-1);
    if (!newest) return null;
    const results = entries.filter(entry => entry.carrier === newest.carrier);
    return { carrier: newest.carrier ?? '', rev: newest.rev, results };
}

export const nameKey = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Text cut to `max` characters on one line. */
export const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const sumOf = modifiers => (modifiers ?? []).reduce((sum, entry) => sum + entry.amount, 0);

/** "+ 3" / "− 2" for a sum. */
export const signed = amount => (amount < 0 ? `− ${-amount}` : `+ ${amount}`);

/** "+3" / "−2" for a short list. */
export const short = amount => (amount < 0 ? `−${-amount}` : `+${amount}`);

/** "DEX +3, Keen Eyes +1" */
export const modifierList = modifiers => (modifiers ?? []).map(entry => `${entry.reason} ${short(entry.amount)}`).join(', ');

/** "stealth (slipping past the guard)" */
export const attemptText = check => `${check.skill || check.stat}${check.what ? ` (${check.what})` : ''}`;

/** "20 (hard)" */
export const dcText = check => `${check.dc}${check.word ? ` (${check.word})` : ''}`;

/** Whether an outcome is a success of some kind (a critical one, a plain one, one at a cost). */
export const passes = outcome => outcome === 'crit' || outcome === 'success' || outcome === 'cost';

/**
 * The outcome the model wrote (`result: success`), read with v1's verdict words: 'crit' |
 * 'success' | 'cost' | 'fail' | 'critfail', or null when it says none of them.
 */
export function saidOutcome(text) {
    const words = String(text ?? '').toLowerCase();
    if (!words.trim()) return null;
    if (/crit\w*\s*(?:fail|failure|miss)|fumble|botch/.test(words)) return 'critfail';
    if (/crit/.test(words)) return 'crit';
    if (/cost|complicat|\bbut\b|however|partial|mixed/.test(words)) return 'cost';
    if (/fail|miss|\bno\b|\bloses?\b/.test(words)) return 'fail';
    if (/succe|pass|works|\byes\b|\bwins?\b/.test(words)) return 'success';
    return null;
}

/** "narrated as success, the dice say fail" when the model's word and the dice differ in kind, else ''. */
export function mismatchOf(said, outcome) {
    if (!said || passes(said) === passes(outcome)) return '';
    return `narrated as ${OUTCOMES[said]}, the dice say ${OUTCOMES[outcome]}`;
}

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
    if (list.length > 12) errors.push(`${where}: at most 12 modifiers.`);
    list.forEach((entry, index) => {
        const at = `${where}, modifier ${index + 1}`;
        if (!entry || typeof entry !== 'object') return errors.push(`${at} is not a record.`);
        if (!SOURCES.includes(entry.source)) errors.push(`${at}: the source is a stat, a skill, a talent or an item.`);
        if (!int(entry.amount, -20, 20)) errors.push(`${at}: the amount must be a whole number from −20 to 20.`);
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

function checkResult(entry, where, errors) {
    checkRecord(entry, where, errors);
    checkModifiers(entry?.modifiers, where, errors);
    if (!int(entry?.die, 1, 20)) errors.push(`${where}: the die must be from 1 to 20.`);
    if (!int(entry?.mod, -200, 200)) errors.push(`${where}: the modifier must be a whole number.`);
    if (!int(entry?.total, -200, 220)) errors.push(`${where}: the total must be a whole number.`);
    if (!OUTCOME_KEYS.includes(entry?.outcome)) errors.push(`${where}: ${entry?.outcome} is not an outcome.`);
    // Fields from F80 on (an older result has none of them).
    if (entry?.carrier !== undefined && !str(entry.carrier, 40)) errors.push(`${where}: the reply key must be short text.`);
    if (entry?.roll !== undefined && !int(entry.roll, 0, MAX_ROLLS)) errors.push(`${where}: the roll is the number of a roll handed over (0: rolled by code).`);
    if (entry?.said !== undefined && entry.said !== null && !OUTCOME_KEYS.includes(entry.said)) errors.push(`${where}: ${entry.said} is not an outcome.`);
    if (entry?.mismatch !== undefined && !str(entry.mismatch, 120)) errors.push(`${where}: the mismatch note is too long.`);
    if (entry?.note !== undefined && !str(entry.note, 160)) errors.push(`${where}: the note is too long.`);
    if (entry?.target !== undefined && !str(entry.target, 60)) errors.push(`${where}: the target is too long.`);
    if (entry?.pre !== undefined && entry.pre !== true) errors.push(`${where}: pre is true or absent.`);
    if (entry?.place !== undefined && !int(entry.place, 1, MAX_PER_REPLY)) errors.push(`${where}: the place is the reply's 1st or 2nd attempt.`);
}

function checkShown(entry, where, errors) {
    if (entry?.name !== undefined && !str(entry.name, 80)) errors.push(`${where}: the name is too long.`);
    if (entry?.text !== undefined && !str(entry.text, 240)) errors.push(`${where}: the text is too long.`);
    if (entry?.outcomeText !== undefined && !str(entry.outcomeText, 40)) errors.push(`${where}: the outcome text is too long.`);
}

function checkLast(last, errors) {
    if (last === undefined || last === null) return;
    if (typeof last !== 'object' || !str(last.carrier, 40) || !int(last.rev, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(last.results)) {
        errors.push('The latest reply\'s checks must be { carrier, rev, results }.');
        return;
    }
    if (last.results.length > MAX_PER_REPLY) errors.push(`A reply has at most ${MAX_PER_REPLY} checks.`);
    last.results.forEach((entry, index) => {
        const where = `Latest check ${index + 1}`;
        if (!entry || typeof entry !== 'object' || !CHECK_ID.test(String(entry.id))) return errors.push(`${where}: not a check result.`);
        if (!str(entry.name, 80) || !str(entry.text, 240) || !OUTCOME_KEYS.includes(entry.outcome) || !str(entry.outcomeText, 40)) errors.push(`${where}: name, text and outcome are needed.`);
        if (!str(entry.mismatch ?? '', 120) || !str(entry.note ?? '', 160)) errors.push(`${where}: a note is too long.`);
    });
}

/** validate(slice) → string[] for the `checks` domain. */
export function validateChecks(slice) {
    const errors = [];
    if (!slice || typeof slice !== 'object') return ['The checks are missing.'];
    const record = value => value && typeof value === 'object';
    if (!record(slice.log)) errors.push('The check log must be a record (or an older chat\'s list).');
    if (slice.prepared !== undefined && !record(slice.prepared)) errors.push('The rolls prepared must be a record (or an older chat\'s list).');
    if (slice.pending !== undefined && !Array.isArray(slice.pending)) errors.push('The old pending checks must be a list.');
    if (errors.length) return errors;
    const legacy = Array.isArray(slice.log);
    const log = Array.isArray(slice.log) ? slice.log : Object.entries(slice.log);
    if (log.length > slack(MAX_LOG)) errors.push(`The check log keeps about the last ${MAX_LOG} results only.`);
    const prepared = Array.isArray(slice.prepared ?? []) ? (slice.prepared ?? []).map((entry, index) => [String(index), entry]) : Object.entries(slice.prepared);
    if (prepared.length > slack(MAX_PREPARED)) errors.push(`About ${MAX_PREPARED} replies' rolls are kept at most.`);
    const indexes = new Set();
    prepared.forEach(([key, entry], index) => {
        const where = `Rolls ${index + 1}`;
        if (!entry || typeof entry !== 'object') return errors.push(`${where} is not a record.`);
        if (!Array.isArray(slice.prepared) && !str(key, 48, { empty: false })) errors.push(`${where}: the reply key must be short text.`);
        if (entry.for !== null && !int(entry.for, 0, Number.MAX_SAFE_INTEGER)) errors.push(`${where}: the reply index must be a whole number or null.`);
        if (Array.isArray(slice.prepared) && indexes.has(entry.for)) errors.push(`${where}: that reply already has its rolls.`);
        indexes.add(entry.for);
        if (!Array.isArray(entry.rolls) || entry.rolls.length > MAX_ROLLS || !entry.rolls.every(die => int(die, 1, 20))) errors.push(`${where}: the rolls must be up to ${MAX_ROLLS} d20s.`);
        if (!int(entry.rev, 0, Number.MAX_SAFE_INTEGER)) errors.push(`${where}: the rev must be a whole number.`);
        if (entry.actors !== undefined && (!Array.isArray(entry.actors) || entry.actors.length * 2 > MAX_ROLLS || !entry.actors.every(id => ACTOR_ID.test(String(id))))) errors.push(`${where}: the table's members must be a short list of actor ids.`);
    });
    const ids = new Set();
    log.forEach((item, index) => {
        const [key, entry] = legacy ? [null, item] : item;
        const where = `Check result ${index + 1}`;
        checkResult(entry, where, errors);
        checkShown(entry, where, errors);
        if (!legacy && key !== entry?.id) errors.push(`${where}: kept under another id.`);
        if (ids.has(entry?.id)) errors.push(`${where}: the id is used twice.`);
        ids.add(entry?.id);
    });
    checkLast(slice.last, errors);
    return errors;
}
