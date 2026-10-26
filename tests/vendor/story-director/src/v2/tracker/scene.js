// Story Director v2, tracker part: what fits the current scene (pure apart from the queries it asks).
//
// "Only show the narrator what could happen now": the Director note lists first the open threads the
// scene can reach, and the rest only as a few "Elsewhere" names. A thread fits the scene when
// * it is tied to the place or its region (its `place:`, `now:` or `leg:` names either, v1's place rule);
// * it is tied to someone present (its key, `giver:`, `people:`, `now:` or summary names a name Story
//   Block's scene lists as present, NPC State Delta's present list adds, or a dossier name or alias of one);
// * it is due within the reader's "Due soon" days by the story clock (due now is always told, on Due now);
// * it is a beat whose reach is met: a beat waiting on another (`after:`) that is still open never fits;
//   one whose prerequisite has ended fits, as does one whose `reach:` names the place or someone present;
// * it is a quest the story said is met or that waits only for its pay (it keeps its line), or one that
//   reads finished (the Quest check asks about it);
// * it is a clock showing signs (`shown: sign|warning`: the signs are where {{user}} is), or the reader's
//   message names it.
// With no scene known (no place, no region, nobody present) everything fits, as before.
// The rest are "elsewhere": only what {{user}} knows of (world/known.js rules: a quest taken on, a hook,
// an event; never an agenda, beat, clock or secret, nor anything the arc planner made) is named there,
// at most N of them (setting `tracker.elsewhere`, default 2), and only while the tail budget has room.
// Nothing is stored: the same state and queries always give the same answer.

import { lineKey } from '../../changes.js';
import { dateOf, isDue } from '../../relevance.js';
import { looksFinished, waitsForPay } from '../../tracker.js';

