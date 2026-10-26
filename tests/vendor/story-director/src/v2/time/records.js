// Story Director v2, part **time**: its settings, the reader's calendar, and the `director`
// domain's threads read as v1 tracker records (pure).
//
// v1's time rules (src/lapses.js, src/relevance.js, src/note.js, src/tracker.js) work on v1
// records in an array. This part only reads threads that way to run those rules unchanged; it
// never writes a v1 record back: what it changes on a thread it changes on the draft itself
// (settle.js), in v2's shape (MODULES §C1).

import { PRESETS, makeCalendar, normalizeCalendar } from '../../calendar.js';
import { FIELDS, lineKey } from '../../changes.js';
import { isOffer } from '../../tracker.js';

// v1's own kinds a job may be offered as before the reader takes it on.
const OFFER_KINDS = new Set(['hook', 'event']);
const DATE_FIELDS = ['on', 'due'];

/** The part's settings defaults (section 'Time'). */
export const DEFAULTS = Object.freeze({
    // A jump of the story clock at least this long between two replies gets the While away recap.
    recapHours: 6,
    // Deadlines that pass close their threads (beats slip, offers lapse, quests fail).
    lapses: true,
});

const isInt = value => Number.isSafeInteger(value);

/** The part's settings from a ctx's or view's `settings` (a function, an object, or nothing). */
export function timeSettings(source) {
    let value = source;
    if (typeof source === 'function') {
        try {
            value = source();
        } catch {
            value = null;
        }
    }
    const own = value && typeof value === 'object' ? value : {};
    const hours = Number(own.recapHours);
    return {
        recapHours: isInt(hours) && hours >= 1 ? hours : DEFAULTS.recapHours,
        lapses: typeof own.lapses === 'boolean' ? own.lapses : DEFAULTS.lapses,
        // The reader's calendar is the tracker part's setting; module.js hands it over as
        // `calendar` (or this part sees the module's values with the tracker's under `tracker`).
        calendar: own.calendar ?? own.tracker?.calendar ?? null,
    };
}

/** The reader's calendar (v1 calendar.js), Gregorian when the settings carry none. */
export function calendarOf(settings) {
    return makeCalendar(normalizeCalendar(settings?.calendar ?? PRESETS.gregorian));
}

/** Threads in tracker order: by `track.order`, then by id (the tracker part's order). */
export function orderedThreads(director) {
    return Object.values(director?.threads ?? {}).sort((a, b) =>
        (a.track?.order ?? 0) - (b.track?.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const text = value => String(value ?? '');
const position = at => (at ? { message: at.turn ?? null, time: at.time ?? null } : { message: null, time: null });

// v1 keeps every line a record was written by; v2 keeps none, so "the beat was fired" (v1
// lapses.js: a `!` since its date was written) is read from what the thread keeps: the story
// changed it, in a later reply than the one that wrote it, at or after the start of its date.
// A beat the story touched once its day came is taken as played out, never slipped for it.
function firedHistory(thread, fields, calendar) {
    if (thread.kind !== 'beat' || !calendar) return [];
    const { created, changed: at } = thread.track ?? {};
    const changed = at?.time;
    if (!isInt(changed) || !isInt(at?.turn) || !(at.turn > (created?.turn ?? -1))) return [];
    for (const field of DATE_FIELDS) {
        const written = text(fields[field]).trim();
        if (!written) continue;
        const parsed = calendar.parse(written, { reference: changed });
        if (parsed && Number.isFinite(parsed.abs)) return parsed.abs <= changed ? [{ op: '!', text: '' }] : [];
    }
    return [];
}

/**
 * The v1 record a thread reads as (what lapses.js, relevance.js and note.js read: key, kind,
 * status, fields, engaged, positions). A job offered and not taken reads as v1's offer: a hook
 * (or the event it was offered as) that is a job, whatever words its fields hold.
 */
export function recordOf(thread, { calendar = null } = {}) {
    const track = thread.track ?? {};
    const fields = Object.fromEntries(FIELDS.map(name => [name, '']));
    const extra = {};
    for (const [label, value] of Object.entries(thread.fields ?? {})) {
        if (FIELDS.includes(label)) fields[label] = text(value);
        else extra[label] = text(value);
    }
    fields.desc = text(thread.summary);
    const offered = Boolean(thread.offer) && !thread.taken;
    const kind = thread.taken ? (OFFER_KINDS.has(thread.kind) ? 'quest' : thread.kind)
        : offered ? (OFFER_KINDS.has(track.was) ? track.was : 'hook') : thread.kind;
    const record = {
        key: thread.key,
        id: lineKey(thread.key),
        kind,
        status: thread.status === 'active' ? 'active' : 'resolved',
        fields,
        extra,
        created: position(track.created),
        changed: position(track.changed),
        seen: position(track.seen),
        resolved: thread.status === 'active' ? null : { ...position(track.closed), reason: text(thread.ended?.reason) },
        legSince: track.legSince ? position(track.legSince) : null,
        pinned: Boolean(track.pinned),
        arc: track.arc ?? null,
        aliases: [],
        history: firedHistory(thread, fields, calendar),
    };
    if (track.engaged) record.engaged = position(track.engaged);
    // Every v2 offer is a job to v1, so its deadline lapses it as v1's offers lapse.
    if (offered && record.status === 'active' && !isOffer(record)) record.fields = { ...fields, type: 'quest' };
    return record;
}

/**
 * The v1 tracker the domain reads as, and which thread each record is:
 * `{ tracker: { version, records, message, time }, threadOf: Map(record → thread) }`.
 * `only`: which threads to read (default: the active ones). `fights: false` (no module runs fights,
 * WAVE rule 11): no record tells its `encounter` (it stays on the thread).
 */
export function trackerOf(director, { calendar = null, now = null, only = thread => thread.status === 'active', fights = true } = {}) {
    const threadOf = new Map();
    const records = [];
    for (const thread of orderedThreads(director)) {
        if (!only(thread)) continue;
        const record = recordOf(thread, { calendar });
        if (!fights && record.fields.encounter) record.fields = { ...record.fields, encounter: '' };
        threadOf.set(record, thread);
        records.push(record);
    }
    return {
        tracker: { version: 1, records, message: director?.turn?.n ?? -1, time: isInt(now) ? now : director?.time?.minutes ?? null },
        threadOf,
    };
}
