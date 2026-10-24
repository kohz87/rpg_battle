// RPG Battle v2, items part: using, wearing and handing over the party's things (MODULES §B2).
//
// Handlers are synchronous and pure apart from ctx (SPEC §3.2). This part owns no domain: it
// reads `inventory` and `party` and changes them only through their owners' commands
// (`inventory.consume|equip|unequip|transfer`, `party.heal|restore`), inside the same
// transaction, so a refusal anywhere saves nothing. The numbers are v1's: useItemOutside for a
// dose, capItem for what a piece gives at the wearer's level.
// A rule refusing (full HP, the wrong kind of thing, a slot limit, too heavy to carry) is
// REFUSED; a malformed payload INVALID (MODULES §F4).
//
// Slots (P07): the eight slots (weapon, offhand, head, body, legs, feet, accessory-1, accessory-2),
// one piece to a slot. Wearing is Story Block's, planned by this module's `rules.equipPlan`: item.equip
// only asks `inventory.equipOn` (with the optional `targetSlot`), which asks the plan, checks it against
// its own records and applies it in one step. This part never writes equipment by itself.

import { capItem, formatStats } from '../../items.js';
import { useItemOutside } from '../../recovery.js';
import { canCarry } from './carry.js';
import { EQUIP_SLOTS, SLOT_CATEGORY, normalizeSlot } from './slots.js';
import { MAX_DOSES, planStoryUse, stackNamed } from './story-use.js';
import { repairOf, useKit } from './wear.js';
import { fitParty } from '../party/pools.js';
import { sessionOf } from '../combat/stored.js';
import { helpsOutside, inventoryOf, itemOf, partyOwns, rulesFrom, sheetOf, wearerOf } from './shared.js';

const stateOf = ctx => ({ domains: { inventory: ctx.read('inventory'), party: fitParty(ctx.read('party')) } });
const text = value => (typeof value === 'string' ? value.trim() : '');

