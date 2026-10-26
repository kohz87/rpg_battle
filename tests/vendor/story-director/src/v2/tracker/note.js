// Story Director v2, tracker part: what the model is told (pure).
//
// static: the Director's change-line rules, the same bytes every reply of every chat (SPEC §5):
// v1's field rules and Pacing, word for word, under v2's `<Changes>` envelope (the host writes
// the block's header and each kind's one-line grammar).
// tail: v1's Director note (note.js) for this reply: the story time and place, what is due and
// arriving, the relevant threads one line per kind, what not to reveal, corrections for the
// last reply's lines, and the quest checks (a quest that reads finished, one the reader's message
// gives up, takes on or turns down). Built by v1's noteParts within this part's budget.
// What can happen now comes first (scene.js): the kind lines list only the threads that fit the
// scene, then one Initiative line (initiative.js, feature `story-director.initiative`), then, while
// the budget has room, at most `tracker.elsewhere` (2) other threads {{user}} knows of, by name only.

import { CHANGE_INSTRUCTION, PACING, noteHeader, noteParts, tailNote } from '../../note.js';
import { classify, estimateTokens } from '../../relevance.js';
import { givenUpIn, offersChosenIn, untrackedCorrections } from '../../tracker.js';
import { orderedThreads, toTracker } from './convert.js';
import { problemList } from './domain.js';
import { calendarOf, packCalendarOf, settingsFrom } from './time.js';
import { elsewhereCap, elsewhereItem, elsewhereLine, knownToUser, sceneOf, splitByScene } from './scene.js';
import { initiativeTail } from './initiative.js';

export const TAIL_BUDGET = 500;
/**
 * The most relevant threads the tail lists, at most (B-b1-capture-13). v1's note drops threads from the
 * end until it fits its budget, building the note again each time, so with hundreds of threads every
 * reply paid for all of them; 40 short ones already fill the budget.
 */
export const TAIL_THREADS = 40;
/**
 * How long an open thread may go untouched (replies with Director lines since it was last seen or
 * changed) before the tail stops reading it (B-b1r2-8), unless it has a date, is a quest the reader
 * took on, is pinned, is a secret, or the reader's message or the scene's place names it. v1 already
 * shelves such a thread after 15 quiet replies; this only keeps the work per reply with the live ones.
 */
export const IDLE_REPLIES = 60;
// Ended threads are read for this many replies after (v1's "resolved recently", relevance.js).
const ENDED_REPLIES = 5;
const DATED = ['due', 'on', 'arrive'];

const V1_LINES = CHANGE_INSTRUCTION.split('\n');
// v1's Fields line without its offers (one deliberate change, 2.0.0-alpha.1): the story's `+ quest` is the
// acceptance, so a job only offered is no hook with a giver and reward; it stays in the story.
const FIELDS_LINE = V1_LINES.find(line => line.startsWith('Fields:')).replace('; a job only offered: + hook with giver, reward', '');
const WRITE_ONLY_LINE = V1_LINES.find(line => line.startsWith('Write only changes'));

// Story Director alone (WAVE rule 11, B-rxui-7): with no module that runs fights, the fields name no
// encounter. A written `encounter:` is still kept on its thread as plain data; it is just not told.
const FIELDS_ALONE = FIELDS_LINE.replace(', encounter;', ';');

/**
 * The Director's part of the static prompt: no names, counts, times or dice. The same bytes for one
 * set of modules: `fights` (a module runs fights) adds the encounter field.
 */
export function staticText({ fights = true } = {}) {
    return [
        'Director lines: ~ changes only what changed; - closes it (— reason); ! fires a due item (— what happened).',
        fights ? FIELDS_LINE : FIELDS_ALONE,
        WRITE_ONLY_LINE,
        PACING,
    ].join('\n');
}

/** The static part with a fight runner there (RPG Battle), as before. */
export const STATIC_TEXT = staticText();

