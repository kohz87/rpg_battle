// Story Director v2, atlas part: queries and the beforeGenerate hook (pure).
//
// Queries read the head state and, through `tools.query` (MODULES §F3), the enabled packs'
// places and routes; they never see settings, so a trip estimated from coordinates uses v1's
// default map (one km a unit, roads winding ×1.25) unless `map` is given in the args. The tail
// (note.js) uses the reader's map settings.

import { mapSettings, parseLocation } from '../../places.js';
import { findPlace, keyOf } from './domain.js';
import { atlasView, mapProps } from './map.js';
import { scenePlace } from './note.js';
import { travelTime } from './travel.js';
import { packPlace, packWorld, worldOf } from './world.js';

const toolsQuery = tools => (typeof tools?.query === 'function' ? (name, args) => tools.query(name, args) : null);
const worldFrom = (state, tools) => worldOf(state?.domains?.atlas ?? { places: {}, routes: {}, keys: {}, focus: null }, packWorld(toolsQuery(tools)));
const hereOf = (state, tools) => scenePlace({ state, query: toolsQuery(tools) }).name;
// The reader's map settings when the host hands the part its settings (module.js), else v1's default.
function mapOf(tools) {
    try {
        return mapSettings((typeof tools?.settings === 'function' ? tools.settings()?.map : null) ?? {});
    } catch {
        return mapSettings({});
    }
}

const placeOut = place => ({
    id: place.id, name: place.name, region: place.region, kind: place.kind, layer: place.layer,
    x: place.x, y: place.y, discovered: place.discovered, source: place.source,
});

function routeOut(world, route, { map, from = null } = {}) {
    const name = id => world.find(id)?.name ?? '';
    const trip = travelTime({ places: world.places, routes: [route], find: world.find }, route.from, route.to, { map });
    const out = {
        id: route.id, from: route.from, to: route.to, fromName: name(route.from), toName: name(route.to),
        kind: route.kind, hours: route.hours, km: route.km, source: route.source,
        days: trip?.days ?? null, text: trip?.text ?? '',
    };
    if (from) {
        const other = route.from === from ? route.to : route.from;
        Object.assign(out, { other, otherName: name(other) });
    }
    return out;
}

// The trip from the current place by known routes (travel.js), or null: no current place, the
// place itself, or no chain of routes between them (a straight-line guess is not offered here).
function tripFrom(world, here, place, map) {
    if (!here || here.id === place.id) return null;
    const trip = travelTime(world, here.id, place.id, { map });
    if (!trip || trip.source !== 'routes') return null;
    const kinds = [...new Set(trip.hops.map(id => world.routes.find(route => route.id === id)?.kind).filter(Boolean))];
    return { fromId: here.id, fromName: here.name, km: trip.km, days: trip.days, unit: trip.unit, mode: trip.mode, hops: trip.hops.length, by: kinds, text: trip.text };
}

function placeDetail(world, ref, map, hereRef = '') {
    const place = world.find(ref);
    if (!place) return null;
    const here = hereRef ? world.find(hereRef) : null;
    const routes = world.routes.filter(route => route.from === place.id || route.to === place.id).map(route => routeOut(world, route, { map, from: place.id }));
    return { ...placeOut(place), aliases: [...(place.aliases ?? [])], here: Boolean(here && here.id === place.id), trip: tripFrom(world, here, place, map), routes };
}

