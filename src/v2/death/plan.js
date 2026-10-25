import { hashJson } from '../rules/hash.js';
import { idFromHash } from '../rules/ids.js';
import { lifeOf } from '../rules/sheet.js';
import { lethalProofs, rescueProof } from './proofs.js';
import { statModifier } from '../checks/modifiers.js';

export const sourceOf = s => ({ sid: s.sid, swipeKey: s.swipeKey, evidence: s.evidence, ordinal: s.ordinal });
export const batchId = (source, epoch, fight = null) => idFromHash('db', hashJson({ sid: source.sid, swipeKey: source.swipeKey, epoch, ...(fight ? { fight } : {}) }));
export const eventId = (batch, actor) => idFromHash('de', hashJson({ batch, actor }));
export const fail = (code, why) => ({ ok: false, code, why });
/** The story minute as a result may keep it: a safe integer, else null (never a wall clock). */
export const clockMinute = value => (Number.isSafeInteger(value) ? value : null);

/**
 * What a pinned fight's settlement writes for the party's deaths and injuries, from the party slice before it and the fight's own
 * summary: null when it writes none; else { wipe, downed } (the ids of the durable members it downs, sorted). A wipe is every durable
 * fighter down, which kills the character; otherwise a downed companion who is not dead is gravely injured. Pure.
 */
export function fightDeaths(party, result) {
    const actors = party?.actors ?? {};
    const durable = (result?.party ?? []).filter(m => actors[m.memberId] && ['pc', 'companion'].includes(actors[m.memberId].kind));
    if (!durable.length || !durable.some(m => m.memberId === party.pc)) return null;
    const dead = m => (actors[m.memberId].conditions ?? []).some(c => c.kind === 'dead');
    const down = m => m.down || m.hp.cur <= 0 || dead(m);
    if (durable.every(down)) return { wipe: true, downed: durable.map(m => m.memberId).sort() };
    const hurt = durable.filter(m => m.memberId !== party.pc && down(m) && !dead(m)).map(m => m.memberId).sort();
    return hurt.length ? { wipe: false, downed: hurt } : null;
}

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
                if ((member.npcId ?? null) !== e.npcId) return fail('REFUSED', 'The lethal actor is linked to another native identity.');
                if (e.cause !== 'wipe' && hashJson(lethalProofs(query, { ...e, evidence: e.evidence.map(p => p.id) })) !== hashJson(e.evidence)) return fail('REFUSED', 'The lethal evidence changed.');
                if (e.intervention && hashJson(rescueProof(env, e, e.intervention.proof)) !== hashJson(e.intervention)) return fail('REFUSED', 'The rescue evidence changed.');
                actors.push({ actor: e.actor, npcId: member.npcId ?? null, kind: member.kind, life: lifeOf(member), mod: statModifier({ stats: member.stats }, 'VIT') });
            }
            return { ok: true, events, actors, inputs: { batch, events, actors, minute: env.minute ?? null, snapshot: recorded.snapshot ?? null, checks: recorded.checks ?? null } };
        }
        return fail('INVALID', 'Unknown death guard.');
    } catch (error) { return fail('REFUSED', error.message); }
}

/**
 * list is the host's eligible points in target order; availability never changes target preference. Contract §8: the start of the previous
 * narrative day, unless a manual save is more recent, else the initial save. With the story clock unset there is no previous day: the
 * latest manual save wins, else the initial one. A save is never ignored for want of a clock.
 */
export function selectSnapshot(points, minute) {
    if (!Array.isArray(points)) return null;
    const point = p => (p ? { id: p.id, payloadHash: p.payloadHash } : null);
    if (!Number.isSafeInteger(minute)) return point(points.findLast(p => p.kind === 'manual') ?? points.find(p => p.kind === 'initial'));
    const day = Math.floor(minute / 1440) - 1;
    const auto = points.findLast(p => p.kind === 'day-start' && p.day === day) ?? points.find(p => p.kind === 'initial');
    const at = auto ? points.indexOf(auto) : -1;
    const manual = points.findLast((p, i) => p.kind === 'manual' && i >= at);
    return point(manual ?? auto);
}

export function resultBytes(env, batch, plan, recorded) {
    const events = plan.events.map(event => {
        const actor = plan.actors.find(a => a.actor === event.actor);
        const check = recorded.checks[event.id] ?? null;
        const outcome = event.cause === 'wipe' ? 'dead' : event.intervention || check.total >= check.dc ? 'gravely-injured' : 'dead';
        return { ...structuredClone(event), kind: actor.kind, check, outcome };
    });
    const returnRequested = events.some(e => e.kind === 'pc' && e.outcome === 'dead');
    return { v: 1, kind: 'death', batch: batch.id, source: batch.source, epoch: env.epoch, ruleset: env.ix.rulesHash, minute: recorded.minute,
        events, snapshot: returnRequested ? recorded.snapshot : null, returnRequested };
}
