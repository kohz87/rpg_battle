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
