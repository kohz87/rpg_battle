// Story Director v2, tracker part: the `director` domain's shape, validator and queries (pure).
//
// director = {
//   time:    { minutes: null | int },             // story clock on the reader's calendar (a counter: moves keep `was`)
//   threads: { [id]: thread },                    // MODULES §C1
//   keys:    { [lineKey(key) or alias]: id },
//   problems:{ ["<rev>.<n>"]: { rev, turn, kind, text, … } }, // the newest 100 kept, 50 shown
//   (a quest thread may also carry `ready: { rev }`, F83, an older chat's offer `shown: { turn }`, F88, and a
//   legacy reward owed `owed: { text, rev, units?, credit?, total?, paid?: { [rev]: amount } }`, read-only history)
//   turn:    { n, now: null | [{ reply, index, from, quests, lone, added, vouched, words?, paid, pending?, refused?, intent?, met? }] },
//   checked: null | [{ minutes, rev, lapsed, overdue, pay, due }],   // the time part's last settle
//   recap:   null | [{ fromMinutes, toMinutes, lines, threads, rev, at }], // its While away recap
//   initiative: null | [{ at, round, key, name, recent: [{ key, round }] }], // NPC initiative's last pick (initiative.js)
// }
// `turn` is this part's own: v1's rules count replies (`n`; a record changed in the last three
// replies is relevant; a `- hook` beside the `+ quest` of the same reply is not an ending), and
// capture hands lines over one at a time, so what the reply being read has done so far is kept in
// `now`: the reply, the line last read, the clock when it began, its new quests, its one lone quest,
// how many threads it added, and the one quest it turned in on the story's word alone (`vouched`, a
// thread id, which the quests part marks; B-b3-r2-5) and what its quest turn-ins paid of rewards the
// story wrote (`paid`, the quests part's per-reply tally; RX-E-1), and the quests the story turned in
// that wait for where the reply ends up (`pending`, thread ids; quest-lines.js), only once there is one,
// and the ones refused by the place alone at the end of the reply, which a Continue of the same reply
// may still pay (`refused`: [{ id, problem: the refusal's problem key, ready: whether it set `ready` }]),
// the quests turned in on the story's word when the reader allows more than one a reply (`words`, ids),
// and the quests a line of the reply spoke of as turned in without closing them (`intent`, ids), which the
// afterCapture step may turn in from where things stand (quests/index.js quest.autoTurnIns), and the quests
// the story said were met in this reply (`met`, ids: a delivery goal met at the giver is handed in there).
// Later replies never write inside what an earlier reply wrote (B-b1r2-12): `turn.now` is a slot
// (../slot.js), written whole at a path that is always there; a problem is added under its own key (the
// receipt's rev and its number in that receipt) and never changed, and the oldest past PROBLEM_ROOM are
// removed (Story Block 2.0.0-alpha.2 passes over the removal of a key a deleted reply had made). Readers
// order problems by rev and number.

import { threadProjection } from './thread-writes.js';
import { hashJson } from './hash.js';
import { closed, cursor, hash, map, minute, recordId, source, validQuest } from './quest-shape.js';
import { lineKey } from '../../changes.js';
import { slotIn, slotValue, toSlot } from '../slot.js';
import { OUTCOMES, THREAD_KINDS, orderedThreads } from './convert.js';
import { calendarConfig, calendarOf, packCalendarOf, settingsFrom } from './time.js';
import { initiativeErrors } from './initiative.js';

export const PROBLEM_LIMIT = 50;
/** How many problems are kept; the newest PROBLEM_LIMIT are shown. */
export const PROBLEM_ROOM = 2 * PROBLEM_LIMIT;
// The most the validator lets the list hold (a replay after a delete never adds more than were kept).
const PROBLEM_CEILING = 2 * PROBLEM_ROOM;
const PROBLEM_KEY = /^(\d+)\.(\d+)$/;
const THREAD_ID = /^th_[0-9a-z]{8}$/;
const TARGET_KINDS = ['foes', 'items'];

export function initialDirector() {
    return {
        time: { minutes: null },
        threads: {},
        keys: {},
        writes: {},
        problems: {},
        turn: { n: 0, now: null },
        // The time part's last settle and its While away recap (slots, time/settle.js).
        checked: null,
        recap: null,
        // NPC initiative's last pick (a slot, initiative.js); an older chat has none (read as null).
        initiative: null,
    };
}

