import { buildGuard } from '../progress/guard.js';
import { epochOf } from '../rules/ids.js';
import { indexOfState } from '../rules/graph.js';
import { assessDeath, clockMinute, fightDeaths } from './plan.js';
import { replayWake } from './return.js';
import { anchorInputs } from './anchor.js';
import { buildEnd } from '../fight/guards.js';
import { attachGuard } from '../progress/guard.js';

/**
 * The fight-end guard's inputs, or null inputs when the settlement writes no death or injury (then it keeps the plain combat.end
 * guard, progress/guard.js, exactly as without a death domain). When it does, the guard binds the fight's terminal prefix and
 * only what the settlement writes: who it downs, and the story minute when a result minute or an injury `at` is written. Never a
 * fighter's hp or conditions: an earlier edit of those, or a clock line that only set the time, does not unsettle a won fight.
 */
function fightInputs(env, payload) {
    const end = buildEnd(env, payload);
    if (!end.ok) return end;
    const effects = fightDeaths(env.party, end.result);
    if (!effects) return { ok: true, inputs: null };
    const minute = clockMinute(env.minute);
    // A wipe writes the character's event with its native link, so that link is bound; an injury writes neither.
    const pc = env.party?.actors?.[env.party.pc];
    const death = { downed: effects.downed, wipe: effects.wipe, ...(effects.wipe ? { npcId: pc?.npcId ?? null } : {}), ...(effects.wipe || minute !== null ? { minute } : {}) };
    return { ok: true, inputs: { fight: end.inputs, death } };
}

/** The fight's terminal prefix and the owner resets/outbox share one atomic root guard. False: nothing to bind here (combat.end's guard stands). */
export function guardFightEnd(ctx, ix, payload, recorded) {
    if (ctx.read('death')?.schema !== 2) return false;
    let minute = null;
    try { minute = ctx.query('director.time', {})?.minutes ?? null; } catch { /* Unset time holds its injury anchor. */ }
    const env = { ix, combat: ctx.read('combat'), party: ctx.read('party'), query: (n, a) => ctx.query(n, a), recorded, minute };
    const asked = fightInputs(env, payload);
    if (!asked.ok) ctx.fail(asked.code, asked.why);
    if (!asked.inputs) return false;
    attachGuard(ctx, ix, 'death.fight-end', payload, asked.inputs, recorded);
    return true;
}

export const DEATH_GUARDS = ['lethal', 'intervention', 'death.resolve'];
export function replayGuard(view, info) {
    const wake = replayWake(view, info);
    if (wake !== undefined) return wake;
    const g = info?.guard;
    const kind = g?.predicate?.kind;
    if (!DEATH_GUARDS.includes(kind) && kind !== 'death.fight-end' && kind !== 'injury.anchor') return undefined;
    const off = reason => ({ ok: false, reason: `The earlier prerequisite was removed. ${reason}` });
    const ix = indexOfState(view.state);
    if (!ix || g.version !== 2 || g.rulesHash !== ix.rulesHash || g.epoch !== epochOf(view.state)) return off('The rules or epoch changed.');
    // E1: party queries are declared by the part; story.evidence is host-safe. Read the
    // clock from state and the sealed checks/snapshot/area from info.recorded. Replay
    // must never query live place, purse, native identity or snapshot availability.
    const env = { ix, death: view.state.domains.death, progress: view.state.domains.progress, query: view.query, minute: view.state.domains.director?.time?.minutes ?? null };
    if (!env.death) return off('The death records are missing.');
    const fightEnd = kind === 'death.fight-end';
    let answer;
    try {
        // The anchor reads state alone: the injury before the block, the sealed result it came from, the clock in the state.
        answer = kind === 'injury.anchor' ? anchorInputs({ party: view.state.domains.party, death: env.death, progress: env.progress, minute: env.minute }, g.predicate.payload)
            : fightEnd ? fightInputs({ ...env, combat: view.state.domains.combat, party: view.state.domains.party, recorded: info.recorded }, g.predicate.payload)
            : assessDeath(kind, env, g.predicate.payload, info.recorded);
    } catch (error) { return off(error.message); }
    if (!answer.ok) return off(answer.why);
    if (fightEnd && !answer.inputs) return off('This fight no longer downs anyone, so its death settlement does not stand.');
    const expected = buildGuard({ hash: view.hash, owner: g.owner, epoch: g.epoch, source: info.source, rulesHash: ix.rulesHash, kind, payload: g.predicate.payload, inputs: answer.inputs });
    if (expected.inputHash === g.inputHash) return { ok: true };
    if (kind === 'injury.anchor') return off('The injury this clock was set for, or the clock itself, is not what it was.');
    return off(fightEnd ? 'The fight ended differently: who it downed, or the story time it was settled at, is not what this settlement was made on.' : 'The lethal batch changed.');
}
