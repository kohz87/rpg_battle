// Story Director v2, part **screens**: the view queries its screens bind to (SPEC §13.1 `data`).
//
// A template has no arithmetic, sorting or per-item queries (SPEC §13.2), so what a screen needs
// worked out ahead (which quest is the current goal, which thread comes due next, how far each
// active quest is and why Finish is off) is answered here, as plain data. Each query is built
// from the Director's own queries through `tools.query` (MODULES §F3: `director.threads`,
// `quest.progress`), so the tracker and quests parts stay the only readers of their rules, and
// it reads Story Block's `scene` (SPEC §7) from the same state. Every query runs on the state it
// is given: an inline card (mount `card`) gets that reply's state, never the head.
//
// Without `tools` (a host that cannot call queries from a query) the threads are read from the
// documented `director` layout (MODULES §C1) and progress is left out.
//
// The calendar (for "what comes due next") is the chat's: the tracker's `director.calendar` query (the
// reader's, else the enabled pack's, else Gregorian); without it the tracker part's calendar setting,
// read through an injected settings function (by default Story Block's `sdk.settings('story-director')`).

import { PRESETS, makeCalendar, normalizeCalendar } from '../../calendar.js';
import { lineKey } from '../../changes.js';
import { problemList } from '../tracker/domain.js';
import { BEHIND, BEHIND_KINDS } from './reveal.js';

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Fields that hold a date the story can reach (v1 relevance.js DATE_FIELDS).
const DATE_FIELDS = ['due', 'on', 'arrive'];
// The problems the Director screen shows (the tracker's PROBLEM_LIMIT).
const PROBLEM_SHOWN = 50;
export const FINISHED_SHOWN = 20;

/** A `query(name, args)` from the tools a host passes (MODULES §F3), or null. */
function queryFrom(tools) {
    if (typeof tools?.query === 'function') return tools.query;
    if (typeof tools === 'function') return tools;
    return null;
}

