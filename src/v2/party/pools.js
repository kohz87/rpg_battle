// How a member's numbers are kept so that a reply deleted from the middle of the chat takes back
// only its own changes (SPEC §2.2: bookkeeping later replies write is add-only, counted or derived;
// final soak: a rest's `cur: 102` no longer fit once the level-up before it was deleted, and the
// rest's whole block, heal and claim, was skipped). Pure.
//
// * HP, MP and SP keep `lost` (how far the pool is below its max, a count: Story Block's `counters`)
//   next to `max` (a count too) and `cur` (the number as it was written, for readers of the raw state,
//   MODULES §B1). A wound adds to `lost`, a heal takes from it, a level-up raises `max` (and `cur`, so
//   `lost` stays). On replay after a deleted reply each of these adds its own change to what is
//   there (`was` rebase) instead of writing its number.
// * A full pool keeps no `lost`: a rest that fills it ("restore to full"), or a heal up to max, removes
//   it. A pool without `lost` reads as its `cur` as written (held to its max), which is max for a full
//   one. Replayed, the remove of a key already gone does nothing (replay rule a), and the next wound
//   adds `lost` again, counted from full.
// * Level, XP, unspent points and stats are counts as well: a later reply's level-up or spend adds
//   its own step to what is there.
// * The numbers are fitted where they are read (fitActor), never refused: the current pool is
//   max − lost held to 0…max (an older chat's pool, with no `lost`, is its `cur` held to 0…max), and
//   level, XP, points and stats are held to their floors. The party validator takes any whole numbers
//   for them, so a block that moved them is never skipped for it; the next write of the member stores
//   the fitted numbers.
//
// Story Block takes the first counter a removed thing holds as the count it removes (a stack's qty).
// A member leaving the party is a plain remove: `actors/*/id` comes first in the list, and an id is
// text, never a count, so the remove carries no count (and is passed over on replay when the member is
// already gone, as before).

import { STATS } from '../../rules.js';

export const POOLS = Object.freeze(['hp', 'mp', 'sp']);

// The party domain's counters (SPEC §2.2 "Counts move"). The id pattern must stay first (see above).
export const PARTY_COUNTERS = Object.freeze([
    'actors/*/id',
    'actors/*/*/lost',
    'actors/*/*/max',
    'actors/*/level',
    'actors/*/xp',
    'actors/*/points',
    'actors/*/stats/*',
]);

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const int = value => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : 0;
};
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** A pool as it stands now: { cur, max }, cur held to 0…max (from `lost` when kept, else `cur`). */
export function fitPool(entry) {
    const max = Math.max(0, int(entry?.max));
    const raw = Number.isInteger(entry?.lost) ? max - entry.lost : int(entry?.cur);
    return { cur: clamp(raw, 0, max), max };
}

/** Whether a stored pool reads as something other than its fitted { cur, max }. */
function poolFits(entry) {
    if (!isObject(entry)) return false;
    const fitted = fitPool(entry);
    return entry.cur === fitted.cur && entry.max === fitted.max && Object.keys(entry).every(key => key === 'cur' || key === 'max');
}

function actorFits(actor) {
    if (!POOLS.every(name => actor[name] === undefined || poolFits(actor[name]))) return false;
    if (!Number.isInteger(actor.level) || actor.level < 1) return false;
    for (const key of ['xp', 'points']) if (!Number.isInteger(actor[key]) || actor[key] < 0) return false;
    return !isObject(actor.stats) || Object.values(actor.stats).every(value => Number.isInteger(value) && value >= 0);
}

/**
 * A member as it stands now (for every reader): HP, MP and SP fitted to { cur, max }, level from 1,
 * XP, points and stats from 0. The same object when it already fits; else a fitted copy.
 */
export function fitActor(actor) {
    if (!isObject(actor) || actorFits(actor)) return actor;
    const out = { ...actor };
    for (const name of POOLS) if (actor[name] !== undefined) out[name] = fitPool(actor[name]);
    out.level = Math.max(1, int(actor.level));
    out.xp = Math.max(0, int(actor.xp));
    out.points = Math.max(0, int(actor.points));
    if (isObject(actor.stats)) out.stats = Object.fromEntries(Object.entries(actor.stats).map(([key, value]) => [key, Math.max(0, int(value))]));
    return out;
}

/** A party slice with every member fitted (fitActor); the same object when all of them fit. */
export function fitParty(party) {
    if (!isObject(party) || !isObject(party.actors)) return party;
    let actors = null;
    for (const [id, actor] of Object.entries(party.actors)) {
        const fitted = fitActor(actor);
        if (fitted === actor) continue;
        actors ??= { ...party.actors };
        actors[id] = fitted;
    }
    return actors ? { ...party, actors } : party;
}

/** A state whose party slice is fitted (fitParty); the same state when it already fits. */
export function fitState(state) {
    const party = state?.domains?.party;
    const fitted = fitParty(party);
    return fitted === party ? state : { ...state, domains: { ...state.domains, party: fitted } };
}

/**
 * A pool as it is stored from the { cur, max } a command worked out: { cur, max, lost } below full;
 * { cur: max, max } when it is full or `full` (a rest filled it): "restore to full", kept without
 * `lost`.
 */
export function storedPool(pool, { full = false } = {}) {
    const max = Math.max(0, int(pool?.max));
    const cur = full ? max : clamp(int(pool?.cur), 0, max);
    return cur === max ? { cur, max } : { cur, max, lost: max - cur };
}

/** The pools a rest of `kind` fills: a long rest all three, any rest stamina (v1 recovery.rest). */
export const filledBy = kind => (kind === 'long' ? POOLS : ['sp']);

/** The stats a stored member record may hold (validate.js): STATS, whole numbers. */
export const statsFit = stats => isObject(stats) && STATS.every(stat => Number.isInteger(stats[stat])) && Object.keys(stats).every(key => STATS.includes(key));
