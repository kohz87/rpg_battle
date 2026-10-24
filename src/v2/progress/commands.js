// RPG Battle v2, the commands of progression (contract §3 Commands and the result table):
//
//   class.choose { actor, milestone: 10|20|30, class, expectedClass, rulesHash }
//   path.choose  { actor, milestone: 40…90, skill, fromForm, option, rulesHash }
//   rules.settle { boundary? }
//
// class.choose and path.choose are the **player's** and nobody else's: the reader's own action (cause `ui`),
// never another module's call, never a story line, never a hook. Capture may propose evidence but never a class
// or path choice (contract §3). They check everything with assess.js (the code the replay guard runs again), claim
// the milestone once (`rb:<epoch>:class|path:<actor>:<milestone>`) and attach a guard, so a choice whose
// prerequisite is later taken away (a deleted reply, a Re-read) goes away with its claim. Nothing is ever chosen
// for the player and nothing picks a replacement.
//
// rules.settle is the host's (cause `system`): it gives every paid attempt with no credit its credit (credit.js),
// claims each once (`rb:<epoch>:credit:<attempt id>`), attaches the guard of the whole settlement and asks to be
// planned again (`replan: true`) when a swipe, delete or Re-read changes what it was planned on. The training
// start, completion and expiry steps of the contract's result (`started`, `completed`, `expired`) are later work:
// they are always empty here. Failures: INVALID, NOT_FOUND, REFUSED, STALE, RULES_MISMATCH, CLAIMED.

import { assess } from './assess.js';
import { attachGuard } from './guard.js';
import { choiceKey } from './derive.js';
import { applyFold } from './fold.js';
import { indexOf } from '../rules/graph.js';
import { pinOf } from '../rules/pin.js';
import { fightOn } from '../party/commands.js';
import { rollEvent } from '../training/step.js';
import { epochOf, isActorId, isDefId, isHash, isObject, isRecordId } from '../rules/ids.js';

const CLASS_FIELDS = ['actor', 'milestone', 'class', 'expectedClass', 'rulesHash'];
const PATH_FIELDS = ['actor', 'milestone', 'skill', 'fromForm', 'option', 'rulesHash'];

function closed(ctx, payload, fields, name) {
    if (!isObject(payload)) ctx.fail('INVALID', `${name} needs { ${fields.join(', ')} }.`);
    const extra = Object.keys(payload).find(key => !fields.includes(key));
    if (extra) ctx.fail('INVALID', `${name} does not take "${extra}".`);
    for (const key of fields) if (!Object.hasOwn(payload, key)) ctx.fail('INVALID', `${name} needs ${key}.`);
}

const player = (ctx, name) => {
    if (ctx.cause !== 'ui' || ctx.caller) ctx.fail('REFUSED', `${name} is the player's own choice: nobody else makes it.`);
};

/** The pinned index as a command sees it (the rules slice on the transaction's state), or a refusal. */
function pinned(ctx, payload) {
    const ix = indexOf(pinOf({ domains: { rules: ctx.read('rules') } }));
    if (!ix) ctx.fail('REFUSED', 'This chat does not run a rules pack, so there is nothing to choose from.');
    if (payload && payload.rulesHash !== ix.rulesHash) ctx.fail('RULES_MISMATCH', 'The rules changed since this was offered; read the choices again.');
    return ix;
}

const queryOf = ctx => (name, args) => ctx.query(name, args);

// "No choices during active or unsettled combat" (B3): the combat part's last fight, if it is under way or not settled yet
// (party/commands.js fightOn), or any session the combat query still holds
// it still holds (a won fight whose end has not been settled included) refuses; only a query that is absent, or throws, is no fight.
function noFight(ctx) {
    if (fightOn(ctx)) ctx.fail('REFUSED', 'Finish the fight, and settle it, before choosing.');
    let session = null;
    try {
        session = ctx.query('combat.session', {});
    } catch {
        return;
    }
    if (isObject(session)) ctx.fail('REFUSED', 'Finish the fight, and let it settle, before choosing.');
}

function claimOnce(ctx, key, message) {
    if (!ctx.claim(key)) ctx.fail('CLAIMED', message);
}

function guard(ctx, ix, kind, payload, inputs, recorded) {
    attachGuard(ctx, ix, kind, payload, inputs, recorded);
}

function classChoose(ctx, payload) {
    closed(ctx, payload, CLASS_FIELDS, 'class.choose');
    player(ctx, 'class.choose');
    if (!isActorId(payload.actor) || !isDefId(payload.class) || !isDefId(payload.expectedClass) || !isHash(payload.rulesHash) || !Number.isInteger(payload.milestone)) {
        ctx.fail('INVALID', 'class.choose needs an actor, a milestone, a class, the class it is now and the rules hash.');
    }
    const ix = pinned(ctx, payload);
    noFight(ctx);
    const answer = assess('class.choose', { ix, progress: ctx.read('progress'), query: queryOf(ctx) }, payload);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    const { actor, milestone } = payload;
    claimOnce(ctx, `rb:${epochOf(ctx)}:class:${actor}:${milestone}`, 'That promotion was already taken.');
    ctx.draft('progress').choices[choiceKey(actor, milestone)] = {
        actor, milestone, kind: 'class', previous: payload.expectedClass, selected: payload.class, skills: [...answer.skills], rulesHash: ix.rulesHash,
    };
    guard(ctx, ix, 'class.choose', payload, answer.inputs, { facts: answer.inputs.facts });
    return {
        summary: `${answer.member.name ?? 'The character'} becomes a ${ix.class(payload.class)?.name ?? payload.class}.`,
        narrate: true,
        data: { v2: { key: `class:${actor}:${milestone}`, result: { actor, milestone, previous: payload.expectedClass, selected: payload.class, skills: [...answer.skills] } } },
    };
}

