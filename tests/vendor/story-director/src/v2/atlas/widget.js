// Story Director v2, atlas part: the Map widget `story-director.map` (MODULES §F9 namespaced widget).
//
// Draws `atlas.view` (map.js `atlasView`): routes as SVG lines in stage pixels (one view transform,
// view.js `toScreen`, for routes and places alike; each line cut to the stage, so a street seen at a
// country's zoom never becomes a line a million pixels long), places as buttons over it, their names placed so none overlaps another (view.js
// `placeLabels`), and the "you are here" ring above everything. The reader can:
// * pan (drag, one finger, arrow keys) and zoom (wheel about the pointer, pinch, + / − buttons and
//   keys, 0 or "Fit" for the whole layer, "Me" to centre on the current place), inside the zoom
//   limits and never off the world; unvisited places get their icon, then their name, as the map
//   comes closer, and hover or focus shows any place's name;
// * switch layers: All, then each region and plane that has places;
// * search places by name, alias or region (unvisited ones too, marked "not visited"); picking one
//   moves the map to it and shows it;
// * pick a place (click, tap, Enter) for its details: kind, region, visited or not, and the trip
//   from the current place by known routes (query `atlas.place`, travel.js).
// The view (centre and zoom) is the reader's alone: kept in memory per layer for this page, never
// in the story state. Picking a place writes nothing either (a screen may still pass `onSelect`).
// Moves to a picked place are eased, except under prefers-reduced-motion.

import {
    KNOWN_ICON_ZOOM, KNOWN_LABEL_ZOOM, NEAR_PX, between, boundsOf, centreOn, clampView, clipSegment, fitView, mapPoint,
    nearestGap, panBy, placeLabels, placeUnplaced, searchPlaces, toScreen, zoomAt, zoomLevel, zoomLimits,
} from './view.js';

export const MAP_WIDGET = 'story-director.map';
const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'sd-atlas-map-style';
const FALLBACK_SIZE = Object.freeze({ width: 640, height: 480 });
const BUTTON_ZOOM = 1.5;
const KEY_PAN = 0.15;              // share of the stage an arrow key moves
const WHEEL_RATE = 0.0015;
const DRAG_THRESHOLD = 4;
const EASE_MS = 260;
const R_VISITED = 12;
const R_KNOWN_FAR = 4;
const R_KNOWN = 9;
const TAP_HALF = 22;               // half of a phone's 44px tap area (a coarse pointer only)
const ALL = '';

// Remembered views for this page: `${viewKey}|${layer}` → { cx, cy, zoom (× fit) }. Never story state.
const views = new Map();
/** Forget remembered views (tests). */
export const forgetViews = () => views.clear();

