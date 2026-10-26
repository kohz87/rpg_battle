// Story Director v2, part **world**: what the player character knows, worked out on read (pure). Nothing
// here is stored: every answer comes from the state it is given and the queries of the other parts and
// modules (through `tools.query`), so a swipe, a middle delete or a reload shows the same as a rebuild.
//
// What {{user}} knows ("PC-known"), exactly:
// * Here: the scene's place (Story Director's map place, `atlas.here`, else Story Block's `scene.place`)
//   and the people Story Block's scene lists as present (`scene.present`): the story put them there.
// * News and events: the chronicle's world events (written by a reply's `world` line, which the story
//   tells, or by the reader on the Chronicle screen) and the Director's `event` threads (dated happenings
//   a reply wrote). Factions: the chronicle's factions, by the same rule.
// * Upcoming: open quests' `due:` dates (a quest is a job {{user}} accepted), the `on:` dates of open
//   events and hooks, and the pack calendar's holidays (`packs.calendar().holidays`), within the next N
//   story days (setting `world.upcomingDays`).
// Never shown, while hidden or not: agendas, beats, clocks and secrets (behind the scenes, screens/reveal.js),
// anything the arc planner made or touched (a thread with `track.arc`: its words are the planner's, not
// the story's), the arcs themselves, and the Director's problems. A chronicle event or faction named like
// one of those (an agenda, beat, clock or secret, or an arc) is left out too, and a journal line that
// names a secret or an arc is dropped, so a hidden name never reaches the page through another list.
// Quests show their name, goal and due date only (a plan line can never write those).

import { lineKey } from '../../changes.js';
import { PRESETS, makeCalendar } from '../../calendar.js';
import { BEHIND } from '../screens/reveal.js';

