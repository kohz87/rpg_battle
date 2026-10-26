// Story Director v2, atlas part: what the model is told (pure).
//
// static: nothing of its own. The atlas's two kinds give the change-line instruction one line
// each (GRAMMAR), which Story Block writes under its `<Changes>` header (SPEC §5): fixed text.
// tail: one optional line, the known routes from the scene's place with how long each takes
// (travel.js), within about 80 tokens; nothing when the place has no known route.

import { mapSettings } from '../../places.js';
import { packWorld, worldOf } from './world.js';
import { travelTime } from './travel.js';

export const TAIL_BUDGET = 80;
// Characters the line may take: Story Block estimates tokens as characters / 4.
const MAX_CHARS = TAIL_BUDGET * 4;

/** Each atlas kind's one line for the change-line instruction (SPEC §4.4). */
export const GRAMMAR = Object.freeze({
    route: '+ route Place — Other Place | hours: 2 (or days: 1.5) | kind: road|river|trail|sea (a way between two places; - route Place — Other Place when it is gone)',
    landmark: '+ landmark Name | region: where | kind: town|ruin|cave|… | plane: underground (only off the surface)',
});

/** The atlas's part of the static prompt: none beyond its kinds' grammar. */
export const STATIC_TEXT = '';

const settingsOf = view => (typeof view?.settings === 'function' ? view.settings() : view?.settings) ?? {};

/** The scene's place `{ name, kind, region }` through the `scene.place` query, else the state. */
export function scenePlace(view) {
    let place = null;
    try {
        if (typeof view?.query === 'function') place = view.query('scene.place');
    } catch {
        place = null;
    }
    place ??= view?.state?.domains?.scene?.place ?? null;
    return { name: String(place?.name ?? ''), kind: String(place?.kind ?? ''), region: String(place?.region ?? '') };
}

/** "Routes from Bluewatch Village: Old Weir by road, 2 h · Thunder Ruins by trail, ≈ 1.5 days." or ''. */
export function routesLine(world, here, { map } = {}) {
    const from = world.find(here);
    if (!from) return '';
    const items = world.routes
        .filter(route => route.from === from.id || route.to === from.id)
        .map(route => {
            const other = world.places.find(place => place.id === (route.from === from.id ? route.to : route.from));
            const trip = travelTime({ places: world.places, routes: [route], find: world.find }, from.id, other.id, { map });
            return { other, route, trip };
        })
        .filter(entry => entry.other)
        .sort((a, b) => (a.trip?.days ?? Infinity) - (b.trip?.days ?? Infinity) || a.other.name.localeCompare(b.other.name));
    const head = `Routes from ${from.name}: `;
    let text = '';
    const seen = new Set();
    for (const { other, route, trip } of items) {
        if (seen.has(other.id)) continue;
        seen.add(other.id);
        const item = `${other.name}${route.kind ? ` by ${route.kind}` : ''}${trip ? `, ${trip.text}` : ''}`;
        const next = text ? `${text} · ${item}` : item;
        if ((head + next + '.').length > MAX_CHARS) break;
        text = next;
    }
    return text ? `${head}${text}.` : '';
}

/** `context.tail(view)` → `{ lines, optional }` (SPEC §5). */
export function atlasTail(view) {
    const atlas = view?.state?.domains?.atlas;
    if (!atlas) return { lines: [], optional: [] };
    const here = scenePlace(view).name;
    if (!here.trim()) return { lines: [], optional: [] };
    const world = worldOf(atlas, packWorld(typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null));
    const line = routesLine(world, here, { map: mapSettings(settingsOf(view).map) });
    return { lines: [], optional: line ? [line] : [] };
}
