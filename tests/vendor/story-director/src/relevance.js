// Story Director: relevance (pure).
//
// Decides, for one point in the story, which tracked records the next reply needs to know
// about: what is due or arriving, what is relevant (and in which order, so the note can drop
// the least important first), what sits on the dormant shelf, and which secrets to guard.
// Dormancy is derived here every time and never stored on the record.

export const DEFAULTS = { budgetTokens: 1000, dormantReplies: 15, dormantDays: 30, dueSoonDays: 3 };

// Fields that hold a date the story can reach.
const DATE_FIELDS = ['on', 'due', 'arrive'];
const FIRE_FIELDS = ['on', 'due'];

// Records resolved this recently (in messages) are still worth showing in the tab.
const RESOLVED_RECENT_MESSAGES = 5;
// Records changed this recently (in messages) are relevant (priority 5).
const CHANGED_RECENT_MESSAGES = 3;
// Shorter names than this match too much by accident ("Al" inside every "also").
const MIN_NAME_LENGTH = 3;

const DAY_MINUTES = 1440;

export function estimateTokens(text) {
    return Math.ceil(String(text ?? '').length / 4);
}

export function dateOf(record, field, { calendar, reference = null } = {}) {
    const text = record?.fields?.[field];
    if (!calendar || typeof text !== 'string' || !text.trim()) return null;
    return calendar.parse(text, { reference }) ?? null;
}

// A date without a time counts for its whole day, so "Haywane 12" is reached as soon as it
// is Haywane 12 at any hour; a date with a time is reached at that minute.
function reachedBy(parsed, limit, calendar) {
    if (!parsed) return false;
    if (!parsed.hasTime) return calendar.dayIndex(parsed.abs) <= calendar.dayIndex(limit);
    return parsed.abs <= limit;
}

function anyReached(record, fields, limit, { calendar, now }) {
    if (!calendar || !isNumber(limit) || !isNumber(now)) return false;
    return fields.some(field => reachedBy(dateOf(record, field, { calendar, reference: now }), limit, calendar));
}

export function isDue(record, { calendar, now }) {
    if (!isActive(record)) return false;
    return anyReached(record, FIRE_FIELDS, now, { calendar, now });
}

export function isArriving(record, { calendar, now }) {
    if (!isActive(record)) return false;
    return anyReached(record, ['arrive'], now, { calendar, now });
}

// (0.9.19) How far the story time must move forward between two replies (a night's sleep,
// days on the road) for the note to tell what came due in between as one recap, "While away",
// instead of a pile of Due now items the scene never lived through. Twelve hours: an evening
// meal or an afternoon's ride is a scene going on; a night or more is time skipped.
export const AWAY_GAP_MINUTES = 12 * 60;

/**
 * What came due while the story skipped ahead: the records of `selection.due` and `.arriving`
 * whose date fell inside (`from`, `to`], when the story time moved forward by at least
 * `minMinutes` from `from` (the time before the latest reply) to `to` (the selection's now).
 * A record already due or arriving at `from` is not in it: it was waiting before the jump and
 * stays on Due now. Plain `{ from, to, due, arriving }`, or null with no such jump. Secrets are
 * never due, so they never come up here.
 */
export function awayIn(selection, { calendar, from = null, to = selection?.now ?? null, minMinutes = AWAY_GAP_MINUTES } = {}) {
    if (!calendar || !isNumber(from) || !isNumber(to)) return null;
    const gap = Number(minMinutes) >= 0 ? Number(minMinutes) : AWAY_GAP_MINUTES;
    if (to - from < gap || to <= from) return null;
    const before = { calendar, now: from };
    const due = (selection?.due ?? []).filter(record => record?.kind !== 'secret' && !isDue(record, before) && deadlinePassed(record, { calendar, to }));
    const arriving = (selection?.arriving ?? []).filter(record => record?.kind !== 'secret' && !isArriving(record, before));
    return { from, to, due, arriving };
}

// A quest's due is a deadline that runs to the end of its day (as the note writes it, 0.9.12):
// one due later today has not passed yet, so it stays on Due now as reached. Anything else, or
// a quest with no readable deadline, passes.
function deadlinePassed(record, { calendar, to }) {
    if (record?.kind !== 'quest') return true;
    const parsed = dateOf(record, 'due', { calendar, reference: to });
    if (!parsed) return true;
    const end = parsed.hasTime ? parsed.abs : calendar.addDays(calendar.dayIndex(parsed.abs) * DAY_MINUTES, 1) - 1;
    return end <= to;
}