function ask(query, name, args, fallback) {
    if (!query) return fallback;
    try {
        const value = query(name, args);
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

/** Threads as `director.threads` gives them (tracker order), else read from the state. */
function threadsOf(state, query, args = {}) {
    const listed = ask(query, 'director.threads', args, null);
    if (Array.isArray(listed)) return listed;
    const director = state?.domains?.director;
    const { kind = null, status = null } = args;
    return Object.values(isRecord(director?.threads) ? director.threads : {})
        .filter(thread => isRecord(thread) && (!kind || thread.kind === kind) && (!status || thread.status === status))
        .sort((a, b) => (a.track?.order ?? 0) - (b.track?.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const isOpen = thread => thread.status === 'active' && !thread.ended;
const isOffer = thread => isOpen(thread) && Boolean(thread.offer) && !thread.taken;

// ---------------------------------------------------------------------------------------------------
// The current goal

/**
 * `director.goal` → the active quest touched most recently (highest `rev`; the tracker's order breaks
 * a tie), not an open offer: `{ id, key, goal, step, giver, due, taken }`, or null.
 */
export function currentGoal(state, args, tools) {
    const quests = threadsOf(state, queryFrom(tools), { status: 'active' }).filter(thread => isOpen(thread) && !isOffer(thread)
        && (thread.kind === 'quest' || thread.rpg || thread.acceptance));
    let best = null;
    for (const thread of quests) if (!best || (thread.rev ?? 0) > (best.rev ?? 0)) best = thread;
    if (!best) return null;
    const fields = best.fields ?? {};
    return {
        id: best.id,
        key: text(best.key),
        goal: text(fields.goal) || text(best.summary),
        step: text(fields.step),
        giver: text(fields.giver),
        due: text(fields.due),
        taken: Boolean(best.taken),
    };
}

// ---------------------------------------------------------------------------------------------------
// What comes due next

// The tracker part's calendar setting, either as that part reads it (`{ calendar: {…} }`) or as the
// module's settings hold it, namespaced by part and flattened (`'tracker.calendar.months': […]`,
// src/v2/module.js). Null when neither is there.
const CALENDAR_PREFIX = 'tracker.calendar.';
export function calendarSetting(values) {
    if (!isRecord(values)) return null;
    if (isRecord(values.calendar)) return values.calendar;
    const flat = Object.entries(values).filter(([key]) => key.startsWith(CALENDAR_PREFIX));
    return flat.length ? Object.fromEntries(flat.map(([key, value]) => [key.slice(CALENDAR_PREFIX.length), value])) : null;
}

// The chat's calendar: the tracker's `director.calendar` (the reader's, else the pack's, else Gregorian)
// when a query can ask it, else the setting itself.
function calendarFrom(settings, query = null) {
    const config = ask(query, 'director.calendar', {}, null);
    if (isRecord(config)) {
        try { return makeCalendar(config); } catch { /* the setting below */ }
    }
    try {
        const value = typeof settings === 'function' ? settings() : settings;
        return makeCalendar(normalizeCalendar(calendarSetting(value) ?? PRESETS.gregorian));
    } catch {
        return makeCalendar(normalizeCalendar(PRESETS.gregorian));
    }
}

// A date without a clock time counts for its whole day (v1 relevance.js reachedBy).
function reached(parsed, now, calendar) {
    if (!Number.isInteger(now)) return false;
    if (!parsed.hasTime) return calendar.dayIndex(parsed.abs) <= calendar.dayIndex(now);
    return parsed.abs <= now;
}

/**
 * `director.next` → the open thread whose date (`due`, `on` or `arrive`, read on the reader's calendar
 * from the story time) comes first: `{ id, key, kind, summary, field, when, at, reached }`, or null.
 * `reached` is true once that date has come (it is due now or overdue). Secrets are never due.
 */
export function nextDue(state, args, tools, { settings = null } = {}) {
    const query = queryFrom(tools);
    // `shown: true` (the card under each reply): while behind the scenes is hidden, only what the reader
    // may see (quests, hooks, world events) is named there.
    const hide = args?.shown === true && hidingBehind(tools);
    const threads = threadsOf(state, query, { status: 'active' }).filter(thread => isOpen(thread) && thread.kind !== 'secret' && !(hide && BEHIND.has(thread.kind)));
    if (!threads.length) return null;
    const calendar = calendarFrom(settings, query);
    const minutes = state?.domains?.director?.time?.minutes;
    const now = Number.isInteger(minutes) ? minutes : null;
    let best = null;
    for (const thread of threads) {
        for (const field of DATE_FIELDS) {
            const when = text(thread.fields?.[field]);
            if (!when) continue;
            let parsed = null;
            try {
                parsed = calendar.parse(when, { reference: now });
            } catch {
                parsed = null;
            }
            if (!parsed || !Number.isFinite(parsed.abs)) continue;
            const at = Math.round(parsed.abs);
            if (!best || at < best.at) best = { thread, field, when, at, parsed };
        }
    }
    if (!best) return null;
    const { thread, field, when, at, parsed } = best;
    return {
        id: thread.id,
        key: text(thread.key),
        kind: thread.kind,
        summary: text(thread.summary),
        field,
        when,
        at,
        reached: reached(parsed, now, calendar),
    };
}

// ---------------------------------------------------------------------------------------------------
// The quest board

/**
 * Whether Finish could be pressed now: `{ show, blocked, reason }`, for a pack's or card's own Finish button
 * (the default Quests screen draws none: turn-ins follow the story, F95). Shown when code can count the
 * quest's target or the quest's goal is one the story judges (F83); blocked, with the reason in plain
 * words, until it is taken on and its target is met (or the story said its goal is met), then by
 * `quest.progress`'s own `finish: { ok, reason }` (the quests part's rule, place included, which
 * `quest.finish` checks again). Without `finish` (an older quests part) the place is left to `quest.finish`.
 */
export function finishState(thread, progress) {
    if (!progress || !(progress.need > 0 || isRecord(progress.finish))) return { show: false, blocked: true, reason: '' };
    let reason = '';
    if (!thread.taken) reason = 'It was never taken on.';
    else if (!progress.met) reason = text(progress.reason) || 'Not done yet.';
    else if (isRecord(progress.finish) && progress.finish.ok === false) reason = text(progress.finish.reason) || 'It cannot be turned in here.';
    return { show: true, blocked: Boolean(reason), reason };
}

const OUTCOME_TEXT = Object.freeze({ done: 'Done', failed: 'Failed', abandoned: 'Given up', declined: 'Turned down', superseded: 'Replaced' });
const NOTE_CHARS = 160;
const cut = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function rewardOf(thread) {
    return text(thread.reward?.text) || text(thread.fields?.reward);
}

function progressOf(query, thread) {
    const value = ask(query, 'quest.progress', { id: thread.id }, null);
    if (!isRecord(value)) return null;
    const need = Number.isSafeInteger(value.need) ? value.need : 0;
    const have = Number.isSafeInteger(value.have) ? value.have : 0;
    return {
        have,
        need,
        met: value.met === true,
        ready: value.ready === true,
        source: value.source ?? null,
        label: text(value.label) || (need > 0 ? `${have}/${need}` : ''),
        reason: text(value.reason),
        ...(isRecord(value.finish) ? { finish: { ok: value.finish.ok !== false, reason: text(value.finish.reason) } } : {}),
    };
}

// The story time written on the chat's calendar, '' when there is none.
function dateText(minutes, calendar) {
    if (!Number.isSafeInteger(minutes)) return '';
    try {
        return text(calendar.format(minutes));
    } catch {
        return '';
    }
}

// A quest's status line without the quests part's `quest.details` (F95's three words).
function plainStatus(thread, progress) {
    if (!thread.taken) return { state: 'untaken', text: 'Not taken on' };
    if (progress?.met) return { state: progress.finish?.ok === false ? 'ready' : 'here', text: progress.finish?.ok === false ? 'Ready' : 'Ready to turn in' };
    return { state: 'notyet', text: progress?.label ? `Not yet: ${progress.label}` : 'Not yet' };
}

/**
 * What a quest's details pop-up shows (F84), from the quests part's `quest.details`: `{ goal, note, giver,
 * due, rank, terms, held, owed, taken, ended, history: [{ rev, text }], hasHistory }` with the dates written on
 * the chat's calendar ('' when the story time was not set). Without `quest.details`, read from the thread.
 */
function detailsOf(thread, given, calendar) {
    const details = isRecord(given) ? given : {};
    const terms = isRecord(details.terms) ? details.terms : {};
    const history = Array.isArray(details.history) ? details.history.filter(isRecord).map(entry => ({ rev: entry.rev ?? null, text: text(entry.text) })) : [];
    return {
        goal: text(details.goal) || text(thread.fields?.goal) || text(thread.summary),
        note: cut(text(details.note) || text(thread.fields?.progress) || text(thread.fields?.step), NOTE_CHARS),
        giver: text(details.giver) || text(thread.fields?.giver),
        due: text(details.due) || text(thread.fields?.due),
        rank: text(details.rank?.title),
        terms: text(terms.text) || rewardOf(thread),
        held: text(terms.held),
        // A reward owed ("Reward owed: 30 copper bits (add copper bits in Settings → Coins)"), else ''.
        owed: text(details.owed?.text),
        taken: thread.taken ? dateText(thread.taken.at, calendar) || 'yes' : '',
        ended: thread.ended ? dateText(thread.ended.at, calendar) || 'yes' : '',
        history,
        hasHistory: history.length > 0,
    };
}

// ---------------------------------------------------------------------------------------------------
// Problems, in the reader's words

// v1's problem texts name the reader as the `{{user}}` macro. Without the host's substitution they read
// "you", with the few phrases where that changes the verb or pronoun put right.
const YOU = [
    [/\{\{user\}\}'s choice, and their message/gi, 'your choice, and your message'],
    [/\{\{user\}\} accepts/gi, 'you accept'],
    [/\{\{user\}\}'s/gi, 'your'],
    [/\{\{user\}\}/gi, 'you'],
];
export function readerWords(value, substitute = null) {
    let out = String(value ?? '');
    if (typeof substitute === 'function' && out.includes('{{')) {
        try {
            const named = substitute(out);
            if (typeof named === 'string') out = named;
        } catch { /* "you" below */ }
    }
    for (const [pattern, words] of YOU) out = out.replace(pattern, words);
    return out;
}

// A Problem about a passing state of a quest is shown only while that state lasts: "has no goal" while it
// is open with no goal (the quests part's `quest.details` says; without it, a `goal:` field). An older
// chat's "was offered, not taken on" is not shown: there is nothing to accept any more.
function stillSo(problem, director, query) {
    if (problem.kind === 'offered') return false;
    if (problem.kind !== 'no-goal') return true;
    const id = director?.keys?.[lineKey(text(problem.key))];
    const thread = id ? director?.threads?.[id] : null;
    if (!thread) return true;
    if (!isOpen(thread)) return false;
    const details = ask(query, 'quest.details', { id: thread.id }, null);
    return isRecord(details) && typeof details.hasGoal === 'boolean' ? !details.hasGoal : !text(thread.fields?.goal);
}

/**
 * `director.problems` → the last replies' Director problems, oldest first as kept: `[{ rev, kind, text }]`,
 * the text with `{{user}}` written out (the host's `tools.substitute` when there is one, else "you"). A
 * Problem about a missing goal is left out once the quest is given a goal or over; one about an offer, always.
 */
export function problemsList(state, args, tools) {
    const director = state?.domains?.director;
    const problems = problemList(director);
    const substitute = typeof tools?.substitute === 'function' ? tools.substitute : null;
    const query = queryFrom(tools);
    // `behind: true` / `false`: only those about a thread behind the scenes, or only the others.
    const behind = typeof args?.behind === 'boolean' ? args.behind : null;
    // The newest PROBLEM_SHOWN: the tracker keeps more than that (domain.js PROBLEM_ROOM).
    return problems.slice(-PROBLEM_SHOWN).filter(isRecord).filter(problem => stillSo(problem, director, query))
        .filter(problem => behind === null || isBehindProblem(problem, director) === behind).map(problem => ({
        rev: problem.rev ?? null,
        kind: text(problem.kind),
        text: readerWords(problem.text, substitute),
    }));
}

// ---------------------------------------------------------------------------------------------------
// Behind the scenes (reveal.js)

/** Whether the reader hides behind the scenes (the part's `hideBehind` setting; on unless set off). */
export function hidingBehind(tools) {
    try {
        return typeof tools?.settings === 'function' ? tools.settings()?.hideBehind !== false : true;
    } catch {
        return true;
    }
}

/** Whether a Director problem is about a thread behind the scenes (its key names an agenda, beat, clock or secret). */
export function isBehindProblem(problem, director) {
    const key = lineKey(String(problem?.key ?? ''));
    const keys = isRecord(director?.keys) ? director.keys : {};
    if (!key || !Object.hasOwn(keys, key)) return false;
    const threads = isRecord(director?.threads) ? director.threads : {};
    const id = keys[key];
    return Object.hasOwn(threads, id) && BEHIND.has(threads[id]?.kind);
}

// A thread as the behind-the-scenes list shows it; a secret by its name alone.
function behindThread(thread) {
    if (thread.kind === 'secret') return { id: thread.id, key: text(thread.key), summary: '', fields: {}, ended: null };
    const fields = {};
    for (const name of ['now', 'then', 'on', 'due', 'place', 'reach', 'shown']) if (text(thread.fields?.[name])) fields[name] = text(thread.fields[name]);
    return { id: thread.id, key: text(thread.key), summary: text(thread.summary), fields, ended: thread.ended ? { outcome: text(thread.ended.outcome) } : null };
}

/**
 * `director.behind` → `{ kinds: [{ kind, title, open, closed }], problems, open, total }`: the threads behind
 * the scenes (agendas, clocks, beats, secrets: open ones and the closed ones), the problems about them, and
 * how many there are, for the Reveal panel (widget `story-director.behind`).
 */
export function behindView(state, args, tools) {
    const query = queryFrom(tools);
    const kinds = BEHIND_KINDS.map(([kind, title]) => ({
        kind,
        title,
        open: threadsOf(state, query, { kind, status: 'active' }).filter(isRecord).map(behindThread),
        closed: threadsOf(state, query, { kind, status: 'resolved' }).filter(isRecord).map(behindThread),
    })).filter(group => group.open.length || group.closed.length);
    const open = kinds.reduce((sum, group) => sum + group.open.length, 0);
    const total = kinds.reduce((sum, group) => sum + group.open.length + group.closed.length, 0);
    return { kinds, problems: problemsList(state, { behind: true }, tools), open, total };
}

/** The part's queries; `settings` is the module's settings (a function or an object). */
const COORD_LIMIT = 1e7;
const WEATHER_CHARS = 80;

// A map coordinate as the card writes it: whole map units, '' when not a usable number.
const coordText = value => (Number.isFinite(value) && Math.abs(value) < COORD_LIMIT ? String(Math.round(value)) : '');

/**
 * `director.status` → what the reply's Status card adds to Story Block's scene, all of it {{user}}'s own
 * (world/known.js: where they are, and the weather they stand in): `{ coords, weather }`.
 * `coords`: the scene's place on the map ("59, 110", map units: the atlas's or the pack's map data),
 * '' when the atlas does not know the place or has no position for it. `weather`: Story Block's
 * `scene.weather` (`{ text } | null`, the story's `~ weather <text>` line), '' when there is none or that
 * query is not there. Read on the state it is given, so each reply's card shows its own.
 */
export function statusExtras(_state, _args, tools) {
    const query = queryFrom(tools);
    const here = ask(query, 'atlas.here', {}, null);
    const place = isRecord(here) && text(here.id) ? ask(query, 'atlas.place', { id: here.id }, null) : null;
    const [x, y] = [coordText(place?.x), coordText(place?.y)];
    const weather = ask(query, 'scene.weather', {}, null);
    return {
        coords: x && y ? `${x}, ${y}` : '',
        weather: isRecord(weather) ? cut(text(weather.text), WEATHER_CHARS) : '',
    };
}

export function screenQueries({ settings = null } = {}) {
    return {
        'director.behind': (state, args, tools) => behindView(state, args, tools),
        'director.goal': (state, args, tools) => currentGoal(state, args, tools),
        'director.next': (state, args, tools) => nextDue(state, args, tools, { settings }),
        'director.problems': (state, args, tools) => problemsList(state, args, tools),
        'director.status': (state, args, tools) => statusExtras(state, args, tools),
    };
}
