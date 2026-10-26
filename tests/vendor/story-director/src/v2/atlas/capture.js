// Story Director v2, atlas part: the commands and the change lines that write the atlas (pure).
//
// Commands: `atlas.visit` (the story is at a place: beforeGenerate sends the scene's place when
// the atlas does not have it yet), `atlas.edit` (the reader's corrections: a new name, the
// coordinates, the layer, the region, the kind), `atlas.focus` (the place picked on the map; a
// click on anything else changes nothing). Kinds: `route` and `landmark` lines, run by Story
// Block as story commands (SPEC §4.2). A line the rules cannot use fails with a plain sentence,
// which Story Block keeps in its problems list; nothing is saved for it.

import { parseLocation } from '../../places.js';
import {
    MAX_NAME, PACK_NODE, cleanName, cleanWord, findPlace, isRecord, keyOf, newId, revOf, routesBetween,
} from './domain.js';
import { recordRef } from './canonical.js';
import { packPlace, packWorld, worldOf } from './world.js';

/** New places, and new routes, one reply's lines may add; a line that would add more is not used (B-b1r2-7). */
export const NEW_PER_REPLY = 16;
/** Places and routes the atlas keeps; past these a line that would add one is not used. */
export const MAX_PLACES = 400;
export const MAX_ROUTES = 800;

const ARROW = /\s*(?:→|⟶|➔|->|=>)\s*/u;
const AMOUNT = /^(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|d|days?)?$/i;

const asText = value => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));
const queryOf = ctx => (typeof ctx?.query === 'function' ? (name, args) => ctx.query(name, args) : null);

// The reply a story line comes from: its record ID (ctx.carrier.sid, which stays with it when an earlier
// message is deleted), else its "index:swipe" key; null outside a reply's capture.
function replyOf(ctx) {
    const carrier = ctx?.carrier;
    if (ctx?.cause !== 'story' || !carrier || typeof carrier !== 'object') return null;
    for (const value of [carrier.sid, carrier.key]) if (typeof value === 'string' && value && value.length <= MAX_NAME) return value;
    return null;
}

// The packs' places and routes, read once per reply's capture rather than once per line (each query
// gives a copy): kept while the lines of one reply follow one another (the same reply and text, later
// lines, later receipts), read again otherwise.
let packCache = null;
function packWorldFor(ctx, line) {
    const reply = replyOf(ctx);
    const index = Number.isSafeInteger(line?.index) ? line.index : -1;
    const rev = Number.isSafeInteger(ctx?.rev) ? ctx.rev : -1;
    const text = typeof ctx?.chat?.reply === 'string' ? ctx.chat.reply : null;
    const cached = packCache;
    if (reply && cached && cached.reply === reply && cached.text === text && index > cached.index && rev > cached.rev) {
        packCache = { ...cached, index, rev };
        return cached.world;
    }
    const world = packWorld(queryOf(ctx));
    packCache = reply ? { reply, text, index, rev, world } : null;
    return world;
}

/**
 * Why `adding` more places and `routes` more routes do not fit (one reply's NEW_PER_REPLY, the atlas's
 * MAX_PLACES and MAX_ROUTES), or ''. A reply's own are counted by `made` (domain.js).
 */
function noRoom(atlas, reply, { places = 0, routes = 0 }) {
    const count = (table, extra) => {
        if (!extra) return { all: 0, mine: 0 };
        const list = Object.values(atlas[table]);
        return { all: list.length + extra, mine: reply ? list.filter(entry => entry?.made === reply).length + extra : 0 };
    };
    const p = count('places', places);
    const r = count('routes', routes);
    if (p.mine > NEW_PER_REPLY) return `one reply adds at most ${NEW_PER_REPLY} new places to the map`;
    if (r.mine > NEW_PER_REPLY) return `one reply adds at most ${NEW_PER_REPLY} new routes to the map`;
    if (p.all > MAX_PLACES) return `the map keeps at most ${MAX_PLACES} places`;
    if (r.all > MAX_ROUTES) return `the map keeps at most ${MAX_ROUTES} routes`;
    return '';
}

// Whether `name` is a place the atlas has (by its name or the pack's name for it).
const onMap = (atlas, pack, name) => Boolean(findPlace(atlas, name) ?? findPlace(atlas, packPlace(pack, name)?.name));

