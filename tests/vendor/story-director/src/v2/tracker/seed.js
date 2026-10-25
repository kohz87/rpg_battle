// Story Director v2, tracker part: the story clock set from a pack's start date (MODULES §F21,
// Story Block's query `packs.calendar` → `{ pack, era, months, start }`).
//
// A chat whose story has not set the time yet, with an enabled pack that gives a start
// (`{ year, month, day, hour, minute }`), starts on that date: before the reply is written the
// hook commits `director.seed` as a `system` receipt, so deadlines, beats and events on dates work
// from the first reply. Once per line of history (claim `clock:seed`); the story's own `~ time`
// line moves it from there as usual. Nothing happens when the date is not on the chat's calendar
// (the reader chose their own calendar without the pack's months).

import { SEED_CLAIM, calendarOf, packCalendarOf, settingsFrom, startMinutes } from './time.js';

export const SEED = 'director.seed';

const settingsOf = source => settingsFrom(typeof source === 'function' ? source() : source);

function fail(ctx, code, message) {
    ctx.fail(code, message);
    // ctx.fail throws; this is only for a ctx that does not.
    const error = new Error(message);
    error.code = code;
    throw error;
}

/** Where a seed would set the clock: `{ minutes, calendar, pack }`, or null when there is nothing to seed. */
export function seedFor(director, settings, query) {
    if (!director || Number.isInteger(director.time?.minutes)) return null;
    const pack = packCalendarOf(query);
    if (!pack?.start) return null;
    const calendar = calendarOf(settings, pack);
    const minutes = startMinutes(calendar, pack.start);
    return minutes === null ? null : { minutes, calendar, pack };
}

/** `director.seed` (cause `system`, from the hook; payload `{}`): the clock set to the pack's start. */
export function seedCommand(ctx) {
    const director = ctx.draft('director');
    if (Number.isInteger(director.time?.minutes)) fail(ctx, 'REFUSED', 'The story time is already set.');
    const seed = seedFor(director, settingsOf(ctx.settings), ctx.query);
    if (!seed) fail(ctx, 'REFUSED', 'No enabled pack gives a start date on this calendar.');
    if (!ctx.claim(SEED_CLAIM)) fail(ctx, 'CLAIMED', 'The story clock was already set from the pack.');
    director.time.minutes = seed.minutes;
    return {
        summary: `Story time: ${seed.calendar.format(seed.minutes)} (the start of ${seed.pack.pack ?? 'the pack'}).`,
        // The Director note gives the time every reply; nothing to narrate.
        narrate: false,
        data: { minutes: seed.minutes, pack: seed.pack.pack ?? null },
    };
}

/** `beforeGenerate(view)`: `{ commands: [director.seed] }` while the clock is unset and a pack has a start. */
export function seedHook(view) {
    const state = view?.state;
    const director = state?.domains?.director;
    if (!director || Number.isInteger(director.time?.minutes)) return undefined;
    if (Object.hasOwn(state?.meta?.claims ?? {}, SEED_CLAIM)) return undefined;
    if (!seedFor(director, settingsOf(view.settings), view.query)) return undefined;
    return { lines: [], commands: [{ type: SEED, payload: {} }] };
}
