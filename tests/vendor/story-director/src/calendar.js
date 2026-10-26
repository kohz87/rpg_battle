// Story Director: calendars, date parsing and date maths (pure).
//
// Story time is "abs": minutes since the calendar's epoch, which is year 0, the first month,
// day 1, 00:00. Every calendar is a list of months with fixed lengths, optionally with
// Gregorian leap years (the extra day goes to the second month, February in the preset).
// Parsing is deliberately lenient because the dates come from model prose and ledger lines.

const DAY_MINUTES = 1440;

export const DEFAULT_PARTS_OF_DAY = Object.freeze({
    dawn: 360, morning: 540, noon: 720, afternoon: 900,
    dusk: 1140, evening: 1140, night: 1320, midnight: 0,
    // (0.9.11) The sun's own words, as stories write deadlines ("Goldwane 12 sunset").
    sunrise: 360, daybreak: 360, sunset: 1140, sundown: 1140,
});

const GREGORIAN_MONTHS = [
    ['January', 31], ['February', 28], ['March', 31], ['April', 30], ['May', 31], ['June', 30],
    ['July', 31], ['August', 31], ['September', 30], ['October', 31], ['November', 30], ['December', 31],
].map(([name, days]) => ({ name, days }));

const GREGORIAN_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// (0.9.21) A custom calendar's week: up to this many day names. None: the world has no weekdays.
export const MAX_WEEK_DAYS = 14;

// The longest era, month name and day name a calendar keeps (the reader's settings are free text).
export const ERA_CHARS = 24;
export const NAME_CHARS = 40;

// One line, at most `max` characters: line breaks, tabs and control characters become one space, so a
// name from the settings cannot start a line of its own in the prompt ("[Happened]", "</Changes>").
export function oneLine(value, max) {
    const flat = String(value ?? '').replace(/[\s\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim();
    const chars = Array.from(flat);
    return chars.length > max ? chars.slice(0, max).join('').trimEnd() : flat;
}

// Day names from a list or from text ("Moonday, Tideday" or one per line), trimmed, once each.
export function parseWeek(value) {
    const list = Array.isArray(value) ? value : String(value ?? '').split(/[,\n]/);
    const seen = new Set();
    return list.map(name => oneLine(name, NAME_CHARS)).filter(name => {
        const key = name.toLowerCase();
        if (!name || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, MAX_WEEK_DAYS);
}

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

export const PRESETS = deepFreeze({
    gregorian: {
        preset: 'gregorian', era: '', months: GREGORIAN_MONTHS, daysPerMonth: 30,
        leapYears: true, partsOfDay: { ...DEFAULT_PARTS_OF_DAY },
    },
    custom30: {
        preset: 'custom', era: '',
        months: Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })),
        daysPerMonth: 30, leapYears: false, partsOfDay: { ...DEFAULT_PARTS_OF_DAY },
    },
});

// ---------------------------------------------------------------------------------------
// Config

function positiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

// A month may be a bare name, 'Name | days' (the settings textarea line) or { name, days }.
function toMonth(month, daysPerMonth) {
    if (typeof month === 'string') {
        const [written, days] = month.split('|');
        const name = oneLine(written, NAME_CHARS);
        return name ? { name, days: positiveInt(days, daysPerMonth) } : null;
    }
    if (month && typeof month === 'object') {
        const name = oneLine(month.name, NAME_CHARS);
        return name ? { name, days: positiveInt(month.days, daysPerMonth) } : null;
    }
    return null;
}

function toMinutes(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.min(Math.max(Math.floor(value), 0), DAY_MINUTES - 1);
    const m = typeof value === 'string' && /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value);
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
    return null;
}

// Reader-given parts of day override or extend the defaults, never remove them.
function normalizeParts(parts) {
    const out = { ...DEFAULT_PARTS_OF_DAY };
    if (parts && typeof parts === 'object') {
        for (const [key, value] of Object.entries(parts)) {
            const name = key.trim().toLowerCase();
            const minutes = toMinutes(value);
            if (name && minutes !== null) out[name] = minutes;
        }
    }
    return out;
}

