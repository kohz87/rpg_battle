// Story Director: arc planning (pure).
//
// Once per arc a chosen model plays showrunner: it reads the recent story and the tracker and
// answers with a short plan in fixed lines (ARC, BEAT, AGENDA, HOOK, CLOCK, SECRET; a planned
// fight is a BEAT with `encounter:`, or an ENCOUNTER line, which becomes one). This
// module writes that prompt, reads the answer back leniently (models add thinking, bold,
// bullets, numbering and their own label names), turns relative dates into calendar dates,
// checks the plan, and turns it into `+` change ops tagged with the arc. Pure: no DOM, no
// globals; the calendar is passed in.

import { KINDS, formatOp, lineKey, parseChanges } from './changes.js';
import { NPC_PLANS_ONLY } from './note.js';
import { isOffer } from './tracker.js';

// (0.9.19) A BEAT carries `reach:`, how it touches {{user}} wherever they are, so an off-screen
// beat still changes something for them (a price, a shut door, a mood) without scripting them.
export const DEFAULT_PLANNER_PROMPT = `You are the showrunner of an ongoing story between {{user}} and {{char}}. Your job is to plan the NEXT ARC: what the world and its people will do over the coming days, so the story moves with purpose. You write the plan the storyteller follows, not the story.

## How you plan
- Decide. Never ask questions, offer options or hedge. Commit to one specific plan.
- Plan the world, never {{user}}. {{user}}'s actions, words, thoughts and choices belong to {{user}} alone. Create pressures, opportunities and consequences that {{user}} can meet any way; never script the response.
- Every NPC has goals, fears, loyalties and limits, and pursues them off-screen, watched or not. Keep plans true to who they are: a coward does not turn brave because the plot needs it.
- Plan the future: the current scene is already in motion, and your beats start after it.
- Build from what is there: pull dropped threads, unpaid debts, broken promises, rumours and characters mentioned but never seen back into play. Paying off what exists beats inventing.
- Make consequences real: what {{user}} and others did comes back, on a schedule.
- Quests are {{user}}'s: press on them (rivals, deadlines), never complete them. Offer new work as a HOOK.
- Give the arc a shape: pressure that builds, a turn, and a climax. Leave the outcome open for {{user}}.
- Leave room: beats are when the world acts, not appointments for {{user}}. Each must work without {{user}} present, and may slip.
- Every beat reaches {{user}} wherever they are (a price, a door shut or opened, a mood, a danger, an opening); the response stays {{user}}'s.
- Protect secrets: write each as a SECRET line. The storyteller hints and never tells until the story earns the reveal.
- Respect time and distance: nobody is in two places at once; travel takes time.
- Match the genre and tone. Follow the reader's note if any.

## What you know
Genre and tone: {{genre}}
Now: {{now}}
Place: {{place}}
Nearby: {{nearby}}
Reader's note: {{note}}
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
AGENDA: Name — now: what they are doing | then: what they do next | on: DATE
HOOK: Key — the tension; what would settle it | then: what happens if it is left alone | on: DATE
CLOCK: Key — cause → consequence | due: DATE | shown: none
SECRET: Key — what {{user}} must not learn yet
</plan>

- Exactly one ARC line.
- 3 to 6 BEATs in story order: things that happen in the world, not things {{user}} does. Give a beat "after: Other beat" instead of a date when it follows another beat.
- A fight is a BEAT with "| encounter: 3 bandit, bandit captain (boss)", only where the story would really come to blows (a quest's target, an ambush an agenda sets up); at most 1 or 2 per arc, foes named as the story names them.
- One AGENDA for every NPC the arc moves, named the way the story names them.
- 1 to 3 HOOKs, 0 to 2 CLOCKs, and a SECRET for every secret.
- DATE is a date in the story's calendar, written like "Now" above, or relative to now: "in 2 days", "tomorrow at dusk", "next morning", "in 6 hours".
- Keep every part short: a few words, not sentences. No markdown, numbering or commentary.`;

const USER_MESSAGE = 'Plan the next arc. Answer only with the <plan> block.';

// What an empty macro becomes, so the prompt never shows a dangling "Place:".
const NONE = '(none)';
const MACRO = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;

const HEADINGS = Object.freeze({
    agenda: 'Off-screen', event: 'World', hook: 'Hooks', quest: 'Quests', clock: 'Clocks',
    beat: 'Beats', secret: 'Secrets', arc: 'Arc',
});
const RESOLVED_LIMIT = 8;

