// Story Director v2, chronicle part: which open world events the next reply is reminded of
// (pure apart from the command's ctx).
//
// At most three, picked by code. Each open event scores how long since it was last in the tail
// (in picks, `chronicle.round - chronicle.seen[id]`, capped; never shown counts as the cap) plus
// how near its place is to the scene's (the same place 3, a known route away 2, the same region
// 1, through the atlas's queries when they are there), plus a seeded fraction below 1 that only
// decides between equal scores. The highest three are picked.
//
// Before each reply, when more than three events are open and no pick was made for this reply
// yet, `beforeGenerate` commits `chronicle.surface` (cause `system`): it makes the pick with the
// receipt's seed (`ctx.rng()`), counts the round and records `surfaced = { at, round, ids }`. The
// tail then shows that pick; a swipe or a regenerate of the same reply finds it already made and
// shows the same events again. Replay applies the receipt's ops, so a rebuild gives the same
// pick. Without the hook (a host that runs none), the tail picks the same way with a hash of the
// head's rev and each id instead, so the same state always gives the same events.

import { isOpen, isRecord, keyOf, orderedEvents, seenOf, surfacedOf } from './domain.js';
import { toSlot } from '../slot.js';

export const SURFACE = 'chronicle.surface';
/** Events in the tail at most. */
export const TAIL_EVENTS = 3;
/** Picks since an event was last shown count up to this many. */
export const STALE_CAP = 8;

const isInt = value => Number.isSafeInteger(value);

