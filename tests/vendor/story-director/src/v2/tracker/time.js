// Story Director v2, tracker part: the story clock on the reader's calendar (pure).
//
// `director.time.minutes` is v1's story time: minutes since the calendar's epoch (calendar.js).
// The story moves it with a `time` line: `~ time Goldwane 12, 12:45 pm` sets it to a date
// (read as v1 reads the scene's time, the nearest year to the time before), `! time +2h` moves
// it on. The calendar is the reader's (settings section 'Calendar'): by default (preset `pack`) the
// first enabled pack's (Story Block's query `packs.calendar`), else Gregorian; a reader who picks
// `gregorian` or `custom` keeps their own whatever the packs say. A pack that gives a start date
// sets the clock before the first reply when the story has not (`director.seed`).

import { PRESETS, makeCalendar, normalizeCalendar } from '../../calendar.js';
import { DEFAULTS } from '../../relevance.js';

const DAY_MINUTES = 1440;

/** The calendar preset that defers to the enabled packs' calendar (Gregorian without one). */
export const PACK_PRESET = 'pack';
export const PRESET_CHOICES = Object.freeze([PACK_PRESET, 'gregorian', 'custom']);
/** The claim that keeps the clock from being seeded from a pack twice. */
export const SEED_CLAIM = 'clock:seed';

/** The longest one reply may move the clock forward, in story days (`maxJump`), by default. */
export const MAX_JUMP_DAYS = 30;
/** The furthest year a time line may name, either way of year 0. */
export const MAX_YEAR = 999999;

/** The part's settings defaults: v1's calendar and relevance defaults, plain copies. */
export function settingsDefaults() {
    return {
        calendar: { ...structuredClone(PRESETS.gregorian), preset: PACK_PRESET },
        dormantReplies: DEFAULTS.dormantReplies,
        dormantDays: DEFAULTS.dormantDays,
        dueSoonDays: DEFAULTS.dueSoonDays,
        maxJump: MAX_JUMP_DAYS,
        // The Director note's Elsewhere line (scene.js DEFAULT_ELSEWHERE) and NPC initiative's cooldown
        // (initiative.js DEFAULT_COOLDOWN).
        elsewhere: 2,
        initiativeCooldown: 2,
    };
}

/** The `maxJump` setting in minutes: a whole number of days, 1 or more, else the default. */
export function maxJumpMinutes(settings) {
    const days = settings?.maxJump;
    return (Number.isSafeInteger(days) && days >= 1 ? days : MAX_JUMP_DAYS) * DAY_MINUTES;
}

