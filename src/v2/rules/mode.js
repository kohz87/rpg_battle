// RPG Battle v2, the mode of Jobs from the story, as a property of each reply (GENERATIVE_OFFERS_SPEC, Decisions).
//
// The switch "Jobs from the story" is the reader's, and a reader changes it in the middle of a chat. A line that is read one way with the switch on and another with it off must not be
// read by the switch of the moment it is read at, or a Re-read, a rebuild and a reload would each decide an old line again by a setting that was not the one it was written under.
// So each reply keeps the mode it was read under, on itself: the first time a reply's capture reads a line the mode changes with the switch on, the reply is stamped free (`mode.<ms_ id>` of
// the rules slice, one small record written in the reply's own steps). A reply that is read again, edited or not, uses its own stamp. A reply with none is read strict, as RPG Battle 2.2.0 did:
// the reply was read with the switch off, or recorded before 2.3.0, or it had no such line. (A strict reply writes nothing: its line may fail, and a failed line keeps no steps.) A new reply
// takes the switch of its moment. Deleting a reply takes its own stamp and no other reply's reading depends on it; nothing is kept between replies, so there is nothing a delete, a swipe, a
// rebuild or a reload can leave behind.

import { featureOn } from '../items/condition.js';
import { MODE_KEY } from './offers.js';
import { isObject } from './ids.js';

export const OFFERS_FEATURE = 'rpg-battle.generative-offers';

/** The mode the reader's switch asks for now, 'free' | 'strict' (a host that cannot say takes the switch as on). */
export const switchMode = source => (featureOn(source, OFFERS_FEATURE) ? 'free' : 'strict');

const sidOf = ctx => ctx?.source?.sid ?? ctx?.carrier?.sid ?? null;
export const modeId = (ctx, sid) => `ms_${ctx.hash({ mode: sid }).slice(0, 12)}`;

/** The mode the reply `sid` was read under in a state, 'free' | 'strict', or null when it has no stamp. */
export const stampOf = (slice, id) => {
    const stamp = isObject(slice) ? slice[MODE_KEY + id] : undefined;
    return stamp?.mode === 'free' || stamp?.mode === 'strict' ? stamp.mode : null;
};

/**
 * Whether the line being read is read freely (Jobs from the story) by the mode of its reply: free when the reply is stamped so in the steps so far (an earlier line of it), or on a Re-read when
 * the reply as it stands (`ctx.standing`) is, in which case the stamp is written again so the new steps hold it; a reply read for the first time is free when the switch is on, and is stamped;
 * strict otherwise, and nothing is written.
 */
export function readsFreely(ctx) {
    const sid = sidOf(ctx);
    const slice = ctx?.read?.('rules');
    if (!sid || !isObject(slice) || !isObject(slice.pin) || typeof ctx.call !== 'function') return switchMode(ctx) === 'free';
    const id = modeId(ctx, sid);
    const held = stampOf(slice, id);
    if (held !== null) return held === 'free';
    // A Re-read goes by the reply as it stands (no stamp: strict); a reply read for the first time by the switch of its moment.
    const free = ctx.standing ? stampOf(ctx.standing.domains?.rules, id) === 'free' : switchMode(ctx) === 'free';
    if (!free) return false;
    // Never fails the line: a stamp that cannot be kept leaves the reply read strict on a Re-read.
    try { ctx.call('rules.recordOffer', { write: `wr_${ctx.hash({ mode: sid, writer: 'mode' }).slice(0, 8)}`, mode: id, record: { v: 1, sid, mode: 'free' } }); } catch { /* read as the switch said */ }
    return true;
}
