// RPG Battle v2, a skill used in the story (contract §3 capture `! skill-use <actor ID> | skill: <def ID> | form: <def ID>`;
// B3 "Under P25, recommend narrative skill-use pays its normal pool/item cost in the same root transaction, or
// references one surviving already-paid action; never both, never free mention"; B5 "Narrative uses").
//
// A use of a skill that the story mentions earns the character a *paid attempt*, and only when it was paid for:
//   * `skill.use { actor, skill, form }`  pays the form's cost from the character's pool (SP for a physical form, else MP)
//     in this very transaction, gives a `use` proof (RPG Battle's kind; story.evidence shows it while it stands) and
//     records the attempt (kind narrative, capSource this reply, cost = the proof);
//   * `skill.use { actor, skill, form, paid }` names one surviving `use` proof of the same character, skill and form
//     (a use already paid elsewhere, once): nothing is paid again, no proof is given, the attempt cites that proof.
// A line the story writes can only propose the first (its words never name a proof). Insufficient pool, a skill the
// character does not hold in that form, a downed character or a proof already cited refuses the whole line.
// Credits are decided later, by rules.settle (credit.js): a mention earns at most what the caps allow.
// Internal: the story, the host or another command; the player's click is refused (a button is not a story use).

import { assess } from './assess.js';
import { attachGuard } from './guard.js';
import { recordAttempt } from './record.js';
import { fitPool, storedPool } from '../party/pools.js';
import { indexOfCtx } from '../rules/graph.js';
import { epochOf, isActorId, isDefId, isObject, isRecordId } from '../rules/ids.js';

const FIELDS = ['actor', 'skill', 'form', 'paid'];

export function useSkill(ctx, payload) {
    if (!isObject(payload) || Object.keys(payload).some(key => !FIELDS.includes(key))) ctx.fail('INVALID', 'skill.use takes { actor, skill, form, paid? }.');
    if (!isActorId(payload.actor) || !isDefId(payload.skill) || !isDefId(payload.form)) ctx.fail('INVALID', 'A skill use names a character, a skill and its form.');
    const paid = payload.paid ?? null;
    if (paid !== null && !isRecordId(paid)) ctx.fail('INVALID', 'The paid use is a proof id.');
    if (ctx.cause === 'ui' && !ctx.caller) ctx.fail('REFUSED', 'A skill is used in the story, not from a button.');
    const ix = indexOfCtx(ctx);
    if (!ix) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    const fixed = { actor: payload.actor, skill: payload.skill, form: payload.form, paid };
    const answer = assess('skill.use', { ix, progress: ctx.read('progress'), query: (name, args) => ctx.query(name, args) }, fixed);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    let key;
    if (paid !== null) {
        key = paid;
        if (!ctx.claim(`rb:${epochOf(ctx)}:paid:${paid}`)) ctx.fail('CLAIMED', 'That paid use was already counted once.');
    } else {
        // Pay now: the pool, then the proof that it was paid. The use's own name comes from the receipt's seed, so it is the same on replay.
        const party = ctx.draft('party');
        const actor = party.actors[payload.actor];
        if (!actor) ctx.fail('NOT_FOUND', 'That character is not in the party.');
        // From the pool as it stands now (fitted: a delete may have moved what was lost), as party.fightPools writes it.
        if (answer.amount > 0) {
            const now = fitPool(actor[answer.pool]);
            actor[answer.pool] = storedPool({ cur: now.cur - answer.amount, max: now.max });
        }
        // The attempt is named by its own proof, so citing that proof later is the same attempt, never a second one.
        key = ctx.proof({ kind: 'use', payload: { actor: payload.actor, skill: payload.skill, form: payload.form, use: ctx.id('us') } }).id;
    }
    const made = recordAttempt(ctx, { actor: payload.actor, skill: payload.skill, form: payload.form, kind: 'narrative', key, cost: paid !== null ? paid : key });
    // The same attempt again (a proof this very step gave, cited): counted once.
    if (!made.created && !made.dropped) ctx.fail('CLAIMED', 'That use was already counted.');
    if (!ctx.claim(`rb:${epochOf(ctx)}:use:${made.id}`)) ctx.fail('CLAIMED', 'That use was already counted.');
    attachGuard(ctx, ix, 'skill.use', fixed, answer.inputs, { key });
    const form = ix.form(payload.form);
    return {
        summary: `${answer.member.name} uses ${form?.name ?? payload.skill}${paid !== null ? '' : ` (${answer.amount} ${answer.pool.toUpperCase()})`}.`,
        narrate: false,
        data: { v2: { key: `use:${made.id}`, result: { actor: payload.actor, skill: payload.skill, form: payload.form, attempt: made.id, paid: paid !== null } } },
    };
}

/** `! skill-use <actor ID> | skill: <def ID> | form: <def ID>` (contract §3): the story proposes the use; only a paid one counts. */
export const kinds = {
    'skill-use': {
        grammar: '! skill-use <actor ID> | skill: <def ID> | form: <def ID>',
        apply(ctx, line) {
            const labels = line?.labels ?? {};
            return useSkill(ctx, { actor: line?.name, skill: labels.skill, form: labels.form });
        },
    },
};
export const commands = { 'skill.use': useSkill };