/** What the reply being read has done so far (a blank before its first line). */
export function replyTurn(director) {
    const turn = director?.turn;
    // An older state kept these on `turn` itself.
    const now = isRecord(turn) && Object.hasOwn(turn, 'now') ? slotValue(turn.now) : isRecord(turn) && Object.hasOwn(turn, 'quests') ? turn : null;
    return {
        reply: now?.reply ?? null,
        index: isInt(now?.index) ? now.index : -1,
        from: isInt(now?.from) ? now.from : null,
        quests: Array.isArray(now?.quests) ? now.quests : [],
        lone: isRecord(now?.lone) ? now.lone : null,
        added: isInt(now?.added) ? now.added : 0,
        vouched: typeof now?.vouched === 'string' ? now.vouched : null,
        paid: isInt(now?.paid) && now.paid > 0 ? now.paid : 0,
        pending: Array.isArray(now?.pending) ? now.pending.filter(id => typeof id === 'string' && id) : [],
        refused: Array.isArray(now?.refused) ? now.refused.filter(entry => isRecord(entry) && typeof entry.id === 'string' && entry.id) : [],
        // The first story's-word turn-in (`vouched`) and the others the reader's limit let through (`words`).
        words: [...new Set([now?.vouched, ...(Array.isArray(now?.words) ? now.words : [])].filter(id => typeof id === 'string' && id))],
        intent: Array.isArray(now?.intent) ? now.intent.filter(id => typeof id === 'string' && id) : [],
        // The quests the story said were met in this reply (`met: yes` that set `ready`).
        met: Array.isArray(now?.met) ? now.met.filter(id => typeof id === 'string' && id) : [],
    };
}

/** The reply count (`turn.n`, v1's message number), 0 before any. */
export const turnNumber = director => (isInt(director?.turn?.n) && director.turn.n >= 0 ? director.turn.n : 0);

/** Starts the next reply's bookkeeping on a draft: `turn.n` one up, `now` fresh. Returns `now`. */
export function startReply(director, { reply, index }) {
    const now = { reply, index, from: director.time?.minutes ?? null, quests: [], lone: null, added: 0, vouched: null, paid: 0 };
    director.turn = { n: turnNumber(director) + 1, now: toSlot(now) };
    return director.turn.now[0];
}

/**
 * The reply being read's bookkeeping on a draft, to change in place (written whole: a slot), or null
 * before its first line. An older state's bare `turn` is moved into the slot first.
 */
export function replyDraft(director) {
    const turn = director?.turn;
    if (!isRecord(turn)) return null;
    if (!Object.hasOwn(turn, 'now')) {
        if (!Object.hasOwn(turn, 'quests')) return null;
        director.turn = { n: turnNumber(director), now: toSlot({ ...replyTurn(director) }) };
        return director.turn.now[0];
    }
    return slotIn(director.turn, 'now');
}

// [rev, number] of a problem key, for ordering.
const keyOrder = key => {
    const match = PROBLEM_KEY.exec(key);
    return match ? [Number(match[1]), Number(match[2])] : [-1, -1];
};
const byKey = (a, b) => {
    const [x, y] = [keyOrder(a), keyOrder(b)];
    return x[0] - y[0] || x[1] - y[1] || (a < b ? -1 : a > b ? 1 : 0);
};

/** The problems kept, oldest first (an older state's list as it is). */
export function problemList(director) {
    const problems = director?.problems;
    if (Array.isArray(problems)) return problems.filter(isRecord);
    if (!isRecord(problems)) return [];
    return Object.keys(problems).sort(byKey).map(key => problems[key]).filter(isRecord);
}

/**
 * Adds a problem to the Director's list (a draft): under a key of its own, so it is one `add` that
 * never depends on another reply's; past PROBLEM_ROOM the oldest go. Returns its key.
 */
export function addProblem(director, ctx, problem) {
    const rev = Number.isSafeInteger(ctx?.rev) ? ctx.rev : 0;
    const entry = { rev, turn: turnNumber(director), ...problem };
    for (const name of Object.keys(entry)) if (entry[name] === undefined) delete entry[name];
    // An older state's list is keyed once (the whole list is written then).
    if (!isRecord(director.problems)) {
        const old = problemList(director).slice(-PROBLEM_ROOM);
        director.problems = Object.fromEntries(old.map((item, n) => [`${isInt(item.rev) ? item.rev : 0}.${n}`, item]));
    }
    let n = 0;
    while (Object.hasOwn(director.problems, `${rev}.${n}`)) n += 1;
    director.problems[`${rev}.${n}`] = entry;
    const keys = Object.keys(director.problems);
    if (keys.length > PROBLEM_ROOM) for (const key of keys.sort(byKey).slice(0, keys.length - PROBLEM_ROOM)) delete director.problems[key];
    return `${rev}.${n}`;
}

/** Removes the problems `drop(problem)` says have gone (a draft). */
export function dropProblems(director, drop) {
    if (Array.isArray(director.problems)) {
        director.problems = director.problems.filter(problem => !drop(problem));
        return;
    }
    for (const [key, problem] of Object.entries(director.problems ?? {})) if (isRecord(problem) && drop(problem)) delete director.problems[key];
}