// Something due (or overdue) within dueSoonDays keeps a record awake.
function dueSoon(record, { calendar, now, days }) {
    if (!calendar || !isNumber(now)) return false;
    return anyReached(record, DATE_FIELDS, calendar.addDays(now, days), { calendar, now });
}

export function isDormant(record, { calendar, now = null, message = null, settings = DEFAULTS } = {}) {
    if (!isActive(record) || record.pinned) return false;
    const { dormantReplies, dormantDays, dueSoonDays } = { ...DEFAULTS, ...settings };
    if (dueSoon(record, { calendar, now, days: dueSoonDays })) return false;

    const seen = record.seen ?? {};
    const quietReplies = isNumber(message) && isNumber(seen.message) && message - seen.message >= dormantReplies;
    const quietDays = isNumber(now) && isNumber(seen.time) && (now - seen.time) / DAY_MINUTES >= dormantDays;
    return quietReplies || quietDays;
}

export function classify(tracker, {
    calendar,
    now = null,
    message,
    place = '',
    sceneText = '',
    recentText = '',
    settings = DEFAULTS,
} = {}) {
    const records = tracker?.records ?? [];
    const current = isNumber(message) ? message : tracker?.message ?? -1;
    const options = { calendar, now, message: current, settings: { ...DEFAULTS, ...settings } };
    const text = `${sceneText ?? ''}\n${recentText ?? ''}`;

    // The current arc: the newest active one. Its beats come first; it is shown on its own.
    const arc = records
        .filter(record => isActive(record) && record.kind === 'arc')
        .sort((a, b) => (b.created?.message ?? -1) - (a.created?.message ?? -1))[0] ?? null;

    const selection = {
        now,
        place,
        arc,
        due: [],
        arriving: [],
        relevant: [],
        dormant: [],
        secrets: [],
        resolvedRecently: [],
    };

    records.forEach((record, index) => {
        if (!isActive(record)) {
            const resolved = record.resolved;
            if (resolved && isNumber(resolved.message) && current - resolved.message < RESOLVED_RECENT_MESSAGES) {
                selection.resolvedRecently.push(record);
            }
            return;
        }
        if (record.kind === 'arc') return;
        // Secrets are guarded, never listed as facts.
        if (record.kind === 'secret') {
            selection.secrets.push(record);
            return;
        }

        const due = isDue(record, options);
        const arriving = isArriving(record, options);
        if (due) selection.due.push(record);
        if (arriving) selection.arriving.push(record);
        if (due || arriving) return;

        // Priorities 1-5 also wake a dormant record (the scene mentions it, it is at this
        // place, ...); only "everything else" stays on the shelf.
        const match = matchPriority(record, { place, text, message: current, arc });
        if (match) {
            selection.relevant.push({ record, ...match, index });
        // An accepted quest never goes quiet on its own: it is a promise {{user}} made.
        } else if (record.kind !== 'quest' && isDormant(record, options)) {
            selection.dormant.push(record);
        } else {
            selection.relevant.push({ record, reason: 'active', priority: 6, index });
        }
    });

    // Within a priority, the most recently seen first, so the budget drops stale ones first.
    selection.relevant.sort((a, b) =>
        a.priority - b.priority
        || seenMessage(b.record) - seenMessage(a.record)
        || a.index - b.index);
    selection.relevant = selection.relevant.map(({ record, reason, priority }) => ({ record, reason, priority }));
    return selection;
}

function matchPriority(record, { place, text, message, arc = null }) {
    const fields = record.fields ?? {};
    if (record.kind === 'clock' && /sign|warning/i.test(fields.shown ?? '')) {
        return { reason: 'shown', priority: 1 };
    }
    // The current arc's beats; with no planned arc, every active beat counts as current.
    if (record.kind === 'beat' && (!arc || !record.arc || record.arc === arc.arc)) return { reason: 'beat', priority: 2 };
    if (placeMatches(record, place)) return { reason: 'place', priority: 3 };
    if (mentioned(record, text)) return { reason: 'mentioned', priority: 4 };
    const changed = record.changed?.message;
    if (isNumber(changed) && message - changed < CHANGED_RECENT_MESSAGES) {
        return { reason: 'changed', priority: 5 };
    }
    return null;
}

