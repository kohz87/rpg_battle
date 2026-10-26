// Story Director v2, atlas part: the canonical place (contract §3 P24, "Canonical resolution"). Pure.
//
// One identity per place for every module that keys on a place (RPG Battle's area, shop, trainer, quest and save seams):
//   * a pack place is its content definition id (`pack.<id>/<slug>`), **before and after** the story materializes it as a `pl_` place;
//   * a place no pack has is its own `pl_` id, mapped to itself;
//   * a name that more than one pack's place answers to, or an own place that matches several packs, is **ambiguous**: null, held until
//     the player binds it (`atlas.placeBind`). Every pack candidate is inspected before names are made unique.
// An identity once established (`atlas.placeRefs`) never changes. `pack:<key>` is the map's node id, not an identity: it resolves to the one
// definition of that key or to nothing.

import { PACK_NODE, findPlace, keyOf } from './domain.js';

/** The pack candidates that answer to a name key (by name or alias). */
export const byKey = (candidates, key) => (candidates ?? []).filter(candidate => candidate.key === key || candidate.aliases.includes(key));

/** The keys an own place answers to: its name and every alias the atlas keeps for it. */
export function keysOf(atlas, place) {
    return [keyOf(place.name), ...Object.entries(atlas?.keys ?? {}).filter(([, id]) => id === place.id).map(([alias]) => alias)].filter((key, at, all) => key && all.indexOf(key) === at);
}

/** The pack definitions an own place could be: the candidates answering to any of its keys, each once, in id order. */
export function candidatesOf(atlas, pack, place) {
    const found = new Map();
    for (const key of keysOf(atlas, place)) for (const candidate of byKey(pack?.candidates, key)) found.set(candidate.id, candidate);
    return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

const refsOf = atlas => (atlas?.placeRefs && typeof atlas.placeRefs === 'object' ? atlas.placeRefs : {});
const regionOf = (atlas, id) => atlas?.placeRegions?.[id] ?? null;

/** The place that holds a definition: the own `pl_` place bound to it (placeRefs), else the unique own place only that definition fits, else null. */
export function placeOfDefinition(atlas, pack, definition) {
    const bound = Object.entries(refsOf(atlas)).find(([, target]) => target === definition)?.[0];
    if (bound && Object.hasOwn(atlas?.places ?? {}, bound)) return atlas.places[bound];
    const fit = Object.values(atlas?.places ?? {}).filter(place => !refsOf(atlas)[place.id] && candidatesOf(atlas, pack, place).length === 1 && candidatesOf(atlas, pack, place)[0].id === definition);
    return fit.length === 1 ? fit[0] : null;
}

/** Where an identity comes from: a pack's content id, or the atlas's own `pl_` place. */
const sourceOf = id => (String(id).startsWith('pack.') ? 'pack' : 'atlas');

function out(atlas, id, name, own, source) {
    return { id, name, atlasId: own?.id ?? null, regionId: regionOf(atlas, id), source };
}

/**
 * The canonical place of `ref` (an id, a node id, a name or an alias):
 * `{ id, name, atlasId, regionId, source: 'pack' | 'atlas' } | null`. `pack`: packWorld's answer (with `candidates`).
 */
export function canonicalOf(atlas, pack, ref) {
    if (ref === null || ref === undefined || String(ref).trim() === '') return null;
    const text = String(ref).trim();
    const candidates = pack?.candidates ?? [];
    // A definition id names itself, materialized or not.
    const definition = candidates.find(candidate => candidate.id === text);
    if (definition) return out(atlas, definition.id, definition.name, placeOfDefinition(atlas, pack, definition.id), 'pack');
    // A pack that is gone leaves its mapping: the place still answers to the definition it was bound to.
    const kept = Object.entries(refsOf(atlas)).find(([place, target]) => target === text && Object.hasOwn(atlas?.places ?? {}, place))?.[0];
    if (kept) return out(atlas, text, atlas.places[kept].name, atlas.places[kept], sourceOf(text));
    if (text.startsWith(PACK_NODE)) {
        const found = byKey(candidates, text.slice(PACK_NODE.length));
        const unique = [...new Set(found.map(candidate => candidate.id))];
        return unique.length === 1 ? canonicalOf(atlas, pack, unique[0]) : null;
    }
    const own = findPlace(atlas, text);
    if (own) {
        const ref = refsOf(atlas)[own.id];
        if (ref) {
            return out(atlas, ref, own.name, own, sourceOf(ref));
        }
        const fits = candidatesOf(atlas, pack, own);
        if (fits.length === 0) return out(atlas, own.id, own.name, own, 'atlas');
        if (fits.length === 1) return out(atlas, fits[0].id, own.name, own, 'pack');
        return null;
    }
    const found = byKey(candidates, keyOf(text));
    const unique = [...new Set(found.map(candidate => candidate.id))];
    return unique.length === 1 ? canonicalOf(atlas, pack, unique[0]) : null;
}

/** The definitions a held (ambiguous or unbound) own place could be bound to: `atlas.candidates`. → Ref[] in id order. */
export function definitionsFor(atlas, pack, ref) {
    const own = findPlace(atlas, ref);
    if (!own) return [];
    const taken = new Set(Object.values(refsOf(atlas)));
    return candidatesOf(atlas, pack, own).map(candidate => candidate.id).filter(id => !taken.has(id) || refsOf(atlas)[own.id] === id);
}

/**
 * Records a place's canonical identity in `atlas.placeRefs` once it is certain: its pack's content id when exactly one pack place fits and no
 * other place holds it, itself when no pack place fits. A place that fits several waits for the player (`atlas.placeBind`). It never changes
 * one already recorded. → whether it wrote.
 */
export function recordRef(atlas, pack, place) {
    atlas.placeRefs ??= {};
    if (atlas.placeRefs[place.id]) return false;
    const fits = candidatesOf(atlas, pack, place);
    let target = null;
    // No pack place fits: the place is its own, unless the packs could not be read at all (then it is held: a pack that fits may be only unread).
    if (fits.length === 0) target = pack?.readable === false ? null : place.id;
    else if (fits.length === 1 && !Object.values(atlas.placeRefs).includes(fits[0].id)) target = fits[0].id;
    if (!target) return false;
    atlas.placeRefs[place.id] = target;
    return true;
}
