import { indexOfCtx } from '../rules/graph.js';
import { epochOf, isActorId, isObject, isRecordId } from '../rules/ids.js';
import { attachGuard } from '../progress/guard.js';
import { storedPool, fitPool, FIGHT_LEFT_MINUTES } from '../party/pools.js';
import { seal } from '../fight/batch.js';
import { storeBatch } from '../fight/index.js';
import { assessDeath, batchId, eventId, resultBytes, selectSnapshot, sourceOf } from './plan.js';
import { closed, resultOK } from './records.js';

const pinned = ctx => indexOfCtx(ctx) ?? ctx.fail('FEATURE_OFF', 'This chat does not run rules v2.');
const envOf = (ctx, ix) => {
    let minute = null;
    try { minute = ctx.query('director.time', {})?.minutes ?? null; } catch { /* No story clock. */ }
    return { ix, death: ctx.read('death'), progress: ctx.read('progress'), query: (n, a) => ctx.query(n, a), epoch: epochOf(ctx), minute: Number.isSafeInteger(minute) ? minute : null };
};
const claim = (ctx, kind, id) => { if (!ctx.claim(`rb:${epochOf(ctx)}:${kind}:${id}`)) ctx.fail('CLAIMED', 'That death step was already recorded.'); };
const assert = (ctx, answer) => { if (!answer.ok) ctx.fail(answer.code, answer.why); return answer; };

function knownNative(ctx, npcId) {
    if (npcId === null) return;
    let identity = null;
    try { identity = ctx.query('npc.identity', { id: npcId }); } catch { /* Missing native identity holds only this action. */ }
    if (!identity || identity.id !== npcId || typeof identity.nativeKey !== 'string' || !identity.nativeKey) ctx.fail('NOT_FOUND', 'The linked native identity is unavailable; the death is held.');
}

/** Capture entry, not a public command. Code-validated active proof is required before pending death exists. */
export function recordLethal(ctx, payload) {
    if (!closed(payload, ['actor', 'cause', 'evidence']) || !isActorId(payload.actor) || !['narrative', 'execution'].includes(payload.cause)) ctx.fail('INVALID', 'lethal takes { actor, cause, evidence }.');
    if (ctx.cause === 'ui') ctx.fail('REFUSED', 'Narration can propose a lethal event; a button cannot.');
    const ix = pinned(ctx);
    const env = envOf(ctx, ix);
    const answer = assert(ctx, assessDeath('lethal', env, payload));
    knownNative(ctx, answer.member.npcId ?? null);
    const source = sourceOf(ctx.source);
    const batch = batchId(source, env.epoch);
    const id = eventId(batch, payload.actor);
    const event = { id, batch, source, actor: payload.actor, npcId: answer.member.npcId ?? null, cause: payload.cause, evidence: answer.evidence, intervention: null };
    const prior = env.death.events[id];
    if (prior) {
        const meaning = e => ({ actor: e.actor, npcId: e.npcId, cause: e.cause, evidence: e.evidence, batch: e.batch });
        if (ctx.hash(meaning(prior)) !== ctx.hash(meaning(event))) ctx.fail('CONFLICT', 'That actor already has another lethal event at this boundary.');
        return { summary: 'The lethal event is already recorded.', narrate: false, data: { event: id, batch } };
    }
    if (env.death.batches[batch]?.status === 'complete') ctx.fail('REFUSED', 'That boundary is sealed.');
    claim(ctx, 'lethal', id);
    attachGuard(ctx, ix, 'lethal', payload, answer.inputs);
    insertEvent(ctx, event);
    return { summary: `${answer.member.name} faces a lethal event.`, narrate: false, data: { event: id, batch } };
}

export function insertEvent(ctx, event) {
    const death = ctx.draft('death');
    const batch = (death.batches[event.batch] ??= { id: event.batch, source: event.source, events: [], status: 'pending', result: null });
    if (batch.status !== 'pending') ctx.fail('CONFLICT', 'A sealed batch cannot admit another event.');
    if (death.events[event.id]) ctx.fail('CONFLICT', 'A death event cannot be replaced.');
    death.events[event.id] = event;
    batch.events.push(event.id);
}

export function intervene(ctx, payload) {
    if (!closed(payload, ['event', 'evidence']) || !isRecordId(payload.event) || !isRecordId(payload.evidence)) ctx.fail('INVALID', 'intervention takes { event, evidence }.');
    if (ctx.cause === 'ui') ctx.fail('REFUSED', 'An intervention needs a validated rescue in the story.');
    const ix = pinned(ctx);
    const answer = assert(ctx, assessDeath('intervention', envOf(ctx, ix), payload));
    claim(ctx, 'rescue', payload.evidence);
    claim(ctx, 'rescue-payment', answer.rescue.payment);
    attachGuard(ctx, ix, 'intervention', payload, answer.inputs);
    ctx.draft('death').events[payload.event].intervention = answer.rescue;
    return { summary: 'The paid intervention is recorded.', narrate: false, data: { event: payload.event } };
}

