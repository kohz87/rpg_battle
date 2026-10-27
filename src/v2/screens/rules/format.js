// RPG Battle v2, screens for the rules-v2 views (track C): words and numbers as they are shown. Presentation only:
// nothing here decides whether anything is allowed. Plain text out; the templates and widgets draw it as text.

/** Story minutes in a day (contract §4 Constants.clockMinutesPerDay; Day = floor(minutes / 1440)). */
export const DAY_MINUTES = 1440;

/** At most `max` code points of a string (a name or a line from data), never cutting a character in half. */
export const clip = (value, max = 240) => Array.from(typeof value === 'string' ? value : '').slice(0, max).join('');

const two = n => String(n).padStart(2, '0');

/** The day a story minute falls on, as the contract counts it: floor(minutes / 1440). */
export const dayOf = minutes => Math.floor(minutes / DAY_MINUTES);

/** The minute within its day (0..1439). */
export const minuteOfDay = minutes => ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;

/** "Day 4, 23:30" for story minute 7170; '' for a clock that is not set. */
export function clockLabel(minutes) {
    if (!Number.isSafeInteger(minutes)) return '';
    const within = minuteOfDay(minutes);
    return `Day ${dayOf(minutes)}, ${two(Math.floor(within / 60))}:${two(within % 60)}`;
}

// ---- money in the chat's coins ------------------------------------------------------------------------------------------

const plain = value => String(value ?? '').normalize('NFKC').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();

/**
 * An amount in the chat's coins as the narrator's terms and the Adjustments log write it ("4 gold", "6 silver 4 copper"): the screens' own copy of quests/parse.js
 * `money` (this folder imports nothing outside it; tests/v2/screens/rules/calendar.test.js holds the two together). `currency` is `inventory.currency`'s answer.
 */
export function moneyText(amount, currency) {
    const name = plain(typeof currency === 'string' ? currency : currency?.name) || 'gold';
    const coins = typeof currency === 'object' && Array.isArray(currency?.coins) ? currency.coins.filter(coin => Number.isSafeInteger(coin?.value) && coin.value > 0 && plain(coin.name)) : [];
    const n = Number(amount);
    if (coins.length && Number.isSafeInteger(n) && n >= 0) {
        const named = (coin, count) => `${count} ${count === 1 ? plain(coin.name) : plain(coin.plural) || plain(coin.name)}`;
        const base = coins.find(coin => coin.value === 1) ?? { name, plural: plain(currency?.plural) || name };
        if (currency.display === 'base' || n === 0) return named(base, n);
        const parts = [];
        let rest = n;
        const shown = coins.filter((coin, index) => coins.findIndex(other => other.value === coin.value) === index);
        for (const coin of [...shown].sort((a, b) => b.value - a.value)) {
            const count = Math.floor(rest / coin.value);
            if (!count) continue;
            parts.push(named(coin, count));
            rest -= count * coin.value;
        }
        if (rest) parts.push(named(base, rest));
        return parts.join(' ');
    }
    const plural = typeof currency === 'object' ? plain(currency?.plural) : '';
    return `${amount} ${Math.abs(Number(amount)) === 1 || !plural ? name : plural}`;
}

// ---- the story's calendar -----------------------------------------------------------------------------------------------

const isLeap = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const leapsBefore = year => { const p = year - 1; return Math.floor(p / 4) - Math.floor(p / 100) + Math.floor(p / 400) + 1; };

/**
 * A date writer for the chat's calendar, from Story Director's `director.calendar` answer ({ era, months: [{ name, days }], leapYears }): the same days,
 * leap rule and words as Story Director's own `format` (calendar.js; tests/v2/screens/rules/calendar.test.js holds the two together). Null when the answer is
 * not a calendar. `date(minutes, { era })` → "CY 611, Goldwane 12" (the era and year first), or "Goldwane 12" with `era: false`.
 */
