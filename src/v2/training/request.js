// RPG Battle v2, the player's request to train (contract §3 `skill.train { actor, skill, form, trainer, session }`: "Player
// request; { session, status: 'requested' }", REFUSED running/pending session, unknown trainer NOT_FOUND, "No fee/time at UI").
// The request only records that the player asked, under the session id the offer carried (session.js: the next one for this
// character, trainer, skill and form, or the request is STALE). The host's step (step.js, through rules.settle) validates the
// place and the funds, then pays and moves the clock. A deleted request takes its session and claim with it, and the
// settlement built on it.

import { assess } from '../progress/assess.js';
import { buildGuard } from '../progress/guard.js';
import { indexOf } from '../rules/graph.js';
import { pinOf } from '../rules/pin.js';
import { epochOf, isActorId, isDefId, isObject, isRecordId } from '../rules/ids.js';

const FIELDS = ['actor', 'skill', 'form', 'trainer', 'session'];

function skillTrain(ctx, payload) {
    if (!isObject(payload)) ctx.fail('INVALID', `skill.train needs { ${FIELDS.join(', ')} }.`);
    const extra = Object.keys(payload).find(key => !FIELDS.includes(key));
    if (extra) ctx.fail('INVALID', `skill.train does not take "${extra}".`);
    if (!isActorId(payload.actor) || !isDefId(payload.skill) || !isDefId(payload.form) || !isDefId(payload.trainer) || !isRecordId(payload.session) || !payload.session.startsWith('tr_')) {
        ctx.fail('INVALID', 'skill.train needs a character, a skill, its form, a trainer and the session the offer named.');
    }
    if (ctx.cause !== 'ui' || ctx.caller) ctx.fail('REFUSED', 'Asking to train is the player\'s own request.');
    const ix = indexOf(pinOf({ domains: { rules: ctx.read('rules') } }));
    if (!ix) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    const env = { ix, progress: ctx.read('progress'), training: ctx.read('training'), query: (name, args) => ctx.query(name, args) };
    const answer = assess('skill.train', env, payload);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    if (!ctx.claim(`rb:${epochOf()}:train-request:${payload.session}`)) ctx.fail('CLAIMED', 'That training was already asked for.');
    ctx.draft('training').sessions[payload.session] = {
        id: payload.session, actor: payload.actor, skill: payload.skill, form: payload.form, trainer: payload.trainer, status: 'requested',
        fee: null, startMinute: null, endMinute: null, event: null, reason: null,
    };
    ctx.replayGuard(buildGuard({ hash: value => ctx.hash(value), owner: ctx.module, source: ctx.source ?? ctx.fail('FAILED', 'There is no reply yet to hold the request.'), rulesHash: ix.rulesHash, kind: 'skill.train', payload, inputs: answer.inputs }));
    return { summary: `${answer.member.name} asks ${answer.trainer.name} to train them.`, narrate: false, data: { v2: { key: `train:${payload.session}`, result: { session: payload.session, status: 'requested' } } } };
}

export const commands = { 'skill.train': skillTrain };