export const FEATURE = 'story-director.world';
export const DEFAULT_UPCOMING_DAYS = 30;
export const MAX_UPCOMING_DAYS = 365;
// Story Block's cap on chatter lines a reply (MODULES §F115), read no further.
const MAX_THOUGHTS = 3;
/** How many of each list the Now view shows. */
export const NEWS_SHOWN = 20;
export const FACTIONS_SHOWN = 20;
export const UPCOMING_SHOWN = 20;
export const SUMMARY_POINTS = 160;
const DAY = 1440;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);
const text = value => (typeof value === 'string' || typeof value === 'number' ? String(value) : '').replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** `value` cut to `max` code points (never inside a character), with "…" when it was longer. */
export function cut(value, max) {
    const chars = Array.from(text(value));
    return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

/** `query(name, args)` from the tools a host passes, or null. */
export const queryOf = tools => (typeof tools?.query === 'function' ? (name, args) => tools.query(name, args) : typeof tools === 'function' ? tools : null);

/** Asks a query; `fallback` when there is no query, it throws (no module answers it) or it answers undefined. */
export function tryQuery(query, name, args = {}, fallback = null) {
    if (typeof query !== 'function') return fallback;
    try {
        const value = query(name, args);
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

// ---- the calendar and the clock ---------------------------------------------------------------

/** The chat's calendar (the tracker's `director.calendar`), else Gregorian. */
export function calendarFrom(query) {
    const config = tryQuery(query, 'director.calendar', {}, null);
    try {
        return makeCalendar(isRecord(config) ? config : PRESETS.gregorian);
    } catch {
        return makeCalendar(PRESETS.gregorian);
    }
}

/** The story clock in minutes, or null while it is not set. */
export function nowFrom(query, state) {
    const asked = tryQuery(query, 'director.time', {}, null);
    if (isInt(asked?.minutes)) return asked.minutes;
    const minutes = state?.domains?.director?.time?.minutes;
    return isInt(minutes) ? minutes : null;
}

const dateText = (calendar, minutes, options) => {
    if (!isInt(minutes)) return '';
    try { return text(calendar.format(minutes, options)); } catch { return ''; }
};

/** "today", "tomorrow", "in 3 days", "yesterday", "3 days ago". */
export function daysText(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** "today", "yesterday", "3 days ago" (whole story days back). */
export const agoText = days => (days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`);

// ---- what stays hidden --------------------------------------------------------------------------

const threadsOf = state => (isRecord(state?.domains?.director?.threads) ? Object.values(state.domains.director.threads).filter(isRecord) : []);
const arcsOf = state => (isRecord(state?.domains?.arc?.arcs) ? Object.values(state.domains.arc.arcs).filter(isRecord) : []);
const planned = thread => Boolean(thread?.track?.arc);

/**
 * The names that must not reach the World screen or the Journal: `{ behind: Set, words: Set }` of keys
 * (lineKey). `behind`: every agenda, beat, clock and secret's own key and the names that reach it, and
 * every arc's name (a chronicle entry named so is left out). `words`: the secrets' keys and the arcs'
 * names (a journal line naming one is dropped; agendas are often named after people, who are known).
 */
export function hiddenNames(state) {
    const behind = new Set();
    const words = new Set();
    const director = state?.domains?.director;
    const kindOf = new Map(threadsOf(state).map(thread => [thread.id, thread.kind]));
    for (const thread of threadsOf(state)) {
        if (!BEHIND.has(thread.kind)) continue;
        const key = lineKey(text(thread.key));
        if (!key) continue;
        behind.add(key);
        if (thread.kind === 'secret') words.add(key);
    }
    for (const [name, id] of Object.entries(isRecord(director?.keys) ? director.keys : {})) {
        if (!BEHIND.has(kindOf.get(id))) continue;
        const key = lineKey(name);
        if (key) behind.add(key);
        if (key && kindOf.get(id) === 'secret') words.add(key);
    }
    for (const arc of arcsOf(state)) {
        const key = lineKey(text(arc.key));
        if (key) {
            behind.add(key);
            words.add(key);
        }
    }
    return { behind, words };
}

// Receipt lines of the arc planner an older digest may still hold ("New arc: …", "Arc ended: …", "Arc X: …").
const PLANNED_LINE = /^(?:New arc|Arc ended|Arc [^:]{1,80}):\s/;

/** Whether a free-text line (a journal line) names a hidden word as a whole phrase, or is an arc's own line. */
export function namesHidden(line, words) {
    if (PLANNED_LINE.test(text(line))) return true;
    if (!words?.size) return false;
    const key = ` ${lineKey(text(line))} `;
    for (const word of words) if (word && key.includes(` ${word} `)) return true;
    return false;
}

// ---- Here -----------------------------------------------------------------------------------------

/** The stance a chip shows for one NPC from NPC State Delta's meters: its ladder rank, else its disposition, else a stage. */
function stanceOf(entry) {
    if (!isRecord(entry)) return '';
    if (text(entry.rank)) return cut(entry.rank, 40);
    if (text(entry.disposition)) return cut(entry.disposition, 40);
    const stages = isRecord(entry.stages) ? Object.values(entry.stages).map(text).filter(Boolean) : [];
    return stages.length ? cut(stages[0], 40) : '';
}

/**
 * `director.world.here` → `{ place: { name, region, kind } | null, moved, weather, present: [name], people: [{ name,
 * stance, dossier, key, thought }], chatter: [{ key, name, text }], nsd, hasPeople }`. `present` is Story
 * Block's scene list (NPC State Delta reads it to know who is here); `people` adds, when NPC State Delta
 * answers (`npc.known`), each one's stance and whether they have a dossier. Without it the names stand
 * alone (`nsd: false`, no stance). `moved`: the newest reply moved the scene here (Story Block's
 * `scene.moved`). `weather`: the day's weather (Story Block's `scene.weather`: the story's `~ weather` or the
 * rule's own), '' while there is none or the weather is off. `chatter`: the newest reply's Inner chatter
 * (Story Block's `chatter.head`; empty while it is off), one thought per thinker (their last line), each
 * under `key`: the dossier's name when NPC State Delta knows the name or alias (`npc.dossier`, as the chatter
 * strip links a dossier), else the name, folded (lineKey); a person's `thought` is the one under their key
 * (MODULES §F119).
 */
export function hereView(state, _args, tools) {
    const query = queryOf(tools);
    const atlas = tryQuery(query, 'atlas.here', {}, null);
    const scenePlace = tryQuery(query, 'scene.place', {}, null) ?? state?.domains?.scene?.place ?? null;
    const name = text(atlas?.name) || text(scenePlace?.name);
    const place = name ? { name: cut(name, 80), region: cut(text(atlas?.region) || text(scenePlace?.region), 80), kind: cut(text(atlas?.kind) || text(scenePlace?.kind), 40) } : null;
    const moved = Boolean(place) && tryQuery(query, 'scene.moved', {}, false) === true;
    // Story Block's Scene tab shows the weather and World replaces that tab, so Here must too (MODULES §F119/§F122).
    const weather = cut(text(tryQuery(query, 'scene.weather', {}, null)?.text), 80);
    const listed = tryQuery(query, 'scene.present', {}, null) ?? state?.domains?.scene?.present ?? [];
    const present = [];
    const seen = new Set();
    for (const entry of Array.isArray(listed) ? listed : []) {
        const who = cut(entry, 80);
        const key = lineKey(who);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        present.push(who);
    }
    const known = tryQuery(query, 'npc.known', {}, null);
    const nsd = Array.isArray(known);
    // One dossier lookup per name: the dossier (or null) and the key the name goes by.
    const dossiers = new Map();
    const dossierOf = who => {
        if (!nsd) return null;
        if (!dossiers.has(who)) dossiers.set(who, tryQuery(query, 'npc.dossier', { name: who }, null));
        return dossiers.get(who);
    };
    const keyOf = who => lineKey(text(dossierOf(who)?.name) || who);
    const thoughts = new Map();
    const lines = tryQuery(query, 'chatter.head', {}, null);
    for (const item of Array.isArray(lines) ? lines.slice(0, MAX_THOUGHTS) : []) {
        const who = cut(item?.name, 40);
        const thought = cut(item?.text, 140);
        const key = who ? keyOf(who) : '';
        if (!key || !thought) continue;
        thoughts.delete(key);
        thoughts.set(key, { key, name: who, text: thought });
    }
    const people = present.map(who => {
        const key = keyOf(who);
        const thought = thoughts.get(key)?.text ?? '';
        if (!nsd) return { name: who, stance: '', dossier: false, key, thought };
        const dossier = Boolean(dossierOf(who));
        return { name: who, stance: dossier ? stanceOf(tryQuery(query, 'npc.meters', { name: who }, null)) : '', dossier, key, thought };
    });
    return { place, moved, weather, present, people, chatter: [...thoughts.values()], nsd, hasPeople: people.length > 0 };
}

// ---- news, events and factions ------------------------------------------------------------------

/**
 * The known news, newest first: the chronicle's events and the Director's event threads, each
 * `{ id, kind: 'world' | 'event', name, summary, state, open, when, ago, place, factions }`.
 */
export function knownNews(state, tools, { hidden = hiddenNames(state), calendar = null, now = null } = {}) {
    const query = queryOf(tools);
    const out = [];
    const events = tryQuery(query, 'chronicle.events', {}, null);
    for (const event of Array.isArray(events) ? events : []) {
        if (!isRecord(event) || hidden.behind.has(lineKey(text(event.name)))) continue;
        out.push({
            id: text(event.id), kind: 'world', name: cut(event.name, 80), summary: cut(event.summary, SUMMARY_POINTS),
            state: text(event.state), open: event.open === true, when: text(event.updatedText), ago: text(event.updatedAgo),
            place: cut(event.place, 80), factions: cut(event.factionsText, 160),
            at: isInt(event.updated) ? event.updated : null, rev: isInt(event.rev) ? event.rev : 0,
        });
    }
    for (const thread of threadsOf(state)) {
        if (thread.kind !== 'event' || planned(thread)) continue;
        const at = isInt(thread.track?.changed?.time) ? thread.track.changed.time : isInt(thread.track?.created?.time) ? thread.track.created.time : null;
        const open = thread.status === 'active' && !thread.ended;
        out.push({
            id: thread.id, kind: 'event', name: cut(thread.key, 80), summary: cut(thread.summary, SUMMARY_POINTS),
            // A dated happening has no looming/ongoing of its own: only "resolved" once the story closed it.
            state: open ? '' : 'resolved', open, when: calendar ? dateText(calendar, at) : '',
            ago: isInt(now) && isInt(at) && now >= at ? agoText(Math.floor(now / DAY) - Math.floor(at / DAY)) : '',
            place: '', factions: '', at, rev: isInt(thread.rev) ? thread.rev : 0,
        });
    }
    return out.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || b.rev - a.rev || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(({ at, rev, ...item }) => item);
}

/** The known factions, newest first (by the receipt that last changed them): `{ id, name, summary, area, stance }`. */
export function knownFactions(state, tools, { hidden = hiddenNames(state) } = {}) {
    const query = queryOf(tools);
    const factions = tryQuery(query, 'chronicle.factions', {}, null);
    return (Array.isArray(factions) ? factions : [])
        .filter(faction => isRecord(faction) && !hidden.behind.has(lineKey(text(faction.name))))
        .sort((a, b) => (b.rev ?? 0) - (a.rev ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(faction => ({ id: text(faction.id), name: cut(faction.name, 80), summary: cut(faction.summary, SUMMARY_POINTS), area: cut(faction.area, 80), stance: cut(faction.stance, 80) }));
}

// ---- upcoming -------------------------------------------------------------------------------------

/** The upcoming setting (story days ahead), clamped. */
export function upcomingDaysOf(tools) {
    let value;
    try { value = typeof tools?.settings === 'function' ? tools.settings()?.upcomingDays : undefined; } catch { value = undefined; }
    return isInt(value) ? Math.min(MAX_UPCOMING_DAYS, Math.max(1, value)) : DEFAULT_UPCOMING_DAYS;
}

// The month a holiday names: its name on the calendar (any case), or its number (1 = the first).
function monthIndex(calendar, month) {
    const months = calendar.config?.months ?? [];
    if (isInt(month) && month >= 1 && month <= months.length) return month - 1;
    const key = text(month).toLowerCase();
    if (/^\d+$/.test(key)) return monthIndex(calendar, Number(key));
    return months.findIndex(entry => text(entry?.name).toLowerCase() === key);
}

/**
 * The pack calendar's holidays within `days` story days from `now`: `[{ name, at, inDays }]`, soonest first.
 * Read from `packs.calendar().holidays` (`[{ name, month, day }]`), only while the chat runs on that pack's
 * calendar (its months are the chat calendar's). Without a pack, or a pack without holidays: none.
 */
export function holidays(query, calendar, now, days) {
    if (!isInt(now)) return [];
    const pack = tryQuery(query, 'packs.calendar', {}, null);
    const list = Array.isArray(pack?.holidays) ? pack.holidays.slice(0, 60) : [];
    if (!list.length) return [];
    const ours = (calendar.config?.months ?? []).map(month => text(month?.name).toLowerCase()).join('|');
    const theirs = (Array.isArray(pack?.months) ? pack.months : []).map(month => text(month?.name).toLowerCase()).join('|');
    if (!ours || ours !== theirs) return [];
    const today = calendar.dayIndex(now);
    const { year } = calendar.fromAbs(now);
    const out = [];
    for (const entry of list) {
        const name = cut(entry?.name, 80);
        const month = monthIndex(calendar, entry?.month);
        const day = Number(entry?.day);
        if (!name || month < 0 || !isInt(day) || day < 1) continue;
        for (const y of [year, year + 1]) {
            if (day > calendar.daysInMonth(y, month)) continue;
            const at = calendar.toAbs({ year: y, month, day });
            const inDays = calendar.dayIndex(at) - today;
            if (inDays >= 0 && inDays <= days) {
                out.push({ name, at, inDays });
                break;
            }
        }
    }
    return out.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
}

// A thread's date field read on the chat's calendar: { at, inDays } or null.
function dateOf(calendar, when, now) {
    let parsed = null;
    try { parsed = calendar.parse(when, { reference: now }); } catch { parsed = null; }
    if (!parsed || !Number.isFinite(parsed.abs)) return null;
    const at = Math.round(parsed.abs);
    return { at, inDays: calendar.dayIndex(at) - calendar.dayIndex(now) };
}

/**
 * What {{user}} knows is coming within `days` story days: `[{ kind: 'quest' | 'event' | 'hook' | 'holiday',
 * name, field, when, inDays, label, overdue }]`, soonest first (an overdue quest first of all). A quest's
 * `due:`, an event's or hook's `on:` (not one the planner made), and the pack's holidays. Nothing while
 * the story clock is not set.
 */
export function knownUpcoming(state, tools, { calendar, now, days }) {
    if (!isInt(now)) return [];
    const query = queryOf(tools);
    const out = [];
    for (const thread of threadsOf(state)) {
        const open = thread.status === 'active' && !thread.ended && !thread.offer;
        if (!open || !['quest', 'event', 'hook'].includes(thread.kind) || (thread.kind !== 'quest' && planned(thread))) continue;
        const goal = thread.kind === 'quest' || Boolean(thread.acceptance);
        const field = goal ? 'due' : 'on';
        const when = text(thread.fields?.[field]);
        if (!when) continue;
        const date = dateOf(calendar, when, now);
        if (!date || date.inDays > days) continue;
        // A past event or hook date is over; a quest past its due day is overdue.
        if (date.inDays < 0 && !goal) continue;
        const overdue = date.inDays < 0;
        out.push({
            kind: thread.kind, name: cut(thread.key, 80), field, when: dateText(calendar, date.at, { time: false }) || cut(when, 80),
            inDays: date.inDays, label: overdue ? 'overdue' : daysText(date.inDays), overdue,
            goal: goal ? cut(thread.fields?.goal, SUMMARY_POINTS) : '', at: date.at,
        });
    }
    for (const holiday of holidays(query, calendar, now, days)) {
        out.push({ kind: 'holiday', name: holiday.name, field: '', when: dateText(calendar, holiday.at, { time: false }), inDays: holiday.inDays, label: daysText(holiday.inDays), overdue: false, goal: '', at: holiday.at });
    }
    return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.at - b.at || a.name.localeCompare(b.name))
        .map(({ at, ...item }) => item);
}

// ---- the Now view ---------------------------------------------------------------------------------

/**
 * `director.world` → the World screen's Now view: `{ here, news, factions, upcoming, upcomingDays, today,
 * hasNews, hasFactions, hasUpcoming, newsCount, factionCount, clockSet }`, only what {{user}} knows.
 */
export function worldView(state, args, tools) {
    const query = queryOf(tools);
    const calendar = calendarFrom(query);
    const now = nowFrom(query, state);
    const hidden = hiddenNames(state);
    const days = upcomingDaysOf(tools);
    const news = knownNews(state, tools, { hidden, calendar, now });
    const factions = knownFactions(state, tools, { hidden });
    const upcoming = knownUpcoming(state, tools, { calendar, now, days });
    return {
        here: hereView(state, args, tools),
        news: news.slice(0, NEWS_SHOWN),
        factions: factions.slice(0, FACTIONS_SHOWN),
        upcoming: upcoming.slice(0, UPCOMING_SHOWN),
        upcomingDays: days,
        today: dateText(calendar, now),
        clockSet: isInt(now),
        hasNews: news.length > 0,
        hasFactions: factions.length > 0,
        hasUpcoming: upcoming.length > 0,
        newsCount: news.length,
        factionCount: factions.length,
    };
}