const isInt = value => Number.isSafeInteger(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function threadErrors(id, thread) {
    const errors = [];
    const at = `director.threads.${id}`;
    if (!isRecord(thread)) return [`${at} is not a thread.`];
    if (!THREAD_ID.test(id) || thread.id !== id) errors.push(`${at} has a bad id.`);
    if (!THREAD_KINDS.includes(thread.kind)) errors.push(`${at} has an unknown kind "${thread.kind}".`);
    if (typeof thread.key !== 'string' || !lineKey(thread.key)) errors.push(`${at} has no key.`);
    if (typeof thread.summary !== 'string') errors.push(`${at}.summary is not text.`);
    if (!isRecord(thread.fields) || Object.values(thread.fields).some(value => typeof value !== 'string')) errors.push(`${at}.fields must hold text.`);
    if (!['active', 'resolved'].includes(thread.status)) errors.push(`${at}.status must be active or resolved.`);
    if (typeof thread.offer !== 'boolean') errors.push(`${at}.offer must be true or false.`);
    if (thread.taken !== null && !(isRecord(thread.taken) && isInt(thread.taken.rev))) errors.push(`${at}.taken must be null or { rev }.`);
    if (thread.ended !== null && !(isRecord(thread.ended) && isInt(thread.ended.rev) && typeof thread.ended.reason === 'string' && OUTCOMES.includes(thread.ended.outcome))) {
        errors.push(`${at}.ended must be null or { rev, reason, outcome }.`);
    }
    if ((thread.status === 'resolved') !== (thread.ended !== null)) errors.push(`${at} is ${thread.status} but ended is ${thread.ended ? 'set' : 'empty'}.`);
    const target = thread.target;
    if (target !== null && !(isRecord(target) && typeof target.noun === 'string' && isInt(target.count) && target.count >= 0 && TARGET_KINDS.includes(target.kind))) {
        errors.push(`${at}.target must be null or { noun, count, kind }.`);
    }
    const reward = thread.reward;
    if (reward !== null && !(isRecord(reward) && (reward.amount === null || (isInt(reward.amount) && reward.amount >= 0))
        && typeof reward.each === 'boolean' && typeof reward.unit === 'string' && typeof reward.text === 'string')) {
        errors.push(`${at}.reward must be null or { amount, each, unit, text }.`);
    }
    if (!isInt(thread.rev) || thread.rev < 0) errors.push(`${at}.rev must be a whole number.`);
    // F83: the story said the goal is met; F88 (older chats): the reply an offer was shown from.
    if (thread.ready !== undefined && thread.ready !== null && !(isRecord(thread.ready) && isInt(thread.ready.rev))) errors.push(`${at}.ready must be null or { rev }.`);
    if (thread.shown !== undefined && !(isRecord(thread.shown) && isInt(thread.shown.turn) && thread.shown.turn >= 0)) errors.push(`${at}.shown must be { turn }.`);
    if (thread.track !== undefined && !isRecord(thread.track)) errors.push(`${at}.track must be an object.`);
    // Legacy reward history: retained bytes, never an SD payout path.
    const owed = thread.owed;
    if (owed !== undefined) {
        const amount = value => value === undefined || (isInt(value) && value >= 0);
        if (!(isRecord(owed) && typeof owed.text === 'string' && isInt(owed.rev) && amount(owed.units) && amount(owed.credit) && amount(owed.total)
            && (owed.paid === undefined || (isRecord(owed.paid) && Object.values(owed.paid).every(value => isInt(value) && value >= 0))))) {
            errors.push(`${at}.owed must be { text, rev, units?, credit?, total?, paid? }.`);
        }
    }
    if (thread.acceptance !== undefined && thread.acceptance !== null) {
        const a = thread.acceptance;
        if (!closed(a, ['source', 'cursor', 'minute', 'proof']) || !source(a.source) || !cursor(a.cursor) || !minute(a.minute) || !recordId(a.proof)) errors.push(`${at}.acceptance is invalid.`);
    }
    if (thread.rpg !== undefined && !validQuest(thread.rpg)) errors.push(`${at}.rpg is invalid.`);
    return errors;
}

/** `validate(slice, state) → string[]` (SPEC §2.5). */
export function validateDirector(slice) {
    if (!isRecord(slice)) return ['director is not an object.'];
    const errors = [];
    const minutes = slice.time?.minutes;
    if (!isRecord(slice.time) || !(minutes === null || isInt(minutes))) errors.push('director.time.minutes must be null or whole minutes.');
    if (!isRecord(slice.threads)) errors.push('director.threads is not an object.');
    else for (const [id, thread] of Object.entries(slice.threads)) errors.push(...threadErrors(id, thread));
    if (!isRecord(slice.keys)) errors.push('director.keys is not an object.');
    else {
        for (const [name, id] of Object.entries(slice.keys)) {
            if (!Object.hasOwn(slice.threads ?? {}, id)) errors.push(`director.keys["${name}"] points at no thread.`);
        }
        for (const thread of Object.values(slice.threads ?? {})) {
            if (thread?.key && thread.status === 'active' && slice.keys[lineKey(thread.key)] !== thread.id) errors.push(`"${thread.key}" is missing from director.keys.`);
        }
    }
    if (slice.writes !== undefined && (!map(slice.writes) || Object.entries(slice.writes).some(([id, entry]) => !recordId(id)
        || !closed(entry, ['fingerprint', 'result']) || !hash(entry.fingerprint) || !map(entry.result)))) errors.push('director.writes is invalid.');
    const problems = slice.problems;
    const badProblem = problem => !isRecord(problem) || typeof problem.kind !== 'string' || typeof problem.text !== 'string' || !isInt(problem.rev);
    if (Array.isArray(problems)) {
        // An older state's list.
        if (problems.length > PROBLEM_ROOM) errors.push(`director.problems must be a list of at most ${PROBLEM_ROOM}.`);
        else if (problems.some(badProblem)) errors.push('director.problems entries need rev, kind and text.');
    } else if (!isRecord(problems) || Object.keys(problems).length > PROBLEM_CEILING || Object.keys(problems).some(key => !PROBLEM_KEY.test(key))) {
        errors.push(`director.problems must hold at most ${PROBLEM_CEILING} problems under "<rev>.<n>" keys.`);
    } else if (Object.values(problems).some(badProblem)) {
        errors.push('director.problems entries need rev, kind and text.');
    }
    const turn = slice.turn;
    const legacy = isRecord(turn) && !Object.hasOwn(turn, 'now');
    const now = legacy ? turn : slotValue(turn?.now);
    if (!isRecord(turn) || !isInt(turn.n) || turn.n < 0
        || (legacy ? !Array.isArray(turn.quests) : !(turn.now === null || (Array.isArray(turn.now) && turn.now.length === 1 && isRecord(now))))
        || (now && (!Array.isArray(now.quests) || !(now.from === null || isInt(now.from)) || !(now.lone === null || isRecord(now.lone))))) {
        errors.push('director.turn is malformed.');
    }
    errors.push(...initiativeErrors(slice));
    return errors;
}

// Plain copies: nothing a caller changes reaches the state.
const copy = value => structuredClone(value);
const plain = thread => {
    const { track: _track, ...rest } = thread;
    return copy(rest);
};

// The chat's calendar for a query: the tracker's settings as module.js hands them to its queries
// (`tools.settings()`, defaults without it) and the packs' calendar through `tools.query`.
function queryCalendar(tools) {
    const settings = settingsFrom(typeof tools?.settings === 'function' ? tools.settings() : null);
    return { settings, pack: packCalendarOf(typeof tools?.query === 'function' ? tools.query : null) };
}

export const queries = {
    'threads.hash': (state, { thread } = {}) => {
        const found = state?.domains?.director?.threads?.[thread];
        return found ? hashJson(threadProjection(found)) : null;
    },
    /**
     * `{ minutes, text }`: the story time (null until the story sets it) and that time written on the
     * chat's calendar ("Goldwane 12, 611, 06:40 am"; '' while unset).
     */
    'director.time': (state, _args, tools) => {
        const minutes = state?.domains?.director?.time?.minutes ?? null;
        if (!Number.isInteger(minutes)) return { minutes: null, text: '' };
        const { settings, pack } = queryCalendar(tools);
        let text = '';
        try { text = calendarOf(settings, pack).format(minutes); } catch { text = ''; }
        return { minutes, text };
    },
    /**
     * The calendar the chat runs on, as plain data (calendar.js normalizeCalendar's shape: `preset`,
     * `era`, `months: [{ name, days }]`, `leapYears`, `week`, …): the reader's own, else the first
     * enabled pack's, else Gregorian. Other parts make it a calendar with calendar.js makeCalendar.
     */
    'director.calendar': (_state, _args, tools) => {
        const { settings, pack } = queryCalendar(tools);
        return calendarConfig(settings, pack);
    },
    /** Threads in tracker order, filtered by `kind`, `status` and `offer` when given. */
    'director.threads': (state, { kind = null, status = null, offer = null } = {}) => orderedThreads(state?.domains?.director)
        .filter(thread => (!kind || thread.kind === kind) && (!status || thread.status === status) && (offer === null || thread.offer === offer))
        .map(plain),
    /** One thread by `id`, or by `key` (its own or a name it was reached by), else null. */
    'director.thread': (state, { key = null, id = null } = {}) => {
        const director = state?.domains?.director;
        const found = id ? director?.threads?.[id] : director?.threads?.[director?.keys?.[lineKey(key ?? '')]];
        return found ? plain(found) : null;
    },
};
