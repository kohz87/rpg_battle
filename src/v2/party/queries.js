// The party part's queries (MODULES §B1): read-only, plain copies of the head state's party
// slice, and an actor's fight numbers with the gear they wear (Story Block's inventory domain,
// SPEC §7: the stacks they own that are equipped). `(state, args, tools)` per SPEC §6 and MODULES §F3. Pure.

import { combatNumbers, combatantFromSheet } from '../../party.js';
import { rulesFrom, toSheet, wornGear } from './sheets.js';
import { moneyScale, packOwnRanks, packRanks, rankLadder, termsOf } from '../../terms.js';
import { actorsInOrder, offerText, plainCopy, resolveName, waitingOffers } from './util.js';
import { encumbranceOf } from '../checks/modifiers.js';
import { clockOf, fitParty, lapsed, POOLS } from './pools.js';
import { FEATURE, activeEffects, combatShift, featureOn, nowOfState, shifted, shown } from './effects.js';

/**
 * A member's record with its `portrait` (MODULES §F11): the one kept on the record (your
 * character's persona avatar, given at creation), else for a companion who is an NPC the one NSD
 * has (`npc.portrait({ name })` through the query tools, when NSD is there), else null.
 */
function withPortrait(record, tools) {
    if (!record) return null;
    let portrait = record.portrait ?? null;
    if (!portrait && record.npc && typeof tools?.query === 'function') {
        try {
            const found = tools.query('npc.portrait', { name: record.npc });
            portrait = typeof found === 'string' && found ? found : null;
        } catch {
            portrait = null;
        }
    }
    return { ...record, portrait };
}

// The party as it stands now: every member's numbers fitted (pools.js: a pool's cur from its `lost`,
// held to 0…max), so every reader sees the same numbers whatever a replay left in the record.
const partyOf = state => fitParty(state?.domains?.party ?? { pc: null, order: [], actors: {}, custom: {}, offers: [] }, { minutes: clockOf(state) });

/** Every member, in display order (your character first). */
export function actors(state, args = {}, tools = null) {
    return plainCopy(actorsInOrder(partyOf(state)).map(record => withPortrait(record, tools)));
}

/** One member by `id`, or by a written `name` (v1 findTarget: full name, then first name; "you" is your character); null when none. */
export function actor(state, args = {}, tools = null) {
    const party = partyOf(state);
    if (args?.id) return plainCopy(withPortrait(party.actors?.[args.id] ?? null, tools));
    if (args?.name) return plainCopy(withPortrait(resolveName(party, args.name).actor ?? null, tools));
    return null;
}

/** Your character, or null before one is made. */
export function pc(state, args = {}, tools = null) {
    const party = partyOf(state);
    return plainCopy(withPortrait(party.pc ? party.actors?.[party.pc] ?? null : null, tools));
}

/**
 * The join, skill and leave offers waiting for the reader, oldest first, each with `text`: the
 * plain sentence a screen shows beside Accept and Dismiss.
 */
export function offers(state) {
    const party = partyOf(state);
    return plainCopy(waitingOffers(party).map(offer => ({ ...offer, text: offerText(offer, party) })));
}

/**
 * `party.terms({ settings? })` → the display terms in use (MODULES §F25): { levelName, xpName,
 * tiers: { size, numerals } | null }: the reader's own, else what an enabled pack suggests, else
 * Level and XP. For screens and other modules that word levels and XP.
 */
export function terms(state, args = {}, tools = null) {
    const settings = args?.settings ?? (tools?.settings && typeof tools.settings === 'object' ? tools.settings : null);
    const { levelName, xpName, tiers } = termsOf(rulesFrom(settings));
    return plainCopy({ levelName, xpName, tiers });
}

const settingsFrom = (args, tools) => args?.settings ?? (tools?.settings && typeof tools.settings === 'object' ? tools.settings : null);
const queryOf = tools => (typeof tools?.query === 'function' ? (name, args) => tools.query(name, args) : null);

/**
 * `party.ranks({ settings? })` → the rank ladder (MODULES §F86, §F91; terms.js rankLadder):
 * `[{ id, title, levels: [lo, hi], reward: [lo, hi] }]`, lowest first: the reader's own named
 * ranks, else the first enabled pack's `ranks`, else uniform tiers, else F to S. The rewards: a
 * pack's as written; the built-in F to S by place times the pack's money scale (`inventory.economy`,
 * F104); the reader's and the tiers by level on the pack's own ranks, else on F to S (rankLadder).
 * Story Director's `quest.ranks` reads it; a foe line's `rank:` is read on it.
 */
export function ranks(state, args = {}, tools = null) {
    const query = queryOf(tools);
    return plainCopy(rankLadder(rulesFrom(settingsFrom(args, tools)), { pack: packRanks(query), base: packOwnRanks(query), scale: moneyScale(query) }));
}

/**
 * `party.toSpend({})` → { total, people: [{ id, name, points }] }: the members with stat points
 * waiting to be spent (your character first), for the HUD's and the status card's "points to
 * spend" badge (MODULES §F91). total 0 and no people when nobody has any.
 */
export function toSpend(state) {
    const people = actorsInOrder(partyOf(state)).filter(actor => Number.isInteger(actor.points) && actor.points > 0)
        .map(actor => ({ id: actor.id, name: actor.name, points: actor.points }));
    return plainCopy({ total: people.reduce((sum, entry) => sum + entry.points, 0), people });
}