export function normalizeCalendar(config) {
    if (typeof config === 'string') config = PRESETS[config] ?? { preset: config };
    if (Array.isArray(config)) config = { months: config };
    if (!config || typeof config !== 'object') config = PRESETS.custom30;

    const era = typeof config.era === 'string' ? oneLine(config.era, ERA_CHARS) : '';
    const daysPerMonth = positiveInt(config.daysPerMonth ?? config.days_per_month, 30);
    const partsOfDay = normalizeParts(config.partsOfDay ?? config.parts_of_day);

    if (config.preset === 'gregorian') {
        return {
            preset: 'gregorian', era, months: GREGORIAN_MONTHS.map(m => ({ ...m })),
            daysPerMonth, leapYears: true, partsOfDay, week: [...GREGORIAN_WEEK], weekOffset: 0,
        };
    }

    let months = (Array.isArray(config.months) ? config.months : [])
        .map(month => toMonth(month, daysPerMonth))
        .filter(Boolean);
    // A calendar needs at least one month; an empty list falls back to twelve numbered ones.
    if (!months.length) months = PRESETS.custom30.months.map(m => ({ name: m.name, days: daysPerMonth }));

    const week = parseWeek(config.week);
    const offset = Math.trunc(Number(config.weekOffset) || 0);
    return {
        preset: 'custom', era, months, daysPerMonth,
        leapYears: config.leapYears === true || config.leap_years === true,
        partsOfDay,
        week, weekOffset: week.length ? ((offset % week.length) + week.length) % week.length : 0,
    };
}

/**
 * The calendar as other extensions read it (`StoryDirector.calendar()`): its era and months,
 * plain copies of any config `normalizeCalendar` accepts, so nothing the caller changes
 * reaches the reader's settings.
 */
export function sharedCalendar(config) {
    const { era, months } = normalizeCalendar(config);
    return { era, months: months.map(({ name, days }) => ({ name, days })) };
}

// ---------------------------------------------------------------------------------------
// Calendar

function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

