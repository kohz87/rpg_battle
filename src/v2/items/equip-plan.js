// Pure P07 equipment planning over explicit frozen inputs. SB alone writes stacks/ownership.
// No B storage layout, live-pack fallback, guessed rules hash or caller-supplied trusted plan.
import { hashJson } from './equip-hash.js';
import { EQUIP_SLOTS, SLOT_COUNTS, SLOT_LABELS, normalizeSlot } from './slots.js';

export { AMBIGUOUS_SLOTS, CANONICAL_ALIASES, EQUIP_SLOTS, SLOT_LABELS, isAmbiguousSlot, normalizeSlot } from './slots.js';
const STATS = ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const recordId = value => typeof value === 'string' && /^[a-z][a-z0-9]*_[0-9a-z]{8}$/.test(value);
const actorId = value => typeof value === 'string' && /^ac_[0-9a-z]{8}$/.test(value);
const ownerId = value => value === 'party' || actorId(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const failure = (code, message) => ({ ok: false, code, message });
export const isHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

const piece = stack => ({ id: stack.id, def: stack.def, qty: stack.qty, owner: stack.owner, equipped: stack.equipped });
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Byte-for-byte SB INVENTORY-SEAMS.md/equipInputHash input projection. */
export function equipInputHash({ rulesHash, actor, stats, life, targetSlot = null, stack, affected = [] }) {
    const others = new Map(affected.filter(other => other.id !== stack.id).map(other => [other.id, other]));
    return hashJson({ rulesHash, actor: { id: actor, stats, life }, slot: targetSlot,
        stack: piece(stack), affected: [...others.values()].sort(byId).map(piece) });
}

function ruleProblem(rule, def) {
    if (!record(rule) || rule.def !== def || !Array.isArray(rule.allowedSlots)
        || rule.allowedSlots.length > 2 || new Set(rule.allowedSlots).size !== rule.allowedSlots.length
        || rule.allowedSlots.some(slot => !EQUIP_SLOTS.includes(slot))
        || ![0, 1, 2].includes(rule.hands) || !record(rule.requires)
        || Object.entries(rule.requires).some(([key, min]) => !STATS.includes(key) || !Number.isSafeInteger(min) || min < 1 || min > 99)
        || !count(rule.weight) || rule.weight > 10000 || typeof rule.unique !== 'boolean'
        || Object.keys(rule).some(key => !['def', 'allowedSlots', 'hands', 'requires', 'weight', 'unique'].includes(key))) return true;
    if (rule.hands === 2 && (rule.allowedSlots.length !== 1 || rule.allowedSlots[0] !== 'weapon')) return true;
    return false;
}

const LIFE_WORDS = Object.freeze({
    dead: 'The dead cannot change their gear.',
    downed: 'Someone who is downed cannot change their gear.',
    'gravely-injured': 'Someone who is gravely injured cannot change their gear.',
});

/**
 * Whether `stack` is worn by `actor` (a sheet): the actor's own equipped stacks, and the party bag's
 * equipped stacks for the main character (the shared bag's worn pieces are theirs, as in SB's
 * wearerOf). The key may be any stored text; see `placedAt`.
 */
export const wornBy = (stack, actor) => record(stack) && stack.equipped !== null && stack.equipped !== undefined
    && (stack.owner === actor?.id || (stack.owner === 'party' && actor?.kind === 'pc'));

/**
 * The v2 slot a worn stack occupies, read through the §9 adapters (an `armour` key reads as body).
 * null for a key that names no single v2 slot (worn-1, a bare accessory...): such a record occupies
 * nothing, is never displaced or moved, and only an explicit choice of slot places it.
 */
export const placedAt = stack => normalizeSlot(stack?.equipped);

/**
 * PRIVATE owner handoff: env={stacks,defs,itemRules,actorSheet,owners,rulesHash,notes?} contains
 * public inventory/definition/sheet projections and the owner's frozen rules (`notes`: optional
 * reader-facing words for a def whose rule has no slot). It is never a command payload. The query
 * binding (equip-query.js) fills it from the seam queries, or from the named interim binding.
 *
 * Legality, in order: a durable alive actor; a stack of the actor's own, or one in the party bag
 * (never another member's, never the bag's worn piece for someone but the main character); an
 * equipment item with a frozen rule; base-stat requirements. The slot is the requested one, else
 * the first LEGAL empty slot of the rule (an offhand is not legal while a two-handed weapon is
 * worn), else an explicit swap of the first legal slot. A two-handed piece takes the offhand with it.
 */
export function equipPlan(payload, env) {
    if (!record(payload) || Object.keys(payload).some(key => !['stack', 'actor', 'targetSlot'].includes(key))
        || !recordId(payload.stack) || !actorId(payload.actor)
        || payload.targetSlot !== undefined && !EQUIP_SLOTS.includes(payload.targetSlot)) return failure('INVALID', 'Equipment needs a stack, actor and optional canonical targetSlot.');
    if (!record(env) || !isHash(env.rulesHash) || !record(env.stacks) || !record(env.defs)
        || !record(env.itemRules) || !Array.isArray(env.owners)) return failure('DEPENDENCY_UNAVAILABLE', 'Frozen equipment inputs are unavailable.');
    const actor = env.actorSheet;
    if (!record(actor) || actor.id !== payload.actor) return failure('NOT_FOUND', 'The equipment actor is unknown.');
    if (!record(actor.stats) || STATS.some(key => !Number.isSafeInteger(actor.stats[key]) || actor.stats[key] < 1 || actor.stats[key] > 99)
        || !['alive', 'downed', 'gravely-injured', 'dead'].includes(actor.life)
        || !['pc', 'companion', 'summon', 'pet'].includes(actor.kind)) return failure('DEPENDENCY_UNAVAILABLE', 'The complete base sheet is unavailable.');
    if (actor.kind === 'summon' || actor.kind === 'pet') return failure('REFUSED', 'Temporary combat units have no durable gear slots.');
    // Decided (A4): only a living member changes gear. The state is known, so it is a refusal, not
    // "unavailable"; taking a piece off (item.unequip) needs no plan and stays open.
    if (actor.life !== 'alive') return failure('REFUSED', LIFE_WORDS[actor.life]);
    const knownOwners = new Set(['party', ...env.owners]);
    if (!knownOwners.has(actor.id)) return failure('NOT_FOUND', 'The actor is not in the durable roster.');
    const stack = env.stacks[payload.stack];
    if (!record(stack) || stack.id !== payload.stack) return failure('NOT_FOUND', 'The equipment stack is unknown.');
    if (!count(stack.qty)) return failure('RULES_MISMATCH', 'The stack quantity is invalid.');
    if (!stack.qty) return failure('NOT_ENOUGH', 'The equipment stack is empty.');
    if (stack.equipped !== null && (typeof stack.equipped !== 'string' || !stack.equipped)) return failure('RULES_MISMATCH', 'The equipped record is malformed.');
    if (!ownerId(stack.owner) || !knownOwners.has(stack.owner)) return failure('NOT_FOUND', 'The stack owner is unknown.');
    // The stack's durable owner decides who may wear it (contract §3): the actor's own piece, or one
    // from the party bag (SB moves it to the wearer in the same step). Never another member's piece,
    // and never the main character's worn bag piece for someone else: nothing is taken from a wearer.
    if (stack.owner !== actor.id && stack.owner !== 'party') return failure('REFUSED', 'Another member carries this piece: hand it over first.');
    if (stack.owner === 'party' && stack.equipped !== null && actor.kind !== 'pc') return failure('REFUSED', 'The main character wears this piece: take it off first.');
    const definition = env.defs[stack.def];
    if (!definition || definition.id !== stack.def) return failure('NOT_FOUND', 'The immutable item definition is missing.');
    if (definition.kind !== 'equipment') return failure('REFUSED', 'This item is not equipment.');
    const rule = env.itemRules[stack.def];
    if (ruleProblem(rule, stack.def)) return failure('RULES_MISMATCH', 'The frozen ItemRule is missing or malformed.');
    if (!rule.allowedSlots.length) return failure('REFUSED', env.notes?.[stack.def] ?? 'This item has no equipment slot.');
    // Base stats only: what the piece itself (or any other gear) adds never qualifies the wearer.
    const short = Object.entries(rule.requires).find(([stat, minimum]) => actor.stats[stat] < minimum);
    if (short) return failure('REFUSED', `Base stats do not meet the equipment requirements: needs ${short[0]} ${short[1]}, base ${short[0]} is ${actor.stats[short[0]]}.`);
    // What the actor wears now, by v2 slot. A record whose key names no single slot (worn-1, a bare
    // accessory) occupies nothing here and is left exactly as stored.
    const worn = [];
    for (const other of Object.values(env.stacks)) {
        if (!wornBy(other, actor) || other.id === stack.id) continue;
        const slot = placedAt(other);
        if (slot === null) continue;
        if (!recordId(other.id) || !count(other.qty) || !other.qty
            || !env.defs[other.def] || ruleProblem(env.itemRules[other.def], other.def)) return failure('RULES_MISMATCH', 'An affected equipped record or frozen rule is invalid.');
        worn.push({ ...other, slot });
    }
    if (new Set(worn.map(other => other.slot)).size !== worn.length) return failure('RULES_MISMATCH', 'Two stacks occupy one actor slot.');
    const at = slot => worn.find(other => other.slot === slot);
    const twoHanded = at('weapon') && env.itemRules[at('weapon').def].hands === 2;
    const allowed = EQUIP_SLOTS.filter(slot => rule.allowedSlots.includes(slot));
    // The legal candidates: an offhand is not one while a two-handed weapon is worn.
    const legal = allowed.filter(slot => !(slot === 'offhand' && twoHanded));
    let slot;
    if (payload.targetSlot !== undefined) {
        if (!allowed.includes(payload.targetSlot)) return failure('REFUSED', 'This item cannot use the requested slot.');
        if (!legal.includes(payload.targetSlot)) return failure('REFUSED', 'A two-handed weapon blocks offhand.');
        slot = payload.targetSlot;
    } else {
        if (!legal.length) return failure('REFUSED', 'A two-handed weapon blocks offhand.');
        slot = legal.find(candidate => !at(candidate)) ?? legal[0];
    }
    if (placedAt(stack) === slot) return failure('REFUSED', 'This item is already equipped there.');
    const displaced = [at(slot), ...(rule.hands === 2 ? [at('offhand')] : [])].filter(Boolean);
    const unequip = [...new Set(displaced.map(other => other.id))].sort();
    const move = stack.owner === actor.id ? [] : [{ stack: stack.id, from: stack.owner, to: actor.id }];
    return { ok: true, plan: { actor: actor.id, stack: stack.id, def: stack.def, slot, unequip, move,
        rulesHash: env.rulesHash, inputHash: equipInputHash({ rulesHash: env.rulesHash, actor: actor.id,
            stats: actor.stats, life: actor.life, targetSlot: payload.targetSlot ?? null, stack, affected: displaced }) } };
}

/**
 * Pure items.slots projection: the eight slots in the fixed order with what blocks them, and the
 * compatibility counts. `blockedBy` is the stack id of the two-handed weapon that blocks offhand.
 */
export function equipmentSlots({ actorSheet, stacks, itemRules }) {
    const weapon = Object.values(stacks ?? {}).find(stack => wornBy(stack, actorSheet) && placedAt(stack) === 'weapon');
    const blocked = weapon && itemRules?.[weapon.def]?.hands === 2 ? weapon.id : null;
    return { ...SLOT_COUNTS, slots: EQUIP_SLOTS.map(key => ({ key, label: SLOT_LABELS[key], blockedBy: key === 'offhand' ? blocked : null })) };
}