/** The stack and its def, or a refusal: not there, not the party's. */
function stackFor(ctx, payload) {
    const id = text(payload?.stack);
    const inventory = inventoryOf(stateOf(ctx));
    const stack = id ? inventory.stacks?.[id] : null;
    const party = fitParty(ctx.read('party'));
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

/** One dose of `def` from `stack` on `targetId`: consume, heal, restore. → { hp, mp, cured, message }. */
function dose(ctx, stack, def, targetId) {
    const actor = fitParty(ctx.read('party')).actors?.[targetId];
    const before = sheetOf(actor);
    const outcome = useItemOutside(before, { name: def.name, effect: def.effect });
    if (!outcome.used) ctx.fail('REFUSED', outcome.message);
    const hp = outcome.sheet.hp.cur - before.hp.cur;
    const mp = outcome.sheet.mp.cur - before.mp.cur;
    const cured = before.conditions.filter(entry => !outcome.sheet.conditions.some(left => left.name === entry.name)).map(entry => entry.name);
    ctx.call('inventory.consume', { stack: stack.id, qty: 1 });
    if (hp > 0 || cured.length) ctx.call('party.heal', { actor: targetId, hp, cure: cured });
    if (mp > 0) ctx.call('party.restore', { actor: targetId, mp });
    return { hp, mp, cured, message: outcome.message, sheet: outcome.sheet };
}

/** The "now" numbers after the doses, as the party's owner keeps them (it may clamp to its own max). */
function nowOf(ctx, targetId, fallback) {
    const after = fitParty(ctx.read('party')).actors?.[targetId] ?? null;
    return {
        hp: { cur: after?.hp?.cur ?? fallback.hp.cur, max: after?.hp?.max ?? fallback.hp.max },
        mp: { cur: after?.mp?.cur ?? fallback.mp.cur, max: after?.mp?.max ?? fallback.mp.max },
    };
}

/**
 * `item.use` { stack, target }: one dose of a consumable on a party member (the main character
 * when no target is named). Full HP and nothing to cure refuses without spending it, as does a
 * flask that only harms (a fight's thing). Calls `inventory.consume`, then `party.heal`
 * (HP and cures) and `party.restore` (MP) with the amounts v1's useItemOutside works out.
 *
 * With `story: true` (a story's use, MODULES §F96: from the `use` line, or Story Block routing a
 * `- item … | used: yes` line here; not from a screen) it takes `{ stack | name, on | target, qty }`
 * and refuses by telling the story instead of failing (storyUse).
 */
export function itemUse(ctx, payload) {
    if (payload?.story === true && ctx.cause !== 'ui') return storyUse(ctx, payload);
    // A fight has the party: a draught is the fight's Item action then (combat.act), never a heal beside it.
    if (ctx.cause === 'ui' && fightHolds(ctx)) ctx.fail('REFUSED', 'In a fight, use it from the Fight screen (Item).');
    const { stack, def, party } = stackFor(ctx, payload);
    if (!(stack.qty > 0)) ctx.fail('NOT_ENOUGH', `There is no ${def.name} left.`);
    if (def.kind !== 'consumable') ctx.fail('REFUSED', `The ${def.name} is not something to use.`);
    // A repair kit patches a piece (`piece`: its stack or name; else the user's most worn one).
    if (repairOf(def)) return useKit(ctx, { kit: stack, on: text(payload?.piece), by: text(payload?.target) || party.pc, inFight: inFight(ctx) });
    if (!helpsOutside(def.effect)) ctx.fail('REFUSED', `${def.name} can only be used in a fight.`);
    const targetId = text(payload?.target) || party.pc;
    actorFor(ctx, party, targetId);

    const done = dose(ctx, stack, def, targetId);
    const now = nowOf(ctx, targetId, done.sheet);
    const nowText = !done.hp && done.mp ? `${now.mp.cur}/${now.mp.max} MP` : `${now.hp.cur}/${now.hp.max} HP`;
    return {
        summary: `${done.message.replace(/\.$/, '')} (now ${nowText}).`,
        narrate: true,
        data: { actor: targetId, stack: stack.id, def: def.id ?? stack.def, name: def.name, hp: done.hp, mp: done.mp, cured: done.cured, now },
    };
}

// A fight that has the party (under way, or over and not yet settled), read only.
function fightHolds(ctx) {
    try {
        return Boolean(sessionOf(ctx.read('combat')));
    } catch {
        return false;
    }
}

// A fight going on (the combat part's domain, read only): its own Item action uses things then.
function inFight(ctx) {
    try {
        return sessionOf(ctx.read('combat'))?.status === 'active';
    } catch {
        return false;
    }
}

/** Who a story use is for: `target` (an id), `on` (a name), else the main character; null for nobody. */
function storyTarget(ctx, party, payload) {
    const id = text(payload?.target);
    if (id) return party.actors?.[id] ? id : null;
    const name = text(payload?.on);
    if (!name) return party.pc ?? null;
    try {
        return ctx.query('party.actor', { name })?.id ?? null;
    } catch {
        return Object.values(party.actors ?? {}).find(actor => String(actor?.name ?? '').toLowerCase() === name.toLowerCase())?.id ?? null;
    }
}

/**
 * A story's use (MODULES §F96, story-use.js): `{ name | stack, on | target, qty = 1 }`. The doses
 * that help are used (up to `qty`, at most 10) with their effect from the item's definition; the
 * receipt is told to the next reply. A refusal (nobody of that name, not in the bag, not a
 * consumable, a fight's thing, nothing a dose would do) uses nothing and tells the story why, with
 * `data.refused: true`. While a fight is under way the use is the fight's item action (fightUse).
 */
export function storyUse(ctx, payload = {}) {
    const name = text(payload?.name);
    if (!name && !text(payload?.stack)) ctx.fail('INVALID', 'Name the thing used: `! use Minor Healing Draught | on: Mira`.');
    const qty = payload?.qty === undefined || payload?.qty === null || payload?.qty === '' ? 1 : Number.parseInt(String(payload.qty), 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_DOSES) ctx.fail('INVALID', `Use from 1 to ${MAX_DOSES} at once.`);
    const party = fitParty(ctx.read('party'));
    if (!party?.pc) ctx.fail('NOT_FOUND', 'Make your character first.');
    const inventory = inventoryOf(stateOf(ctx));
    // A repair kit (`effect.repair`) patches a piece: `on:` names the piece, or whose most worn piece.
    const kit = text(payload?.stack) ? inventory.stacks?.[text(payload.stack)] ?? null : stackNamed(inventory, party, name, party.pc);
    if (kit && repairOf(inventory.defs?.[kit.def])) {
        const by = text(payload?.by) ? storyTarget(ctx, party, { on: payload.by }) : party.pc;
        return useKit(ctx, { kit, on: text(payload?.on), by: by ?? party.pc, story: true, inFight: inFight(ctx) });
    }
    if (inFight(ctx)) return fightUse(ctx, payload, { name, qty, party });
    const who = storyTarget(ctx, party, payload);
    const plan = planStoryUse({ inventory, party, name, stack: text(payload?.stack), who, qty, inFight: false });
    if (!plan.ok) {
        const reason = plan.reason.charAt(0).toUpperCase() + plan.reason.slice(1);
        return {
            summary: `${reason}.`,
            narrate: true,
            data: { refused: true, reason: plan.reason, name: plan.def?.name ?? name, actor: plan.actor?.id ?? null, qty },
        };
    }
    const { stack, def } = plan;
    let hp = 0;
    let mp = 0;
    const cured = [];
    let last = null;
    for (let n = 0; n < plan.doses; n++) {
        last = dose(ctx, stack, def, who);
        hp += last.hp;
        mp += last.mp;
        cured.push(...last.cured);
    }
    const now = nowOf(ctx, who, last.sheet);
    const nowText = !hp && mp ? `${now.mp.cur}/${now.mp.max} MP` : `${now.hp.cur}/${now.hp.max} HP`;
    const actor = plan.actor;
    const what = plan.doses === 1 ? `the ${def.name}` : `${plan.doses} ${def.name}`;
    const gives = [hp > 0 ? `+${hp} HP` : '', mp > 0 ? `+${mp} MP` : '', cured.length ? `cures ${[...new Set(cured)].join(', ')}` : ''].filter(Boolean).join(', ');
    const had = stack.qty;
    const left = qty - plan.doses;
    const kept = !left ? ''
        : plan.doses === had ? `; only ${had} ${had === 1 ? 'was' : 'were'} in the bag`
            : `; ${left === 1 ? 'one more' : `${left} more`} would not help, so ${left === 1 ? 'it stays' : 'they stay'} in the bag`;
    return {
        summary: `${actor.name} uses ${what}${gives ? `: ${gives}` : ''} (now ${nowText})${kept}.`,
        narrate: true,
        data: { actor: who, stack: stack.id, def: def.id ?? stack.def, name: def.name, doses: plan.doses, asked: qty, hp, mp, cured: [...new Set(cured)], now, refused: false },
    };
}

/**
 * The reply a story line came from: its record id (`sid:<sid>`, which a middle delete never
 * moves), else `<index>:<swipe>` (or the host's key), else null.
 */
function carrierOf(ctx) {
    const carrier = ctx?.carrier;
    if (typeof carrier?.sid === 'string' && carrier.sid) return `sid:${carrier.sid.slice(0, 60)}`;
    if (typeof carrier?.key === 'string') return carrier.key;
    if (Number.isInteger(carrier?.index)) return `${carrier.index}:${Number.isInteger(carrier.swipe) ? carrier.swipe : 0}`;
    return null;
}

/**
 * A story's use while a fight is under way: the fight's own item action (`combat.act { action:
 * { type: 'item', item, target } }`), which takes the dose out of the inventory when it is used and
 * keeps everyone's HP with the fight. It fits only when it is a party member's turn (the one
 * `by:` names, when named), that member has the thing among their fight items, one dose is asked
 * and the one it is for is someone the item can reach, and no other line of the same reply played
 * a fight turn (one a reply); otherwise it is refused (a Problem) and the thing stays in the bag.
 */
function fightUse(ctx, payload, { name, qty, party }) {
    const label = name || 'that';
    if (qty !== 1) ctx.fail('REFUSED', `In a fight one dose is used per turn: the ${label} stays in the bag.`);
    let view = null;
    try { view = ctx.query('combat.session'); } catch { view = null; }
    const turn = view?.status === 'active' ? (view.combatants ?? []).find(c => c.id === view.actions?.actor) : null;
    if (!turn || turn.side !== 'party') ctx.fail('REFUSED', `It is not the party's turn in the fight: the ${label} stays in the bag.`);
    const by = text(payload?.by);
    if (by && by.toLowerCase() !== String(turn.name).toLowerCase()) ctx.fail('REFUSED', `It is ${turn.name}'s turn in the fight, not ${by}'s: the ${label} stays in the bag.`);
    const item = (view.actions.items ?? []).find(entry => String(entry.name).toLowerCase() === label.toLowerCase());
    if (!item) ctx.fail('REFUSED', `${turn.name} has no ${label} to use in the fight: it stays in the bag.`);
    const targetName = text(payload?.on) || (payload?.target ? party.actors?.[text(payload.target)]?.name ?? '' : '');
    let target = null;
    if (targetName) {
        const reach = new Set([turn.id, ...(view.actions.targets?.allies ?? [])]);
        const found = (view.combatants ?? []).find(c => c.side === 'party' && String(c.name).toLowerCase() === targetName.toLowerCase());
        if (!found || !reach.has(found.id) || (item.target === 'self' && found.id !== turn.id)) ctx.fail('REFUSED', `The ${item.name} cannot reach ${targetName} in the fight now: it stays in the bag.`);
        target = found.id;
    }
    // One fight turn a reply (B-b4-7): the story may not play the fight, and each of its use lines
    // would be the reader's turn and every foe turn after it.
    const reply = carrierOf(ctx);
    if (reply !== null && !ctx.claim(`fightuse:${reply}`)) ctx.fail('CLAIMED', `This reply already used something in the fight: the ${item.name} stays in the bag.`);
    const done = ctx.call('combat.act', { action: { type: 'item', item: item.name, ...(target ? { target } : {}) }, ...(typeof view.id === 'string' ? { session: view.id } : {}) });
    return {
        summary: `${turn.name} uses the ${item.name} in the fight${targetName ? ` on ${targetName}` : ''}: ${done?.summary ?? 'done'}`,
        narrate: false,
        data: { fight: true, actor: turn.id, name: item.name, target, log: done?.data?.log ?? [], used: done?.data?.used ?? [], refused: false },
    };
}

/** The `use` change line: `! use Minor Healing Draught | on: Mira | qty: 2` (a story's use, MODULES §F96). */
export function applyUse(ctx, line) {
    const labels = {};
    for (const [label, value] of Object.entries(line?.labels ?? {})) labels[String(label).trim().toLowerCase()] = String(value ?? '').trim();
    return storyUse(ctx, { name: line?.name ?? '', on: labels.on ?? labels.who ?? '', by: labels.by ?? '', qty: labels.qty ?? 1 });
}

export const USE_GRAMMAR = '! use <item> | on: Name | by: Name | qty: 1 (someone drinks, eats or applies it; code applies its effect)';

const EQUIP_FIELDS = ['stack', 'to', 'actor', 'targetSlot'];

/**
 * `item.equip` { stack, to?, actor?, targetSlot? }: the wearer puts a piece on, in the eight slots (P07).
 * The wearer is `to` when named (any party member; a piece of the party bag goes to them), else whoever
 * carries the piece (the shared bag's pieces are the main character's); `actor` only checks the current
 * carrier. The slot is `targetSlot` when the reader chose one (the only new field; a canonical ID), else the
 * first legal empty slot of the piece, else an explicit swap of its first slot (rules.equipPlan decides
 * and says why not). Nothing is worn here: this calls `inventory.equipOn`, which asks the plan, checks it and
 * applies it (a spoofed plan is refused there, a two-handed piece clears the off-hand, an off-hand beside
 * one is refused, a carried piece of another member is handed over first). Whatever came off is named in
 * the summary and listed in `data.removed` (stack ids) and `data.removedNames`; `data.slot` and `data.key`
 * are the v2 slot it went into. What the piece gives is capped by its rarity at the wearer's level (v1
 * capItem), and the summary says so.
 */
export function itemEquip(ctx, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !EQUIP_FIELDS.includes(key))) {
        ctx.fail('INVALID', 'Equip takes a stack, optionally who wears it (to) and a targetSlot; nothing else.');
    }
    const targetSlot = payload.targetSlot;
    if (targetSlot !== undefined && !EQUIP_SLOTS.includes(targetSlot)) ctx.fail('INVALID', `targetSlot must be one of ${EQUIP_SLOTS.join(', ')}.`);
    const { stack, def, party } = stackFor(ctx, payload);
    if (def.kind !== 'equipment' || !def.slot) ctx.fail('REFUSED', `The ${def.name} is not something to wear or wield.`);
    if (!(stack.qty > 0)) ctx.fail('NOT_ENOUGH', `There is no ${def.name} left.`);
    const to = text(payload?.to);
    const holder = wearerOf(stack, party);
    if (to) {
        if (!party.actors?.[to]) ctx.fail('NOT_FOUND', 'That companion is not in the party.');
        if (stack.equipped && holder !== to) ctx.fail('REFUSED', `${actorFor(ctx, party, holder).name} already has the ${def.name} on.`);
    }
    const wearerId = to || holder;
    const actor = actorFor(ctx, party, wearerId);
    const asked = to ? '' : text(payload?.actor);
    if (asked && asked !== wearerId) {
        const other = party.actors?.[asked];
        if (!other) ctx.fail('NOT_FOUND', 'That companion is not in the party.');
        ctx.fail('REFUSED', `${actor.name} carries the ${def.name}: give it to ${other.name} first.`);
    }
    // Already on, in the slot asked for (or, with none asked, in the one it is in): nothing to do.
    if (stack.equipped && holder === wearerId && (targetSlot === undefined || normalizeSlot(stack.equipped) === targetSlot)) {
        ctx.fail('REFUSED', `${actor.name} already has the ${def.name} on.`);
    }

    const done = ctx.call('inventory.equipOn', { stack: stack.id, actor: wearerId, ...(targetSlot !== undefined ? { targetSlot } : {}) });
    const into = done?.data?.slot;
    const key = EQUIP_SLOTS.includes(into) ? into : normalizeSlot(readStackKey(ctx, stack.id));
    const removed = Array.isArray(done?.data?.replaced) ? done.data.replaced.filter(id => typeof id === 'string') : [];
    const removedNames = Array.isArray(done?.data?.replacedNames) ? done.data.replacedNames.map(String) : [];
    const from = done?.data?.from;
    // The main character's bag is the party's: a piece the party held is theirs without a hand-over to say.
    const moved = typeof from === 'string' && from !== wearerId && !(from === 'party' && wearerId === party.pc) ? { from, to: wearerId } : null;

    const rules = rulesFrom(ctx.settings());
    const level = Math.max(1, Math.round(Number(actor.level) || 1));
    const result = capItem({ ...itemOf(stack, def), slot: SLOT_CATEGORY[key] ?? itemOf(stack, def).slot, equipped: true }, level, rules);
    const gives = formatStats(result.stats);
    const capped = result.capped ? `, capped from ${formatStats(def.stats)} at level ${level}` : '';
    const swapped = removed.length ? `; puts away the ${(removedNames.length === removed.length ? removedNames : removed.map(() => 'old piece')).join(' and the ')}` : '';
    return {
        summary: `${actor.name} equips the ${def.name}${gives ? ` (${gives}${capped})` : ''}${swapped}.`,
        narrate: false,
        data: { actor: wearerId, stack: stack.id, slot: key, key, stats: result.stats, capped: result.capped, removed, removedNames, ...(targetSlot !== undefined ? { targetSlot } : {}), ...(moved ? { moved } : {}) },
    };
}

