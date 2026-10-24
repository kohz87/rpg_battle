// RPG Battle v2, part **progress**: the `progress` domain, its limits and its validator (contract §4, B5).
//
//   progress = {
//     schema: 2,
//     choices:  { [`<actor>|<milestone>`]: Choice },     // derive.js: the basic class (0), promotions (10…30), paths (40…90)
//     attempts: { [attempt id]: Attempt },                // credit.js: every paid use of a skill, whatever it earned
//     credits:  { [attempt id]: Credit },                 // credit.js: what rules.settle decided for an attempt
//     roster:   { active: ActorId[] | null },             // roster.js: who is active (null: the first three, the PC first)
//     temporary:{ [unit id]: Unit },                      // roster.js: summons and pets of a fight, outside the limit
//   }
//
// Every record is written once under its own key and never changed (SPEC §2.2): a reply deleted from the
// middle of the chat takes exactly its own records with it, and no reply rewrites another's field. There are
// no counters: levels, masteries and caps are derived (derive.js, credit.js) from what survives. The
// validator holds the *shape* of a record, and that a credit belongs to an attempt; whether a choice is still
// earned is the replay guard's question (guard.js), not the validator's.

import { KINDS, REASONS } from './credit.js';
import { int, isActorId, isDefId, isHash, isObject } from '../rules/ids.js';
import { MAX_BATCHES, isBatchId } from '../fight/batch.js';

/** The most attempts the ledger holds at once (fold.js keeps it far below; a payer past it drops the attempt, it never fails). */
export const MAX_ATTEMPTS = 4000;
export const PROGRESS_SCHEMA = 2;

export const initialProgress = () => ({ schema: PROGRESS_SCHEMA, choices: {}, attempts: {}, credits: {}, roster: { active: null }, temporary: {}, sealed: { forms: {}, days: {}, folded: 0 }, batches: {} });

// The ledger holds thousands of records and its validator runs after every block a replay applies, so a record is checked
// by shape (a prefix and a length), not by pattern; the writers (record.js, commands.js) make ids that match the patterns.
const refLike = value => typeof value === 'string' && value.length > 3 && value.length < 161 && value.includes('/');
const idLike = (value, prefix) => typeof value === 'string' && value.length === prefix.length + 9 && value.startsWith(`${prefix}_`);

function sourceProblem(source, where) {
    if (!isObject(source)) return `${where}: a source is a record`;
    if (!idLike(source.sid, 'sr') || !idLike(source.swipeKey, 'sw') || !idLike(source.evidence, 'ev') || Object.keys(source).length !== 3) return `${where}: a source is { sid sr_…, swipeKey sw_…, evidence ev_… }`;
    return '';
}

function choiceProblem(key, choice) {
    const where = `progress: choice ${key}`;
    if (!isObject(choice) || !isActorId(choice.actor) || !int(choice.milestone, 0, 1000)) return `${where} is not whole`;
    if (key !== `${choice.actor}|${choice.milestone}`) return `${where} is kept under the wrong key`;
    if (!isHash(choice.rulesHash)) return `${where} names no rules hash`;
    if (choice.kind === 'class') {
        if (!(choice.previous === null || isDefId(choice.previous)) || !isDefId(choice.selected)) return `${where} names no class`;
        if (!Array.isArray(choice.skills) || choice.skills.length !== 3 || new Set(choice.skills).size !== 3 || !choice.skills.every(isDefId)) return `${where} must give exactly three different skills`;
        if ((choice.milestone === 0) !== (choice.previous === null)) return `${where}: only the basic class has no earlier class`;
        return '';
    }
    if (choice.kind === 'path') {
        if (!isDefId(choice.skill) || !isDefId(choice.fromForm) || !isDefId(choice.option) || !int(choice.step, 1, 2)) return `${where} names no skill and forms`;
        return '';
    }
    return `${where} is neither a class nor a path choice`;
}

function attemptProblem(id, attempt) {
    const where = `progress: attempt ${id}`;
    if (!idLike(id, 'at') || !isObject(attempt)) return `${where} is not whole`;
    if (!idLike(attempt.actor, 'ac') || !refLike(attempt.skill) || !refLike(attempt.form) || !KINDS.includes(attempt.kind)) return `${where} names no actor, skill, form and kind`;
    const source = sourceProblem(attempt.source, `${where}.source`) || sourceProblem(attempt.capSource, `${where}.capSource`);
    if (source) return source;
    if (!(attempt.cost === null || (typeof attempt.cost === 'string' && attempt.cost.length > 0 && attempt.cost.length <= 120))) return `${where}: the cost reference is text or null`;
    if (!(attempt.session === null || (typeof attempt.session === 'string' && attempt.session.length > 0 && attempt.session.length <= 120))) return `${where}: the session reference is text or null`;
    if (!(attempt.minute === null || Number.isSafeInteger(attempt.minute))) return `${where}: its minute is a whole minute or null`;
    return '';
}

