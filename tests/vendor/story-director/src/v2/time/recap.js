// Story Director v2, part **time**: what the next reply is told about time that passed (pure).
//
// * The While away recap (v1 0.9.19, note.js and relevance.js awayIn): when the story clock
//   jumped far enough between two replies, what came due or arrived in the gap is told once, as
//   news or aftermath, in one `[While away] …` line. v1 picks the records and writes the items;
//   this part only sets the jump's length (the reader's setting) and v2's change-line forms.
// * What time closed (v1 lapses.js read back by note.js): beats that slipped, offers that
//   lapsed, in v1's words, and quests whose deadline passed, told once in the settle receipt.

import { AWAY_ARRIVAL, AWAY_DEADLINE, AWAY_RECORD, AWAY_CUE, noteParts } from '../../note.js';
import { AWAY_GAP_MINUTES, awayIn, classify, estimateTokens } from '../../relevance.js';
import { trackerOf } from './records.js';

export const RECAP_TAG = '[While away]';
// About 200 tokens: the recap gives up items from its end to stay within it.
export const RECAP_BUDGET = 200;

// v1's asks name a record bare ("! Key — …"); every v2 line names its kind.
export const AWAY_RECORD_V2 = 'Record each with ! <its kind> Key — what came of it.';
export const AWAY_ARRIVAL_V2 = 'An arrival: ~ <its kind> Key — now: where it is.';
export const AWAY_DEADLINE_V2 = 'A passed deadline: - quest Key — failed, or ~ quest Key — due: later if it still stands.';

/** v1's While away text in v2's change-line forms. */
export function v2Asks(text) {
    return String(text ?? '')
        .replace(AWAY_RECORD, AWAY_RECORD_V2)
        .replace(AWAY_ARRIVAL, AWAY_ARRIVAL_V2)
        .replace(AWAY_DEADLINE, AWAY_DEADLINE_V2);
}

const span = (calendar, from, to) => `${calendar.format(from, { era: false })} → ${calendar.format(to, { era: false })}`;

// v1's While away part for `due` and `arriving`, with the span from `from`: v1 measures its own
// twelve-hour jump, so a shorter one is handed over from twelve hours back (the records are
// already chosen, and none of them was due then either) and its span written back to `from`.
function awayText({ calendar, from, to, due, arriving, more = 0 }) {
    const back = Math.min(from, to - AWAY_GAP_MINUTES);
    const selection = { now: to, place: '', arc: null, due, arriving, relevant: [], dormant: [], secrets: [], resolvedRecently: [] };
    const part = noteParts(selection, { calendar, previousTime: back, instruction: 'v2' }).find(entry => entry.label === 'While away');
    if (!part) return '';
    const head = `While away (${span(calendar, back, to)}): `;
    if (!part.text.startsWith(head)) return '';
    let body = part.text.slice(head.length);
    if (more > 0) body = body.replace(` ${AWAY_CUE}`, ` And ${more} more. ${AWAY_CUE}`);
    return `${RECAP_TAG} ${span(calendar, from, to)}: ${v2Asks(body)}`;
}

/**
 * The While away recap for a jump of the story clock from `from` to `to` on `director` (its
 * active threads): `{ lines, threads }` (the thread ids it tells; `fights: false`: no "fought
 * off-screen", as no module runs fights), or null when the jump is
 * shorter than `minMinutes` or nothing came due or arrived in it (v1 awayIn).
 */
export function buildRecap(director, { calendar, from, to, minMinutes, budget = RECAP_BUDGET, fights = true }) {
    if (!calendar || !Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return null;
    const { tracker, threadOf } = trackerOf(director, { calendar, now: to, fights });
    const selection = classify(tracker, { calendar, now: to, message: tracker.message });
    const away = awayIn(selection, { calendar, from, to, minMinutes });
    if (!away) return null;
    const arriving = away.arriving.filter(record => !away.due.includes(record));
    let due = away.due;
    let arrivals = arriving;
    const total = due.length + arrivals.length;
    let line = awayText({ calendar, from, to, due, arriving: arrivals });
    // Over the budget: the last items go first (arrivals, then what came due), counted as more.
    while (line && estimateTokens(line) > budget && due.length + arrivals.length > 1) {
        if (arrivals.length) arrivals = arrivals.slice(0, -1);
        else due = due.slice(0, -1);
        line = awayText({ calendar, from, to, due, arriving: arrivals, more: total - due.length - arrivals.length });
    }
    if (!line) return null;
    const threads = [...due, ...arrivals].map(record => threadOf.get(record)?.id).filter(Boolean);
    return { lines: [line], threads };
}

// One item per key, in order.
function unique(entries) {
    const seen = new Set();
    return entries.filter(entry => (seen.has(entry.key) ? false : (seen.add(entry.key), true)));
}

// v1's "mention it only where it fits" for quests whose deadline passed.
function failedLine(failed, calendar, now) {
    const items = unique(failed).map(entry => {
        const due = calendar && entry.due ? calendar.withClock?.(entry.due, { reference: now }) ?? entry.due : entry.due;
        return `${entry.key}${due ? ` (by ${due})` : ''}`;
    });
    if (!items.length) return '';
    const one = items.length === 1;
    return `Failed: ${items.join(', ')} — the deadline passed and the time ran out on ${one ? 'it' : 'them'}; mention ${one ? 'it' : 'them'} only where ${one ? 'it fits' : 'they fit'}.`;
}

/**
 * What the settle receipt tells the next reply about the threads time closed: v1's Slipped
 * and Lapsed lines, and one for failed quests ('' when nothing closed). `closed` holds
 * `{ key, kind, reason, on, giver, due }` in tracker order; `reasons` names which is which.
 */
export function lapseSummary(closed, { calendar, now = null, reasons }) {
    const slipped = closed.filter(entry => entry.reason === reasons.slipped).map(entry => ({ key: entry.key, on: entry.on, giver: '' }));
    const lapsed = closed.filter(entry => entry.reason === reasons.lapsed).map(entry => ({ key: entry.key, on: '', giver: entry.giver }));
    const failed = closed.filter(entry => entry.reason === reasons.failed);
    const told = slipped.length || lapsed.length
        ? noteParts({ now: null, due: [], arriving: [], relevant: [], secrets: [] }, { calendar, instruction: '', slipped, lapsed })
            .filter(entry => entry.label === 'Slipped' || entry.label === 'Lapsed')
            .map(entry => entry.text)
        : [];
    return [...told, failedLine(failed, calendar, now)].filter(Boolean).join(' ');
}
