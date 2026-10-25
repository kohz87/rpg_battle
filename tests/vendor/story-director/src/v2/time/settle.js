// Story Director v2, part **time**: deadlines that slip or lapse as story time passes, and the
// While away recap (MODULES §F21). Pure: `standing` reads, `settle` writes the draft it is given.
//
// v1's rules, by import: a beat whose date went by more than two story days ago without the
// story firing it slips (lapses.slippedBeats); an offer nobody took before its deadline lapses
// (lapses.lapsedOffers, with a beat's grace once the reader spoke of it); a quest whose work is
// done and only the pay waits is never failed for the hour (tracker.waitsForPay, and v2's own
// "target met" from the quests part). A quest the reader took on whose deadline passed is
// overdue: the story is told (v1's Due now and While away) and may fail it or move the
// deadline; once the same two days of grace are gone too, time fails it ('deadline passed').
// Clocks, beats, events and agendas that came due are marked as due now; the tracker's note
// brings them in where the scene allows (v1 Pacing).
//
// Each closing is claimed (`lapse:<thread id>`), so a thread is closed by time once on a line
// of history; the claim lives in the same receipt, so swiping or deleting the reply it was
// written to takes both back. Its writes in the thread are marked (ctx.ifThere): deleting the reply
// that made the thread passes over the closing on replay, and the rest of the settle (the check, the
// recap, the other closings) still applies.
//
// Two fields of the `director` domain belong to this part (a MODULES §C1 addition):
//   checked: null | { minutes, rev, lapsed: [id], overdue: [id], pay: [id], due: [id] }
//            the story time last settled, by which receipt, and where threads stood then;
//   recap:   null | { fromMinutes, toMinutes, lines: [text], threads: [id], rev, at }
//            the While away recap for the reply after the jump; `at` is the chat's length when
//            it was made, so it is told to that reply (and its swipes) and cleared after it.

import { LAPSED_REASON, SLIPPED_REASON, SLIP_GRACE_DAYS, lapsedOffers, slippedBeats } from '../../lapses.js';
import { isDue } from '../../relevance.js';
import { waitsForPay } from '../../tracker.js';
import { buildRecap, lapseSummary } from './recap.js';
import { trackerOf } from './records.js';
import { slotValue, toSlot } from '../slot.js';

export const DEADLINE_REASON = 'deadline passed';
export const REASONS = Object.freeze({ slipped: SLIPPED_REASON, lapsed: LAPSED_REASON, failed: DEADLINE_REASON });
// How a thread time closed ends (MODULES §C1 outcomes): the time ran out on it.
export const LAPSE_OUTCOME = 'failed';
export const claimKey = id => `lapse:${id}`;

const isInt = value => Number.isSafeInteger(value);

// The last minute a date counts for: a date without a time runs to the end of its day, the
// way v1 counts deadlines (lapses.js, the Quests tab).
function deadlineEnd(record, calendar, now) {
    const written = String(record?.fields?.due ?? '').trim();
    if (!written) return null;
    const parsed = calendar.parse(written, { reference: now });
    if (!parsed || !Number.isFinite(parsed.abs)) return null;
    return parsed.hasTime ? parsed.abs : calendar.addDays(parsed.abs, 1) - 1;
}

/**
 * Where the active threads stand at story time `now`, in tracker order:
 * `{ lapses: [{ id, reason }], overdue: [id], pay: [id], due: [id] }`.
 * `met(id)`: the quest's target is met (only its turn-in waits). `claimed(key)`: a claim is
 * already taken (those threads are not lapsed again). `lapse: false` closes nothing: what would
 * have closed is overdue (a quest or offer) or due (a beat).
 */
export function standing(director, { calendar, now, met = () => false, claimed = () => false, lapse = true, graceDays = SLIP_GRACE_DAYS } = {}) {
    const out = { lapses: [], overdue: [], pay: [], due: [] };
    if (!director || !calendar || !isInt(now)) return out;
    const { tracker, threadOf } = trackerOf(director, { calendar, now });
    const options = { calendar, now, graceDays };
    const slipped = new Set(slippedBeats(tracker, options));
    const lapsed = new Set(lapsedOffers(tracker, options));
    for (const record of tracker.records) {
        const thread = threadOf.get(record);
        if (thread.rpg || thread.kind === 'quest') continue;
        const id = thread.id;
        const closes = reason => {
            if (lapse && !claimed(claimKey(id))) out.lapses.push({ id, reason });
            else if (reason === SLIPPED_REASON) out.due.push(id);
            else out.overdue.push(id);
        };
        if (record.kind === 'secret') continue;
        if (slipped.has(record)) {
            closes(SLIPPED_REASON);
            continue;
        }
        if (lapsed.has(record)) {
            closes(LAPSED_REASON);
            continue;
        }
        const job = Boolean(thread.taken || thread.offer);
        if (!job) {
            if (isDue(record, { calendar, now })) out.due.push(id);
            continue;
        }
        const end = deadlineEnd(record, calendar, now);
        if (end === null || end > now) continue;
        // An offer still within its grace (the reader spoke of it): overdue, not lapsed yet.
        if (thread.offer && !thread.taken) {
            out.overdue.push(id);
            continue;
        }
        if (waitsForPay(record) || met(id)) out.pay.push(id);
        else if (calendar.addDays(end, graceDays) < now) closes(DEADLINE_REASON);
        else out.overdue.push(id);
    }
    return out;
}

