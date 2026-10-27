// RPG Battle v2, generative offers: the three bands, the notes a card carries and the two lines told back to the narrator
// (GENERATIVE_OFFERS_SPEC §6, §8, §9.2). Pure: no ctx, no state. The decision is made once, at capture, and stored with the offer.

import { money } from './parse.js';
import { durationText } from './offer-words.js';

/** The version of the reading rules (the tables and the order of the steps); each offer records the one that decided it (§7.1). */
export const MATCHER = 1;

/** A number written more than FAR times its maximum is far out: no offer. One constant, as the spec has it. */
export const FAR = 3;
/** How many far-out lines one reply tells; the rest are counted ("…and N more offers were not possible."). */
export const FAR_TOLD = 2;
export const BAND_WITHIN = 'within';
export const BAND_MODERATE = 'moderate';
export const BAND_FAR = 'far';

/** The most notes an offer keeps, and the longest one. */
export const NOTES_MAX = 6;
export const NOTE_CHARS = 160;
/** The settled-terms line and the far-out line, cut to this many code points. */
export const TERMS_CHARS = 320;
export const FAR_CHARS = 300;

export const cut = (value, max) => [...String(value ?? '')].slice(0, max).join('');
export const flat = (value, max) => cut(String(value ?? '').replace(/[<>\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim(), max);

/**
 * A written number held to `[min, max]`: `{ value, moved, far }`. `far` when it is above FAR times the maximum (then `value` is the maximum, unused);
 * `moved` when it was raised to the minimum or cut to the maximum.
 */
export function hold(written, min, max) {
    if (written > FAR * max) return { value: max, moved: true, far: true };
    if (written < min) return { value: min, moved: true, far: false };
    if (written > max) return { value: max, moved: true, far: false };
    return { value: written, moved: false, far: false };
}

/** The band of a decision: the worst of its parts. */
export const bandOf = ({ far = false, moved = false } = {}) => (far ? BAND_FAR : moved ? BAND_MODERATE : BAND_WITHIN);

/** The wording of the card notes (§9.2); each is cut to NOTE_CHARS where it is kept. */
export const NOTE = Object.freeze({
    countSet: n => `count set to ${n}`,
    countCapped: max => `count capped at ${max}`,
    rewardSet: (coin, rank, currency) => `reward set to ${money(coin, currency)} (rank ${rank} range)`,
    rewardForeign: (text, coin, currency) => `reward "${text}" is not this chat's money; set to ${money(coin, currency)}`,
    rewardUnreadable: (text, coin, currency) => `reward "${text}" has no amount code can read; set to ${money(coin, currency)}`,
    deadlineSet: minutes => `deadline set to ${durationText(minutes)}`,
    noClock: () => 'no story clock, so no deadline',
    variant: (name, base) => `${name} is a named kind of ${base}`,
    noFoe: phrase => `no foe for "${phrase}"; the story judges the goal`,
    noItem: phrase => `no pack item for "${phrase}"; the story judges the goal`,
    noPlace: phrase => `no place for "${phrase}"; the story judges the goal`,
    cannotFight: (name) => `${name} cannot be fought under these rules; the story judges the goal`,
    setAside: (word, foe, rank) => `${word} set aside: ${foe} is a rank ${rank} foe`,
    aboveRank: (job, party) => `well above your rank (rank ${job} job; you are rank ${party})`,
    likeUnknown: like => `like: ${like} is not a template`,
    unused: label => `${label} was not used`,
    feeSet: (fee, currency) => `fee set to ${money(fee, currency)}`,
    feeForeign: text => `fee "${text}" is not this chat's money; the fee is rolled instead`,
    feeUnreadable: text => `fee "${text}" has no amount code can read; the fee is rolled instead`,
    matched: (template, asked) => `matched ${template} (${asked})`,
    feeRolled: fee => `fee ${fee} (rolled)`,
    skillDropped: (skill, template) => `${skill} is not taught by ${template}`,
});

/** Notes as stored: flat, cut, at most NOTES_MAX, none twice. */
export const keepNotes = list => [...new Set(list.map(note => flat(note, NOTE_CHARS)).filter(Boolean))].slice(0, NOTES_MAX);

/** `text` held to `max` characters with an ellipsis. */
const shorten = (text, max) => ([...text].length <= max ? text : `${cut(text, Math.max(0, max - 1)).trimEnd()}…`);
/** The shortest a name, a giver or a place is made to get a line to fit. */
const FLOOR = 8;
/**
 * `text` built from `parts` (an object the builder reads) held to `max` characters. `steps` are `[key, shortest]`: each piece is cut only as far as the line is
 * over, down to its shortest, in that order, so the terms that follow (the pay, the fight line, the closing sentence) always stay whole.
 */
function fitted(build, parts, steps, max) {
    let text = build(parts);
    for (const [key, shortest] of steps) {
        const over = [...text].length - max;
        if (over <= 0) break;
        parts[key] = shorten(parts[key], Math.max(shortest, [...parts[key]].length - over));
        text = build(parts);
    }
    return [...text].length > max ? cut(text, max) : text;
}

/** `Posted job: …` (§8.1): the settled terms, told once on the reply after the offer. The long free text is cut (the place, the giver and the name first, to a fair length, then the objective), never the terms. */
export function termsLine({ name, giver = null, objective, deadline = null, coin, xp, where = '', fight = '' }, currency) {
    const closing = ' These are the terms from now on; nobody in the scene has to restate them.';
    const build = p => `Posted job: ${p.name}${p.giver ? ` (from ${p.giver})` : ''}: ${p.objective}${deadline ? ` within ${deadline}` : ''}; pays ${money(coin, currency)} and ${xp} XP, turned in at ${p.where || 'a settlement'}.${fight ? ` Fight ${fight.count > 1 ? 'them' : 'it'} as ${fight.line}.` : ''}${closing}`;
    return fitted(build, { name, giver: giver ?? '', objective, where }, [['where', 30], ['giver', 30], ['name', 40], ['objective', FLOOR], ['where', FLOOR], ['giver', FLOOR], ['name', FLOOR]], TERMS_CHARS);
}

/** The reasons a job cannot be offered (§8.2): `{ reason, suggestion }` for the far-out line. */
export const FAR_REASON = Object.freeze({
    reward: ({ written, max, rank }, currency) => ({ reason: `${money(written, currency)} is far above what a rank ${rank} job pays: ${money(max, currency)} at most`, suggestion: `it for ${money(max, currency)} or less` }),
    fee: ({ written, max, template }, currency) => ({ reason: `a fee of ${money(written, currency)} is far above ${template}: ${money(max, currency)} at most`, suggestion: `the lessons for ${money(max, currency)} or less` }),
    done: () => ({ reason: 'it was offered and finished at once', suggestion: 'it as an open job, and close it when it is done' }),
    already: ({ name }) => ({ reason: `${name} is already done`, suggestion: 'a new job under a new name' }),
    elsewhere: ({ name, where }) => ({ reason: `${name} already teaches at ${where || 'another place'}`, suggestion: 'them where they teach, or another teacher' }),
});

/** `Earlier, … was mentioned …` (§8.2): the one retcon line for a far-out offer. */
export function farLine(parts) {
    return cut(farText(parts), FAR_CHARS);
}
const farText = ({ name, reason, suggestion }) => `Earlier, ${name} was mentioned as a job, but it isn't one that can be offered here (${reason}). Let it stay as talk or a rumour; if a job is wanted, offer ${suggestion}.`;

/** The fight line the terms name (§5.4): `! encounter 6 Culvert Rats | like: cellar-rat-swarm` for a named kind, `! encounter 4 Fen Wolf` for a pack foe. */
export function encounterLine(foe, count) {
    const n = count > 1 ? `${count} ` : '';
    return `! encounter ${n}${foe.name}${foe.how === 'variant' ? ` | like: ${String(foe.base).split('/')[1]}` : ''}`;
}

/** The settled terms of a matched offer (§8.1) as the narrator is told them: `result` is `matchOffer`'s, `name` the job's name, `item` its pack item. */
export function settledTerms(result, name, currency) {
    const { settled } = result;
    const objective = settled.foe ? `kill ${settled.count} ${settled.foe.name}` : settled.item ? `bring ${settled.count} ${settled.item.name}` : settled.place ? `go to ${settled.place.name}` : settled.text;
    return termsLine({
        name, giver: settled.giver, objective, deadline: settled.durationMinutes === null ? null : durationText(settled.durationMinutes),
        coin: settled.coin, xp: settled.xp, where: result.where, fight: settled.foe ? { count: settled.count, line: encounterLine(settled.foe, settled.count) } : null,
    }, currency);
}

/** The far-out line (§8.2) of a far decision of the matchers (`why`: reward, fee, done, already, elsewhere). */
export function farLineOf(far, currency) {
    const build = p => farText({ name: p.name, ...farReasonOf({ ...far, name: p.name, where: p.where }, currency) });
    return fitted(build, { name: far.name, where: far.where ?? '' }, [['name', FLOOR], ['where', FLOOR]], FAR_CHARS);
}

/** The reason and the suggestion of a far decision, as the far-out line and the declined record both keep them: `{ reason, suggestion }`. */
export function farReasonOf(far, currency) {
    return FAR_REASON[far.why](far, currency);
}

/**
 * What the card and the Adjustments log show of an offer without asking for the currency again (it is not in the state): the objective, the coin and the
 * deadline in words, worked out once at capture and kept with the record.
 */
export function shownOf(result, currency) {
    const { settled } = result;
    const objective = settled.foe ? `kill ${settled.count} ${settled.foe.name}` : settled.item ? `bring ${settled.count} ${settled.item.name}` : settled.place ? `go to ${settled.place.name}` : settled.text;
    return { objective: cut(objective, 120), coin: cut(money(settled.coin, currency), 40), deadline: settled.durationMinutes === null ? '' : durationText(settled.durationMinutes) };
}
