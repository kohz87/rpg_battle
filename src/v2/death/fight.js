// Minimal combat/party hooks. Nothing runs until BOTH the rules pin and the death domain are registered.
// The combat.end terminal-prefix guard owns this whole transaction, including the outbox and pool resets.
import { indexOfCtx } from '../rules/graph.js';
import { epochOf } from '../rules/ids.js';
import { activeIds } from '../rules/sheet.js';
import { batchId, eventId, sourceOf, assessDeath, selectSnapshot } from './plan.js';
import { insertEvent, sealDeath, applyDeaths } from './commands.js';

export function deathEnabled(ctx) {
    try { return !!indexOfCtx(ctx) && ctx.read('death')?.schema === 2; } catch { return false; }
}

export function activeFighters(ctx, members) {
    if (!deathEnabled(ctx)) return members;
    const ids = activeIds(ctx.read('progress').roster, members.filter(m => m.kind === 'pc' || !(m.conditions ?? []).some(c => c.kind === 'dead')), members.find(m => m.kind === 'pc')?.id);
    return members.filter(m => ids.includes(m.id));
}

/** Called after party.applyResult, before the end commits. A survivor recovers downed companions; a wipe kills the PC directly. */
export function settleFightDeaths(ctx, { session, result }) {
    if (!deathEnabled(ctx) || session.setup.draws !== 'action') return null;
    const ix = indexOfCtx(ctx);
    const party = ctx.read('party');
    const durable = result.party.filter(m => party.actors[m.memberId] && ['pc', 'companion'].includes(party.actors[m.memberId].kind));
    if (!durable.length || !durable.some(m => m.memberId === party.pc)) return null;
    const down = m => m.down || m.hp.cur <= 0 || party.actors[m.memberId].conditions.some(c => c.kind === 'dead');
    let minute = null;
    try { minute = ctx.query('director.time', {}).minutes; } catch { /* No wall-clock fallback. */ }
    if (!Number.isSafeInteger(minute)) minute = null;
    if (!durable.every(down)) {
        applyDeaths(ctx, { minute, events: durable.filter(m => m.memberId !== party.pc && down(m) && !party.actors[m.memberId].conditions.some(c => c.kind === 'dead')).map(m => ({ actor: m.memberId, outcome: 'gravely-injured' })) });
        return null;
    }
    const epoch = epochOf(ctx);
    const source = sourceOf(ctx.source);
    const batch = batchId(source, epoch);
    const id = eventId(batch, party.pc);
    insertEvent(ctx, { id, batch, source, actor: party.pc, npcId: party.actors[party.pc].npcId ?? null, cause: 'wipe', evidence: [], intervention: null });
    const env = { ix, death: ctx.read('death'), progress: ctx.read('progress'), query: (n, a) => ctx.query(n, a), epoch };
    const plan = assessDeath('death.resolve', env, { event: id });
    if (!plan.ok) ctx.fail(plan.code, plan.why);
    let points = [];
    try { points = ctx.query('savepoint.list', {}); } catch { /* A sealed wipe still records missing snapshot. */ }
    const checks = {};
    for (const event of plan.events) {
        const die = event.cause === 'wipe' || event.intervention ? null : ctx.roll('1d20').total;
        const mod = plan.actors.find(a => a.actor === event.actor).mod;
        checks[event.id] = die === null ? null : { die, mod, dc: ix.constants.deathDc, total: die + mod };
    }
    if (!ctx.claim(`rb:${epoch}:death:${batch}`)) ctx.fail('CLAIMED', 'This wipe was already sealed.');
    return sealDeath(ctx, env, env.death.batches[batch], plan, { minute, snapshot: selectSnapshot(points, minute), checks });
}
