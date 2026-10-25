// Story Director v2, part **atlas**: the `atlas` domain's shape, validator and name index (pure).
//
// atlas = {
//   places: { [id]: { id, name, region, kind, layer, x?, y?, discovered, rev, made? } },
//   routes: { [id]: { id, from, to, kind, days?, hours?, made? } },
//   keys:   { [keyOf(name or alias)]: placeId },
//   focus:  null | placeId | 'pack:<key>',        // the place the reader picked on the map
//   regions:      { [rg_ id]: { id, name, aliases } },              // the reader's regions (policy.js); never made from a place's text
//   placeRegions: { [canonical place id]: rg_ id },                 // explicit membership only
//   placeRefs:    { [pl_ id]: canonical place id },                 // pl_ -> the pack's content id, or itself for a place no pack has (canonical.js)
//   danger:       { world: AreaPolicy|null, regions: {rg_: AreaPolicy}, places: {canonical id: AreaPolicy} }
//   writes:       { [write id]: { fingerprint, result } }           // the retry ledger of the new writers (../writes.js)
// }
// The last five arrived with contract P24; an older save has none of them and reads them as empty.
// Places and routes from enabled packs (`packs.content`) are not copied in: they are read live
// (world.js) and show as known but undiscovered until the story goes there, when `atlas.visit`
// adds the place here.
// A place is known by its name and every name it was reached by (a rename keeps the old one as
// an alias). `discovered` is false for a place only a route line named, until the story goes
// there or describes it. `layer` is the place's plane ("underground"), '' on the surface.
// Numbers are whole (SPEC §2.1, and the host keeps a whole number whole): coordinates in map
// units, a route's time in whole days and hours. `made` is the reply whose lines added the place or
// route (its record ID, Story Block's ctx.carrier.sid): a reply's new ones are counted from it
// (capture.js NEW_PER_REPLY), so no count is kept that a deleted reply could leave wrong (B-b1r2-7).

import { ledgerProblems } from '../writes.js';

export const PLACE_ID = /^pl_[0-9a-z]{8}$/;
export const ROUTE_ID = /^rt_[0-9a-z]{8}$/;
export const MAX_NAME = 80;
/** A pack place the atlas has not got yet is node `pack:<key>` on the map. */
export const PACK_NODE = 'pack:';
const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function initialAtlas() {
    return { places: {}, routes: {}, keys: {}, focus: null, regions: {}, placeRegions: {}, placeRefs: {}, danger: { world: null, regions: {}, places: {} }, writes: {} };
}

export const REGION_ID = /^rg_[0-9a-z]{8}$/;
export const MAX_REGIONS = 64;
export const MAX_ALIASES = 16;

// Invisible format marks (zero-width spaces and joiners, bidi overrides): "Ro\u200Bpe" and "\u202ERope"
// are "Rope", as Story Block reads its own names (names.js).
const INVISIBLE = /\p{Cf}+/gu;