/**
 * Whether the recap was made for an earlier reply than the one about to be written: the chat
 * has grown by a reply since (`at`, the chat's length now), else (no length known) a later
 * receipt was committed (`rev`, meta.rev now).
 */
export function recapStale(recap, { at = null, rev = null } = {}) {
    if (!recap) return false;
    if (isInt(at) && isInt(recap.at)) return at >= recap.at + 2;
    if (isInt(rev) && isInt(recap.rev)) return rev > recap.rev;
    return false;
}

/** Whether `time.settle` has anything to do on `state` (the beforeGenerate check). */
export function needsSettle(state, { calendar, settings, at = null, met = () => false } = {}) {
    const director = state?.domains?.director;
    const now = director?.time?.minutes;
    if (!director || !isInt(now)) return false;
    const checked = slotValue(director.checked);
    if (!checked || checked.minutes !== now) return true;
    if (recapStale(slotValue(director.recap), { at, rev: state?.meta?.rev ?? null })) return true;
    if (!settings?.lapses) return false;
    const claims = state?.meta?.claims ?? {};
    return standing(director, { calendar, now, met, claimed: key => Boolean(claims[key]) }).lapses.length > 0;
}

// What the receipt tells about a closed thread (before it closed).
function closedEntry(thread, reason) {
    const fields = thread.fields ?? {};
    return {
        id: thread.id, key: thread.key, kind: thread.kind, reason,
        on: String(fields.on || fields.due || ''), giver: String(fields.giver ?? ''), due: String(fields.due ?? ''),
    };
}

/**
 * Settles the story clock on `director` (a draft): closes what time ran past (each under its
 * claim), marks what is overdue and due, makes or clears the While away recap, and records
 * the check. `claim(key)` takes a claim (false when it is already taken); `within(id)` is told each
 * thread it closes (the command marks its writes there, ctx.ifThere). Returns
 * `{ closed, standing, recap, from, now }`.
 */
export function settle(director, { calendar, settings, rev, at = null, claim, within = () => {}, met = () => false, fights = true }) {
    const now = director.time.minutes;
    const before = slotValue(director.checked);
    const from = isInt(before?.minutes) ? before.minutes : null;
    const plan = standing(director, { calendar, now, met, lapse: settings.lapses });
    const closed = [];
    for (const { id, reason } of plan.lapses) {
        const thread = director.threads[id];
        if (!thread || thread.status !== 'active') continue;
        if (!claim(claimKey(id))) continue;
        within(id);
        closed.push(closedEntry(thread, reason));
        thread.status = 'resolved';
        thread.offer = false;
        thread.ended = { rev, reason, outcome: LAPSE_OUTCOME };
        thread.rev = rev;
        // The tracker's own bookkeeping of when a thread closed (its reply count and the time).
        thread.track = { ...(thread.track ?? {}), closed: { turn: director.turn?.n ?? null, time: now } };
    }

    // The recap: a new one when the clock moved, else the one there was until a later reply.
    let recap = slotValue(director.recap);
    if (from !== now) recap = null;
    else if (recapStale(recap, { at, rev })) recap = null;
    if (from !== null && from !== now) {
        const built = buildRecap(director, { calendar, from, to: now, minMinutes: settings.recapHours * 60, fights });
        if (built) recap = { fromMinutes: from, toMinutes: now, lines: built.lines, threads: built.threads, rev, at };
    }
    // Both are slots (../slot.js): written whole, so a later settle never depends on an earlier one.
    if (recap !== null || director.recap !== undefined) director.recap = toSlot(recap);

    const lapsed = closed.map(entry => entry.id);
    director.checked = toSlot({ minutes: now, rev, lapsed, overdue: plan.overdue, pay: plan.pay, due: plan.due });
    return { closed, standing: plan, recap, from, now };
}

/** The settle receipt's summary for `closed` ('' when nothing closed). */
export function settleSummary(closed, { calendar, now }) {
    return lapseSummary(closed, { calendar, now, reasons: REASONS });
}
