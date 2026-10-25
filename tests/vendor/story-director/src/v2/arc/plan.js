// Story Director v2, part **arc**: the planner's prompt, its answer read strictly, the plan written as
// text the reader can edit, and when to plan by itself (pure: no DOM, no model, no globals).
//
// Once per arc a model plays showrunner (v1 src/planner.js): it reads the recent story and what the
// Director tracks and answers with a short plan in fixed lines (ARC, BEAT, AGENDA, HOOK, CLOCK,
// SECRET; with a fight runner a planned fight is a BEAT with `encounter:`, or an ENCOUNTER line).
// The answer is a proposal and nothing more (WAVE rule 1): code reads only those labels and only the
// parts each kind has, cuts every name and text by code points with markup and control characters
// taken out, caps how many of each kind one plan holds, writes relative dates on the chat's calendar
// itself and leaves out a date it cannot read or one already past. Nothing the planner writes sets an
// amount: rewards, ranks, XP and quantities are not parts of any plan line and are dropped.
// The same reader reads the reader's edited text when they accept it, so what is kept is what code
// read, whoever wrote it.

import { lineKey, parseChanges } from '../../changes.js';
import { resolveRelative } from '../../planner.js';

/** The longest planner answer read, in characters; the rest is not looked at. */
export const MAX_ANSWER_CHARS = 32000;
/** Lines of the answer looked at; past them nothing is read. */
export const MAX_LINES = 80;
/** The most of each kind one plan keeps (in its order); the rest is left out, and the review says so. */
export const PLAN_CAPS = Object.freeze({ beat: 6, agenda: 6, hook: 3, clock: 2, secret: 4 });
/** Items one plan keeps in all (Story Director adds at most 16 threads for one reply, tracker/capture.js). */
export const MAX_ITEMS = 16;
/** Planned fights one plan keeps; a later beat keeps its words but loses its foes. */
export const MAX_FIGHTS = 2;
export const KEY_POINTS = 80;
export const DESC_POINTS = 240;
export const PART_POINTS = 160;

const LABELS = Object.freeze({ ARC: 'arc', BEAT: 'beat', ENCOUNTER: 'beat', AGENDA: 'agenda', HOOK: 'hook', CLOCK: 'clock', SECRET: 'secret' });
/** The parts each kind keeps, in the order the plan text writes them. */
export const PARTS = Object.freeze({
    arc: Object.freeze([]),
    beat: Object.freeze(['on', 'place', 'after', 'reach', 'encounter']),
    agenda: Object.freeze(['now', 'then', 'on', 'place']),
    hook: Object.freeze(['then', 'on']),
    clock: Object.freeze(['due', 'shown']),
    secret: Object.freeze([]),
});
const DATE_PARTS = new Set(['on', 'due']);
const SHOWN = new Set(['none', 'sign', 'warning']);
// A key the tracker's key index must never be asked for (a plain object's own names).
const RESERVED_KEYS = new Set(['proto', '__proto__', 'constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof']);
const KIND_ORDER = ['beat', 'agenda', 'hook', 'clock', 'secret'];