// Rules are `.sd-map …` (two classes): enough to win over a host page's plain `button` rules, little
// enough for a screen's scoped CSS to restyle. The colour tokens sit in :where() (no specificity).
const CSS = `
:where(.sd-map) {
  --sd-map-fg: var(--ss-w-fg, var(--ss-text));
  --sd-map-muted: var(--ss-w-muted, color-mix(in srgb, var(--sd-map-fg) 85%, transparent));
  --sd-map-bg: var(--ss-w-map-bg, var(--ss-field));
  --sd-map-raised: var(--ss-w-raised, color-mix(in srgb, var(--sd-map-fg) 8%, transparent));
  --sd-map-border: var(--ss-w-border, var(--ss-border));
  --sd-map-accent: var(--ss-w-accent, var(--ss-accent));
  --sd-map-route: var(--ss-w-map-route, color-mix(in srgb, var(--sd-map-fg) 45%, transparent));
  --sd-map-overlay: var(--ss-overlay);
  --sd-map-strong: var(--ss-glass-strong);
  display: flex; flex-direction: column; gap: 0.6em; color: var(--sd-map-fg); min-width: 0; max-width: 100%;
  font-family: var(--ss-font);
}
:where(.sd-map *, .sd-map *::before, .sd-map *::after) { box-sizing: border-box; }
:where(.sd-map [hidden]) { display: none !important; }
:where(.sd-map button) { font: inherit; color: inherit; cursor: pointer; }
:where(.sd-map :focus-visible) { outline: 2px solid var(--sd-map-accent); outline-offset: 2px; }
.sd-map.ss-glass { gap: 0.6em; padding: 12px; color: var(--sd-map-fg); border-color: var(--sd-map-border); }
.sd-map .sd-map-search input::placeholder { color: var(--sd-map-muted); opacity: 1; }
.sd-map .sd-map-bar { display: flex; flex-wrap: wrap; gap: 0.4em; align-items: flex-start; }
.sd-map .sd-map-search { position: relative; flex: 1 1 14em; min-width: 0; }
.sd-map .sd-map-search input { width: 100%; min-height: 40px; padding: 0.3em 0.8em; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-pill); background: var(--sd-map-raised); color: inherit; font: inherit; }
.sd-map .sd-map-results { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); margin: 0; padding: 0.3em; list-style: none; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-m); background: var(--sd-map-strong); backdrop-filter: var(--ss-blur); -webkit-backdrop-filter: var(--ss-blur); max-height: 16em; overflow-y: auto; box-shadow: var(--ss-shadow); }
.sd-map .sd-map-result { display: flex; flex-direction: column; width: 100%; gap: 0; align-items: flex-start; min-height: 40px; padding: 0.3em 0.6em; border: 0; border-radius: var(--ss-radius-s); background: none; text-align: left; }
.sd-map .sd-map-result:hover, .sd-map .sd-map-result:focus-visible { background: var(--sd-map-raised); }
.sd-map .sd-map-result-name { overflow-wrap: anywhere; }
.sd-map .sd-map-result-about { max-width: 100%; color: var(--sd-map-muted); font-size: 0.85em; overflow-wrap: anywhere; }
.sd-map .sd-map-tools, .sd-map .sd-map-layers { display: flex; flex-wrap: wrap; gap: 0.35em; }
.sd-map .sd-map-btn, .sd-map .sd-map-layer { min-width: 40px; min-height: 40px; max-width: min(100%, 12em); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0.15em 0.8em; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-pill); background: var(--sd-map-raised); color: var(--sd-map-fg); font: inherit; }
.sd-map .sd-map-btn:not(:disabled):hover, .sd-map .sd-map-layer:not(:disabled):hover { box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--sd-map-fg) 8%, transparent); }
.sd-map .sd-map-btn:not(:disabled):active, .sd-map .sd-map-layer:not(:disabled):active { transform: translateY(1px); }
.sd-map .sd-map-layer { font-size: 0.9em; font-weight: 600; }
.sd-map .sd-map-layer[aria-pressed="true"] { border-color: var(--sd-map-fg); background: var(--ss-accent-soft); box-shadow: inset 0 0 0 1px var(--sd-map-fg); font-weight: 700; }
.sd-map .sd-map-stage { position: relative; width: 100%; aspect-ratio: 4 / 3; max-height: 70vh; min-height: 14em; overflow: hidden; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-m); background: var(--sd-map-bg); touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; }
@media (max-width: 600px) {
  .sd-map .sd-map-stage { aspect-ratio: 1 / 1; max-height: 60vh; }
  .sd-map .sd-map-layers { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; padding-bottom: 2px; }
  .sd-map .sd-map-layer { flex: 0 0 auto; }
}
.sd-map .sd-map-stage.sd-map-dragging { cursor: grabbing; }
.sd-map .sd-map-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.sd-map .sd-map-route { stroke: var(--sd-map-route); stroke-width: 2; fill: none; }
.sd-map .sd-map-route[data-known="false"] { stroke-dasharray: 4 4; opacity: 0.55; stroke-width: 1.5; }
.sd-map .sd-map-places, .sd-map .sd-map-labels { position: absolute; inset: 0; pointer-events: none; }
.sd-map .sd-map-place { position: absolute; z-index: 1; display: grid; place-items: center; width: 24px; height: 24px; margin: 0; padding: 0; transform: translate(-50%, -50%); border: 2px solid var(--sd-map-border); border-radius: 50%; background: var(--sd-map-strong); color: var(--sd-map-fg); font-size: 11px; line-height: 1; pointer-events: auto; }
.sd-map .sd-map-place[data-visited="false"] { width: 18px; height: 18px; font-size: 9px; border-style: dashed; opacity: 0.7; color: var(--sd-map-muted); }
.sd-map .sd-map-place.sd-map-far { width: 8px; height: 8px; border-width: 1px; border-style: solid; background: var(--sd-map-muted); }
.sd-map .sd-map-place.sd-map-far i { display: none; }
.sd-map .sd-map-place:hover, .sd-map .sd-map-place:focus-visible { z-index: 2; opacity: 1; }
.sd-map .sd-map-place[aria-current="location"] { border-color: var(--sd-map-fg); background: var(--ss-accent-soft); box-shadow: 0 0 0 2px var(--sd-map-accent), 0 0 0 4px var(--sd-map-fg); opacity: 1; z-index: 2; }
.sd-map .sd-map-place.sd-map-picked { border-color: var(--sd-map-accent); border-style: solid; box-shadow: 0 0 0 3px color-mix(in srgb, var(--sd-map-accent) 45%, transparent); opacity: 1; z-index: 2; }
/* A phone (coarse pointer): the dot keeps its size; its tap area is a 44px square (::before, no paint).
   Where two squares cover one dot, the click picks the place whose dot is nearest (see the click handler). */
@media (pointer: coarse) {
  .sd-map .sd-map-place::before { content: ""; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); }
}
.sd-map .sd-map-label { position: absolute; z-index: 2; height: 18px; padding: 0 4px; border-radius: var(--ss-radius-s); background: var(--sd-map-overlay); color: var(--sd-map-fg); font-size: 12px; line-height: 18px; white-space: nowrap; pointer-events: none; }
.sd-map .sd-map-label[data-visited="false"] { color: var(--sd-map-muted); font-style: italic; }
.sd-map .sd-map-label.sd-map-picked { color: var(--sd-map-accent); }
.sd-map .sd-map-here { position: absolute; z-index: 3; width: 34px; height: 34px; transform: translate(-50%, -50%); border: 3px solid var(--sd-map-accent); border-radius: 50%; box-shadow: 0 0 0 2px var(--sd-map-overlay); pointer-events: none; }
.sd-map .sd-map-empty { margin: 0.4em 0; color: var(--sd-map-muted); font-style: italic; }
.sd-map .sd-map-details { position: relative; padding: 0.5em 2.8em 0.5em 0.8em; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-m); background: var(--sd-map-raised); }
.sd-map .sd-map-details h3 { margin: 0 2em 0.1em 0; font-size: 1.05em; overflow-wrap: anywhere; }
.sd-map .sd-map-details p { margin: 0.15em 0; overflow-wrap: anywhere; }
.sd-map .sd-map-about, .sd-map .sd-map-none { color: var(--sd-map-muted); }
.sd-map .sd-map-close { position: absolute; top: 0.3em; right: 0.3em; }
.sd-map .sd-map-legend-card { padding: 10px 12px; gap: 6px; }
.sd-map .sd-map-legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(12em, 1fr)); gap: 0 1em; margin: 0; padding: 0; list-style: none; font-size: 0.9em; }
.sd-map .sd-map-legend .ss-listcard-item { padding: 6px 4px; min-height: 40px; }
.sd-map .sd-map-legend .ss-listcard-title { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.sd-map .sd-map-sample { display: inline-grid; flex: none; place-items: center; width: 28px; height: 28px; border: 2px solid var(--sd-map-border); border-radius: 50%; font-size: 0.7em; color: var(--sd-map-fg); }
.sd-map .sd-map-sample-known { border-style: dashed; color: var(--sd-map-muted); }
.sd-map .sd-map-sample-here { border-color: var(--sd-map-accent); }
`;

