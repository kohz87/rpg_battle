// Story Director v2, atlas part: the Map widget's maths (pure, no DOM).
//
// Map space: the world's coordinates turned the way the reader's map settings say (north up puts a
// larger y higher on screen; east left mirrors x). A view is `{ cx, cy, k }`: the map-space point at
// the stage's centre and the zoom in pixels per map unit. Everything here is deterministic: the same
// places, stage size and view always give the same picture, the same labels and the same search hits.

export const FIT_PAD = 0.15;          // share of the larger side kept free around the places
export const LONE_SPAN = 20;          // map units shown around a lone place
export const ZOOM_OUT = 0.5;          // at most 2× further out than "fit"
export const ZOOM_IN = 8;             // at least 8× closer than "fit"…
export const NEAR_PX = 64;            // …and close enough that the two nearest places are this far apart
export const MAX_ZOOM_SPAN = 5000;    // never more than this × "fit"
export const KNOWN_LABEL_ZOOM = 3;    // unvisited places get their name from this zoom (× "fit")
export const KNOWN_ICON_ZOOM = 2;     // and their icon from this one

const finite = value => typeof value === 'number' && Number.isFinite(value);

/** A place's map-space point, or null without coordinates. `orient`: `{ north: 'up'|'down', east: 'right'|'left' }`. */
export function mapPoint(place, orient = {}) {
    if (!finite(place?.x) || !finite(place?.y)) return null;
    return { x: orient.east === 'left' ? -place.x : place.x, y: orient.north === 'down' ? place.y : -place.y };
}

/** The box around map-space points `{ minX, minY, maxX, maxY }` (a lone point or none gets LONE_SPAN around it). */
export function boundsOf(points) {
    const list = points.filter(Boolean);
    if (!list.length) return { minX: -LONE_SPAN / 2, minY: -LONE_SPAN / 2, maxX: LONE_SPAN / 2, maxY: LONE_SPAN / 2 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { x, y } of list) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (maxX - minX === 0 && maxY - minY === 0) {
        minX -= LONE_SPAN / 2; maxX += LONE_SPAN / 2;
        minY -= LONE_SPAN / 2; maxY += LONE_SPAN / 2;
    }
    return { minX, minY, maxX, maxY };
}

/** The view that shows the whole box on a `width` × `height` stage, centred, with FIT_PAD free around it. */
export function fitView(box, width, height) {
    const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
    const pad = span * FIT_PAD;
    const w = box.maxX - box.minX + 2 * pad || 1;
    const h = box.maxY - box.minY + 2 * pad || 1;
    return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, k: Math.min(width / w, height / h) };
}

/** The shortest distance between two different map-space points (null with fewer than two). */
export function nearestGap(points) {
    const list = points.filter(Boolean);
    let best = Infinity;
    for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
            const d = Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y);
            if (d > 0 && d < best) best = d;
        }
    }
    return Number.isFinite(best) ? best : null;
}

/**
 * The zoom range for a layer `{ min, max }` in pixels per unit: from 2× further out than "fit" to
 * 8× closer, or closer still when places sit so tight that the two nearest need it to stand
 * NEAR_PX apart (a village's streets inside a whole country), never beyond MAX_ZOOM_SPAN × "fit".
 */
