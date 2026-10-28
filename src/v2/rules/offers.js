// RPG Battle v2, the generative offers kept in the `rules` domain (GENERATIVE_OFFERS_SPEC §7.1):
//
//   rules['offer.<th_ id>']    = Offer     every job the narrator offered in its own words, under the id of the thread it made
//   rules['declined.<dk_ id>'] = Declined  the far-out decisions: a job (or teacher) that was not offered, under the key of its name
//   rules.mode                 = 'free' | 'strict'   the mode of Jobs from the story this chat was pinned in (rules/mode.js); none: strict, as before 2.3.0
//
// Each record is one key of the slice itself, so its parent always exists: a chat pinned before 2.3.0 has no map to make, and taking the reply that made one
// record back takes that record only (a map made by the first offer would take every later one's parent with it). `offersOf` and `declinedOf` read them as
// maps by id; nothing else knows the key names.
//
//   Offer    = { v: 1, matcher, line, sid, name, said, settled, band, notes, where, shown? }
//     matcher  the version of the reading rules that decided it; line the first 16 hex of the hash of the line as written (a Re-read of the
//     same line reuses `settled`, whatever matcher is running then); sid the reply's carrier; said the labels as read; band 'within' | 'moderate';
//     notes what code moved, for the card; where the place's name; settled (settledProblem) every number code fixed; shown the objective, the coin and
//     the deadline in the chat's words (the card and the Adjustments log do not ask for the currency again).
//   Declined = { v: 1, matcher, sid, name, reason, suggestion, band: 'far', said?, kind? }   kind 'job' | 'teacher', said the labels as read
//
// Absent until first used. `rules.recordOffer` is the one writer, for this module's own capture. Pure apart from the command.

import { TRUSTED, isDefId, isId, isObject, isRecordId } from './ids.js';

export const MAX_DECLINED = 50;
export const OFFER_KEY = 'offer.';
export const DECLINED_KEY = 'declined.';
export const MAX_RECORDS = 2000;
const HOWS = ['exact', 'contains', 'part', 'scan', 'variant'];
const text = (value, max, min = 0) => typeof value === 'string' && [...value].length >= min && [...value].length <= max && !/[<>\p{Cc}]/u.test(value);
const int = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const sid = value => typeof value === 'string' && /^[a-z][a-z0-9]*_[0-9a-z]{1,40}$/.test(value);
export const isOfferId = value => typeof value === 'string' && /^th_[0-9a-z]{8}$/.test(value);
export const isDeclinedId = value => typeof value === 'string' && /^dk_[0-9a-f]{12}$/.test(value);

const keyed = (slice, prefix) => {
    const out = {};
    if (isObject(slice)) for (const key of Object.keys(slice)) if (key.startsWith(prefix)) out[key.slice(prefix.length)] = slice[key];
    return out;
};
/** The recorded jobs of a rules slice by thread id, and the far-out decisions by key (`{}` for a chat with none). */
export const offersOf = slice => keyed(slice, OFFER_KEY);
export const declinedOf = slice => keyed(slice, DECLINED_KEY);

/** What is wrong with the numbers a matched offer settled, or ''. */
export function settledProblem(settled) {
    if (!isObject(settled)) return 'is not a record';
    const known = ['template', 'text', 'foe', 'item', 'place', 'count', 'coin', 'coinBy', 'xp', 'durationMinutes', 'turnInPlace', 'giver', 'rank', 'area', 'waived', 'fightTier'];
    if (Object.keys(settled).some(key => !known.includes(key))) return 'has a field of no meaning';
    if (!isDefId(settled.template) || !text(settled.text, 240, 1)) return 'names no template and goal';
    if (settled.foe !== undefined && (!isObject(settled.foe) || !isId(settled.foe.ref) && !/^[^~]+~[a-z0-9-]+$/.test(String(settled.foe.ref)) || !isDefId(settled.foe.base)
        || !text(settled.foe.name, 80, 1) || !HOWS.includes(settled.foe.how))) return 'has a foe that is not whole';
    if (settled.fightTier !== undefined && (settled.foe === undefined || !['weak', 'strong'].includes(settled.fightTier))) return 'has a fight tier that is not weak or strong, or no foe to fight';
    if (settled.item !== undefined && (!isObject(settled.item) || !isDefId(settled.item.ref) || !text(settled.item.name, 80, 1))) return 'has an item that is not whole';
    if (settled.place !== undefined && (!isObject(settled.place) || !isId(settled.place.id) || !text(settled.place.name, 80, 1))) return 'has a place that is not whole';
    if ([settled.foe, settled.item, settled.place].filter(row => row !== undefined).length > 1) return 'names more than one target';
    if (settled.count !== undefined && !int(settled.count, 1, 999)) return 'has a count out of bounds';
    if (!int(settled.coin, 0, 1e9) || !['said', 'formula'].includes(settled.coinBy) || !int(settled.xp, 0, 1e9)) return 'has a reward out of bounds';
    if (settled.durationMinutes !== null && !int(settled.durationMinutes, 1, 5256000)) return 'has a deadline out of bounds';
    if (settled.turnInPlace !== null && !isId(settled.turnInPlace)) return 'has a turn-in place that is not an id';
    if (settled.giver !== null && !text(settled.giver, 80, 1)) return 'has a giver that is not plain text';
    if (!text(settled.rank, 20, 1) || !isObject(settled.area) || !int(settled.area.tier, 0, 9) || !['place', 'rank', 'foe'].includes(settled.area.from)) return 'has a rank and an area that are not whole';
    if (!Array.isArray(settled.waived) || settled.waived.some(word => word !== 'level')) return 'waives something that cannot be waived';
    return '';
}

