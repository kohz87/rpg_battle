import { buildGuard } from '../progress/guard.js';
import { epochOf } from '../rules/ids.js';
import { indexOfState } from '../rules/graph.js';
import { assessDeath } from './plan.js';
import { replayWake } from './return.js';
import { buildEnd } from '../fight/guards.js';
import { sessionOf } from '../combat/stored.js';
import { lifeOf } from '../rules/sheet.js';
import { attachGuard } from '../progress/guard.js';

function fightInputs(env, payload) {
    const end = buildEnd(env, payload);
    if (!end.ok) return end;
    const session = env.combat.fights?.[payload.session] ?? sessionOf(env.combat);
    const actors = session.setup.party.map(c => {
        const member = env.query('party.actor', { id: c.memberId ?? c.id });
        if (!member) throw new Error('A fighter is missing from this timeline.');
        return { actor: member.id, npcId: member.npcId ?? null, kind: member.kind, life: lifeOf(member), hp: member.hp, conditions: member.conditions };
    });
    return { ok: true, inputs: { fight: end.inputs, death: { actors, minute: env.minute } } };
}

/** The fight's terminal prefix and the owner resets/outbox share one atomic root guard. */
export function guardFightEnd(ctx, ix, payload, recorded) {
    if (ctx.read('death')?.schema !== 2) return false;
    let minute = null;
    try { minute = ctx.query('director.time', {})?.minutes ?? null; } catch { /* Unset time holds its injury anchor. */ }
    const env = { ix, combat: ctx.read('combat'), query: (n, a) => ctx.query(n, a), recorded, minute: Number.isSafeInteger(minute) ? minute : null };
    const asked = fightInputs(env, payload);
    if (!asked.ok) ctx.fail(asked.code, asked.why);
    attachGuard(ctx, ix, 'death.fight-end', payload, asked.inputs, recorded);
    return true;
}

export const DEATH_GUARDS = ['lethal', 'intervention', 'death.resolve'];
export function replayGuard(view, info) {
    const wake = replayWake(view, info);
    if (wake !== undefined) return wake;
    const g = info?.guard;
    const kind = g?.predicate?.kind;
    if (!DEATH_GUARDS.includes(kind) && kind !== 'death.fight-end') return undefined;
    const off = reason => ({ ok: false, reason: `The earlier prerequisite was removed. ${reason}` });
    const ix = indexOfState(view.state);
    if (!ix || g.version !== 2 || g.rulesHash !== ix.rulesHash || g.epoch !== epochOf(view.state)) return off('The rules or epoch changed.');
    const env = { ix, death: view.state.domains.death, progress: view.state.domains.progress, query: view.query, minute: view.state.domains.director?.time?.minutes ?? null };
    if (!env.death) return off('The death records are missing.');
    let answer;
    try {
        answer = kind === 'death.fight-end' ? fightInputs({ ...env, combat: view.state.domains.combat, recorded: info.recorded }, g.predicate.payload)
            : assessDeath(kind, env, g.predicate.payload, info.recorded);
    } catch (error) { return off(error.message); }
    if (!answer.ok) return off(answer.why);
    const expected = buildGuard({ hash: view.hash, owner: g.owner, epoch: g.epoch, source: info.source, rulesHash: ix.rulesHash, kind, payload: g.predicate.payload, inputs: answer.inputs });
    return expected.inputHash === g.inputHash ? { ok: true } : off('The lethal batch changed.');
}
