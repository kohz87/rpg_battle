// RPG Battle v2, items part: using, wearing and handing over the party's things (MODULES §B2).
//
// Handlers are synchronous and pure apart from ctx (SPEC §3.2). This part owns no domain: it
// reads `inventory` and `party` and changes them only through their owners' commands
// (`inventory.consume|equip|unequip|transfer`, `party.heal|restore`), inside the same
// transaction, so a refusal anywhere saves nothing. The numbers are v1's: useItemOutside for a
// dose, gearLimits for what counts, capItem for what a piece gives at the wearer's level.
// A rule refusing (full HP, the wrong kind of thing, a slot limit) is REFUSED; a malformed
// payload INVALID (MODULES §F4).

import { capItem, formatStats, gearLimits } from '../../items.js';
import { useItemOutside } from '../../recovery.js';
import { helpsOutside, inventoryOf, itemOf, partyOf, partyOwns, rulesFrom, sheetOf, stackIds, wearerOf } from './shared.js';

const SINGLE_SLOTS = ['weapon', 'offhand', 'armour'];

const stateOf = ctx => ({ domains: { inventory: ctx.read('inventory'), party: ctx.read('party') } });
const text = value => (typeof value === 'string' ? value.trim() : '');

/** The stack and its def, or a refusal: not there, not the party's. */
function stackFor(ctx, payload) {
    const id = text(payload?.stack);
    const inventory = inventoryOf(stateOf(ctx));
    const stack = id ? inventory.stacks?.[id] : null;
    const party = ctx.read('party');
    if (!stack || !partyOwns(party, stack.owner)) ctx.fail('NOT_FOUND', 'That item is not among the party\'s things.');
    const def = inventory.defs?.[stack.def];
    if (!def) ctx.fail('NOT_FOUND', 'That item is not known any more.');
    return { stack, def, party, inventory };
}

function actorFor(ctx, party, id, missing = 'That companion is not in the party.') {
    const actor = id ? party.actors?.[id] : null;
    if (!actor) ctx.fail('NOT_FOUND', id ? missing : 'Make your character first.');
    return actor;
}

/** The equipped stacks `actorId` wears, in a stable order. */
function wornBy(inventory, party, actorId) {
    return stackIds(inventory)
        .map(id => inventory.stacks[id])
        .filter(stack => stack.equipped && stack.qty > 0 && wearerOf(stack, party) === actorId)
        .map(stack => ({ stack, def: inventory.defs?.[stack.def] ?? null }));
}

// "only 2 accessories count", "no worn pieces count" (v1's words).
function limitWords(count, slot) {
    const word = slot === 'accessory' ? (count === 1 ? 'accessory' : 'accessories') : (count === 1 ? 'worn piece' : 'worn pieces');
    return count ? `only ${count} ${word} ${count === 1 ? 'counts' : 'count'}` : `no ${word} count`;
}

/**
 * `item.use` { stack, target }: one dose of a consumable on a party member (the main character
 * when no target is named). Full HP and nothing to cure refuses without spending it, as does a
 * flask that only harms (a fight's thing). Calls `inventory.consume`, then `party.heal`
 * (HP and cures) and `party.restore` (MP) with the amounts v1's useItemOutside works out.
 */
export function itemUse(ctx, payload) {
    const { stack, def, party } = stackFor(ctx, payload);
    if (!(stack.qty > 0)) ctx.fail('NOT_ENOUGH', `There is no ${def.name} left.`);
    if (def.kind !== 'consumable') ctx.fail('REFUSED', `The ${def.name} is not something to use.`);
    if (!helpsOutside(def.effect)) ctx.fail('REFUSED', `${def.name} can only be used in a fight.`);
    const targetId = text(payload?.target) || party.pc;
    const actor = actorFor(ctx, party, targetId);

    const before = sheetOf(actor);
    const outcome = useItemOutside(before, { name: def.name, effect: def.effect });
    if (!outcome.used) ctx.fail('REFUSED', outcome.message);
    const hp = outcome.sheet.hp.cur - before.hp.cur;
    const mp = outcome.sheet.mp.cur - before.mp.cur;
    const cured = before.conditions.filter(entry => !outcome.sheet.conditions.some(left => left.name === entry.name)).map(entry => entry.name);

    ctx.call('inventory.consume', { stack: stack.id, qty: 1 });
    if (hp > 0 || cured.length) ctx.call('party.heal', { actor: targetId, hp, cure: cured });
    if (mp > 0) ctx.call('party.restore', { actor: targetId, mp });

    // What the party's owner made of it, for the "now" numbers (it may clamp to its own max).
    const after = ctx.read('party').actors?.[targetId] ?? null;
    const nowHp = { cur: after?.hp?.cur ?? outcome.sheet.hp.cur, max: after?.hp?.max ?? outcome.sheet.hp.max };
    const nowMp = { cur: after?.mp?.cur ?? outcome.sheet.mp.cur, max: after?.mp?.max ?? outcome.sheet.mp.max };
    const now = !hp && mp ? `${nowMp.cur}/${nowMp.max} MP` : `${nowHp.cur}/${nowHp.max} HP`;
    return {
        summary: `${outcome.message.replace(/\.$/, '')} (now ${now}).`,
        narrate: true,
        data: { actor: targetId, stack: stack.id, def: def.id ?? stack.def, name: def.name, hp, mp, cured, now: { hp: nowHp, mp: nowMp } },
    };
}