// "Auvoth" matches a record placed at "Auvoth, Canal Street", and the other way round; the
// place may also only be written inside now or leg.
function placeMatches(record, place) {
    const here = normalize(place);
    if (here.length < MIN_NAME_LENGTH) return false;
    const fields = record.fields ?? {};
    return [fields.place, fields.now, fields.leg].some(value => {
        const there = normalize(value);
        return there.length >= MIN_NAME_LENGTH && (there.includes(here) || here.includes(there));
    });
}

function mentioned(record, text) {
    if (!text.trim()) return false;
    const names = [record.key, ...String(record.fields?.people ?? '').split(','), ...String(record.fields?.giver ?? '').split(',')]
        .map(name => String(name ?? '').trim())
        .filter(name => name.length >= MIN_NAME_LENGTH);
    return names.some(name => wordPattern(name).test(text));
}

// Word boundaries that work for accented names too (\b is ASCII-only).
function wordPattern(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

function normalize(value) {
    return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function seenMessage(record) {
    const value = record.seen?.message;
    return isNumber(value) ? value : -Infinity;
}

function isActive(record) {
    return record?.status === 'active';
}

function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

// ---------------------------------------------------------------------------------------
// Encounters: planned fights, for other extensions (RPG Battle offers "Fight?" with them)

function encounterText(record) {
    return String(record?.fields?.encounter ?? '').trim();
}

// When the fight comes: a clock fires at its due, everything else at its on. A quest's due
// is a deadline, not a fight, so a quest's fight is soon only by its on.
function fightDate(record) {
    const fields = record.fields ?? {};
    return record.kind === 'clock' ? fields.due || fields.on || '' : fields.on || '';
}

/**
 * The planned fights a Selection holds: due ones first, then arriving ones (both
 * `status: 'due'`), then relevant ones whose date falls within `dueSoonDays` (`'soon'`).
 * Each is `{ key, id, kind, encounter, place, on, status }`, `on` being the date as written.
 * Story Director never resolves a fight; it only says which ones the story has reached.
 */
export function encountersIn(selection, { calendar = null, now = null, dueSoonDays = DEFAULTS.dueSoonDays, message = null } = {}) {
    const out = [];
    const listed = new Set();
    // (0.9.18) `reached`: the reply at `message` fired the record (`! Key — …`): the scene got to
    // the fight. Due is the world's schedule; a fight the reader's character is not there for
    // happens off-screen and comes in as news, so only a reached one should become a fight.
    const reachedIn = record => isNumber(message) && (record.history ?? []).some(entry => entry?.message === message && entry?.op === '!');
    const add = (record, status, on) => {
        const encounter = encounterText(record);
        if (!encounter || listed.has(record.id)) return;
        listed.add(record.id);
        out.push({ key: record.key, id: record.id, kind: record.kind, encounter, place: String(record.fields?.place ?? '').trim(), on: String(on ?? '').trim(), status, reached: reachedIn(record) });
    };
    // A fight fired in this reply first: firing clears its date, so it may be due no longer.
    for (const record of ['due', 'arriving', 'relevant', 'dormant'].flatMap(list => (selection?.[list] ?? []).map(entry => entry?.record ?? entry))) {
        if (record && reachedIn(record)) add(record, 'due', fightDate(record) || record.fields?.due || record.fields?.on);
    }
    for (const record of selection?.due ?? []) add(record, 'due', fightDate(record) || record.fields?.due);
    for (const record of selection?.arriving ?? []) add(record, 'due', record.fields?.arrive);

    if (calendar && isNumber(now)) {
        const days = Number(dueSoonDays) >= 0 ? Number(dueSoonDays) : DEFAULTS.dueSoonDays;
        const limit = calendar.addDays(now, days);
        // The soonest first: that is the fight the story reaches next.
        const soon = [];
        for (const { record } of selection?.relevant ?? []) {
            const on = fightDate(record);
            if (!on || !encounterText(record)) continue;
            const parsed = calendar.parse(on, { reference: now });
            if (reachedBy(parsed, limit, calendar)) soon.push({ record, on, at: parsed.abs });
        }
        soon.sort((a, b) => a.at - b.at);
        for (const { record, on } of soon) add(record, 'soon', on);
    }
    return out;
}
