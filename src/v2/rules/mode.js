// RPG Battle v2, the mode of Jobs from the story, as a property of each reply (GENERATIVE_OFFERS_SPEC, Decisions).
//
// The switch "Jobs from the story" is the reader's, and a reader changes it in the middle of a chat. A line that is read one way with the switch on and another with it off must not be
// read by the switch of the moment it is read at, or a Re-read, a rebuild and a reload would each decide an old line again by a setting that was not the one it was written under.
// So each reply keeps the mode it was read under, on itself: a reply whose capture ran with the switch on is stamped free (`mode.<ms_ id>` of the rules slice, one small record), by a step of the
// reply of its own (`rules.stampReply`, run by the afterCapture hook once the reply's lines are read), so the stamp does not depend on any one line surviving: lines that fail keep no steps, and
// the stamp is not one of theirs. A reply that is read again, edited or not, goes by the stamp it has and is stamped again. A reply with none is read strict, as RPG Battle 2.2.0 did: it was read
// with the switch off, or recorded before 2.3.0, or had no line of ours at all. (A strict reply writes nothing.) A new reply takes the switch of its moment. Deleting a reply takes its own stamp
// and no other reply's reading depends on it; nothing is kept between replies, so there is nothing a delete, a swipe, a rebuild or a reload can leave behind.
//
// Whether a pass read with the switch on is told to the hook in this process (`noteRead` for each line of ours, `takeNoted` by the hook): the hook runs right after the lines of the same pass,
// live or on a Re-read. The hook runs only for a reply that kept a receipt; a reply none of whose lines kept a step has no state of ours to read differently, and keeps no stamp.

import { featureOn } from '../items/condition.js';
import { MODE_KEY } from './offers.js';
import { isObject } from './ids.js';

export const OFFERS_FEATURE = 'rpg-battle.generative-offers';

/** The mode the reader's switch asks for now, 'free' | 'strict' (a host that cannot say takes the switch as on). */
export const switchMode = source => (featureOn(source, OFFERS_FEATURE) ? 'free' : 'strict');

// The reply as the host knows it where it stores steps (the carrier's id, one for each swipe): what a step of the reply (the hook's) and a line of it both see.
const sidOf = ctx => ctx?.reply?.sid ?? ctx?.carrier?.sid ?? null;
export const modeId = (ctx, sid) => `ms_${ctx.hash({ mode: sid }).slice(0, 12)}`;

/** The mode the reply `sid` was read under in a state, 'free' | 'strict', or null when it has no stamp. */
export const stampOf = (slice, id) => {
    const stamp = isObject(slice) ? slice[MODE_KEY + id] : undefined;
    return stamp?.mode === 'free' || stamp?.mode === 'strict' ? stamp.mode : null;
};

const noted = new Set();

/** Whether this pass of the reply's capture is a free one: a Re-read goes by the reply as it stands, a reply read for the first time by the switch; a Continue by the stamp the reply has already. */
function freePass(ctx) {
    const sid = sidOf(ctx);
    const slice = ctx?.read?.('rules');
    if (!sid || !isObject(slice) || !isObject(slice.pin)) return false;
    const id = modeId(ctx, sid);
    if (stampOf(slice, id) === 'free') return true;
    return ctx.standing ? stampOf(ctx.standing.domains?.rules, id) === 'free' : switchMode(ctx) === 'free';
}

/**
 * Whether the line being read is read freely (Jobs from the story) by the mode of its reply: free when the reply is stamped so already (an earlier pass of it, a Continue), or on a Re-read when
 * the reply as it stands is, and a reply read for the first time is free when the switch is on; strict otherwise. Writes nothing (the stamp is `rules.stampReply`'s).
 */
export function readsFreely(ctx) {
    const slice = ctx?.read?.('rules');
    if (!sidOf(ctx) || !isObject(slice) || !isObject(slice.pin)) return switchMode(ctx) === 'free';
    return freePass(ctx);
}

/** Told by the dispatcher for each line of ours: the reply is read freely this pass (so the hook stamps it). */
export function noteRead(ctx) {
    try {
        if (freePass(ctx)) noted.add(sidOf(ctx));
    } catch { /* no note, no stamp */ }
}

/** The reply being captured now, for the hook: `rules.replyNow` → { sid }. */
export const replyNow = (_state, _args, tools) => ({ sid: tools?.reply?.sid ?? null });

/** afterCapture: the reply is stamped free when its pass read freely (once, however many lines it had). */
export function stampAfterCapture(view) {
    if (!isObject(view?.state?.domains?.rules?.pin) || typeof view.query !== 'function') return { commands: [] };
    let sid = null;
    try { sid = view.query('rules.replyNow', {})?.sid; } catch { sid = null; }
    if (typeof sid !== 'string' || !noted.delete(sid)) return { commands: [] };
    return { commands: [{ type: 'rules.stampReply', payload: {} }] };
}

/** rules.stampReply {}: the reply it is stored on is stamped free. The host's own step (cause `system`, sent by `stampAfterCapture`); asked again for the same reply it keeps what it has. */
export function stampReply(ctx) {
    if (ctx.cause !== 'system' || ctx.caller) ctx.fail('REFUSED', 'The mode of a reply is kept by the host\'s own step: nobody else sets it.');
    const sid = ctx.reply?.sid;
    const slice = ctx.read('rules');
    if (typeof sid !== 'string' || !isObject(slice) || !isObject(slice.pin)) ctx.fail('REFUSED', 'This chat does not run a rules pack, or the reply is not known.');
    const id = modeId(ctx, sid);
    ctx.draft('rules')[MODE_KEY + id] = { v: 1, sid, mode: 'free' };
    return { summary: 'The reply was read freely.', narrate: false, data: { mode: 'free' } };
}
