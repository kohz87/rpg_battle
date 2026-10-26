// Story Director v2, part **arc**: the `arc` domain, its validator, its query and its tail line (pure).
//
// arc = {
//   arcs: { [arcId]: { id, key, desc, rev, minutes, reason, note } },  // one per accepted plan, never changed
//   ends: { [arcId]: { rev, reason } },                                 // an arc ended (End arc, or every beat played)
// }
// Bookkeeping later replies write (WAVE rule 2): each arc and each ending is added whole under its own
// key and never written into again. The current arc is the newest one (by `rev`); a newer plan
// supersedes the one before it without touching it, and it is over once `ends` has its id. Deleting the
// reply that holds an accepted plan takes its arc (and its new threads) away; an ending whose arc went
// with a deleted reply is passed over. The oldest arcs past ARC_ROOM are removed by key (Story Block
// passes over the removal of a key a deleted reply had made).
// The arc's beats, agendas, hooks, clocks and secrets are the tracker's own threads (`director`), each
// tagged with the arc's id (`track.arc`), so the Director note, lapses and the screens treat them as any
// other thread.

import { arcBeats } from './plan.js';

export const ARC_ROOM = 20;
/** The tail's budget (tokens): one short line. */
export const ARC_TAIL_BUDGET = 60;
const ARC_ID = /^arc_[0-9a-z]{8}$/;
const REASONS = new Set(['manual', 'no-arc', 'arc-end', 'stalled', 'running-low']);
export const FEATURE = 'story-director.arc';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);

export const initialArc = () => ({ arcs: {}, ends: {} });

/** The arcs kept, oldest first (by rev, then id). */
export function arcList(arc) {
    const arcs = isRecord(arc?.arcs) ? Object.values(arc.arcs).filter(isRecord) : [];
    return arcs.sort((a, b) => (a.rev ?? 0) - (b.rev ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The current arc `{ …arc, active, ended }` (the newest), or null before the first. */
export function currentArc(arc) {
    const newest = arcList(arc).at(-1);
    if (!newest) return null;
    const ended = isRecord(arc?.ends?.[newest.id]) ? arc.ends[newest.id] : null;
    return { ...newest, active: !ended, ended };
}

/** `validate(slice) → string[]` (SPEC §2.5). */
export function validateArc(slice) {
    if (!isRecord(slice)) return ['arc is not an object.'];
    const errors = [];
    if (!isRecord(slice.arcs)) errors.push('arc.arcs is not an object.');
    else {
        if (Object.keys(slice.arcs).length > 2 * ARC_ROOM) errors.push(`arc.arcs holds more than ${2 * ARC_ROOM} arcs.`);
        for (const [id, entry] of Object.entries(slice.arcs)) {
            const at = `arc.arcs.${id}`;
            if (!isRecord(entry) || entry.id !== id || !ARC_ID.test(id)) { errors.push(`${at} has a bad id.`); continue; }
            if (typeof entry.key !== 'string' || !entry.key.trim()) errors.push(`${at} has no name.`);
            if (typeof entry.desc !== 'string') errors.push(`${at}.desc is not text.`);
            if (!isInt(entry.rev) || entry.rev < 0) errors.push(`${at}.rev must be a whole number.`);
            if (!(entry.minutes === null || isInt(entry.minutes))) errors.push(`${at}.minutes must be null or whole minutes.`);
            if (!REASONS.has(entry.reason)) errors.push(`${at}.reason is unknown.`);
            if (typeof entry.note !== 'string') errors.push(`${at}.note is not text.`);
        }
    }
    if (!isRecord(slice.ends)) errors.push('arc.ends is not an object.');
    else {
        if (Object.keys(slice.ends).length > 2 * ARC_ROOM) errors.push(`arc.ends holds more than ${2 * ARC_ROOM} endings.`);
        for (const [id, end] of Object.entries(slice.ends)) {
            if (!ARC_ID.test(id) || !isRecord(end) || !isInt(end.rev) || typeof end.reason !== 'string') errors.push(`arc.ends.${id} must be { rev, reason }.`);
        }
    }
    return errors;
}

/** The tracker's threads with the arc each belongs to (`arc`, from `track.arc`), in tracker order. */
export function threadsWithArc(director) {
    const threads = isRecord(director?.threads) ? Object.values(director.threads).filter(isRecord) : [];
    return threads
        .sort((a, b) => (a.track?.order ?? 0) - (b.track?.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(thread => ({ id: thread.id, kind: thread.kind, key: thread.key, summary: thread.summary, status: thread.status, fields: thread.fields ?? {}, offer: Boolean(thread.offer), ended: thread.ended ?? null, arc: thread.track?.arc ?? null }));
}

/**
 * `director.arc` → `{ current, previous, count }`: the current arc `{ id, key, desc, active, reason,
 * note, beats: { done, total }, ended: { reason } | null }` (null before the first), the one before it
 * `{ key, desc }`, and how many arcs this story has had.
 */
export function arcQuery(state) {
    const slice = state?.domains?.arc;
    const list = arcList(slice);
    const current = currentArc(slice);
    if (!current) return { current: null, previous: null, count: 0 };
    const { done, total } = arcBeats(threadsWithArc(state?.domains?.director), current.id);
    const before = list.at(-2) ?? null;
    return {
        current: {
            id: current.id, key: current.key, desc: current.desc, active: current.active, reason: current.reason, note: current.note,
            beats: { done, total }, ended: current.ended ? { reason: current.ended.reason } : null,
        },
        previous: before ? { key: before.key, desc: before.desc } : null,
        count: list.length,
    };
}

/** The tail line: the current arc while it runs (its beats are in the Director note's Beats line). */
export function arcTail(view) {
    const on = typeof view?.feature === 'function' ? view.feature(FEATURE) !== false : true;
    if (!on) return { lines: [], optional: [] };
    const current = currentArc(view?.state?.domains?.arc);
    if (!current?.active) return { lines: [], optional: [] };
    return { lines: [`Arc: ${current.key}${current.desc ? ` — ${current.desc}` : ''}`], optional: [] };
}
