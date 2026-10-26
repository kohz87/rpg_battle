// Story Director v2, chronicle part: its queries (pure), for the Chronicle screen and for other
// modules (NPC State Delta may link its NPCs to factions by name later).
//
// Times are written on the chat's calendar: the tracker's `director.calendar` query through
// `tools.query` (the reader's, else the enabled pack's, else Gregorian), Gregorian without it.
// "How long ago" is counted from the Director's clock (`director.time`, else the `director`
// domain). Every answer is a plain copy.

import { PRESETS, makeCalendar } from '../../calendar.js';
import { findIn, isOpen, keyOf, orderedEvents, orderedFactions } from './domain.js';
import { DIGEST_FEATURE, dayFacts, dayOf, digestOut, entryOf, orderedDays, questLogOf, walkDays } from './days.js';

// A query of the day digest only (MODULES §F100): tagged with its feature, so Story Block answers null
// while the reader has the digest off (B-c2-2). An older host without features keeps it on.
const digestOnly = fn => Object.assign((state, args, tools) => fn(state, args, tools), { feature: DIGEST_FEATURE });

const isInt = value => Number.isSafeInteger(value);
const toolsQuery = tools => (typeof tools?.query === 'function' ? (name, args) => tools.query(name, args) : typeof tools === 'function' ? tools : null);

function ask(query, name, args) {
    if (typeof query !== 'function') return null;
    try {
        return query(name, args) ?? null;
    } catch {
        return null;
    }
}

/** The chat's calendar (makeCalendar) through `director.calendar`, else Gregorian. */
export function calendarFrom(query) {
    const config = ask(query, 'director.calendar', {});
    try {
        return makeCalendar(config && typeof config === 'object' ? config : PRESETS.gregorian);
    } catch {
        return makeCalendar(PRESETS.gregorian);
    }
}

/** The Director's clock in story minutes (null while unset): `director.time`, else the state. */
export function nowFrom(query, state) {
    const asked = ask(query, 'director.time', {});
    if (isInt(asked?.minutes)) return asked.minutes;
    const minutes = state?.domains?.director?.time?.minutes;
    return isInt(minutes) ? minutes : null;
}

/** "this hour", "5 h ago", "3 days ago", "2 weeks ago", "4 months ago"; '' for an unknown span. */
export function agoText(minutes) {
    if (!isInt(minutes) || minutes < 0) return '';
    if (minutes < 60) return 'this hour';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(minutes / 1440);
    if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
    const months = Math.floor(days / 30);
    return months < 24 ? `${months} months ago` : `${Math.floor(days / 365)} years ago`;
}

function dateText(calendar, minutes) {
    if (!isInt(minutes)) return '';
    try {
        return calendar.format(minutes);
    } catch {
        return '';
    }
}

/** An event as the queries give it. */
export function eventOut(event, { chronicle, calendar, now }) {
    const factions = (event.factions ?? []).map(name => ({ name, id: findIn(chronicle?.factions, name)?.id ?? null }));
    return {
        id: event.id,
        name: event.name,
        summary: event.summary,
        state: event.state,
        open: isOpen(event),
        place: event.place,
        factions,
        factionsText: factions.map(entry => entry.name).join(', '),
        since: event.since,
        updated: event.updated,
        sinceText: dateText(calendar, event.since),
        updatedText: dateText(calendar, event.updated),
        updatedAgo: isInt(now) && isInt(event.updated) ? agoText(now - event.updated) : '',
        aka: [...(event.aka ?? [])],
        rev: event.rev,
    };
}

/** A faction as the queries give it, with the open events that name it. */
export function factionOut(faction, { chronicle }) {
    const names = [faction.name, ...(faction.aka ?? [])].map(keyOf);
    const events = orderedEvents(chronicle).filter(event => isOpen(event) && (event.factions ?? []).some(name => names.includes(keyOf(name))))
        .map(event => ({ id: event.id, name: event.name, state: event.state }));
    return {
        id: faction.id,
        name: faction.name,
        summary: faction.summary,
        area: faction.area,
        stance: faction.stance,
        events,
        eventsText: events.map(event => event.name).join(', '),
        aka: [...(faction.aka ?? [])],
        rev: faction.rev,
    };
}

function setup(state, tools) {
    const query = toolsQuery(tools);
    const chronicle = state?.domains?.chronicle ?? { events: {}, factions: {} };
    return { chronicle, calendar: calendarFrom(query), now: nowFrom(query, state) };
}