// The key a stack is stored under now (read back after the nested call, for the receipt).
function readStackKey(ctx, id) {
    return ctx.read('inventory')?.stacks?.[id]?.equipped ?? null;
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
 * the main character). A piece being worn is taken off first. Refused when the taker cannot
 * carry it (the carry limit, carry.js): it stays with the giver. Calls `inventory.transfer`.
 */
export function itemGive(ctx, payload) {
    const { stack, def, party } = stackFor(ctx, payload);
    const toId = text(payload?.to);
    const to = actorFor(ctx, party, toId || null);
    const qty = payload?.qty === undefined ? 1 : payload.qty;
    if (!Number.isInteger(qty) || qty < 1) ctx.fail('INVALID', 'Give at least one.');
    if (qty > stack.qty) ctx.fail('NOT_ENOUGH', stack.qty > 0 ? `There ${stack.qty === 1 ? 'is' : 'are'} only ${stack.qty} ${def.name} to give.` : `There is no ${def.name} left.`);
    if (stack.owner === toId) ctx.fail('REFUSED', `${to.name} already carries the ${def.name}.`);
    const fits = canCarry(inventoryOf(stateOf(ctx)), party, { owner: toId, add: [{ def, qty }], move: true, settings: ctx.settings() });
    if (!fits.ok) ctx.fail('REFUSED', fits.message);
    if (stack.equipped) ctx.call('inventory.unequip', { stack: stack.id });
    ctx.call('inventory.transfer', { stack: stack.id, to: toId, qty });
    const what = qty === 1 ? `the ${def.name}` : `${qty} ${def.name}`;
    return {
        summary: `${to.name} takes ${what}.`,
        narrate: false,
        data: { stack: stack.id, from: stack.owner, to: toId, qty, unequipped: Boolean(stack.equipped) },
    };
}