const labels = value => isObject(value) && Object.keys(value).length <= 16 && Object.values(value).every(entry => text(entry, 240));
const notes = value => Array.isArray(value) && value.length <= 6 && value.every(entry => text(entry, 160));

/** What is wrong with one recorded offer (under the thread id it made), or null. */
export function offerProblem(id, offer) {
    if (!isOfferId(id) || !isObject(offer) || offer.v !== 1 || !int(offer.matcher, 1, 1000)) return 'is not whole';
    if (!/^[0-9a-f]{16}$/.test(offer.line ?? '') || !sid(offer.sid) || !text(offer.name, 80, 1) || !labels(offer.said) || !notes(offer.notes) || !text(offer.where, 80)) return 'has text that is not plain or the right length';
    if (!['within', 'moderate'].includes(offer.band)) return 'has a band that is not within or moderate';
    if (Object.hasOwn(offer, 'shown') && !(isObject(offer.shown) && Object.values(offer.shown).every(value => text(value, 120)))) return 'shows text that is not plain';
    const bad = settledProblem(offer.settled);
    return bad ? `settled ${bad}` : null;
}

/** What is wrong with one far-out decision (under the key of its name), or null. */
export function declinedProblem(id, record) {
    if (!isDeclinedId(id) || !isObject(record) || record.v !== 1 || !int(record.matcher, 1, 1000) || record.band !== 'far') return 'is not whole';
    if (!sid(record.sid) || !text(record.name, 80, 1) || !text(record.reason, 200) || !text(record.suggestion, 200)) return 'has text that is not plain or the right length';
    if (Object.hasOwn(record, 'said') && !labels(record.said)) return 'has labels that are not plain';
    if (Object.hasOwn(record, 'kind') && !['job', 'teacher'].includes(record.kind)) return 'is of no kind';
    return null;
}

/** The problems of the recorded offers and decisions of a rules slice (the domain validator adds them to its own). */
export function offersProblems(slice) {
    const errors = [];
    if (isObject(slice) && slice.mode !== undefined && slice.mode !== 'free' && slice.mode !== 'strict') errors.push('rules: mode must be free or strict');
    for (const [name, map, check] of [['offers', offersOf(slice), offerProblem], ['declined', declinedOf(slice), declinedProblem]]) {
        const keys = Object.keys(map);
        if (keys.length > MAX_RECORDS) { errors.push(`rules: more than ${MAX_RECORDS} ${name}`); continue; }
        for (const key of keys) {
            const problem = check(key, map[key]);
            if (problem) errors.push(`rules: ${name} ${key.slice(0, 20)} ${problem}`);
        }
    }
    return errors;
}

const FIELDS = ['write', 'thread', 'declined', 'record'];

/** rules.recordOffer { write, thread | declined, record }: this module's capture adds one record, by key (at most MAX_DECLINED far-out decisions are kept). */
export function recordOffer(ctx, payload) {
    if (!isObject(payload) || Object.keys(payload).some(key => !FIELDS.includes(key)) || !isRecordId(payload.write) || !isObject(payload.record)
        || [payload.thread, payload.declined].filter(value => value !== undefined).length !== 1) ctx.fail('INVALID', 'rules.recordOffer takes { write, thread | declined, record }.');
    if (!TRUSTED.recordOffer.includes(ctx.caller)) ctx.fail('REFUSED', 'A job is recorded by RPG Battle\'s own capture of the story\'s line, never from a button.');
    const slice = ctx.read('rules');
    if (!isObject(slice) || slice.pin === null) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    const draft = ctx.draft('rules');
    if (payload.thread !== undefined) {
        const problem = offerProblem(payload.thread, payload.record);
        if (problem) ctx.fail('INVALID', `That offer ${problem}.`);
        if (Object.hasOwn(slice, OFFER_KEY + payload.thread)) ctx.fail('CONFLICT', 'That job is already recorded.');
        draft[OFFER_KEY + payload.thread] = payload.record;
        return { summary: `${payload.record.name} recorded.`, narrate: false, data: { thread: payload.thread } };
    }
    const problem = declinedProblem(payload.declined, payload.record);
    if (problem) ctx.fail('INVALID', `That decision ${problem}.`);
    if (Object.hasOwn(slice, DECLINED_KEY + payload.declined)) ctx.fail('CONFLICT', 'That decision is already recorded.');
    if (Object.keys(declinedOf(slice)).length >= MAX_DECLINED) ctx.fail('LIMIT', `At most ${MAX_DECLINED} far-out decisions are kept.`);
    draft[DECLINED_KEY + payload.declined] = payload.record;
    return { summary: `${payload.record.name} was not offered.`, narrate: false, data: { declined: payload.declined } };
}
