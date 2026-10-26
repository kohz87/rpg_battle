// Story Director v2, part **world**: the Journal, the World screen's second view (pure, worked out on read).
//
// One entry per story day, newest first: where {{user}} went, who they met, the news they learned, the
// quests they took on and finished (failed, gave up), the fights and money of the day, NPC State Delta's
// stage moves, and what else the story was told. It is the day digest's data (chronicle/days.js, feature
// `story-director.digest`, through `chronicle.dayBoard`), which the Days screen showed before, plus the day
// still under way ("today so far", and a day just ended whose digest is not written yet), read from the
// same day-facts entries the digest will be written from (`chronicle.dayFacts`, and the receipts since the
// last note through `chronicle.noteFacts`), so nothing new is stored. Only what {{user}} knows (known.js): a line naming
// a secret or an arc, or an arc planner's own line in an older digest, is left out. While the digest is off
// the Journal says so and shows nothing.

import { boardDay } from '../chronicle/queries.js';
import { dayLine, dayOf, digestOut, entriesByDay, factsOf, makeDigest, notedOf, orderedDays, rangeDays } from '../chronicle/days.js';
import { calendarFrom, hiddenNames, namesHidden, nowFrom, queryOf, tryQuery } from './known.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);
const list = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);

const substituteOf = tools => (typeof tools?.substitute === 'function' ? value => {
    try {
        const out = tools.substitute(value);
        return typeof out === 'string' ? out : String(value ?? '');
    } catch {
        return String(value ?? '');
    }
} : value => String(value ?? ''));

// The days not written yet (the day under way, and a day just ended whose digest the next reply writes),
// from the day-facts entries kept for them and the receipts since the last note (`chronicle.noteFacts`,
// what the next note will keep): as their digests will be written. `written`: the days the board has.
function pending(state, tools, { calendar, now, written }) {
    const chronicle = state?.domains?.chronicle;
    const byDay = entriesByDay(chronicle);
    const fresh = new Map();
    const noted = notedOf(chronicle);
    const plan = tryQuery(queryOf(tools), 'chronicle.noteFacts', { after: isInt(noted?.rev) ? noted.rev : null, minutes: isInt(noted?.minutes) ? noted.minutes : null }, null);
    for (const item of Array.isArray(plan?.entries) ? plan.entries : []) {
        if (!isInt(item?.day) || !isRecord(item.entry) || !(item.entry.count > 0)) continue;
        if (!fresh.has(item.day)) fresh.set(item.day, []);
        fresh.get(item.day).push(item.entry);
    }
    const days = [...new Set([...byDay.keys(), ...fresh.keys()])].filter(day => !written.has(day) && (!isInt(now) || day <= dayOf(now))).sort((a, b) => b - a);
    if (!days.length) return [];
    const dayOfRev = rangeDays(byDay);
    const currency = tryQuery(queryOf(tools), 'inventory.currency', {}, null);
    const out = [];
    for (const day of days) {
        const entries = [...(byDay.get(day) ?? []).map(item => item.entry), ...(fresh.get(day) ?? [])];
        const facts = factsOf(entries, { state, day, dayOfRev });
        if (!facts.count) continue;
        let date = '';
        try { date = calendar.format(day * 1440, { time: false }); } catch { date = ''; }
        const digest = makeDigest(day, facts, { date, currency, revs: facts.revs });
        out.push({ ...boardDay(digestOut(digest, { currency, substitute: substituteOf(tools) })), today: isInt(now) && day === dayOf(now) });
    }
    return out;
}

/** One board day with what {{user}} must not see taken out, its line, facts and search text made again. */
export function knownDay(entry, hidden) {
    const drop = line => namesHidden(line, hidden.words) || namesHidden(line, hidden.behind);
    const happened = list(entry.happened).filter(line => !namesHidden(line, hidden.words));
    const world = list(entry.world).filter(line => !drop(line));
    const met = list(entry.met);
    const npcs = list(entry.npcs);
    const quests = isRecord(entry.quests) ? entry.quests : { taken: [], done: [], failed: [], dropped: [] };
    const removed = list(entry.happened).length - happened.length;
    let short = String(entry.short ?? '');
    if (entry.brief) {
        if (namesHidden(short, hidden.words)) short = '';
    } else if (removed || world.length !== list(entry.world).length || namesHidden(short, hidden.words)) {
        // The line is made of the facts (days.js dayLine); made again from what is left.
        const line = dayLine(entry.date, { places: list(entry.places), quests, fights: entry.fights ?? { count: 0 }, money: entry.money ?? { in: 0, out: 0 }, npcs, world, happened, count: Math.max(0, (entry.count ?? 0) - removed) });
        short = entry.date && line.startsWith(`${entry.date}: `) ? line.slice(entry.date.length + 2) : line;
    }
    const search = [entry.date, short, ...happened, ...list(entry.places), ...Object.values(quests).flatMap(list), ...npcs, ...world, ...met].join(' • ');
    return {
        day: entry.day,
        date: String(entry.date ?? ''),
        today: entry.today === true,
        brief: entry.brief === true,
        short,
        facts: list(entry.facts),
        happened,
        more: isInt(entry.more) ? entry.more : 0,
        world,
        met,
        npcs,
        hasFacts: list(entry.facts).length > 0,
        hasHappened: happened.length > 0,
        hasWorld: world.length > 0,
        hasMet: met.length > 0,
        hasNpcs: npcs.length > 0,
        search,
    };
}

