// Story Director v2, part **chronicle**: the `chronicle` domain's shape, caps, validator and name
// lookups (pure).
//
// chronicle = {
//   events:   { [ev_id]: { id, name, summary, state, since, updated, place, factions, aka, rev } },
//   factions: { [fa_id]: { id, name, summary, area, stance, aka, rev } },
//   seen:     [{ [ev_id]: round }],             // an older chat's rounds, written whole (read, never written now)
//   seenAt:   { [ev_id]: round },               // the round an open event was last in the tail, by key
//   round:    int,                              // tail picks made so far (chronicle.surface; a counter)
//   surfaced: null | [{ at, round, ids }],      // the pick for the reply being written
//   days:     { [day]: [Digest] },              // the day digests (days.js), each day a slot
//   written:  null | [{ through, days, at, skip }], // where the digests were last written (days.js)
//   dayFacts: { ["<day>.<rev>"]: entry },        // each reply's facts for the digest, until its day is written
//   noted:    null | [{ rev, minutes, from, settle }], // where those notes got to (days.js)
//   questLog: { ["<rev>"]: { thread, text } },  // the quest history lines (quest.details), kept by the note
// }
// An event is a lasting situation of the wider world (a war, a plague, a calamity) the story
// keeps moving: `state` is looming, ongoing or resolved. `since` and `updated` are story minutes
// stamped by code from the Director's clock when the line was read (null while the clock is not
// set), never written by the model. `rev` is the receipt that last changed the entry. `factions`
// are the names a line gave (a faction need not be in the chronicle to be named). `aka` keeps a
// name the entry had before the reader renamed it, so the story's old name still finds it.
// `seenAt` and `surfaced` are kept apart from the events, so an event changes only when the story
// or the reader changes it. `seenAt` is per-reply bookkeeping (SPEC §2.2, a scratch field): each pick
// adds its events' rounds by key and removes closed ones by key, a world line that closes an event
// removes its key; nothing writes it whole, so deleting a reply never makes a later reply's change
// rewrite a deleted pick's rounds (final soak: a later world line was lost). `round` is a counter: a
// deleted pick takes its +1 away and later picks still count theirs, so a round kept in `seenAt` may
// be past `round` after a delete; that is read as "just shown", never refused. `surfaced` is a slot
// (../slot.js) the pick writes whole for its own reply. An id whose event is gone is passed over.
// `seen` (a slot) is an older chat's rounds: read under `seenAt`, never written again.

import { slotValue, toSlot } from '../slot.js';
import { validateDays } from './days.js';

export const EVENT_ID = /^ev_[0-9a-z]{8}$/;
export const FACTION_ID = /^fa_[0-9a-z]{8}$/;

/** The states an event can be in; looming and ongoing are open. */
export const STATES = Object.freeze(['looming', 'ongoing', 'resolved']);
export const OPEN_STATES = Object.freeze(['looming', 'ongoing']);

/** Caps: events kept, resolved events kept (oldest pruned first), factions kept. */
export const MAX_EVENTS = 60;
export const MAX_RESOLVED = 30;
export const MAX_FACTIONS = 40;
export const MAX_NAME = 80;
export const MAX_SUMMARY = 300;
export const MAX_NAMED = 6;   // factions on one event
export const MAX_AKA = 6;

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function initialChronicle() {
    return { events: {}, factions: {}, seen: toSlot({}), seenAt: {}, round: 0, surfaced: null, days: {}, written: null, dayFacts: {}, noted: null, questLog: {} };
}

/** The round each event was last in the tail: `seenAt`, over an older chat's `seen` (a slot, or bare). */
export const seenOf = chronicle => ({ ...(slotValue(chronicle?.seen) ?? {}), ...(isRecord(chronicle?.seenAt) ? chronicle.seenAt : {}) });

/** The pick for the reply being written (`surfaced`), or null. */
export const surfacedOf = chronicle => slotValue(chronicle?.surfaced);

