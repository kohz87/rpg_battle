// The real SD roller with RB's real modifier projection. No RB check handler or table is involved.
import { makeCtx, Rejection } from './fake-ctx.js';
import { rulesModifier } from '../../../../src/v2/rules/queries.js';
import { commands } from '../../../vendor/story-director/src/v2/checks/commands.js';
import { dcOf } from '../../../vendor/story-director/src/v2/checks/words.js';
import { hashJson } from '../../../vendor/story-director/src/v2/hash.js';

export function rollCheck(state, payload, options = {}) {
    const working = structuredClone(state);
    const ctx = makeCtx(working, { ...options, own: ['party', 'effects', 'checks'] });
    const actor = payload.who ? Object.values(working.domains.party.actors).find(member => member.name === payload.who) : working.domains.party.actors[payload.actor ?? working.domains.party.pc];
    if (!actor) return { ok: false, code: 'NOT_FOUND', state };
    working.domains.checks = { policy: { actors: { ca_00000001: { id: 'ca_00000001', name: actor.name, bonuses: {} } }, defaultActor: 'ca_00000001', rbActors: { ca_00000001: actor.id } }, writes: {}, log: {} };
    const call = ctx.call;
    ctx.call = (name, args) => name === 'rules.practiceCheck' ? {} : call(name, args);
    const query = ctx.query;
    ctx.query = (name, args) => name === 'rules.modifier' ? rulesModifier(working, args, { query: (n, a) => query(n, a) }) : query(name, args);
    ctx.source = { evidence: 'ev_00000001' };
    ctx.hash = hashJson;
    ctx.id = () => 'ck_00000001';
    try {
        const dc = dcOf(payload.dc);
        if (dc === null) throw new Rejection('INVALID', 'Invalid difficulty.');
        const out = commands['checks.roll'](ctx, { skill: payload.skill ?? payload.stat ?? '', ...(payload.stat ? { stat: payload.stat } : {}), dc, evidence: ctx.source.evidence });
        const record = working.domains.checks.log[out.data.v2.result.check];
        return { ok: true, result: { ...out, data: { ...out.data.v2.result, stat: record.stat, actor: actor.id } }, state: working };
    } catch (error) { return { ok: false, code: error.code, message: error.message, state }; }
}
