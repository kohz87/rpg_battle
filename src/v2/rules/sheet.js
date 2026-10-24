// RPG Battle v2, the sheet and party projections (contract §3 SheetView, PartyView). A sheet is a **projection**: the
// party part's member (name, pools, stats, level, XP, points, conditions) with the class, the three skills and
// their masteries from the progression (derive.js) and the gear from Story Block's equipped records. Nothing is
// stored here; unknown references give null and lists [] (contract §3 "Common failures"). Pure over the
// queries it is given.

import { deriveActor, choicesOf, skillViews } from '../progress/derive.js';
import { isObject } from './ids.js';

export const SLOTS = Object.freeze(['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2']);
const CONDITIONS = new Set(['poison', 'burn', 'bleed', 'stun', 'daze', 'slow', 'weaken', 'shield', 'regen', 'guard', 'injury', 'stat-shift']);
export const ACTIVE_LIMIT = 3;

const ask = (query, name, args) => {
    try {
        return typeof query === 'function' ? query(name, args) : null;
    } catch {
        return null;
    }
};
const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
const pool = entry => ({ cur: count(entry?.cur), max: count(entry?.max) });

/** The contract's `life`: dead (a `dead` condition), gravely-injured (an `injury` one), downed (0 HP), else alive. */
export function lifeOf(member) {
    const kinds = (member.conditions ?? []).map(entry => entry?.kind ?? entry?.name);
    if (kinds.includes('dead')) return 'dead';
    if (kinds.includes('injury')) return 'gravely-injured';
    return count(member.hp?.cur) <= 0 ? 'downed' : 'alive';
}

/** Who wears what: { slot: stack id } of the eight slots, from `inventory.items` (null for a slot nothing fills). */
export function gearOf(query, actor) {
    const out = Object.fromEntries(SLOTS.map(slot => [slot, null]));
    const items = ask(query, 'inventory.items', { owner: actor });
    for (const item of Array.isArray(items) ? items : []) if (typeof item?.equipped === 'string' && SLOTS.includes(item.equipped)) out[item.equipped] = item.stack;
    return out;
}

/**
 * A SheetView for a party member (`member` = party.actor's answer), or null without a basic class yet.
 * `progress`: the progress slice; `gear`: gearOf's answer.
 */
export function sheetView(ix, progress, member, gear) {
    const derived = deriveActor(ix, choicesOf(progress, member.id));
    if (derived.class === null) return null;
    const level = Math.min(Math.max(count(member.level), ix.constants.startLevel), ix.constants.levelCap);
    const skills = skillViews(ix, derived, progress, member.id);
    return {
        id: member.id, name: member.name, role: member.role ?? '', portrait: member.portrait ?? null, background: member.background ?? '',
        origin: isObject(member.origin) ? { race: member.origin.race ?? null, talents: member.origin.talents ?? [] } : { race: null, talents: [] },
        kind: member.kind === 'pc' ? 'pc' : 'companion', npcId: typeof member.npcId === 'string' ? member.npcId : null,
        level, xp: level >= ix.constants.levelCap ? 0 : count(member.xp), xpToNext: level >= ix.constants.levelCap ? null : ix.constants.xpPerLevel,
        stats: { ...member.stats }, unspent: Number.isSafeInteger(member.points) ? member.points : 0,
        hp: pool(member.hp), mp: pool(member.mp), sp: pool(member.sp), life: lifeOf(member),
        conditions: (member.conditions ?? []).filter(entry => CONDITIONS.has(entry?.kind)).map(entry => ({
            kind: entry.kind, stacks: count(entry.stacks), ...(Number.isSafeInteger(entry.rounds) ? { rounds: entry.rounds } : {}), ...(Number.isSafeInteger(entry.at) ? { at: entry.at } : {}),
        })),
        class: derived.class, tier: derived.tier, skills, gear, control: member.control === 'auto' ? 'auto' : 'player',
    };
}

/** A temporary unit (a summon or pet of a fight) as a SheetView: no class of the pack's, no gear, no points. */
export function unitView(unit) {
    return {
        id: unit.id, name: unit.name, role: unit.role ?? unit.kind, portrait: null, background: '', origin: { race: null, talents: [] },
        kind: unit.kind, npcId: null, level: unit.level, xp: 0, xpToNext: null, stats: { ...(unit.stats ?? {}) }, unspent: 0,
        hp: pool(unit.hp), mp: pool(unit.mp), sp: pool(unit.sp), life: count(unit.hp?.cur) <= 0 ? 'downed' : 'alive', conditions: [],
        class: unit.template, tier: 0, skills: [], gear: Object.fromEntries(SLOTS.map(slot => [slot, null])), control: 'auto',
    };
}

/** The ids of the active members: the stored roster kept to members that exist, the PC first, three at most; none stored: the first three. */
export function activeIds(roster, members, pc) {
    const alive = new Set(members.map(member => member.id));
    const stored = Array.isArray(roster?.active) ? roster.active.filter((id, i, all) => alive.has(id) && all.indexOf(id) === i) : null;
    const chosen = stored ?? members.map(member => member.id);
    const list = pc && alive.has(pc) ? [pc, ...chosen.filter(id => id !== pc)] : chosen;
    return list.slice(0, ACTIVE_LIMIT);
}

/** The PartyView (contract §3): { pc, active, reserve, temporary, activeLimit: 3 }, or null without a pinned ruleset. */
export function partyView(ix, state, query) {
    if (!ix) return null;
    const progress = state?.domains?.progress ?? {};
    const list = ask(query, 'party.actors', {});
    const members = Array.isArray(list) ? list.filter(member => isObject(member) && typeof member.id === 'string') : [];
    const pcMember = members.find(member => member.kind === 'pc');
    const sheets = new Map();
    for (const member of members) {
        const sheet = sheetView(ix, progress, member, gearOf(query, member.id));
        if (sheet) sheets.set(member.id, sheet);
    }
    const durable = members.filter(member => sheets.has(member.id));
    const active = activeIds(progress.roster, durable, pcMember?.id ?? null);
    const temporary = Object.values(progress.temporary ?? {}).filter(unit => unit.ended === null).map(unit => unitView(unit));
    return {
        pc: pcMember?.id ?? null,
        active: active.map(id => sheets.get(id)),
        reserve: durable.map(member => member.id).filter(id => !active.includes(id)).map(id => sheets.get(id)),
        temporary, activeLimit: ACTIVE_LIMIT,
    };
}