/**
 * The atlas place for `name`, made when there is none: `{ place, created, changed }`.
 * A name the atlas lacks is looked up in the packs (by name or alias), and the pack's spelling,
 * region, kind and plane are used; its coordinates stay the pack's (read live, world.js), so
 * `coords` (the story's) are kept only for a place no pack knows.
 * `overwrite` (a landmark line, which says these on purpose): a given region, kind or layer
 * replaces the place's, and an empty one ('') clears it; one left out (undefined) keeps it.
 * Otherwise (the scene's place, a route's ends) they only fill empty fields, and a pack place's
 * region wins over the given one: the scene's region is the wider area the story is in ("River
 * Confederacy"), the pack's is where the place is ("Bluewatch Village"). A region that only
 * repeats the given one gives way to the pack's, so a place saved before this rule is mended.
 */
export function ensurePlace(atlas, ctx, pack, name, { discovered = true, region, kind, layer, coords = null, aliases = [], overwrite = false } = {}) {
    const given = cleanName(name);
    const fromPack = packPlace(pack, given);
    let place = findPlace(atlas, given) ?? (fromPack ? findPlace(atlas, fromPack.name) : null);
    const rev = revOf(ctx);
    let created = false;
    let changed = false;
    if (!place) {
        const id = newId(ctx, 'pl', atlas.places);
        const display = fromPack?.name ?? given;
        const first = (given, packs) => (overwrite && given !== undefined ? given : given || packs || '');
        place = {
            id, name: display, region: overwrite ? first(region, fromPack?.region) : fromPack?.region || region || '',
            kind: first(kind, fromPack?.kind), layer: first(layer, fromPack?.layer), discovered, rev,
        };
        if (coords && !fromPack) Object.assign(place, { x: Math.round(coords.x), y: Math.round(coords.y) });
        atlas.places[id] = place;
        atlas.keys[keyOf(display)] = id;
        if (!atlas.keys[keyOf(given)]) atlas.keys[keyOf(given)] = id;
        created = true;
        changed = true;
    } else {
        place = atlas.places[place.id];
        if (discovered && !place.discovered) {
            place.discovered = true;
            changed = true;
        }
        for (const [field, given] of [['region', region], ['kind', kind], ['layer', layer]]) {
            let value = given;
            if (!overwrite && field === 'region' && fromPack?.region) {
                value = fromPack.region;
                // A region that only repeats the scene's is the scene's word, not the reader's: mend it.
                if (place.region && place.region === given && place.region !== value) {
                    place.region = value;
                    changed = true;
                    continue;
                }
            }
            if (overwrite ? value === undefined || place[field] === value : !value || place[field]) continue;
            place[field] = value;
            changed = true;
        }
        if (coords && !fromPack && place.x === undefined) {
            Object.assign(place, { x: Math.round(coords.x), y: Math.round(coords.y) });
            changed = true;
        }
        if (changed) place.rev = rev;
    }
    for (const alias of aliases.map(keyOf).filter(Boolean)) {
        if (!atlas.keys[alias]) {
            atlas.keys[alias] = place.id;
            changed = true;
        }
    }
    // The place's canonical identity (contract P24): its pack's content id, or itself; written once, never told to the model.
    recordRef(atlas, pack, place);
    return { place, created, changed };
}

/** A whole-number route time from `days:` / `hours:` labels: `{ time }` (maybe `{}`) or `{ error }`. */
export function routeTime(labels = {}) {
    const read = (value, unit) => {
        if (value === undefined) return { value: undefined };
        const match = asText(value).trim().match(AMOUNT);
        if (!match) return { error: `"${unit}: ${value}" is not a number of ${unit}.` };
        const said = match[2]?.toLowerCase() ?? '';
        const amount = Number(match[1]);
        const inUnit = said.startsWith('d') ? 'days' : said.startsWith('h') ? 'hours' : unit;
        return { value: inUnit === unit ? amount : unit === 'days' ? amount / 24 : amount * 24 };
    };
    const days = read(labels.days, 'days');
    const hours = read(labels.hours, 'hours');
    if (days.error || hours.error) return { error: days.error ?? hours.error };
    if (days.value === undefined && hours.value === undefined) return { time: {} };
    const total = (days.value ?? 0) * 24 + (hours.value ?? 0);
    if (!(total > 0)) return { error: 'A route takes some time: give hours or days above 0.' };
    const whole = [days.value, hours.value].every(value => value === undefined || Number.isInteger(value));
    if (!whole) return { time: { hours: Math.max(1, Math.round(total)) } };
    const time = {};
    if (days.value) time.days = days.value;
    if (hours.value) time.hours = hours.value;
    return { time };
}