export function zoomLimits(fitK, gap = null) {
    const near = gap ? NEAR_PX / gap : 0;
    return { min: fitK * ZOOM_OUT, max: Math.min(fitK * MAX_ZOOM_SPAN, Math.max(fitK * ZOOM_IN, near)) };
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** The view with its zoom inside `limits` and its centre inside `box` (the view never leaves the world). */
export function clampView(view, box, limits) {
    return {
        cx: clamp(view.cx, box.minX, box.maxX),
        cy: clamp(view.cy, box.minY, box.maxY),
        k: limits ? clamp(view.k, limits.min, limits.max) : view.k,
    };
}

/** Map space → stage pixels. */
export const toScreen = (view, width, height, point) => ({ x: (point.x - view.cx) * view.k + width / 2, y: (point.y - view.cy) * view.k + height / 2 });

/** Stage pixels → map space. */
export const toMap = (view, width, height, sx, sy) => ({ x: view.cx + (sx - width / 2) / view.k, y: view.cy + (sy - height / 2) / view.k });

/** Zooms by `factor` (> 1 is closer) keeping the stage point (sx, sy) on the same map point. */
export function zoomAt(view, factor, sx, sy, width, height, box, limits) {
    const k = clamp(view.k * factor, limits.min, limits.max);
    const at = toMap(view, width, height, sx, sy);
    return clampView({ cx: at.x - (sx - width / 2) / k, cy: at.y - (sy - height / 2) / k, k }, box, limits);
}

/** Moves the view by (dx, dy) stage pixels (a drag to the right shows what is to the left). */
export const panBy = (view, dx, dy, box, limits) => clampView({ cx: view.cx - dx / view.k, cy: view.cy - dy / view.k, k: view.k }, box, limits);

/** The view centred on a map-space point, zoomed to at least `k` (inside the limits). */
export const centreOn = (view, point, box, limits, k = view.k) => clampView({ cx: point.x, cy: point.y, k: Math.max(view.k, k) }, box, limits);

/** How close a view is, relative to "fit" (1 = the whole layer). */
export const zoomLevel = (view, fitK) => (fitK > 0 ? view.k / fitK : 1);

/**
 * The part of segment a→b inside `rect` `{ x, y, w, h }` (Liang–Barsky), or null when none is.
 * Routes are drawn in stage pixels and cut to the stage: a line thousands of times longer than
 * the screen (a village street at a country's zoom) is never handed to the browser whole.
 */
export function clipSegment(a, b, rect) {
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const edges = [[-dx, a.x - rect.x], [dx, rect.x + rect.w - a.x], [-dy, a.y - rect.y], [dy, rect.y + rect.h - a.y]];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return null;
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > t1) return null;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return null;
            if (t < t1) t1 = t;
        }
    }
    return { a: { x: a.x + dx * t0, y: a.y + dy * t0 }, b: { x: a.x + dx * t1, y: a.y + dy * t1 } };
}

/** A step between two views for an eased move: `t` in 0..1 (zoom eases in log space). */
export function between(a, b, t) {
    const ease = 1 - (1 - t) ** 3;
    const k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * ease);
    return { cx: a.cx + (b.cx - a.cx) * ease, cy: a.cy + (b.cy - a.cy) * ease, k };
}

/**
 * Map-space points for places without coordinates, deterministically: beside a placed place a
 * route joins them to (one step round a circle per newcomer), else in a row under the rest.
 * `places`: `[{ id, point|null }]`; `links`: `[[idA, idB]]`. Returns `Map(id → point)` for all.
 */
export function placeUnplaced(places, links) {
    const at = new Map(places.filter(place => place.point).map(place => [place.id, place.point]));
    const box = boundsOf([...at.values()]);
    const step = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.06 || 1;
    const around = new Map();
    for (let pass = 0; pass < 3; pass += 1) {
        for (const place of places) {
            if (at.has(place.id)) continue;
            const link = links.find(([a, b]) => (a === place.id && at.has(b)) || (b === place.id && at.has(a)));
            if (!link) continue;
            const anchor = link[0] === place.id ? link[1] : link[0];
            const turn = around.get(anchor) ?? 0;
            around.set(anchor, turn + 1);
            const angle = turn * 2.399963;            // the golden angle: newcomers never stack
            const base = at.get(anchor);
            at.set(place.id, { x: base.x + Math.cos(angle) * step * (1 + turn * 0.25), y: base.y + Math.sin(angle) * step * (1 + turn * 0.25) });
        }
    }
    let row = 0;
    for (const place of places) {
        if (at.has(place.id)) continue;
        at.set(place.id, { x: box.minX + row * step * 2, y: box.maxY + step * 2 });
        row += 1;
    }
    return at;
}

// ---- labels ------------------------------------------------------------------------------------

export const LABEL_FONT_PX = 12;
const CHAR_PX = LABEL_FONT_PX * 0.56;
const LABEL_H = LABEL_FONT_PX + 6;
const GAP = 3;

/** A label's box size in pixels, estimated from its text (the same text always gets the same size). */
export const labelSize = text => ({ w: Math.ceil(String(text).length * CHAR_PX + 8), h: LABEL_H });

// The eight places a label may sit around its marker, in the order they are tried.
export const SLOTS = Object.freeze(['e', 'w', 'ne', 'se', 'nw', 'sw', 'n', 's']);

function slotBox(slot, x, y, r, size) {
    const dx = slot.includes('e') ? r + GAP : slot.includes('w') ? -(r + GAP) - size.w : -size.w / 2;
    let dy;
    if (slot === 'n') dy = -(r + GAP) - size.h;
    else if (slot === 's') dy = r + GAP;
    else if (slot.startsWith('n')) dy = -r - size.h / 2;
    else if (slot.startsWith('s')) dy = r - size.h / 2;
    else dy = -size.h / 2;
    return { x: x + dx, y: y + dy, w: size.w, h: size.h };
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A shorter label: the first word when that says enough, else the first 10 characters and "…". */
export function shorten(text) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (words.length > 1 && words[0].length >= 4) return `${words[0]}…`;
    return text.length > 11 ? `${text.slice(0, 10).trimEnd()}…` : text;
}