/**
 * `party.effects({ actor?, now? })` → the timed buffs and debuffs on now (feature
 * `rpg-battle.effects`; [] while it is off): [{ id, actor, name, note, tone: 'good'|'bad', left:
 * '2 h' | '3 replies' | 'while worn' | '', source: 'Hawk Draught' | 'quest: …' | …, checks: [{ on,
 * amount }], combat: { attack?: %, … } }], oldest first. With `actor`, that member's and everyone's
 * (actor 'party'). `now` ({ minutes, at }) is read from the story clock and the latest reply when
 * not given.
 */
export function effects(state, args = {}, tools = null) {
    if (!featureOn(tools)) return [];
    const now = args?.now && typeof args.now === 'object' ? { minutes: args.now.minutes ?? null, turn: args.now.turn ?? 0 } : nowOfState(state, queryOf(tools));
    const on = activeEffects(state, now).filter(effect => !args?.actor || effect.actor === args.actor || effect.actor === 'party');
    return plainCopy(on.map(effect => shown(effect, now)));
}

/**
 * A member's fight numbers with their equipped gear (v1 party.combatNumbers: attack, magic,
 * defence, mdef, crit, hit, dodge, stats with gear) and their HP/MP/SP maxima with it, plus the
 * gear counted. `args.settings` (the module's settings) when the caller has them. null for an
 * unknown id.
 */
export function combatNumbersOf(state, args = {}, tools = null) {
    const party = partyOf(state);
    const member = party.actors?.[args?.id];
    if (!member) return null;
    const rules = rulesFrom(args?.settings ?? null);
    // The gear as the items part counts it (wear, refinement, broken pieces out), else the defs as they are.
    const gear = wornGear(queryOf(tools), state?.domains?.inventory, member.id, { pc: party.pc });
    const sheet = toSheet(member);
    const numbers = combatNumbers(sheet, { gear, rules });
    const fighter = combatantFromSheet({ ...sheet, skills: [] }, { gear, rules });
    // Timed buffs and debuffs move the fight numbers too (held to their caps, effects.js); through the
    // host's party.effects when there is one, so a feature switched off answers none.
    const ask = queryOf(tools);
    let on = [];
    try { on = ask ? ask('party.effects', { actor: member.id }) : effects(state, { actor: member.id }, tools); } catch { on = []; }
    const shift = combatShift(Array.isArray(on) ? on : []);
    for (const [name, percent] of Object.entries(shift)) if (Number.isFinite(numbers[name])) numbers[name] = shifted(numbers[name], percent);
    // Encumbered (Story Block's inventory.encumbrance): its penalty on those stats in the fight too.
    const burden = encumbranceOf(ask, member.id);
    if (burden && numbers.stats && typeof numbers.stats === 'object') {
        for (const stat of burden.stats) if (Number.isFinite(numbers.stats[stat])) numbers.stats[stat] = Math.max(0, numbers.stats[stat] + burden.penalty);
    }
    return plainCopy({
        ...numbers, hp: fighter.hp, mp: fighter.mp, sp: fighter.sp, gear: gear.map(item => item.name),
        ...(Object.keys(shift).length ? { effects: shift } : {}), ...(burden ? { encumbered: burden } : {}),
    });
}

/**
 * `party.encumbered({ actor })` → { penalty: −2, stats: ['AGI', 'DEX'], text: 'Encumbered: AGI and
 * DEX checks −2' } while Story Block says that member carries too much (inventory.encumbrance),
 * else null: a condition the party card shows. Nothing without Story Block's query.
 */
export function encumbered(state, args = {}, tools = null) {
    const burden = encumbranceOf(queryOf(tools), args?.actor ?? partyOf(state).pc);
    if (!burden) return null;
    return plainCopy({ ...burden, text: `Encumbered: ${burden.stats.join(' and ')} checks −${-burden.penalty}` });
}

/**
 * `party.pools({})` → { [actor id]: { hp, mp, sp: { cur, max }, down, lapsed: [condition kinds], turns:
 * { [condition kind]: rounds left } } }: every member's pools as they stand now (pools.js fitPool), the
 * conditions a fight left that have worn off with story time (pools.js lapsed) and the rounds the others
 * have left by then (roundsLeft), for a card that reads one reply's state (the status card).
 */
export function pools(state) {
    const party = partyOf(state);
    const minutes = clockOf(state);
    const out = {};
    for (const actor of actorsInOrder(party)) {
        out[actor.id] = Object.fromEntries(POOLS.map(name => [name, { cur: actor[name]?.cur ?? 0, max: actor[name]?.max ?? 0 }]));
        out[actor.id].down = out[actor.id].hp.cur <= 0;
        const kept = state?.domains?.party?.actors?.[actor.id]?.conditions;
        out[actor.id].lapsed = (Array.isArray(kept) ? kept : []).filter(entry => lapsed(entry, minutes)).map(entry => entry.kind);
        // The rounds each condition has left by now (a fight's counted down by story time, pools.js roundsLeft).
        out[actor.id].turns = Object.fromEntries((actor.conditions ?? []).filter(entry => entry?.kind).map(entry => [entry.kind, Math.max(1, Math.round(Number(entry.stacks) || 1))]));
    }
    return plainCopy(out);
}

export const queries = {
    'party.actors': actors,
    'party.actor': actor,
    'party.pc': pc,
    'party.offers': offers,
    'party.terms': terms,
    'party.combatNumbers': combatNumbersOf,
    'party.ranks': ranks,
    'party.toSpend': toSpend,
    'party.pools': pools,
    'party.encumbered': encumbered,
    // Feature rpg-battle.effects (MODULES §F100): null from Story Block while it is off.
    'party.effects': Object.assign(effects, { feature: FEATURE }),
};