/**
 * `director.journal` → `{ on, days: [day], hasDays, count, today }`: `on` is false while the day digest is
 * off (Features), and then there are no days. Each day: `{ day, date, today, brief, short, facts, happened,
 * more, world, met, npcs, has…, search }` (knownDay), newest first, today's first when it has anything.
 */
export function journalView(state, _args, tools) {
    const query = queryOf(tools);
    const board = tryQuery(query, 'chronicle.dayBoard', {}, null);
    if (!isRecord(board) || !Array.isArray(board.days)) return { on: false, days: [], hasDays: false, count: 0, today: '' };
    const calendar = calendarFrom(query);
    const now = nowFrom(query, state);
    const hidden = hiddenNames(state);
    const days = board.days.filter(isRecord);
    const open = pending(state, tools, { calendar, now, written: new Set(days.map(day => day.day)) });
    const out = [...open, ...days].sort((a, b) => b.day - a.day).map(day => knownDay(day, hidden));
    return { on: true, days: out, hasDays: out.length > 0, count: out.length, today: String(board.today ?? '') };
}

// ---- one day, for other modules (contract §3: journal.day) ----------------------------------------------------------------

const LINES = 12;
const LINE = 240;
const oneLine = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, LINE);

/** The lines a known day gives, newest facts first as the Journal reads them: its line, the facts, what happened, the news, who was met. */
function linesOf(entry) {
    const out = [];
    if (entry.short) out.push(entry.short);
    out.push(...list(entry.facts), ...list(entry.happened), ...list(entry.world));
    if (list(entry.met).length) out.push(`Met: ${list(entry.met).join(', ')}`);
    out.push(...list(entry.npcs));
    return [...new Set(out.map(oneLine).filter(Boolean))].slice(0, LINES);
}

/**
 * `journal.day({ day, snapshot? }) -> { day, title, lines, source: 'digest' | 'facts' | 'snapshot', missing }` (contract §3): one story day
 * for a module that wants its recap (RPG Battle's save points, the wake after a return). It works whether or not the Journal screen or the
 * day digest is on: the visible digest first, else the visible facts of the day (the receipts the digest would be written from), else the
 * saved visible scene of `snapshot`. At most twelve lines of 240 characters; what {{user}} must not know (a secret, an arc) is left
 * out as the Journal leaves it out, and no hidden event is recapped. A day with none of these is `missing: true`, titled `Day <day>`, with
 * the saved scene's line or `[]`. Null for a day that is not a whole number of the contract's `Day` (floor(minutes / 1440); the story clock may be
 * negative, so a day before the first is a day).
 */
const DAY_MIN = -6254999482460;
const DAY_MAX = 6254999482459;

export function journalDay(state, { day, snapshot = null } = {}, tools) {
    if (!isInt(day) || day < DAY_MIN || day > DAY_MAX) return null;
    const query = queryOf(tools);
    const calendar = calendarFrom(query);
    const now = nowFrom(query, state);
    const hidden = hiddenNames(state);
    const currency = tryQuery(query, 'inventory.currency', {}, null);
    const title = date => (date ? `Day ${day} · ${date}` : `Day ${day}`).slice(0, 80);
    const digest = orderedDays(state?.domains?.chronicle, { state, currency }).find(item => item.day === day);
    if (digest) {
        const entry = knownDay(boardDay(digestOut(digest, { currency, substitute: substituteOf(tools) })), hidden);
        const lines = linesOf(entry);
        if (lines.length) return { day, title: title(entry.date), lines, source: 'digest', missing: false };
    }
    const facts = pending(state, tools, { calendar, now, written: new Set() }).find(item => item.day === day);
    if (facts) {
        const entry = knownDay(facts, hidden);
        const lines = linesOf(entry);
        if (lines.length) return { day, title: title(entry.date), lines, source: 'facts', missing: false };
    }
    // The saved visible scene of a save point: its own journal for the day, else its scene's line.
    const point = typeof snapshot === 'string' && snapshot ? (tryQuery(query, 'savepoint.list', {}, []) ?? []).find(item => isRecord(item) && item.id === snapshot) : null;
    const saved = list(point?.journal?.day === day ? point.journal.lines : []).map(oneLine).filter(line => line && !namesHidden(line, hidden.words) && !namesHidden(line, hidden.behind)).slice(0, LINES);
    if (saved.length) return { day, title: title(''), lines: saved, source: 'snapshot', missing: false };
    const scene = oneLine(point?.scene?.text);
    const visible = scene && !namesHidden(scene, hidden.words) && !namesHidden(scene, hidden.behind) ? [scene] : [];
    return { day, title: `Day ${day}`, lines: visible, source: 'snapshot', missing: true };
}
