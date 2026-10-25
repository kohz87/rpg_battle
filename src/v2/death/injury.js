// Ordinary pool/XP/rest rewrites must not erase or restart a rules-v2 injury's story-time anchor.
// Keep the owner's timed condition, fitted at the current SD minute, for its full 1440 minutes.
//
// An injury written while the story clock is unset has no anchor (`at`). Only the guarded death.anchor step
// (anchor.js) gives it one, so the anchor goes with the injury it belongs to; a rewrite here never invents one.
import { indexOfCtx } from '../rules/graph.js';
import { fitActor } from '../party/pools.js';

export const isInjury = c => c?.kind === 'injury' && Number.isInteger(c.rounds);
export const unanchored = c => isInjury(c) && !Number.isInteger(c.at);

/** The story minute through a command's query, or null (never a wall clock). */
export function clockOf(ctx) {
    try {
        const minutes = ctx.query('director.time', {})?.minutes;
        return Number.isSafeInteger(minutes) ? minutes : null;
    } catch { return null; }
}

export function preserveInjury(ctx, before, after) {
    if (!indexOfCtx(ctx) || ctx.read('death')?.schema !== 2) return after;
    const minutes = clockOf(ctx);
    if ((before.conditions ?? []).some(isInjury)) {
        const injuries = (fitActor(before, { minutes }).conditions ?? []).filter(isInjury);
        after.conditions = [...after.conditions.filter(c => c.kind !== 'injury'), ...injuries.map(c => ({ ...c }))];
    }
    return after;
}