/** Absolute owner resets: taking back earlier damage cannot heal past the sealed result. */
export function applyDeaths(ctx, bytes) {
    const party = ctx.draft('party');
    for (const event of bytes.events) {
        const member = party.actors[event.actor];
        if (!member) ctx.fail('NOT_FOUND', 'The lethal actor left the party.');
        const hp = fitPool(member.hp);
        for (const field of ['cur', 'max', 'lost']) ctx.absolute('party', `/actors/${member.id}/hp/${field}`);
        member.hp = storedPool({ cur: event.outcome === 'dead' ? 0 : 1, max: hp.max });
        member.conditions = member.conditions.filter(c => !['dead', 'injury', 'downed'].includes(c.kind));
        member.conditions.push(event.outcome === 'dead' ? { kind: 'dead', stacks: 1 }
            : { kind: 'injury', stacks: 1, rounds: indexOfCtx(ctx).constants.injuryMinutes / FIGHT_LEFT_MINUTES, ...(bytes.minute !== null ? { at: bytes.minute } : {}) });
        delete ctx.draft('progress').carried?.[member.id];
    }
}

/** Records the whole ordered decision/outbox before any owner effect. Caller owns the root guard. */
export function sealDeath(ctx, env, batch, plan, recorded) {
    for (const actor of plan.actors) knownNative(ctx, actor.npcId);
    const bytes = resultBytes(env, batch, plan, recorded);
    if (!resultOK(bytes)) ctx.fail('FAILED', 'The death result is not a closed B6 record.');
    const sealed = seal(bytes);
    const id = ctx.id('br');
    const result = { id, hash: sealed.hash };
    storeBatch(ctx, id, sealed);
    const death = ctx.draft('death');
    death.batches[batch.id].status = 'complete';
    death.batches[batch.id].result = result;
    death.outbox[batch.id] = { batch: batch.id, result, events: bytes.events.map(e => e.id), native: bytes.events.filter(e => e.outcome === 'dead' && e.npcId !== null).map(e => ({ event: e.id, npc: e.npcId })), returnRequested: bytes.returnRequested, snapshot: bytes.snapshot };
    applyDeaths(ctx, bytes);
    return { batch: result, bytes };
}

export function resolve(ctx, payload) {
    if (!closed(payload, ['event']) || !isRecordId(payload.event)) ctx.fail('INVALID', 'death.resolve takes { event }.');
    if (!((ctx.cause === 'system' && !ctx.caller) || ctx.caller === ctx.module)) ctx.fail('REFUSED', 'death.resolve is the RB or host system step.');
    const ix = pinned(ctx);
    const env = envOf(ctx, ix);
    const event = env.death.events[payload.event];
    if (!event) ctx.fail('NOT_FOUND', 'That lethal event is not recorded.');
    const batch = env.death.batches[event.batch];
    if (batch.status === 'complete') {
        const bytes = ctx.read('progress').batches[batch.result.id].bytes;
        return { summary: 'That death batch is already resolved.', narrate: false, data: { v2: { result: { event: event.id, batch: batch.result.id, outcome: bytes.returnRequested ? 'dead' : bytes.events.find(e => e.id === event.id).outcome, snapshot: bytes.snapshot?.id ?? null } } } };
    }
    const plan = assert(ctx, assessDeath('death.resolve', env, payload));
    for (const a of plan.actors) knownNative(ctx, a.npcId);
    let minute = null;
    let points = [];
    try { minute = ctx.query('director.time', {}).minutes; } catch { /* No invented story time. */ }
    if (!Number.isSafeInteger(minute)) minute = null;
    try { points = ctx.query('savepoint.list', {}); } catch { /* Missing snapshots remain a held outbox. */ }
    const recorded = { minute, snapshot: selectSnapshot(points, minute), checks: {} };
    for (const e of plan.events) {
        const mod = plan.actors.find(a => a.actor === e.actor).mod;
        const die = e.cause === 'wipe' || e.intervention ? null : ctx.roll('1d20').total;
        recorded.checks[e.id] = die === null ? null : { die, mod, dc: ix.constants.deathDc, total: die + mod };
    }
    const asked = assert(ctx, assessDeath('death.resolve', env, payload, recorded));
    claim(ctx, 'death', batch.id);
    attachGuard(ctx, ix, 'death.resolve', payload, asked.inputs, recorded);
    const sealed = sealDeath(ctx, env, batch, asked, recorded);
    const outcome = sealed.bytes.returnRequested ? 'dead' : sealed.bytes.events.find(e => e.id === event.id).outcome;
    return { summary: 'The lethal batch is resolved.', narrate: true, data: { v2: { key: `death:${batch.id}`, result: { event: event.id, batch: sealed.batch.id, outcome, snapshot: sealed.bytes.snapshot?.id ?? null } } } };
}

export const commands = { 'death.resolve': resolve };