/** Each Director kind's one line for the change-line instruction (SPEC §4.4). */
export const GRAMMAR = Object.freeze({
    agenda: '+ agenda Name — what they are up to off-screen | now: where | then: what next | on: <date, clock time>',
    event: '+ event Name — what is happening in the world | then: what next | on: <date, clock time>',
    hook: '+ hook Name — an open thread or lead (a job only offered stays in the story; + quest once {{user}} accepts it)',
    clock: '+ clock Name — what happens when it runs out | due: <date, clock time> | shown: none|sign|warning',
    beat: '+ beat Name — a planned turn of the story | on: <date, clock time> | encounter: the foes, for a fight | reach: what it changes for {{user}}',
    secret: '+ secret Name — what must not be revealed yet',
    time: '~ time <date, clock time> (the scene\'s time) · ! time +2h (time passes)',
});

// The grammar lines Story Director alone writes (no fight runner): a beat is a turn of the story only.
export const GRAMMAR_ALONE = Object.freeze({
    beat: GRAMMAR.beat.replace(' | encounter: the foes, for a fight', ''),
});

/** A kind's grammar line for the module set: `fights: false` takes GRAMMAR_ALONE's where it has one. */
export const grammarOf = (kind, { fights = true } = {}) => (fights ? GRAMMAR[kind] : GRAMMAR_ALONE[kind] ?? GRAMMAR[kind]);

/** A v1 tracker with no record's `encounter` told (no fight runner): the field stays on the thread. */
export function withoutEncounters(tracker) {
    return { ...tracker, records: tracker.records.map(record => (record.fields?.encounter ? { ...record, fields: { ...record.fields, encounter: '' } } : record)) };
}

// All neutral instructions keep hook identity; RPG capture belongs to RB.
const v2Lines = value => value.replace(/\bquest Key\b/g, 'hook Key');

// The thread ids the time part's recap for this reply tells (empty without the time part).
function recappedIds(view) {
    if (typeof view?.query !== 'function') return new Set();
    try {
        const recap = view.query('time.recap', {});
        return new Set(Array.isArray(recap?.threads) ? recap.threads : []);
    } catch {
        return new Set();
    }
}

const lastTurn = thread => Math.max(...['created', 'changed', 'seen', 'closed', 'engaged']
    .map(name => thread.track?.[name]?.turn).filter(Number.isSafeInteger), -Infinity);

/**
 * The threads the tail reads (B-b1r2-8): ended ones only for ENDED_REPLIES replies, open ones until they
 * have been idle for IDLE_REPLIES (see there). However long the chat, the tail works on the live ones.
 */
export function tailThreads(director, { said = '', place = '' } = {}) {
    const threads = director.threads ?? {};
    const n = Number.isSafeInteger(director.turn?.n) ? director.turn.n : 0;
    const words = `${said}\n${place}`.toLowerCase();
    const keep = thread => {
        const last = lastTurn(thread);
        // A thread with no reply count (made outside a reply's lines) is read as before.
        if (last === -Infinity) return true;
        if (thread.status !== 'active') return n - last < ENDED_REPLIES;
        if (n - last < IDLE_REPLIES || thread.kind === 'secret' || thread.taken || thread.track?.pinned) return true;
        if ((thread.kind === 'quest' && !thread.offer) || DATED.some(name => String(thread.fields?.[name] ?? '').trim())) return true;
        const key = String(thread.key ?? '').toLowerCase();
        return Boolean(key) && words.includes(key);
    };
    if (Object.values(threads).every(keep)) return director;
    return { ...director, threads: Object.fromEntries(Object.entries(threads).filter(([, thread]) => keep(thread))) };
}

// The note's labels up to its kind lines: the Initiative and Elsewhere lines go right after them.
const SCENE_LABELS = new Set(['Header', 'No weekdays', 'While away', 'Due now', 'Arriving', 'Off-screen', 'World', 'Hooks', 'Quests', 'Clocks', 'Beats']);

function insertAfterKinds(parts, extra) {
    if (!extra.length) return parts;
    let at = 0;
    parts.forEach((entry, index) => { if (SCENE_LABELS.has(entry.label)) at = index + 1; });
    return [...parts.slice(0, at), ...extra, ...parts.slice(at)];
}

const joined = parts => parts.map((entry, index) => (index ? entry.join : '') + entry.text).join('');

