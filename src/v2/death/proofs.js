import { canRescue } from '../progress/rescue-effect.js';
// Owner-validated lethal proof: story {actor,cause,lethal:true}; generic narration is never a lethal proof.
// Rescue proof: rescue {event,batch,actor,rescuer,skill,form,effect,payment}, parented by a surviving paid use.
// Its form's selected effect must heal; the user cannot supply an outcome, a die or a save.
import { closed } from './records.js';
import { lifeOf } from '../rules/sheet.js';
import { standing } from '../progress/offers.js';
import { isActorId, isRecordId } from '../rules/ids.js';

export function proofsOf(query, ids) {
    const rows = query('story.evidence', { ids });
    if (!Array.isArray(rows) || ids.some(id => !rows.some(p => p.id === id))) throw new Error('The evidence is not active.');
    return ids.map(id => rows.find(p => p.id === id));
}
export const refsOf = proofs => proofs.map(({ id, payloadHash }) => ({ id, payloadHash })).sort((a, b) => a.id.localeCompare(b.id));

export function lethalProofs(query, payload) {
    if (!Array.isArray(payload.evidence) || !payload.evidence.length || payload.evidence.length > 32 || !payload.evidence.every(isRecordId) || new Set(payload.evidence).size !== payload.evidence.length) throw new Error('Name distinct active lethal evidence.');
    const proofs = proofsOf(query, payload.evidence);
    if (!proofs.every(p => p.owner === 'rpg-battle' && p.kind === 'story' && closed(p.payload, ['actor', 'cause', 'lethal']) && p.payload.actor === payload.actor && p.payload.cause === payload.cause && p.payload.lethal === true)) throw new Error('The proof does not validate this lethal event.');
    return refsOf(proofs);
}

export function rescueProof(env, event, id) {
    const proof = proofsOf(env.query, [id])[0];
    const p = proof.payload;
    if (proof.owner !== 'rpg-battle' || proof.kind !== 'rescue' || !closed(p, ['event', 'batch', 'actor', 'rescuer', 'skill', 'form', 'effect', 'payment']) || p.event !== event.id || p.batch !== event.batch || p.actor !== event.actor || !isActorId(p.rescuer) || p.rescuer === event.actor || !isRecordId(p.payment)) throw new Error('The rescue belongs to another event or actor.');
    const rescuer = env.query('party.actor', { id: p.rescuer });
    if (!rescuer || lifeOf(rescuer) !== 'alive') throw new Error('The rescuer is not alive.');
    const skill = standing(env.ix, env.progress, p.rescuer).skills.find(s => s.skill === p.skill && s.form === p.form);
    if (!skill || !Number.isInteger(p.effect) || !canRescue(env.ix.form(p.form)?.effects[p.effect], p.rescuer, event.actor)) throw new Error('The rescuer does not hold that healing effect.');
    const paid = proofsOf(env.query, [p.payment])[0];
    if (paid.owner !== 'rpg-battle' || paid.kind !== 'use' || paid.payload?.actor !== p.rescuer || paid.payload?.skill !== p.skill || paid.payload?.form !== p.form || !proof.parents.includes(p.payment)) throw new Error('The rescue has no surviving paid parent action.');
    return { proof: proof.id, payloadHash: proof.payloadHash, payment: p.payment, paymentHash: paid.payloadHash };
}