function creditProblem(id, credit, attempts) {
    const where = `progress: credit ${id}`;
    if (!isObject(credit) || !isObject(attempts[id])) return `${where} has no attempt`;
    if (credit.award !== 0 && credit.award !== 1) return `${where}: a credit is 0 or 1`;
    if (credit.award === 1 ? credit.reason !== null : !REASONS.includes(credit.reason)) return `${where}: a credit of 0 says why, a credit of 1 does not`;
    if (!Number.isSafeInteger(credit.minute) || !Number.isSafeInteger(credit.day)) return `${where}: a credit counts on a minute and a day`;
    if (!idLike(credit.reply, 'sr')) return `${where} names no reply`;
    return '';
}

const UNIT_KINDS = ['summon', 'pet'];
const ENDED = ['expired', 'dismissed', 'downed', 'fight-ended'];

export function unitProblem(id, unit) {
    const where = `progress: temporary unit ${id}`;
    if (!isObject(unit) || unit.id !== id || !/^ac_[0-9a-z]{8}$/.test(id)) return `${where} is not whole`;
    if (!UNIT_KINDS.includes(unit.kind) || !isActorId(unit.owner) || !isDefId(unit.template) || typeof unit.fight !== 'string') return `${where} names no kind, owner, template and fight`;
    if (typeof unit.name !== 'string' || !unit.name || unit.name.length > 80 || !int(unit.level, 1, 99)) return `${where} needs a name and a level`;
    for (const pool of ['hp', 'mp', 'sp']) if (!isObject(unit[pool]) || !int(unit[pool].cur, 0) || !int(unit[pool].max, 0)) return `${where}: ${pool} is { cur, max }`;
    if (!(unit.ended === null || (isObject(unit.ended) && ENDED.includes(unit.ended.reason)))) return `${where}: ended is null or a reason`;
    return '';
}

/** The problems of a progress slice (the domain validator): a list of sentences, empty when it is whole. */
export function progressProblems(slice) {
    if (!isObject(slice) || slice.schema !== PROGRESS_SCHEMA || !isObject(slice.choices) || !isObject(slice.attempts) || !isObject(slice.credits)) return ['progress: the slice is not progress schema 2'];
    if (!isObject(slice.roster) || !(slice.roster.active === null || (Array.isArray(slice.roster.active) && slice.roster.active.length <= 3 && slice.roster.active.every(isActorId)))) return ['progress: roster.active is null or up to three actors'];
    if (!isObject(slice.temporary) || Object.keys(slice.temporary).length > 24) return ['progress: temporary is a record of at most 24 units'];
    const sealed = slice.sealed;
    if (!isObject(sealed) || !isObject(sealed.forms) || !isObject(sealed.days) || !int(sealed.folded, 0)) return ['progress: sealed is { forms, days, folded }'];
    // The sealed results of fights (fight/batch.js): { hash, bytes, seq }, the newest few. (The hash is checked where the bytes are read.)
    if (!isObject(slice.batches) || Object.keys(slice.batches).length > MAX_BATCHES + 4) return ['progress: batches is a record of the newest sealed results'];
    for (const [id, entry] of Object.entries(slice.batches)) if (!isBatchId(id) || !isObject(entry) || !isHash(entry.hash) || !isObject(entry.bytes) || !int(entry.seq, 1)) return [`progress: the sealed result ${id.slice(0, 20)} is not { hash, bytes, seq }`];
    const errors = [];
    for (const [key, n] of Object.entries(sealed.forms)) if (!int(n, 1, 100000) || key.split('|').length !== 2) errors.push(`progress: sealed form ${key.slice(0, 80)} is not a count`);
    for (const [key, n] of Object.entries(sealed.days)) if (!int(n, 1, 100000) || key.split('|').length !== 3) errors.push(`progress: sealed day ${key.slice(0, 80)} is not a count`);
    for (const [id, unit] of Object.entries(slice.temporary)) {
        const problem = unitProblem(id, unit);
        if (problem) errors.push(problem);
    }
    for (const [key, choice] of Object.entries(slice.choices)) {
        const problem = choiceProblem(key, choice);
        if (problem) errors.push(problem);
    }
    const ids = Object.keys(slice.attempts);
    if (ids.length > MAX_ATTEMPTS) errors.push(`progress: more than ${MAX_ATTEMPTS} attempts`);
    for (const id of ids) {
        const problem = attemptProblem(id, slice.attempts[id]);
        if (problem) errors.push(problem);
    }
    for (const [id, credit] of Object.entries(slice.credits)) {
        const problem = creditProblem(id, credit, slice.attempts);
        if (problem) errors.push(problem);
    }
    return errors.slice(0, 20);
}
