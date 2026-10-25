// Story Director v2, atlas part: the map as Story Block's `ss.map` widget draws it (pure).
//
// `mapProps(world, current)` gives exactly the widget's props (docs/v2/WIDGETS.md): nodes with an
// icon for their kind, edges for the routes, layers by plane or region, the scene's place as
// `current`, the places the story has reached as `discovered` (pack places it has not are under
// the fog), and a legend of the kinds on show. The screen adds `onSelect`, `fog` and `label`.
//
// `atlasView(world, current, options)` is the data of the atlas's own Map widget (widget.js):
// every place the reader may know of, visited or not (a pack's hidden or secret place only once
// the story has been there), the routes between them, the regions and planes that have places,
// and which way north and east run.

import { keyOf } from './domain.js';

// Font Awesome icons (SillyTavern ships Font Awesome) by the words a kind is written with.
const ICONS = Object.freeze([
    [/\b(?:city|capital)\b/, 'fa-city'],
    [/\b(?:town|village|hamlet|settlement|farm|homestead)\b/, 'fa-house'],
    [/\b(?:castle|fort|fortress|keep|citadel|bastion|stronghold|watch)\b/, 'fa-chess-rook'],
    [/\b(?:ruin|ruins)\b/, 'fa-landmark'],
    [/\b(?:dungeon|crypt|tomb|catacomb|lair)\b/, 'fa-dungeon'],
    [/\b(?:cave|cavern|mine|grotto)\b/, 'fa-mountain-sun'],
    [/\b(?:temple|shrine|church|chapel|monastery|abbey)\b/, 'fa-place-of-worship'],
    [/\b(?:inn|tavern|alehouse)\b/, 'fa-beer-mug-empty'],
    [/\b(?:port|harbou?r|dock|docks|wharf|quay|pier|jetty)\b/, 'fa-anchor'],
    [/\b(?:camp|encampment|outpost)\b/, 'fa-campground'],
    [/\b(?:tower|spire|lighthouse)\b/, 'fa-tower-observation'],
    [/\b(?:bridge|ford|crossing|weir)\b/, 'fa-bridge'],
    [/\b(?:forest|wood|woods|grove|wild|wilds)\b/, 'fa-tree'],
    [/\b(?:mountain|peak|pass|hill|hills|ridge)\b/, 'fa-mountain'],
    [/\b(?:lake|river|sea|coast|shore|marsh|swamp|spring)\b/, 'fa-water'],
    [/\b(?:market|shop|bazaar)\b/, 'fa-shop'],
    [/\b(?:landmark|monument|statue|stone|stones)\b/, 'fa-monument'],
]);
export const DEFAULT_ICON = 'fa-location-dot';

/** The icon for a place kind: a Font Awesome class name. */
export function iconFor(kind) {
    const word = String(kind ?? '').toLowerCase();
    return ICONS.find(([pattern]) => pattern.test(word))?.[1] ?? DEFAULT_ICON;
}

const label = word => word.charAt(0).toUpperCase() + word.slice(1);

/** The map layer a place is on: its plane, else its region, else none (shown on every layer). */
export const layerOf = place => place.layer || place.region || '';

/** `{ nodes, edges, layers, current, discovered, kinds }` for `ss.map`. */
export function mapProps(world, current = '') {
    const layers = [];
    const layerIds = new Map();
    const layerId = text => {
        const key = keyOf(text);
        if (!key) return '';
        if (!layerIds.has(key)) {
            layerIds.set(key, key);
            layers.push({ id: key, name: text });
        }
        return key;
    };
    const kinds = {};
    const drawn = world.places.filter(place => !place.hidden);
    const shown = new Set(drawn.map(place => place.id));
    const nodes = drawn.map(place => {
        const node = { id: place.id, name: place.name, icon: iconFor(place.kind), layer: layerId(layerOf(place)), kind: place.kind };
        if (place.x !== null && place.y !== null) Object.assign(node, { x: place.x, y: place.y });
        if (place.kind && !kinds[place.kind]) kinds[place.kind] = { label: label(place.kind), icon: node.icon };
        return node;
    });
    const edges = world.routes.filter(route => shown.has(route.from) && shown.has(route.to)).map(route => {
        if (route.kind && !kinds[route.kind]) kinds[route.kind] = { label: label(route.kind) };
        return { from: route.from, to: route.to, kind: route.kind };
    });
    const here = current ? world.find(current) : null;
    return {
        nodes,
        edges,
        layers: layers.sort((a, b) => a.id.localeCompare(b.id)),
        current: here?.id ?? '',
        discovered: drawn.filter(place => place.discovered).map(place => place.id),
        kinds,
    };
}

const layerKey = (type, name) => `${type}:${keyOf(name)}`;

/** The layer a place shows on in the atlas widget: its plane's, else its region's, else '' (only "All"). */
export const viewLayerOf = place => (place.layer ? layerKey('plane', place.layer) : place.region ? layerKey('region', place.region) : '');

/**
 * The atlas widget's data:
 * `{ places, routes, layers, layer, current, kinds, orient }` where
 * - places: `[{ id, name, aliases, region, kind, icon, plane, layer, x, y, visited, here }]`, every
 *   place but a hidden one the story has not reached (`x`/`y` null without coordinates);
 * - routes: `[{ from, to, kind, known }]` between those (`known`: both ends visited);
 * - layers: `[{ id, name, type: 'region' | 'plane' }]`, only those with at least one place, regions
 *   first, each by name; `layer`: the one to open on (the current place's, else '' for all);
 * - kinds: the legend `{ kind: { label, icon? } }`; orient: `{ north, east }` from the map settings.
 */
export function atlasView(world, current = '', { map = {} } = {}) {
    const here = current ? world.find(current) : null;
    const drawn = world.places.filter(place => !place.hidden || place.id === here?.id);
    const ids = new Set(drawn.map(place => place.id));
    const visited = new Set(drawn.filter(place => place.discovered || place.id === here?.id).map(place => place.id));
    const kinds = {};
    const layers = new Map();
    const places = drawn.map(place => {
        const icon = iconFor(place.kind);
        if (place.kind && !kinds[place.kind]) kinds[place.kind] = { label: label(place.kind), icon };
        const layer = viewLayerOf(place);
        if (layer && !layers.has(layer)) layers.set(layer, { id: layer, name: place.layer || place.region, type: place.layer ? 'plane' : 'region' });
        return {
            id: place.id, name: place.name, aliases: [...(place.aliases ?? [])], region: place.region, kind: place.kind, icon,
            plane: place.layer, layer, x: place.x, y: place.y, visited: visited.has(place.id), here: place.id === here?.id,
        };
    });
    const routes = world.routes.filter(route => ids.has(route.from) && ids.has(route.to)).map(route => {
        if (route.kind && !kinds[route.kind]) kinds[route.kind] = { label: label(route.kind) };
        return { from: route.from, to: route.to, kind: route.kind, known: visited.has(route.from) && visited.has(route.to) };
    });
    const order = { region: 0, plane: 1 };
    return {
        places,
        routes,
        layers: [...layers.values()].sort((a, b) => order[a.type] - order[b.type] || keyOf(a.name).localeCompare(keyOf(b.name)) || (a.id < b.id ? -1 : 1)),
        layer: here ? viewLayerOf(here) : '',
        current: here && ids.has(here.id) ? here.id : '',
        kinds,
        orient: { north: map?.north === 'down' ? 'down' : 'up', east: map?.east === 'left' ? 'left' : 'right' },
    };
}