/** `chronicle.board`: what the Chronicle screen shows, worked out ahead (a template cannot sort or count). */
export function chronicleBoard(state, _args, tools) {
    const env = setup(state, tools);
    const events = orderedEvents(env.chronicle).map(event => eventOut(event, env));
    const open = events.filter(event => event.open);
    const resolved = events.filter(event => !event.open);
    const factions = orderedFactions(env.chronicle).map(faction => factionOut(faction, env));
    return {
        open, resolved, factions,
        hasOpen: open.length > 0, hasResolved: resolved.length > 0, hasFactions: factions.length > 0,
        openCount: open.length, resolvedCount: resolved.length, factionCount: factions.length,
        now: dateText(env.calendar, env.now),
    };
}

const substituteOf = tools => (typeof tools?.substitute === 'function' ? value => {
    try {
        const out = tools.substitute(value);
        return typeof out === 'string' ? out : String(value ?? '');
    } catch {
        return String(value ?? '');
    }
} : value => String(value ?? ''));

const dayArg = value => (value === null || value === undefined || value === '' ? null : Number.isSafeInteger(Number(value)) ? Number(value) : NaN);

/**
 * The day digests kept, oldest first, as `chronicle.days` gives them; `from` and `to` (story day
 * numbers, `time.now`'s `day`, both inclusive) keep a range. Null for an argument that is not a day.
 */
export function daysQuery(state, { from = null, to = null } = {}, tools) {
    const low = dayArg(from);
    const high = dayArg(to);
    if (Number.isNaN(low) || Number.isNaN(high)) return null;
    const currency = ask(toolsQuery(tools), 'inventory.currency', {});
    const substitute = substituteOf(tools);
    return orderedDays(state?.domains?.chronicle, { state, currency })
        .filter(digest => (low === null || digest.day >= low) && (high === null || digest.day <= high))
        .map(digest => digestOut(digest, { currency, substitute }));
}

/**
 * One day as the Journal (and the older Days screen) lists it: the digest (digestOut) with its fact lines,
 * the line without its date, and the text the search box looks in.
 */
export function boardDay(digest) {
    const quests = digest.quests;
    const met = Array.isArray(digest.met) ? digest.met : [];
    const facts = [
        digest.places.length ? `Went to: ${digest.places.join(', ')}` : '',
        quests.taken.length ? `Took on: ${quests.taken.join(', ')}` : '',
        quests.done.length ? `Finished: ${quests.done.join(', ')}` : '',
        quests.failed.length ? `Failed: ${quests.failed.join(', ')}` : '',
        quests.dropped.length ? `Gave up: ${quests.dropped.join(', ')}` : '',
        digest.fightText ? `Fights: ${digest.fightText}` : '',
        digest.moneyText ? `Money: ${digest.moneyText}` : '',
    ].filter(Boolean);
    const search = [digest.date, digest.line, ...digest.happened, ...digest.places, ...Object.values(quests).flat(), ...digest.npcs, ...digest.world, ...met].join(' \u2022 ');
    // The line starts with its date (made for the [Yesterday] tail); the screen shows the date beside it.
    const short = digest.date && digest.line.startsWith(`${digest.date}: `) ? digest.line.slice(digest.date.length + 2) : digest.line;
    return { ...digest, met, short, facts, hasFacts: facts.length > 0, hasHappened: digest.happened.length > 0, hasNpcs: digest.npcs.length > 0, hasWorld: digest.world.length > 0, hasMet: met.length > 0, search };
}

/** `chronicle.dayBoard`: every day digest, newest first, as the Journal lists them (boardDay). */
export function dayBoard(state, _args, tools) {
    const env = setup(state, tools);
    const days = (daysQuery(state, {}, tools) ?? []).reverse().map(boardDay);
    const now = env.now;
    return { days, hasDays: days.length > 0, count: days.length, today: Number.isSafeInteger(now) ? dateText(env.calendar, now) : '' };
}

/**
 * `chronicle.dayFacts { before }`: what the stored receipts say about each story day before day
 * `before` (all days when it is not given), worked out now and saved nowhere: `{ days: [{ day, facts,
 * revs }], settle: { from, to } | null }`. The digest command writes its digests from it.
 */
export function dayFactsQuery(state, { before = null } = {}, tools) {
    let entries = [];
    try { entries = typeof tools?.receipts === 'function' ? tools.receipts() ?? [] : []; } catch { entries = []; }
    const walk = walkDays(entries);
    const limit = Number.isSafeInteger(before) ? before : null;
    const days = [...walk.days.keys()].filter(day => limit === null || day < limit).sort((a, b) => a - b).map(day => {
        const receipts = walk.days.get(day);
        return { day, facts: dayFacts(receipts, { revDay: walk.revs, state, day }), revs: receipts.map(receipt => receipt.rev).filter(Number.isSafeInteger) };
    }).filter(entry => entry.facts.count > 0);
    return { days, settle: walk.settle ? { ...walk.settle } : null, today: Number.isSafeInteger(walk.minutes) ? dayOf(walk.minutes) : null };
}

