// death.anchor: the story-time anchor of an injury that was written while the clock was unset.
//
// The injury has no `at` until a clock exists. The first reply that ends with a clock gives it one through this step, a
// guarded system block of its own (never an unguarded rewrite of the party's conditions). The guard binds the injury as
// it stands before the block (who, how long, still without an anchor), the sealed death result it came from when it came
// from one, and the minute written. Deleting the lethal reply, or the injury's cause, retracts the anchor with the
// injury; deleting the clock the anchor was read from plans it again at its place on the clock that replay sees (or
// leaves it off when none), so live state is always the state of a full replay.
import { indexOfCtx } from '../rules/graph.js';
import { isActorId } from '../rules/ids.js';
import { attachGuard } from '../progress/guard.js';
import { closed } from './records.js';
import { clockOf, unanchored } from './injury.js';

const GONE = 'NO_LONGER_DONE';

/** The sealed death result that left this actor gravely injured, newest first: { id, hash } or null (a fight settlement's injury). */
function originOf(death, progress, actor) {
    const batches = Object.values(death?.batches ?? {}).filter(b => b.status === 'complete' && b.result);
    for (const batch of batches.reverse()) {
        const bytes = progress?.batches?.[batch.result.id]?.bytes;
        if ((bytes?.events ?? []).some(e => e.actor === actor && e.outcome === 'gravely-injured')) return { id: batch.result.id, hash: batch.result.hash };
    }
    return null;
}

/** → { ok, inputs } | { ok: false, code, why }. env: { party, death, progress, minute } (slices before the block, the story minute). */
export function anchorInputs(env, payload) {
    const actor = env.party?.actors?.[payload.actor];
    if (!actor) return { ok: false, code: GONE, why: 'That character is not in the party any more.' };
    const injury = (actor.conditions ?? []).find(unanchored);
    if (!injury) return { ok: false, code: GONE, why: 'That character has no injury waiting for its time.' };
    if (!Number.isSafeInteger(env.minute)) return { ok: false, code: GONE, why: 'There is no story clock to anchor an injury on.' };
    return { ok: true, injury, inputs: { actor: payload.actor, stacks: injury.stacks ?? null, rounds: injury.rounds, minute: env.minute, origin: originOf(env.death, env.progress, payload.actor) } };
}

export function anchor(ctx, payload) {
    if (!closed(payload, ['actor']) || !isActorId(payload.actor)) ctx.fail('INVALID', 'death.anchor takes { actor }.');
    if (!((ctx.cause === 'system' && !ctx.caller) || ctx.caller === ctx.module)) ctx.fail('REFUSED', 'death.anchor is the RB or host system step.');
    const ix = indexOfCtx(ctx) ?? ctx.fail('FEATURE_OFF', 'This chat does not run rules v2.');
    const asked = anchorInputs({ party: ctx.read('party'), death: ctx.read('death'), progress: ctx.read('progress'), minute: clockOf(ctx) }, payload);
    if (!asked.ok) ctx.fail(asked.code, asked.why);
    attachGuard(ctx, ix, 'injury.anchor', payload, asked.inputs);
    const member = ctx.draft('party').actors[payload.actor];
    member.conditions = member.conditions.map(c => (unanchored(c) ? { ...c, at: asked.inputs.minute } : c));
    return { summary: 'The injury is on the clock.', narrate: false, data: { actor: payload.actor, at: asked.inputs.minute } };
}

/** The steps a reply asks for: one per character whose injury still waits for a clock, once a clock exists. */
export function anchorSteps(state, minute) {
    if (!Number.isSafeInteger(minute) || state.domains.death?.schema !== 2) return [];
    return Object.values(state.domains.party?.actors ?? {}).filter(a => (a.conditions ?? []).some(unanchored)).map(a => a.id).sort()
        .map(actor => ({ type: 'death.anchor', payload: { actor } }));
}
