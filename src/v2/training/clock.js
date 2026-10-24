// RPG Battle v2, the training clock (contract §3 "skill.train", §5 "Training start", fixture C06): story days
// and minutes, the sixty-minute window of a session and the day its credits count on. Only the arithmetic lives
// here; the sessions, the fee and the time written to Story Director are later work (track B3). Pure.
//
// Time is Story Director's minute counter (`director.time`, `{ minutes, text }`), read through the query the
// contract names and never from a wall clock. A day is floor(minutes / 1440); the minute of the day is what is
// left. Training that starts on day 4 at minute 1410 (absolute 7170) ends sixty minutes later, on day 5 at
// minute 30 (7230): its credits are counted on day 5, the day the session is completed, and the day caps of
// day 5 apply to them, not those of day 4.

/** The story day of an absolute `minute`: floor(minute / perDay), also below 0. */
export const dayOf = (minute, perDay) => Math.floor(minute / perDay);

/** The minute of its day (0…perDay-1) an absolute `minute` is. */
export const minuteOfDay = (minute, perDay) => ((minute % perDay) + perDay) % perDay;

/** The absolute minute a day starts at. */
export const dayStart = (day, perDay) => day * perDay;

/** The midnights (day starts) crossed after `from` up to and including `to`, earliest first. */
export function midnightsBetween(from, to, perDay) {
    const out = [];
    for (let day = dayOf(from, perDay) + 1; dayStart(day, perDay) <= to; day += 1) out.push(dayStart(day, perDay));
    return out;
}

/**
 * The window of a training session that starts at absolute `start`: { start, end, startDay, startMinuteOfDay,
 * endDay, endMinuteOfDay, midnights (crossed), crossesMidnight, completionDay }. `constants`: the pinned
 * trainMinutes and clockMinutesPerDay. null for a start that is not a whole minute (no clock set).
 */
export function trainingWindow(start, constants) {
    if (!Number.isSafeInteger(start)) return null;
    const perDay = constants.clockMinutesPerDay;
    const end = start + constants.trainMinutes;
    const midnights = midnightsBetween(start, end, perDay);
    return {
        start, end,
        startDay: dayOf(start, perDay), startMinuteOfDay: minuteOfDay(start, perDay),
        endDay: dayOf(end, perDay), endMinuteOfDay: minuteOfDay(end, perDay),
        midnights, crossesMidnight: midnights.length > 0,
        // Credits and the interruption roll are recorded on the day the session is completed.
        completionDay: dayOf(end, perDay),
    };
}

const minutesOf = value => {
    const minutes = value && typeof value === 'object' ? value.minutes : value;
    return Number.isSafeInteger(minutes) ? minutes : null;
};

/**
 * Story Director's clock through `query` (a ctx's or a view's `query(name, args)`): the absolute minute, or
 * null when there is no clock (no Story Director, the query is missing or throws, or no time is set). Never
 * a wall-clock fallback.
 */
export function readClock(query) {
    if (typeof query !== 'function') return null;
    try {
        return minutesOf(query('director.time', {}));
    } catch {
        return null;
    }
}