function pathChoose(ctx, payload) {
    closed(ctx, payload, PATH_FIELDS, 'path.choose');
    player(ctx, 'path.choose');
    if (!isActorId(payload.actor) || !isDefId(payload.skill) || !isDefId(payload.fromForm) || !isDefId(payload.option) || !isHash(payload.rulesHash) || !Number.isInteger(payload.milestone)) {
        ctx.fail('INVALID', 'path.choose needs an actor, a milestone, a skill, the form it is now, the option and the rules hash.');
    }
    const ix = pinned(ctx, payload);
    noFight(ctx);
    const answer = assess('path.choose', { ix, progress: ctx.read('progress'), query: queryOf(ctx) }, payload);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    const { actor, milestone } = payload;
    claimOnce(ctx, `rb:${epochOf(ctx)}:path:${actor}:${milestone}`, 'That step was already taken.');
    ctx.draft('progress').choices[choiceKey(actor, milestone)] = {
        actor, milestone, kind: 'path', skill: payload.skill, fromForm: payload.fromForm, option: payload.option, step: answer.step, rulesHash: ix.rulesHash,
    };
    guard(ctx, ix, 'path.choose', payload, answer.inputs, { facts: answer.inputs.facts });
    return {
        summary: `${answer.member.name ?? 'The character'}'s ${ix.form(payload.fromForm)?.name ?? payload.skill} becomes ${ix.form(payload.option)?.name ?? payload.option}.`,
        narrate: true,
        data: { v2: { key: `path:${actor}:${milestone}`, result: { actor, milestone, previous: payload.fromForm, selected: payload.option } } },
    };
}

/**
 * rules.settle { boundary?, session? }: the boundary is the reply the settlement stands on; when given it must name this
 * very reply (sid and swipeKey), and when left out it is this reply. The host's hook cannot know its reply's Source before
 * it runs, so it leaves the boundary out. Without `session` it credits what waits (credit.js); with one it starts and finishes
 * that training session (training/step.js) and credits as well. `started`, `completed`, `expired` and `credited` as in §3.
 */
function settle(ctx, payload = {}) {
    if (ctx.cause !== 'system' || ctx.caller) ctx.fail('REFUSED', 'rules.settle is the host\'s own step: nobody else calls it.');
    if (!isObject(payload) || Object.keys(payload).some(key => key !== 'boundary' && key !== 'session')) ctx.fail('INVALID', 'rules.settle takes { boundary?, session? } and nothing else.');
    const boundary = payload.boundary ?? null;
    if (boundary !== null) {
        if (!isObject(boundary) || !ctx.source || boundary.sid !== ctx.source.sid || boundary.swipeKey !== ctx.source.swipeKey) ctx.fail('REFUSED', 'The boundary is not the reply this step stands on.');
    }
    if (payload.session !== undefined && !(isRecordId(payload.session) && payload.session.startsWith('tr_'))) ctx.fail('INVALID', 'A training session is a tr_ id.');
    const ix = pinned(ctx, null);
    const env = { ix, progress: ctx.read('progress'), training: ctx.read('training'), query: queryOf(ctx) };
    const source = ctx.source ?? ctx.fail('FAILED', 'There is no reply yet to hold the settlement.');
    const session = payload.session;
    const event = session ? rollEvent(ctx, ix, env.training?.sessions?.[session] ?? {}) : null;
    const answer = assess('rules.settle', env, session ? { session } : {}, { event, source, hash: value => ctx.hash(value) });
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    const progress = ctx.draft('progress');
    const started = [];
    const completed = [];
    if (session) {
        claimOnce(ctx, `rb:${epochOf(ctx)}:train:${session}`, 'That training was already settled.');
        const trainer = ix.trainer(env.training.sessions[session].trainer);
        if (answer.outcome === 'ran') {
            ctx.call('wallet.pay', { owner: 'party', amount: answer.fee, note: `${trainer.name} trains` });
            const advanced = ctx.call('director.advance', { minutes: ix.constants.trainMinutes, cause: `train-${session}`, reason: `${trainer.name} trains` });
            if (advanced?.data?.advanced !== ix.constants.trainMinutes) ctx.fail('REFUSED', 'The clock did not move by the session\'s whole time, so the session did not start.');
            started.push(session);
            if (answer.patch.status === 'completed') completed.push(session);
            for (const item of answer.attempts) progress.attempts[item.id] = item.record;
        }
        Object.assign(ctx.draft('training').sessions[session], answer.patch);
    }
    const credits = progress.credits;
    const credited = [];
    for (const { id, award, reason, minute, day, reply } of answer.plan) {
        claimOnce(ctx, `rb:${epochOf(ctx)}:credit:${id}`, 'That use was already credited.');
        credits[id] = { award, reason, minute, day, reply };
        if (award > 0) credited.push(id);
    }
    if (answer.fold) applyFold(progress, answer.fold);
    guard(ctx, ix, 'rules.settle', session ? { session } : {}, answer.inputs, session ? { event } : { plan: answer.plan });
    return {
        summary: session ? (started.length ? `The training ${completed.length ? 'is done' : 'was interrupted'}.` : 'The training could not start.') : (credited.length ? `${credited.length} use${credited.length === 1 ? '' : 's'} credited.` : 'No use earned a credit.'),
        narrate: false,
        replan: true,
        data: { v2: { key: `settle:${ctx.source.sid}${session ? `:${session}` : ''}`, result: { started, completed, expired: [], credited } } },
    };
}

export const commands = { 'class.choose': classChoose, 'path.choose': pathChoose, 'rules.settle': settle };
