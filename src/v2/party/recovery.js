import { preserveInjury } from '../death/injury.js';
// HP, MP and SP that come back as story time passes (v1 recovery.recoverOverTime, DESIGN §8.5),
// feature `rpg-battle.recovery` (MODULES §F100, on by default). The clock is Story Director's
// (`director.time`, read only through a query that may not be there, rule 11): without it nothing
// comes back by time, only by rests, items and the story's heals.
//
// The rule (v1's numbers, rules.recovery): every whole story hour gives back `perHour` (5 %) of
// max HP and MP and `spPerHour` of max SP (a whole hour fills stamina); `longRestHours` (6) or more
// at once is a full rest: everything filled and what a fight left ended, as `! rest long` does.
// Minutes short of an hour wait for the next stretch, so many short replies heal as one long one; but not across a wound or the end of a fight: they are spent with it (`spend`).
//
// Bookkeeping (SPEC §2.2): `party.rested` is the story minute the party has recovered up to, a
// count (PARTY_COUNTERS), and every heal is a change of the pools' `lost` counts (pools.js). Story
// time is folded in (party.recover) before each new reply (the beforeGenerate cue, kept with the
// reply whose time it was; a Re-read of that reply plans it again, `replan`), and before anything else that writes a member's HP: a story wound or
// heal, a rest, an item, a fight starting. So a reply's time heals what was there before the lines
// after it, and a replay after a deleted reply adds each heal and each move of `rested` to what is
// there, as Story Director's own clock moves.
// * A clock set back heals nothing and leaves `rested` where it was: the time up to it is never
//   healed twice, and nothing healed is taken back.
// * While a fight has the party, time heals nothing (the fight's numbers are the fight's): `rested`
//   moves on with the clock. So it does while the feature is off (the cue still runs): turned back on,
//   it never heals the time it was off.
// * A new chat starts with `rested: null`; the first clock reading only sets it. An older chat's
//   party (no `rested` yet) first gets `null`, so a replay after a deleted reply never counts the
//   mark up from nothing.
// The dead do not heal. Pure apart from ctx.

import { rest as restV1 } from '../../recovery.js';
import { POOLS, filledBy, fitPool, storedPool } from './pools.js';
import { fromSheet, rulesFrom, rulesSliceOf, settingsOf, toSheet, wornGear } from './sheets.js';
import { sessionOf } from '../combat/stored.js';

export const RECOVERY_FEATURE = 'rpg-battle.recovery';

export const RECOVERY_FEATURES = Object.freeze([{
    id: RECOVERY_FEATURE,
    label: 'HP and MP come back with story time',
    describe: 'With Story Director\'s clock, every story hour gives back 5% of max HP and MP and fills stamina, and 6 hours or more at once is a full rest. Without a story clock nothing comes back by time.',
    default: true,
}]);

const MINUTES_PER_HOUR = 60;

/** Is story-time recovery on? `source` is a ctx or a view; a host without features: on. */
export function recoveryOn(source) {
    try {
        return typeof source?.feature === 'function' ? source.feature(RECOVERY_FEATURE) !== false : true;
    } catch {
        return true;
    }
}

const minutesOf = value => {
    const minutes = value && typeof value === 'object' ? value.minutes : value;
    return Number.isInteger(minutes) ? minutes : null;
};

/** Story Director's clock through `query` (a ctx's or a view's), or null without one (no Story Director, no time set). */
export function clockFrom(query) {
    if (typeof query !== 'function') return null;
    try {
        return minutesOf(query('director.time', {}));
    } catch {
        return null;
    }
}

const isDead = actor => (actor?.conditions ?? []).some(entry => (entry?.kind ?? entry?.name) === 'dead');

/**
 * What folding story time in would do to `party` at story minute `minutes`, or null for nothing:
 * { rested (the new mark), kind, hours } with kind 'mark' (only the mark is set: a first reading,
 * or an older chat's party), 'fight' (time passed in a fight: the mark moves, nobody heals), 'off'
 * (the same while the feature is off), 'hours' (whole hours of `rules.recovery.perHour`) or 'long' (a
 * full rest). `fight`: a fight has the party; `off`: the feature is off.
 */
