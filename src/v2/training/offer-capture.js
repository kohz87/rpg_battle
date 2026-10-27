// RPG Battle v2, generative offers for teachers: the capture of a `+ trainer` line the narrator wrote in its own words (GENERATIVE_OFFERS_SPEC §5.6,
// §7.2). The matcher (offer.js) picks the template and reads a written fee; the unchanged `planTrainer` decides the rest (the place, the name, the die)
// and `trainer.offer`, the guard written here, holds a fee the story wrote to the template's range on replay. A reader's "Make this a trainer" is
// untouched (`trainer.open`).

import { buildGuard } from '../progress/guard.js';
import { indexOfCtx, indexOfState } from '../rules/graph.js';
import { epochOf } from '../rules/ids.js';
import { ask, call, freshThreadId, pinned, threadOf, writeId } from '../quests/seams.js';
import { FAR_TOLD, MATCHER, NOTE, farLineOf, farReasonOf, flat, keepNotes } from '../quests/offer-bands.js';
import { MAX_DECLINED, declinedOf } from '../rules/offers.js';
import { declinedId } from '../quests/offer-capture.js';
import { ladderFrom } from '../quests/ranks.js';
import { evidenceOf, npcReader } from './capture.js';
import { MAX_OFFERS, NAME_MAX } from './domain.js';
import { feeWords, liveTrainer, planTrainer } from './opening.js';
import { nameKey } from './trainers.js';
import { matchTrainer } from './offer.js';
import { lineKey, lineKeys } from '../quests/offer-line.js';

export const KIND = 'trainer.offer';
const list = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const quiet = message => ({ summary: message, narrate: false, data: { trainer: null, held: true } });
const refused = (code, message) => ({ summary: `Trainer refused: ${message}`, problem: `Trainer refused: ${message}`, narrate: false, data: { code, message, refused: true } });

/** The fee a written one makes of the plan (the die stays rolled and recorded): the offer's and the facts', and what the guard needs to hold it. */
function withFee(plan, fee) {
    plan.offer.fee = fee.value;
    plan.facts.fee = fee.value;
    plan.kept.feeBy = 'said';
    plan.kept.fee = fee.value;
}

/**
 * A story trainer line the generative path reads (the caller has checked the feature). → the line's result, or `undefined` for a line that is not for it.
 */
export function captureTrainerOffer(ctx, line) {
    if (line.op !== '+') return undefined;
    const ix = indexOfCtx(ctx);
    const pin = pinned(ctx.read('rules'));
    if (!ix || !pin) return undefined;
    const name = flat(line.name, NAME_MAX);
    const rules = ctx.read('rules');
    const labels = line.labels ?? {};
    const party = ask(ctx.query, 'rules.party');
    const level = party?.active?.find(actor => actor.id === party.pc)?.level;
    const ladder = ladderFrom(ask(ctx.query, 'packs.content', { kind: 'ranks', pack: rules.pin.identity.packKey })) ?? [];
    const env = { ix, ladder, level: Number.isSafeInteger(level) ? level : null, currency: ask(ctx.query, 'inventory.currency') };
    const key = nameKey(name);
    // A fixed trainer's name is theirs already; a far-out decision on record makes a bare line a quiet no-op.
    if (key && ix.trainers.some(entry => nameKey(entry.name) === key)) return quiet(`${name} is a trainer of this world.`);
    const bare = !['like', 'teaches', 'fee'].some(label => Object.hasOwn(labels, label)) && !String(line.text ?? '').trim();
    if (key && bare && Object.hasOwn(declinedOf(rules), declinedId(ctx, name))) return quiet(`${name} was not offered.`);
    const earlier = (() => {
        const offers = ctx.standing?.domains?.training?.offers;
        const want = lineKeys(ctx, line);
        return offers ? Object.values(offers).find(offer => offer.settled?.sid === ctx.source?.sid && want.includes(offer.settled?.line)) ?? null : null;
    })();
    let matched = null;
    if (earlier) {
        matched = { kind: 'offer', band: earlier.settled.band, binding: { template: earlier.template, name, text: earlier.text, skills: earlier.skills }, said: earlier.settled.said,
            fee: earlier.settled.feeBy === 'said' ? { value: earlier.fee, by: 'said' } : null, notes: earlier.settled.notes, matcher: earlier.settled.matcher };
    } else matched = matchTrainer(env, line);
    if (matched.kind === 'refuse') return refused(matched.code, matched.message);
    if (matched.kind === 'none') return keep(ctx, line, name, refused('RULES_MISMATCH', `No teacher template of this world teaches "${flat(line.text ?? '', 80) || name}"; Make this a trainer works on someone who is here.`));
    if (matched.kind === 'far') return farOut(ctx, matched, env);
    const here = evidenceOf(ctx, null);
    const held = Object.values(ctx.read('training')?.offers ?? {}).find(offer => nameKey(offer.name) === key);
    if (held && !(here.place !== null && held.place === here.place)) return farOut(ctx, { kind: 'far', name, why: 'elsewhere', where: held.where, said: matched.said }, env);
    if (Object.keys(ctx.read('training')?.offers ?? {}).length >= MAX_OFFERS && !held) return keep(ctx, line, name, refused('LIMIT', `This chat has ${MAX_OFFERS} story trainers; no more can be offered.`));
    const plan = liveTrainer(ctx, ix, matched.binding, 'story', here, npcReader(ctx, name));
    if (!plan.ok) return keep(ctx, line, name, refused(plan.code, plan.message));
    if (plan.noop) return quiet(plan.message);
    if (matched.fee) withFee(plan, matched.fee);
    else matched.notes = keepNotes([...matched.notes, NOTE.feeRolled(feeWords(ctx.query, plan.offer.fee, true))]);
    const guard = buildGuard({ hash: value => ctx.hash(value), owner: 'rpg-battle', epoch: epochOf(ctx), source: ctx.source, rulesHash: pin.hash, kind: KIND,
        payload: { binding: matched.binding, by: 'story', matcher: matched.matcher ?? MATCHER }, inputs: plan.facts });
    ctx.replayGuard({ ...guard, replyBound: true }, plan.kept);
    const { offer } = plan;
    if (!ctx.claim(`rb:${epochOf(ctx)}:trainer:${ctx.hash({ trainer: nameKey(offer.name) }).slice(0, 16)}`)) ctx.fail('CLAIMED', 'That trainer was already offered.');
    const training = ctx.draft('training');
    training.offers ??= {};
    training.offers[offer.id] = { ...offer, settled: { matcher: matched.matcher ?? MATCHER, line: lineKey(ctx, line), sid: ctx.source.sid, receipt: ctx.receiptId, said: matched.said, band: matched.band,
        notes: matched.notes, ...(matched.fee ? { feeBy: 'said' } : {}), shown: { fee: feeWords(ctx.query, offer.fee, true), teaches: flat(plan.summary.skills.join(', '), 120), template: flat(ix.trainerTemplate(offer.template)?.name ?? '', 80) } } };
    const standing = matched.fee && matched.band === 'within' ? ' (fee as agreed)' : '';
    return {
        summary: `${offer.name} will teach ${list(plan.summary.skills)} at ${plan.summary.where} for ${feeWords(ctx.query, offer.fee, true)} a session.${standing}`,
        narrate: true,
        data: { trainer: offer.id, fee: offer.fee, place: offer.place, where: offer.where, template: offer.template, skills: offer.skills, by: 'story', band: matched.band, notes: matched.notes },
    };
}

