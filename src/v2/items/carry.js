// RPG Battle v2, items part: the carry limit (MODULES §F39). Pure.
//
// On by default; the reader turns it off or sizes it in the settings (this part's `carryLimit`
// and `carrySize`). Over the limit, an action that adds weight is refused with the reason, and
// nothing is lost: the thing stays where it was (on the shelf, with the crafter, with the giver).
//
// * **Weights** (whole units): a def's own `weight` when it has one (a whole number of at least
//   0); v1 kept no weights, so otherwise a default by kind (WEIGHTS): equipment by its slot (a
//   two-handed weapon weighs more), consumables, materials and goods by the piece, money and quest
//   things nothing. A stack weighs its weight × its count; worn pieces weigh as much as carried ones.
// * **Capacity** of a member: (20 + 4 × STR) × carrySize ÷ 100, rounded down (STR is the base
//   stat; a new character's STR 5 carries 40, STR 10 carries 60). The party's capacity is the sum
//   of its members'.
// * **What fits:** a member may take on something while their own load stays within their
//   capacity and, when it is new weight for the party (bought, collected, found), the party's
//   whole load (everyone's things and the shared bag's) stays within the party's capacity. The
//   shared bag counts against the party's capacity only. Handing something between members only
//   checks the one who takes it. A party with no members yet has no limit.
// * **Things that carry** (MODULES §F106): a pack item's `carry` (Story Block keeps it only on `pack.`
//   defs; the story never sets it), or the reader's own list (`carryItems`: "Spatial Ring: 100", by the
//   item's name), adds that capacity while the thing is owned: a member's to that member, the shared
//   bag's (a cart, a barge's hold) to the party's; equipment only while it is worn. The bonus counts
//   once per kind of thing (by name) for each owner, whatever the count and however it is stacked:
//   three Backpacks in the bag add one Backpack's room, as one stack or split in three (B-a2-3), and a
//   second one bought or found adds nothing more (B-a2-10). Things of different kinds add up. The bonus
//   is not scaled by `carrySize`. Something taken on counts the room it adds (a mule carries itself;
//   a second mule of the same kind adds none). Losing the last of a kind lowers the capacity; nothing is
//   dropped, the party is encumbered.

import { normalizeSlot } from './slots.js';

export const DEFAULTS = Object.freeze({ carryLimit: true, carrySize: 100, carryItems: Object.freeze([]) });
// The most one thing adds (as Story Block's def check holds it).
export const CARRY_MAX = 1000;
export const CAPACITY = Object.freeze({ base: 20, perStr: 4 });

