// RPG Battle v2, items part: the read-only equipment queries over the pure planner (equip-plan.js).
//
//   rules.equipPlan({ stack, actor, targetSlot? })  contract §3 / P07: { ok:true, plan } or Failure
//   items.slots({ actor? })                         the eight slots in order, with what blocks them
//   items.canWear({ actor, stack | defId, targetSlot? })   { ok, why? }
//
// None of them writes. The planner's inputs (rulesHash, the actor's base sheet, one ItemRule for
// each def involved) come through the seam queries `rules.identity`, `rules.sheet` and `rules.item`
// when Track B's frozen rules answer them. Until B3 lands there is one clearly named INTERIM
// binding (below): it derives each rule from the def alone (never a requirement, a second slot or a
// weight the def does not give), the sheet from the party domain, and a fixed hash that names the
// binding. A rules hash that IS answered is never mixed with interim rules: with it, a missing sheet
// or rule fails closed (DEPENDENCY_UNAVAILABLE / RULES_MISMATCH).

import { equipPlan, equipmentSlots, isHash, placedAt, wornBy } from './equip-plan.js';
import { hashJson } from './equip-hash.js';
import { weightOf } from './carry.js';
import { slotsForLegacy } from './slots.js';

/** Names the interim binding in code, tests and docs. Remove with B3's frozen rules. */
export const INTERIM_BINDING = 'rb-items-interim-1';
/** The rulesHash the interim binding signs plans with: a fixed hash of the binding's name, never a guess at B's. */
export const INTERIM_RULES_HASH = hashJson({ binding: INTERIM_BINDING });

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const STATS = ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'];
// The id a def-only canWear question is planned under (a stack that does not exist).
const PROBE = 'it_probe000';

/**
 * INTERIM: the ItemRule a def implies on its own (§9 adapters applied): one allowed slot from its slot word, hands 1
 * for a weapon or offhand (2 with the two-handed tag), no requirement, its carry weight. A generic old word (worn,
 * hands, waist, a bare accessory) has no slot of its own but a CHOICE (slotsForLegacy): the planner takes the first
 * empty accessory slot for a bare accessory, and wants the reader's targetSlot for the others. A word that names
 * nothing gets no slot and a note saying so. Returns { rule, note, choice } or null for what is not equipment.
 */
export function interimItemRule(def) {
    if (!isRecord(def) || def.kind !== 'equipment' || typeof def.id !== 'string') return null;
    const found = slotsForLegacy(def.slot);
    const base = { def: def.id, requires: {}, weight: Math.min(10000, weightOf(def)), unique: false };
    if (found?.choose) {
        const handed = found.choose.every(slot => slot === 'weapon' || slot === 'offhand');
        return { rule: { ...base, allowedSlots: [], hands: handed ? 1 : 0 }, note: null, choice: { slots: found.choose, auto: found.auto } };
    }
    if (!found) {
        const word = typeof def.slot === 'string' && def.slot ? def.slot : 'no slot';
        return { rule: { ...base, allowedSlots: [], hands: 0 }, note: `The ${def.name} has an old "${word}" slot that does not name one of the eight: it needs a v2 slot before it can be worn.`, choice: null };
    }
    const slot = found.slot;
    const hands = slot === 'weapon' ? ((def.tags ?? []).includes('two-handed') ? 2 : 1) : slot === 'offhand' ? 1 : 0;
    return { rule: { ...base, allowedSlots: [slot], hands }, note: null, choice: null };
}

