// A skill check is one practice attempt, regardless of its outcome. SD calls this in the roll's
// transaction, so taking the check back takes its attempt back too. The existing settlement owns caps.
import { recordAttempt } from './record.js';
import { standing } from './offers.js';
import { attachIfFree } from './guard.js';
import { indexOfCtx } from '../rules/graph.js';

export function assessCheck({ ix, progress, query }, payload) {
    const member = query('party.actor', { id: payload.actor });
    const held = standing(ix, progress, payload.actor).skills.find(item => item.skill === payload.skill && item.form === payload.form);
    return member && held ? { ok: true, inputs: { actor: member.id, skill: held.skill, form: held.form } }
        : { ok: false, code: 'REFUSED', why: 'That character no longer holds the checked skill.' };
}

export function practiceCheck(ctx, payload = {}) {
    if (ctx.caller !== 'story-director') ctx.fail('REFUSED', 'Only Story Director records a check attempt.');
    const ix = indexOfCtx(ctx);
    if (!ix) return { summary: '', narrate: false };
    const word = String(payload.skill ?? '').normalize('NFKC').trim().toLowerCase();
    const held = standing(ix, ctx.read('progress'), payload.actor).skills.find(item => [item.skill, item.form, item.name, ix.skill(item.skill)?.name].some(name => String(name ?? '').normalize('NFKC').toLowerCase() === word));
    if (!held) return { summary: '', narrate: false };
    if (!/^ck_[0-9a-z]{8}$/.test(payload.check ?? '')) ctx.fail('INVALID', 'A practice check needs the check id.');
    const fixed = { actor: payload.actor, skill: held.skill, form: held.form };
    const answer = assessCheck({ ix, progress: ctx.read('progress'), query: (name, args) => ctx.query(name, args) }, fixed);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    const made = recordAttempt(ctx, { ...fixed, kind: 'narrative', key: `check:${payload.check}` });
    attachIfFree(ctx, ix, 'check.practice', fixed, answer.inputs);
    return { summary: '', narrate: false, data: { attempt: made.id } };
}