// Leap years in [0, year), negative for negative years. Year 0 is a leap year (proleptic).
function leapsBefore(year) {
    const p = year - 1;
    return Math.floor(p / 4) - Math.floor(p / 100) + Math.floor(p / 400) + 1;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function makeCalendar(input) {
    const config = deepFreeze(normalizeCalendar(input));
    const { months, leapYears } = config;
    const count = months.length;
    const leapMonth = count > 1 ? 1 : 0;
    const baseYear = months.reduce((sum, m) => sum + m.days, 0);
    const avgYear = baseYear + (leapYears ? 0.2425 : 0);

    // Days before each month in a common year.
    const offsets = [];
    months.reduce((sum, m, i) => (offsets[i] = sum) + m.days, 0);

    const leap = year => leapYears && isLeapYear(year);
    const daysBeforeYear = year => baseYear * year + (leapYears ? leapsBefore(year) : 0);
    const daysBeforeMonth = (year, month) => offsets[month] + (month > leapMonth && leap(year) ? 1 : 0);

    function daysInYear(year) {
        return baseYear + (leap(year) ? 1 : 0);
    }

    function daysInMonth(year, month) {
        return months[month].days + (month === leapMonth && leap(year) ? 1 : 0);
    }

    // Lenient: a month past the end rolls into the next year, a day past the end into the
    // next month, so callers can do arithmetic on the parts.
    function toAbs({ year, month, day, minutes = 0 }) {
        const y = year + Math.floor(month / count);
        const m = ((month % count) + count) % count;
        return (daysBeforeYear(y) + daysBeforeMonth(y, m) + day - 1) * DAY_MINUTES + minutes;
    }

    function fromAbs(abs) {
        if (!Number.isFinite(abs)) throw new RangeError(`Not a story time: ${abs}`);
        const total = Math.floor(abs / DAY_MINUTES);
        const minutes = abs - total * DAY_MINUTES;
        let year = Math.floor(total / avgYear);
        while (daysBeforeYear(year) > total) year--;
        while (daysBeforeYear(year + 1) <= total) year++;
        let rest = total - daysBeforeYear(year);
        let month = 0;
        while (month < count - 1 && rest >= daysInMonth(year, month)) rest -= daysInMonth(year, month++);
        return { year, month, day: rest + 1, minutes };
    }

    const dayIndex = abs => Math.floor(abs / DAY_MINUTES);
    const addDays = (abs, days) => abs + days * DAY_MINUTES;
    const daysBetween = (a, b) => (b - a) / DAY_MINUTES;

    // era: false leaves out the era and the year: the short form used inside the note.
    // With no era configured the year goes last, the way Gregorian dates are usually written.
    function format(abs, { time = true, era = true } = {}) {
        const d = fromAbs(abs);
        let text = `${months[d.month].name} ${d.day}`;
        if (era) text = config.era ? `${config.era} ${d.year}, ${text}` : `${text}, ${d.year}`;
        return time ? `${text}, ${formatTime(d.minutes)}` : text;
    }

    // (0.9.21) The weekday at `abs`, or '' when the world has no week. Gregorian: the real one
    // (proleptic). A custom week runs on from the epoch, shifted by weekOffset.
    function weekday(abs) {
        const { week } = config;
        if (!week.length || !Number.isFinite(abs)) return '';
        if (config.preset === 'gregorian') {
            const d = fromAbs(abs);
            const date = new Date(0);
            date.setUTCFullYear(d.year, d.month, d.day);
            return week[(date.getUTCDay() + 6) % 7];
        }
        const n = week.length;
        return week[(((dayIndex(abs) + config.weekOffset) % n) + n) % n];
    }

    /** The weekOffset that makes the day at `abs` the weekday `name` (0 if it is not in the week). */
    function weekOffsetFor(abs, name) {
        const n = config.week.length;
        const at = config.week.findIndex(day => day.toLowerCase() === String(name ?? '').trim().toLowerCase());
        if (!n || at < 0 || !Number.isFinite(abs)) return 0;
        return (((at - dayIndex(abs)) % n) + n) % n;
    }

    const parser = makeParser(config, { toAbs, fromAbs, daysInMonth });

    // (0.9.12) The date in `input` with its clock time set by the calendar: a part of the day
    // becomes its time ('Goldwane 12 sunset' → 'Goldwane 12, 07:00 pm') and a date alone runs
    // to the end of its day ('Goldwane 12, 11:59 pm'), the way deadlines are counted. A date
    // already at a clock time, or text with no date, comes back as written; words around the
    // date are kept.
    function withClock(input, { reference = null } = {}) {
        const parsed = parser(input, { reference });
        if (!parsed || (parsed.hasTime && !parsed.partOfDay)) return String(input ?? '');
        const abs = parsed.hasTime ? parsed.abs : addDays(parsed.abs, 1) - 1;
        const exact = format(abs, { era: !parsed.yearInferred });
        const text = stripMarkdown(input);
        return text.includes(parsed.text) ? text.replace(parsed.text, exact) : exact;
    }

    return Object.freeze({
        config, daysInYear, daysInMonth, toAbs, fromAbs, dayIndex, addDays, daysBetween, format,
        parse: parser, withClock, weekday, weekOffsetFor,
    });
}

function formatTime(minutes) {
    const total = Math.floor(minutes);
    const hour = Math.floor(total / 60);
    const minute = String(total % 60).padStart(2, '0');
    return `${String(hour % 12 || 12).padStart(2, '0')}:${minute} ${hour < 12 ? 'am' : 'pm'}`;
}

// ---------------------------------------------------------------------------------------
// Parsing

function stripMarkdown(text) {
    return String(text)
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links keep their text
        .replace(/<[^>]*>/g, ' ')
        .replace(/[*_`~#>]+/g, '');
}

const TIME_LEAD = /^[\s,;@–—-]*(?:(?:at|by|around|about|on|in\s+the)\s+)?/iu;
const TIME_TRAIL = /^[\s,;@–—-]*(?:(?:on|of)\s+)?$/iu;
const NUMERIC_TIME = /(?<![\p{L}\d:.])(\d{1,2})(?::([0-5]\d))?(?:\s*([ap])\.?\s?m\.?)?(?![\p{L}\d:])/giu;

function makeParser(config, { toAbs, fromAbs, daysInMonth }) {
    const names = config.months.map(m => m.name.toLowerCase().replace(/\s+/g, ' '));
    const parts = config.partsOfDay;

    // Full names first (longest first, so 'Month 12' beats 'Month 1'), then any word that
    // might be a prefix. resolveMonth decides; the regex only finds candidates.
    const fullNames = [...config.months.map(m => m.name)]
        .sort((a, b) => b.length - a.length)
        .map(name => escapeRegExp(name).replace(/\s+/g, '\\s+'));
    const MONTH = `(?<m>${[...fullNames, "\\p{L}[\\p{L}'’]{2,}"].join('|')})(?![\\p{L}\\d])\\.?`;
    const DAY = '(?<d>\\d{1,2})(?:st|nd|rd|th)?(?![\\p{L}\\d])';
    const ERA = config.era ? `${escapeRegExp(config.era).replace(/\s+/g, '\\s*')}\\.?\\s*(?<y1>-?\\d+)` : null;
    // Without an era a year needs three digits, so '5, Goldwane 3' or '12 Goldwane 5 pm'
    // do not read a year out of a stray number.
    const BARE_YEAR = '(?<y2>\\d{3,})(?![\\p{L}\\d:])';
    const YEAR = ERA ? `(?:${ERA}|${BARE_YEAR})` : BARE_YEAR;
    const TAIL = `(?:(?:\\s*,\\s*|\\s+)${YEAR})?`;

    const patterns = [
        // [ERA] YEAR, Month D
        `(?<![\\p{L}\\d])(?:${ERA ? `${ERA}|` : ''}(?<y2>\\d{3,})(?=\\s*,))\\s*,?\\s*${MONTH}\\s+${DAY}`,
        // Month D[, YEAR]
        `(?<![\\p{L}\\d])${MONTH}\\s+${DAY}${TAIL}`,
        // D Month [YEAR]
        `(?<![\\p{L}\\d:.])${DAY}\\s+(?:of\\s+)?${MONTH}${TAIL}`,
    ].map(source => new RegExp(source, 'giu'));

    const partNames = Object.keys(parts).sort((a, b) => b.length - a.length).map(escapeRegExp);
    const PART_TIME = new RegExp(`(?<![\\p{L}])(${partNames.join('|')})(?![\\p{L}])`, 'giu');

    function resolveMonth(word) {
        const w = word.toLowerCase().replace(/\s+/g, ' ');
        const exact = names.indexOf(w);
        if (exact >= 0) return exact;
        // 'night' or 'dawn' is a part of day, never a shortened Nightfall or Dawnwane.
        if (w.length < 3 || Object.hasOwn(parts, w)) return -1;
        const hits = names.flatMap((name, i) => (name.startsWith(w) ? [i] : []));
        return hits.length === 1 ? hits[0] : -1;
    }

    // Every time in the text, in order: numeric times and parts of day.
    function scanTimes(text) {
        const found = [];
        for (const m of text.matchAll(NUMERIC_TIME)) {
            const hour = Number(m[1]);
            const minute = m[2] === undefined ? 0 : Number(m[2]);
            let minutes = null;
            if (m[3]) {
                if (hour >= 1 && hour <= 12) minutes = (hour % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + minute;
            } else if (m[2] !== undefined && hour < 24) {
                minutes = hour * 60 + minute;
            }
            if (minutes !== null) found.push({ index: m.index, end: m.index + m[0].length, minutes, partOfDay: null });
        }
        for (const m of text.matchAll(PART_TIME)) {
            const name = m[1].toLowerCase();
            found.push({ index: m.index, end: m.index + m[0].length, minutes: parts[name], partOfDay: name });
        }
        return found.sort((a, b) => a.index - b.index);
    }

    // A time right after the date ('Goldwane 13, dusk') or right before it ('dusk on Goldwane 13').
    function adjacentTime(text, start, end) {
        const rest = text.slice(end);
        const lead = TIME_LEAD.exec(rest)[0].length;
        const after = scanTimes(rest).find(t => t.index === lead);
        if (after) return { ...after, index: start, end: end + after.end };
        const before = text.slice(0, start);
        const hit = scanTimes(before).filter(t => TIME_TRAIL.test(before.slice(t.end))).pop();
        return hit ? { ...hit, index: hit.index, end } : null;
    }

    // No year written: the year that puts the date nearest the reference. A few years either
    // way, so February 29 still finds a leap year.
    function inferYear(month, day, minutes, reference) {
        if (reference === null) return day <= daysInMonth(0, month) ? 0 : null;
        const year = fromAbs(reference).year;
        let best = null;
        for (const y of [year, year + 1, year - 1, year + 2, year - 2, year + 3, year - 3,
            year + 4, year - 4, year + 8, year - 8]) {
            if (day > daysInMonth(y, month)) continue;
            const distance = Math.abs(toAbs({ year: y, month, day, minutes }) - reference);
            if (!best || distance < best.distance) best = { year: y, distance };
        }
        return best ? best.year : null;
    }

    function result({ year, month, day, time, yearInferred, text }) {
        const minutes = time ? time.minutes : null;
        return {
            abs: toAbs({ year, month, day, minutes: minutes ?? 0 }),
            year, month, day, minutes,
            hasTime: Boolean(time),
            partOfDay: time ? time.partOfDay : null,
            yearInferred,
            text,
        };
    }

    function dateAt(text, match, reference) {
        const month = resolveMonth(match.groups.m);
        if (month < 0) return null;
        const day = Number(match.groups.d);
        if (day < 1) return null;
        const written = match.groups.y1 ?? match.groups.y2;
        const start = match.index;
        const time = adjacentTime(text, start, start + match[0].length);
        const minutes = time ? time.minutes : 0;
        const year = written !== undefined ? Number(written) : inferYear(month, day, minutes, reference);
        if (year === null || day > daysInMonth(year, month)) return null;
        const from = time ? Math.min(time.index, start) : start;
        const to = time ? time.end : start + match[0].length;
        return result({ year, month, day, time, yearInferred: written === undefined, text: text.slice(from, to) });
    }

    return function parse(input, { reference = null } = {}) {
        if (typeof input !== 'string' || !input.trim()) return null;
        if (typeof reference !== 'number' || !Number.isFinite(reference)) reference = null;
        const text = stripMarkdown(input);

        // Earliest date wins; at the same spot, the longer reading ('CY 611, Haywane 12').
        const candidates = [];
        for (const regex of patterns) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(text))) {
                candidates.push(match);
                regex.lastIndex = match.index + 1;   // overlapping readings stay candidates
            }
        }
        candidates.sort((a, b) => a.index - b.index || b[0].length - a[0].length);
        for (const match of candidates) {
            const date = dateAt(text, match, reference);
            if (date) return date;
        }

        // A bare time or part of day: the reference's day. Without a reference there is no day.
        const time = scanTimes(text)[0];
        if (!time || reference === null) return null;
        const { year, month, day } = fromAbs(reference);
        return result({ year, month, day, time, yearInferred: true, text: text.slice(time.index, time.end) });
    };
}