/** Default weights by kind, and equipment by slot. */
export const WEIGHTS = Object.freeze({
    money: 0, quest: 0, consumable: 1, material: 1, goods: 2,
    // By slot: the eight slots (P07) carry the numbers their old words did (body = armour, legs = a worn piece);
    // the old words stay for older defs. The default is only a fallback: an ItemRule's own weight wins.
    equipment: Object.freeze({
        weapon: 4, twoHanded: 8, offhand: 4, body: 10, head: 2, legs: 2, feet: 2, 'accessory-1': 0, 'accessory-2': 0,
        armour: 10, armor: 10, worn: 2, accessory: 0, hands: 1, waist: 1, other: 3,
    }),
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value, fallback) => (Number.isInteger(value) ? value : fallback);

/** The carry settings in force: { on, size } (size in percent, 10–500). */
export function carrySettings(settings = null) {
    const own = isRecord(settings) ? settings : {};
    const on = own.carryLimit === undefined ? DEFAULTS.carryLimit : own.carryLimit !== false;
    const size = Math.max(10, Math.min(500, whole(own.carrySize, DEFAULTS.carrySize)));
    return { on, size };
}

/** One piece of `def`'s weight: its own `weight`, else the default for its kind (and slot). */
export function weightOf(def) {
    if (Number.isInteger(def?.weight) && def.weight >= 0) return def.weight;
    const kind = String(def?.kind ?? 'goods');
    if (kind === 'equipment') {
        const table = WEIGHTS.equipment;
        const slot = normalizeSlot(def?.slot) ?? String(def?.slot ?? '');
        if (slot === 'weapon' && (def?.tags ?? []).includes('two-handed')) return table.twoHanded;
        return Object.hasOwn(table, slot) ? table[slot] : table.other;
    }
    return Number.isInteger(WEIGHTS[kind]) ? WEIGHTS[kind] : WEIGHTS.goods;
}

const foldName = name => String(name ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** The reader's carry items (`carryItems` rows `{ item, carry }`) by folded name → capacity. */
export function carryList(settings = null) {
    const rows = Array.isArray(settings?.carryItems) ? settings.carryItems : [];
    const out = new Map();
    for (const row of rows) {
        const name = foldName(row?.item);
        if (name && Number.isInteger(row?.carry) && row.carry >= 1 && !out.has(name)) out.set(name, Math.min(CARRY_MAX, row.carry));
    }
    return out;
}

/** The capacity one `def` adds (the reader's list by name first, else a pack def's own `carry`), or 0. */
export function carryOf(def, settings = null, list = carryList(settings)) {
    const named = list.get(foldName(def?.name));
    if (named) return named;
    const own = def?.carry;
    return typeof def?.id === 'string' && def.id.startsWith('pack.') && Number.isInteger(own) && own >= 1 ? Math.min(CARRY_MAX, own) : 0;
}

/** The kind a thing's carry bonus counts by (carryBonuses: once per kind and owner): its folded name. */
const kindKey = def => foldName(def?.name) || String(def?.id ?? '');

/**
 * What every owner's things add to carrying: { bonus: { [owner]: n }, bonuses: [{ stack, carry, owner,
 * counts }] }: equipment counts only while worn (`counts: false` otherwise, for the screens to say so).
 * Each kind of thing (by name) adds its bonus once for each owner, whatever its count and however many
 * stacks it is in (a stack of backpacks, or three stacks of one, is one backpack's worth): the stack that
 * counts is the one adding the most (the first by id on a tie); the others are listed `counts: false`.
 */
export function carryBonuses(inventory, settings = null) {
    const list = carryList(settings);
    const best = new Map();
    const bonuses = [];
    const stacks = Object.values(inventory?.stacks ?? {}).filter(stack => isRecord(stack) && stack.qty > 0)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const stack of stacks) {
        const def = inventory?.defs?.[stack.def];
        const carry = carryOf(def, settings, list);
        if (!carry) continue;
        const entry = { stack: stack.id, carry, owner: stack.owner, counts: def?.kind !== 'equipment' || Boolean(stack.equipped) };
        bonuses.push(entry);
        if (!entry.counts) continue;
        const key = `${stack.owner}\u0000${kindKey(def)}`;
        const held = best.get(key);
        if (!held || entry.carry > held.carry) {
            if (held) held.counts = false;
            best.set(key, entry);
        } else entry.counts = false;
    }
    const bonus = {};
    for (const entry of best.values()) bonus[entry.owner] = (bonus[entry.owner] ?? 0) + entry.carry;
    return { bonus, bonuses };
}

/** The room `def` would add to `owner` on top of what that owner's things of its kind add now (carryBonuses). */
function roomAdded(inventory, owner, def, settings, list) {
    const carry = def?.kind === 'equipment' ? 0 : carryOf(def, settings, list);
    if (!carry) return 0;
    const key = kindKey(def);
    let have = 0;
    for (const stack of Object.values(inventory?.stacks ?? {})) {
        if (!isRecord(stack) || !(stack.qty > 0) || stack.owner !== owner) continue;
        const own = inventory?.defs?.[stack.def];
        if (kindKey(own) !== key || (own?.kind === 'equipment' && !stack.equipped)) continue;
        have = Math.max(have, carryOf(own, settings, list));
    }
    return Math.max(0, carry - have);
}

/** A member's capacity: (20 + 4 × STR) × size ÷ 100, rounded down. */
export function capacityOf(actor, settings = null) {
    const { size } = carrySettings(settings);
    const str = Number.isInteger(actor?.stats?.STR) ? actor.stats.STR : 5;
    return Math.floor((CAPACITY.base + CAPACITY.perStr * Math.max(0, str)) * size / 100);
}

/** What every owner carries: { [owner]: weight } over the inventory's stacks. */
export function loads(inventory) {
    const out = {};
    for (const stack of Object.values(inventory?.stacks ?? {})) {
        if (!isRecord(stack) || !(stack.qty > 0)) continue;
        const def = inventory?.defs?.[stack.def];
        out[stack.owner] = (out[stack.owner] ?? 0) + weightOf(def) * stack.qty;
    }
    return out;
}

/**
 * Where the party stands: { on, size, people: [{ id, name, load, capacity, bonus }], bag, bagBonus,
 * load, capacity, bonuses }. `load` and `capacity` are the party's whole (everyone and the shared bag);
 * a member's `capacity` includes the `bonus` their things add, the party's the shared bag's `bagBonus`
 * too; `bonuses` lists every stack that adds capacity (carryBonuses).
 */
export function carryView(inventory, party, settings = null) {
    const { on, size } = carrySettings(settings);
    const held = loads(inventory);
    const { bonus, bonuses } = carryBonuses(inventory, settings);
    const ids = [...(Array.isArray(party?.order) ? party.order : []), ...Object.keys(party?.actors ?? {}).sort()]
        .filter((id, index, all) => party?.actors?.[id] && all.indexOf(id) === index);
    const people = ids.map(id => ({ id, name: String(party.actors[id].name ?? ''), load: held[id] ?? 0, capacity: capacityOf(party.actors[id], settings) + (bonus[id] ?? 0), bonus: bonus[id] ?? 0 }));
    const bag = held.party ?? 0;
    const bagBonus = bonus.party ?? 0;
    return {
        on: on && people.length > 0, size, people, bag, bagBonus,
        load: bag + people.reduce((sum, person) => sum + person.load, 0),
        capacity: bagBonus + people.reduce((sum, person) => sum + person.capacity, 0),
        bonuses,
    };
}

const plural = (qty, name) => (qty === 1 ? `the ${name}` : `${qty} ${name}`);

/**
 * Whether `owner` ('party' or a member's id) can take on `add` ([{ def, qty }], whole defs):
 * { ok, on, weight, owner, load, capacity, partyLoad, partyCapacity, message }. `move` is true when
 * the things already belong to the party (a hand-over): only the taker's own load is checked.
 */
export function canCarry(inventory, party, { owner = 'party', add = [], move = false, settings = null } = {}) {
    const view = carryView(inventory, party, settings);
    const weight = (Array.isArray(add) ? add : []).reduce((sum, entry) => sum + weightOf(entry?.def) * Math.max(0, whole(entry?.qty, 1)), 0);
    // A thing taken on that carries (not gear: that only counts once worn) adds the room it would add
    // there (roomAdded: a mule carries itself; a second of the same kind adds nothing, as carryBonuses
    // counts it). A hand-over moves it from one owner to another, so the party's whole stays.
    const list = carryList(settings);
    const kinds = new Map();
    for (const entry of Array.isArray(add) ? add : []) {
        const room = roomAdded(inventory, owner, entry?.def, settings, list);
        const key = kindKey(entry?.def);
        if (room > (kinds.get(key) ?? 0)) kinds.set(key, room);
    }
    const brings = [...kinds.values()].reduce((sum, room) => sum + room, 0);
    if (brings) {
        const person = owner === 'party' ? null : view.people.find(entry => entry.id === owner);
        if (person) person.capacity += brings;
        if (!move) view.capacity += brings;
    }
    const person = owner === 'party' ? null : view.people.find(entry => entry.id === owner) ?? null;
    const base = {
        ok: true, on: view.on, weight, owner,
        load: person ? person.load : view.bag, capacity: person ? person.capacity : view.capacity,
        partyLoad: view.load, partyCapacity: view.capacity, message: '',
    };
    if (!view.on || weight <= 0) return base;
    const what = add.length === 1 ? plural(whole(add[0]?.qty, 1), String(add[0]?.def?.name ?? 'thing')) : 'those things';
    const weighs = `${what} ${add.length === 1 && whole(add[0]?.qty, 1) === 1 ? 'weighs' : 'weigh'} ${weight}`;
    if (person && person.load + weight > person.capacity) {
        return { ...base, ok: false, message: `${person.name} cannot carry that: ${person.load} of ${person.capacity} carried, and ${weighs}.` };
    }
    if (!move && view.load + weight > view.capacity) {
        return { ...base, ok: false, message: `The party cannot carry that: ${view.load} of ${view.capacity} carried, and ${weighs}.` };
    }
    return base;
}