/** Drops `id` from `seenAt` (a draft) by its key; nothing when it is not there (an older chat's `seen` stays as it is). */
export function forgetSeen(chronicle, id) {
    if (isRecord(chronicle?.seenAt) && Object.hasOwn(chronicle.seenAt, id)) delete chronicle.seenAt[id];
}

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);

// Invisible format marks (zero-width spaces and joiners, bidi overrides): "Ro\u200Bpe" and "\u202ERope"
// are "Rope", as Story Block reads its own names (names.js).
const INVISIBLE = /\p{Cf}+/gu;

/** The key a name is found by: invisible marks and apostrophes dropped, spaces folded, lowercase. */
export const keyOf = name => String(name ?? '').replace(INVISIBLE, '').normalize('NFKC').replace(/['’‘`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
// The key as it was made before invisible marks were dropped: two entries saved then stay apart.
const keptKeyOf = name => String(name ?? '').normalize('NFKC').replace(/['’‘`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A name or short word as it is kept: invisible and markdown marks dropped, NFC, spaces folded, at most 80 characters. */
export function cleanName(name) {
    return String(name ?? '').replace(INVISIBLE, '').normalize('NFC').replace(/\*\*|__|[*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
}

/** A summary as it is kept: one line, at most 300 characters (cut at a word when it is longer). */
export function cleanSummary(text) {
    const flat = String(text ?? '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
    if (flat.length <= MAX_SUMMARY) return flat;
    const cut = flat.slice(0, MAX_SUMMARY - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > MAX_SUMMARY / 2 ? cut.slice(0, space) : cut).trim()}…`;
}

/** The revision this command commits as (MODULES §F2 `ctx.rev`), 0 when the host does not say. */
export const revOf = ctx => (isInt(ctx?.rev) ? ctx.rev : 0);

/** A fresh `<prefix>_xxxxxxxx` id: the host's `ctx.id` (seeded), else from `ctx.rng()`; never one in `taken`. */
export function newId(ctx, prefix, taken) {
    for (let tries = 0; tries < 64; tries += 1) {
        let id = typeof ctx?.id === 'function' ? ctx.id(prefix) : '';
        if (!new RegExp(`^${prefix}_[0-9a-z]{8}$`).test(id ?? '')) {
            id = `${prefix}_`;
            for (let i = 0; i < 8; i += 1) id += ID_CHARS[Math.floor(ctx.rng() * ID_CHARS.length) % ID_CHARS.length];
        }
        if (!Object.hasOwn(taken, id)) return id;
    }
    throw new Error(`No free ${prefix} id.`);
}

/** The entry of `table` (events or factions) that `ref` names: its id, its name or a name it had. */
export function findIn(table, ref) {
    if (!isRecord(table) || ref === null || ref === undefined) return null;
    const text = String(ref);
    if (Object.hasOwn(table, text)) return table[text];
    const key = keyOf(text);
    if (!key) return null;
    const entries = Object.values(table);
    return entries.find(entry => keyOf(entry?.name) === key) ?? entries.find(entry => (entry?.aka ?? []).some(name => keyOf(name) === key)) ?? null;
}

export const isOpen = event => OPEN_STATES.includes(event?.state);

/** Events in a fixed order: open first (newest news first), then resolved (newest first); id breaks ties. */
export function orderedEvents(chronicle) {
    const at = event => (isInt(event.updated) ? event.updated : -Infinity);
    return Object.values(chronicle?.events ?? {}).sort((a, b) => Number(isOpen(b)) - Number(isOpen(a))
        || at(b) - at(a) || (b.rev ?? 0) - (a.rev ?? 0) || (a.id < b.id ? -1 : 1));
}

/** Factions by name, then id. */
export function orderedFactions(chronicle) {
    return Object.values(chronicle?.factions ?? {}).sort((a, b) => keyOf(a.name).localeCompare(keyOf(b.name)) || (a.id < b.id ? -1 : 1));
}

/**
 * Keeps the caps after a change (on a draft): resolved events beyond MAX_RESOLVED, then beyond
 * MAX_EVENTS in all, go oldest first (by the receipt that last changed them, then id). Returns
 * the names pruned.
 */
export function prune(chronicle) {
    const resolved = Object.values(chronicle.events).filter(event => !isOpen(event))
        .sort((a, b) => (a.rev ?? 0) - (b.rev ?? 0) || (a.id < b.id ? -1 : 1));
    const gone = [];
    let total = Object.keys(chronicle.events).length;
    let kept = resolved.length;
    for (const event of resolved) {
        if (kept <= MAX_RESOLVED && total <= MAX_EVENTS) break;
        delete chronicle.events[event.id];
        forgetSeen(chronicle, event.id);
        gone.push(event.name);
        kept -= 1;
        total -= 1;
    }
    return gone;
}

const textOk = (value, max) => typeof value === 'string' && value.length <= max;
const namesOk = (list, max) => Array.isArray(list) && list.length <= max && list.every(name => textOk(name, MAX_NAME) && keyOf(name));

function eventErrors(id, event) {
    const at = `chronicle.events.${id}`;
    if (!isRecord(event)) return [`${at} is not an event.`];
    const errors = [];
    if (!EVENT_ID.test(id) || event.id !== id) errors.push(`${at} has a bad id.`);
    if (!textOk(event.name, MAX_NAME) || !keyOf(event.name)) errors.push(`${at} needs a name of at most ${MAX_NAME} characters.`);
    if (!textOk(event.summary, MAX_SUMMARY)) errors.push(`${at}.summary must be text of at most ${MAX_SUMMARY} characters.`);
    if (!STATES.includes(event.state)) errors.push(`${at}.state must be one of: ${STATES.join(', ')}.`);
    for (const field of ['since', 'updated']) {
        if (!(event[field] === null || isInt(event[field]))) errors.push(`${at}.${field} must be story minutes or null.`);
    }
    if (!textOk(event.place, MAX_NAME)) errors.push(`${at}.place must be text of at most ${MAX_NAME} characters.`);
    if (!namesOk(event.factions, MAX_NAMED)) errors.push(`${at}.factions must be a list of at most ${MAX_NAMED} names.`);
    if (!namesOk(event.aka, MAX_AKA)) errors.push(`${at}.aka must be a list of at most ${MAX_AKA} names.`);
    if (!isInt(event.rev) || event.rev < 0) errors.push(`${at}.rev must be a whole number.`);
    for (const key of Object.keys(event)) {
        if (!['id', 'name', 'summary', 'state', 'since', 'updated', 'place', 'factions', 'aka', 'rev'].includes(key)) errors.push(`${at} has an unknown field "${key}".`);
    }
    return errors;
}

function factionErrors(id, faction) {
    const at = `chronicle.factions.${id}`;
    if (!isRecord(faction)) return [`${at} is not a faction.`];
    const errors = [];
    if (!FACTION_ID.test(id) || faction.id !== id) errors.push(`${at} has a bad id.`);
    if (!textOk(faction.name, MAX_NAME) || !keyOf(faction.name)) errors.push(`${at} needs a name of at most ${MAX_NAME} characters.`);
    if (!textOk(faction.summary, MAX_SUMMARY)) errors.push(`${at}.summary must be text of at most ${MAX_SUMMARY} characters.`);
    for (const field of ['area', 'stance']) {
        if (!textOk(faction[field], MAX_NAME)) errors.push(`${at}.${field} must be text of at most ${MAX_NAME} characters.`);
    }
    if (!namesOk(faction.aka, MAX_AKA)) errors.push(`${at}.aka must be a list of at most ${MAX_AKA} names.`);
    if (!isInt(faction.rev) || faction.rev < 0) errors.push(`${at}.rev must be a whole number.`);
    for (const key of Object.keys(faction)) {
        if (!['id', 'name', 'summary', 'area', 'stance', 'aka', 'rev'].includes(key)) errors.push(`${at} has an unknown field "${key}".`);
    }
    return errors;
}

// Two entries of one table may not go by the same name.
function clashes(table, what) {
    const owner = new Map();
    const errors = [];
    for (const entry of Object.values(table)) {
        if (!isRecord(entry)) continue;
        const key = keptKeyOf(entry.name);
        if (key && owner.has(key) && owner.get(key) !== entry.id) errors.push(`Two ${what} are called "${entry.name}".`);
        owner.set(key, entry.id);
    }
    return errors;
}

/** `validate(slice, state) → string[]` (SPEC §2.5). */
export function validateChronicle(slice) {
    if (!isRecord(slice)) return ['chronicle is not an object.'];
    const errors = [];
    const events = isRecord(slice.events) ? slice.events : null;
    if (!events) errors.push('chronicle.events is not an object.');
    else {
        for (const [id, event] of Object.entries(events)) errors.push(...eventErrors(id, event));
        const all = Object.values(events);
        if (all.length > MAX_EVENTS) errors.push(`The chronicle keeps at most ${MAX_EVENTS} events.`);
        if (all.filter(event => event?.state === 'resolved').length > MAX_RESOLVED) errors.push(`The chronicle keeps at most ${MAX_RESOLVED} resolved events.`);
        errors.push(...clashes(events, 'events'));
    }
    if (!isRecord(slice.factions)) errors.push('chronicle.factions is not an object.');
    else {
        for (const [id, faction] of Object.entries(slice.factions)) errors.push(...factionErrors(id, faction));
        if (Object.keys(slice.factions).length > MAX_FACTIONS) errors.push(`The chronicle keeps at most ${MAX_FACTIONS} factions.`);
        errors.push(...clashes(slice.factions, 'factions'));
    }
    if (!isInt(slice.round) || slice.round < 0) errors.push('chronicle.round must be a whole number.');
    const seen = slotValue(slice.seen);
    if (!seen || (Array.isArray(slice.seen) && slice.seen.length !== 1)) errors.push('chronicle.seen is not an object.');
    else {
        for (const [id, round] of Object.entries(seen)) {
            if (!EVENT_ID.test(id)) errors.push(`chronicle.seen["${id}"] is for no event.`);
            else if (!isInt(round) || round < 0) errors.push(`chronicle.seen["${id}"] must be a round.`);
        }
    }
    // A round past `round` (a pick before it deleted) is read as just shown: never refused.
    if (slice.seenAt !== undefined) {
        if (!isRecord(slice.seenAt)) errors.push('chronicle.seenAt is not an object.');
        else {
            for (const [id, round] of Object.entries(slice.seenAt)) {
                if (!EVENT_ID.test(id)) errors.push(`chronicle.seenAt["${id}"] is for no event.`);
                else if (!isInt(round) || round < 0) errors.push(`chronicle.seenAt["${id}"] must be a round.`);
            }
            if (Object.keys(slice.seenAt).length > MAX_EVENTS * 4) errors.push(`chronicle.seenAt keeps about ${MAX_EVENTS} events at most.`);
        }
    }
    const surfaced = slotValue(slice.surfaced);
    if (slice.surfaced !== null) {
        if (!isRecord(surfaced) || (Array.isArray(slice.surfaced) && slice.surfaced.length !== 1) || !(surfaced.at === null || (isInt(surfaced.at) && surfaced.at >= 0)) || !isInt(surfaced.round)
            || !Array.isArray(surfaced.ids) || surfaced.ids.some(id => typeof id !== 'string' || !EVENT_ID.test(id))) {
            errors.push('chronicle.surfaced must be null or { at, round, ids }.');
        }
    }
    // A chronicle from before the day digest has no `days` or `written`.
    errors.push(...validateDays(slice));
    for (const key of Object.keys(slice)) {
        if (!['events', 'factions', 'seen', 'seenAt', 'round', 'surfaced', 'days', 'written', 'dayFacts', 'noted', 'questLog'].includes(key)) errors.push(`chronicle has an unknown field "${key}".`);
    }
    return errors;
}
