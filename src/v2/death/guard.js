import { buildGuard } from '../progress/guard.js';
import { epochOf } from '../rules/ids.js';
import { indexOfState } from '../rules/graph.js';
import { assessDeath } from './plan.js';
import { replayWake } from './return.js';

export const DEATH_GUARDS = ['lethal', 'intervention', 'death.resolve'];
export function replayGuard(view, info) {
    const wake = replayWake(view, info);
    if (wake !== undefined) return wake;
    const g = info?.guard;
    const kind = g?.predicate?.kind;
    if (!DEATH_GUARDS.includes(kind)) return undefined;
    const off = reason => ({ ok: false, reason: `The earlier prerequisite was removed. ${reason}` });
    const ix = indexOfState(view.state);
    if (!ix || g.version !== 2 || g.rulesHash !== ix.rulesHash || g.epoch !== epochOf(view.state)) return off('The rules or epoch changed.');
    const env = { ix, death: view.state.domains.death, progress: view.state.domains.progress, query: view.query, minute: view.state.domains.director?.time?.minutes ?? null };
    if (!env.death) return off('The death records are missing.');
    const answer = assessDeath(kind, env, g.predicate.payload, info.recorded);
    if (!answer.ok) return off(answer.why);
    const expected = buildGuard({ hash: view.hash, owner: g.owner, epoch: g.epoch, source: info.source, rulesHash: ix.rulesHash, kind, payload: g.predicate.payload, inputs: answer.inputs });
    return expected.inputHash === g.inputHash ? { ok: true } : off('The lethal batch changed.');
}
