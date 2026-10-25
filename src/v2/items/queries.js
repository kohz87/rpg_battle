// RPG Battle v2, items part: read-only views of the party's things (MODULES §B2). Pure: each
// takes the State and returns plain copies.

import { capItem, equipped, gearBonuses } from '../../items.js';
import { useItemOutside } from '../../recovery.js';
import { canCarry, carryView } from './carry.js';
import { canWearQuery, slotsQuery } from './equip-query.js';
import { SLOT_CATEGORY, SLOT_LABELS, normalizeSlot, unplacedWhy } from './slots.js';
import { helpsOutside, hostSettings, inventoryOf, itemOf, partyOf, rulesFrom, sheetOf, stackIds, wearerOf } from './shared.js';
import { gearFeatures, pieceName, pieceOf, scaleStats } from './condition.js';
import { RARITIES } from '../../rules.js';
import { sessionOf } from '../combat/stored.js';

/** The rarity one step above (legendary stays legendary). */
const nextRarity = rarity => RARITIES[Math.min(RARITIES.length - 1, Math.max(0, RARITIES.indexOf(rarity)) + 1)];

const copy = value => JSON.parse(JSON.stringify(value));

/**
 * `items.usable({ actor })`: the consumables that do something outside a fight, with some left:
 * [{ stack, def, name, qty, owner, effect, helps }]. With `actor`, what they carry and the
 * shared bag's, and `helps` says whether a dose would change anything for them now (false at
 * full HP with nothing to cure, which `item.use` refuses); without, every party member's and
 * the bag's, `helps` null.
 */
export function usable(state, { actor = null } = {}) {
    const inventory = inventoryOf(state);
    const party = partyOf(state);
    const who = actor ? party.actors?.[actor] ?? null : null;
    if (actor && !who) return [];
    return stackIds(inventory)
        .map(id => inventory.stacks[id])
        .filter(stack => stack.qty > 0 && (actor ? stack.owner === actor || stack.owner === 'party' : stack.owner === 'party' || party.actors?.[stack.owner]))
        .map(stack => ({ stack, def: inventory.defs?.[stack.def] }))
        .filter(({ def }) => def?.kind === 'consumable' && helpsOutside(def.effect))
        .map(({ stack, def }) => ({
            stack: stack.id, def: stack.def, name: def.name, qty: stack.qty, owner: stack.owner, effect: copy(def.effect),
            helps: who ? useItemOutside(sheetOf(who), { name: def.name, effect: def.effect }).used : null,
        }));
}

/**
 * `items.useOn({})`: whom a Use button offers each consumable for (beta.1 live test: "use item is
 * missing"; bag management, rule 6): { [stack]: [{ id, name }] }, the party's members (in party
 * order) a dose would do something for now, by the rule `item.use` applies (useItemOutside: not at
 * full HP with nothing to cure). Only the party's things (the shared bag's and the members'). {} while
 * a fight has the party: then a draught is the fight's Item action, on the Fight screen.
 */
export function useOn(state) {
    if (sessionOf(state?.domains?.combat ?? null)) return {};
    const party = partyOf(state);
    const order = [...(party.order ?? []).filter(id => party.actors?.[id]), ...Object.keys(party.actors ?? {}).sort().filter(id => !(party.order ?? []).includes(id))];
    const out = {};
    for (const id of order) {
        for (const entry of usable(state, { actor: id })) {
            if (!entry.helps) continue;
            (out[entry.stack] ??= []).push({ id, name: String(party.actors[id]?.name ?? id) });
        }
    }
    return out;
}

/**
 * `items.gear({ actor })` (the main character when none is named): what they wear and what it
 * gives at their level, by v1's rules. { actor, level, counted: [{ stack, name, slot, key, slotLabel,
 * rarity, stats, capped, from }], unused: [{ stack, name, slot, rarity, why }], bonuses } — `key` is
 * the piece's v2 slot (weapon, offhand, head, body, legs, feet, accessory-1, accessory-2; an older
 * `armour` key reads as body, §9) and `slot` the v1 category the shared stat counting reads (head,
 * legs, feet count as `worn`, the body as `armour`); `stats` are capped by rarity and level
 * (capItem), `from` what the piece says when that was more; `unused` are pieces that give nothing:
 * broken ones, an off-hand beside a two-handed weapon, and pieces whose stored key names no single v2
 * slot (an old `worn-1`: kept exactly as stored, never guessed, until the reader picks a slot);
 * `bonuses` the summed stats, tags and on-hit elements (gearBonuses). Null for no such actor.
 * `settings` (RPG Battle's, for the rarity budgets) defaults to the host's.
 */