/**
 * `item.equip` { stack, actor? }: the wearer puts a piece on. The wearer is whoever carries it
 * (the shared bag's pieces are the main character's); a companion gets a piece by `item.give`
 * first. One weapon, off-hand and armour each: a new one replaces the old one. Worn pieces and
 * accessories up to the rules' limits (v1 gearLimits), else refused. No off-hand with a
 * two-handed weapon (the weapon puts the off-hand away; an off-hand is refused while one is held).
 * What the piece gives is capped by its rarity at the wearer's level (v1 capItem), and the
 * summary says so.
 */
export function itemEquip(ctx, payload) {
    const { stack, def, party, inventory } = stackFor(ctx, payload);
    const slot = def.slot;
    if (def.kind !== 'equipment' || !slot) ctx.fail('REFUSED', `The ${def.name} is not something to wear or wield.`);
    if (!(stack.qty > 0)) ctx.fail('NOT_ENOUGH', `There is no ${def.name} left.`);
    const wearerId = wearerOf(stack, party);
    const actor = actorFor(ctx, party, wearerId);
    const asked = text(payload?.actor);
    if (asked && asked !== wearerId) {
        const other = party.actors?.[asked];
        if (!other) ctx.fail('NOT_FOUND', 'That companion is not in the party.');
        ctx.fail('REFUSED', `${actor.name} carries the ${def.name}: give it to ${other.name} first.`);
    }
    if (stack.equipped) ctx.fail('REFUSED', `${actor.name} already has the ${def.name} on.`);

    const rules = rulesFrom(ctx.settings());
    const worn = wornBy(inventory, party, wearerId);
    const inSlot = worn.filter(entry => entry.stack.equipped === slot);
    const off = [];
    if (SINGLE_SLOTS.includes(slot)) {
        off.push(...inSlot);
        if (slot === 'offhand') {
            const weapon = worn.find(entry => entry.stack.equipped === 'weapon' && entry.def?.tags?.includes('two-handed'));
            if (weapon) ctx.fail('REFUSED', `The ${weapon.def.name} is two-handed: put it away before taking up the ${def.name}.`);
        }
        if (slot === 'weapon' && def.tags?.includes('two-handed')) off.push(...worn.filter(entry => entry.stack.equipped === 'offhand'));
    } else {
        const limit = gearLimits(rules)[slot];
        if (inSlot.length >= limit) {
            ctx.fail('REFUSED', limit ? `For ${actor.name} ${limitWords(limit, slot)}: take one off first.` : `In this chat's rules ${limitWords(0, slot)}.`);
        }
    }
    for (const entry of off) ctx.call('inventory.unequip', { stack: entry.stack.id });
    ctx.call('inventory.equip', { stack: stack.id, slot });

    const level = Math.max(1, Math.round(Number(actor.level) || 1));
    const result = capItem({ ...itemOf(stack, def), equipped: true }, level, rules);
    const gives = formatStats(result.stats);
    const capped = result.capped ? `, capped from ${formatStats(def.stats)} at level ${level}` : '';
    const swapped = off.length ? `; puts away the ${off.map(entry => entry.def?.name ?? 'old piece').join(' and the ')}` : '';
    return {
        summary: `${actor.name} equips the ${def.name}${gives ? ` (${gives}${capped})` : ''}${swapped}.`,
        narrate: false,
        data: { actor: wearerId, stack: stack.id, slot, stats: result.stats, capped: result.capped, removed: off.map(entry => entry.stack.id) },
    };
}

/** `item.unequip` { stack }: the wearer takes a piece off; it stays with them. */
export function itemUnequip(ctx, payload) {
    const { stack, def, party } = stackFor(ctx, payload);
    const wearerId = wearerOf(stack, party);
    const actor = party.actors?.[wearerId];
    if (!stack.equipped) ctx.fail('REFUSED', `The ${def.name} is not being worn.`);
    ctx.call('inventory.unequip', { stack: stack.id });
    return {
        summary: `${actor?.name ?? 'The party'} takes off the ${def.name}.`,
        narrate: false,
        data: { actor: wearerId, stack: stack.id, slot: stack.equipped },
    };
}

/**
 * `item.give` { stack, to, qty = 1 }: hands something to a party member (a companion, or back to
 * the main character). A piece being worn is taken off first. Calls `inventory.transfer`.
 */
export function itemGive(ctx, payload) {
    const { stack, def, party } = stackFor(ctx, payload);
    const toId = text(payload?.to);
    const to = actorFor(ctx, party, toId || null);
    const qty = payload?.qty === undefined ? 1 : payload.qty;
    if (!Number.isInteger(qty) || qty < 1) ctx.fail('INVALID', 'Give at least one.');
    if (qty > stack.qty) ctx.fail('NOT_ENOUGH', stack.qty > 0 ? `There ${stack.qty === 1 ? 'is' : 'are'} only ${stack.qty} ${def.name} to give.` : `There is no ${def.name} left.`);
    if (stack.owner === toId) ctx.fail('REFUSED', `${to.name} already carries the ${def.name}.`);
    if (stack.equipped) ctx.call('inventory.unequip', { stack: stack.id });
    ctx.call('inventory.transfer', { stack: stack.id, to: toId, qty });
    const what = qty === 1 ? `the ${def.name}` : `${qty} ${def.name}`;
    return {
        summary: `${to.name} takes ${what}.`,
        narrate: false,
        data: { stack: stack.id, from: stack.owner, to: toId, qty, unequipped: Boolean(stack.equipped) },
    };
}
