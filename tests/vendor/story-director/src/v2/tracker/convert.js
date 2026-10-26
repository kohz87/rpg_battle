// Story Director v2, tracker part: the `director` domain read as a v1 tracker and back (pure).
//
// v1's tracker rules (src/tracker.js) hold years of fixes: closing a quest from its step text,
// near keys, giving up, pay waiting. They work on v1 records
// (`{ key, id: lineKey(key), kind, status, fields, extra, created, … }`) in an array. v2 keeps
// threads by ID in `director.threads`. These converters let the v1 rules run unchanged on v2
// state: a v1 record is built from each thread, the rules run, and every record is written
// back onto its thread with the v2-only parts (`taken`, `target`, `reward`) kept as they were.
//
// v1 bookkeeping v2 has no field for (when a record was created, changed, seen, closed; its
// leg's start, whether the reader spoke of an offer, its arc) rides on the thread's `track`.
// The positions there count replies with Director lines (`director.turn.n`), v1's `message`.

import { FIELDS, lineKey } from '../../changes.js';
import { isOffer, questOutcome } from '../../tracker.js';

export const THREAD_KINDS = Object.freeze(['agenda', 'event', 'hook', 'quest', 'clock', 'beat', 'secret']);
export const OUTCOMES = Object.freeze(['done', 'failed', 'abandoned', 'declined', 'superseded']);
// v1's own kinds a job may be offered as before the reader takes it on.
const OFFER_KINDS = new Set(['hook', 'event']);
const DECLINED = /\b(?:declin|refus|turned down|passed on)/i;

const text = value => String(value ?? '');
const position = at => (at ? { message: at.turn ?? null, time: at.time ?? null } : { message: null, time: null });
const stamp = at => (at && (at.message !== null && at.message !== undefined || at.time !== null && at.time !== undefined)
    ? { turn: at.message ?? null, time: at.time ?? null } : null);

/** Threads in tracker order: by `track.order`, then by id, so a rebuilt state reads the same. */
export function orderedThreads(director) {
    return Object.values(director?.threads ?? {}).sort((a, b) =>
        (a.track?.order ?? 0) - (b.track?.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The names that reach each thread (`director.keys` turned round): `Map(id → [name])`, as stored. */
function namesById(director) {
    const names = new Map();
    for (const [name, id] of Object.entries(director?.keys ?? {})) {
        if (!names.has(id)) names.set(id, []);
        names.get(id).push(name);
    }
    return names;
}

/** The names other than its own key that reach a thread (v1 aliases), oldest first as stored. */
function aliasesOf(names, thread) {
    const own = lineKey(thread.key);
    return (names.get(thread.id) ?? []).filter(name => name !== own);
}

/**
 * The v1 record a thread reads as. `contracts`: a thread with a code-checked `target` (SD-quests)
 * reads as v1's managed quest, so a story line saying it is done is not taken for the Finish.
 */
export function toRecord(thread, aliases = [], { contracts = false } = {}) {
    const track = thread.track ?? {};
    const fields = Object.fromEntries(FIELDS.map(name => [name, '']));
    const extra = {};
    for (const [label, value] of Object.entries(thread.fields ?? {})) {
        if (FIELDS.includes(label)) fields[label] = text(value);
        else extra[label] = text(value);
    }
    fields.desc = text(thread.summary);
    // An offer the story wrote as `+ quest` with nothing that makes it a job: v1 knows it as a job
    // by its type, so it is read with `type: quest` (never written back).
    if (track.typed && !fields.type) fields.type = 'quest';
    // A job taken on (SD-quests' Take on) is a quest whatever it was offered as.
    const kind = thread.taken && !thread.acceptance ? (OFFER_KINDS.has(thread.kind) ? 'quest' : thread.kind)
        : thread.offer && thread.kind === 'quest' ? track.was || 'hook' : thread.kind;
    const superseded = thread.status !== 'active' && thread.ended?.outcome === 'superseded';
    const status = thread.status === 'active' ? 'active' : superseded ? 'superseded' : 'resolved';
    const record = {
        key: thread.key,
        id: lineKey(thread.key),
        kind,
        status,
        fields,
        extra,
        created: position(track.created),
        changed: position(track.changed),
        seen: position(track.seen),
        resolved: status === 'active' ? null : { ...position(track.closed), reason: text(thread.ended?.reason) },
        legSince: track.legSince ? position(track.legSince) : null,
        pinned: Boolean(track.pinned),
        arc: track.arc ?? null,
        aliases: [...aliases],
        history: [],
    };
    if (track.engaged) record.engaged = position(track.engaged);
    if (track.offeredAt) record.offeredAt = track.offeredAt;
    if (contracts && thread.target) {
        record.contract = {
            requirement: { action: thread.target.kind === 'foes' ? 'defeat' : 'possess', qty: thread.target.count, entity: thread.target.noun },
            rewardText: text(thread.reward?.text ?? fields.reward),
        };
    }
    return record;
}

/** The v1 tracker the domain reads as: `{ version, records, message, time }`. */
export function toTracker(director, options = {}) {
    // The key index is turned round once: looked up per thread it made this quadratic (B-b1-capture-13).
    const names = namesById(director);
    const records = orderedThreads(director).map(thread => toRecord(thread, aliasesOf(names, thread), options));
    return { version: 1, records, message: director?.turn?.n ?? -1, time: director?.time?.minutes ?? null };
}

/** How a closed record ended, in v2's words. */
export function outcomeOf(record) {
    if (record.status === 'superseded') return 'superseded';
    const reason = text(record.resolved?.reason);
    if (DECLINED.test(reason)) return 'declined';
    return questOutcome({ kind: 'quest', status: 'resolved', resolved: { reason } }) ?? 'done';
}

/**
 * A value as text with every object's keys in order, so two threads that hold the same compare equal
 * however their keys came to be ordered (a field a later line added sits last in the stored thread).
 */
export function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    // As JSON keeps it: a key whose value is undefined is not there.
    if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value) ?? 'undefined';
}

/**
 * Whether two values hold the same (key order aside). A thread a line did not change must not look
 * changed: it would get the line's `rev`, a write into a thread another reply made, which a deleted
 * reply then takes the whole line down with (B-b1r2-12).
 */
export const sameValue = (a, b) => canonical(a) === canonical(b);

function compact(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== false && value !== ''));
}