export const queries = {
    /** The places on the map (the atlas's, then the packs' it has not got): `[{ id, name, region, kind, layer, x, y, discovered, source }]`. */
    'atlas.places': (state, { discovered = null } = {}, tools) => worldFrom(state, tools).places
        .filter(place => !place.hidden && (discovered === null || place.discovered === discovered))
        .map(placeOut),
    /** The known routes, of one place when `place` is given, each with its time (`days`, `text`). */
    'atlas.routes': (state, { place = null, map = null } = {}, tools) => {
        const world = worldFrom(state, tools);
        const settings = mapSettings(map ?? {});
        if (place === null) return world.routes.map(route => routeOut(world, route, { map: settings }));
        const at = world.find(place);
        return at ? world.routes.filter(route => route.from === at.id || route.to === at.id).map(route => routeOut(world, route, { map: settings, from: at.id })) : [];
    },
    /** Exactly `ss.map`'s props: `{ nodes, edges, layers, current, discovered, kinds }`. */
    'atlas.map': (state, _args, tools) => mapProps(worldFrom(state, tools), hereOf(state, tools)),
    /**
     * The atlas Map widget's data (map.js `atlasView`): every place the reader may know of, visited
     * or not, the routes, the layers with places, and the reader's map orientation.
     */
    'atlas.view': (state, _args, tools) => atlasView(worldFrom(state, tools), hereOf(state, tools), { map: mapOf(tools) }),
    /**
     * One place with its routes, by `id` (or node id) or `name`; null when unknown. Also `aliases`,
     * `here` (it is the scene's place) and `trip`: from the scene's place by known routes
     * `{ fromId, fromName, km, days, unit, mode, hops, by, text }`, or null.
     */
    'atlas.place': (state, { id = null, name = null } = {}, tools) => placeDetail(worldFrom(state, tools), id ?? name, mapOf(tools), hereOf(state, tools)),
    /**
     * The scene's place as the atlas knows it: `{ id, name, kind, placeKind, region }`: the scene's
     * kind, else the atlas's or the pack's (a `~ place` line that moves the scene may leave the
     * scene's kind empty, or keep the last place's); `placeKind` the atlas's or the pack's alone; the
     * place's own region over the scene's wider one. Null when the scene is nowhere the atlas or a
     * pack knows.
     */
    'atlas.here': (state, _args, tools) => {
        const scene = scenePlace({ state, query: toolsQuery(tools) });
        const place = scene.name ? worldFrom(state, tools).find(parseLocation(scene.name).name.trim()) : null;
        if (!place) return null;
        // `placeKind`: the map's own kind for the place, whatever the scene says now.
        return { id: place.id, name: place.name, kind: scene.kind || place.kind, placeKind: place.kind, region: place.region || scene.region };
    },
    /** The place picked on the map (`atlas.focus`) with its routes, or null. */
    'atlas.selected': (state, _args, tools) => {
        const focus = state?.domains?.atlas?.focus ?? null;
        if (!focus) return null;
        const world = worldFrom(state, tools);
        return placeDetail(world, world.find(focus) ? focus : focus.replace(/^pack:/, ''), mapSettings({}));
    },
    /** The trip between two places (travel.js `travelTime`), or null. */
    'atlas.travel': (state, { from = null, to = null, mode = null, map = null } = {}, tools) => travelTime(worldFrom(state, tools), from, to, { map: mapSettings(map ?? {}), mode }),
};

/**
 * `beforeGenerate(view)` (SPEC §4.1 step 3): the scene's place goes on the map when the atlas
 * has not got it, has it only by hearsay, or lacks the kind or region the scene gives. Commits
 * through `{ commands: [{ type: 'atlas.visit', payload }] }`; nothing when there is nothing new.
 */
export function beforeGenerate(view) {
    const atlas = view?.state?.domains?.atlas;
    if (!atlas) return undefined;
    const scene = scenePlace(view);
    const name = parseLocation(scene.name).name.trim();
    if (!keyOf(name)) return undefined;
    const known = findPlace(atlas, name);
    // A region saved from the scene where a pack says better is mended by a visit (ensurePlace).
    const packRegion = known && scene.region && known.region === scene.region ? packPlace(packWorld(view.query ?? null), name)?.region : '';
    const fresh = !known || !known.discovered || (scene.kind && !known.kind) || (scene.region && !known.region) || Boolean(packRegion && packRegion !== known.region);
    if (!fresh) return undefined;
    const payload = { name: scene.name.trim() };
    if (scene.kind) payload.kind = scene.kind;
    if (scene.region) payload.region = scene.region;
    return { commands: [{ type: 'atlas.visit', payload }] };
}
