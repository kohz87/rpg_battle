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
// * Level, unspent points and stats are counts as well: a later reply's level-up or spend adds its own
//   step to what is there. XP is kept as `earned` (a count: what the member has earned since their
//   oldest kept level step, awards only ever add to it) and each level-up as a step of its own under
//   `up<N>` (the level it reached: { xp it took, points, hp, mp, sp it added }, added by key, the last
//   STEPS_KEPT kept). The XP shown is `earned` less the XP the steps took (`xp` itself is the number as
//   it was written, for readers of the raw state). After a delete takes back an award a later level-up
//   needed (confirm C-2), that XP reads below 0: the level is not earned, so the latest steps are undone
//   where the member is read (fitActor), level, points and the pools' max with them, until it is not.
//   The stats a spend raised stay; points spent past what the remaining levels give are owed (unspent
//   points below 0, kept as a negative count), and the next level's points pay them first.
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
    'actors/*/earned',
    'actors/*/points',
    'actors/*/stats/*',
    // The story minute the party has recovered up to (recovery.js): moved as Story Director's clock is.
    'rested',
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

// How long a condition a fight left lasts in story time (B-c1-1): far more than the rounds it had.
export const FIGHT_LEFT_MINUTES = 10;

/** Whether a condition a fight left (it keeps `rounds` and `at`) has worn off by story minute `minutes`. */
export const lapsed = (entry, minutes) => Number.isInteger(minutes) && Number.isInteger(entry?.rounds) && Number.isInteger(entry?.at) && minutes - entry.at >= FIGHT_LEFT_MINUTES;

// How many level steps a member keeps (the latest ones): a delete can take back that many level-ups.
export const STEPS_KEPT = 20;
const STEP_KEY = /^up(\d{1,4})$/;
/** The key a level step is kept under: `up<level reached>`. */
export const stepKey = level => `up${level}`;
const isStep = value => isObject(value) && Number.isInteger(value.xp) && value.xp >= 0;

/** A member's level steps up to `level`: [[level, step]], lowest first. */
export function levelSteps(actor, level = Infinity) {
    const out = [];
    for (const [key, value] of Object.entries(actor ?? {})) {
        const at = STEP_KEY.exec(key);
        if (at && Number(at[1]) >= 2 && Number(at[1]) <= level && isStep(value)) out.push([Number(at[1]), value]);
    }
    return out.sort((a, b) => a[0] - b[0]);
}

/**
 * The level, XP and points a member's record earns (confirm C-2), or null for a record without
 * `earned` (an older one: read as written): { level, xp, points, undone: [levels], pools: { hp, mp, sp }
 * (how much each max goes down) }. XP is `earned` less what the kept steps up to the level took; while
 * it is below 0, the top level's step is undone (its XP back, its points and pool growth taken away).
 */
export function earnedLevel(actor) {
    if (!Number.isInteger(actor?.earned)) return null;
    let level = Math.max(1, int(actor.level));
    const steps = new Map(levelSteps(actor, level));
    let xp = actor.earned - [...steps.values()].reduce((sum, step) => sum + step.xp, 0);
    let points = int(actor.points);
    const pools = { hp: 0, mp: 0, sp: 0 };
    const undone = [];
    while (xp < 0 && level > 1 && steps.has(level)) {
        const step = steps.get(level);
        xp += step.xp;
        points -= int(step.points);
        for (const name of POOLS) pools[name] += Math.max(0, int(step[name]));
        undone.push(level);
        level -= 1;
    }
    return { level, xp: Math.max(0, xp), points, undone, pools };
}

function actorFits(actor, minutes) {
    if (Array.isArray(actor.conditions) && actor.conditions.some(entry => lapsed(entry, minutes))) return false;
    if (!POOLS.every(name => actor[name] === undefined || poolFits(actor[name]))) return false;
    if (!Number.isInteger(actor.level) || actor.level < 1) return false;
    const earned = earnedLevel(actor);
    if (earned && (earned.undone.length || earned.xp !== actor.xp)) return false;
    if (!Number.isInteger(actor.xp) || actor.xp < 0) return false;
    // Unspent points below 0 are owed (a spend a deleted level-up paid for), kept as they are.
    if (!Number.isInteger(actor.points) || (actor.points < 0 && !earned)) return false;
    return !isObject(actor.stats) || Object.values(actor.stats).every(value => Number.isInteger(value) && value >= 0);
}

/**
 * A member as it stands now (for every reader): HP, MP and SP fitted to { cur, max }, level from 1 and
 * only as far as the XP earned reaches (earnedLevel), XP and stats from 0, points from 0 (below 0 when owed), and (with the story clock's `minutes`) without the conditions a fight
 * left that have worn off. The same object when it already fits; else a fitted copy.
 */
export function fitActor(actor, { minutes = null } = {}) {
    if (!isObject(actor) || actorFits(actor, minutes)) return actor;
    const out = { ...actor };
    if (Array.isArray(actor.conditions)) out.conditions = actor.conditions.filter(entry => !lapsed(entry, minutes));
    const earned = earnedLevel(actor);
    for (const name of POOLS) {
        if (actor[name] === undefined) continue;
        // A level undone takes its pool growth back: the max goes down, what was lost stays lost.
        const down = earned?.pools?.[name] ?? 0;
        out[name] = fitPool(down && isObject(actor[name]) ? { ...actor[name], max: Math.max(name === 'hp' ? 1 : 0, int(actor[name].max) - down) } : actor[name]);
    }
    for (const level of earned?.undone ?? []) delete out[stepKey(level)];
    out.level = earned ? earned.level : Math.max(1, int(actor.level));
    out.xp = earned ? earned.xp : Math.max(0, int(actor.xp));
    out.points = earned ? earned.points : Math.max(0, int(actor.points));
    if (isObject(actor.stats)) out.stats = Object.fromEntries(Object.entries(actor.stats).map(([key, value]) => [key, Math.max(0, int(value))]));
    return out;
}

/** A party slice with every member fitted (fitActor, `options.minutes`: the story clock); the same object when all of them fit. */
export function fitParty(party, options = {}) {
    if (!isObject(party) || !isObject(party.actors)) return party;
    let actors = null;
    for (const [id, actor] of Object.entries(party.actors)) {
        const fitted = fitActor(actor, options);
        if (fitted === actor) continue;
        actors ??= { ...party.actors };
        actors[id] = fitted;
    }
    return actors ? { ...party, actors } : party;
}

/** A state whose party slice is fitted (fitParty, at the state's story clock); the same state when it already fits. */
export function fitState(state) {
    const party = state?.domains?.party;
    const fitted = fitParty(party, { minutes: clockOf(state) });
    return fitted === party ? state : { ...state, domains: { ...state.domains, party: fitted } };
}

/** The story clock a state holds (Story Director's `director.time.minutes`, read as data), or null without one. */
export function clockOf(state) {
    const time = state?.domains?.director?.time;
    const minutes = isObject(time) ? time.minutes : time;
    return Number.isInteger(minutes) && minutes >= 0 ? minutes : null;
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
