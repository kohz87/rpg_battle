import { hashJson } from '../rules/hash.js';
import { idFromHash } from '../rules/ids.js';
import { lifeOf } from '../rules/sheet.js';
import { lethalProofs, rescueProof } from './proofs.js';
import { statModifier } from '../checks/modifiers.js';

export const sourceOf = s => ({ sid: s.sid, swipeKey: s.swipeKey, evidence: s.evidence, ordinal: s.ordinal });
export const batchId = (source, epoch) => idFromHash('db', hashJson({ sid: source.sid, swipeKey: source.swipeKey, epoch }));
export const eventId = (batch, actor) => idFromHash('de', hashJson({ batch, actor }));
export const fail = (code, why) => ({ ok: false, code, why });

export function assessDeath(kind, env, payload, recorded = {}) {
    const { death, query, ix } = env;
    try {
        if (kind === 'lethal') {
            const member = query('party.actor', { id: payload.actor });
            if (!member || !['pc', 'companion'].includes(member.kind)) return fail('NOT_FOUND', 'That is not a durable party member.');
            if (lifeOf(member) === 'dead') return fail('REFUSED', 'That character is already dead.');
            const evidence = lethalProofs(query, payload);
            return { ok: true, member, evidence, inputs: { actor: member.id, npcId: member.npcId ?? null, life: lifeOf(member), evidence } };
        }
        if (kind === 'intervention') {
            const event = death.events[payload.event];
            if (!event || death.batches[event.batch]?.status !== 'pending' || event.cause === 'wipe' || event.intervention) return fail('REFUSED', 'That event is not awaiting an intervention.');
            const rescue = rescueProof(env, event, payload.evidence);
            return { ok: true, rescue, inputs: { event, rescue } };
        }
        if (kind === 'death.resolve') {
            const event = death.events[payload.event];
            const batch = death.batches[event?.batch];
            if (!batch || batch.status !== 'pending') return fail('REFUSED', 'That death batch is not pending.');
            const events = batch.events.map(id => death.events[id]).sort((a, b) => a.actor.localeCompare(b.actor));
            const actors = [];
            for (const e of events) {
                const member = query('party.actor', { id: e.actor });
                if (!member || lifeOf(member) === 'dead') return fail('REFUSED', 'The lethal actor is no longer alive on this timeline.');
                if (e.cause !== 'wipe' && hashJson(lethalProofs(query, { ...e, evidence: e.evidence.map(p => p.id) })) !== hashJson(e.evidence)) return fail('REFUSED', 'The lethal evidence changed.');
                if (e.intervention && hashJson(rescueProof(env, e, e.intervention.proof)) !== hashJson(e.intervention)) return fail('REFUSED', 'The rescue evidence changed.');
                actors.push({ actor: e.actor, npcId: member.npcId ?? null, kind: member.kind, life: lifeOf(member), mod: statModifier({ stats: member.stats }, 'VIT') });
            }
            return { ok: true, events, actors, inputs: { batch, events, actors, minute: env.minute ?? null, snapshot: recorded.snapshot ?? null, checks: recorded.checks ?? null } };
        }
        return fail('INVALID', 'Unknown death guard.');
    } catch (error) { return fail('REFUSED', error.message); }
}

/** list is the host's eligible points in target order; availability never changes target preference. */
export function selectSnapshot(points, minute) {
    if (!Array.isArray(points) || !Number.isSafeInteger(minute)) return null;
    const day = Math.floor(minute / 1440) - 1;
    const auto = points.findLast(p => p.kind === 'day-start' && p.day === day) ?? points.find(p => p.kind === 'initial');
    const at = auto ? points.indexOf(auto) : -1;
    const manual = points.findLast((p, i) => p.kind === 'manual' && i >= at);
    const picked = manual ?? auto;
    return picked ? { id: picked.id, payloadHash: picked.payloadHash } : null;
}

export function resultBytes(env, batch, plan, recorded) {
    const events = plan.events.map(event => {
        const actor = plan.actors.find(a => a.actor === event.actor);
        const check = recorded.checks[event.id] ?? null;
        const outcome = event.cause === 'wipe' ? 'dead' : event.intervention || check.total >= check.dc ? 'gravely-injured' : 'dead';
        return { ...structuredClone(event), check, outcome, _pc: actor.kind === 'pc' };
    });
    const returnRequested = events.some(e => e._pc && e.outcome === 'dead');
    return { v: 1, kind: 'death', batch: batch.id, source: batch.source, epoch: env.epoch, ruleset: env.ix.rulesHash, minute: recorded.minute,
        events: events.map(({ _pc, ...row }) => row), snapshot: returnRequested ? recorded.snapshot : null, returnRequested };
}
