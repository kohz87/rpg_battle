// Rules-side projections and wake. The host's ReturnRecord is the complete token: a UI/module assertion cannot create it.
import { indexOfState, indexOfCtx } from '../rules/graph.js';
import { epochOf, isRecordId } from '../rules/ids.js';
import { buildGuard, attachGuard } from '../progress/guard.js';
import { closed } from './records.js';

export function returnStatus(state) {
    if (!indexOfState(state)) return null;
    const pc = state.domains.party?.actors?.[state.domains.party?.pc];
    const dead = (pc?.conditions ?? []).some(c => c.kind === 'dead');
    const records = Object.values(state.domains.savepoints?.returns ?? {});
    const lastReturn = records.at(-1) ?? null;
    const outbox = Object.values(state.domains.death?.outbox ?? {}).findLast(o => o.returnRequested);
    return { dead, point: dead && outbox?.snapshot ? { index: null, beforeRev: null, place: null, fight: null, snapshot: outbox.snapshot.id, target: state.domains.savepoints?.points?.[outbox.snapshot.id]?.target ?? null } : null,
        pending: dead || !!lastReturn && lastReturn.status !== 'complete', memory: lastReturn?.memory ?? 'deja-vu', lastReturn };
}

export function wakeInputs(status, id) {
    const r = status?.lastReturn;
    if (status?.dead || !r || r.id !== id || r.status !== 'complete') return null;
    return { return: r.id, cue: r.cue, snapshot: r.snapshot, batchResult: r.batchResult, newEpoch: r.newEpoch, status: r.status, memory: r.memory };
}

export function cue(ctx, payload) {
    if (!closed(payload, ['return']) || !isRecordId(payload.return)) ctx.fail('INVALID', 'return.cue takes { return } in rules v2.');
    if (ctx.cause !== 'system' || ctx.caller) ctx.fail('REFUSED', 'Only the host complete token can publish a wake.');
    const ix = indexOfCtx(ctx);
    if (!ix) ctx.fail('FEATURE_OFF', 'This chat does not run rules v2.');
    const status = ctx.query('return.status', {});
    const inputs = wakeInputs(status, payload.return);
    if (!inputs) ctx.fail('REFUSED', 'The selected return is not complete.');
    const prior = ctx.read('death').wakes[payload.return];
    if (prior) {
        if (prior.cue !== inputs.cue) ctx.fail('CONFLICT', 'That return already has another cue.');
        return { summary: 'The wake is already recorded.', narrate: false, data: { v2: { result: prior } } };
    }
    if (!ctx.claim(`rb:${epochOf(ctx)}:wake:${payload.return}`)) ctx.fail('CONFLICT', 'The wake claim already exists without its record.');
    attachGuard(ctx, ix, 'return.cue', payload, inputs);
    const result = { return: payload.return, cue: inputs.cue };
    ctx.draft('death').wakes[payload.return] = result;
    const point = ctx.query('savepoint.list', {}).find(s => s.id === inputs.snapshot);
    const scene = point?.scene?.text || 'the saved moment';
    const memory = inputs.memory === 'none' ? '' : inputs.memory === 'full' ? ' The memory of the faded timeline remains; its possessions and rewards do not.' : ' Only a vague sense of déjà vu remains.';
    return { summary: `You wake, alive, at ${scene}.${memory}`, narrate: true, data: { v2: { key: `wake:${payload.return}`, result } } };
}

export function replayWake(view, info) {
    if (info.guard?.predicate?.kind !== 'return.cue') return undefined;
    const g = info.guard;
    const ix = indexOfState(view.state);
    if (!ix || g.version !== 2 || g.epoch !== epochOf(view.state) || g.rulesHash !== ix.rulesHash) return { ok: false, reason: 'The return rules or epoch changed.' };
    const inputs = wakeInputs(view.query('return.status', {}), g.predicate.payload.return);
    if (!inputs) return { ok: false, reason: 'The selected return is no longer complete.' };
    const expected = buildGuard({ hash: view.hash, owner: g.owner, epoch: g.epoch, source: info.source, rulesHash: ix.rulesHash, kind: 'return.cue', payload: g.predicate.payload, inputs });
    return expected.inputHash === g.inputHash ? { ok: true } : { ok: false, reason: 'The complete return changed.' };
}
