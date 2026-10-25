// Ordinary pool/XP/rest rewrites must not erase or restart a rules-v2 injury's story-time anchor.
// Keep the owner's timed condition, fitted at the current SD minute, for its full 1440 minutes.
import { indexOfCtx } from '../rules/graph.js';
import { fitActor } from '../party/pools.js';

export function preserveInjury(ctx, before, after) {
    if (!indexOfCtx(ctx) || ctx.read('death')?.schema !== 2) return after;
    let minutes = null;
    try { minutes = ctx.query('director.time', {})?.minutes ?? null; } catch { /* No invented time. */ }
    if ((before.conditions ?? []).some(c => c.kind === 'injury' && Number.isInteger(c.rounds))) {
        const injuries = (fitActor(before, { minutes }).conditions ?? []).filter(c => c.kind === 'injury' && Number.isInteger(c.rounds));
        after.conditions = [...after.conditions.filter(c => c.kind !== 'injury'), ...injuries.map(c => ({ ...c }))];
    }
    return after;
}