/** A refused line keeps the narrator's words as an SD hook, when SD is there and nothing of that name is followed yet. */
function keep(ctx, line, name, result) {
    if (!name || threadOf(ctx.query, { key: name })) return result;
    try {
        const id = freshThreadId(ctx);
        ctx.call('threads.offer', { write: writeId(ctx, `goal:${id}`), thread: id, kind: 'hook', key: name, summary: flat(line.text || name, 240), fields: {}, expectedHash: null });
    } catch { /* No Story Director: the Problem is all there is. */ }
    return result;
}

/** A teacher that cannot be offered: nothing is made; the narrator is told once, and the decision is kept under the name's key. */
function farOut(ctx, far, env) {
    const text = farLineOf(far, env.currency);
    const id = declinedId(ctx, far.name);
    const known = declinedOf(ctx.read('rules'));
    if (!Object.hasOwn(known, id) && Object.keys(known).length < MAX_DECLINED) {
        const { reason, suggestion } = farReasonOf(far, env.currency);
        call(ctx, 'rules.recordOffer', { write: writeId(ctx, `declined:${id}`), declined: id, record: { v: 1, matcher: MATCHER, sid: ctx.source.sid, receipt: ctx.receiptId, name: flat(far.name, NAME_MAX),
            reason: flat(reason, 200), suggestion: flat(suggestion, 200), band: 'far', kind: 'teacher', said: far.said ?? {} } });
    }
    const told = Object.values(declinedOf(ctx.read('rules'))).filter(row => row.sid === ctx.source.sid).length <= FAR_TOLD;
    return { summary: text, narrate: told, data: { declined: id, band: 'far', why: far.why } };
}

/**
 * hooks.replayGuard for `trainer.offer`: the pin, the epoch, then the unchanged `planTrainer` on the state before the block with what was recorded,
 * and a written fee held to the template's range. Asks no query. undefined for any other guard.
 */
export function replayTrainerOffer({ state, hash }, info) {
    const guard = info?.guard;
    if (guard?.predicate?.kind !== KIND) return undefined;
    const pin = pinned(state?.domains?.rules);
    if (!pin || pin.hash !== guard.rulesHash || guard.epoch !== epochOf(state) || guard.version !== 2) return { ok: false, reason: 'The trainer rules or epoch changed.' };
    const payload = guard.predicate.payload;
    const binding = payload?.binding;
    const recorded = info.recorded;
    if (!binding || typeof binding !== 'object' || payload.by !== 'story' || !recorded || typeof recorded !== 'object') return { ok: false, reason: 'The trainer offer is not whole.' };
    const ix = indexOfState(state);
    if (!ix) return { ok: false, reason: 'The trainer rules or epoch changed.' };
    const plan = planTrainer({ ix, training: state?.domains?.training, binding, by: 'story', recorded });
    if (!plan.ok) return { ok: false, reason: plan.message };
    if (plan.noop) return { ok: false, reason: plan.message };
    if (recorded.feeBy !== undefined) {
        const range = ix.trainerTemplate(plan.offer.template)?.fee;
        if (recorded.feeBy !== 'said' || !range || !Number.isSafeInteger(recorded.fee) || recorded.fee < range.coinMin || recorded.fee > range.coinMax) return { ok: false, reason: 'The written fee is outside the template\'s range.' };
        plan.facts.fee = recorded.fee;
    }
    const expected = buildGuard({ hash, owner: guard.owner, epoch: guard.epoch, source: info.source, rulesHash: pin.hash, kind: KIND, payload, inputs: plan.facts });
    return expected.inputHash === guard.inputHash ? { ok: true } : { ok: false, reason: 'The trainer offer evidence changed.' };
}
