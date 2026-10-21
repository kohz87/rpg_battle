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

export const DEFAULTS = Object.freeze({ carryLimit: true, carrySize: 100 });
export const CAPACITY = Object.freeze({ base: 20, perStr: 4 });

/** Default weights by kind, and equipment by slot. */
export const WEIGHTS = Object.freeze({
    money: 0, quest: 0, consumable: 1, material: 1, goods: 2,
    equipment: Object.freeze({ weapon: 4, twoHanded: 8, offhand: 4, armour: 10, armor: 10, worn: 2, accessory: 0, head: 2, hands: 1, feet: 2, waist: 1, other: 3 }),
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
        if (def?.slot === 'weapon' && (def?.tags ?? []).includes('two-handed')) return table.twoHanded;
        return table[String(def?.slot ?? '')] ?? table.other;
    }
    return Number.isInteger(WEIGHTS[kind]) ? WEIGHTS[kind] : WEIGHTS.goods;
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
 * Where the party stands: { on, size, people: [{ id, name, load, capacity }], bag, load, capacity }.
 * `load` and `capacity` are the party's whole (everyone and the shared bag).
 */
export function carryView(inventory, party, settings = null) {
    const { on, size } = carrySettings(settings);
    const held = loads(inventory);
    const ids = [...(Array.isArray(party?.order) ? party.order : []), ...Object.keys(party?.actors ?? {}).sort()]
        .filter((id, index, all) => party?.actors?.[id] && all.indexOf(id) === index);
    const people = ids.map(id => ({ id, name: String(party.actors[id].name ?? ''), load: held[id] ?? 0, capacity: capacityOf(party.actors[id], settings) }));
    const bag = held.party ?? 0;
    return {
        on: on && people.length > 0, size, people, bag,
        load: bag + people.reduce((sum, person) => sum + person.load, 0),
        capacity: people.reduce((sum, person) => sum + person.capacity, 0),
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