const THINK_BLOCK = /<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const THINK_CLOSE = /<\/(?:think|thinking|reasoning)\s*>/gi;
const PLAN_OPEN = /<plan\b[^>]*>/gi;
const PLAN_CLOSE = /<\/plan\s*>/i;
const DECORATION = /^(?:#{1,6}\s+|>\s*|(?:[*•+-]|\d{1,2}[.)])\s+)+/;
const LABEL_LINE = /^([A-Za-z]+)\s*:\s*(.*)$/s;
const FENCE = /^(?:```|~~~)/;

// ---------------------------------------------------------------------------------------------------
// Text as code keeps it

/**
 * `value` as one plain line of at most `points` code points: control and format characters out, `<`
 * and `>` out (no markup reaches a screen or the prompt), runs of space made one, NFC. Cut at a space
 * past half of it when there is one.
 */
export function flat(value, points) {
    const cleaned = String(value ?? '')
        .normalize('NFC')
        .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
        .replace(/[<>]/g, '')
        .replace(/\*\*|__|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const chars = [...cleaned];
    if (chars.length <= points) return cleaned;
    const head = chars.slice(0, points).join('');
    const space = head.lastIndexOf(' ');
    return (space >= head.length / 2 ? head.slice(0, space) : head).trim();
}

// A separator the change-line grammar reads (` | `, ` — `) never survives inside a part, so the text
// form reads back as the same plan.
const part = (value, points) => flat(String(value ?? '').replace(/\s[|—–]\s/g, ' ').replace(/\|/g, '/'), points);

// ---------------------------------------------------------------------------------------------------
// The prompt

export const DEFAULT_PLANNER_PROMPT = `You are the showrunner of an ongoing story between {{user}} and {{char}}. Your job is to plan the NEXT ARC: what the world and its people will do over the coming days, so the story moves with purpose. You write the plan the storyteller follows, not the story.

## How you plan
- Decide. Never ask questions, offer options or hedge. Commit to one specific plan.
- Plan the world, never {{user}}. {{user}}'s actions, words, thoughts and choices belong to {{user}} alone. Create pressures, opportunities and consequences that {{user}} can meet any way; never script the response.
- Every character has goals, fears, loyalties and limits, and pursues them off-screen, watched or not. Keep plans true to who they are.
- Plan the future: the current scene is already in motion, and your beats start after it.
- Build from what is there: pull dropped threads, unpaid debts, broken promises, rumours and characters mentioned but never seen back into play. Paying off what exists beats inventing.
- Make consequences real: what {{user}} and others did comes back, on a schedule.
- Quests are {{user}}'s: press on them (rivals, deadlines), never complete them. Offer new work as a HOOK.
- Give the arc a shape: pressure that builds, a turn, and a climax. Leave the outcome open for {{user}}.
- Beats are when the world acts, not appointments for {{user}}. Each must work without {{user}} present, and may slip.
- Every beat reaches {{user}} wherever they are (a price, a door shut or opened, a mood, a danger, an opening); the response stays {{user}}'s.
- Protect secrets: write each as a SECRET line. The storyteller hints and never tells until the story earns the reveal.
- Respect time and distance: nobody is in two places at once; travel takes time.
- Match the genre and tone. Follow the Director's note if there is one.

## What you know
Genre and tone: {{genre}}
Now: {{now}}
Place: {{place}}
Director's note: {{note}}
Previous arc: {{previous_arc}}

Tracked so far:
{{tracker}}

Recent story:
{{recent}}

## Your answer
Answer with only a <plan> block, one item per line, each starting with its label:

<plan>
ARC: Name — what the arc is about and where it is heading
BEAT: Key — what happens | on: DATE | place: Place | after: Other beat | reach: how it touches {{user}} if they are elsewhere
AGENDA: Name — what they want | now: what they are doing | then: what they do next | on: DATE
HOOK: Key — the tension; what would settle it | then: what happens if it is left alone | on: DATE
CLOCK: Key — cause → consequence | due: DATE | shown: none
SECRET: Key — what {{user}} must not learn yet
</plan>

- Exactly one ARC line.
- 3 to 6 BEATs in story order: things that happen in the world, not things {{user}} does. Give a beat "after: Other beat" instead of a date when it follows another beat.
{{fights}}
- One AGENDA for every character the arc moves, named the way the story names them.
- 1 to 3 HOOKs, 0 to 2 CLOCKs, and a SECRET for every secret.
- DATE is a date in the story's calendar, written like "Now" above, or relative to now: "in 2 days", "tomorrow at dusk", "next morning", "in 6 hours".
- No rewards, prices, levels or amounts: the story's rules set those.
- Keep every part short: a few words, not sentences. No markdown, numbering or commentary.`;

/** The `{{fights}}` line: with a module that runs fights, how a planned fight is written; else none at all. */
export const FIGHT_RULE = '- A fight is a BEAT with "| encounter: 3 bandit, bandit captain (boss)", only where the story would really come to blows (a quest\'s target, an ambush an agenda sets up); at most 1 or 2 per arc, foes named as the story names them.';
export const NO_FIGHT_RULE = '- This story has no fights: plan no battles or encounters.';

export const PLANNER_ASK = 'Plan the next arc. Answer only with the <plan> block.';
const NONE = '(none)';
const MACRO = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;

/**
 * The planner call's `{ system, prompt }`: the reader's template (empty: the default) with its macros
 * filled. `{{user}}` and `{{char}}` (and any other macro) stay for Story Block's substitute.
 */
export function plannerRequest({ template = '', genre = '', now = '', place = '', note = '', previousArc = '', tracker = '', recent = '', fights = true } = {}) {
    const values = {
        genre, now, place, note, previous_arc: previousArc, tracker, recent,
        fights: fights ? FIGHT_RULE : NO_FIGHT_RULE,
    };
    const source = String(template ?? '').trim() ? String(template) : DEFAULT_PLANNER_PROMPT;
    const system = source.replace(MACRO, (whole, name) => {
        const key = name.toLowerCase();
        if (!Object.hasOwn(values, key)) return whole;
        return String(values[key] ?? '').trim() || NONE;
    });
    return { system, prompt: PLANNER_ASK };
}

/** What the Director tracks, as the planner reads it: open threads by kind, then the last few closed. */
export function trackerSummary(threads = [], { closedShown = 8 } = {}) {
    const headings = { quest: 'Quests', hook: 'Hooks', agenda: 'Agendas', event: 'World', clock: 'Clocks', beat: 'Beats', secret: 'Secrets' };
    const lines = [];
    const open = threads.filter(thread => thread?.status === 'active');
    for (const kind of Object.keys(headings)) {
        const group = open.filter(thread => thread.kind === kind);
        if (!group.length) continue;
        lines.push(`${headings[kind]}:`);
        for (const thread of group) {
            const fields = thread.fields ?? {};
            let line = `- ${flat(thread.key, KEY_POINTS)}`;
            const what = flat(fields.now || thread.summary, DESC_POINTS);
            if (what) line += ` — ${what}`;
            if (fields.then) line += ` → ${flat(fields.then, PART_POINTS)}`;
            const when = fields.on || fields.due;
            if (when) line += ` (${flat(when, PART_POINTS)})`;
            lines.push(line);
        }
    }
    const closed = threads.filter(thread => thread?.status !== 'active').slice(-closedShown);
    if (closed.length) {
        lines.push('Resolved:');
        for (const thread of closed) lines.push(`- ${flat(thread.key, KEY_POINTS)}${thread.ended?.reason ? ` — ${flat(thread.ended.reason, PART_POINTS)}` : ''}`);
    }
    return lines.length ? lines.join('\n') : '(nothing tracked yet)';
}

// ---------------------------------------------------------------------------------------------------
// Reading a plan

// The plan's lines: inside the <plan> block when there is one (the opening nearest the first close, so a
// "here is the <plan>" in prose before it does not swallow it), with reasoning taken out first.
function planBody(text) {
    let clean = String(text ?? '').slice(0, MAX_ANSWER_CHARS).replace(THINK_BLOCK, '');
    const closes = [...clean.matchAll(THINK_CLOSE)];
    if (closes.length) {
        const last = closes.at(-1);
        clean = clean.slice(last.index + last[0].length);
    }
    const close = clean.search(PLAN_CLOSE);
    const end = close >= 0 ? close : clean.length;
    let start = 0;
    for (const match of clean.slice(0, end).matchAll(PLAN_OPEN)) start = match.index + match[0].length;
    return clean.slice(start, end);
}

const finding = (severity, text) => ({ severity, text });

function isPast(parsed, now, calendar) {
    if (!parsed.hasTime) return calendar.dayIndex(parsed.abs) < calendar.dayIndex(now);
    return parsed.abs < now;
}

// A date part as code keeps it: relative words written on the calendar, an absolute date written the
// calendar's way; `{ value }`, or `{ drop: reason }`. Without a calendar or a story time, as written.
function dateOf(value, { calendar, now }) {
    const written = part(value, PART_POINTS);
    if (!calendar || !Number.isInteger(now)) return { value: written };
    let resolved = null;
    try { resolved = resolveRelative(written, { calendar, now }); } catch { resolved = null; }
    let parsed = null;
    try { parsed = calendar.parse(resolved ?? written, { reference: now }); } catch { parsed = null; }
    if (!parsed || !Number.isFinite(parsed.abs)) return { drop: `"${written}" is not a date on this calendar` };
    if (isPast(parsed, now, calendar)) return { drop: `${written} is already past` };
    let out = '';
    try { out = calendar.format(parsed.abs, { era: false, time: parsed.hasTime === true }); } catch { out = ''; }
    return { value: out || written };
}

// One line's label and the rest, or null for a line that carries nothing (a fence, a rule, a blank).
function labelOf(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed || FENCE.test(trimmed)) return null;
    let text = trimmed.replace(/\*\*|__/g, '').replace(DECORATION, '').trim();
    if (!/[\p{L}\p{N}]/u.test(text)) return null;
    const match = text.match(LABEL_LINE);
    if (!match) return { error: `"${flat(trimmed, 60)}" has no label (ARC:, BEAT:, AGENDA:, HOOK:, CLOCK: or SECRET:)` };
    const label = match[1].toUpperCase();
    if (!Object.hasOwn(LABELS, label)) return { error: `"${flat(match[1], 30)}:" is not a plan label` };
    text = match[2].trim();
    return { label, kind: LABELS[label], rest: text };
}

/**
 * Reads a plan: the planner's answer, or the plan's text as the reader edited it. `options`: { calendar
 * (calendar.js), now (story minutes or null), fights (a module runs fights), userName ({{user}}'s name,
 * for a line that plans what they do), lone (one item read alone: no ARC line is asked for) }. → `{ arc: { key, desc } | null, items: [{ kind, key, desc,
 * parts: { name: text } }], findings: [{ severity: 'error' | 'warn' | 'info', text }] }`. An `error`
 * finding means the plan cannot be used (no ARC line, nothing planned).
 */
export function readPlan(text, { calendar = null, now = null, fights = true, userName = '', lone = false } = {}) {
    const findings = [];
    const items = [];
    const seen = new Set();
    const count = Object.fromEntries(KIND_ORDER.map(kind => [kind, 0]));
    let arc = null;
    let fightsKept = 0;
    let read = 0;
    const user = userPattern(userName);
    const body = planBody(text);
    if (String(text ?? '').length > MAX_ANSWER_CHARS) findings.push(finding('info', `Only the first ${MAX_ANSWER_CHARS} characters were read.`));

    for (const raw of body.split(/\r?\n/)) {
        const line = labelOf(raw);
        if (!line) continue;
        read += 1;
        if (read > MAX_LINES) {
            findings.push(finding('info', `Only the first ${MAX_LINES} lines were read.`));
            break;
        }
        if (line.error) {
            findings.push(finding('info', `Not read: ${line.error}.`));
            continue;
        }
        // The rest is the change-line grammar ("Key — what | part: value"); `arc` borrows `event`.
        const { ops } = parseChanges(`+ ${line.kind === 'arc' ? 'event' : line.kind} ${line.rest}`);
        const op = ops[0];
        const key = op ? flat(String(op.key ?? '').replace(/^[A-Za-z]+\s*:\s*/, ''), KEY_POINTS) : '';
        if (!op || !key || !lineKey(key)) {
            findings.push(finding('info', `Not read: a ${line.label} line without a name.`));
            continue;
        }
        if (RESERVED_KEYS.has(lineKey(key)) || RESERVED_KEYS.has(key.toLowerCase())) {
            findings.push(finding('warn', `Left out: "${key}" cannot be a name.`));
            continue;
        }
        const desc = part(op.fields?.desc, DESC_POINTS);
        if (line.kind === 'arc') {
            if (arc) findings.push(finding('info', `A second ARC line ("${key}") was left out; the first is kept.`));
            else arc = { key, desc };
            continue;
        }
        const id = lineKey(key);
        if (seen.has(id)) {
            findings.push(finding('info', `"${key}" is in the plan twice; the first is kept.`));
            continue;
        }
        if (count[line.kind] >= PLAN_CAPS[line.kind]) {
            findings.push(finding('info', `"${key}" was left out: a plan keeps at most ${PLAN_CAPS[line.kind]} ${line.kind === 'beat' ? 'beats' : `${line.kind}s`}.`));
            continue;
        }
        if (items.length >= MAX_ITEMS) {
            findings.push(finding('info', `"${key}" was left out: a plan keeps at most ${MAX_ITEMS} items.`));
            continue;
        }
        // A secret about {{user}} is fine ("Ren is the heir"); a plan for them is not.
        if (user && line.kind !== 'secret' && user.test(key)) {
            findings.push(finding('warn', `"${key}" was left out: it plans what ${userName.trim()} does; the plan is for the world and its people.`));
            continue;
        }

        const given = { ...(op.fields ?? {}), ...(op.extra ?? {}) };
        const parts = {};
        const dropped = [];
        // ENCOUNTER: the foes are its `encounter:`, else its words, else its name (v1 fightBeat).
        if (line.label === 'ENCOUNTER' && !String(given.encounter ?? '').trim()) given.encounter = desc || key;
        for (const [name, value] of Object.entries(given)) {
            if (name === 'desc' || !String(value ?? '').trim()) continue;
            if (!PARTS[line.kind].includes(name)) {
                dropped.push(name);
                continue;
            }
            if (DATE_PARTS.has(name)) {
                const date = dateOf(value, { calendar, now });
                if (date.drop) findings.push(finding('info', `"${key}": ${name}: left out (${date.drop}).`));
                else if (date.value) parts[name] = date.value;
                continue;
            }
            if (name === 'shown') {
                const word = part(value, 20).toLowerCase();
                if (SHOWN.has(word)) parts.shown = word;
                else dropped.push(name);
                continue;
            }
            if (name === 'after') {
                const other = flat(value, KEY_POINTS);
                if (other && lineKey(other) !== id) parts.after = other;
                continue;
            }
            const kept = part(value, PART_POINTS);
            if (kept) parts[name] = kept;
        }
        if (parts.encounter) {
            if (!fights) {
                delete parts.encounter;
                findings.push(finding('info', `"${key}": no module runs fights here, so it stays a beat without foes.`));
            } else if (fightsKept >= MAX_FIGHTS) {
                delete parts.encounter;
                findings.push(finding('info', `"${key}": a plan keeps at most ${MAX_FIGHTS} fights; it stays a beat without foes.`));
            } else fightsKept += 1;
        }
        if (dropped.length) findings.push(finding('info', `"${key}": ${[...new Set(dropped)].map(name => `${name}:`).join(', ')} left out (not part of a ${line.kind} in a plan).`));
        seen.add(id);
        count[line.kind] += 1;
        items.push({ kind: line.kind, key, desc, parts: ordered(line.kind, parts) });
    }

    if (!arc && !lone) findings.unshift(finding('error', 'The plan has no ARC line.'));
    if (!items.length) findings.unshift(finding('error', 'The plan has no beats, agendas, hooks, clocks or secrets.'));
    return { arc, items, findings };
}

const ordered = (kind, parts) => Object.fromEntries(PARTS[kind].filter(name => parts[name]).map(name => [name, parts[name]]));

// The name at the start, as a whole word; a possessive ("Ren's debt") is a thing, not an act.
function userPattern(name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || /^\{\{.*\}\}$/.test(trimmed)) return null;
    const body = trimmed.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    return new RegExp(`^\\s*${body}(?![\\p{L}\\p{N}'’])`, 'iu');
}

/** One plan item as its text line ("BEAT: Key — what | on: …"). */
export function itemLine(item) {
    const label = item.kind === 'arc' ? 'ARC' : item.kind.toUpperCase();
    const parts = Object.entries(item.parts ?? {}).map(([name, value]) => ` | ${name}: ${value}`).join('');
    return `${label}: ${item.key}${item.desc ? ` — ${item.desc}` : ''}${parts}`;
}

/** The plan as text, one line an item: what the review shows and the reader may edit; readPlan reads it back the same. */
export function planText(plan) {
    const lines = [];
    if (plan?.arc) lines.push(itemLine({ kind: 'arc', key: plan.arc.key, desc: plan.arc.desc }));
    for (const item of plan?.items ?? []) lines.push(itemLine(item));
    return lines.join('\n');
}

/** How many of each kind a plan holds: `{ beat, agenda, hook, clock, secret }`. */
export function planCounts(plan) {
    const counts = Object.fromEntries(KIND_ORDER.map(kind => [kind, 0]));
    for (const item of plan?.items ?? []) if (Object.hasOwn(counts, item.kind)) counts[item.kind] += 1;
    return counts;
}

/** A short hash of the Director's note (FNV-1a, base 36), so an arc can say which note it was planned with. */
export function noteMark(note) {
    const text = String(note ?? '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    let hash = 0x811c9dc5;
    for (const char of text) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

// ---------------------------------------------------------------------------------------------------
// When to plan by itself (v1 autoPlanReason, on v2 threads)

export const DEFAULT_STALL_DAYS = 7;
export const DEFAULT_LOW_THREADS = 3;
/** Replies the story must move on after a plan was asked for before "running low" asks again (v1 0.9.19). */
export const LOW_THREADS_REPLIES = 5;

/** The arc's beats: `{ done, total, active }` (threads tagged with the arc's id). */
export function arcBeats(threads, arcId) {
    const beats = arcId ? threads.filter(thread => thread?.kind === 'beat' && thread.arc === arcId) : [];
    const active = beats.filter(thread => thread.status === 'active');
    return { done: beats.length - active.length, total: beats.length, active };
}

/** Open threads the world itself still has: active hooks and clocks, and the arc's beats still to play. */
export function openThreads(threads, arcId) {
    const pressing = threads.filter(thread => thread?.status === 'active' && (thread.kind === 'hook' || thread.kind === 'clock') && !thread.offer);
    return pressing.length + arcBeats(threads, arcId).active.length;
}

/**
 * Why the Director should plan by itself now, or null (v1): 'no-arc' (the story tracks something and
 * has no arc), 'arc-end' (every beat of the arc played out), 'stalled' (no beat of the arc due within
 * `stallDays` story days; a beat without a date counts as due) or 'running-low' (fewer than
 * `lowThreads` open threads, once `repliesSincePlan` reaches LOW_THREADS_REPLIES; 0 turns it off).
 * `threads`: each with `kind`, `status`, `fields`, `offer` and `arc` (its arc's id). `arc`: the current
 * arc `{ id, active }` or null; an ended arc counts as none.
 */
export function autoPlanReason({ threads = [], arc = null, now = null, calendar = null, stallDays = DEFAULT_STALL_DAYS, lowThreads = DEFAULT_LOW_THREADS, repliesSincePlan = Infinity } = {}) {
    if (!arc || arc.active === false) return threads.length ? 'no-arc' : null;
    const { total, active } = arcBeats(threads, arc.id);
    if (total && !active.length) return 'arc-end';
    if (Number.isInteger(now) && active.length && calendar) {
        const days = Number.isInteger(stallDays) && stallDays > 0 ? stallDays : DEFAULT_STALL_DAYS;
        const horizon = calendar.addDays(now, days);
        const upcoming = active.some(beat => {
            let date = null;
            try { date = beat.fields?.on ? calendar.parse(beat.fields.on, { reference: now }) : null; } catch { date = null; }
            return !date || date.abs <= horizon;
        });
        if (!upcoming) return 'stalled';
    }
    const threshold = Number.isInteger(lowThreads) && lowThreads >= 0 ? lowThreads : DEFAULT_LOW_THREADS;
    if (threshold > 0 && Number(repliesSincePlan) >= LOW_THREADS_REPLIES && openThreads(threads, arc.id) < threshold) return 'running-low';
    return null;
}

/** Why a plan was asked for, in the reader's words. */
export const REASON_TEXT = Object.freeze({
    manual: 'you asked for it',
    'no-arc': 'the story had no arc',
    'arc-end': 'every beat of the last arc played out',
    stalled: 'no beat of the arc was coming up',
    'running-low': 'the story was running low on open threads',
});