/**
 * Places labels so none overlaps another label or a marker, in priority order (first wins):
 * each tries its full text in the eight SLOTS, then its shortened text; a label that fits nowhere
 * is left out (its place still shows, and hover or focus brings the name back).
 * `items`: `[{ id, x, y, r, text }]` (stage pixels, already in priority order); `markers`: every
 * marker on screen `[{ id, x, y, r }]`; `width`/`height`: the stage. Returns `[{ id, slot, text, x, y, w, h }]`.
 */
export function placeLabels(items, markers, width, height) {
    const taken = [];
    const placed = [];
    const markerBoxes = markers.map(marker => ({ id: marker.id, box: { x: marker.x - marker.r, y: marker.y - marker.r, w: marker.r * 2, h: marker.r * 2 } }));
    const inside = box => box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height;
    for (const item of items) {
        let done = null;
        for (const text of [item.text, shorten(item.text)]) {
            const size = labelSize(text);
            for (const slot of SLOTS) {
                const box = slotBox(slot, item.x, item.y, item.r, size);
                if (!inside(box)) continue;
                if (taken.some(other => overlaps(box, other))) continue;
                if (markerBoxes.some(marker => marker.id !== item.id && overlaps(box, marker.box))) continue;
                done = { id: item.id, slot, text, ...box };
                break;
            }
            if (done || text === shorten(text)) break;
        }
        if (!done) continue;
        taken.push(done);
        placed.push(done);
    }
    return placed;
}

// ---- search ------------------------------------------------------------------------------------

/** Text as search compares it: accents and case gone, apostrophes dropped, other marks a space. */
export const fold = text => String(text ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/['’‘`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// At most one letter wrong, missing or extra (for words of four letters or more).
function nearWord(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i += 1; j += 1; continue; }
        edits += 1;
        if (edits > 1) return false;
        if (a.length > b.length) i += 1;
        else if (b.length > a.length) j += 1;
        else { i += 1; j += 1; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
}

// How well one folded query matches one folded text: 0 when it does not.
function scoreText(query, text) {
    if (!text) return 0;
    if (text === query) return 100;
    if (text.startsWith(query)) return 90;
    const words = text.split(' ');
    if (words.some(word => word.startsWith(query))) return 80;
    if (text.includes(query)) return 70;
    // Every query word starts a word of the text (in any order), or nearly matches one.
    const asked = query.split(' ');
    if (asked.every(part => words.some(word => word.startsWith(part)))) return 60;
    if (asked.every(part => words.some(word => word.startsWith(part) || (part.length >= 4 && nearWord(part, word.slice(0, part.length + 1)) || (part.length >= 4 && nearWord(part, word)))))) return 40;
    return 0;
}

/**
 * Places matching `text` by name, alias or region, best first: `[{ id, score, by }]` (`by`: 'name',
 * 'alias' or 'region'). Case, accents and one wrong letter in a longer word don't matter. Ties go
 * to visited places, then by name. `places`: `[{ id, name, aliases, region, visited }]`.
 */
export function searchPlaces(places, text, { limit = 8 } = {}) {
    const query = fold(text);
    if (!query) return [];
    const hits = [];
    for (const place of places) {
        const byName = scoreText(query, fold(place.name));
        const byAlias = Math.max(0, ...(place.aliases ?? []).map(alias => scoreText(query, fold(alias)))) * 0.9;
        // A region counts from the start of one of its words ("shorn" finds Shornmarch's places,
        // "watch" does not find every place in Bluewatch Village).
        const regionScore = scoreText(query, fold(place.region));
        const byRegion = (regionScore >= 80 || regionScore === 60 ? regionScore : 0) * 0.5;
        const score = Math.max(byName, byAlias, byRegion);
        if (score <= 0) continue;
        hits.push({ id: place.id, name: place.name, visited: Boolean(place.visited), score: Math.round(score), by: score === byName ? 'name' : score === byAlias ? 'alias' : 'region' });
    }
    hits.sort((a, b) => b.score - a.score || Number(b.visited) - Number(a.visited) || fold(a.name).localeCompare(fold(b.name)) || (a.id < b.id ? -1 : 1));
    return hits.slice(0, limit).map(({ id, score, by }) => ({ id, score, by }));
}
