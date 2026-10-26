// Genre-neutral Director capture. Reader acceptance uses typed evidence; RPG capture belongs to RB.

import { lineKey, parseChanges } from '../../changes.js';
import { applyOps } from '../../tracker.js';
import { fromRecord, keysOf, orderedThreads, outcomeOf, sameValue, toTracker } from './convert.js';
import { addProblem, replyDraft, replyTurn, startReply, turnNumber } from './domain.js';
import { acceptIntent } from './acceptance.js';
import { threadWriteId } from './thread-writes.js';
import { calendarOf, maxJumpMinutes, packCalendarOf, settingsFrom, timeAfter } from './time.js';

/** The longest thread name kept, in characters: a longer one is cut (at a space when there is one). */
export const KEY_CHARS = 120;
/** The longest thread summary kept, in characters: a longer one is cut (at a space when there is one). */
export const SUMMARY_CHARS = 600;
/** New threads one reply's lines may add; a line that would add more is not used (a Problem says so). */
export const NEW_THREADS_PER_REPLY = 16;
/** Open threads the Director follows at once; a line that would add one more is not used (B-b1r2-8). */
export const MAX_OPEN_THREADS = 300;
// The longest a line is quoted in a summary or a Problem.
const QUOTE_CHARS = 300;
// Labels Story Block's generic state rules reserve (ops.js checkOps: `qty` is a count, `id` and
// `…_id` are IDs, three keys no state may hold): kept under such a name in `fields`, they would get
// the whole line refused. They mean nothing to the Director, so they are left out with a Problem.
const RESERVED_LABEL = /^(?:qty|id|.+_id|.+Id|__proto__|constructor|prototype)$/;
// `xp:` on a quest: quest XP is RPG Battle's, scaled by difficulty (MODULES §F5); never a written amount.
const IGNORED_LABELS = new Set(['xp', 'exp', 'experience', 'reward', 'target', 'met', 'ready', 'difficulty']);

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** The revision this command commits as (`ctx.rev`, MODULES §F2), 0 when the host does not say. */
export function revOf(ctx) {
    return Number.isSafeInteger(ctx?.rev) ? ctx.rev : 0;
}

/**
 * The reader's own message the reply answers (the capture ctx's `ctx.chat.lastUser`), or null.
 * v1's gate: giving a quest up is the reader's choice, and only their message can make it.
 */
export function readerSaid(ctx) {
    const said = ctx?.chat?.lastUser ?? null;
    return typeof said === 'string' ? said : null;
}

// The capture ctx's carrier `{ index, swipe, sid, key }` as one plain value: its sid, else its key, else
// "index:swipe" (a swipe of the same reply is another reply), else a bare index or key.
function carrierKey(value) {
    if (value && typeof value === 'object') {
        // The reply's record ID (`sid`) stays with it when an earlier message is deleted; `key` does not.
        if (typeof value.sid === 'string' && value.sid) return value.sid;
        if (typeof value.key === 'string' && value.key) return value.key;
        if (Number.isSafeInteger(value.index)) return `${value.index}:${Number.isSafeInteger(value.swipe) ? value.swipe : 0}`;
        return null;
    }
    return Number.isSafeInteger(value) || (typeof value === 'string' && value) ? value : null;
}

// Whether the reply's key is the host's record ID (`sid`), which a Continue keeps.
function hasSid(ctx, line) {
    const value = [ctx?.carrier, line?.carrier].find(item => carrierKey(item) !== null);
    return Boolean(value) && typeof value === 'object' && typeof value.sid === 'string' && value.sid !== '';
}

// Which reply a line comes from: the host's carrier (`ctx.carrier`), else read from the line's
// place in its block (a first line, or one not after the last line read, starts a reply).
function replyOf(ctx, line) {
    for (const value of [ctx?.carrier, line?.carrier]) {
        const key = carrierKey(value);
        if (key !== null) return key;
    }
    return null;
}

/**
 * Moves `director.turn` on when `line` starts another reply's Director lines. Returns the reply's
 * bookkeeping (`turn.now`) to change in place: it is written whole with the line (domain.js).
 */
export function beginTurn(director, ctx, line) {
    const { fresh, place } = turnOf(director, ctx, line);
    const now = fresh ? null : replyDraft(director);
    if (!now) return startReply(director, { reply: replyOf(ctx, line), index: place });
    if (now.index !== place) now.index = place;
    return now;
}

