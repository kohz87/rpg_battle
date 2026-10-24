// RPG Battle v2, a training session started and finished by the host (contract §3 `rules.settle`, §5 "Training start", B3
// training, B5 "Training request/start/completion"). `skill.train` only asked. This is the host's step that answers: it
// validates the trainer, the place, the character and the funds, then **pays the fee (Story Block) and moves the story clock
// by the session's sixty minutes (Story Director) in one transaction** with the session's result, the 10% event roll and the
// completion credits; the whole step rolls back if the clock did not move by exactly that much. The session runs from the
// minute the clock stood at to sixty minutes later, so it is over in the same step:
//
//   * the event die (1-100, an event when it is at most the pinned percent and the trainer has frozen events) is rolled once with
//     the receipt's seed and recorded; a planned-again step reuses it. An event interrupts the session: the fee is paid, the time
//     has passed, no credit and no refund;
//   * otherwise `trainCredits` attempts of kind training are recorded on the day the session ended, and settled with everything
//     else that waits for a credit (the caps are the shared ones);
//   * a session the host cannot start (the party is elsewhere, cannot pay, or the character no longer holds the skill) is
//     **refused** with its reason: no fee, no time, no event, no credit, and the character may ask again;
//   * no clock, an unknown place or no purse to read hold the step (the hook does not ask for it; asked anyway it fails).
//
// planSession is pure and is what the replay guard asks again; settleSession does the writing.

import { attemptFor } from '../progress/record.js';
import { planSettlement } from '../progress/credit.js';
import { standing } from '../progress/offers.js';
import { readClock, trainingWindow } from './clock.js';
import { isObject } from '../rules/ids.js';

const ask = (query, name, args) => {
    try {
        return typeof query === 'function' ? query(name, args) : null;
    } catch {
        return null;
    }
};

/** The coin the party's purse holds, or null when no purse can be read. */
export function purseOf(query) {
    const wallet = ask(query, 'inventory.wallet', { owner: 'party' });
    return isObject(wallet) ? (Number.isSafeInteger(wallet.coin) ? wallet.coin : 0) : null;
}

/** The place the party is in, as Story Director names it (a canonical id), or null. */
export function placeOf(query) {
    const here = ask(query, 'atlas.canonical', {});
    return isObject(here) && typeof here.id === 'string' ? here.id : null;
}

/**
 * What settling session `id` would do on this state. `env`: { ix, progress, training, query }; `event`: { die, template } as
 * rolled (or recorded); `source`: the Source the step stands on; `hash`: the contract's Hash.
 * → { ok: false, code, why } (cannot be settled now) | { ok: true, outcome: 'refused', patch, plan, inputs }
 *   | { ok: true, outcome: 'ran', patch, attempts: [{ id, record }], plan, start, end, fee, inputs }.
 */
export function planSession(env, id, event, source, hash) {
    const { ix, progress, training, query } = env;
    const session = training?.sessions?.[id];
    if (!session || session.status !== 'requested') return { ok: false, code: 'NO_LONGER_DONE', why: 'That training is not waiting any more.' };
    const trainer = ix.trainer(session.trainer);
    const refuse = reason => ({ ok: true, outcome: 'refused', patch: { status: 'refused', reason }, plan: [], inputs: { session: id, outcome: 'refused', reason } });
    const view = standing(ix, progress, session.actor).skills.find(item => item.skill === session.skill);
    if (!trainer || !trainer.skills.includes(session.skill)) return refuse('That trainer does not teach it any more.');
    if (!view || view.form !== session.form) return refuse('The character does not hold that skill in that form now.');
    const start = readClock(query);
    if (start === null) return { ok: false, code: 'CLOCK_UNSET', why: 'Training takes story time, and the clock is not set.' };
    const place = placeOf(query);
    if (place === null) return { ok: false, code: 'DEPENDENCY_UNAVAILABLE', why: 'Where the party is cannot be told.' };
    if (place !== trainer.place) return refuse(`${trainer.name} is not here.`);
    const coin = purseOf(query);
    if (coin === null) return { ok: false, code: 'DEPENDENCY_UNAVAILABLE', why: 'The party\'s purse cannot be read.' };
    if (coin < trainer.fee) return refuse(`The party cannot pay ${trainer.fee}.`);
    const window = trainingWindow(start, ix.constants);
    const hit = event.template !== null;
    const patch = { status: hit ? 'interrupted' : 'completed', fee: trainer.fee, startMinute: window.start, endMinute: window.end, event: { die: event.die, template: event.template }, reason: hit ? 'An event interrupted the session.' : null };
    const attempts = hit ? [] : Array.from({ length: ix.constants.trainCredits }, (_, n) => attemptFor(
        { actor: session.actor, skill: session.skill, form: session.form, kind: 'training', key: `${id}:${n + 1}`, cost: id, session: id, minute: window.end },
        source, hash, message => { throw new Error(message); },
    ));
    const simulated = { ...progress, attempts: { ...(progress.attempts ?? {}), ...Object.fromEntries(attempts.map(item => [item.id, item.record])) } };
    const plan = planSettlement(ix.constants, simulated, start);
    return {
        ok: true, outcome: 'ran', patch, attempts, plan, start: window.start, end: window.end, fee: trainer.fee,
        inputs: { session: id, outcome: patch.status, trainer: trainer.id, fee: trainer.fee, place, start: window.start, end: window.end, event: patch.event, plan: plan.map(({ minute, ...row }) => row) },
    };
}

/** Rolls the session's event: { die, template } from the receipt's dice (ctx.roll), the template one of the trainer's frozen events or null. */
export function rollEvent(ctx, ix, session) {
    const trainer = ix.trainer(session.trainer);
    const templates = trainer?.eventTemplates ?? [];
    const die = ctx.roll('1d100').total;
    if (!templates.length || die > ix.constants.trainEventPercent) return { die, template: null };
    return { die, template: templates[ctx.roll(`1d${templates.length}`).total - 1] };
}
