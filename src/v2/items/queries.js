// RPG Battle v2, items part: read-only views of the party's things (MODULES §B2). Pure: each
// takes the State and returns plain copies.

import { capItem, equipped, gearBonuses } from '../../items.js';
import { useItemOutside } from '../../recovery.js';
import { helpsOutside, hostSettings, inventoryOf, itemOf, partyOf, rulesFrom, sheetOf, stackIds, wearerOf } from './shared.js';

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
 * `items.gear({ actor })` (the main character when none is named): what they wear and what it
 * gives at their level, by v1's rules. { actor, level, counted: [{ stack, name, slot, rarity,
 * stats, capped, from }], unused: [{ stack, name, slot, rarity, why }], bonuses } — `stats` are
 * capped by rarity and level (capItem), `from` what the piece says when that was more; `unused`
 * are pieces past the rules' limits (gearLimits) or an off-hand beside a two-handed weapon;
 * `bonuses` the summed stats, tags and on-hit elements (gearBonuses). Null for no such actor.
 * `settings` (RPG Battle's, for the rules' limits) defaults to the host's.
 */
export function gear(state, { actor = null, settings } = {}) {
    const inventory = inventoryOf(state);
    const party = partyOf(state);
    const id = actor || party.pc;
    const who = id ? party.actors?.[id] : null;
    if (!who) return null;
    const rules = rulesFrom(settings === undefined ? hostSettings() : settings);
    const level = Math.max(1, Math.round(Number(who.level) || 1));
    const items = stackIds(inventory)
        .map(stackId => inventory.stacks[stackId])
        .filter(stack => stack.equipped && stack.qty > 0 && wearerOf(stack, party) === id)
        .map(stack => itemOf(stack, inventory.defs?.[stack.def]));
    const worn = equipped(items, rules);
    const counted = [worn.weapon, worn.offhand, worn.armour, ...worn.worn, ...worn.accessory].filter(Boolean).map(item => {
        const result = capItem(item, level, rules);
        return { stack: item.stack, name: item.name, slot: item.slot, rarity: item.rarity, stats: result.stats, capped: result.capped, from: result.capped ? { ...item.stats } : null };
    });
    const unused = worn.unused.map(({ item, why }) => ({ stack: item.stack, name: item.name, slot: item.slot, rarity: item.rarity, why }));
    const { capped: _capped, ...bonuses } = gearBonuses(items, level, rules);
    return copy({ actor: id, level, counted, unused, bonuses });
}
