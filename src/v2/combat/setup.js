// A fight's setup from the State: the party from `party.actors` (with their gear and the
// consumables they carry), the foes from an offer, projected with v1's enemy rules against the
// chat's bestiary. The result is a v1 startFight setup (combat.js), stored in the session and
// replayed from there. Everything comes in through ctx queries and reads; nothing is cached.
//
// v1 functions do the work: combatantFromSheet (party.js) for each member, resolveThreats
// (story.js) for the tier words, creaturesToMake (templates.js) for names nobody has written up,
// enemiesFromRows and engagements (party.js) for the foes and the waves after the first. Pure
// apart from ctx.

import { DEFAULT_RULES, suggestRank } from '../../rules.js';
import { DEFAULT_SKILLS } from '../../skills.js';
import { DEFAULT_BESTIARY, findCreature } from '../../enemies.js';
import { cleanCreature, combinedBestiary, creaturesToMake } from '../../templates.js';
import { combatantFromSheet, enemiesFromRows, engagements } from '../../party.js';
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

// v2 condition kinds ("poisoned") as the fight's ("poison"); fight-only ones are left out.
const CONDITIONS = { poison: 'poison', poisoned: 'poison', burn: 'burn', burning: 'burn', burned: 'burn', bleed: 'bleed', bleeding: 'bleed', stun: 'stun', stunned: 'stun', slow: 'slow', slowed: 'slow', weaken: 'weaken', weakened: 'weaken', regen: 'regen', regenerating: 'regen' };

/** One row of `inventory.items` / `items.gear` as v1's item fields, its def looked up when it is only an id. */
function itemRow(row, defs) {
    const def = row?.def && typeof row.def === 'object' ? row.def : defs?.[row?.def] ?? {};
    return {
        stack: typeof row?.stack === 'string' ? row.stack : typeof row?.id === 'string' ? row.id : null,
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
    const listed = tryQuery(ctx, 'items.gear', { actor: actorId }, null);
    const rows = Array.isArray(listed) ? listed.map(row => itemRow(row, defs)) : held.filter(row => row.equipped);
    return rows.filter(row => row.name && row.slot).map(row => ({ name: row.name, qty: 1, slot: row.slot, stats: row.stats, rarity: row.rarity, tags: row.tags, equipped: true, effect: null }));
}

const usable = effect => Boolean(effect && typeof effect === 'object' && (Number(effect.heal) > 0 || Number(effect.mp) > 0 || (Array.isArray(effect.cure) && effect.cure.length) || effect.damage));

/** The consumables a member can use in the fight: { name, qty, effect, kind, stack }. */
function fightItems(rows) {
    return rows.filter(row => row.name && row.qty > 0 && row.kind === 'consumable' && usable(row.effect))
        .map(row => ({ name: row.name, qty: row.qty, kind: 'consumable', effect: structuredClone(row.effect), ...(row.stack ? { stack: row.stack } : {}) }));
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
            conditions: (actor.conditions ?? []).map(entry => ({ name: CONDITIONS[String(entry?.kind ?? entry?.name ?? '').toLowerCase()] ?? null, rounds: Math.max(1, Math.round(Number(entry?.rounds) || 3)) }))
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

/**
 * The rows of an offer with their power settled (v1 rankedRows): a tier word made a level from
 * the character's; a row without one keeps a creature's own power, else the fair rank.
 * `makeAt` is the level a creature made up for the row is made at.
 */
export function offerRows(offer, { pcLevel = 1, bestiary, rules = DEFAULT_RULES } = {}) {
    const rows = (offer?.foes ?? []).map(foe => ({
        name: foe.name, count: foe.count, rank: null, role: null, boss: Boolean(foe.boss),
        ...(foe.tier ? { threat: foe.tier } : {}),
        ...(foe.wave ? { wave: foe.wave } : {}),
    }));
    const fair = suggestRank(pcLevel, rules);
    return resolveThreats(rows, pcLevel, rules).map(row => {
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
    const ranked = offerRows(offer, { pcLevel, bestiary: lookup, rules });
    const made = creaturesToMake(ranked.map(row => ({ ...row, level: row.makeAt })), { chatBestiary, defaults: DEFAULT_BESTIARY, rules, seed: String(seed) })
        .map(entry => cleanCreature(entry, rules)).filter(Boolean);
    const bestiary = combinedBestiary([...chatBestiary, ...made], DEFAULT_BESTIARY);
    const madeNames = new Set(made.map(entry => entry.name.toLowerCase()));
    const all = enemiesFromRows(ranked, { bestiary, library: DEFAULT_SKILLS, rules, rng: makeRng(`${seed}:enemies`) })
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
    return { setup, made, rules };
}