/** The module's settings as handed to a handler or a view: a function, an object, or nothing. */
export function settingsFrom(source) {
    const value = typeof source === 'function' ? source() : source;
    return { ...settingsDefaults(), ...(value && typeof value === 'object' ? value : {}) };
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The enabled packs' calendar through a query function (ctx.query, view.query, tools.query):
 * `{ pack, era, months: [{ name, days }], start }` or null (no pack has one, or no packs part).
 */
export function packCalendarOf(query) {
    if (typeof query !== 'function') return null;
    try {
        const value = query('packs.calendar', {});
        return isRecord(value) && Array.isArray(value.months) && value.months.length ? value : null;
    } catch {
        return null;
    }
}

/**
 * The calendar config the chat runs on (normalizeCalendar's shape): the reader's own when they chose
 * `gregorian` or `custom`; with the default preset `pack`, the pack's calendar (`packCalendar`, see
 * packCalendarOf) when there is one, else Gregorian.
 */
export function calendarConfig(settings, packCalendar = null) {
    const own = settings?.calendar ?? null;
    const preset = typeof own === 'string' ? own : isRecord(own) ? own.preset : PACK_PRESET;
    if (preset === PACK_PRESET || own === null) {
        if (isRecord(packCalendar) && Array.isArray(packCalendar.months) && packCalendar.months.length) {
            return normalizeCalendar({ preset: 'custom', era: String(packCalendar.era ?? ''), months: packCalendar.months, leapYears: false });
        }
        return normalizeCalendar(PRESETS.gregorian);
    }
    return normalizeCalendar(own);
}

/** The chat's calendar (makeCalendar) from the module's settings and the packs' calendar. */
export function calendarOf(settings, packCalendar = null) {
    return makeCalendar(calendarConfig(settings, packCalendar));
}

/**
 * The story time a pack's `start` (`{ year, month: name, day, hour, minute }`) is on `calendar`, in
 * minutes, or null when it is not a date there (a month the calendar has not got, a day past the
 * month's end).
 */
export function startMinutes(calendar, start) {
    if (!isRecord(start)) return null;
    const { year, day, hour = 0, minute = 0 } = start;
    if (![year, day, hour, minute].every(Number.isSafeInteger)) return null;
    if (day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    const name = String(start.month ?? '').trim().toLowerCase();
    const month = calendar.config.months.findIndex(entry => entry.name.toLowerCase() === name);
    if (month < 0 || day > calendar.daysInMonth(year, month)) return null;
    const minutes = calendar.toAbs({ year, month, day, minutes: hour * 60 + minute });
    return Number.isSafeInteger(minutes) ? minutes : null;
}

const UNITS = [
    [/^(?:w|wk|wks|weeks?)$/i, 7 * DAY_MINUTES],
    [/^(?:d|days?)$/i, DAY_MINUTES],
    [/^(?:h|hr|hrs|hours?)$/i, 60],
    [/^(?:m|min|mins|minutes?)$/i, 1],
];
const AMOUNT = /(?:(?<![\d.])(\d+(?:\.\d+)?)|(?<![a-z])(half an?|an?)(?![a-z]))\s*([a-z]+)/gi;

/**
 * Minutes in a written stretch of time: `+2h`, `2 hours`, `+1d 4h`, `an hour and 30 minutes`.
 * A whole number of minutes, or null when the text is not only a stretch of time.
 */
export function durationMinutes(input) {
    const source = String(input ?? '').trim().replace(/^\+\s*/, '').replace(/\b(?:and|later|pass(?:es|ed)?)\b|,|\.(?!\d)/gi, ' ').trim();
    if (!source) return null;
    let total = 0;
    let rest = source;
    for (const match of source.matchAll(AMOUNT)) {
        const unit = UNITS.find(([pattern]) => pattern.test(match[3]));
        if (!unit) return null;
        const amount = match[1] !== undefined ? Number(match[1]) : /^half/i.test(match[2]) ? 0.5 : 1;
        total += amount * unit[1];
        rest = rest.replace(match[0], ' ');
    }
    if (rest.trim() || total <= 0) return null;
    return Math.round(total);
}

/**
 * What a `time` line does to the story time `minutes` (null: not set yet): `{ minutes }`, or
 * `{ error }` in plain words. A date alone runs from its day's start, as v1 reads the scene's
 * time; a bare clock time or part of the day that is earlier than now is the next day's.
 * `from` is the clock when the reply began (default `minutes`): the reply's lines together move it at
 * most `maxJump` past that, however many they are (C2-5).
 */
export function timeAfter(line, minutes, calendar, { maxJump = MAX_JUMP_DAYS * DAY_MINUTES, from = null } = {}) {
    const words = [line?.name, line?.text].map(part => String(part ?? '').trim()).filter(Boolean).join(' ');
    if (line?.op === '-' || line?.op === '?') return { error: 'Story time only moves forward or is set: write "! time +2h" or "~ time <date, clock time>".' };
    if (!words) return { error: 'A time line needs a date or a stretch of time.' };
    const shown = words.length > 80 ? `${words.slice(0, 79)}…` : words;
    const known = Number.isInteger(minutes);
    const stretch = durationMinutes(words);
    if (stretch !== null) {
        if (!known) return { error: `The story time is not set yet, so "${shown}" cannot move it on; write "~ time <date, clock time>" first.` };
        return held(minutes, minutes + stretch, maxJump, shown, from);
    }
    const bad = badClock(words);
    if (bad) return { error: `"${shown}" has ${bad}, which is not a clock time; the story time is left as it was.` };
    const parsed = calendar.parse(words, { reference: known ? minutes : null });
    if (!parsed || !Number.isFinite(parsed.abs)) return { error: `"${shown}" is not a date or a stretch of time on this calendar.` };
    if (!Number.isSafeInteger(parsed.year) || Math.abs(parsed.year) > MAX_YEAR) return { error: `"${shown}" names a year past ${MAX_YEAR}; the story time is left as it was.` };
    let abs = Math.round(parsed.abs);
    // No date written (only "evening", "08:00 am"): the reference's day, or the next one.
    const bare = calendar.parse(words, { reference: null }) === null;
    if (known && bare && abs < minutes) abs += DAY_MINUTES;
    // `set`: a date sets the clock (stored as a set, not a move: applyTimeLine).
    return { ...(known ? held(minutes, abs, maxJump, shown, from) : { minutes: abs }), set: true };
}

// A move past `maxJump` minutes from the reply's start (`from`, else `minutes`) is held there:
// `{ minutes, held: { asked } }`. The clock never goes back for it (another rule moved it further).
function held(minutes, next, maxJump, shown, from) {
    const start = Number.isSafeInteger(from) ? from : minutes;
    const limit = Math.max(minutes, start + maxJump);
    if (!(next > limit)) return { minutes: next };
    const days = Math.round(maxJump / DAY_MINUTES);
    const span = `${days} day${days === 1 ? '' : 's'}`;
    return {
        minutes: limit,
        held: { asked: Number.isSafeInteger(next) ? next - minutes : null },
        problem: start === minutes
            ? `"${shown}" moves the story time more than ${span} at once; it moved ${span} (the longest jump is the Calendar setting "Longest time jump").`
            : `"${shown}" would take the story time more than ${span} past where this reply began; it stops there (the longest jump in one reply is the Calendar setting "Longest time jump").`,
    };
}

// A written clock time no clock shows ("25:99 pm", "13 pm", "0 am"), in words, or ''. The calendar's
// reader skips such a time and reads the date alone, at its day's start.
const CLOCKISH = /(?<![\p{L}\d:.])(\d{1,3})(?::(\d{1,3}))?(?:\s*([ap])\.?\s?m\.?)?(?![\p{L}\d])/giu;
function badClock(words) {
    for (const match of words.matchAll(CLOCKISH)) {
        const [, hourText, minuteText, half] = match;
        if (minuteText === undefined && !half) continue;
        const hour = Number(hourText);
        const minute = minuteText === undefined ? 0 : Number(minuteText);
        const ok = minuteText === undefined || minuteText.length === 2;
        if (!ok || minute > 59 || (half ? hour < 1 || hour > 12 : hour > 23)) return `"${match[0].trim()}"`;
    }
    return '';
}