/** "2 h", "1 day", "1 day 6 h" for a route's own time ('' when none). */
export function routeTimeText(route) {
    const parts = [];
    if (route?.days) parts.push(`${route.days} ${route.days === 1 ? 'day' : 'days'}`);
    if (route?.hours) parts.push(`${route.hours} h`);
    return parts.join(' ');
}

function lineText(line) {
    const labels = Object.entries(line?.labels ?? {}).map(([label, value]) => ` | ${label}: ${value}`).join('');
    return `${line?.op ?? ''} ${line?.kind ?? ''} ${line?.name ?? ''}${line?.text ? ` — ${line.text}` : ''}${labels}`.trim();
}

// The two ends a route line names: `A — B`, `A → B`, or `A | to: B`.
function routeEnds(line) {
    let from = cleanName(line?.name);
    let to = cleanName(line?.text) || cleanName(line?.labels?.to);
    if (!to && ARROW.test(from)) [from, to] = from.split(ARROW).map(cleanName);
    return { from, to };
}

/** `route` lines (`+`/`~` a route, `-` a route gone). */
export function applyRouteLine(ctx, line) {
    const op = line?.op;
    if (!['+', '~', '-'].includes(op)) return ctx.fail('INVALID', `"${lineText(line)}": route lines use +, ~ or -.`);
    const { from, to } = routeEnds(line);
    if (!keyOf(from) || !keyOf(to)) return ctx.fail('INVALID', `"${lineText(line)}" needs two places: + route Place — Other Place.`);
    if (keyOf(from) === keyOf(to)) return ctx.fail('INVALID', `"${lineText(line)}" leads from a place to itself.`);
    const kind = cleanWord(line?.labels?.kind, { lower: true });
    const atlas = ctx.draft('atlas');
    const pack = packWorldFor(ctx, line);

    if (op === '-') {
        const a = findPlace(atlas, from) ?? findPlace(atlas, packPlace(pack, from)?.name);
        const b = findPlace(atlas, to) ?? findPlace(atlas, packPlace(pack, to)?.name);
        const gone = a && b ? routesBetween(atlas, a.id, b.id).filter(route => !kind || route.kind === kind) : [];
        if (!gone.length) return ctx.fail('NOT_FOUND', `There is no route between ${from} and ${to} on the map.`);
        for (const route of gone) delete atlas.routes[route.id];
        return { summary: `The way between ${a.name} and ${b.name} is gone.`, narrate: false, data: { removed: gone.map(route => route.id) } };
    }

    const time = routeTime(line?.labels);
    if (time.error) return ctx.fail('INVALID', `"${lineText(line)}": ${time.error}`);
    const reply = replyOf(ctx);
    const newPlaces = [from, to].filter(name => !onMap(atlas, pack, name)).length;
    const knownA = findPlace(atlas, from) ?? findPlace(atlas, packPlace(pack, from)?.name);
    const knownB = findPlace(atlas, to) ?? findPlace(atlas, packPlace(pack, to)?.name);
    const already = knownA && knownB ? routesBetween(atlas, knownA.id, knownB.id) : [];
    const newRoute = !(kind ? already.some(entry => entry.kind === kind) : already.length);
    const full = noRoom(atlas, reply, { places: newPlaces, routes: newRoute ? 1 : 0 });
    if (full) return ctx.fail('REFUSED', `"${lineText(line)}" was not used: ${full}.`);
    const made = (entry, created) => {
        if (created && reply) entry.made = reply;
        return entry;
    };
    const ends = [from, to].map(name => ensurePlace(atlas, ctx, pack, name, { discovered: false }));
    const [a, b] = ends.map(end => made(end.place, end.created));
    const between = routesBetween(atlas, a.id, b.id);
    let route = (kind ? between.find(entry => entry.kind === kind) : between[0]) ?? null;
    const created = !route;
    if (created) {
        const id = newId(ctx, 'rt', atlas.routes);
        route = made({ id, from: a.id, to: b.id, kind }, true);
        atlas.routes[id] = route;
    } else route = atlas.routes[route.id];
    if (Object.keys(time.time).length) {
        delete route.days;
        delete route.hours;
        Object.assign(route, time.time);
    }
    const when = routeTimeText(route);
    const what = route.kind || 'route';
    return {
        summary: `${created ? 'A' : 'The'} ${what} joins ${a.name} and ${b.name}${when ? ` (${when})` : ''}.`,
        narrate: false,
        data: { route: route.id, created },
    };
}

