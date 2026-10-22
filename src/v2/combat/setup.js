// A fight's setup from the State: the party from `party.actors` (with their gear and the
// consumables they carry), the foes from an offer, projected with v1's enemy rules against the
// chat's bestiary. The result is a v1 startFight setup (combat.js), stored in the session and
// replayed from there. Everything comes in through ctx queries and reads; the only thing kept is
// each creature's power (power.js), which depends on the creature alone.
//
// v1 functions do the work: combatantFromSheet (party.js) for each member, tierPower (below) for
// the tier words, creaturesToMake (templates.js) for names nobody has written up,
// enemiesFromRows and engagements (party.js) for the foes and the waves after the first. Pure
// apart from ctx.

import { DEFAULT_RULES, suggestRank, threatStep } from '../../rules.js';
import { maxLevel } from '../../terms.js';
import { DEFAULT_SKILLS } from '../../skills.js';
import { DEFAULT_BESTIARY, findCreature, rankRowForLevel } from '../../enemies.js';
import { cleanCreature, combinedBestiary, creaturesToMake } from '../../templates.js';
import { combatantFromSheet, enemiesFromRows, engagements } from '../../party.js';
import { fightCondition } from '../../combat.js';
import { makeRng } from '../../rng.js';
import { fightRules, foeId } from './stored.js';
import { powerScale } from './power.js';

// The combat settings and their bounds (v1's Combat fold, ui/settings.js COMBAT_LIMITS).
export const COMBAT_DEFAULTS = Object.freeze({ turnOrder: 'timeline', speedOffset: 10, hitBase: 75, hitPerPoint: 3 });
const LIMITS = { speedOffset: [0, 50], hitBase: [5, 95], hitPerPoint: [0, 10] };

const bounded = (value, [min, max], fallback) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback);

/** The numbers a new fight begins with, from the module's settings. */
export function fightNumbers(settings = {}) {
    const s = settings ?? {};
    const xpRate = Number(s.xpRate);
    return {
        turns: s.turnOrder === 'rounds' ? 'rounds' : 'timeline',
        speedOffset: bounded(s.speedOffset, LIMITS.speedOffset, COMBAT_DEFAULTS.speedOffset),
        hit: { base: bounded(s.hitBase, LIMITS.hitBase, COMBAT_DEFAULTS.hitBase), perPoint: bounded(s.hitPerPoint, LIMITS.hitPerPoint, COMBAT_DEFAULTS.hitPerPoint) },
        ...(Number.isFinite(xpRate) && xpRate > 0 ? { xpRate } : {}),
    };
}

