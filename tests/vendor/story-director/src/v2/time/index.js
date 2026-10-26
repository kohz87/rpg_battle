// Story Director v2, part **time** (MODULES §F21): deadlines that slip or lapse when story time
// passes, and the While away recap after a jump. No domain of its own: it reads the story clock
// (`director.time.minutes`, the tracker part's) and writes `checked` and `recap` on the
// `director` domain, and closes threads time ran past (status, ended, offer, rev).
//
// Before each reply (`beforeGenerate`), the clock is compared with the last time settled. When
// it moved (or a deadline is due to lapse, or the recap was for an earlier reply) the hook
// commits `time.settle` as a `system` receipt on the reply where the time passed, so swiping or
// deleting that reply takes it all back. Its summary tells the next reply what slipped, in v1's
// words; the recap goes in this part's tail, for that reply only.
//
// Commands: `time.settle` (the hook's) and `director.advance` (another module's rule moving the clock
// on: crafting takes time; advance.js).
// Queries: `time.now` (the clock for other modules: minutes, the calendar text, the story day and its
// date), `time.overdue` and `time.recap`.

import { makeCalendar } from '../../calendar.js';
import { estimateTokens } from '../../relevance.js';
import { RECAP_BUDGET } from './recap.js';
import { DEFAULTS, calendarOf, timeSettings } from './records.js';
import { needsSettle, recapStale, settle, settleSummary } from './settle.js';
import { slotValue } from '../slot.js';
import { ADVANCE, advanceCommand } from './advance.js';
import { WEATHER_FEATURE, weatherHook } from './weather.js';

export const SETTLE = 'time.settle';

const isInt = value => Number.isSafeInteger(value);
const copy = value => structuredClone(value);

function fail(ctx, code, message) {
    ctx.fail(code, message);
    // ctx.fail throws; this is only for a ctx that does not.
    const error = new Error(message);
    error.code = code;
    throw error;
}

// A query that may not exist (the quests part's `quest.progress`): its answer, or the fallback.
function tryQuery(query, name, args, fallback) {
    if (typeof query !== 'function') return fallback;
    try {
        return query(name, args) ?? fallback;
    } catch {
        return fallback;
    }
}

// A quest whose target is met waits only for its turn-in: like v1's pay waiting, the hour fails nothing.
const targetMet = () => () => false;

/*
 * The meta.rev this receipt will carry (SPEC §2.4, MODULES §F2 `ctx.rev`). Without `ctx.rev`,
 * the hook's `rev` (the head's meta.rev + 1: the cue is committed at once on that head), else
 * meta.rev + 1 through `ctx.read('meta')`, else 0.
 */
function receiptRev(ctx, given) {
    if (isInt(ctx?.rev)) return ctx.rev;
    if (isInt(given)) return given;
    try {
        const meta = ctx.read('meta');
        if (isInt(meta?.rev)) return meta.rev + 1;
    } catch {
        // No meta through ctx.read.
    }
    return 0;
}

/**
 * `time.settle` (cause `system`, from the hook). Payload `{ at?, rev? }`: the chat's length when
 * the hook ran (which reply the recap is for) and the revision the hook expects this receipt to
 * have (used only when the host gives no `ctx.rev`). Refused (`REFUSED`) while the story time is
 * not set.
 */
function settleCommand(ctx, payload = {}) {
    const at = payload?.at ?? null;
    const given = payload?.rev ?? null;
    if (!(at === null || (isInt(at) && at >= 0))) fail(ctx, 'INVALID', 'time.settle: "at" must be the chat\'s length (a whole number).');
    if (!(given === null || (isInt(given) && given >= 0))) fail(ctx, 'INVALID', 'time.settle: "rev" must be a whole number.');
    const director = ctx.draft('director');
    if (!isInt(director?.time?.minutes)) fail(ctx, 'REFUSED', 'The story time is not set yet, so there is nothing to settle.');
    const settings = timeSettings(ctx.settings);
    const calendar = calendarOf(settings);
    const rev = receiptRev(ctx, given);
    // Each thread it closes is marked (Story Block's ctx.ifThere, SPEC §2.2 rule d): when the reply that
    // made the thread is deleted, replay passes over that closing and keeps the rest of the settle.
    const within = id => { if (typeof ctx.ifThere === 'function') ctx.ifThere('director', `/threads/${id}`); };
    const done = settle(director, { calendar, settings, rev, at, claim: key => ctx.claim(key), within, met: targetMet(ctx.query), fights: ctx.fights !== false });
    const told = settleSummary(done.closed, { calendar, now: done.now });
    return {
        summary: told || `Story time settled at ${calendar.format(done.now, { era: false })}.`,
        narrate: Boolean(told),
        data: {
            minutes: done.now,
            from: done.from,
            lapsed: done.closed.map(({ id, key, kind, reason }) => ({ id, key, kind, reason })),
            overdue: [...done.standing.overdue],
            pay: [...done.standing.pay],
            due: [...done.standing.due],
            recap: Boolean(done.recap && done.recap.rev === rev),
        },
    };
}