export const DEFAULT_ELSEWHERE = 2;
export const MAX_ELSEWHERE = 10;
// Shorter names than this match too much by accident (v1 relevance.js MIN_NAME_LENGTH).
const MIN_NAME = 3;
const NAME_POINTS = 80;
const PEOPLE_SHOWN = 12;
// What {{user}} knows of a thread elsewhere (world/known.js): never what is behind the scenes.
const KNOWN_KINDS = new Set(['quest', 'hook', 'event']);
const DATE_FIELDS = ['on', 'due', 'arrive'];

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Text as one plain line: control and format characters out, spaces made one. */
export const flat = value => (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim();
/** `value` flattened and cut to `max` code points (never inside a character), with "…" when longer. */
export function cutPoints(value, max) {
    const chars = Array.from(flat(value));
    return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

/** Asks a query; `fallback` when there is none, it throws or it answers undefined. */
export function ask(query, name, args = {}, fallback = null) {
    if (typeof query !== 'function') return fallback;
    try {
        const value = query(name, args);
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

const normalize = value => flat(value).toLowerCase();

// Word boundaries that work for accented names too (\b is ASCII-only), as v1's relevance.js.
function wordPattern(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}
const names = (value, name) => name.length >= MIN_NAME && wordPattern(name).test(value);

/**
 * The scene as the tail reads it: `{ place, region, people: [{ name, names }], known, nsd }`.
 * `place`/`region`: the atlas's place (`atlas.here`) else Story Block's `scene.place`. `people`: Story
 * Block's present list (`scene.present`, else the scene domain) and NPC State Delta's (`npc.present`), one
 * entry per person (folded name), with every name they go by (NSD's dossier name and aliases when NSD
 * answers `npc.dossier`). `known`: whether there is a scene to filter by at all.
 */
export function sceneOf(query, state) {
    const atlas = ask(query, 'atlas.here', {}, null);
    const scenePlace = ask(query, 'scene.place', {}, null) ?? state?.domains?.scene?.place ?? null;
    const place = cutPoints(flat(atlas?.name) || flat(scenePlace?.name), NAME_POINTS);
    const region = cutPoints(flat(atlas?.region) || flat(scenePlace?.region), NAME_POINTS);
    const listed = ask(query, 'scene.present', {}, null) ?? state?.domains?.scene?.present ?? [];
    const nsdPresent = ask(query, 'npc.present', {}, null);
    const nsd = Array.isArray(ask(query, 'npc.known', {}, null));
    const people = [];
    const byKey = new Map();
    for (const entry of [...(Array.isArray(listed) ? listed : []), ...(Array.isArray(nsdPresent) ? nsdPresent : [])]) {
        const name = cutPoints(typeof entry === 'string' ? entry : entry?.name, NAME_POINTS);
        if (!lineKey(name) || people.length >= PEOPLE_SHOWN) continue;
        const dossier = nsd ? ask(query, 'npc.dossier', { name }, null) : null;
        const own = cutPoints(dossier?.name, NAME_POINTS) || name;
        const key = lineKey(own);
        const aliases = Array.isArray(dossier?.aliases) ? dossier.aliases : typeof dossier?.aliases === 'string' ? dossier.aliases.split(',') : [];
        const all = [own, name, ...aliases.map(alias => cutPoints(alias, NAME_POINTS))].filter(word => word.length >= MIN_NAME);
        if (byKey.has(key)) {
            const person = byKey.get(key);
            for (const word of all) if (!person.names.includes(word)) person.names.push(word);
            continue;
        }
        const person = { name: own, key, names: [...new Set(all)], dossier };
        byKey.set(key, person);
        people.push(person);
    }
    return { place, region, people, nsd, known: Boolean(place || region || people.length) };
}

// v1's place rule (relevance.js placeMatches): "Auvoth" matches "Auvoth, Canal Street" and the other way round.
function placeTied(record, here) {
    const at = normalize(here);
    if (at.length < MIN_NAME) return false;
    const fields = record.fields ?? {};
    return [fields.place, fields.now, fields.leg].some(value => {
        const there = normalize(value);
        return there.length >= MIN_NAME && (there.includes(at) || at.includes(there));
    });
}

/** The text a thread names people in: its key, giver, people, now and summary. */
const peopleText = record => [record.key, record.fields?.giver, record.fields?.people, record.fields?.now, record.fields?.desc].map(flat).join('\n');

/** Whether `record` names `person` (any name they go by), or a name it gives (key, giver, people) names them. */
export function namesPerson(record, person, { strict = false } = {}) {
    const fields = record.fields ?? {};
    const own = [record.key, ...String(fields.giver ?? '').split(','), ...String(fields.people ?? '').split(',')].map(flat).filter(word => word.length >= MIN_NAME);
    const text = strict ? own.join('\n') : peopleText(record);
    if (person.names.some(name => names(text, name))) return true;
    // "Geva" written for "Senior Listener Geva" present, and the other way round.
    return own.some(word => person.names.some(name => names(name, word)));
}

/** Whether a record's `on:`/`due:`/`arrive:` falls within `days` story days of `now` (or is past). */
export function dueWithin(record, { calendar, now, days }) {
    if (!calendar || !Number.isFinite(now)) return false;
    const limit = calendar.addDays(now, days);
    return DATE_FIELDS.some(field => {
        const parsed = dateOf(record, field, { calendar, reference: now });
        if (!parsed) return false;
        return parsed.hasTime ? parsed.abs <= limit : calendar.dayIndex(parsed.abs) <= calendar.dayIndex(limit);
    });
}

// The beat a beat waits on (`after:`), when it is still open.
function waitsOnOpen(record, open) {
    const after = lineKey(flat(record.extra?.after ?? record.fields?.after));
    return Boolean(after) && open.has(after);
}

/**
 * Splits the classified relevant entries (`[{ record, reason, priority }]`, best first) into what fits the
 * scene and the rest, keeping their order: `{ here, elsewhere }`. `threads` maps a record to its thread
 * (for `ready`); `records`: every record (for beats' `after:`); `said`: the reader's message.
 */
export function splitByScene(relevant, { scene, calendar = null, now = null, dueSoonDays = 3, threads = new Map(), records = [] } = {}) {
    if (!scene?.known) return { here: [...relevant], elsewhere: [] };
    const openBeats = new Set(records.filter(record => record.status === 'active' && record.kind === 'beat').map(record => lineKey(record.key)));
    const here = [];
    const elsewhere = [];
    for (const entry of relevant) {
        (fits(entry, { scene, calendar, now, dueSoonDays, threads, openBeats }) ? here : elsewhere).push(entry);
    }
    return { here, elsewhere };
}

function fits({ record, reason }, { scene, calendar, now, dueSoonDays, threads, openBeats }) {
    if (record.kind === 'beat' && waitsOnOpen(record, openBeats)) return false;
    if (reason === 'mentioned' || reason === 'shown') return true;
    if (record.kind === 'quest' && (threads.get(record)?.ready || waitsForPay(record) || looksFinished(record))) return true;
    if (placeTied(record, scene.place) || placeTied(record, scene.region)) return true;
    if (scene.people.some(person => namesPerson(record, person))) return true;
    if (dueWithin(record, { calendar, now, days: dueSoonDays })) return true;
    if (record.kind === 'beat') {
        // Its prerequisite ended: it is the next turn of the story.
        if (lineKey(flat(record.extra?.after ?? record.fields?.after))) return true;
        const reach = normalize(record.fields?.reach);
        if (reach && [scene.place, scene.region].some(name => normalize(name).length >= MIN_NAME && reach.includes(normalize(name)))) return true;
        if (reach && scene.people.some(person => person.names.some(name => names(reach, name)))) return true;
    }
    return false;
}

/** Whether {{user}} knows of a thread (world/known.js): a quest taken on, a hook or an event the story wrote. */
export function knownToUser(record) {
    return KNOWN_KINDS.has(record.kind) && !record.arc;
}

/** "Herb run (hook)", "Wolf Hunt (quest)": an elsewhere thread in a few words. */
export const elsewhereItem = record => `${cutPoints(record.key, NAME_POINTS)} (${record.kind})`;

/** The Elsewhere line for `items` ('' for none). */
export const elsewhereLine = items => (items.length ? `Elsewhere, not in this scene: ${items.join(' · ')}` : '');

/** The `elsewhere` setting: 0 to MAX_ELSEWHERE, else the default. */
export function elsewhereCap(settings) {
    const value = settings?.elsewhere;
    return Number.isSafeInteger(value) && value >= 0 ? Math.min(MAX_ELSEWHERE, value) : DEFAULT_ELSEWHERE;
}

export { isDue, isRecord };