export function gear(state, { actor = null, settings } = {}, tools = null) {
    const inventory = inventoryOf(state);
    const party = partyOf(state);
    const id = actor || party.pc;
    const who = id ? party.actors?.[id] : null;
    if (!who) return null;
    const rules = rulesFrom(settings === undefined ? tools?.settings ?? hostSettings() : settings);
    const level = Math.max(1, Math.round(Number(who.level) || 1));
    const features = gearFeatures(tools);
    const gearSlice = state?.domains?.gear ?? null;
    const items = [];
    const unplaced = [];
    for (const stackId of stackIds(inventory)) {
        const stack = inventory.stacks[stackId];
        if (!stack.equipped || !(stack.qty > 0) || wearerOf(stack, party) !== id) continue;
        const key = normalizeSlot(stack.equipped);
        const item = itemOf(stack, inventory.defs?.[stack.def]);
        if (key === null) unplaced.push({ stack: stack.id, name: item.name, slot: item.slot, rarity: item.rarity, why: unplacedWhy(stack.equipped) });
        else items.push({ ...item, slot: SLOT_CATEGORY[key], key });
    }
    const worn = equipped(items, rules);
    const counted = [];
    const broken = [];
    for (const item of [worn.weapon, worn.offhand, worn.armour, ...worn.worn, ...worn.accessory].filter(Boolean)) {
        const piece = pieceOf(inventory, gearSlice, item.stack, features);
        const name = pieceName(item.name, piece.refine);
        const look = { cond: piece.cond, max: piece.max, band: piece.band, refine: piece.refine };
        const where = { key: item.key, slotLabel: SLOT_LABELS[item.key] };
        // A broken piece stays on but gives nothing: it is not counted (its stats, its elements).
        if (piece.factor === 0) {
            broken.push({ stack: item.stack, name, slot: item.slot, ...where, rarity: item.rarity, why: 'broken', ...look });
            continue;
        }
        const result = capItem(item, level, rules);
        // A refined piece never passes the next rarity's budget for its slot at the wearer's level.
        const scaled = scaleStats(result.stats, piece);
        const stats = piece.refine > 0 ? capItem({ ...item, rarity: nextRarity(item.rarity), stats: scaled }, level, rules).stats : scaled;
        // `final`: the stats are what the piece gives (capped at the wearer's level, then its
        // condition and refinement), to be counted as they are, never capped again.
        counted.push({
            stack: item.stack, name, slot: item.slot, ...where, rarity: item.rarity, stats, capped: result.capped,
            from: result.capped ? { ...item.stats } : null, tags: [...item.tags], final: true, ...look,
        });
    }
    const unused = [
        ...worn.unused.map(({ item, why }) => ({ stack: item.stack, name: item.name, slot: item.slot, key: item.key, slotLabel: SLOT_LABELS[item.key], rarity: item.rarity, why })),
        ...broken, ...unplaced,
    ];
    const bonuses = sumBonuses(counted, items);
    return copy({ actor: id, level, counted, unused, bonuses });
}

/** The summed stats, tags and on-hit elements of the counted pieces (v1 gearBonuses' shape, of what each gives now). */
function sumBonuses(counted, items) {
    const total = gearBonuses([], 1);
    delete total.capped;
    const tags = new Set();
    const onHit = new Set();
    for (const row of counted) {
        for (const [name, value] of Object.entries(row.stats)) total[name] = (total[name] ?? 0) + value;
        for (const tag of row.tags ?? []) tags.add(tag);
    }
    // The elements that strike (weapon, off-hand, accessory), as v1 counts them, of the pieces counted.
    const kept = new Set(counted.map(row => row.stack));
    const v1 = gearBonuses(items.filter(item => kept.has(item.stack)), 1);
    for (const tag of v1.onHit ?? []) onHit.add(tag);
    return { ...total, tags: [...tags], onHit: [...onHit] };
}

