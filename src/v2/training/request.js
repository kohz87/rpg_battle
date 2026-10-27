// RPG Battle v2, the player's request to train (contract §3 `skill.train { actor, skill, form, trainer, session }`: "Player
// request; { session, status: 'requested' }", REFUSED running/pending session, unknown trainer NOT_FOUND, "No fee/time at UI").
// The request only records that the player asked, under the session id the offer carried (session.js: the next one for this
// character, trainer, skill and form, or the request is STALE). The host's step (progress/session-step.js, through rules.settle) validates the
// place and the funds, then pays and moves the clock. A deleted request takes its session and claim with it, and the
// settlement built on it.

import { assess } from '../progress/assess.js';
import { attachGuard } from '../progress/guard.js';
import { indexOfCtx } from '../rules/graph.js';
import { epochOf, isActorId, isDefId, isObject, isRecordId, isTrainerRef } from '../rules/ids.js';

const FIELDS = ['actor', 'skill', 'form', 'trainer', 'session'];

function skillTrain(ctx, payload) {
    if (!isObject(payload)) ctx.fail('INVALID', `skill.train needs { ${FIELDS.join(', ')} }.`);
    const extra = Object.keys(payload).find(key => !FIELDS.includes(key));
    if (extra) ctx.fail('INVALID', `skill.train does not take "${extra}".`);
    if (!isActorId(payload.actor) || !isDefId(payload.skill) || !isDefId(payload.form) || !isTrainerRef(payload.trainer) || !isRecordId(payload.session) || !payload.session.startsWith('tr_')) {
        ctx.fail('INVALID', 'skill.train needs a character, a skill, its form, a trainer and the session the offer named.');
    }
    if (ctx.cause !== 'ui' || ctx.caller) ctx.fail('REFUSED', 'Asking to train is the player\'s own request.');
    const ix = indexOfCtx(ctx);
    if (!ix) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    const env = { ix, progress: ctx.read('progress'), training: ctx.read('training'), query: (name, args) => ctx.query(name, args) };
    const answer = assess('skill.train', env, payload);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    if (!ctx.claim(`rb:${epochOf(ctx)}:train-request:${payload.session}`)) ctx.fail('CLAIMED', 'That training was already asked for.');
    ctx.draft('training').sessions[payload.session] = {
        id: payload.session, actor: payload.actor, skill: payload.skill, form: payload.form, trainer: payload.trainer, status: 'requested',
        fee: null, startMinute: null, endMinute: null, event: null, reason: null,
    };
    attachGuard(ctx, ix, 'skill.train', payload, answer.inputs);
    return { summary: `${answer.member.name} asks ${answer.trainer.name} to train them.`, narrate: false, data: { v2: { key: `train:${payload.session}`, result: { session: payload.session, status: 'requested' } } } };
}

/**
 * skill.cancelTrain { actor, session }: the player withdraws a request that waits for the host. The session is kept, refused, so
 * the next ask of that character is the next session id and nothing is deleted. Moves no fee and no time. (Not in the contract's
 * command list: the gap is written down in docs/dev/progress.md.)
 */
function skillCancelTrain(ctx, payload) {
    if (!isObject(payload) || Object.keys(payload).some(key => key !== 'actor' && key !== 'session') || !isActorId(payload.actor) || !isRecordId(payload.session) || !payload.session.startsWith('tr_')) {
        ctx.fail('INVALID', 'skill.cancelTrain needs { actor, session }.');
    }
    if (ctx.cause !== 'ui' || ctx.caller) ctx.fail('REFUSED', 'Withdrawing a training is the player\'s own request.');
    const ix = indexOfCtx(ctx);
    if (!ix) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    const answer = assess('skill.cancelTrain', { ix, progress: ctx.read('progress'), training: ctx.read('training'), query: (name, args) => ctx.query(name, args) }, payload);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    if (!ctx.claim(`rb:${epochOf(ctx)}:train-cancel:${payload.session}`)) ctx.fail('CLAIMED', 'That training was already withdrawn.');
    Object.assign(ctx.draft('training').sessions[payload.session], { status: 'refused', reason: 'The player withdrew the request.' });
    attachGuard(ctx, ix, 'skill.cancelTrain', payload, answer.inputs);
    return { summary: 'The training request was withdrawn.', narrate: false, data: { v2: { key: `train-cancel:${payload.session}`, result: { session: payload.session, status: 'refused' } } } };
}

export const commands = { 'skill.train': skillTrain, 'skill.cancelTrain': skillCancelTrain };