/** The key a name is found by: v1's place book key (apostrophes dropped, spaces folded, lowercase). */
export const keyOf = name => String(name ?? '').replace(INVISIBLE, '').normalize('NFKC').replace(/['’‘`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
// The key as it was made before invisible marks were dropped, so a map saved then still checks out.
const keptKeyOf = name => String(name ?? '').normalize('NFKC').replace(/['’‘`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A name as it is kept: invisible marks and markdown marks dropped, NFC, spaces folded, at most 80 characters. */
export function cleanName(name) {
    return String(name ?? '').replace(INVISIBLE, '').normalize('NFC').replace(/\*\*|__|[*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
}

/** A kind, region or layer word as it is kept: lowercase for kinds, as written for the rest. */
export const cleanWord = (value, { lower = false } = {}) => {
    const text = cleanName(value);
    return lower ? text.toLowerCase() : text;
};

const isInt = value => Number.isSafeInteger(value);
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The revision this command commits as (MODULES §F2 `ctx.rev`), 0 when the host does not say. */
export const revOf = ctx => (Number.isSafeInteger(ctx?.rev) ? ctx.rev : 0);

/** A fresh `<prefix>_xxxxxxxx` id from the command's seed (no Math.random), not in `taken`. */
export function newId(ctx, prefix, taken) {
    for (let tries = 0; tries < 64; tries += 1) {
        let id = '';
        for (let i = 0; i < 8; i += 1) id += ID_CHARS[Math.floor(ctx.rng() * ID_CHARS.length) % ID_CHARS.length];
        id = `${prefix}_${id}`;
        if (!Object.hasOwn(taken, id)) return id;
    }
    throw new Error(`No free ${prefix} id.`);
}

/** The place `ref` names: an id, or a name or alias. Null when none. */
export function findPlace(atlas, ref) {
    if (!atlas || ref === null || ref === undefined) return null;
    const text = String(ref);
    if (Object.hasOwn(atlas.places ?? {}, text)) return atlas.places[text];
    const id = atlas.keys?.[keyOf(text)];
    return id && Object.hasOwn(atlas.places ?? {}, id) ? atlas.places[id] : null;
}

/** Places in a fixed order (the same however and whenever they were touched): by name, then id. */
export function orderedPlaces(atlas) {
    return Object.values(atlas?.places ?? {}).sort((a, b) => keyOf(a.name).localeCompare(keyOf(b.name)) || (a.id < b.id ? -1 : 1));
}

/** Routes in a fixed order: by the places' order, then kind, then id. */
export function orderedRoutes(atlas) {
    const rank = new Map(orderedPlaces(atlas).map((place, index) => [place.id, index]));
    const at = id => rank.get(id) ?? Infinity;
    return Object.values(atlas?.routes ?? {}).sort((a, b) => Math.min(at(a.from), at(a.to)) - Math.min(at(b.from), at(b.to))
        || Math.max(at(a.from), at(a.to)) - Math.max(at(b.from), at(b.to)) || a.kind.localeCompare(b.kind) || (a.id < b.id ? -1 : 1));
}

/** The routes between two place ids, either way round. */
export const routesBetween = (atlas, a, b) => orderedRoutes(atlas).filter(route => (route.from === a && route.to === b) || (route.from === b && route.to === a));

/** A route's time in hours (days count 24), or null when the story gave none. */
export function routeHours(route) {
    if (!route || (route.days === undefined && route.hours === undefined)) return null;
    return (route.days ?? 0) * 24 + (route.hours ?? 0);
}

function placeErrors(id, place) {
    const at = `atlas.places.${id}`;
    if (!isRecord(place)) return [`${at} is not a place.`];
    const errors = [];
    if (!PLACE_ID.test(id) || place.id !== id) errors.push(`${at} has a bad id.`);
    if (typeof place.name !== 'string' || !keyOf(place.name) || place.name.length > MAX_NAME) errors.push(`${at} needs a name of at most ${MAX_NAME} characters.`);
    for (const field of ['region', 'kind', 'layer']) {
        if (typeof place[field] !== 'string' || place[field].length > MAX_NAME) errors.push(`${at}.${field} must be text of at most ${MAX_NAME} characters.`);
    }
    const hasX = place.x !== undefined;
    const hasY = place.y !== undefined;
    if (hasX !== hasY) errors.push(`${at} needs both x and y, or neither.`);
    else if (hasX && !(isInt(place.x) && isInt(place.y))) errors.push(`${at}: x and y must be whole map units.`);
    if (typeof place.discovered !== 'boolean') errors.push(`${at}.discovered must be true or false.`);
    if (!isInt(place.rev) || place.rev < 0) errors.push(`${at}.rev must be a whole number.`);
    if (place.made !== undefined && !(typeof place.made === 'string' && place.made && place.made.length <= MAX_NAME)) errors.push(`${at}.made must name a reply.`);
    for (const key of Object.keys(place)) {
        if (!['id', 'name', 'region', 'kind', 'layer', 'x', 'y', 'discovered', 'rev', 'made'].includes(key)) errors.push(`${at} has an unknown field "${key}".`);
    }
    return errors;
}

function routeErrors(id, route, places) {
    const at = `atlas.routes.${id}`;
    if (!isRecord(route)) return [`${at} is not a route.`];
    const errors = [];
    if (!ROUTE_ID.test(id) || route.id !== id) errors.push(`${at} has a bad id.`);
    if (!Object.hasOwn(places, route.from) || !Object.hasOwn(places, route.to)) errors.push(`${at} leads to a place the atlas does not have.`);
    if (route.from === route.to) errors.push(`${at} leads nowhere (both ends are the same place).`);
    if (typeof route.kind !== 'string' || route.kind.length > MAX_NAME) errors.push(`${at}.kind must be text.`);
    for (const field of ['days', 'hours']) {
        if (route[field] !== undefined && !(isInt(route[field]) && route[field] >= 0)) errors.push(`${at}.${field} must be a whole number.`);
    }
    if (routeHours(route) === 0) errors.push(`${at} takes no time at all.`);
    if (route.made !== undefined && !(typeof route.made === 'string' && route.made && route.made.length <= MAX_NAME)) errors.push(`${at}.made must name a reply.`);
    for (const key of Object.keys(route)) {
        if (!['id', 'from', 'to', 'kind', 'days', 'hours', 'made'].includes(key)) errors.push(`${at} has an unknown field "${key}".`);
    }
    return errors;
}

// ---- the policy parts (contract P24) -----------------------------------------------------------------------------------------

/** A canonical place id: a pack's content id (`pack.<id>/<slug>`) or the place's own pl_ id. */
export const CANONICAL_ID = /^(?:pl_[0-9a-z]{8}|pack\.[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/;
const textOk = (value, max) => typeof value === 'string' && value.length <= max;

/** The problems of an AreaPolicy `{ tier: 0..9, allowedFoes: Ref[] (1000), allowedTags: text[] (32, 1..40), lore: text[] (16, 240) }`. */
export function areaPolicyProblems(policy, where) {
    if (!isRecord(policy)) return [`${where} is not a policy.`];
    const errors = [];
    if (!Number.isSafeInteger(policy.tier) || policy.tier < 0 || policy.tier > 9) errors.push(`${where}.tier is a whole number from 0 to 9.`);
    if (!Array.isArray(policy.allowedFoes) || policy.allowedFoes.length > 1000 || !policy.allowedFoes.every(ref => textOk(ref, 160) && ref)) errors.push(`${where}.allowedFoes is a list of at most 1000 refs.`);
    if (!Array.isArray(policy.allowedTags) || policy.allowedTags.length > 32 || !policy.allowedTags.every(tag => textOk(tag, 40) && tag)) errors.push(`${where}.allowedTags is a list of at most 32 tags of 1 to 40 characters.`);
    if (!Array.isArray(policy.lore) || policy.lore.length > 16 || !policy.lore.every(line => textOk(line, 240))) errors.push(`${where}.lore is a list of at most 16 lines of 240 characters.`);
    for (const key of Object.keys(policy)) if (!['tier', 'allowedFoes', 'allowedTags', 'lore'].includes(key)) errors.push(`${where} has an unknown field "${key}".`);
    return errors;
}

function policyErrors(slice, places) {
    const errors = [];
    const regions = slice.regions ?? {};
    if (!isRecord(regions) || Object.keys(regions).length > MAX_REGIONS) errors.push(`atlas.regions is a record of at most ${MAX_REGIONS}.`);
    else {
        const names = new Set();
        for (const [id, region] of Object.entries(regions)) {
            const at = `atlas.regions.${id}`;
            if (!REGION_ID.test(id) || !isRecord(region) || region.id !== id || !textOk(region.name, MAX_NAME) || !keyOf(region.name)) errors.push(`${at} is not a region.`);
            else if (!Array.isArray(region.aliases) || region.aliases.length > MAX_ALIASES || !region.aliases.every(alias => textOk(alias, MAX_NAME) && keyOf(alias))) errors.push(`${at}.aliases is a list of at most ${MAX_ALIASES} names.`);
            else for (const key of [region.name, ...region.aliases].map(keyOf)) {
                if (names.has(key)) errors.push(`${at}: the name "${key}" belongs to two regions.`);
                names.add(key);
            }
        }
    }
    const known = isRecord(regions) ? regions : {};
    const placeRegions = slice.placeRegions ?? {};
    if (!isRecord(placeRegions)) errors.push('atlas.placeRegions is not an object.');
    else for (const [place, region] of Object.entries(placeRegions)) if (!CANONICAL_ID.test(place) || !Object.hasOwn(known, region)) errors.push(`atlas.placeRegions["${place}"] names a place and a region the atlas has.`);
    const placeRefs = slice.placeRefs ?? {};
    if (!isRecord(placeRefs)) errors.push('atlas.placeRefs is not an object.');
    else {
        const targets = new Set();
        for (const [place, target] of Object.entries(placeRefs)) {
            if (!PLACE_ID.test(place) || (places && !Object.hasOwn(places, place)) || typeof target !== 'string' || !CANONICAL_ID.test(target) || (!target.startsWith('pack.') && target !== place)) errors.push(`atlas.placeRefs["${place}"] maps a place to its pack's content id, or to itself.`);
            else if (targets.has(target)) errors.push(`atlas.placeRefs: ${target} is two places.`);
            targets.add(target);
        }
    }
    const danger = slice.danger ?? { world: null, regions: {}, places: {} };
    if (!isRecord(danger) || !isRecord(danger.regions) || !isRecord(danger.places) || !(danger.world === null || isRecord(danger.world))) errors.push('atlas.danger is { world, regions, places }.');
    else {
        if (danger.world !== null) errors.push(...areaPolicyProblems(danger.world, 'atlas.danger.world'));
        for (const [id, policy] of Object.entries(danger.regions)) errors.push(...(Object.hasOwn(known, id) ? areaPolicyProblems(policy, `atlas.danger.regions.${id}`) : [`atlas.danger.regions.${id} names no region.`]));
        for (const [id, policy] of Object.entries(danger.places)) errors.push(...(CANONICAL_ID.test(id) ? areaPolicyProblems(policy, `atlas.danger.places.${id}`) : [`atlas.danger.places["${id}"] names no place.`]));
        for (const key of Object.keys(danger)) if (!['world', 'regions', 'places'].includes(key)) errors.push(`atlas.danger has an unknown field "${key}".`);
    }
    if (slice.writes !== undefined) errors.push(...ledgerProblems(slice.writes, 'atlas.writes'));
    return errors;
}

/** `validate(slice, state) → string[]` (SPEC §2.5). */
export function validateAtlas(slice) {
    if (!isRecord(slice)) return ['atlas is not an object.'];
    const errors = [];
    const places = isRecord(slice.places) ? slice.places : null;
    if (!places) errors.push('atlas.places is not an object.');
    else for (const [id, place] of Object.entries(places)) errors.push(...placeErrors(id, place));
    if (!isRecord(slice.routes)) errors.push('atlas.routes is not an object.');
    else if (places) for (const [id, route] of Object.entries(slice.routes)) errors.push(...routeErrors(id, route, places));
    if (!isRecord(slice.keys)) errors.push('atlas.keys is not an object.');
    else if (places) {
        for (const [key, id] of Object.entries(slice.keys)) {
            if (!Object.hasOwn(places, id)) errors.push(`atlas.keys["${key}"] points at no place.`);
            else if (!key || (key !== keyOf(key) && key !== keptKeyOf(key))) errors.push(`atlas.keys["${key}"] is not a name key.`);
        }
        for (const place of Object.values(places)) {
            if (typeof place?.name === 'string' && slice.keys[keyOf(place.name)] !== place.id && slice.keys[keptKeyOf(place.name)] !== place.id) errors.push(`"${place.name}" is missing from atlas.keys.`);
        }
    }
    const focus = slice.focus;
    const packFocus = typeof focus === 'string' && focus.startsWith(PACK_NODE) && keyOf(focus.slice(PACK_NODE.length)) === focus.slice(PACK_NODE.length) && focus.length > PACK_NODE.length;
    if (focus !== null && !packFocus && !(typeof focus === 'string' && places && Object.hasOwn(places, focus))) errors.push('atlas.focus must be null or a place on the map.');
    errors.push(...policyErrors(slice, places));
    for (const key of Object.keys(slice)) {
        if (!['places', 'routes', 'keys', 'focus', 'regions', 'placeRegions', 'placeRefs', 'danger', 'writes'].includes(key)) errors.push(`atlas has an unknown field "${key}".`);
    }
    return errors;
}
