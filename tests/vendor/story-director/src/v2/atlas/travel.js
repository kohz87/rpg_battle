// Story Director v2, atlas part: how long a trip takes (pure).
//
// v1's travel maths, over the joined world (world.js). Along known routes: a route's own time
// when the story or a pack gives one in hours, else its km at v1's paces (`DEFAULT_PACES`, km a
// day; a modern map's `MODERN_PACES`, km an hour) with v1's round-up per leg (`legDays`) and
// rest days for the whole trip (`restDaysFor`), as v1's planRoute counts a world pack's roads.
// Water and air routes go by boat, ship or flight whatever the trip's mode. With no way along
// routes, v1's estimate from the map's coordinates (`estimateTrip`: the straight line times the
// road factor). Unknown otherwise.

import { DEFAULT_MAP, DEFAULT_PACES, MODERN_PACES, estimateTrip, mapSettings } from '../../places.js';
import { DEFAULT_RULES, MODERN_RULES, durationText, legDays, restDaysFor } from '../../routes.js';

const tidy = value => Math.round(value * 1e9) / 1e9;

// The mode a route of this kind is travelled by, whatever the trip's own.
const WATER = /\b(?:river|canal|stream|lake|ferry|boat|barge|water)\b/;
const SEA = /\b(?:sea|ocean|lane|ship|voyage)\b/;
const AIR = /\b(?:air|sky|flight|fly)\b/;

/** The trip's mode on a route of `kind`: { mode, pace } at v1's paces, or null. */
export function hopMode(kind, mode, { modern = false } = {}) {
    const paces = modern ? MODERN_PACES : DEFAULT_PACES;
    const word = String(kind ?? '').toLowerCase();
    const by = AIR.test(word) ? (modern ? 'plane' : 'flight')
        : SEA.test(word) ? 'ship'
            : WATER.test(word) ? (modern ? 'ferry' : 'boat')
                : mode;
    return Object.hasOwn(paces, by) ? { mode: by, pace: paces[by] } : null;
}

/** Days for one route: its hours, else its km at the pace; null when neither is known. */
export function routeDays(route, mode, { modern = false } = {}) {
    if (route.hours !== null && route.hours !== undefined) return tidy(route.hours / 24);
    if (!(route.km > 0)) return null;
    const by = hopMode(route.kind, mode, { modern });
    return by ? legDays(route.km, by.pace, modern ? MODERN_RULES : DEFAULT_RULES) : null;
}

/** The trip's default mode: on foot, or by car on a modern map. */
export const defaultMode = map => (mapSettings(map).era === 'modern' ? 'car' : 'foot');

function shortest(world, start, goal, mode, modern) {
    const order = new Map(world.places.map((place, index) => [place.id, index]));
    const edges = new Map();
    for (const route of world.routes) {
        const days = routeDays(route, mode, { modern });
        if (days === null) continue;
        for (const [a, b] of [[route.from, route.to], [route.to, route.from]]) {
            if (!edges.has(a)) edges.set(a, []);
            edges.get(a).push({ to: b, days, route });
        }
    }
    const dist = new Map([[start, 0]]);
    const prev = new Map();
    const done = new Set();
    const queue = [start];
    while (queue.length) {
        let pick = 0;
        for (let i = 1; i < queue.length; i += 1) {
            const a = dist.get(queue[i]);
            const b = dist.get(queue[pick]);
            if (a < b || (a === b && (order.get(queue[i]) ?? 0) < (order.get(queue[pick]) ?? 0))) pick = i;
        }
        const here = queue.splice(pick, 1)[0];
        if (done.has(here)) continue;
        done.add(here);
        if (here === goal) break;
        for (const edge of edges.get(here) ?? []) {
            const cost = tidy(dist.get(here) + edge.days);
            if (cost < (dist.get(edge.to) ?? Infinity)) {
                dist.set(edge.to, cost);
                prev.set(edge.to, { from: here, edge });
                queue.push(edge.to);
            }
        }
    }
    if (!prev.has(goal)) return null;
    const hops = [];
    for (let at = goal; at !== start; at = prev.get(at).from) hops.unshift(prev.get(at).edge);
    return hops;
}

/**
 * The trip from `from` to `to` (ids, node ids or names in `world`):
 * `{ from, to, days, activeDays, restDays, unit: 'day' | 'hour', mode, source: 'routes' | 'map', hops, km, text }`
 * or null when nothing says how far it is. `map` is v1's map settings (era, km per unit, road
 * factor); `mode` v1's (default on foot, a car on a modern map).
 */
export function travelTime(world, from, to, { map = DEFAULT_MAP, mode = null } = {}) {
    const a = world?.find(from);
    const b = world?.find(to);
    if (!a || !b || a.id === b.id) return null;
    const settings = mapSettings(map);
    const modern = settings.era === 'modern';
    const trip = mode ?? defaultMode(settings);
    const rules = modern ? MODERN_RULES : DEFAULT_RULES;
    const hops = shortest(world, a.id, b.id, trip, modern);
    if (hops) {
        const activeDays = tidy(hops.reduce((sum, hop) => sum + hop.days, 0));
        const restDays = restDaysFor(trip, activeDays, rules);
        const days = tidy(activeDays + restDays);
        const timed = hops.every(hop => hop.route.hours !== null && hop.route.hours !== undefined);
        const unit = modern || (timed && days < 1) ? 'hour' : 'day';
        const km = hops.every(hop => hop.route.km > 0) ? tidy(hops.reduce((sum, hop) => sum + hop.route.km, 0)) : null;
        return {
            from: a.id, to: b.id, days, activeDays, restDays, unit, mode: trip, source: 'routes',
            hops: hops.map(hop => hop.route.id), km, text: durationText(days, unit),
        };
    }
    if (a.x === null || b.x === null) return null;
    const estimate = estimateTrip({ name: a.name, coords: { x: a.x, y: a.y } }, { name: b.name, coords: { x: b.x, y: b.y } }, { map: settings, mode: trip });
    if (!estimate) return null;
    return {
        from: a.id, to: b.id, days: estimate.days, activeDays: tidy(estimate.days - estimate.restDays), restDays: estimate.restDays,
        unit: estimate.unit, mode: estimate.mode, source: 'map', hops: [], km: tidy(estimate.roadKm), text: `≈ ${durationText(estimate.days, estimate.unit)}`,
    };
}