/** A number in [0, 1) from `text` (FNV-1a, 32 bits): the same text always gives the same number. */
export function hashUnit(text) {
    let hash = 0x811c9dc5;
    for (const char of String(text)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash / 4294967296;
}

// "near Dragonfang", "the Old Weir": a place as the atlas would name it.
const placeKey = name => keyOf(name).replace(/^(?:near|around|outside|beyond|by|at|in|off|under|over)\s+/, '').replace(/^the\s+/, '');

function ask(query, name, args) {
    if (typeof query !== 'function') return null;
    try {
        return query(name, args) ?? null;
    } catch {
        return null;
    }
}

/** The scene's place name through the `scene.place` query, else Story Block's `scene` domain. */
export function scenePlaceOf(query, state) {
    const place = ask(query, 'scene.place', {}) ?? state?.domains?.scene?.place ?? null;
    return String(place?.name ?? '').trim();
}

/**
 * `near(place)` → 0…3: how near a place is to `here` (3 the same place, 2 a known route away,
 * 1 the same region, 0 otherwise or unknown). The atlas's `atlas.routes` and `atlas.place`
 * queries are asked once, and only when an event has a place.
 */
export function nearness(query, here) {
    const at = placeKey(here);
    if (!at) return () => 0;
    let links = null;
    let region;
    const regions = new Map();
    const regionOf = name => {
        const key = placeKey(name);
        if (!regions.has(key)) regions.set(key, keyOf(ask(query, 'atlas.place', { name })?.region ?? ''));
        return regions.get(key);
    };
    return place => {
        const key = placeKey(place);
        if (!key) return 0;
        if (key === at) return 3;
        links ??= new Set((ask(query, 'atlas.routes', { place: here }) ?? []).map(route => placeKey(route?.otherName)).filter(Boolean));
        if (links.has(key)) return 2;
        region ??= regionOf(here);
        return region && regionOf(place) === region ? 1 : 0;
    };
}

/**
 * The ids of the open events to show, best first: at most `limit`. `round` is the pick being
 * made (`chronicle.round + 1`), `near(place)` from `nearness`, `jitter(id)` → [0, 1).
 */
export function pickEvents(chronicle, { round, near = () => 0, jitter = () => 0, limit = TAIL_EVENTS } = {}) {
    const seen = seenOf(chronicle);
    const scored = orderedEvents(chronicle).filter(isOpen).map(event => {
        const last = seen[event.id];
        const stale = isInt(last) ? Math.min(STALE_CAP, Math.max(0, round - last)) : STALE_CAP;
        return { id: event.id, score: stale + near(event.place) + jitter(event.id) };
    });
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return scored.slice(0, limit).map(entry => entry.id);
}

/** Whether `surfaced` is the pick for the reply being written now (`at`: the chat's length). */
export function pickFresh(surfaced, at) {
    if (!surfaced || !isInt(at) || !isInt(surfaced.at)) return false;
    // The chat holds the reply being swiped or regenerated, or not yet: `at` or `at + 1`.
    return at >= surfaced.at && at < surfaced.at + 2;
}

/**
 * The open events the tail shows, best first: all of them when there are three or fewer; the
 * recorded pick when it is this reply's (topped up when one of them has closed since); else the
 * pick made from the state with a hash of `rev` and each id.
 */
export function tailPick(chronicle, { at = null, rev = 0, near = () => 0 } = {}) {
    const open = orderedEvents(chronicle).filter(isOpen);
    if (!open.length) return [];
    const round = (chronicle.round ?? 0) + 1;
    const hashed = id => hashUnit(`${rev}:${id}`);
    if (open.length <= TAIL_EVENTS) return pickEvents(chronicle, { round, near, jitter: hashed });
    const surfaced = surfacedOf(chronicle);
    if (pickFresh(surfaced, at)) {
        const kept = surfaced.ids.filter(id => isOpen(chronicle.events?.[id]));
        if (kept.length >= TAIL_EVENTS) return kept.slice(0, TAIL_EVENTS);
        const more = pickEvents(chronicle, { round: surfaced.round, near, jitter: hashed, limit: open.length }).filter(id => !kept.includes(id));
        return [...kept, ...more].slice(0, TAIL_EVENTS);
    }
    return pickEvents(chronicle, { round, near, jitter: hashed });
}

/**
 * `chronicle.surface { at }` (cause `system`, from the hook): picks the open events for the reply
 * being written with the receipt's seed and records the pick. Refused from a click.
 */
export function surface(ctx, payload = {}) {
    if (ctx?.cause === 'ui') return ctx.fail('REFUSED', 'The world events for a reply are picked by Story Director itself.');
    const at = payload?.at ?? null;
    if (!(at === null || (isInt(at) && at >= 0))) return ctx.fail('INVALID', 'chronicle.surface: "at" must be the chat\'s length (a whole number).');
    const chronicle = ctx.draft('chronicle');
    const round = (chronicle.round ?? 0) + 1;
    const query = typeof ctx.query === 'function' ? (name, args) => ctx.query(name, args) : null;
    let scene = null;
    try { scene = typeof ctx.read === 'function' ? ctx.read('scene') : null; } catch { scene = null; }
    const near = nearness(query, scenePlaceOf(query, { domains: { scene } }));
    // One draw per open event, in id order, so the pick depends only on the seed and the state.
    const draws = new Map(orderedEvents(chronicle).filter(isOpen).map(event => event.id).sort().map(id => [id, ctx.rng()]));
    const ids = pickEvents(chronicle, { round, near, jitter: id => draws.get(id) ?? 0 });
    // A counter (a deleted pick takes its +1 away; later ones keep theirs).
    chronicle.round = round;
    // By key (SPEC §2.2): the picked events' rounds added, closed events' keys removed; never written whole.
    if (!isRecord(chronicle.seenAt)) chronicle.seenAt = {};
    for (const id of Object.keys(chronicle.seenAt)) if (!isOpen(chronicle.events[id])) delete chronicle.seenAt[id];
    for (const id of ids) chronicle.seenAt[id] = round;
    // This reply's pick, written whole (a slot).
    chronicle.surfaced = toSlot({ at, round, ids });
    const names = ids.map(id => chronicle.events[id].name);
    return { summary: names.length ? `World news for the next reply: ${names.join(', ')}.` : '', narrate: false, data: { ids, round } };
}

/** `beforeGenerate(view)`: commits `chronicle.surface` when there is a pick to make for this reply. */
export function beforeGenerate(view) {
    const chronicle = view?.state?.domains?.chronicle;
    if (!chronicle) return undefined;
    const open = Object.values(chronicle.events ?? {}).filter(isOpen).length;
    if (open <= TAIL_EVENTS) return undefined;
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    if (at === null || pickFresh(surfacedOf(chronicle), at)) return undefined;
    return { commands: [{ type: SURFACE, payload: { at } }] };
}