/** `context.tail(view)` → `{ lines, optional }` (SPEC §5). */
export function directorTail(view, { budget = TAIL_BUDGET } = {}) {
    const state = view?.state;
    const stored = state?.domains?.director;
    if (!stored) return { lines: [], optional: [] };
    const said = typeof view?.chat?.lastUser === 'string' ? view.chat.lastUser : '';
    const director = tailThreads(stored, { said, place: String(state?.domains?.scene?.place?.name ?? '') });
    const settings = settingsFrom(typeof view.settings === 'function' ? view.settings() : view.settings);
    const calendar = calendarOf(settings, packCalendarOf(view.query));
    const fights = view?.fights !== false;
    const tracker = fights ? toTracker(director) : withoutEncounters(toTracker(director));
    const now = director.time?.minutes ?? null;
    const message = director.turn?.n ?? 0;
    const selection = classify(tracker, {
        calendar,
        now,
        message,
        place: String(state?.domains?.scene?.place?.name ?? ''),
        recentText: said,
        settings: { dormantReplies: settings.dormantReplies, dormantDays: settings.dormantDays, dueSoonDays: settings.dueSoonDays },
    });
    // Highest priority first: the rest would only be cut again by the budget.
    if (selection.relevant.length > TAIL_THREADS) selection.relevant = selection.relevant.slice(0, TAIL_THREADS);
    const ordered = orderedThreads(director);
    const threadOf = new Map(tracker.records.map((record, index) => [record, ordered[index]]));
    // What can happen now first: the kind lines keep the threads that fit the scene (scene.js).
    const query = typeof view.query === 'function' ? view.query : null;
    const scene = sceneOf(query, state);
    const split = splitByScene(selection.relevant, { scene, calendar, now, dueSoonDays: settings.dueSoonDays, threads: threadOf, records: tracker.records });
    selection.relevant = split.here;
    // What the While away recap (the time part's `time.recap`) tells is not repeated under Due now or
    // Arriving (v1 note.js: the recapped items leave those lines).
    const recapped = recappedIds(view);
    if (recapped.size) {
        const ids = new Map(ordered.map((thread, index) => [tracker.records[index], thread.id]));
        selection.due = selection.due.filter(record => !recapped.has(ids.get(record)));
        selection.arriving = selection.arriving.filter(record => !recapped.has(ids.get(record)));
    }
    // The last reply's lines on names not tracked, as v1 reads its problems.
    const corrections = untrackedCorrections(problemList(director)
        .filter(problem => problem.turn === message)
        .map(problem => ({ ...problem, message: problem.turn })), { message });
    // Who takes the initiative in this reply (initiative.js): its line is kept, so its room comes first.
    const initiative = initiativeTail(view, { scene });
    const initiativeCost = initiative ? estimateTokens(`\n${initiative}`) : 0;
    const instruction = staticText({ fights });
    const total = budget + estimateTokens(instruction);
    let parts = noteParts(selection, {
        calendar,
        // v1's budget counts the instruction too; here it is in the static part.
        budgetTokens: total - initiativeCost,
        corrections,
        instruction,
        givenUp: givenUpIn(tracker, said),
        taking: [],
        declining: [],
    });
    // The rest {{user}} knows of, by name, at most `elsewhere` of them, while the budget has room.
    const others = split.elsewhere.filter(entry => knownToUser(entry.record)).slice(0, elsewhereCap(settings)).map(entry => elsewhereItem(entry.record));
    const room = total - initiativeCost - estimateTokens(joined(parts));
    while (others.length && estimateTokens(`\n${elsewhereLine(others)}`) > room) others.pop();
    const extra = [
        initiative ? { label: 'Initiative', text: initiative, join: '\n' } : null,
        others.length ? { label: 'Elsewhere', text: elsewhereLine(others), join: '\n' } : null,
    ].filter(Boolean);
    // A note with nothing else in it still says when and where it is.
    if (extra.length && !parts.some(entry => entry.label === 'Header')) parts = [{ label: 'Header', text: noteHeader(selection, calendar), join: '\n' }, ...parts];
    const text = v2Lines(tailNote(insertAfterKinds(parts, extra)));
    return { lines: text ? text.split('\n') : [], optional: [] };
}