// Whether `line` starts another reply's Director lines (`fresh`), and the place kept for it (beginTurn).
function turnOf(director, ctx, line) {
    const turn = replyTurn(director);
    const reply = replyOf(ctx, line);
    const index = Number.isSafeInteger(line?.index) ? line.index : -1;
    // B-a1-6: the reply's record ID (`sid`) is kept by its Continues (and the extractor's late lines),
    // whose lines are numbered from 0 again, so with a sid only another sid starts a reply: maxJump,
    // `turn.n` and the reply's tallies (paid, added, vouched) hold for the reply and its Continues. A
    // Re-read starts from the state before the reply and a swipe has its own sid, so both start fresh.
    // A host with no sid is told apart by the line's place in its block, as before; with a sid the place
    // is not kept (-1), so a Continue's lines, numbered again, and a Re-read's leave the same turn.
    const sid = reply !== null && hasSid(ctx, line);
    const fresh = sid ? reply !== turn.reply
        : reply !== null ? reply !== turn.reply || (index >= 0 && index <= turn.index)
            : index <= 0 || index <= turn.index;
    return { fresh, place: sid ? -1 : index };
}

// `Hook: Sheepfold Wolves`, a kind and a colon written in front of the name (v1 0.9.10). Invisible
// format marks go and the name is NFC, so "Ro\u200Bpe" and "\u202ERope" are the thread "Rope", as
// Story Block reads its own names (names.js).
export function bareName(name) {
    const text = String(name ?? '').replace(/\p{Cf}+/gu, '').normalize('NFC').replace(/\*\*|__|[*`]/g, '').trim();
    const prefixed = text.match(/^([A-Za-z]+)\s*:\s*(\S.*)$/s);
    return prefixed && ['agenda', 'event', 'hook', 'quest', 'clock', 'beat', 'secret', 'arc'].includes(prefixed[1].toLowerCase()) ? prefixed[2].trim() : text;
}

const clip = value => (value.length > QUOTE_CHARS ? `${value.slice(0, QUOTE_CHARS - 1)}…` : value);

/** The line as v2 wrote it, for history and problems (at most QUOTE_CHARS long). */
export function lineText(line) {
    const labels = Object.entries(line?.labels ?? {}).map(([label, value]) => ` | ${label}: ${value}`).join('');
    return clip(`${line?.op ?? ''} ${line?.kind ?? ''} ${line?.name ?? ''}${line?.text ? ` — ${line.text}` : ''}${labels}`.trim());
}

/** A thread name at most KEY_CHARS long: cut at the last space before the limit when there is one. */
export function capKey(key) {
    const text = String(key ?? '');
    if (text.length <= KEY_CHARS) return text;
    const head = text.slice(0, KEY_CHARS);
    const space = head.lastIndexOf(' ');
    return (space >= KEY_CHARS / 2 ? head.slice(0, space) : head).trim();
}

/** A summary at most SUMMARY_CHARS long, ending "…" when cut: at the last space past half of it when there is one. */
export function capSummary(summary) {
    const text = String(summary ?? '');
    if (text.length <= SUMMARY_CHARS) return text;
    const head = text.slice(0, SUMMARY_CHARS - 1);
    const space = head.lastIndexOf(' ');
    return `${(space >= SUMMARY_CHARS / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

/**
 * The line without the labels the Director does not keep (RESERVED_LABEL, IGNORED_LABELS):
 * `{ line, dropped: [label] }`.
 */
export function withoutDroppedLabels(line) {
    const labels = line?.labels;
    if (!labels || typeof labels !== 'object') return { line, dropped: [] };
    const kept = {};
    const dropped = [];
    for (const [label, value] of Object.entries(labels)) {
        const name = String(label).trim();
        if (RESERVED_LABEL.test(name) || RESERVED_LABEL.test(name.toLowerCase()) || IGNORED_LABELS.has(name.toLowerCase())) dropped.push(name);
        else kept[label] = value;
    }
    return dropped.length ? { line: { ...line, labels: kept }, dropped } : { line, dropped };
}

function droppedProblem(line, dropped) {
    const xp = dropped.filter(label => IGNORED_LABELS.has(label.toLowerCase()));
    const other = dropped.filter(label => !IGNORED_LABELS.has(label.toLowerCase()));
    const said = [
        xp.length ? `${xp.map(label => `"${label}:"`).join(', ')} is ignored: quest XP comes from the quest's difficulty, never a written amount` : '',
        other.length ? `${other.map(label => `"${label}:"`).join(', ')} ${other.length === 1 ? 'is a name' : 'are names'} the Director does not keep` : '',
    ].filter(Boolean).join('; ');
    return { kind: 'label', severity: 'info', key: capKey(bareName(line?.name)), op: line?.op, text: `${said}; the rest of the line is used.` };
}

/**
 * The v1 op a v2 line is: `{ op }`, or `{ error }`. The text and labels go through v1's own
 * parser (a stand-in key keeps the name out of it), so `— step: done`, `| reason: …`, a
 * difficulty word and the rest read exactly as v1 reads them.
 */
export function toV1Op(line) {
    const op = line?.op;
    if (!['+', '-', '~', '!'].includes(op)) return { error: `"${lineText(line)}" asks code to decide something; Director lines use + ~ - or !.` };
    const written = bareName(line?.name);
    const key = capKey(written);
    const id = lineKey(key);
    if (!id) return { error: `"${lineText(line)}" names nothing.` };
    const labels = Object.entries(line?.labels ?? {})
        .map(([label, value]) => ` | ${String(label).trim().toLowerCase()}:${String(value ?? '').trim() ? ` ${String(value).trim()}` : ''}`)
        .join('');
    const text = String(line?.text ?? '').trim();
    const stand = `${op}${op === '+' ? ` ${line.kind}` : ''} x${text ? ` — ${text}` : ''}${labels}`;
    const parsed = parseChanges(stand).ops[0];
    if (!parsed) return { error: `"${lineText(line)}" could not be read.` };
    for (const key of ['type', 'reward', 'target', 'difficulty', 'rank', 'met', 'ready', 'xp', 'exp', 'experience']) {
        delete parsed.fields?.[key];
        delete parsed.extra?.[key];
    }
    return {
        op: {
            ...parsed,
            kind: op === '+' ? line.kind : null,
            key,
            id,
            raw: clip(String(line?.raw ?? '').trim()) || lineText(line),
        },
        ...(key !== written ? { cut: written.length } : {}),
    };
}

// Thread IDs come from `ctx.id('th')` (deterministic from the receipt's seed, so a rebuild or a
// test gives the same ones); from ctx.rng() only for a host that has no ctx.id.
function newId(ctx, taken) {
    for (let tries = 0; tries < 64; tries += 1) {
        let id = typeof ctx?.id === 'function' ? ctx.id('th') : '';
        if (!/^th_[0-9a-z]{8}$/.test(id ?? '')) {
            id = 'th_';
            for (let i = 0; i < 8; i += 1) id += ID_CHARS[Math.floor(ctx.rng() * ID_CHARS.length) % ID_CHARS.length];
        }
        if (!taken.has(id)) {
            taken.add(id);
            return id;
        }
    }
    throw new Error('No free thread id.');
}

// Problems are the domain's (domain.js addProblem: each under its own key, never a list position).
export { addProblem };

const withArticle = word => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;

// Writes the records the rules returned onto the draft: only threads that changed, and the key
// index, so the command's ops are the change and nothing else. A record the rules left as it was read
// (`read`: each record as text before the rules ran) is not written back at all: read in and out
// again, an older thread could come out a little different (an offer that closed losing what it was
// offered as), and the line would write into a thread another reply made (B-b1r2-12).
function writeBack(director, records, ctx, read = new Map()) {
    const rev = revOf(ctx);
    const before = new Map(orderedThreads(director).map(thread => [lineKey(thread.key), thread]));
    const ids = new Set(Object.keys(director.threads));
    let order = Math.max(-1, ...orderedThreads(director).map(thread => thread.track?.order ?? 0));
    const idOf = new Map();
    for (const record of records) {
        const prev = before.get(record.id) ?? null;
        const id = prev?.id ?? newId(ctx, ids);
        idOf.set(record.id, id);
        if (prev && read.get(record.id) === JSON.stringify(record)) continue;
        const thread = fromRecord(record, prev, { id, rev, order: prev ? undefined : (order += 1) });
        if (!sameValue(thread, prev)) director.threads[id] = thread;
    }
    const keys = keysOf(records, record => idOf.get(record.id));
    for (const name of Object.keys(director.keys)) if (!Object.hasOwn(keys, name) && idOf.has(lineKey(director.threads[director.keys[name]]?.key ?? ''))) delete director.keys[name];
    for (const [name, id] of Object.entries(keys)) if (director.keys[name] !== id) director.keys[name] = id;
    return idOf;
}

// Genre-neutral thread progress still uses the retained tracker; RPG transitions use RB.
const rulesOn = (tracker, ops, director, said) => applyOps(tracker, ops, { message: turnNumber(director), time: director.time.minutes, said: null, direct: false });

export function applyThreadLine(ctx, given) {
    return threadLine(ctx, given);
}

function threadLine(ctx, given) {
    const director = ctx.draft('director');
    const turn = beginTurn(director, ctx, given);
    const raw = lineText(given);
    // Labels the Director does not keep are left out first (a Problem says which).
    const { line: kept, dropped } = withoutDroppedLabels(given);
    if (dropped.length) addProblem(director, ctx, droppedProblem(given, dropped));
    // A quest line's own labels (F83 `met:`, F85 `progress:`) are taken out before v1 reads it.
    const line = kept;
    const read = toV1Op(line);
    if (read.error) {
        addProblem(director, ctx, { kind: 'unread', severity: 'warn', key: String(line?.name ?? ''), op: line?.op, text: read.error });
        return { summary: `Director: ${raw} (not used)`, narrate: false, data: { thread: null, problems: ['unread'] } };
    }
    const op = read.op;
    if (read.cut) addProblem(director, ctx, { kind: 'long-name', severity: 'info', key: op.key, op: op.op, text: `A name ${read.cut} characters long was cut to "${op.key}" (names are at most ${KEY_CHARS}).` });
    const said = readerSaid(ctx);
    const tracker = toTracker(director);
    tracker.records = tracker.records.filter(record => {
        const thread = director.threads[director.keys[record.id]];
        return thread && !thread.rpg && thread.kind !== 'quest';
    });
    // Each record as read (the same objects come back from the rules, changed or not: so plain JSON).
    const asRead = new Map(tracker.records.map(record => [record.id, JSON.stringify(record)]));
    const ops = [op];
    const named = director.threads[director.keys[op.id]];
    // A legacy quest is history. Generic edits never mutate its RPG extension or close it.
    if (named?.kind === 'quest' && !named.rpg) return { summary: 'Quest from an earlier version (read only).', narrate: false, data: { thread: named.id } };
    if (named?.rpg) {
        if (line.op === '-' || line.op === '!') return ctx.call('capture.quest', { ...given, kind: 'quest' });
        if (named.offer) acceptIntent(ctx, named);
        // Neutral annotations remain SD-owned and never replace mechanics or compatibility projections.
        for (const key of ['goal', 'step', 'progress', 'giver', 'due', 'place', 'people', 'now', 'then', 'on']) {
            if (typeof line.labels?.[key] === 'string') named.fields[key] = capSummary(line.labels[key]);
        }
        if (line.text) named.summary = capSummary(line.text);
        named.rev = ctx.rev;
        return { summary: `Director: ${raw}`, narrate: false, data: { thread: named.id } };
    }
    if (!named && line.op === '+' && line.kind === 'hook' && line.labels?.goal) {
        const id = newId(ctx, new Set(Object.keys(director.threads)));
        ctx.call('threads.offer', { write: threadWriteId(ctx, `offer:${id}`), thread: id, kind: 'hook', key: op.key,
            summary: capSummary(line.text ?? ''), fields: Object.fromEntries(Object.entries(line.labels ?? {}).filter(([key]) => ['goal', 'giver', 'step', 'progress', 'due', 'place', 'people', 'now', 'then', 'on'].includes(key))), expectedHash: null });
        return { summary: `Director: ${raw}`, narrate: false, data: { thread: id } };
    }
    if (named?.offer) acceptIntent(ctx, named);
    const result = rulesOn(tracker, ops, director, said);
    const findings = result.problems;
    const records = result.tracker.records;
    for (const record of records) {
        if (record.kind === 'quest') record.kind = director.threads[director.keys[record.id]]?.kind ?? line.kind;
    }
    // One reply adds at most NEW_THREADS_PER_REPLY threads, and at most MAX_OPEN_THREADS are open at
    // once: past either, a line that would add one is not used.
    const known = new Set(orderedThreads(director).map(thread => lineKey(thread.key)));
    const adding = records.filter(record => !known.has(record.id)).length;
    if (adding > 0) {
        const open = Object.values(director.threads).filter(thread => thread?.status === 'active').length;
        const full = turn.added + adding > NEW_THREADS_PER_REPLY ? `one reply adds at most ${NEW_THREADS_PER_REPLY} new threads`
            : open + adding > MAX_OPEN_THREADS ? `the Director follows at most ${MAX_OPEN_THREADS} open threads; close or finish some first` : '';
        if (full) {
            addProblem(director, ctx, { kind: 'too-many', severity: 'warn', key: op.key, op: op.op, text: `"${op.key}" was not added: ${full}.` });
            return { summary: `Director: ${raw} (not used)`, narrate: false, data: { thread: null, problems: ['too-many'] } };
        }
        turn.added += adding;
    }

    // A `~` on a name not tracked becomes v1's hook (or, with a giver or reward, its quest); the
    // line's own kind says what it is, so only `~ quest` makes a quest of it.
    const added = findings.find(finding => finding.kind === 'untracked-added');
    if (added && line.kind !== 'quest') {
        const record = records.find(entry => entry.id === op.id);
        if ((record?.kind === 'hook' || record?.kind === 'quest') && record.kind !== line.kind) {
            record.kind = line.kind;
            added.message = `"${op.key}" was not tracked; added as ${withArticle(line.kind)}.`;
        }
    }
    const reached = record => record.id === op.id || (record.aliases ?? []).includes(op.id);
    // A summary (v1's `desc`) longer than SUMMARY_CHARS is cut, with a Problem.
    for (const record of records) {
        const desc = String(record.fields?.desc ?? '');
        if (desc.length <= SUMMARY_CHARS) continue;
        record.fields.desc = capSummary(desc);
        addProblem(director, ctx, { kind: 'long-summary', severity: 'info', key: record.key, op: op.op, text: `The summary of "${record.key}" was ${desc.length} characters long; it was cut to ${SUMMARY_CHARS}.` });
    }
    const idOf = writeBack(director, records, ctx, asRead);
    const target = records.find(reached);
    const thread = target ? idOf.get(target.id) : null;
    for (const finding of findings) {
        addProblem(director, ctx, {
            kind: finding.kind, severity: finding.severity, key: finding.key ?? undefined, op: finding.op ?? op.op,
            text: finding.message, candidates: finding.candidates,
        });
    }
    const current = thread ? director.threads[thread] : null;
    if (named?.acceptance && named.status === 'active' && current?.status === 'resolved') {
        ctx.call('chronicle.threadOutcome', { thread, text: `${current.key}: ${current.ended.outcome}.` });
    }
    return { summary: `Director: ${raw}`, narrate: false, data: { thread, problems: findings.map(finding => finding.kind) } };
}

/** `apply(ctx, line)` for `time` lines: `~ time <date, clock time>`, `! time +2h`. */
export function applyTimeLine(ctx, line) {
    return timeLine(ctx, line);
}

function timeLine(ctx, line) {
    const director = ctx.draft('director');
    // `from`: the clock when this reply's first Director line was read. maxJump holds for the whole
    // reply, so a reply that repeats "! time +30d" moves the clock 30 days in all (C2-5).
    const { from } = beginTurn(director, ctx, line);
    const settings = settingsFrom(typeof ctx.settings === 'function' ? ctx.settings() : ctx.settings);
    const calendar = calendarOf(settings, packCalendarOf(ctx.query));
    const next = timeAfter(line, director.time.minutes, calendar, { maxJump: maxJumpMinutes(settings), from });
    if (next.problem) addProblem(director, ctx, { kind: 'time', severity: 'warn', key: String(line?.name ?? '').slice(0, KEY_CHARS), op: line?.op, text: next.problem });
    if (next.error) {
        addProblem(director, ctx, { kind: 'time', severity: 'warn', key: String(line?.name ?? '').slice(0, KEY_CHARS), op: line?.op, text: next.error });
        return { summary: `Director: ${lineText(line)} (not used)`, narrate: false, data: { minutes: director.time.minutes } };
    }
    const before = director.time.minutes;
    if (next.minutes !== before) director.time.minutes = next.minutes;
    // A date sets the clock: stored as a set (Story Block's ctx.absolute, SPEC §2.2), so it stays exact
    // when an earlier reply that moved the clock is deleted, and later moves add on top. An older Story
    // Block without it stores the set as a move.
    if (next.set && typeof ctx.absolute === 'function') ctx.absolute('director', '/time/minutes');
    return {
        summary: `Story time: ${calendar.format(next.minutes)}.`,
        narrate: false,
        data: { minutes: next.minutes, from: before, ...(next.held ? { held: next.held } : {}) },
    };
}