export function planRecovery(party, minutes, { fight = false, off = false, rules } = {}) {
    if (!party || typeof party !== 'object' || !Number.isInteger(minutes)) return null;
    if (!Object.hasOwn(party, 'rested')) return { rested: null, kind: 'mark', hours: 0 };
    if (!Number.isInteger(party.rested)) return { rested: minutes, kind: 'mark', hours: 0 };
    const passed = minutes - party.rested;
    const longRest = Math.max(1, Math.round((rules?.recovery?.longRestHours ?? 6) * MINUTES_PER_HOUR));
    // Set back (or not an hour yet): nothing, and the mark stays, so the same stretch never heals twice.
    if (passed < MINUTES_PER_HOUR && passed < longRest) return null;
    if (off) return { rested: minutes, kind: 'off', hours: 0 };
    if (fight) return { rested: minutes, kind: 'fight', hours: 0 };
    if (passed >= longRest) return { rested: minutes, kind: 'long', hours: Math.floor(passed / MINUTES_PER_HOUR) };
    const hours = Math.floor(passed / MINUTES_PER_HOUR);
    return { rested: party.rested + hours * MINUTES_PER_HOUR, kind: 'hours', hours };
}

// What `hours` whole hours give back on one pool: a share of its max, rounded down (v1 healBy).
const hourly = (pool, name, hours, recovery) => Math.floor(pool.max * (name === 'sp' ? recovery.spPerHour ?? 1 : recovery.perHour) * hours);

function readInventory(ctx) {
    try {
        return ctx.read('inventory');
    } catch {
        return null;
    }
}

function fightOf(ctx) {
    try {
        return sessionOf(ctx.read('combat'));
    } catch {
        return null;
    }
}

/**
 * Story time folded into the party on a command's draft (ctx: Story Block's command context, the
 * party part's settings): the heals party.recover makes, done in place so a wound, rest, item or
 * fight right after starts from the healed numbers. Nothing when the feature is off, there is no
 * clock or no character, or there is nothing to do; with `markOnly` while it is off, only `rested`
 * moves on. `force` (a rest): the hours since the start of the reply (`since`, or `rested` if that is later) heal whatever the switch of passive recovery says, and whatever of them an earlier
 * fold of the same reply took is not taken twice (`rested` has moved past it). `spend` (a wound, the end of a fight): the minutes short of an hour are spent with the whole hours, so no part of an hour
 * is carried across the damage or the fight into a later heal. → { plan, gains: { [actor]: { hp, mp, sp } } } | null.
 */