/**
 * The thread a v1 record is after the rules ran. `before` is the thread as it was (null for a new
 * one); `rev` the revision this change commits as; `order` its place for a new thread;
 * No thread becomes an offer: the story's `+ quest` makes a quest at once, and a hook stays a hook. A
 * thread kept as an offer by an older chat stays one until a line makes it the quest (or closes it).
 */
export function fromRecord(record, before, { id, rev, order }) {
    const track = before?.track ?? {};
    const fields = {};
    for (const name of FIELDS) {
        if (name === 'desc') continue;
        const value = text(record.fields?.[name]);
        if (value) fields[name] = value;
    }
    for (const [label, value] of Object.entries(record.extra ?? {})) {
        if (text(value)) fields[label] = text(value);
    }
    const active = record.status === 'active';
    const job = OFFER_KINDS.has(record.kind);
    // `type: quest` is only how v1 knows an offer that has no giver or reward: it is never stored,
    // and it is read in again only while the record is such an offer.
    const injected = Boolean(track.typed) && fields.type === 'quest' && !before?.fields?.type;
    if (injected) delete fields.type;
    const own = injected ? { ...record, fields: { ...record.fields, type: '' } } : record;
    const typed = active && job && Boolean(track.typed) && !fields.type && !isOffer(own);
    const probe = typed ? { ...own, fields: { ...own.fields, type: 'quest' } } : own;
    const offer = Boolean(before?.offer) && !before.taken && active && job && isOffer(probe);
    // An offer is a quest not yet taken; one closed (declined, lapsed) stays a quest that was offered.
    const wasOffer = Boolean(before?.offer) || (before?.kind === 'quest' && track.was);
    const kind = offer || (!active && job && wasOffer) ? 'quest' : record.kind;
    const closedBefore = before && before.status !== 'active';
    const ended = active ? null : closedBefore && before.ended
        ? before.ended
        : { rev, ...(Number.isSafeInteger(record.resolved?.time) ? { at: record.resolved.time } : {}), reason: text(record.resolved?.reason), outcome: outcomeOf(record) };
    const closed = active ? null : closedBefore && track.closed ? track.closed : stamp(record.resolved);
    const thread = {
        id,
        kind,
        key: record.key,
        summary: text(record.fields?.desc),
        fields,
        status: active ? 'active' : 'resolved',
        offer,
        taken: before?.taken ?? null,
        ended,
        target: before?.target ?? null,
        reward: before?.reward ?? null,
        rev: before?.rev ?? rev,
        track: compact({
            order: track.order ?? order,
            created: stamp(record.created),
            changed: stamp(record.changed),
            seen: stamp(record.seen),
            closed,
            legSince: stamp(record.legSince),
            engaged: stamp(record.engaged),
            offeredAt: record.offeredAt || null,
            arc: record.arc || null,
            pinned: Boolean(record.pinned),
            was: kind !== record.kind ? record.kind : null,
            typed,
        }),
    };
    // Keys the v1 record has no part in (the quests' `ready`, an offer's `shown`) are kept as they
    // were, in their order, so an unchanged thread compares equal.
    for (const [name, value] of Object.entries(before ?? {})) if (!Object.hasOwn(thread, name)) thread[name] = value;
    if (before && !sameValue({ ...thread, rev: before.rev }, before)) thread.rev = rev;
    return thread;
}

/** The key index: each record's own key, then the names it was reached by (first record wins). */
export function keysOf(records, idOf) {
    const keys = {};
    for (const record of records) keys[record.id] = idOf(record);
    for (const record of records) {
        for (const alias of record.aliases ?? []) if (!Object.hasOwn(keys, alias)) keys[alias] = idOf(record);
    }
    return keys;
}