// `at: 12, 40` (or `[12, 40]`) on a landmark: its coordinates.
function coordsOf(text) {
    const match = asText(text).match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/** `landmark` lines (`+`/`~`): a place the story describes, with its region, kind and plane. */
export function applyLandmarkLine(ctx, line) {
    const op = line?.op;
    if (op === '-') return ctx.fail('REFUSED', `"${lineText(line)}": places stay on the map; the reader can rename them on the Map.`);
    if (!['+', '~'].includes(op)) return ctx.fail('INVALID', `"${lineText(line)}": landmark lines use + or ~.`);
    const location = parseLocation(line?.name);
    const name = cleanName(location.name);
    if (!keyOf(name)) return ctx.fail('INVALID', `"${lineText(line)}" names no place.`);
    const labels = line?.labels ?? {};
    const atlas = ctx.draft('atlas');
    const pack = packWorldFor(ctx, line);
    const known = onMap(atlas, pack, name);
    const reply = replyOf(ctx);
    const full = known ? '' : noRoom(atlas, reply, { places: 1 });
    if (full) return ctx.fail('REFUSED', `"${lineText(line)}" was not used: ${full}.`);
    const aliases = asText(labels.aka ?? labels.alias).split(/\s*[,;]\s*/).map(cleanName).filter(Boolean);
    // A label left out keeps what the place has; one written empty (`| kind: `) clears it.
    const said = (value, options) => (value === undefined || value === null ? undefined : cleanWord(value, options));
    const kind = said(labels.kind, { lower: true });
    const { place, created } = ensurePlace(atlas, ctx, pack, name, {
        discovered: true,
        region: said(labels.region),
        kind: kind === undefined && !known && !packPlace(pack, name) ? 'landmark' : kind,
        layer: said(labels.plane ?? labels.layer),
        coords: coordsOf(labels.at) ?? location.coords,
        aliases,
        overwrite: true,
    });
    if (created && reply) place.made = reply;
    const about = [place.kind, place.region].filter(Boolean).join(', ');
    return { summary: `${place.name}${about ? ` (${about})` : ''} is on the map.`, narrate: false, data: { place: place.id, created } };
}

/** `atlas.visit { name, kind?, region? }`: the story is at this place. */
export function visit(ctx, payload = {}) {
    if (!isRecord(payload) || typeof payload.name !== 'string') return ctx.fail('INVALID', 'Say which place: { name }.');
    const location = parseLocation(payload.name);
    const name = cleanName(location.name);
    if (!keyOf(name)) return ctx.fail('INVALID', 'The place has no name.');
    const atlas = ctx.draft('atlas');
    const pack = packWorld(queryOf(ctx));
    const { place, created, changed } = ensurePlace(atlas, ctx, pack, name, {
        discovered: true,
        region: cleanWord(payload.region),
        kind: cleanWord(payload.kind, { lower: true }),
        coords: location.coords,
    });
    return { summary: changed ? `${place.name} is on the map.` : '', narrate: false, data: { place: place.id, created } };
}

const EDIT_FIELDS = ['place', 'name', 'x', 'y', 'layer', 'region', 'kind'];

/** `atlas.edit { place, name?, x?, y?, layer?, region?, kind? }`: the reader's corrections. */
export function edit(ctx, payload = {}) {
    if (!isRecord(payload)) return ctx.fail('INVALID', 'Say which place to change: { place, … }.');
    const unknown = Object.keys(payload).filter(key => !EDIT_FIELDS.includes(key));
    if (unknown.length) return ctx.fail('INVALID', `The map cannot change ${unknown.join(', ')}.`);
    const atlas = ctx.draft('atlas');
    let ref = payload.place;
    let found = findPlace(atlas, ref);
    // A pack place picked on the map: the reader's change makes it the atlas's.
    const pack = packWorld(queryOf(ctx));
    if (!found && typeof ref === 'string' && ref.startsWith(PACK_NODE)) ref = ref.slice(PACK_NODE.length);
    const fromPack = !found ? worldOf(atlas, pack).find(ref) : null;
    if (!found && !fromPack) return ctx.fail('NOT_FOUND', `There is no place "${asText(payload.place)}" on the map.`);
    const changes = [];
    const fields = {};
    if (payload.name !== undefined) {
        const name = cleanName(asText(payload.name));
        if (!keyOf(name)) return ctx.fail('INVALID', 'A place needs a name.');
        if (asText(payload.name).trim().length > MAX_NAME) return ctx.fail('INVALID', `A name has at most ${MAX_NAME} characters.`);
        fields.name = name;
    }
    for (const field of ['layer', 'region', 'kind']) {
        if (payload[field] === undefined) continue;
        if (typeof payload[field] !== 'string') return ctx.fail('INVALID', `The ${field} must be text.`);
        fields[field] = cleanWord(payload[field], { lower: field === 'kind' });
    }
    const hasX = payload.x !== undefined;
    const hasY = payload.y !== undefined;
    if (hasX !== hasY) return ctx.fail('INVALID', 'Give both coordinates, x and y (or both empty to clear them).');
    if (hasX && !((payload.x === null && payload.y === null) || [payload.x, payload.y].every(value => typeof value === 'number' && Number.isFinite(value)))) {
        return ctx.fail('INVALID', 'Coordinates are two numbers (or both empty to clear them).');
    }
    if (!Object.keys(fields).length && !hasX) return ctx.fail('INVALID', 'Nothing to change.');

    const place = found ? atlas.places[found.id] : ensurePlace(atlas, ctx, pack, fromPack.name, { discovered: false }).place;
    if (fields.name !== undefined && fields.name !== place.name) {
        const key = keyOf(fields.name);
        const owner = worldOf(atlas, pack).find(fields.name);
        if (owner && owner.id !== place.id) return ctx.fail('REFUSED', `There is already a place called ${owner.name}.`);
        changes.push(`now called ${fields.name}`);
        place.name = fields.name;
        atlas.keys[key] = place.id;   // the old name stays an alias
    }
    for (const field of ['layer', 'region', 'kind']) {
        if (fields[field] === undefined || fields[field] === place[field]) continue;
        place[field] = fields[field];
        changes.push(fields[field] ? `${field} ${fields[field]}` : `no ${field}`);
    }
    if (hasX) {
        if (payload.x === null) {
            if (place.x !== undefined) changes.push('no coordinates');
            delete place.x;
            delete place.y;
        } else {
            const x = Math.round(payload.x);
            const y = Math.round(payload.y);
            if (place.x !== x || place.y !== y) changes.push(`at ${x}, ${y}`);
            Object.assign(place, { x, y });
        }
    }
    place.rev = revOf(ctx);
    return { summary: changes.length ? `${place.name}: ${changes.join(', ')}.` : '', narrate: false, data: { place: place.id } };
}

/**
 * `atlas.focus { node }`: marks the place picked on the map for the screen. `node: null` clears
 * it; a node that is not on the map changes nothing (no error: a click never fails).
 */
export function focus(ctx, payload = {}) {
    const atlas = ctx.draft('atlas');
    const node = isRecord(payload) ? payload.node : undefined;
    if (node === null) {
        atlas.focus = null;
        return { summary: '', narrate: false, data: { node: null } };
    }
    const place = typeof node === 'string' ? worldOf(atlas, packWorld(queryOf(ctx))).find(node) : null;
    if (!place || place.id !== node) return { summary: '', narrate: false, data: { node: atlas.focus } };
    atlas.focus = place.id;
    return { summary: '', narrate: false, data: { node: place.id } };
}