/** INTERIM: the actor's base sheet as far as equipment reads it, from the party domain; null for no such member. */
export function interimSheet(state, actorId) {
    const party = state?.domains?.party;
    const actor = isRecord(party?.actors) ? party.actors[actorId] : null;
    if (!isRecord(actor)) return null;
    const kind = actorId === party.pc ? 'pc' : actor.kind === 'summon' || actor.kind === 'pet' ? actor.kind : 'companion';
    const dead = (Array.isArray(actor.conditions) ? actor.conditions : []).some(entry => (entry?.kind ?? entry?.name) === 'dead');
    const cur = actor.hp?.cur;
    const life = dead ? 'dead' : Number.isFinite(cur) && cur <= 0 ? 'downed' : 'alive';
    const stats = isRecord(actor.stats) ? Object.fromEntries(STATS.map(key => [key, actor.stats[key]])) : null;
    return { id: actorId, kind, life, stats };
}

/** INTERIM `rules.sheet`: only what equipment (and Story Block's plan check) reads. NOT a SheetView; B3's replaces it. */
export function interimSheetQuery(state, args) {
    if (!isRecord(args) || typeof args.actor !== 'string') return null;
    const sheet = interimSheet(state, args.actor);
    const actor = sheet ? state.domains.party.actors[args.actor] : null;
    return sheet ? { ...sheet, name: String(actor.name ?? ''), level: Number.isInteger(actor.level) ? actor.level : 1 } : null;
}

function askSeam(tools, name, args) {
    if (typeof tools?.query !== 'function') return { found: false };
    try {
        return { found: true, value: tools.query(name, args) };
    } catch {
        return { found: false };
    }
}

const inventoryOf = state => (isRecord(state?.domains?.inventory) ? state.domains.inventory : { defs: {}, stacks: {} });

const sheetCopy = value => (isRecord(value) ? { id: value.id, kind: value.kind, life: value.life, stats: isRecord(value.stats) ? { ...value.stats } : value.stats } : null);

/**
 * The planner's env for `actor`, from the seams or the interim binding; `also` are defs besides the
 * actor's worn ones that the question is about. { ok:true, env, binding:'frozen'|'interim' } or a Failure.
 */
export function equipEnv(state, tools, actor, also = []) {
    const inventory = inventoryOf(state);
    const party = isRecord(state?.domains?.party) ? state.domains.party : {};
    const identity = askSeam(tools, 'rules.identity', {});
    const frozen = identity.found && isRecord(identity.value) && isHash(identity.value.hash) ? identity.value.hash : null;
    const asked = askSeam(tools, 'rules.sheet', { actor });
    let sheet;
    if (asked.found) sheet = sheetCopy(asked.value);
    else if (frozen) return { ok: false, code: 'DEPENDENCY_UNAVAILABLE', message: 'The rules could not give the wearer\'s base sheet.' };
    else sheet = interimSheet(state, actor);
    // Every def the plan can touch: the actor's worn pieces (the bag's too, for the main character) and the ones asked about.
    const asActor = { id: actor, kind: sheet?.kind };
    const defs = new Set(also.filter(id => typeof id === 'string'));
    for (const stack of Object.values(isRecord(inventory.stacks) ? inventory.stacks : {})) {
        if (wornBy(stack, asActor) && typeof stack.def === 'string') defs.add(stack.def);
    }
    const itemRules = {};
    const notes = {};
    const choices = {};
    for (const id of defs) {
        if (frozen) {
            const found = askSeam(tools, 'rules.item', { def: id });
            if (found.found && isRecord(found.value)) itemRules[id] = found.value;
            continue;
        }
        const interim = interimItemRule(inventory.defs?.[id]);
        if (!interim) continue;
        itemRules[id] = interim.rule;
        if (interim.note) notes[id] = interim.note;
        if (interim.choice) choices[id] = interim.choice;
    }
    const owners = Object.entries(isRecord(party.actors) ? party.actors : {})
        .filter(([, member]) => isRecord(member) && member.kind !== 'summon' && member.kind !== 'pet').map(([id]) => id);
    return {
        ok: true,
        binding: frozen ? 'frozen' : 'interim',
        env: { rulesHash: frozen ?? INTERIM_RULES_HASH, stacks: inventory.stacks, defs: inventory.defs, itemRules, notes, choices, actorSheet: sheet, owners },
    };
}