export function foldStoryTime(ctx, { markOnly = false, force = false, since = null, spend = false } = {}) {
    const off = !force && !recoveryOn(ctx);
    if (off && !markOnly) return null;
    const minutes = clockFrom(typeof ctx?.query === 'function' ? (name, args) => ctx.query(name, args) : null);
    if (minutes === null) return null;
    let party;
    try {
        party = ctx.read('party');
    } catch {
        return null;
    }
    if (!party?.pc) return null;
    const rules = rulesFrom(settingsOf(typeof ctx.settings === 'function' ? ctx.settings() : null), rulesSliceOf(ctx));
    // A rest folds from the start of its reply: the minutes of earlier replies that waited for an hour (recovery.js, header) are not its hours.
    const from = force && Number.isInteger(since) ? Math.max(since, Number.isInteger(party.rested) ? party.rested : since) : null;
    const plan = planRecovery(from === null ? party : { rested: from }, minutes, { fight: !force && Boolean(fightOf(ctx)), off, rules });
    if (!plan) {
        if (spend && !force && Number.isInteger(party.rested) && minutes > party.rested) ctx.draft('party').rested = minutes;
        return null;
    }
    const draft = ctx.draft('party');
    draft.rested = spend && !force ? Math.max(plan.rested, minutes) : plan.rested;
    const gains = {};
    if (plan.kind !== 'hours' && plan.kind !== 'long') return { plan, gains };
    const inventory = plan.kind === 'long' ? readInventory(ctx) : null;
    for (const id of draft.order) {
        const actor = draft.actors[id];
        if (!actor || isDead(actor)) continue;
        const before = Object.fromEntries(POOLS.map(name => [name, fitPool(actor[name]).cur]));
        if (plan.kind === 'long') {
            // A full rest, as `! rest long` (party.rest): max first worked out with what they wear, and what a fight left ends.
            const rested = restV1(toSheet(actor), 'long', { gear: wornGear((name, args) => ctx.query(name, args), inventory, id, { pc: draft.pc }), rules });
            const next = { ...rested, conditions: (rested.conditions ?? []).filter(entry => !Number.isInteger(entry.rounds)) };
            draft.actors[id] = preserveInjury(ctx, actor, fromSheet(actor, next, rules, { filled: filledBy('long') }));
        } else {
            for (const name of POOLS) {
                const pool = fitPool(actor[name]);
                const cur = Math.min(pool.max, pool.cur + hourly(pool, name, plan.hours, rules.recovery));
                if (cur !== pool.cur) actor[name] = storedPool({ cur, max: pool.max });
            }
        }
        const after = draft.actors[id];
        const gain = Object.fromEntries(POOLS.map(name => [name, fitPool(after[name]).cur - before[name]]));
        if (gain.hp || gain.mp || gain.sp) gains[id] = gain;
    }
    return { plan, gains };
}

const spanText = plan => (plan.hours === 1 ? 'an hour' : `${plan.hours} hours`);

/** The receipt summary for a fold: code's numbers only. */
export function recoveryText(party, fold) {
    const { plan, gains } = fold;
    if (plan.kind === 'mark') return 'Story time noted for recovery.';
    if (plan.kind === 'fight') return 'Story time passed in a fight: nobody recovers from it.';
    if (plan.kind === 'off') return 'Story time passed with recovery switched off: nobody recovers from it.';
    const names = Object.keys(gains).map(id => party.actors[id]?.name).filter(Boolean);
    if (plan.kind === 'long') return names.length ? `${spanText(plan)} pass: ${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} fully rested.` : `${spanText(plan)} pass. Nobody needed the rest.`;
    const parts = Object.entries(gains).map(([id, gain]) => `${party.actors[id]?.name ?? 'someone'} ${[gain.hp ? `HP +${gain.hp}` : '', gain.mp ? `MP +${gain.mp}` : '', gain.sp ? `SP +${gain.sp}` : ''].filter(Boolean).join(', ')}`);
    return parts.length ? `${spanText(plan)} pass: ${parts.join('; ')}.` : `${spanText(plan)} pass. Nobody needed to recover.`;
}

/**
 * party.recover {}: story time folded into the party now (above); with feature `rpg-battle.recovery`
 * off, only the mark moves on. Sent by RPG Battle before each new reply (recoveryBeforeReply); never a
 * button: a click is refused. A fold with nothing to do changes nothing and is still answered.
 */
export function recover(ctx) {
    if (ctx.cause === 'ui' && !ctx.caller) ctx.fail('REFUSED', 'HP and MP come back as story time passes, not from a button.');
    // `replan` (B-a1-13): the fold is planned from the reply's clock, so a Re-read of the reply it is
    // kept on runs it again on the new story changes (Story Block store.replaceStory): time edited out
    // of the reply heals nothing and leaves `rested` where it was.
    const fold = foldStoryTime(ctx, { markOnly: true });
    if (!fold) return { summary: 'No story time to recover from.', data: { kind: null }, narrate: false, replan: true };
    const party = ctx.read('party');
    return { summary: recoveryText(party, fold), data: { kind: fold.plan.kind, hours: fold.plan.hours, rested: fold.plan.rested, gains: fold.gains }, narrate: false, replan: true };
}

/**
 * beforeGenerate (SPEC §4.1 step 3): the party.recover cue when story time has something to fold
 * in, for a new reply only (not a swipe, a Continue, a quiet or an impersonated one).
 */