/** The widget's stylesheet (tests read it; the page gets it once, from ensureStyle). */
export const MAP_CSS = CSS;

function ensureStyle(doc) {
    const head = doc.head ?? doc.querySelector?.('head');
    if (!head || doc.getElementById?.(STYLE_ID) || head.querySelector?.(`#${STYLE_ID}`)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    head.appendChild(style);
}

function h(doc, tag, cls = '', text = '') {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
}

function button(doc, cls, text, title) {
    const node = h(doc, 'button', cls, text);
    node.setAttribute('type', 'button');
    if (title) {
        node.setAttribute('title', title);
        node.setAttribute('aria-label', title);
    }
    return node;
}

const FA = /^fa(?:-[a-z0-9]+)+$/;
function icon(doc, name) {
    const node = h(doc, 'i', `fa-solid ${FA.test(String(name)) ? name : 'fa-location-dot'}`);
    node.setAttribute('aria-hidden', 'true');
    return node;
}

const text = value => (typeof value === 'string' ? value : '');
const num = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const px = value => `${Math.round(value * 10) / 10}px`;
const fmt = value => String(Math.round(value * 100) / 100);
const humanize = word => (word ? word.charAt(0).toUpperCase() + word.slice(1) : '');

/** The widget's data from its props (a bound `atlas.view` arrives as `props.value`), cleaned. */
export function readView(props) {
    const given = props?.value && typeof props.value === 'object' && !Array.isArray(props.value) ? props.value : props ?? {};
    const seen = new Set();
    const places = [];
    for (const place of Array.isArray(given.places) ? given.places : []) {
        const id = text(place?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        places.push({
            id, name: text(place.name) || id, aliases: (Array.isArray(place.aliases) ? place.aliases : []).map(text).filter(Boolean),
            region: text(place.region), kind: text(place.kind), icon: text(place.icon), plane: text(place.plane), layer: text(place.layer),
            x: num(place.x), y: num(place.y), visited: place.visited === true, here: place.here === true,
        });
    }
    const routes = (Array.isArray(given.routes) ? given.routes : [])
        .filter(route => seen.has(text(route?.from)) && seen.has(text(route?.to)) && route.from !== route.to)
        .map(route => ({ from: route.from, to: route.to, kind: text(route.kind), known: route.known === true }));
    const layers = (Array.isArray(given.layers) ? given.layers : [])
        .filter(layer => text(layer?.id) && places.some(place => place.layer === layer.id))
        .map(layer => ({ id: layer.id, name: text(layer.name) || layer.id, type: layer.type === 'plane' ? 'plane' : 'region' }));
    const current = seen.has(text(given.current)) ? given.current : '';
    const orient = { north: given.orient?.north === 'down' ? 'down' : 'up', east: given.orient?.east === 'left' ? 'left' : 'right' };
    const kinds = given.kinds && typeof given.kinds === 'object' ? given.kinds : {};
    const layer = layers.some(item => item.id === given.layer) ? given.layer : ALL;
    return { places, routes, layers, current, orient, kinds, layer };
}

/** Whether a place shows on a layer: "All" shows every place off the planes; a layer its own places. */
export const onLayer = (place, layer) => (layer === ALL ? !place.plane : place.layer === layer);

/** The layer a place is found on: its own when it has one and the reader is not on "All", else "All". */
const layerFor = (place, layer) => (place.plane ? place.layer : layer === ALL || !place.layer ? ALL : place.layer);

function render(el, props, api) {
    const doc = el.ownerDocument ?? globalThis.document;
    ensureStyle(doc);
    const win = doc.defaultView ?? globalThis.window ?? null;
    const listeners = [];
    const listen = (node, type, fn, options) => {
        node.addEventListener(type, fn, options);
        listeners.push([node, type, fn, options]);
    };

    // ---- the DOM --------------------------------------------------------------------------------
    const root = h(doc, 'div', 'sd-map ss-glass');
    root.setAttribute('role', 'group');
    const bar = h(doc, 'div', 'sd-map-bar');
    const searchBox = h(doc, 'div', 'sd-map-search');
    const input = h(doc, 'input');
    input.setAttribute('type', 'search');
    input.setAttribute('placeholder', 'Find a place');
    input.setAttribute('aria-label', 'Find a place by name, other name or region');
    input.setAttribute('autocomplete', 'off');
    const results = h(doc, 'ul', 'sd-map-results');
    results.setAttribute('aria-label', 'Places found');
    results.hidden = true;
    searchBox.append(input, results);
    const tools = h(doc, 'div', 'sd-map-tools');
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', 'Zoom');
    const zoomIn = button(doc, 'sd-map-btn sd-map-zoom-in', '+', 'Zoom in');
    const zoomOut = button(doc, 'sd-map-btn sd-map-zoom-out', '−', 'Zoom out');
    const fitAll = button(doc, 'sd-map-btn sd-map-fit', '', 'Show the whole layer');
    fitAll.append(icon(doc, 'fa-expand'));
    const centreMe = button(doc, 'sd-map-btn sd-map-me', '', 'Centre on where you are');
    centreMe.append(icon(doc, 'fa-location-crosshairs'));
    tools.append(zoomIn, zoomOut, fitAll, centreMe);
    bar.append(searchBox, tools);
    const layersBar = h(doc, 'div', 'sd-map-layers');
    layersBar.setAttribute('role', 'toolbar');
    layersBar.setAttribute('aria-label', 'Map layers');

    const stage = h(doc, 'div', 'sd-map-stage');
    stage.setAttribute('tabindex', '0');
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-roledescription', 'map');
    stage.setAttribute('aria-label', 'Map. Drag or use the arrow keys to move; scroll, pinch, or plus and minus to zoom; 0 shows the whole layer.');
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'sd-map-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const worldGroup = doc.createElementNS(SVG_NS, 'g');
    worldGroup.setAttribute('class', 'sd-map-world');
    svg.appendChild(worldGroup);
    const placesLayer = h(doc, 'div', 'sd-map-places');
    placesLayer.setAttribute('role', 'group');
    placesLayer.setAttribute('aria-label', 'Places');
    const labelsLayer = h(doc, 'div', 'sd-map-labels');
    labelsLayer.setAttribute('aria-hidden', 'true');
    const hereRing = h(doc, 'div', 'sd-map-here');
    hereRing.setAttribute('aria-hidden', 'true');
    stage.append(svg, placesLayer, labelsLayer, hereRing);

    const empty = h(doc, 'p', 'sd-map-empty', 'No places to show yet.');
    const details = h(doc, 'section', 'sd-map-details');
    details.setAttribute('aria-live', 'polite');
    details.hidden = true;
    const legend = h(doc, 'ul', 'sd-map-legend ss-listcard-rows');
    legend.setAttribute('aria-label', 'Legend');
    const legendCard = h(doc, 'section', 'sd-map-legend-card ss-listcard');
    legendCard.setAttribute('aria-label', 'Legend');
    legendCard.append(h(doc, 'h4', 'ss-label ss-listcard-head', 'Legend'), legend);
    root.append(bar, layersBar, stage, empty, details, legendCard);
    el.appendChild(root);

    // ---- state ----------------------------------------------------------------------------------
    let data = readView(props);
    let viewKey = text(props?.viewKey) || 'map';
    let onSelect = text(props?.onSelect);
    let layer = data.layer;
    let points = new Map();          // id → map-space point (unplaced ones laid out)
    let shown = [];                  // places on the layer
    let box = boundsOf([]);
    let fitK = 1;
    let limits = { min: 0.5, max: 8 };
    let view = { cx: 0, cy: 0, k: 1 };
    let size = { ...FALLBACK_SIZE };
    let picked = '';
    let hovered = '';
    let anim = null;
    let lines = [];                  // [{ line, route }] on the layer
    const nodes = new Map();         // id → place button
    const placeAt = new Map();       // id → the dot's point in the stage, as drawn last
    const labels = new Map();        // id → label span
    const byId = id => data.places.find(place => place.id === id) ?? null;

    function measure() {
        const rect = stage.getBoundingClientRect?.();
        if (rect && rect.width > 0 && rect.height > 0) size = { width: rect.width, height: rect.height };
        return size;
    }

    function computePoints() {
        const list = data.places.map(place => ({ id: place.id, point: mapPoint(place, data.orient) }));
        points = placeUnplaced(list, data.routes.map(route => [route.from, route.to]));
    }

    function remember() {
        views.set(`${viewKey}|${layer}`, { cx: view.cx, cy: view.cy, zoom: zoomLevel(view, fitK) });
    }

    function setView(next, { keep = true } = {}) {
        view = clampView(next, box, limits);
        if (keep) remember();
        paint();
    }

    function stopAnimation() {
        if (anim !== null) win?.cancelAnimationFrame?.(anim);
        anim = null;
    }

    const reducedMotion = () => {
        try {
            return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
        } catch {
            return false;
        }
    };

    // An eased move, or a jump under reduced motion (or where there are no animation frames).
    function moveTo(target) {
        stopAnimation();
        const goal = clampView(target, box, limits);
        if (reducedMotion() || typeof win?.requestAnimationFrame !== 'function') return setView(goal);
        const from = view;
        let start = null;
        const step = time => {
            start ??= time;
            const t = Math.min(1, (time - start) / EASE_MS);
            setView(between(from, goal, t), { keep: t >= 1 });
            anim = t < 1 ? win.requestAnimationFrame(step) : null;
        };
        anim = win.requestAnimationFrame(step);
        return undefined;
    }

    function fitNow() {
        measure();
        return fitView(box, size.width, size.height);
    }

    // The zoom that sets a place apart from its nearest neighbour on the layer (for search and "Me").
    function closeEnough(id) {
        const at = points.get(id);
        let nearest = Infinity;
        for (const place of shown) {
            if (place.id === id) continue;
            const other = points.get(place.id);
            const d = Math.hypot(other.x - at.x, other.y - at.y);
            if (d > 0 && d < nearest) nearest = d;
        }
        const k = Number.isFinite(nearest) ? (NEAR_PX * 1.6) / nearest : fitK * 4;
        return Math.min(limits.max, Math.max(fitK * 2, k));
    }

    function setLayer(id, { refit = false } = {}) {
        layer = data.layers.some(item => item.id === id) ? id : ALL;
        shown = data.places.filter(place => onLayer(place, layer));
        box = boundsOf(shown.map(place => points.get(place.id)));
        const fit = fitNow();
        fitK = fit.k;
        limits = zoomLimits(fitK, nearestGap(shown.map(place => points.get(place.id))));
        const saved = refit ? null : views.get(`${viewKey}|${layer}`);
        view = clampView(saved ? { cx: saved.cx, cy: saved.cy, k: saved.zoom * fitK } : fit, box, limits);
        drawLayers();
        drawShown();
        paint();
    }

    function drawLayers() {
        const chips = [{ id: ALL, name: 'All' }, ...data.layers].map(item => {
            const chip = button(doc, 'sd-map-layer', item.name);
            chip.setAttribute('aria-pressed', String(item.id === layer));
            chip.setAttribute('data-layer', item.id || 'all');
            return chip;
        });
        layersBar.replaceChildren(...chips);
        layersBar.hidden = data.layers.length === 0;
    }

    function drawShown() {
        const ids = new Set(shown.map(place => place.id));
        lines = data.routes.filter(route => ids.has(route.from) && ids.has(route.to)).map(route => {
            const line = doc.createElementNS(SVG_NS, 'line');
            line.setAttribute('class', 'sd-map-route');
            line.setAttribute('data-from', route.from);
            line.setAttribute('data-to', route.to);
            line.setAttribute('data-known', String(route.known));
            if (route.kind) line.setAttribute('data-kind', route.kind.slice(0, 64));
            return { line, route };
        });
        worldGroup.replaceChildren(...lines.map(entry => entry.line));

        nodes.clear();
        labels.clear();
        const items = shown.map(place => {
            const node = button(doc, 'sd-map-place');
            node.setAttribute('data-id', place.id);
            node.setAttribute('data-visited', String(place.visited));
            if (place.kind) node.setAttribute('data-kind', place.kind.slice(0, 64));
            const about = [place.kind && humanize(place.kind), place.region, place.visited ? '' : 'not visited', place.id === data.current ? 'you are here' : ''].filter(Boolean).join(', ');
            node.setAttribute('aria-label', about ? `${place.name} (${about})` : place.name);
            node.setAttribute('title', place.name);
            if (place.id === data.current) node.setAttribute('aria-current', 'location');
            node.append(icon(doc, place.icon));
            nodes.set(place.id, node);
            const label = h(doc, 'span', 'sd-map-label', place.name);
            label.setAttribute('data-id', place.id);
            label.setAttribute('data-visited', String(place.visited));
            label.hidden = true;
            labels.set(place.id, label);
            return node;
        });
        placesLayer.replaceChildren(...items);
        labelsLayer.replaceChildren(...labels.values());
        empty.hidden = shown.length > 0;
        stage.hidden = shown.length === 0;
        drawLegend();
    }

    function drawLegend() {
        const entries = [];
        // A legend row is a list-card row: the sample, then its words.
        const entry = (sample, words) => {
            const li = h(doc, 'li', 'ss-listcard-row');
            const item = h(doc, 'div', 'ss-listcard-item');
            const main = h(doc, 'span', 'ss-listcard-main');
            main.append(h(doc, 'span', 'ss-listcard-title', words));
            item.append(sample, main);
            li.append(item);
            entries.push(li);
        };
        const kinds = [];
        for (const place of shown) if (place.kind && !kinds.includes(place.kind)) kinds.push(place.kind);
        for (const kind of kinds.slice(0, 12)) {
            const sample = h(doc, 'span', 'sd-map-sample');
            sample.append(icon(doc, text(data.kinds[kind]?.icon) || shown.find(place => place.kind === kind)?.icon));
            entry(sample, text(data.kinds[kind]?.label) || humanize(kind));
        }
        if (shown.some(place => !place.visited)) entry(h(doc, 'span', 'sd-map-sample sd-map-sample-known'), 'Not visited yet');
        if (shown.some(place => place.id === data.current)) entry(h(doc, 'span', 'sd-map-sample sd-map-sample-here'), 'You are here');
        legend.replaceChildren(...entries);
        legendCard.hidden = entries.length === 0;
    }

    // Everything that follows the view: cheap enough for every pointer move.
    function paint() {
        const { width, height } = size;
        const frame = { x: -8, y: -8, w: width + 16, h: height + 16 };
        for (const { line, route } of lines) {
            const cut = clipSegment(toScreen(view, width, height, points.get(route.from)), toScreen(view, width, height, points.get(route.to)), frame);
            line.style.display = cut ? '' : 'none';
            if (!cut) continue;
            for (const [name, value] of [['x1', cut.a.x], ['y1', cut.a.y], ['x2', cut.b.x], ['y2', cut.b.y]]) line.setAttribute(name, fmt(value));
        }
        const zoom = zoomLevel(view, fitK);
        stage.setAttribute('data-zoom', String(Math.round(zoom * 100) / 100));
        const far = zoom < KNOWN_ICON_ZOOM;
        const markers = [];
        const at = placeAt;
        at.clear();
        for (const place of shown) {
            const node = nodes.get(place.id);
            const p = toScreen(view, width, height, points.get(place.id));
            at.set(place.id, p);
            node.style.left = px(p.x);
            node.style.top = px(p.y);
            const isFar = !place.visited && far && place.id !== picked && place.id !== hovered;
            node.classList.toggle('sd-map-far', isFar);
            node.classList.toggle('sd-map-picked', place.id === picked);
            const onScreen = p.x > -40 && p.y > -40 && p.x < width + 40 && p.y < height + 40;
            if (onScreen) markers.push({ id: place.id, x: p.x, y: p.y, r: place.visited ? R_VISITED : isFar ? R_KNOWN_FAR : R_KNOWN });
        }
        // Names by priority: the one under the pointer or focus, the picked one, where you are, the
        // visited places, then (closer in) the unvisited ones.
        const visible = new Set(markers.map(marker => marker.id));
        const rank = place => (place.id === hovered ? 0 : place.id === picked ? 1 : place.id === data.current ? 2 : place.visited ? 3 : 4);
        const items = shown
            .filter(place => visible.has(place.id) && (place.visited || zoom >= KNOWN_LABEL_ZOOM || place.id === hovered || place.id === picked))
            .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
            .map(place => ({ id: place.id, x: at.get(place.id).x, y: at.get(place.id).y, r: markers.find(marker => marker.id === place.id).r, text: place.name }));
        const placed = new Map(placeLabels(items, markers, width, height).map(entry => [entry.id, entry]));
        for (const [id, label] of labels) {
            const spot = placed.get(id);
            label.hidden = !spot;
            if (!spot) continue;
            if (label.textContent !== spot.text) label.textContent = spot.text;
            label.style.left = px(spot.x);
            label.style.top = px(spot.y);
            label.setAttribute('data-slot', spot.slot);
            label.classList.toggle('sd-map-picked', id === picked);
        }
        const here = data.current && at.get(data.current);
        hereRing.hidden = !here;
        if (here) {
            hereRing.style.left = px(here.x);
            hereRing.style.top = px(here.y);
        }
    }

    // ---- details --------------------------------------------------------------------------------
    let asked = 0;
    function showDetails(id) {
        const place = byId(id);
        picked = place ? id : '';
        if (!place) {
            details.hidden = true;
            details.replaceChildren();
            paint();
            return;
        }
        const close = button(doc, 'sd-map-btn sd-map-close', '×', 'Close');
        const about = [place.kind && humanize(place.kind), place.region].filter(Boolean).join(' · ');
        const status = place.id === data.current ? 'You are here.' : place.visited ? 'Visited.' : 'Not visited yet.';
        const trip = h(doc, 'p', 'sd-map-trip');
        details.replaceChildren(h(doc, 'h3', 'sd-map-name', place.name), ...(about ? [h(doc, 'p', 'sd-map-about', about)] : []), h(doc, 'p', 'sd-map-status', status), trip, close);
        details.setAttribute('data-id', place.id);
        details.hidden = false;
        paint();
        if (place.id === data.current) return;
        // The trip from the current place, by known routes: code's figures (travel.js), not the story's.
        const ticket = ++asked;
        let detail = null;
        try {
            detail = typeof api?.query === 'function' ? api.query('atlas.place', { id: place.id }) : null;
        } catch {
            detail = null;
        }
        const fill = out => {
            if (ticket !== asked) return;
            const route = out?.trip;
            if (route) {
                const by = route.by?.length ? ` by ${route.by.join(', ')}` : '';
                trip.textContent = `From ${route.fromName}: ${route.km ? `${route.km} km, ` : ''}${route.text}${by}.`;
                trip.className = 'sd-map-trip';
            } else if (data.current) {
                trip.textContent = 'No known route from where you are.';
                trip.className = 'sd-map-trip sd-map-none';
            }
        };
        if (detail && typeof detail.then === 'function') detail.then(fill, () => fill(null));
        else fill(detail);
    }

    function pick(id) {
        showDetails(id);
        if (onSelect && typeof api?.command === 'function') {
            try {
                const out = api.command(onSelect, { node: id });
                if (out && typeof out.catch === 'function') out.catch(() => {});
            } catch { /* a click never breaks the map */ }
        }
    }

    // Moves the map to a place (switching layer when it is not on this one), picks it.
    function goTo(id) {
        const place = byId(id);
        if (!place) return;
        if (!onLayer(place, layer)) setLayer(layerFor(place, layer));
        measure();
        moveTo(centreOn(view, points.get(id), box, limits, closeEnough(id)));
        pick(id);
    }

    // ---- search ---------------------------------------------------------------------------------
    let hits = [];
    function runSearch() {
        hits = searchPlaces(data.places, input.value);
        const items = hits.map(hit => {
            const place = byId(hit.id);
            const li = h(doc, 'li');
            const choose = button(doc, 'sd-map-result');
            choose.setAttribute('data-id', place.id);
            const about = [place.region, place.id === data.current ? 'you are here' : place.visited ? '' : 'not visited'].filter(Boolean).join(' · ');
            choose.append(h(doc, 'span', 'sd-map-result-name', place.name), h(doc, 'span', 'sd-map-result-about', about));
            li.append(choose);
            return li;
        });
        if (input.value.trim() && !items.length) items.push(h(doc, 'li', 'sd-map-none', 'No place by that name.'));
        results.replaceChildren(...items);
        results.hidden = !input.value.trim();
    }
    function chooseHit(id) {
        results.hidden = true;
        goTo(id);
    }
    // Clicks on the layer chips, the results and the details' Close button (delegated: they are redrawn).
    const closestWith = (target, stop, test) => {
        for (let node = target; node && node !== stop; node = node.parentNode) if (test(node)) return node;
        return null;
    };
    listen(layersBar, 'click', event => {
        const chip = closestWith(event.target, layersBar, node => node.getAttribute?.('data-layer'));
        if (!chip) return;
        const id = chip.getAttribute('data-layer') === 'all' ? ALL : chip.getAttribute('data-layer');
        if (id !== layer) setLayer(id);
    });
    listen(results, 'click', event => {
        const choose = closestWith(event.target, results, node => node.getAttribute?.('data-id'));
        if (choose) chooseHit(choose.getAttribute('data-id'));
    });
    listen(details, 'click', event => {
        if (closestWith(event.target, details, node => node.classList?.contains('sd-map-close'))) showDetails('');
    });
    listen(input, 'input', runSearch);
    listen(input, 'keydown', event => {
        if (event.key === 'Enter' && hits.length) {
            event.preventDefault?.();
            chooseHit(hits[0].id);
        } else if (event.key === 'Escape') {
            input.value = '';
            runSearch();
        } else if (event.key === 'ArrowDown' && hits.length) {
            event.preventDefault?.();
            results.querySelector('.sd-map-result')?.focus?.();
        }
    });

    // ---- controls -------------------------------------------------------------------------------
    const zoomCentre = factor => {
        stopAnimation();
        measure();
        setView(zoomAt(view, factor, size.width / 2, size.height / 2, size.width, size.height, box, limits));
    };
    const fit = () => {
        stopAnimation();
        setView(fitNow());
    };
    const toMe = () => {
        if (data.current) goTo(data.current);
    };
    listen(zoomIn, 'click', () => zoomCentre(BUTTON_ZOOM));
    listen(zoomOut, 'click', () => zoomCentre(1 / BUTTON_ZOOM));
    listen(fitAll, 'click', fit);
    listen(centreMe, 'click', toMe);

    listen(stage, 'keydown', event => {
        const step = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
        if (step) {
            stopAnimation();
            measure();
            setView(panBy(view, step[0] * size.width * KEY_PAN, step[1] * size.height * KEY_PAN, box, limits));
        } else if (event.key === '+' || event.key === '=') zoomCentre(BUTTON_ZOOM);
        else if (event.key === '-' || event.key === '_') zoomCentre(1 / BUTTON_ZOOM);
        else if (event.key === '0' || event.key === 'Home') fit();
        else if (event.key === 'Escape' && picked) showDetails('');
        else return;
        event.preventDefault?.();
    });

    // A place: click, tap, Enter or Space (it is a button). Hover and focus show its name.
    const placeOf = target => {
        for (let node = target; node && node !== placesLayer; node = node.parentNode) if (node.getAttribute?.('data-id') && nodes.get(node.getAttribute('data-id')) === node) return node.getAttribute('data-id');
        return '';
    };
    let dropClick = false;
    // On a phone the tap went to a button whose 44px square holds the tap; where two squares
    // cover one dot, the place whose dot is nearest the tap is the one picked (desktop: as is).
    const coarse = () => Boolean(win?.matchMedia?.('(pointer: coarse)')?.matches);
    const tapped = event => {
        const own = placeOf(event.target);
        if (!coarse() || typeof event.clientX !== 'number') return own;
        const tap = local(event);
        let best = '';
        let bestD = Infinity;
        for (const [id, dot] of placeAt) {
            if (Math.abs(dot.x - tap.x) > TAP_HALF || Math.abs(dot.y - tap.y) > TAP_HALF) continue;
            const d = Math.hypot(dot.x - tap.x, dot.y - tap.y);
            if (d < bestD) { best = id; bestD = d; }
        }
        return best || own;
    };
    listen(placesLayer, 'click', event => {
        const id = tapped(event);
        if (!id) return;
        if (dropClick) {
            dropClick = false;
            return;
        }
        pick(id);
    });
    const hover = id => {
        if (hovered === id) return;
        hovered = id;
        paint();
    };
    listen(placesLayer, 'pointerover', event => hover(placeOf(event.target)));
    listen(placesLayer, 'pointerout', () => hover(''));
    listen(placesLayer, 'focusin', event => hover(placeOf(event.target)));
    listen(placesLayer, 'focusout', () => hover(''));

    // Pointer pan (mouse, pen, one finger) and pinch (two fingers).
    const pointers = new Map();
    let moved = 0;
    let captured = null;
    const local = event => {
        const rect = stage.getBoundingClientRect?.() ?? { left: 0, top: 0 };
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    listen(stage, 'pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button) return;
        stopAnimation();
        measure();
        if (!pointers.size) {
            moved = 0;
            dropClick = false;
        }
        pointers.set(event.pointerId, local(event));
    });
    listen(stage, 'pointermove', event => {
        const before = pointers.get(event.pointerId);
        if (!before) return;
        const now = local(event);
        if (pointers.size === 1) {
            moved += Math.abs(now.x - before.x) + Math.abs(now.y - before.y);
            pointers.set(event.pointerId, now);
            if (moved > DRAG_THRESHOLD && captured === null) {
                captured = event.pointerId;
                try { stage.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
                stage.classList.add('sd-map-dragging');
            }
            if (moved > DRAG_THRESHOLD) setView(panBy(view, now.x - before.x, now.y - before.y, box, limits));
            return;
        }
        const [a, b] = [...pointers.values()];
        const oldMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const oldDistance = Math.hypot(a.x - b.x, a.y - b.y);
        pointers.set(event.pointerId, now);
        const [c, d] = [...pointers.values()];
        const newMid = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
        const newDistance = Math.hypot(c.x - d.x, c.y - d.y);
        moved = Infinity;
        let next = oldDistance > 0 && newDistance > 0 ? zoomAt(view, newDistance / oldDistance, oldMid.x, oldMid.y, size.width, size.height, box, limits) : view;
        next = panBy(next, newMid.x - oldMid.x, newMid.y - oldMid.y, box, limits);
        setView(next);
    });
    const release = event => {
        if (!pointers.delete(event.pointerId) || pointers.size) return;
        // A drag that ends on a place must not pick it: the click that follows is dropped.
        if (moved > DRAG_THRESHOLD) {
            dropClick = true;
            win?.setTimeout?.(() => { dropClick = false; }, 0);
        }
        if (captured !== null) {
            try { stage.releasePointerCapture?.(captured); } catch { /* already released */ }
            captured = null;
        }
        stage.classList.remove('sd-map-dragging');
    };
    listen(stage, 'pointerup', release);
    listen(stage, 'pointercancel', release);
    listen(stage, 'wheel', event => {
        event.preventDefault?.();
        stopAnimation();
        measure();
        const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * size.height : event.deltaY;
        const at = local(event);
        setView(zoomAt(view, Math.exp(-(Number(delta) || 0) * WHEEL_RATE), at.x, at.y, size.width, size.height, box, limits));
    }, { passive: false });

    // A click elsewhere closes the results list.
    if (typeof doc.addEventListener === 'function') {
        listen(doc, 'click', event => {
            if (!results.hidden && !searchBox.contains?.(event.target)) results.hidden = true;
        });
    }

    const Observer = win?.ResizeObserver ?? globalThis.ResizeObserver;
    let observer = null;
    if (typeof Observer === 'function') {
        observer = new Observer(() => {
            const before = size;
            measure();
            if (before.width === size.width && before.height === size.height) return;
            const zoom = zoomLevel(view, fitK);
            fitK = fitNow().k;
            limits = zoomLimits(fitK, nearestGap(shown.map(place => points.get(place.id))));
            view = clampView({ ...view, k: zoom * fitK }, box, limits);
            paint();
        });
        observer.observe(stage);
    }

    function load(next, first) {
        data = readView(next);
        viewKey = text(next?.viewKey) || 'map';
        onSelect = text(next?.onSelect);
        root.setAttribute('aria-label', text(next?.label) || 'Map');
        // "Centre on where you are" works once a place is known (breaker a3-2): until then it is off and says why.
        centreMe.disabled = !data.current;
        centreMe.setAttribute('title', data.current ? 'Centre on where you are' : 'Centre on where you are (once the story names where you are)');
        computePoints();
        const keep = !first && (layer === ALL || data.layers.some(item => item.id === layer));
        if (keep) {
            // A state update keeps the reader's layer, pan and zoom.
            const zoom = zoomLevel(view, fitK);
            const centre = { cx: view.cx, cy: view.cy };
            setLayer(layer, { refit: true });
            view = clampView({ ...centre, k: zoom * fitK }, box, limits);
            paint();
        } else setLayer(data.layer);
        if (picked && !byId(picked)) showDetails('');
        else if (picked) showDetails(picked);
        if (input.value) runSearch();
    }

    measure();
    load(props, true);
    return {
        update: next => load(next, false),
        destroy() {
            stopAnimation();
            observer?.disconnect?.();
            for (const [node, type, fn, options] of listeners) node.removeEventListener(type, fn, options);
            listeners.length = 0;
            root.remove();
        },
        // For tests and the preview: the view as the widget holds it.
        get state() {
            return { layer, view: { ...view }, fitK, limits: { ...limits }, picked, size: { ...size } };
        },
    };
}

/** Prop problems (wrong types only, as Story Block's widgets report them). */
function validate(props = {}) {
    const problems = [];
    for (const name of ['onSelect', 'label', 'viewKey']) if (props[name] !== undefined && typeof props[name] !== 'string') problems.push(`${name} must be text.`);
    if (props.value !== undefined && (props.value === null || typeof props.value !== 'object')) problems.push('value must be the atlas.view data.');
    return problems;
}

/** The widget definition the module registers (module.js merges every part's `widgets`). */
export const atlasMapWidget = Object.freeze({
    props: Object.freeze({
        places: Object.freeze({ type: 'array', default: Object.freeze([]) }),
        routes: Object.freeze({ type: 'array', default: Object.freeze([]) }),
        layers: Object.freeze({ type: 'array', default: Object.freeze([]) }),
        layer: Object.freeze({ type: 'string', default: '' }),
        current: Object.freeze({ type: 'string', default: '' }),
        kinds: Object.freeze({ type: 'object', default: null }),
        orient: Object.freeze({ type: 'object', default: null }),
        onSelect: Object.freeze({ type: 'string', default: '' }),
        label: Object.freeze({ type: 'string', default: 'Map' }),
        viewKey: Object.freeze({ type: 'string', default: 'map' }),
    }),
    primary: 'places',
    validate,
    render,
});