/**
 * `items.condition({ stack })` (TRS ideas 1 and 9): a piece's condition and refinement, for the
 * screens: { stack, band, cur, max, refine, name, factor } — `band` 'good' | 'worn' | 'tattered' |
 * 'broken', `factor` the share of its stats it gives now, `name` with its refinement ("Iron Sword
 * +2"). With gear wear off, `band`, `cur`, `max` are null (and `factor` 1); with refinement off,
 * `refine` is 0. Null for a stack that is not equipment, or when both are off.
 */
export function condition(state, { stack = null } = {}, tools = null) {
    const inventory = inventoryOf(state);
    const row = typeof stack === 'string' ? inventory.stacks?.[stack] : null;
    const def = row ? inventory.defs?.[row.def] : null;
    if (!row || def?.kind !== 'equipment') return null;
    const features = gearFeatures(tools);
    if (!features.wear && !features.refine) return null;
    const piece = pieceOf(inventory, state?.domains?.gear ?? null, stack, features);
    return {
        stack,
        band: features.wear ? piece.band : null,
        cur: features.wear ? piece.cond : null,
        max: features.wear ? piece.max : null,
        refine: piece.refine,
        name: pieceName(def.name, piece.refine),
        factor: features.wear ? piece.factor : 1,
    };
}

/**
 * `items.carry({ owner?, add?, move?, settings? })` (MODULES §F39, carry.js): with `add`
 * ([{ def (a whole def) | defId, qty }]), whether `owner` ('party', the shared bag, by default; or
 * a member's id) can take it on: { ok, on, weight, owner, load, capacity, partyLoad,
 * partyCapacity, message }; `move: true` for a hand-over between the party's own. Without `add`,
 * where the party stands: { on, size, people: [{ id, name, load, capacity }], bag, load,
 * capacity }. Settings: `args.settings`, else the query's tools' (the items part's), else the host's.
 */
export function carry(state, args = {}, tools = null) {
    const inventory = inventoryOf(state);
    const party = partyOf(state);
    const settings = args?.settings ?? tools?.settings ?? hostSettings();
    if (!Array.isArray(args?.add)) return copy(carryView(inventory, party, settings));
    const add = args.add.map(entry => ({
        def: entry?.def && typeof entry.def === 'object' ? entry.def : inventory.defs?.[entry?.defId ?? entry?.def] ?? { name: String(entry?.defId ?? entry?.def ?? 'thing') },
        qty: Number.isInteger(entry?.qty) ? entry.qty : 1,
    }));
    return copy(canCarry(inventory, party, { owner: args.owner ?? 'party', add, move: args.move === true, settings }));
}

/**
 * What `actor` wears as v1 Items that count as they are (`final: true`: capped at their level, then
 * scaled by condition and refinement; a broken piece left out), for a sheet's or a fight's numbers
 * (v1 gearBonuses / combatNumbers count a `final` item's stats without capping them again).
 */
export function wornGear(state, actor, { settings, tools = null } = {}) {
    const view = gear(state, { actor, ...(settings !== undefined ? { settings } : {}) }, tools);
    return (view?.counted ?? []).map(row => ({ name: row.name, qty: 1, slot: row.slot, rarity: row.rarity, stats: { ...row.stats }, tags: [...(row.tags ?? [])], equipped: true, final: true, stack: row.stack }));
}

/**
 * `items.slots({ actor? })` (§3, P07; also Story Block's Equip on… picker): the eight slots in the fixed
 * order with what blocks each, plus the compatibility counts: { accessory: 2, worn: 4, slots: [{ key,
 * label, blockedBy }] }. `blockedBy` is the stack id of the two-handed weapon that blocks the off-hand.
 * The counts are fixed by the eight slots, not a setting. Never writes (equip-query.js).
 */
export const slots = slotsQuery;

/**
 * `items.canWear({ actor, stack | defId, targetSlot? })` -> { ok, why? }: whether the planner would give
 * a plan for that member now (a living member, a piece of theirs or the bag's, a slot, the base-stat
 * requirement, an off-hand beside a two-handed weapon), in the planner's words. Never writes.
 */
export const canWear = canWearQuery;
