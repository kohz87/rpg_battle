// RPG Battle v2, a rescue (B3: "Rescue proof must bind lethal event/batch, rescued actor, living rescuer, stable skill/form/effect, active
// source, cost/payment reference and one-time consumption"; "Parent proof deletion must retract ... rescue use and its claims").
//
//   rescue.use { event, batch: { id, hash }, actor, rescuer, skill, form, effect, paid? }
//
// An event of the story's own rules (Story Director's adapter or this module), never a button or the story's words, answers one lethal event of
// a sealed death result with one use of a skill. The cost is paid in this very root (a `use` proof) or cited from one surviving paid use (`paid`),
// never both. The `rescue` proof binds the event, the sealed result by id and hash, the rescued actor, the living rescuer, the skill, the form and
// its frozen effect, and has the use as its only parent: take the use back and the proof is hidden, the guard (kind rescue.use) turns the block
// off, and its claims go with it. One claim per lethal event and character consumes the rescue once. B6's death records are not here: the result
// is read as `{ kind: 'death', events: [{ id, actor }] }` in `progress.batches` (docs/dev/progress.md, gaps). Pure apart from `ctx`.

import { assess } from './assess.js';
import { attachGuard } from './guard.js';
import { applyUse } from './use.js';
import { isBatchId } from '../fight/batch.js';
import { indexOfCtx } from '../rules/graph.js';
import { epochOf, int, isActorId, isDefId, isHash, isObject, isRecordId } from '../rules/ids.js';

const FIELDS = ['event', 'batch', 'actor', 'rescuer', 'skill', 'form', 'effect', 'paid'];
/** Who may ask: the story's own rules (Story Director's event adapter) and this module's. */
export const RESCUE_CALLERS = Object.freeze(['story-director', 'rpg-battle']);

/** The problem of a rescue request's shape, or ''. */
export function requestProblem(payload) {
    if (!isObject(payload) || Object.keys(payload).some(key => !FIELDS.includes(key)) || FIELDS.filter(key => key !== 'paid').some(key => !Object.hasOwn(payload, key))) {
        return `rescue.use takes { ${FIELDS.join(', ')} } (paid optional) and nothing else.`;
    }
    if (!isRecordId(payload.event) || !isObject(payload.batch) || Object.keys(payload.batch).sort().join() !== 'hash,id' || !isBatchId(payload.batch.id) || !isHash(payload.batch.hash)) return 'A rescue names the lethal event and the sealed result {id, hash} it is in.';
    if (!isActorId(payload.actor) || !isActorId(payload.rescuer) || !isDefId(payload.skill) || !isDefId(payload.form) || !int(payload.effect, 0, 3)) return 'A rescue names the character in danger, the rescuer, the skill, its form and the effect.';
    if (payload.paid !== undefined && payload.paid !== null && !isRecordId(payload.paid)) return 'The paid use is a proof id.';
    return '';
}

export function rescueUse(ctx, payload) {
    const problem = requestProblem(payload);
    if (problem) ctx.fail('INVALID', problem);
    if (!RESCUE_CALLERS.includes(ctx.caller)) ctx.fail('REFUSED', 'A rescue is an event of the story\'s own rules, never a button or the story\'s words.');
    const ix = indexOfCtx(ctx);
    if (!ix) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    const fixed = { event: payload.event, batch: { id: payload.batch.id, hash: payload.batch.hash }, actor: payload.actor, rescuer: payload.rescuer,
        skill: payload.skill, form: payload.form, effect: payload.effect, paid: payload.paid ?? null };
    const answer = assess('rescue.use', { ix, progress: ctx.read('progress'), query: (name, args) => ctx.query(name, args) }, fixed);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    if (!ctx.claim(`rb:${epochOf(ctx)}:rescue:${fixed.event}:${fixed.actor}`)) ctx.fail('CLAIMED', 'That lethal event was already answered by a rescue.');
    // The cost: now, or one surviving paid use (applyUse refuses a proof already cited). It attaches no guard: the rescue's covers it.
    const spent = applyUse(ctx, { actor: fixed.rescuer, skill: fixed.skill, form: fixed.form, paid: fixed.paid });
    const made = ctx.proof({ kind: 'rescue', parents: [spent.key], payload: { event: fixed.event, batch: fixed.batch, actor: fixed.actor, rescuer: fixed.rescuer,
        skill: fixed.skill, form: fixed.form, effect: fixed.effect, use: spent.key } });
    attachGuard(ctx, ix, 'rescue.use', fixed, answer.inputs, { proof: made.id });
    return { summary: `${answer.member.name} answers the lethal blow with ${ix.form(fixed.form)?.name ?? fixed.skill}.`, narrate: false,
        data: { v2: { key: `rescue:${made.id}`, result: { event: fixed.event, actor: fixed.actor, rescuer: fixed.rescuer, proof: made.id, use: spent.key } } } };
}

export const commands = { 'rescue.use': rescueUse };