/** A query that may not be registered (or may refuse): its result, or `fallback`. */
function tryQuery(ctx, name, args, fallback) {
    try {
        const value = ctx.query(name, args);
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

function tryRead(ctx, domain) {
    try {
        return ctx.read(domain) ?? null;
    } catch {
        return null;
    }
}

// The party's condition kinds ("poisoned") as the fight's ("poison"), through the one table
// both parts share (v1 combat.js CONDITION_KINDS); a guard or shield never carries into a new
// fight, and a story's own condition ("exhausted") is not the fight's.
const CARRIED = new Set(['poison', 'burn', 'bleed', 'stun', 'slow', 'weaken', 'regen']);
function fightConditionOf(entry) {
    const name = fightCondition(entry?.kind ?? entry?.name ?? '');
    return name && CARRIED.has(name) ? name : null;
}
// A party condition's `stacks` are the rounds a fight left on it; a story's (stacks 1, no
// rounds) lasts the fight's usual 3. Either way no longer than the same condition from a blow in a
// fight (rules.generated.effectRounds: a stun 1, a poison 3), so a story's "stunned" costs one turn
// at most and model text never sets a longer one (rx-combat: it came in as three stunned turns).
const roundsOf = (entry, name, rules = DEFAULT_RULES) => {
    const stacks = Math.round(Number(entry?.stacks ?? entry?.rounds) || 0);
    const most = Math.round(Number(rules?.generated?.effectRounds?.[name] ?? DEFAULT_RULES.generated.effectRounds[name])) || 3;
    return Math.max(1, Math.min(most, stacks > 1 ? stacks : 3));
};

/** One row of `inventory.items` / `items.gear` as v1's item fields, its def looked up when it is only an id. */
function itemRow(row, defs) {
    const def = row?.def && typeof row.def === 'object' ? row.def : defs?.[row?.def] ?? {};
    return {
        stack: typeof row?.stack === 'string' ? row.stack : typeof row?.id === 'string' ? row.id : null,
        def: typeof row?.def === 'string' ? row.def : typeof def.id === 'string' ? def.id : null,
        name: String(row?.name ?? def.name ?? '').trim(),
        qty: Math.max(0, Math.round(Number(row?.qty ?? 1) || 0)),
        kind: row?.kind ?? def.kind ?? 'goods',
        rarity: row?.rarity ?? def.rarity ?? 'common',
        slot: row?.slot ?? (typeof row?.equipped === 'string' ? row.equipped : null) ?? def.slot ?? null,
        stats: { ...(def.stats ?? {}), ...(row?.stats ?? {}) },
        tags: [...(row?.tags ?? def.tags ?? [])],
        effect: row?.effect ?? def.effect ?? null,
        equipped: row?.equipped ?? null,
        owner: row?.owner ?? null,
    };
}

/** The stacks `owner` holds, as item rows: `inventory.items`, else the inventory domain itself (SPEC §7). */
function inventoryRows(ctx, owner, defs) {
    const listed = tryQuery(ctx, 'inventory.items', { owner }, null);
    if (Array.isArray(listed)) return listed.map(row => itemRow(row, defs));
    const inv = tryRead(ctx, 'inventory');
    return Object.values(inv?.stacks ?? {}).filter(stack => stack.owner === owner).map(stack => itemRow(stack, inv?.defs));
}

/** What a member wears, as v1 gear (equipped, slot, capped stats): `items.gear`, else the equipped stacks. */
function gearRows(ctx, actorId, defs, held) {
    // items.gear → { counted: [{ stack, name, slot, rarity, stats (capped) }], … } (MODULES §B2).
    const listed = tryQuery(ctx, 'items.gear', { actor: actorId }, null);
    const counted = Array.isArray(listed) ? listed : Array.isArray(listed?.counted) ? listed.counted : null;
    // A counted row marked `final: true` (RB-gear: capped at the wearer's level, then scaled by
    // condition and refinement) goes to the fight as it is (gearBonuses honours `final`): never
    // capped by rarity a second time. Any other row is capped as before.
    const rows = counted ? counted.map(row => ({ ...itemRow(row, defs), final: row?.final === true })) : held.filter(row => row.equipped);
    return rows.filter(row => row.name && row.slot).map(row => ({ name: row.name, qty: 1, slot: row.slot, stats: row.stats, rarity: row.rarity, tags: row.tags, equipped: true, effect: null, ...(row.final === true ? { final: true } : {}) }));
}

const usable = effect => Boolean(effect && typeof effect === 'object' && (Number(effect.heal) > 0 || Number(effect.mp) > 0 || (Array.isArray(effect.cure) && effect.cure.length) || effect.damage));

/** The consumables a member can use in the fight: { name, qty, effect, kind, stack, def } (the stack and def ids are where combat.act takes a used one from). */
function fightItems(rows) {
    return rows.filter(row => row.name && row.qty > 0 && row.kind === 'consumable' && usable(row.effect))
        .map(row => ({ name: row.name, qty: row.qty, kind: 'consumable', effect: structuredClone(row.effect), ...(row.stack ? { stack: row.stack } : {}), ...(row.def ? { def: row.def } : {}) }));
}

/**
 * The money scale of the chat's packs (F104: Story Block's `inventory.economy` → { scale }): a
 * positive number, else 1 (no such query, no packs, or nonsense). RPG Battle's own default money
 * (a foe's coin, rules.moneyByRank) is multiplied by it; what a pack writes stays as written.
 */
export function moneyScale(ctx) {
    const answer = tryQuery(ctx, 'inventory.economy', undefined, null);
    const scale = Number(answer?.scale);
    return Number.isFinite(scale) && scale > 0 ? Math.min(1e6, Math.max(1e-6, scale)) : 1;
}

/** Default money × the pack's scale: whole, at least 1 (no money stays none). */
export function scaledMoney(amount, scale = 1) {
    const money = Math.max(0, Math.round(Number(amount) || 0));
    if (!money || !(Number(scale) > 0) || Number(scale) === 1) return money;
    return Math.max(1, Math.round(money * Number(scale)));
}

const pool = (value, computed) => {
    const max = Number.isInteger(value?.max) && value.max > 0 ? value.max : computed.max;
    const cur = Number.isInteger(value?.cur) ? Math.min(max, Math.max(0, value.cur)) : Math.min(max, computed.cur);
    return { cur, max };
};

/**
 * The party as combatants, the character first: base stats and skills from the actor (skills
 * set aside stay out), gear bonuses from what they wear, HP/MP/SP as the party has them (its
 * maxima win: one writer per domain), and `party.combatNumbers` for the derived numbers when it
 * answers. Players control the character and any companion on `control: 'player'`.
 */
export function partyCombatants(ctx, { rules = DEFAULT_RULES } = {}) {
    const listed = tryQuery(ctx, 'party.actors', undefined, []);
    const actors = (Array.isArray(listed) ? listed : Object.values(listed ?? {})).filter(actor => actor && typeof actor.id === 'string');
    actors.sort((a, b) => (a.kind === 'pc' ? 0 : 1) - (b.kind === 'pc' ? 0 : 1));
    const party = tryRead(ctx, 'party');
    const library = [...DEFAULT_SKILLS, ...Object.values(party?.custom ?? {})];
    const defs = tryRead(ctx, 'inventory')?.defs ?? {};
    return actors.map(actor => {
        const own = inventoryRows(ctx, actor.id, defs);
        const shared = actor.kind === 'pc' ? inventoryRows(ctx, 'party', defs) : [];
        const gear = gearRows(ctx, actor.id, defs, own);
        const sheet = {
            name: actor.name,
            level: Math.max(1, Math.round(Number(actor.level) || 1)),
            stats: { ...actor.stats },
            hp: actor.hp, mp: actor.mp, sp: actor.sp,
            skills: (actor.skills ?? []).map(skill => ({ name: skill.name, mastery: skill.level ?? skill.mastery ?? 1, aside: skill.active === false })),
            conditions: (actor.conditions ?? []).map(entry => ({ name: fightConditionOf(entry), entry })).filter(({ name }) => name)
                .map(({ name, entry }) => ({ name, rounds: roundsOf(entry, name, rules) }))
                .filter(entry => entry.name),
        };
        const c = combatantFromSheet(sheet, {
            memberId: actor.id,
            controller: actor.kind === 'pc' || actor.control === 'player' ? 'player' : 'auto',
            gear,
            items: fightItems([...own, ...shared]),
            library,
            rules,
        });
        c.hp = pool(actor.hp, c.hp);
        c.mp = pool(actor.mp, c.mp);
        c.sp = pool(actor.sp, c.sp);
        c.gone = c.hp.cur <= 0 ? 'down' : null;
        const numbers = tryQuery(ctx, 'party.combatNumbers', { id: actor.id }, null);
        if (numbers && typeof numbers === 'object') {
            if (Number.isFinite(numbers.attack)) c.patk = numbers.attack;
            if (Number.isFinite(numbers.magic)) c.matk = numbers.magic;
            if (Number.isFinite(numbers.defence)) c.pdef = numbers.defence;
            if (Number.isFinite(numbers.mdef)) c.mdef = numbers.mdef;
            if (Number.isFinite(numbers.crit)) c.crit = numbers.crit;
            if (numbers.stats && typeof numbers.stats === 'object') c.stats = { ...c.stats, ...numbers.stats };
        }
        return c;
    });
}

// A tier is a threat budget (B-b4-11, wave C): "weak" means a standard character of any creation
// preset wins, however many foes the story wrote, whatever creature they are and at any level.
// Three numbers make a tier's foe:
//
// 1. Its level: the character's, plus the tier's offset (rules.threat.offsets × step: trivial −8,
//    weak −4, even 0, strong +4, deadly +8), plus LEVEL_SHIFT for the character's level band and
//    the headcount (the foes of that tier per party member who can fight; a lone foe is a
//    headcount of one, with no exception of its own). Below level 1 the foe is smaller by v1's rule
//    (HP and attack × perLevelBelowOne a level short, here down to GROUP_MIN_SCALE); a fraction of
//    a level above 1 makes it that much of the way from the level below, and levels past the cap
//    make it stronger at the cap (levelScale: a lone foe against a level-60 character needs that).
// 2. Its creature's power (power.js): HP and damage each × powerScale, so a level-9 troll is as
//    dangerous as a level-9 wolf.
// 3. Its count: MAX_FIELDED and MAX_STUNNERS hold the rest back.
//
// A boss keeps its tier's level for a lone foe whatever comes with it (no headcount shift), at least
// level 1 and never made smaller (no below-level-1 shrink, no power scale under 1). A foe of a
// written rank (`rank: D`, encounter.rankFoe) comes at the level the rank gives, its power scaled
// like a tier foe's. Rows with a v1 rank or no tier keep v1's power.
//
// LEVEL_SHIFT was calibrated with scripts/balance-sim.mjs (scripts/balance-calibrate.mjs searches
// it): a standard character of each preset (scripts/balance-lib.mjs) at levels 1, 5, 10, 20, 40, 60
// on auto, against the bestiary's creatures, the Ersveil pack's and made-up ones, aiming at:
// trivial won ≥ 98 %, weak ≥ 90 %, even 50–75 %, strong 20–50 %, deadly < 20 % (the search's aims:
// the cells' 10th percentile at 99 % and 93 %, their median at 62.5 % and 35 %, their 90th
// percentile at 13 %), then trivial and weak made 0.75 of a level easier for room, and each tier
// kept at least a level below the next. Even, strong and deadly field four foes a member at most,
// so their 6 and 9 columns are their 4's. Between the band levels the shift is read along a
// straight line (past 60, as at 60), and between headcounts too.
export const BAND_LEVELS = Object.freeze([1, 5, 10, 20, 40, 60]);
export const HEADCOUNTS = Object.freeze([1, 2, 3, 4, 6, 9]);
const shifts = rows => Object.freeze(rows.map(row => Object.freeze(row)));
/** Levels added to a tier's foe: LEVEL_SHIFT[tier][band][headcount], bands BAND_LEVELS, headcounts HEADCOUNTS. */
export const LEVEL_SHIFT = Object.freeze({
    trivial: shifts([
        [8.5, 6.5, 3.25, 2.25, -0.5, -4],
        [10, 6.25, 3.75, 3.25, 1, -3],
        [11.25, 6.75, 3.75, 3, 0, -2.5],
        [11.5, 5.25, 1.5, -0.75, -3.5, -7],
        [13, 1, -4, -7.75, -11.5, -15.75],
        [12.25, 2, -7.75, -10.75, -16.75, -22.75],
    ]),
    weak: shifts([
        [5.5, 3.5, 0.25, -0.75, -3.5, -7],
        [7, 3.25, 0.75, 0.25, -2, -6],
        [8.25, 3.75, 0.75, 0, -3, -5.5],
        [8.5, 2.25, -1.5, -3.75, -6.5, -10],
        [11.25, 2.25, -7, -10.75, -14.5, -18.75],
        [9.25, -1, -10.75, -13.75, -19.75, -25.75],
    ]),
    even: shifts([
        [6.25, 1.75, 0, -1.75, -1.25, -1.25],
        [10, 4, 0, -2, -1.75, -1.75],
        [14.5, 6, 1.25, -1, -0.5, -0.5],
        [23.25, 11, 2.5, -1.25, -1.25, -1.25],
        [40, 15.25, 3.5, -1.25, -1.25, -1.25],
        [76.25, 25, 6.75, -2, -2, -2],
    ]),
    strong: shifts([
        [3.25, -1, -3, -4.75, -4.75, -4.75],
        [7.75, 1, -3, -5, -5, -5],
        [13, 3.75, -1.75, -4, -4, -4],
        [21.25, 8.75, -0.25, -3.5, -3.5, -3.5],
        [40, 13.75, 2, -4, -4, -4],
        [84, 28.75, 4, -3, -3, -3],
    ]),
    deadly: shifts([
        [3.25, -2.25, -6, -7.25, -7.25, -7.25],
        [11, 0.75, -3.5, -6, -6, -6],
        [18.25, 6, -1, -4, -4, -4],
        [30.75, 14.75, 5, 0.25, 0.25, 0.25],
        [74.5, 34.5, 17, 12, 12, 12],
        [208.25, 73, 28, 20, 20, 20],
    ]),
});
export const GROUP_MIN_SCALE = 0.15;
// The most foes one offer fields; more hang back (an offer row holds 9 at most, rows add up).
export const MAX_HEADCOUNT = 9;
// The most foes of these tiers one member meets (trim the count): past four, a group of even,
// strong or deadly foes small enough for the budget is one that a sweep across all foes wins and a
// single blade loses (the fighter against nine strong wolves 100 %, the skirmisher 5 %).
export const MAX_FIELDED = Object.freeze({ even: 4, strong: 4, deadly: 4 });
// The most foes that can stun a fight of a "you win" tier fields per member (trim the count): even
// with the stun rule (a second stun in a row only dazes, combat.js), three or four swift stunners
// keep a lone character from fighting back on half its turns. Other tiers field them all.
export const MAX_STUNNERS = Object.freeze({ trivial: 2, weak: 3 });

// Linear between the points of `xs` (held past both ends).
function along(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i += 1) {
        if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    }
    return ys.at(-1);
}

/**
 * The levels a tier's foe moves (LEVEL_SHIFT, or `shifts`: a table of the same shape, which the
 * calibration passes) for a character of `pcLevel` and `headcount` foes of the tier a member; 0 for
 * no tier.
 */
export function levelShift(tier, pcLevel, headcount = 1, shifts = LEVEL_SHIFT) {
    const table = (shifts ?? LEVEL_SHIFT)[tier];
    if (!table) return 0;
    const count = Math.min(MAX_HEADCOUNT, Math.max(1, Math.round(Number(headcount) || 1)));
    const level = Math.max(1, Number(pcLevel) || 1);
    const byBand = table.map(row => along(HEADCOUNTS, row, count));
    return Math.round(along(BAND_LEVELS, byBand, level) * 100) / 100;
}

/**
 * How strong a foe whose level is `raw` is beside one of whole level `level`: the rank table's HP ×
 * attack at `raw` (linear between whole levels, and past the last rank along its slope) over that at
 * `level`, square-rooted (it scales HP and damage each). Below 1 for a fraction of a level under
 * `level`; above 1 for levels past the cap (the foe stays at the cap, that much stronger); 1 at a
 * whole level.
 */
export function levelScale(raw, level, rules = DEFAULT_RULES) {
    if (!(raw >= 1) || Math.abs(raw - level) < 1e-9) return 1;
    const at = x => {
        const lo = rankRowForLevel(Math.floor(x), rules);
        const hi = rankRowForLevel(Math.floor(x) + 1, rules);
        const t = x - Math.floor(x);
        return (lo.hp + (hi.hp - lo.hp) * t) * (lo.attack + (hi.attack - lo.attack) * t);
    };
    return Math.sqrt(at(raw) / at(level));
}

/**
 * A tier row's power for a character of `pcLevel` and `headcount` foes of its tier a member:
 * { level, scale?, xpLevel?, levelScale? }. `scale` and `xpLevel` are v1's below-level-1 rule
 * (story.threatPower); `levelScale` a fraction of a level above 1, or the levels past the cap
 * (levelScale). A boss (`boss: true`) stays at its tier's level for a lone foe whatever comes with
 * it, a whole level, at least 1, and is never made smaller (no below-level-1 shrink). Null for a
 * row with no tier.
 */
export function tierPower(tier, pcLevel, headcount = 1, { boss = false, rules = DEFAULT_RULES, shifts = LEVEL_SHIFT } = {}) {
    const t = { ...DEFAULT_RULES.threat, ...(rules?.threat ?? {}) };
    const offset = Number(t.offsets?.[tier]);
    if (!Number.isFinite(offset)) return null;
    const base = Math.max(1, Math.round(Number(pcLevel) || 1));
    const top = maxLevel(rules);
    const raw = base + offset * threatStep(rules) + levelShift(tier, base, boss ? 1 : headcount, shifts);
    if (boss) {
        const whole = Math.max(1, Math.round(raw));
        const out = { level: Math.min(top, whole) };
        if (whole > top) out.levelScale = Math.round(levelScale(whole, top, rules) * 1000) / 1000;
        return out;
    }
    const level = Math.min(top, Math.max(1, Math.ceil(raw - 1e-9)));
    const out = { level };
    if (raw < 1) {
        const per = Number(t.perLevelBelowOne) > 0 ? Number(t.perLevelBelowOne) : DEFAULT_RULES.threat.perLevelBelowOne;
        out.scale = Math.round(Math.max(GROUP_MIN_SCALE, per ** (1 - raw)) * 1000) / 1000;
        out.xpLevel = Math.round(raw * 100) / 100;
    } else {
        const scale = Math.round(levelScale(raw, level, rules) * 1000) / 1000;
        if (scale !== 1) out.levelScale = scale;
    }
    return out;
}

/**
 * The offer's rows with no more foes in all than it fields: MAX_HEADCOUNT, or the least
 * MAX_FIELDED of its tiers for each member who can fight (the last rows give way first).
 */
function fielded(rows, partySize = 1) {
    let room = Math.min(MAX_HEADCOUNT, ...rows.map(row => (MAX_FIELDED[row.threat] ?? MAX_HEADCOUNT) * partySize));
    return rows.map(row => {
        const count = Math.max(0, Math.min(Math.max(1, Math.round(Number(row.count) || 1)), room));
        room -= count;
        return { ...row, count };
    }).filter(row => row.count > 0);
}

const stuns = enemy => (enemy.skills ?? []).some(skill => Number(skill?.effect?.stun) > 0);

/** The foes with no more stunners than the tier allows each member (MAX_STUNNERS): the last ones hang back. */
function lessStunners(enemies, partySize = 1) {
    const kept = [];
    const used = {};
    for (const enemy of enemies) {
        const most = MAX_STUNNERS[enemy.threat] === undefined ? undefined : MAX_STUNNERS[enemy.threat] * partySize;
        if (most !== undefined && stuns(enemy)) {
            used[enemy.threat] = (used[enemy.threat] ?? 0) + 1;
            if (used[enemy.threat] > most) continue;
        }
        kept.push(enemy);
    }
    return kept;
}

/**
 * The rows of an offer with their power settled (v1 rankedRows): a tier word made a level from
 * the character's (tierPower); a row without one keeps a creature's own power, else the fair rank.
 * `makeAt` is the level a creature made up for the row is made at.
 */
export function offerRows(offer, { pcLevel = 1, bestiary, rules = DEFAULT_RULES, partySize = 1, shifts = LEVEL_SHIFT } = {}) {
    const rows = (offer?.foes ?? []).map(foe => ({
        name: foe.name, count: foe.count, rank: null, role: null, boss: Boolean(foe.boss),
        ...(foe.tier ? { threat: foe.tier } : {}),
        ...(foe.wave ? { wave: foe.wave } : {}),
        // A foe of a written rank comes at the rank's level (encounter.rankFoe), its tier for the card.
        ...(Number.isInteger(foe.level) && foe.level >= 1 && foe.rank ? { level: foe.level, ladder: foe.rank } : {}),
    }));
    const fair = suggestRank(pcLevel, rules);
    const members = Math.max(1, Math.round(Number(partySize) || 1));
    const field = fielded(rows, members);
    // Each tier is a budget of its own (B4r2-3): a row moves by the headcount of its tier's rows
    // only, so trivial fodder beside a deadly foe never makes the deadly one small. The budget is
    // the party's: foes per member who can fight (two against four is two each). A boss counts in
    // its tier's headcount (so the foes with it are smaller) but keeps its own level.
    const counts = {};
    for (const row of field) if (row.threat) counts[row.threat] = (counts[row.threat] ?? 0) + row.count;
    const headcount = row => Math.ceil((counts[row.threat] ?? row.count) / members);
    return field.map(row => {
        if (!row.threat || row.rank || Number(row.level) >= 1) return row;
        const power = tierPower(row.threat, pcLevel, headcount(row), { boss: row.boss, rules, shifts });
        return power ? { ...row, ...power } : row;
    }).map(row => {
        const level = Number(row.level) >= 1 ? Math.round(Number(row.level)) : null;
        const rank = level ? null : row.rank || (findCreature(bestiary, row.name) ? null : fair);
        return { ...row, level, rank, makeAt: level ?? rules.ranks[rank ?? fair]?.level ?? pcLevel };
    });
}

/**
 * The level a tier foe's XP counts from (combat.foeXpWorth): the tier's own, the character's plus
 * its offset (rules.threat.offsets × step), whatever LEVEL_SHIFT and the power scale made of its
 * numbers. A weak foe pays a weak foe's XP (half an even one's), a deadly one four times: v1's
 * meaning of the words, so a lone foe at level 60 + 76 is still an even foe's XP. Null for no tier.
 */
export function tierXpLevel(tier, pcLevel, rules = DEFAULT_RULES) {
    const t = { ...DEFAULT_RULES.threat, ...(rules?.threat ?? {}) };
    const offset = Number(t.offsets?.[tier]);
    if (!Number.isFinite(offset)) return null;
    return Math.max(1, Math.round(Number(pcLevel) || 1)) + offset * threatStep(rules);
}

/**
 * A projected foe of a tier row made as dangerous as its tier means: HP and attack × its creature's
 * powerScale (at least 1 for a boss) × the row's `levelScale`. Other foes as they are.
 */
export function normalizedFoe(enemy, row, entry, rules = DEFAULT_RULES) {
    if (!row?.threat) return enemy;
    const power = powerScale(entry, rules);
    const factor = (row.boss ? Math.max(1, power) : power) * (Number(row.levelScale) > 0 ? Number(row.levelScale) : 1);
    if (factor === 1) return enemy;
    const hp = Math.max(1, Math.round(enemy.hp.max * factor));
    return { ...enemy, hp: { cur: hp, max: hp }, patk: Math.max(1, Math.round(enemy.patk * factor)), matk: Math.max(1, Math.round(enemy.matk * factor)) };
}

/**
 * Everything a new fight needs: { setup, made } where `made` are the bestiary entries made up for
 * names nobody has written up (cleaned, to keep in the chat's bestiary). `chatBestiary` is the
 * chat's own creatures (v1 list, oldest first). Throws an Error with a plain message when there is
 * nobody to fight with or nobody to fight.
 */
export function buildSetup({ id, seed, offer, party, chatBestiary = [], numbers, money = 1, shifts = LEVEL_SHIFT }) {
    const rules = fightRules(numbers);
    if (!party.length) throw new Error('Make your character first: there is nobody to fight.');
    if (!party.some(c => c.hp.cur > 0)) throw new Error('Nobody in the party is standing to fight.');
    const pcLevel = party[0].level;
    const lookup = combinedBestiary(chatBestiary, DEFAULT_BESTIARY);
    const partySize = party.filter(c => c.hp.cur > 0).length;
    const ranked = offerRows(offer, { pcLevel, bestiary: lookup, rules, partySize, shifts });
    const made = creaturesToMake(ranked.map(row => ({ ...row, level: row.makeAt })), { chatBestiary, defaults: DEFAULT_BESTIARY, rules, seed: String(seed) })
        .map(entry => cleanCreature(entry, rules)).filter(Boolean);
    const bestiary = combinedBestiary([...chatBestiary, ...made], DEFAULT_BESTIARY);
    const madeNames = new Set(made.map(entry => entry.name.toLowerCase()));
    // Row by row from one stream (the same draws as all rows at once), each foe made as dangerous as
    // its tier means (normalizedFoe: its creature's power, a fraction of a level or levels past the cap).
    const rng = makeRng(`${seed}:enemies`);
    const projected = ranked.flatMap(row => enemiesFromRows([row], { bestiary, library: DEFAULT_SKILLS, rules, rng })
        .map(enemy => normalizedFoe(enemy, row, findCreature(bestiary, row.name), rules))
        // A tier foe's XP counts from its tier (tierXpLevel); a ranked foe's from its level.
        .map(enemy => (row.threat && !row.ladder ? { ...enemy, xpLevel: tierXpLevel(row.threat, pcLevel, rules) } : enemy)));
    const all = lessStunners(projected, partySize)
        .map((enemy, index) => ({
            ...enemy,
            id: foeId(index + 1),
            // A creature made up for this very fight wears a "new" tag on its card.
            ...(enemy.generated && madeNames.has(String(findCreature(bestiary, enemy.name)?.name ?? '').toLowerCase()) ? { fresh: true } : {}),
        }));
    if (!all.length) throw new Error('The offer names no foe to fight.');
    const { enemies, waves } = engagements(all);
    const setup = {
        id, seed, party, enemies,
        ...(waves.length ? { waves } : {}),
        stakes: offer.stakes === 'death' ? 'death' : 'normal',
        turns: numbers.turns,
        speedOffset: numbers.speedOffset,
        hit: { ...numbers.hit },
        // Nobody is stunned two turns in a row: a second stun dazes (combat.js DAZE_POINTS).
        stunRule: 'daze',
        ...(numbers.xpRate ? { xpRate: numbers.xpRate } : {}),
        ...(offer.place ? { place: offer.place } : {}),
        // The pack's money scale as the fight began (moneyScale, F104): its loot coin is paid by it.
        ...(Number(money) > 0 && Number(money) !== 1 ? { moneyScale: Number(money) } : {}),
    };
    // The foes the offer named that hang back (past MAX_HEADCOUNT, or stunners past MAX_STUNNERS).
    const named = (offer?.foes ?? []).reduce((sum, foe) => sum + Math.max(1, Math.round(Number(foe.count) || 1)), 0);
    return { setup, made, rules, heldBack: Math.max(0, named - all.length) };
}