/**
 * `chronicle.noteFacts { after, minutes }`: what the receipts committed after revision `after` hold
 * (fresh: Story Block still keeps their data), by story day, the clock at `minutes` before them:
 * `{ entries: [{ day, entry }], minutes, rev, settle }` (the clock and the last revision after them,
 * and the last time settle's jump among them). The note command keeps the entries (digest.js).
 */
export function noteFactsQuery(_state, { after = null, minutes = null } = {}, tools) {
    let list = [];
    try { list = typeof tools?.receipts === 'function' ? tools.receipts() ?? [] : []; } catch { list = []; }
    const walk = walkDays(list, { after: Number.isSafeInteger(after) ? after : null, minutes });
    const entries = [...walk.days.keys()].sort((a, b) => a - b).map(day => ({ day, entry: entryOf(walk.days.get(day), day) }));
    const revs = [...walk.revs.keys()];
    // The receipts that touched a quest or thread (their own commands' `data.quest`, their lines'
    // `data.thread`), for the quest history (quest.details), kept by the note before the trim.
    const quests = [];
    for (const item of Array.isArray(list) ? list : []) {
        const receipt = item?.receipt ?? item;
        if (!receipt || !Number.isSafeInteger(receipt.rev) || (Number.isSafeInteger(after) && receipt.rev <= after)) continue;
        const thread = typeof receipt.data?.quest === 'string' ? receipt.data.quest : typeof receipt.data?.thread === 'string' ? receipt.data.thread : null;
        const said = typeof receipt.summary === 'string' ? receipt.summary.trim() : '';
        if (thread && said) quests.push({ rev: receipt.rev, thread, text: said });
        // Turn-ins a later Director line settled (tracker/quest-lines.js withSettled): each quest's history too.
        for (const item of Array.isArray(receipt.data?.settled) ? receipt.data.settled : []) {
            if (typeof item?.quest === 'string' && item.quest !== thread && said) quests.push({ rev: receipt.rev, thread: item.quest, text: said });
        }
    }
    return { entries, quests, minutes: walk.minutes, rev: revs.length ? Math.max(...revs) : null, settle: walk.settle ? { ...walk.settle } : null };
}

export const queries = {
    /**
     * The world events, open first (newest news first), then resolved: `[{ id, name, summary, state,
     * open, place, factions: [{ name, id|null }], factionsText, since, updated, sinceText,
     * updatedText, updatedAgo, aka, rev }]`. `state` keeps one state; `open: true|false` open or resolved ones.
     */
    'chronicle.events': (state, { state: only = null, open = null } = {}, tools) => {
        const env = setup(state, tools);
        return orderedEvents(env.chronicle)
            .filter(event => (!only || event.state === only) && (open === null || isOpen(event) === open))
            .map(event => eventOut(event, env));
    },
    /** One world event by `id` or `name` (or a name it had), or null. */
    'chronicle.event': (state, { id = null, name = null } = {}, tools) => {
        const env = setup(state, tools);
        const found = findIn(env.chronicle.events, id ?? name);
        return found ? eventOut(found, env) : null;
    },
    /** The factions by name: `[{ id, name, summary, area, stance, events: [{ id, name, state }], eventsText, aka, rev }]`. */
    'chronicle.factions': (state, _args, tools) => {
        const env = setup(state, tools);
        return orderedFactions(env.chronicle).map(faction => factionOut(faction, env));
    },
    /** One faction by `id` or `name` (or a name it had), or null. */
    'chronicle.faction': (state, { id = null, name = null } = {}, tools) => {
        const env = setup(state, tools);
        const found = findIn(env.chronicle.factions, id ?? name);
        return found ? factionOut(found, env) : null;
    },
    'chronicle.board': chronicleBoard,
    /** The day digests kept, oldest first (`daysQuery`): other modules' and the fold history's. */
    'chronicle.days': digestOnly(daysQuery),
    /** One day's digest by its day number, or null. */
    'chronicle.day': digestOnly((state, { day = null } = {}, tools) => {
        const wanted = dayArg(day);
        if (wanted === null || Number.isNaN(wanted)) return null;
        return daysQuery(state, { from: wanted, to: wanted }, tools)?.[0] ?? null;
    }),
    'chronicle.dayBoard': digestOnly(dayBoard),
    'chronicle.dayFacts': digestOnly(dayFactsQuery),
    'chronicle.noteFacts': noteFactsQuery,
    /** The kept history of a quest or thread `id`: `[{ rev, text }]`, oldest first (the last few). */
    'chronicle.questLog': (state, { id = null } = {}) => questLogOf(state?.domains?.chronicle, id),
};