export function calendarWriter(config) {
    const months = Array.isArray(config?.months) ? config.months.filter(month => typeof month?.name === 'string' && month.name.trim() && Number.isSafeInteger(month.days) && month.days > 0) : [];
    if (!months.length || months.length !== config.months.length) return null;
    const count = months.length;
    const leapMonth = count > 1 ? 1 : 0;
    const leapYears = config.leapYears === true;
    const era = typeof config.era === 'string' ? clip(config.era.trim(), 24) : '';
    const baseYear = months.reduce((sum, month) => sum + month.days, 0);
    const avgYear = baseYear + (leapYears ? 0.2425 : 0);
    const leap = year => leapYears && isLeap(year);
    const daysBeforeYear = year => baseYear * year + (leapYears ? leapsBefore(year) : 0);
    const daysIn = (year, month) => months[month].days + (month === leapMonth && leap(year) ? 1 : 0);
    const parts = minutes => {
        const total = Math.floor(minutes / DAY_MINUTES);
        let year = Math.floor(total / avgYear);
        while (daysBeforeYear(year) > total) year--;
        while (daysBeforeYear(year + 1) <= total) year++;
        let rest = total - daysBeforeYear(year);
        let month = 0;
        while (month < count - 1 && rest >= daysIn(year, month)) rest -= daysIn(year, month++);
        return { year, month, day: rest + 1 };
    };
    return {
        date(minutes, { era: withEra = true } = {}) {
            if (!Number.isSafeInteger(minutes)) return '';
            const at = parts(minutes);
            const text = `${clip(months[at.month].name, 40)} ${at.day}`;
            return withEra ? (era ? `${era} ${at.year}, ${text}` : `${text}, ${at.year}`) : text;
        },
        year: minutes => (Number.isSafeInteger(minutes) ? parts(minutes).year : null),
    };
}

/** "1 minute", "45 minutes", "2 hours", "1 day 3 hours": a span of story minutes. */
export function spanLabel(minutes) {
    if (!Number.isSafeInteger(minutes) || minutes < 0) return '';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const days = Math.floor(minutes / DAY_MINUTES);
    const hours = Math.floor((minutes % DAY_MINUTES) / 60);
    const rest = minutes % 60;
    const parts = [];
    if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (rest && !days) parts.push(`${rest} minute${rest === 1 ? '' : 's'}`);
    return parts.join(' ');
}

/** "3 / 5". */
export const ratioText = (have, need) => `${have} / ${need}`;

/** The last piece of a definition id (`pack.fixture/c1` → `c1`): what shows when no name is known yet. */
export const refTail = ref => {
    const text = typeof ref === 'string' ? ref : '';
    const at = text.lastIndexOf('/');
    return clip(at >= 0 ? text.slice(at + 1) : text, 80);
};

/** The tier word the basic class and each promotion carry. */
export const TIER_LABELS = Object.freeze(['Basic', 'Tier 1', 'Tier 2', 'Tier 3']);

/** The three options of a path step, in the contract's order [g, a, b]. */
export const OPTION_LABELS = Object.freeze(['Generated', 'Path A', 'Path B']);

// What each error code says when the command did not bring its own sentence. The command's own message wins.
const FAILURE_WORDS = Object.freeze({
    INVALID: 'That was not a valid request.',
    REFUSED: 'The rules do not allow that right now.',
    NOT_FOUND: 'That could not be found any more.',
    NOT_ENOUGH: 'There is not enough for that.',
    CLAIMED: 'That was already done.',
    STALE: 'This changed since it was drawn. Look again and try once more.',
    FEATURE_OFF: 'That part of the game is switched off.',
    LIMITED: 'A limit has been reached.',
    FAILED: 'That did not work.',
    NOT_OWNER: 'That belongs to someone else.',
    UNSUPPORTED: 'This build cannot do that.',
    UNKNOWN_COMMAND: 'This build does not know that command.',
    DEPENDENCY_UNAVAILABLE: 'A module this needs is not answering. It is checked again on the next view.',
    CLOCK_UNSET: 'The story clock is not set, so timed actions wait.',
    RULES_MISMATCH: 'The rules this was made under are not the ones loaded now.',
    CONFLICT: 'That conflicts with something already recorded.',
    SNAPSHOT_UNAVAILABLE: 'The saved copy this needs is not available.',
    RESTORE_PENDING: 'A return in time is still finishing.',
    REPLAY_PREREQUISITE: 'An earlier step this depended on was removed, so this choice is no longer valid.',
});

/** One plain sentence for a refused or failed command result (`{ ok:false, code, message }`). Never markup. */
export function failureLine(result) {
    const code = typeof result?.code === 'string' ? result.code : '';
    const message = clip(typeof result?.message === 'string' ? result.message.trim() : '', 240);
    return message || FAILURE_WORDS[code] || FAILURE_WORDS.FAILED;
}

/**
 * A button's spec for the widget rpg-battle.command-button: the command and the exact payload it sends. Built here so the
 * payload a fixture asserts is the payload the button sends.
 */
export const btn = (command, payload, label, extra = {}) => ({ command, payload, label, tone: 'quiet', disabled: false, title: '', ...extra });

export { FAILURE_WORDS };
