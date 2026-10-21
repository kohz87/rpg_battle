// RPG Battle v2, items part: using, wearing and handing over the party's things (MODULES §B2).
//
// Handlers are synchronous and pure apart from ctx (SPEC §3.2). This part owns no domain: it
// reads `inventory` and `party` and changes them only through their owners' commands
// (`inventory.consume|equip|unequip|transfer`, `party.heal|restore`), inside the same
// transaction, so a refusal anywhere saves nothing. The numbers are v1's: useItemOutside for a
// dose, gearLimits for what counts, capItem for what a piece gives at the wearer's level.
// A rule refusing (full HP, the wrong kind of thing, a slot limit, too heavy to carry) is
// REFUSED; a malformed payload INVALID (MODULES §F4).
//
// Slots: a weapon, an off-hand, an armour (and any slot v1 does not count by number) are one each,
// kept under the slot's own name. Worn
// pieces and accessories may be several (v1 gearLimits: 1 worn piece, 2 accessories), so each
// allowed copy has its own key, `accessory-1`, `accessory-2`, `worn-1`: Story Block keeps one
// stack per owner and key, and a second ring is worn beside the first, never in its place.

import { capItem, formatStats, gearLimits } from '../../items.js';
import { useItemOutside } from '../../recovery.js';
import { canCarry } from './carry.js';
import { MAX_DOSES, planStoryUse } from './story-use.js';
import { baseSlot, helpsOutside, inventoryOf, itemOf, partyOf, partyOwns, rulesFrom, sheetOf, stackIds, wearerOf } from './shared.js';

// Slots that hold several pieces (v1 gearLimits); every other slot holds one, a new piece replacing the old.
const MANY_SLOTS = ['worn', 'accessory'];

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

/** One dose of `def` from `stack` on `targetId`: consume, heal, restore. → { hp, mp, cured, message }. */
function dose(ctx, stack, def, targetId) {
    const actor = ctx.read('party').actors?.[targetId];
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
    const after = ctx.read('party').actors?.[targetId] ?? null;
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
    const { stack, def, party } = stackFor(ctx, payload);
    if (!(stack.qty > 0)) ctx.fail('NOT_ENOUGH', `There is no ${def.name} left.`);
    if (def.kind !== 'consumable') ctx.fail('REFUSED', `The ${def.name} is not something to use.`);
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

// A fight going on (the combat part's domain, read only): its own Item action uses things then.
function inFight(ctx) {
    try {
        return ctx.read('combat')?.session?.status === 'active';
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
    const party = ctx.read('party');
    if (!party?.pc) ctx.fail('NOT_FOUND', 'Make your character first.');
    if (inFight(ctx)) return fightUse(ctx, payload, { name, qty, party });
    const inventory = inventoryOf(stateOf(ctx));
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

/**
 * `item.equip` { stack, actor? }: the wearer puts a piece on. The wearer is whoever carries it
 * (the shared bag's pieces are the main character's); a companion gets a piece by `item.give`
 * first. One weapon, off-hand and armour each: a new one replaces the old one. Worn pieces and
 * accessories up to the rules' limits (v1 gearLimits), else refused, each copy under its own key
 * (`accessory-1`, `accessory-2`). Whatever came off is named in the summary and listed in
 * `data.removed` (stack ids) and `data.removedNames`. No off-hand with a
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
    const inSlot = worn.filter(entry => baseSlot(entry.stack.equipped) === slot);
    const off = [];
    let key = slot;
    if (!MANY_SLOTS.includes(slot)) {
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
        const taken = new Set(worn.map(entry => entry.stack.equipped));
        let n = 1;
        while (taken.has(`${slot}-${n}`)) n += 1;
        key = `${slot}-${n}`;
    }
    for (const entry of off) ctx.call('inventory.unequip', { stack: entry.stack.id });
    ctx.call('inventory.equip', { stack: stack.id, slot: key });

    // What came off, by what is worn now (the pieces put away above, and anything else the
    // inventory took off to make room): the receipt says so.
    const now = new Set(wornBy(inventoryOf({ domains: { inventory: ctx.read('inventory') } }), party, wearerId).map(entry => entry.stack.id));
    const removed = worn.filter(entry => !now.has(entry.stack.id));

    const level = Math.max(1, Math.round(Number(actor.level) || 1));
    const result = capItem({ ...itemOf(stack, def), equipped: true }, level, rules);
    const gives = formatStats(result.stats);
    const capped = result.capped ? `, capped from ${formatStats(def.stats)} at level ${level}` : '';
    const swapped = removed.length ? `; puts away the ${removed.map(entry => entry.def?.name ?? 'old piece').join(' and the ')}` : '';
    return {
        summary: `${actor.name} equips the ${def.name}${gives ? ` (${gives}${capped})` : ''}${swapped}.`,
        narrate: false,
        data: { actor: wearerId, stack: stack.id, slot, key, stats: result.stats, capped: result.capped, removed: removed.map(entry => entry.stack.id), removedNames: removed.map(entry => entry.def?.name ?? '') },
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