export function recoveryBeforeReply(view, info = {}) {
    const type = String(info?.type ?? 'normal').toLowerCase();
    if (type === 'swipe' || type === 'continue' || type === 'quiet' || type === 'impersonate') return { commands: [] };
    const party = view?.state?.domains?.party;
    if (!party?.pc) return { commands: [] };
    const minutes = clockFrom(typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null);
    const rules = rulesFrom(settingsOf(view?.settings), view?.state?.domains?.rules);
    const plan = planRecovery(party, minutes, { fight: Boolean(sessionOf(view?.state?.domains?.combat)), off: !recoveryOn(view), rules });
    return plan ? { commands: [{ type: 'party.recover', payload: {} }] } : { commands: [] };
}

const HOUR = 60;

/**
 * The clock when the reply began, when Story Director has not said (it has settled nothing yet: the reply in which the clock first existed is set by a cue that runs after RPG Battle's, so nothing of
 * ours marked it; or the clock is not Story Director's and has no `time.overdue`): the clock when the reply's first Director line was read (`director.turn.now.from`) or the mark recovery keeps (`party.rested`), the earlier of the two; with neither, now (nothing is known to
 * have passed, so nothing has).
 */
function firstStart(ctx, now) {
    const marks = [];
    try {
        const slot = ctx.read('director')?.turn?.now;
        const from = (Array.isArray(slot) ? slot[0] : slot)?.from;
        if (Number.isInteger(from)) marks.push(from);
    } catch { /* no mark of Story Director's */ }
    const rested = ctx.read('party')?.rested;
    if (Number.isInteger(rested)) marks.push(rested);
    const usable = marks.filter(minute => minute <= now);
    return usable.length ? Math.min(...usable) : now;
}

/**
 * The story time a rest has behind it, whatever asks for it (a `! rest` line, the party.rest command), with Story Director's clock: `{ needed, moved, start, short }` in story minutes, or
 * null when the rest is as it always was (no story clock at all). With a clock the rule always holds: a Story Director that cannot say when the reply began has told us nothing passed. `needed` is `longRestHours` (6; `rules.recovery`) for a long rest and an hour for a short one (the smallest
 * stretch story time gives anything back for; v1 and DESIGN §8.5 give a short rest no length). `moved` is the clock now less the clock at the start of the reply: Story Director's `time.overdue` (the
 * clock when story time was last settled, which is the start of the reply, since a time line settles as it moves the clock). Before it has settled anything (the first reply of a chat) it is the
 * mark recovery keeps (`party.rested`, set from the clock when the reply began); with neither, nothing is known to have passed, so nothing has: no rest is free. `short`: the reply did not move the
 * clock `needed` minutes. It does not depend on the switch of passive recovery (`rpg-battle.recovery`): the rest is the clock's.
 */
export function restTime(ctx, kind, rules) {
    const query = (name, args) => ctx.query(name, args);
    const now = clockFrom(query);
    if (now === null) return null;
    let start = null;
    try {
        const settled = query('time.overdue', {});
        start = settled === null ? firstStart(ctx, now) : settled?.minutes;
    } catch {
        // A clock that does not say when story time was settled (not Story Director's own): the marks recovery keeps are the best word of when the reply began.
        start = firstStart(ctx, now);
    }
    // A clock with no word of when the reply began (a Story Director that cannot say): nothing is known to have passed, so nothing has.
    if (!Number.isInteger(start)) start = now;
    const needed = kind === 'long' ? Math.max(HOUR, Math.round((rules?.recovery?.longRestHours ?? 6) * HOUR)) : HOUR;
    const moved = Math.max(0, now - start);
    return { needed, moved, start, short: moved < needed };
}

/** `{ needed, moved }` in story minutes when the reply did not move the clock far enough for the rest (restTime), else null (the rest may go on). */
export function restWanted(ctx, kind, rules) {
    const time = restTime(ctx, kind, rules);
    return time?.short ? { needed: time.needed, moved: time.moved } : null;
}