function planFor(state, args, tools) {
    const bad = equipPlan(args, null);
    if (bad.code === 'INVALID') return { answer: bad, bound: null };
    const target = inventoryOf(state).stacks?.[args.stack];
    const bound = equipEnv(state, tools, args.actor, [target?.def]);
    return { answer: bound.ok ? equipPlan(args, bound.env) : bound, bound };
}

/** `rules.equipPlan({ stack, actor, targetSlot? })` (§3, P07): the one planner every equip route asks. Pure. */
export function rulesEquipPlan(state, args, tools) {
    return planFor(state, args, tools).answer;
}

/**
 * `items.slots({ actor? })`: { accessory: 2, worn: 4, slots: [{ key, label, blockedBy }] } in the fixed
 * eight-slot order (§3). `actor` defaults to the main character; blockedBy names the two-handed stack.
 * The counts are fixed by the eight slots, not a setting.
 */
export function slotsQuery(state, args, tools) {
    const party = isRecord(state?.domains?.party) ? state.domains.party : {};
    const actor = isRecord(args) && typeof args.actor === 'string' ? args.actor : party.pc ?? null;
    const bound = actor ? equipEnv(state, tools, actor) : null;
    if (!bound?.ok || !bound.env.actorSheet) return equipmentSlots({ actorSheet: null, stacks: {}, itemRules: {} });
    return equipmentSlots(bound.env);
}

/**
 * `items.canWear({ actor, stack | defId, targetSlot? })` -> { ok, why? }: whether the planner would
 * give a plan now, in the planner's own words. With a def only (Story Block's picker), a probe stack
 * that does not exist is planned; the answer never writes. `choose` (slot IDs, with `ok:false`) is the list a piece with a
 * generic old slot word may be worn in when the reader has not chosen one (ask again with a targetSlot from it).
 */
export function canWearQuery(state, args, tools) {
    const party = isRecord(state?.domains?.party) ? state.domains.party : {};
    const inventory = inventoryOf(state);
    if (!isRecord(args) || typeof args.actor !== 'string' || !isRecord(party.actors) || !isRecord(party.actors[args.actor])) return { ok: false, why: 'That is not someone in the party.' };
    const stack = typeof args.stack === 'string' ? inventory.stacks?.[args.stack] : null;
    const defId = stack?.def ?? args.defId ?? args.def;
    const def = typeof defId === 'string' ? inventory.defs?.[defId] : null;
    if (!def) return { ok: false, why: 'That item is not known.' };
    if (def.kind !== 'equipment') return { ok: false, why: `The ${def.name} is not something to wear or wield.` };
    const targetSlot = isRecord(args) && args.targetSlot !== undefined ? { targetSlot: args.targetSlot } : {};
    // A piece the member already wears (in the slot asked for, or any with none asked) is one they can wear.
    const theirs = stack && (stack.owner === args.actor || (stack.owner === 'party' && args.actor === party.pc));
    if (theirs && placedAt(stack) !== null && (args.targetSlot === undefined || args.targetSlot === placedAt(stack))) return { ok: true };
    let seen = state;
    let id = stack?.id;
    if (!stack) {
        id = PROBE;
        seen = { ...state, domains: { ...state.domains, inventory: { ...inventory, stacks: { ...inventory.stacks, [PROBE]: { id: PROBE, def: def.id, qty: 1, owner: 'party', equipped: null } } } } };
    }
    const { answer, bound } = planFor(seen, { stack: id, actor: args.actor, ...targetSlot }, tools);
    // A generic old slot word the reader must choose for: say where it could go, so a screen can ask.
    const choice = bound?.env?.choices?.[def.id];
    if (answer.ok !== true && choice && !choice.auto && args.targetSlot === undefined && /^Choose where/.test(answer.message)) return { ok: false, why: String(answer.message), choose: [...choice.slots] };
    return answer.ok === true ? { ok: true } : { ok: false, why: String(answer.message ?? 'It cannot be worn.') };
}
