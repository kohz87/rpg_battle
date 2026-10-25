// Ordinary pool/XP/rest rewrites must not erase or restart a rules-v2 injury's story-time anchor.
// Keep the owner's timed condition, fitted at the current SD minute, for its full 1440 minutes.
//
// An injury written while the story clock is unset has no anchor (`at`). It is anchored by the first write or fold that
// sees a clock: the party's story-time fold (party/recovery.js), a rest or an XP rewrite (preserveInjury). The anchor is
// stored in the party record with that write, so a reload, a rebuild and a replay read the same one; a clock read later
// never moves it. Until then the injury waits (it has no clock to end on), as every other condition of a fight does.
import { indexOfCtx } from '../rules/graph.js';
import { fitActor } from '../party/pools.js';

const isInjury = c => c?.kind === 'injury' && Number.isInteger(c.rounds);
const unanchored = c => isInjury(c) && !Number.isInteger(c.at);

/** Whether this chat runs the death domain (rules v2 pinned). */
export function deathOn(ctx) {
    try { return !!indexOfCtx(ctx) && ctx.read('death')?.schema === 2; } catch { return false; }
}

/** The story minute through a command's query, or null (never a wall clock). */
export function clockOf(ctx) {
    try {
        const minutes = ctx.query('director.time', {})?.minutes;
        return Number.isSafeInteger(minutes) ? minutes : null;
    } catch { return null; }
}

/** Whether a party slice holds an injury that has no anchor yet. */
export const needsAnchor = party => Object.values(party?.actors ?? {}).some(actor => (actor?.conditions ?? []).some(unanchored));

/** Anchors every at-less injury of the party on the command's draft at the current story minute; nothing without a clock. → how many. */
export function anchorInjuries(ctx) {
    if (!deathOn(ctx)) return 0;
    let party;
    try { party = ctx.read('party'); } catch { return 0; }
    if (!needsAnchor(party)) return 0;
    const minutes = clockOf(ctx);
    if (minutes === null) return 0;
    let anchored = 0;
    for (const actor of Object.values(ctx.draft('party').actors ?? {})) {
        if (!(actor.conditions ?? []).some(unanchored)) continue;
        actor.conditions = actor.conditions.map(c => (unanchored(c) ? (anchored += 1, { ...c, at: minutes }) : c));
    }
    return anchored;
}

export function preserveInjury(ctx, before, after) {
    if (!deathOn(ctx)) return after;
    const minutes = clockOf(ctx);
    if ((before.conditions ?? []).some(isInjury)) {
        // An injury with no anchor takes this write's clock, so a rest or an XP rewrite never leaves it timeless.
        const anchored = minutes === null ? before : { ...before, conditions: before.conditions.map(c => (unanchored(c) ? { ...c, at: minutes } : c)) };
        const injuries = (fitActor(anchored, { minutes }).conditions ?? []).filter(isInjury);
        after.conditions = [...after.conditions.filter(c => c.kind !== 'injury'), ...injuries.map(c => ({ ...c }))];
    }
    return after;
}
