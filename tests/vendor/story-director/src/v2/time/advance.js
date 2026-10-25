// Story Director v2, part **time**: `director.advance`, the story clock moved on by another module's
// rule (RPG Battle's crafting takes story time). Pure apart from the ctx.
//
// `director.advance { minutes, cause?, reason? }`, for modules and Story Block's own steps only (cause
// `story` or `system`, usually through `ctx.call` from a capture): the clock moves forward by `minutes`,
// held to 1..1440 (a day) per call, as a `~ time` line moves it (the tracker's `director.time.minutes`),
// so deadlines, the While away recap and the day digest follow it the same way. `cause` names what took
// the time (a short label: "craft"), else the calling module (`ctx.caller`); `reason` is the plain words
// the receipt tells ("Ren crafts an Iron Sword").
//
// At most one move per reply per cause: the first takes the claim `advance:<cause>:<reply sid>`
// (`ctx.carrier.sid`, which stays with the reply when an earlier message is deleted, and goes with the
// reply's own record when it is swiped or deleted). A later call for the same cause in that reply moves
// nothing and says so (`problem`): it does not fail, so the caller's own command (the craft) still
// stands. Without a reply to key on (a host step outside a capture) there is no claim.
//
// Refused from a click (cause `ui`: the reader moves the clock through the story) and while the story
// time is not set.

import { calendarOf, timeSettings } from './records.js';

export const ADVANCE = 'director.advance';
export const MAX_ADVANCE = 1440;
const CAUSE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const MAX_REASON = 120;

const isInt = value => Number.isSafeInteger(value);

function fail(ctx, code, message) {
    ctx.fail(code, message);
    // ctx.fail throws; this is only for a ctx that does not.
    const error = new Error(message);
    error.code = code;
    throw error;
}

// Plain words: one line, invisible marks gone, cut by code points.
function words(value) {
    const flat = String(value ?? '').replace(/[\p{Cf}\p{Cc}]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const chars = Array.from(flat);
    return chars.length <= MAX_REASON ? flat : `${chars.slice(0, MAX_REASON - 1).join('').trimEnd()}…`;
}

/** "2 h", "45 min", "1 h 30 min". */
export function spanText(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return [hours ? `${hours} h` : '', rest ? `${rest} min` : ''].filter(Boolean).join(' ') || '0 min';
}

/** The claim one reply's move for `cause` takes, or null without a reply to key on. */
export const advanceClaim = (cause, sid) => (typeof sid === 'string' && sid ? `advance:${cause}:${sid}` : null);

/** `director.advance { minutes, cause?, reason? }` (see above). */
export function advanceCommand(ctx, payload = {}) {
    if (ctx?.cause === 'ui') fail(ctx, 'REFUSED', 'Story time moves with the story: write it in the reply, or let the rules that take time move it.');
    const asked = payload?.minutes;
    if (!isInt(asked) || asked < 1) fail(ctx, 'INVALID', 'director.advance: "minutes" must be a whole number of story minutes, 1 or more.');
    const label = payload?.cause ?? ctx?.caller ?? 'system';
    const cause = String(label).trim().toLowerCase();
    if (!CAUSE.test(cause)) fail(ctx, 'INVALID', 'director.advance: "cause" must be a short label (letters, digits, ".", "_", "-"; at most 40).');
    const reason = words(payload?.reason);
    const director = ctx.draft('director');
    const before = director?.time?.minutes;
    if (!isInt(before)) fail(ctx, 'REFUSED', 'The story time is not set yet, so it cannot move on.');
    const calendar = calendarOf(timeSettings(ctx.settings));
    const why = reason || cause;
    const claim = advanceClaim(cause, ctx.carrier?.sid ?? null);
    if (claim && !ctx.claim(claim)) {
        return {
            summary: `Story time stays at ${calendar.format(before)}: the clock already moved for ${cause} in this reply (${why}).`,
            narrate: false,
            data: { minutes: before, from: before, advanced: 0, cause, reason, held: 'once' },
            problem: `The clock moves once a reply for ${cause}; "${why}" did not move it again.`,
        };
    }
    const minutes = Math.min(asked, MAX_ADVANCE);
    const next = before + minutes;
    if (!isInt(next)) fail(ctx, 'INVALID', 'That is further on than the story clock can count.');
    director.time.minutes = next;
    const held = minutes < asked;
    return {
        summary: `Story time: ${calendar.format(next)} (${spanText(minutes)} on: ${why}).`,
        narrate: false,
        data: { minutes: next, from: before, advanced: minutes, cause, reason, ...(held ? { asked } : {}) },
        ...(held ? { problem: `${why}: ${spanText(asked)} asked; the clock moves at most a day (${spanText(MAX_ADVANCE)}) at once.` } : {}),
    };
}
