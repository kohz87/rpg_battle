// RPG Battle v2, part **craft**: every command and query of another part or module that crafting
// uses, in one place (as the trade part's calls.js), so the shapes it assumes can be changed in one edit.
//
// * Materials and the item made move only through Story Block's inventory commands, called as this
//   module (`ctx.call`): inventory.consume { stack, qty }, inventory.grant { def, qty, owner }. A
//   module's grant is not the story's: the story coin and goods budget does not apply (the item and
//   its numbers are code's result).
// * The dice are the checks part's (MODULES §F80), read through its queries, never imported:
//   `checks.rolls({ for })` (the rolls handed over for the reply) and `checks.log` (the checks the
//   reply already wrote, which took their rolls by place).
// * The clock moves by Story Director's `director.advance { minutes, reason }` when it is there and
//   the story time is set; a host without it is passed over (the receipt still says how long it took).
// * The money scale is Story Block's `inventory.economy` → { scale } (F104), 1 when it is not there.
// * The resale cap is the trade part's `trade.paid` (B-b3-14): what one of a def sells for at most,
//   written as the trade part writes it (a key `<def>#<rev>` per write, the least one holding).

import { leastPaid, writeKey, writesOf } from '../trade/core.js';

export const KEEPER = 'party';
export const CLOCK_COMMAND = 'director.advance';
export const MAX_PAID = 500;

/** A query that may not be registered: its answer, else null. */
export function tryQuery(ctx, name, args) {
    try {
        return ctx.query(name, args) ?? null;
    } catch {
        return null;
    }
}

/** The pack's money scale (F104): `inventory.economy().scale`, else 1. */
export function scaleOf(ask) {
    const scale = Number(ask('inventory.economy', {})?.scale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function consume(ctx, stack, qty) {
    if (qty > 0) ctx.call('inventory.consume', { stack, qty });
}

export function grant(ctx, def, qty, note = '') {
    return ctx.call('inventory.grant', { def, qty, owner: KEEPER, ...(note ? { note } : {}) });
}

/**
 * The story clock moved on by `minutes` (Story Director's command). Only while the story time is set
 * (ctx.time is a number): an unknown command throws UNKNOWN_COMMAND before anything runs, so it is
 * caught and the clock is left to the story. → true when the clock was moved.
 */
export function advanceClock(ctx, minutes, reason) {
    if (!(minutes > 0)) return false;
    let now = null;
    try { now = ctx.time?.() ?? null; } catch { now = null; }
    if (!Number.isInteger(now)) return false;
    try {
        ctx.call(CLOCK_COMMAND, { minutes, reason });
        return true;
    } catch (error) {
        if (error?.code === 'UNKNOWN_COMMAND' || error?.code === 'FEATURE_OFF') return false;
        throw error;
    }
}

/**
 * Keeps `each` as the most one of `def` sells for (trade.paid, B-b3-14), when it is less than what
 * holds: a write of its own (`<def>#<rev>`), the earlier writes for that def removed, MAX_PAID kept.
 */
export function keepPaid(ctx, def, each) {
    if (!(Number.isInteger(each) && each >= 0) || typeof def !== 'string') return;
    let trade;
    try { trade = ctx.draft('trade'); } catch { return; }
    trade.paid ??= {};
    const least = leastPaid(trade.paid);
    if (Object.hasOwn(least, def) && least[def] <= each) return;
    const before = writesOf(trade.paid, def);
    const rev = Number.isInteger(ctx.rev) ? ctx.rev : 0;
    const key = writeKey(trade.paid, def, rev);
    trade.paid[key] = each;
    for (const old of before) delete trade.paid[old];
    const keys = Object.keys(trade.paid);
    if (keys.length > MAX_PAID) {
        const revAt = name => Number(/#(\d+)$/.exec(name)?.[1] ?? 0);
        for (const old of keys.filter(name => name !== key).sort((a, b) => (revAt(a) - revAt(b)) || (a < b ? -1 : 1)).slice(0, keys.length - MAX_PAID)) delete trade.paid[old];
    }
}