/** `beforeGenerate(view)`: `{ lines: [], commands: [time.settle] }` when there is something to settle. */
export function beforeGenerate(view) {
    const state = view?.state;
    if (!state?.domains?.director) return { lines: [], commands: [] };
    const settings = timeSettings(view.settings);
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    const calendar = calendarOf(settings);
    if (!needsSettle(state, { calendar, settings, at, met: targetMet(view.query) })) return { lines: [], commands: [] };
    const rev = isInt(state.meta?.rev) ? state.meta.rev + 1 : null;
    return { lines: [], commands: [{ type: SETTLE, payload: { at, rev } }] };
}

/** The recap the reply about to be written gets, or null. */
function recapFor(view) {
    const recap = slotValue(view?.state?.domains?.director?.recap);
    if (!recap || !Array.isArray(recap.lines)) return null;
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    return recapStale(recap, { at, rev: view?.state?.meta?.rev ?? null }) ? null : recap;
}

/** `context.tail(view)`: the `[While away] …` line for the reply after the jump. */
export function timeTail(view) {
    const recap = recapFor(view);
    const lines = recap ? recap.lines.filter(line => typeof line === 'string' && line && estimateTokens(line) <= RECAP_BUDGET) : [];
    return { lines, optional: [] };
}

const stillActive = (director, ids) => (Array.isArray(ids) ? ids : [])
    .map(id => director?.threads?.[id])
    .filter(thread => thread && thread.status === 'active')
    .map(thread => ({ id: thread.id, key: thread.key, kind: thread.kind, due: String(thread.fields?.due ?? thread.fields?.on ?? '') }));

// The chat's calendar for a query: the tracker's `director.calendar` (the reader's, else the enabled
// pack's, else Gregorian), else this part's own settings as module.js hands them over.
function queryCalendar(tools) {
    try {
        const config = typeof tools?.query === 'function' ? tools.query('director.calendar', {}) : null;
        if (config && typeof config === 'object') return makeCalendar(config);
    } catch {
        // No tracker part: this part's settings.
    }
    return calendarOf(timeSettings(tools?.settings));
}

/**
 * `time.now`: the story clock for other modules (RPG Battle's timed effects, the day digest):
 * `{ minutes, text, day, date }`: whole story minutes, that time on the chat's calendar
 * ("June 3, 1200, 08:00 am"), the story day (minutes / 1440, floored) and its date ("June 3, 1200").
 * While the story has not set the time: `{ minutes: null, text: '', day: null, date: '' }`.
 */
export function nowQuery(state, _args, tools) {
    const minutes = state?.domains?.director?.time?.minutes;
    if (!isInt(minutes)) return { minutes: null, text: '', day: null, date: '' };
    let text = '';
    let date = '';
    try {
        const calendar = queryCalendar(tools);
        text = calendar.format(minutes);
        date = calendar.format(minutes, { time: false });
    } catch {
        text = '';
        date = '';
    }
    return { minutes, text, day: Math.floor(minutes / 1440), date };
}

export const queries = {
    'time.now': nowQuery,
    /**
     * Where threads stood when the story time was last settled: `{ minutes, lapsed, overdue,
     * pay, due }`, each a list of `{ id, key, kind, due }` (lapsed: closed in that jump, with
     * `reason`; the others still open), or null before the first settle.
     */
    'time.overdue': state => {
        const director = state?.domains?.director;
        const checked = slotValue(director?.checked);
        if (!checked) return null;
        const lapsed = (checked.lapsed ?? []).map(id => director.threads?.[id]).filter(Boolean)
            .map(thread => ({ id: thread.id, key: thread.key, kind: thread.kind, due: String(thread.fields?.due ?? thread.fields?.on ?? ''), reason: thread.ended?.reason ?? '' }));
        return {
            minutes: checked.minutes,
            lapsed,
            overdue: stillActive(director, checked.overdue),
            pay: stillActive(director, checked.pay),
            due: stillActive(director, checked.due),
        };
    },
    /** The While away recap kept for the reply after a jump: `{ fromMinutes, toMinutes, lines, threads, rev, at }` or null. */
    'time.recap': state => {
        const recap = slotValue(state?.domains?.director?.recap);
        return recap ? copy(recap) : null;
    },
};

export const part = {
    domains: {},
    commands: { [SETTLE]: settleCommand, [ADVANCE]: advanceCommand },
    queries,
    kinds: {},
    context: {
        // Nothing fixed: the recap carries its own cue, so the static prompt is unchanged.
        static: () => '',
        tail: view => timeTail(view),
        budget: RECAP_BUDGET,
    },
    // Right after a reply's last story line (Story Block's afterCapture): the day's weather by rule (weather.js).
    hooks: { beforeGenerate, afterCapture: Object.assign(view => weatherHook(view), { feature: WEATHER_FEATURE }) },
    // MODULES §F122: the weather from the calendar's season and the region, seeded per story day and region.
    features: [{ id: WEATHER_FEATURE, label: 'Weather from the calendar', describe: 'Each story day gets its weather from the season and the region (a pack may give its own table), so the Status card and the Scene always have one. A ~ weather line the story writes wins for the rest of that day and place.', default: true }],
    settings: {
        section: 'Time',
        defaults: { ...DEFAULTS },
        // The reader's calendar is the tracker part's setting (module.js hands it over as `calendar`).
        reads: { calendar: 'tracker.calendar' },
        schema: {
            recapHours: { type: 'int', label: 'While away recap after a jump of (story hours)', min: 1, max: 720 },
            lapses: { type: 'bool', label: 'Deadlines slip or lapse as story time passes' },
        },
    },
    tabs: [],
};
