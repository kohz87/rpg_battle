// A fight's setup from the State: the party from `party.actors` (with their gear and the
// consumables they carry), the foes from an offer, projected with v1's enemy rules against the
// chat's bestiary. The result is a v1 startFight setup (combat.js), stored in the session and
// replayed from there. Everything comes in through ctx queries and reads; nothing is cached.
//
// v1 functions do the work: combatantFromSheet (party.js) for each member, resolveThreats
// (story.js) for the tier words, creaturesToMake (templates.js) for names nobody has written up,
// enemiesFromRows and engagements (party.js) for the foes and the waves after the first. Pure
// apart from ctx.

import { DEFAULT_RULES, suggestRank, threatStep } from '../../rules.js';
import { maxLevel } from '../../terms.js';
import { DEFAULT_SKILLS } from '../../skills.js';
import { DEFAULT_BESTIARY, findCreature } from '../../enemies.js';
import { cleanCreature, combinedBestiary, creaturesToMake } from '../../templates.js';
import { combatantFromSheet, enemiesFromRows, engagements } from '../../party.js';
import { fightCondition } from '../../combat.js';
import { resolveThreats } from '../../story.js';
import { makeRng } from '../../rng.js';
import { fightRules, foeId } from './stored.js';

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
// rounds) lasts the fight's usual 3.
const roundsOf = entry => {
    const stacks = Math.round(Number(entry?.stacks ?? entry?.rounds) || 0);
    return stacks > 1 ? stacks : 3;
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
            conditions: (actor.conditions ?? []).map(entry => ({ name: fightConditionOf(entry), rounds: roundsOf(entry) }))
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

// A tier is a threat budget for the whole offer (B-b4-11), not for each foe: "weak" means a fresh
// character wins, however many foes the story wrote. Each tier is a budget of its own (B4r2-3).
// A lone foe keeps v1's level for its tier (story.threatPower: v1 parity is kept for lone foes
// only), and so does a boss. In a group each foe's level moves by GROUP_SHIFT[tier][headcount − 1]
// levels, the headcount being the foes of that tier per party member who can fight; fractions of
// a level, and levels below 1, make a smaller foe as v1 does below level 1 (HP and attack ×
// perLevelBelowOne per level short, here down to GROUP_MIN_SCALE). Counted in levels,
// the same budget holds at any level. The shifts were calibrated with scripts/balance-sim.mjs for a
// fresh level-1 character of every creation preset on auto, against the bestiary's foes and a
// made-up one, aiming at: trivial won ≥ 98 %, weak ≥ 90 %, even 50–75 %, strong 20–50 %, deadly
// < 20 % (even and strong as the presets' middle: the presets themselves differ by more than those
// bands). Two even foes are a little stronger than two of v1's.
export const GROUP_SHIFT = Object.freeze({
    trivial: Object.freeze([0, 0, -2, -4, -5, -6, -7, -8, -9]),
    weak: Object.freeze([0, 0, -4, -5, -6, -7, -8, -9, -10]),
    even: Object.freeze([0, 2, 0, -1.5, -3, -4.75, -5.75, -7, -8.25]),
    strong: Object.freeze([0, -1, -3, -5, -6.25, -8, -9.25, -10.5, -11.5]),
    deadly: Object.freeze([0, -2.25, -5.5, -7.25, -8.25, -8.75, -9, -9.75, -10.5]),
});
// The most foes a tier fields (trim the count): past four, a group of even, strong or deadly foes
// small enough for the budget is one that a sweep across all foes wins and a single blade loses
// (the fighter against nine strong wolves 100 %, the skirmisher 5 %), so the rest hang back.
export const GROUP_MIN_SCALE = 0.15;
// The most foes one offer fields; more hang back (an offer row holds 9 at most, rows add up).
export const MAX_HEADCOUNT = 9;
export const MAX_FIELDED = Object.freeze({ even: 4, strong: 4, deadly: 4 });
// The most foes that can stun a fight of a "you win" tier fields (trim the count): stunned on every
// turn, a lone character cannot fight back however small the foes are (three or four swift Cellar
// Rat Swarms with Pounce, B-b4-11). Other tiers field them all.
export const MAX_STUNNERS = Object.freeze({ trivial: 2, weak: 3 });

/** How many levels a tier's foe moves in a group of `headcount` (GROUP_SHIFT; 0 alone). */
export function headcountShift(tier, headcount) {
    const table = GROUP_SHIFT[tier];
    if (!table || headcount < 2) return 0;
    return table[Math.min(MAX_HEADCOUNT, headcount) - 1];
}

/**
 * A tier row's level for a group of `headcount` foes (headcountShift), from the character's level:
 * at least 1, and below 1 a smaller foe (`scale`, `xpLevel`) by v1's rule; fractions of a level as
 * a scale too (level 3.5 is a level-4 foe × perLevelBelowOne^0.5). A lone foe, a row with a rank of
 * its own or with no tier is left as resolveThreats made it.
 */
export function groupPower(row, headcount, pcLevel, rules = DEFAULT_RULES) {
    if (!row?.threat || row.rank || headcount < 2) return row;
    const shift = headcountShift(row.threat, headcount);
    if (!shift) return row;
    const t = { ...DEFAULT_RULES.threat, ...(rules?.threat ?? {}) };
    const offset = Number(t.offsets?.[row.threat]);
    if (!Number.isFinite(offset)) return row;
    const base = Math.max(1, Math.round(Number(pcLevel) || 1));
    const raw = base + offset * threatStep(rules) + shift;
    const level = Math.min(maxLevel(rules), Math.max(1, Math.ceil(raw - 1e-9)));
    const { scale: _scale, xpLevel: _xpLevel, ...rest } = row;
    const per = Number(t.perLevelBelowOne) > 0 ? Number(t.perLevelBelowOne) : DEFAULT_RULES.threat.perLevelBelowOne;
    const scale = Math.max(GROUP_MIN_SCALE, per ** (level - raw));
    const out = { ...rest, level };
    if (scale < 0.9995) out.scale = Math.round(scale * 1000) / 1000;
    if (raw < 1) out.xpLevel = Math.round(raw * 100) / 100;
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
 * the character's; a row without one keeps a creature's own power, else the fair rank.
 * `makeAt` is the level a creature made up for the row is made at.
 */
export function offerRows(offer, { pcLevel = 1, bestiary, rules = DEFAULT_RULES, partySize = 1 } = {}) {
    const rows = (offer?.foes ?? []).map(foe => ({
        name: foe.name, count: foe.count, rank: null, role: null, boss: Boolean(foe.boss),
        ...(foe.tier ? { threat: foe.tier } : {}),
        ...(foe.wave ? { wave: foe.wave } : {}),
    }));
    const fair = suggestRank(pcLevel, rules);
    const members = Math.max(1, Math.round(Number(partySize) || 1));
    const field = fielded(rows, members);
    // Each tier is a budget of its own (B4r2-3): a row moves by the headcount of its tier's rows
    // only, so trivial fodder beside a deadly foe never makes the deadly one small. The budget is
    // the party's: foes per member who can fight (two against four is two each). A boss keeps its
    // tier's level (it still counts in its tier's headcount, so the foes with it are smaller).
    const counts = {};
    for (const row of field) if (row.threat) counts[row.threat] = (counts[row.threat] ?? 0) + row.count;
    const headcount = row => Math.ceil((counts[row.threat] ?? row.count) / members);
    return resolveThreats(field, pcLevel, rules).map(row => (row.boss ? row : groupPower(row, headcount(row), pcLevel, rules))).map(row => {
        const level = Number(row.level) >= 1 ? Math.round(Number(row.level)) : null;
        const rank = level ? null : row.rank || (findCreature(bestiary, row.name) ? null : fair);
        return { ...row, level, rank, makeAt: level ?? rules.ranks[rank ?? fair]?.level ?? pcLevel };
    });
}

/**
 * Everything a new fight needs: { setup, made } where `made` are the bestiary entries made up for
 * names nobody has written up (cleaned, to keep in the chat's bestiary). `chatBestiary` is the
 * chat's own creatures (v1 list, oldest first). Throws an Error with a plain message when there is
 * nobody to fight with or nobody to fight.
 */
export function buildSetup({ id, seed, offer, party, chatBestiary = [], numbers }) {
    const rules = fightRules(numbers);
    if (!party.length) throw new Error('Make your character first: there is nobody to fight.');
    if (!party.some(c => c.hp.cur > 0)) throw new Error('Nobody in the party is standing to fight.');
    const pcLevel = party[0].level;
    const lookup = combinedBestiary(chatBestiary, DEFAULT_BESTIARY);
    const partySize = party.filter(c => c.hp.cur > 0).length;
    const ranked = offerRows(offer, { pcLevel, bestiary: lookup, rules, partySize });
    const made = creaturesToMake(ranked.map(row => ({ ...row, level: row.makeAt })), { chatBestiary, defaults: DEFAULT_BESTIARY, rules, seed: String(seed) })
        .map(entry => cleanCreature(entry, rules)).filter(Boolean);
    const bestiary = combinedBestiary([...chatBestiary, ...made], DEFAULT_BESTIARY);
    const madeNames = new Set(made.map(entry => entry.name.toLowerCase()));
    const projected = enemiesFromRows(ranked, { bestiary, library: DEFAULT_SKILLS, rules, rng: makeRng(`${seed}:enemies`) });
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
        ...(numbers.xpRate ? { xpRate: numbers.xpRate } : {}),
        ...(offer.place ? { place: offer.place } : {}),
    };
    // The foes the offer named that hang back (past MAX_HEADCOUNT, or stunners past MAX_STUNNERS).
    const named = (offer?.foes ?? []).reduce((sum, foe) => sum + Math.max(1, Math.round(Number(foe.count) || 1)), 0);
    return { setup, made, rules, heldBack: Math.max(0, named - all.length) };
}