// Plan labels, lowercased with spaces, hyphens and underscores squashed to one space. The
// old blueprint names (Megumin's EVENT/SUB-EVENT, OFF-LIMITS, TIMER, THREAD) land here too.
const LABELS = Object.freeze({
    arc: 'arc',
    beat: 'beat', event: 'beat', 'sub event': 'beat', subevent: 'beat',
    agenda: 'agenda', 'npc agenda': 'agenda', npc: 'agenda',
    hook: 'hook', thread: 'hook',
    // The planner offers work; only {{user}} accepts it, so a planned quest is an open hook.
    quest: 'hook', bounty: 'hook', contract: 'hook',
    clock: 'clock', timer: 'clock',
    secret: 'secret', 'off limits': 'secret', offlimits: 'secret',
    // A planned fight is a beat that carries its foes; see fightBeat.
    encounter: 'beat', fight: 'beat',
});
const FIGHT_LABELS = new Set(['encounter', 'fight']);

// `BEAT:`, `NPC AGENDA:`, `BEAT 2:` (numbered beats are common); the label is words only, so
// `Geva — now: Court` is not read as a label.
const LABEL = /^([A-Za-z][A-Za-z _-]*?)(?:\s*#?\d+)?\s*:\s*(.*)$/s;
const BULLET = /^(?:[*•+-]|\d+[.)])\s+/;
const CODE_FENCE = /^(?:```|~~~)/;
// What a key cannot start with: the change-line grammar would read it as the end of a key.
const SEPARATOR_FIRST = /^(?:[—–:|]|-(?:\s|$))/;

const THINK_BLOCK = /<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const THINK_CLOSE = /<\/think(?:ing)?\s*>/gi;
const PLAN_OPEN = /<plan\b[^>]*>/gi;
const PLAN_CLOSE = /<\/plan\s*>/i;

const DATE_FIELDS = ['on', 'due', 'arrive'];
const FIRE_FIELDS = ['on', 'due'];

const DAY_MINUTES = 1440;
const UNIT_MINUTES = Object.freeze({ minute: 1, hour: 60, day: DAY_MINUTES, week: 7 * DAY_MINUTES });
const NUMBER_WORDS = Object.freeze({
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
});
const COUNT = `(\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join('|')})`;
const UNIT = '(minute|hour|day|week)s?';
const IN_SPAN = new RegExp(`^in\\s+${COUNT}\\s+${UNIT}(?:\\s+(.+))?$`);
const SPAN_FROM_NOW = new RegExp(`^${COUNT}\\s+${UNIT}\\s+(?:from\\s+now|later)(?:\\s+(.+))?$`);
const DAY_WORDS = Object.freeze({
    today: { days: 0 },
    tonight: { days: 0, time: 'night' },
    tomorrow: { days: 1 },
    'next day': { days: 1 },
    'following day': { days: 1 },
    'day after tomorrow': { days: 2 },
    'next week': { days: 7 },
});
// Longest first, so `day after tomorrow` is not read as `day …`.
const DAY_WORD = new RegExp(`^(?:the\\s+)?(${Object.keys(DAY_WORDS)
    .sort((a, b) => b.length - a.length).join('|')})(?:\\s+(.+))?$`);
// `next morning`, `the following evening`, `this afternoon`: the word must be a time of day,
// which the calendar decides (so a reader's own parts of day work too).
const NEXT_PART = /^(?:the\s+)?(next|following|this)\s+(\p{L}+)$/u;

// ---------------------------------------------------------------------------------------
// Prompt

/** The tracker as the planner reads it: active records by kind, then recent resolutions. */
export function summarizeTracker(tracker, { calendar = null } = {}) {
    const records = tracker?.records ?? [];
    const reference = isNumber(tracker?.time) ? tracker.time : null;
    const lines = [];

    // KINDS order (agenda, event, hook, clock, beat, secret), then arc, then anything newer.
    const kinds = [...new Set([...KINDS, 'arc', ...records.map(record => record.kind)])];
    for (const kind of kinds) {
        const group = records.filter(record => record.status === 'active' && record.kind === kind);
        if (!group.length) continue;
        lines.push(`${HEADINGS[kind] ?? capitalize(kind)}:`);
        for (const record of byDate(group, { calendar, reference })) lines.push(`- ${recordLine(record)}`);
    }

    const resolved = records
        .filter(record => record.status !== 'active')
        .sort((a, b) => resolvedMessage(b) - resolvedMessage(a))
        .slice(0, RESOLVED_LIMIT);
    if (resolved.length) {
        lines.push('Resolved:');
        for (const record of resolved) {
            const reason = record.resolved?.reason ?? '';
            lines.push(`- ${record.key}${reason ? ` — ${reason}` : ''}`);
        }
    }
    return lines.length ? lines.join('\n') : '(nothing tracked yet)';
}

function recordLine(record) {
    const fields = record.fields ?? {};
    let line = record.key;
    const what = fields.now || fields.desc;
    if (what) line += ` — ${what}`;
    if (fields.then) line += ` → ${fields.then}`;
    const when = fields.on || fields.due;
    if (when) line += ` (${when})`;
    // A planned fight says so, so the next plan neither repeats nor forgets it.
    if (fields.encounter) line += ` · fight: ${fields.encounter}`;
    return line;
}

// With a calendar, the soonest first: what fires next matters most to the next arc. Undated
// records follow in tracker order (the sort is stable).
function byDate(records, { calendar, reference }) {
    if (!calendar) return records;
    const when = record => {
        const fields = record.fields ?? {};
        const text = fields.on || fields.due;
        const parsed = text ? calendar.parse(text, { reference }) : null;
        return parsed ? parsed.abs : Infinity;
    };
    return records
        .map(record => ({ record, at: when(record) }))
        .sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1))
        .map(({ record }) => record);
}

function resolvedMessage(record) {
    const value = record.resolved?.message;
    return isNumber(value) ? value : -Infinity;
}

/**
 * The planning call: the template with its macros filled as the system message, and a short
 * user turn. Unknown macros, `{{user}}` and `{{char}}` included, stay for SillyTavern.
 * `npcPlansOnly` (NPC State Delta keeps who each NPC is) adds one line to the user turn, so
 * it holds for the reader's own template too.
 */
export function buildPlannerMessages({
    template = DEFAULT_PLANNER_PROMPT,
    recent = '',
    trackerSummary = '',
    nowText = '',
    place = '',
    nearby = [],
    directorNote = '',
    genre = '',
    previousArc = '',
    npcPlansOnly = false,
} = {}) {
    const values = {
        recent,
        tracker: trackerSummary,
        now: nowText,
        place,
        nearby: Array.isArray(nearby) ? nearby.filter(Boolean).join(', ') : nearby,
        note: directorNote,
        genre,
        previous_arc: previousArc,
    };
    // An emptied template in the settings means "use the default", not "send nothing".
    const source = String(template || DEFAULT_PLANNER_PROMPT);
    // A replacer function, so a `$&` inside the story is inserted as written.
    const content = source.replace(MACRO, (whole, name) => {
        const key = name.toLowerCase();
        if (!Object.hasOwn(values, key)) return whole;
        return String(values[key] ?? '').trim() || NONE;
    });
    return [
        { role: 'system', content },
        { role: 'user', content: npcPlansOnly ? `${USER_MESSAGE} ${NPC_PLANS_ONLY}` : USER_MESSAGE },
    ];
}

// ---------------------------------------------------------------------------------------
// Reading the answer

/**
 * Reads a planner answer into `{ arc, items, errors }`. Lines it cannot read go to `errors`
 * as `{ line, text, message }` (line is 1-based in `text`); nothing is invented.
 */
export function parsePlan(text, { calendar = null, now = null } = {}) {
    const plan = { arc: null, items: [], errors: [] };
    const { body, firstLine } = planBody(String(text ?? ''));

    body.split(/\r?\n/).forEach((raw, index) => {
        const line = firstLine + index;
        const trimmed = raw.trim();
        // Fence lines are dropped; the lines between them are read like any other.
        if (CODE_FENCE.test(trimmed)) return;
        const result = readLine(trimmed);
        if (!result) return;
        if (result.error) {
            plan.errors.push({ line, text: trimmed, message: result.error });
            return;
        }
        const { kind, op } = result;
        if (kind === 'arc') {
            if (plan.arc) plan.errors.push({ line, text: trimmed, message: 'a second ARC line (the first is kept)' });
            else plan.arc = { key: op.key, desc: op.fields.desc ?? '' };
            return;
        }
        plan.items.push({
            kind,
            key: op.key,
            fields: resolveDates(op.fields, { calendar, now }),
            extra: { ...op.extra },
            raw: trimmed,
        });
    });
    return plan;
}

// The part of the answer that holds the plan. Thinking is blanked down to its newlines, so
// line numbers still point into the text the reader sees.
function planBody(text) {
    const blank = part => part.replace(/[^\n]/g, '');
    let clean = text.replace(THINK_BLOCK, blank);
    // A reasoning model whose opening tag was cut off leaves only `</think>`: all before it
    // is thinking.
    const closes = [...clean.matchAll(THINK_CLOSE)];
    if (closes.length) {
        const last = closes[closes.length - 1];
        const end = last.index + last[0].length;
        clean = blank(clean.slice(0, end)) + clean.slice(end);
    }

    const close = clean.search(PLAN_CLOSE);
    const end = close >= 0 ? close : clean.length;
    // The opening nearest the first closing tag, so "here is the <plan> block:" in prose
    // before the real block does not swallow it.
    let start = 0;
    for (const match of clean.slice(0, end).matchAll(PLAN_OPEN)) start = match.index + match[0].length;
    const firstLine = clean.slice(0, start).split('\n').length;
    return { body: clean.slice(start, end), firstLine };
}

function readLine(trimmed) {
    let text = trimmed.replace(/\*\*|__/g, '').trim();
    text = text.replace(/^#{1,6}\s+/, '').replace(BULLET, '').trim();
    // Rules (`---`), blank bullets and the like carry no words.
    if (!/[\p{L}\p{N}]/u.test(text)) return null;

    const match = text.match(LABEL);
    if (!match) return { error: 'no label (expected ARC:, BEAT:, AGENDA:, HOOK:, CLOCK: or SECRET:)' };
    const label = match[1].trim();
    const name = label.toLowerCase().replace(/[\s_-]+/g, ' ');
    const kind = LABELS[name];
    if (!kind) return { error: `unknown label "${label}"` };
    const rest = match[2].trim();
    if (!rest || SEPARATOR_FIRST.test(rest)) return { error: 'missing key' };

    // The rest is the change-line grammar, so the label becomes the kind of a `+` line.
    // `arc` may not be a change kind, so the ARC line borrows `event`; only its key and
    // description are kept.
    const { ops, errors } = parseChanges(`+ ${kind === 'arc' ? 'event' : kind} ${rest}`);
    if (!ops.length) return { error: errors[0]?.message ?? 'not readable' };
    return { kind, op: FIGHT_LABELS.has(name) ? fightBeat(ops[0]) : ops[0] };
}

// `ENCOUNTER: Ambush at the weir — 3 bandit, bandit captain (boss) | on: …`: without an
// `encounter:` part, the description is the foes; with neither, the key is (`ENCOUNTER:
// 2 x dire wolf | on: …`). A beat without foes would not be a fight at all.
function fightBeat(op) {
    const fields = { ...op.fields };
    if (!String(fields.encounter ?? '').trim()) {
        if (String(fields.desc ?? '').trim()) {
            fields.encounter = fields.desc;
            delete fields.desc;
        } else {
            fields.encounter = op.key;
        }
    }
    return { ...op, fields };
}

