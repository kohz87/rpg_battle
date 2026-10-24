// Pure P07 equipment planning over explicit frozen inputs. SB alone writes stacks/ownership.
// No B storage layout, live-pack fallback, guessed rules hash or caller-supplied trusted plan.
import { hashJson } from './equip-hash.js';

export const EQUIP_SLOTS = Object.freeze(['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2']);
export const SLOT_LABELS = Object.freeze({ weapon: 'Main hand', offhand: 'Off hand', head: 'Head', body: 'Body', legs: 'Legs', feet: 'Feet', 'accessory-1': 'Accessory 1', 'accessory-2': 'Accessory 2' });
export const CANONICAL_ALIASES = Object.freeze({ mainhand: 'weapon', 'main-hand': 'weapon', 'off-hand': 'offhand', armor: 'body', armour: 'body' });
export const AMBIGUOUS_SLOTS = Object.freeze(['worn', 'hands', 'waist', 'accessory']);
const STATS = ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const recordId = value => typeof value === 'string' && /^[a-z][a-z0-9]*_[0-9a-z]{8}$/.test(value);
const actorId = value => typeof value === 'string' && /^ac_[0-9a-z]{8}$/.test(value);
const ownerId = value => value === 'party' || actorId(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const failure = (code, message) => ({ ok: false, code, message });
export const isHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/** Authoring/import alias adapter only; ambiguous keys require explicit reauthoring (§9). */
export function normalizeSlot(slot) {
    return typeof slot === 'string' ? EQUIP_SLOTS.includes(slot) ? slot : CANONICAL_ALIASES[slot] ?? null : null;
}
export const isAmbiguousSlot = slot => AMBIGUOUS_SLOTS.includes(slot);

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

/**
 * PRIVATE owner handoff: env={stacks,defs,itemRules,actorSheet,owners,rulesHash} contains public
 * inventory/definition/sheet projections and the owner's frozen rules. It is never a command
 * payload. Lead/B bind it to rules.equipPlan(args) once their frozen storage seam is ready.
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
    if (actor.life !== 'alive') return failure('DEPENDENCY_UNAVAILABLE', 'Equipment eligibility for this life state needs the rule owner policy.');
    const knownOwners = new Set(['party', ...env.owners]);
    if (!knownOwners.has(actor.id)) return failure('NOT_FOUND', 'The actor is not in the durable roster.');
    const stack = env.stacks[payload.stack];
    if (!record(stack) || stack.id !== payload.stack) return failure('NOT_FOUND', 'The equipment stack is unknown.');
    if (!count(stack.qty)) return failure('RULES_MISMATCH', 'The stack quantity is invalid.');
    if (!stack.qty) return failure('NOT_ENOUGH', 'The equipment stack is empty.');
    if (stack.equipped !== null && !EQUIP_SLOTS.includes(stack.equipped)) return failure('RULES_MISMATCH', 'This equipped record needs explicit reauthoring in a fresh timeline.');
    if (!ownerId(stack.owner) || !knownOwners.has(stack.owner)) return failure('NOT_FOUND', 'The stack owner is unknown.');
    const definition = env.defs[stack.def];
    if (!definition || definition.id !== stack.def) return failure('NOT_FOUND', 'The immutable item definition is missing.');
    if (definition.kind !== 'equipment') return failure('REFUSED', 'This item is not equipment.');
    const rule = env.itemRules[stack.def];
    if (ruleProblem(rule, stack.def)) return failure('RULES_MISMATCH', 'The frozen ItemRule is missing or malformed.');
    if (!rule.allowedSlots.length) return failure('REFUSED', 'This item has no equipment slot.');
    if (Object.entries(rule.requires).some(([stat, minimum]) => actor.stats[stat] < minimum)) return failure('REFUSED', 'Base stats do not meet the equipment requirements.');
    // Only actor-owned stacks are equipped under P07. Party-bag equipped records belong to
    // the old runtime; no fresh-start planner silently migrates them or guesses their wearer.
    const worn = [];
    for (const other of Object.values(env.stacks)) {
        if (other?.owner !== actor.id || other.equipped === null) continue;
        if (!recordId(other.id) || !count(other.qty) || !other.qty || !EQUIP_SLOTS.includes(other.equipped)
            || !env.defs[other.def] || ruleProblem(env.itemRules[other.def], other.def)) return failure('RULES_MISMATCH', 'An affected equipped record or frozen rule is invalid.');
        if (other.id !== stack.id) worn.push(other);
    }
    if (new Set(worn.map(other => other.equipped)).size !== worn.length) return failure('RULES_MISMATCH', 'Two stacks occupy one actor slot.');
    const at = slot => worn.find(other => other.equipped === slot);
    const allowed = EQUIP_SLOTS.filter(slot => rule.allowedSlots.includes(slot));
    const slot = payload.targetSlot ?? allowed.find(slot => !at(slot)) ?? allowed[0];
    if (!allowed.includes(slot)) return failure('REFUSED', 'This item cannot use the requested slot.');
    if (slot === 'offhand' && at('weapon') && env.itemRules[at('weapon').def].hands === 2) return failure('REFUSED', 'A two-handed weapon blocks offhand.');
    if (stack.owner === actor.id && stack.equipped === slot) return failure('REFUSED', 'This item is already equipped there.');
    const displaced = [at(slot), ...(rule.hands === 2 ? [at('offhand')] : [])].filter(Boolean);
    const unequip = [...new Set(displaced.map(other => other.id))].sort();
    const move = stack.owner === actor.id ? [] : [{ stack: stack.id, from: stack.owner, to: actor.id }];
    return { ok: true, plan: { actor: actor.id, stack: stack.id, def: stack.def, slot, unequip, move,
        rulesHash: env.rulesHash, inputHash: equipInputHash({ rulesHash: env.rulesHash, actor: actor.id,
            stats: actor.stats, life: actor.life, targetSlot: payload.targetSlot ?? null, stack, affected: displaced }) } };
}

/** Pure items.slots projection for the future registered adapter; no storage initialization. */
export function equipmentSlots({ actorSheet, stacks, itemRules }) {
    const weapon = Object.values(stacks).find(stack => stack.owner === actorSheet?.id && stack.equipped === 'weapon');
    const blocked = weapon && itemRules[weapon.def]?.hands === 2 ? weapon.id : null;
    return { accessory: 2, worn: 4, slots: EQUIP_SLOTS.map(key => ({ key, label: SLOT_LABELS[key], blockedBy: key === 'offhand' ? blocked : null })) };
}