function resolveDates(fields, { calendar, now }) {
    const out = { ...fields };
    if (!calendar || !isNumber(now)) return out;
    for (const name of DATE_FIELDS) {
        if (!out[name]) continue;
        const resolved = resolveRelative(out[name], { calendar, now });
        if (resolved !== null) out[name] = resolved;
    }
    return out;
}

// A relative date written as a calendar date, or null when the text is not one (an absolute
// date, or something unreadable, which then stays as written).
export function resolveRelative(value, { calendar, now }) {
    const text = String(value)
        .toLowerCase()
        .replace(/["“”]/g, '')
        .replace(/,/g, ' ')
        .replace(/[.!]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();

    const span = text.match(IN_SPAN) ?? text.match(SPAN_FROM_NOW);
    if (span) {
        const unit = UNIT_MINUTES[span[2]];
        const at = now + Math.round(countOf(span[1]) * unit);
        if (!span[3]) return calendar.format(at, { era: false });
        // A time of day only fits a step of whole days ("in 2 days at dawn").
        if (unit < DAY_MINUTES) return null;
        const timed = timeOnDay(calendar, at, span[3]);
        return timed === null ? null : calendar.format(timed, { era: false });
    }

    const dayWord = text.match(DAY_WORD);
    if (dayWord) {
        const { days, time = null } = DAY_WORDS[dayWord[1]];
        return onDay(calendar, now, days, dayWord[2] ?? time);
    }

    const part = text.match(NEXT_PART);
    if (part) return onDay(calendar, now, part[1] === 'this' ? 0 : 1, part[2]);
    return null;
}

function onDay(calendar, now, days, time) {
    const day = calendar.addDays(now, days);
    // A day without a time stays a whole day ("tomorrow"), the way an absolute date without
    // a time is read; only a span ("in 2 days") keeps the hour of now.
    if (!time) return calendar.format(day, { era: false, time: false });
    const at = timeOnDay(calendar, day, time);
    return at === null ? null : calendar.format(at, { era: false });
}

// `at dusk`, `7 pm`, `in the evening` on the day of `day`. The calendar reads the time, so
// its own parts of day count; anything that is not just a time (a date) is no reading.
function timeOnDay(calendar, day, text) {
    const time = text.replace(/^(?:at|by|around|about|in the|on the)\s+/, '').trim();
    const parsed = calendar.parse(time, { reference: day });
    if (!parsed?.hasTime || String(parsed.text ?? '').trim().toLowerCase() !== time) return null;
    if (calendar.dayIndex(parsed.abs) !== calendar.dayIndex(day)) return null;
    return parsed.abs;
}

function countOf(word) {
    return Object.hasOwn(NUMBER_WORDS, word) ? NUMBER_WORDS[word] : Number(word);
}

// ---------------------------------------------------------------------------------------
// Checking and applying

/** Findings for a parsed plan, before the reader accepts it. */
export function validatePlan(plan, { calendar = null, now = null, userName = '' } = {}) {
    const findings = [];
    const push = (kind, severity, key, message) => findings.push({ kind, severity, key, message });
    const items = plan?.items ?? [];
    const reference = isNumber(now) ? now : null;

    if (!plan?.arc) push('plan-no-arc', 'error', null, 'The plan has no ARC line.');
    if (!items.length) push('plan-empty', 'error', null, 'The plan has no beats, agendas, hooks, clocks or secrets.');

    const user = userPattern(userName);
    for (const item of items) {
        const fields = item.fields ?? {};
        if (calendar) {
            for (const name of FIRE_FIELDS) {
                const value = fields[name];
                if (!value) continue;
                const parsed = calendar.parse(value, { reference });
                if (!parsed) {
                    push('plan-bad-date', 'warn', item.key, `"${item.key}": ${name} "${value}" is not a date.`);
                } else if (reference !== null && isPast(parsed, reference, calendar)) {
                    push('plan-past-date', 'warn', item.key,
                        `"${item.key}": ${name} ${value} is before now (${calendar.format(reference, { era: false })}).`);
                }
            }
        }
        // A secret about {{user}} is fine ("Ren is the heir"); a plan for them is not.
        if (user && item.kind !== 'secret' && [item.key, fields.then].some(text => user.test(text ?? ''))) {
            push('plan-user-action', 'warn', item.key,
                `"${item.key}" plans what ${userName.trim()} does; the plan is for the world and the NPCs.`);
        }
    }

    for (const error of plan?.errors ?? []) {
        push('plan-unread', 'info', null, `Line ${error.line} was not read (${error.message}): ${error.text ?? ''}`.trim());
    }
    return findings;
}

// A date without a time counts for its whole day, so "today" is never in the past.
function isPast(parsed, now, calendar) {
    if (!parsed.hasTime) return calendar.dayIndex(parsed.abs) < calendar.dayIndex(now);
    return parsed.abs < now;
}

// The name at the start, as a whole word; a possessive ("Ren's debt") is a thing, not an act.
function userPattern(name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return null;
    const body = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`^\\s*${body}(?![\\p{L}\\p{N}'’])`, 'iu');
}

/** `+` ops for an accepted plan: the arc first, then one per item, all tagged `extra.arc`. */
export function planToOps(plan, { arcId } = {}) {
    const arc = String(arcId ?? '').trim();
    if (!arc) throw new TypeError('planToOps needs an arcId');
    const ops = [];
    if (plan?.arc) {
        const fields = plan.arc.desc ? { desc: plan.arc.desc } : {};
        ops.push(addOp('arc', plan.arc.key, fields, { arc }));
    }
    for (const item of plan?.items ?? []) {
        // `after` and any other extra the planner wrote travel with the item.
        ops.push(addOp(item.kind, item.key, { ...item.fields }, { ...item.extra, arc }));
    }
    return ops;
}

function addOp(kind, key, fields, extra) {
    const op = { op: '+', kind, key, id: lineKey(key), fields, extra, reason: '' };
    return { ...op, raw: formatOp(op) };
}

// ---------------------------------------------------------------------------------------
// When to plan automatically

export const DEFAULT_STALL_DAYS = 7;
export const DEFAULT_LOW_THREADS = 3;
// (0.9.19) Replies the story must move on after a plan before "running low" may ask for
// another. Without it a discarded or failed plan would be asked for again after the very next
// reply, each time a long model call; five replies is a scene or two, long enough for the
// reader (or the world) to open something of their own first.
export const LOW_THREADS_REPLIES = 5;

/** The current arc's beats: how many are done, how many in all, and the active ones. */
export function arcBeats(tracker, arc) {
    const beats = (tracker?.records ?? []).filter(record => record.kind === 'beat' && arc && record.arc === arc.arc);
    return { done: beats.filter(record => record.status !== 'active').length, total: beats.length, active: beats.filter(record => record.status === 'active') };
}

/**
 * (0.9.19) The threads the world itself still has open: active hooks and clocks, and the
 * current arc's beats still to play. Offers (a hook with a giver, reward or quest type) are
 * left out: they wait for the reader to take them, so a story of only offers is idle. Quests
 * are the reader's, agendas run on regardless, and events, secrets and world records are
 * background, not pressure, so none of those count either.
 */
export function openThreads(tracker, arc) {
    const records = tracker?.records ?? [];
    const pressing = records.filter(record => record.status === 'active' && (record.kind === 'hook' || record.kind === 'clock') && !isOffer(record));
    return pressing.length + arcBeats(tracker, arc).active.length;
}

/**
 * Why Automatic planning should plan now, or null: 'no-arc' (the story has records but no
 * arc), 'arc-end' (every beat of the arc played out), 'stalled' (no active beat due within
 * `stallDays` story days; a beat without a date counts as due) or, since 0.9.19,
 * 'running-low' (fewer than `lowThreads` open threads, see openThreads; 0 turns it off).
 * Running low waits until `repliesSincePlan` (replies since the last plan was made) reaches
 * LOW_THREADS_REPLIES, so one thin stretch asks once, not every reply. Pure: the caller
 * passes the tracker, the current arc (the newest active one), the scene time and the
 * calendar.
 */
export function autoPlanReason({ tracker, arc = null, now = null, calendar = null, stallDays = DEFAULT_STALL_DAYS, lowThreads = DEFAULT_LOW_THREADS, repliesSincePlan = Infinity } = {}) {
    if (!arc) return tracker?.records?.length ? 'no-arc' : null;
    const { total, active } = arcBeats(tracker, arc);
    if (total && !active.length) return 'arc-end';
    if (isNumber(now) && active.length && calendar) {
        const horizon = calendar.addDays(now, Number(stallDays) || DEFAULT_STALL_DAYS);
        const upcoming = active.some(beat => {
            const date = beat.fields?.on ? calendar.parse(beat.fields.on, { reference: now }) : null;
            return !date || date.abs <= horizon;
        });
        if (!upcoming) return 'stalled';
    }
    // (0.9.19) Running low: the arc's last beats may be far off with nothing else open.
    const low = Number(lowThreads);
    const threshold = Number.isFinite(low) && low >= 0 ? low : DEFAULT_LOW_THREADS;
    if (threshold > 0 && Number(repliesSincePlan) >= LOW_THREADS_REPLIES && openThreads(tracker, arc) < threshold) return 'running-low';
    return null;
}

// ---------------------------------------------------------------------------------------

function capitalize(text) {
    const value = String(text ?? '');
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The Director's note after an arc it shaped is accepted (0.8.7): '' (used once), unless the
 * reader keeps it for every plan, or changed it after the plan was made (then their new note
 * is for the next one). `current` is the note now, `used` the one the plan was made with.
 */
export function noteAfterAccept(current, used, { keep = false } = {}) {
    const now = String(current ?? '');
    if (keep || !String(used ?? '').trim()) return now;
    return now.trim() === String(used).trim() ? '' : now;
}
