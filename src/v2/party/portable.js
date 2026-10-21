// Your character as a portable file (MODULES §F66): `party.export` writes it, creation's import
// reads it into a new chat instead of the wizard. The file carries what the character is and
// has: name, role, background and origin, level, XP, unspent points, base stats, skills (with
// the story-taught ones as templates, built again by v1 skillFromTemplate where it lands),
// the gear and goods of your character and the party's bag (item defs with how many and
// whether they were worn) and the purse, as whole numbers of the chat's one currency. HP, MP
// and SP are not carried: the imported character starts rested, with no conditions.
//
// Reading a file checks it by this chat's Character rules, as v1 partyfile.cleanParty does for
// its party files but refusing instead of clamping: the level cap, the stat cap, a stat total
// no more than a character of that level could have bought (start points, the points each level
// gives, and the race's and talents' bonuses this chat knows), XP below the next level, skills
// that exist (the library, or a template in the file), at most the skills in use the rules
// allow. Pure.

import { STATS, statCap, xpToNext } from '../../rules.js';
import { DEFAULT_SKILLS, ELEMENTS, findSkill, skillFromTemplate } from '../../skills.js';
import { recompute } from '../../sheet.js';
import { maxLevel } from '../../terms.js';
import { cleanName, cleanRole, nameKey } from './util.js';
import { capEffect, capStats, storyRarity } from '../limits.js';

export const CHARACTER_FILE_VERSION = 1;
const MAX_SKILLS = 40;
const MAX_ITEMS = 200;
const MAX_QTY = 9999;
// What a file may bring (B-b3-15): at most MAX_THINGS things in all (each kind's count cut, in the
// file's order, once the total is reached), and a purse of at most PURSE_PER_LEVEL × level² in the
// chat's one currency (a level-1 character brings 250 at most, level 10 25,000): about what a
// character of that level earns in fights and quests. Anything more is left behind, and said so.
export const MAX_THINGS = 300;
export const PURSE_PER_LEVEL = 250;
export const purseCap = level => PURSE_PER_LEVEL * level * level;
const ITEM_KINDS = ['goods', 'material', 'consumable', 'equipment', 'quest'];
const MAX_BACKGROUND = 2000;
const SKILL_TYPES = ['physical', 'magic', 'heal', 'buff', 'debuff'];

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isWhole = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const refuse = (code, message) => ({ ok: false, code, message });

/** A def as the file keeps it: the fields a grant needs, never its price (the new chat prices it). */
function portableDef(def) {
    const out = { name: def.name, kind: def.kind, rarity: def.rarity, stack: def.stack !== false, slot: def.slot ?? null };
    if (typeof def.id === 'string') out.id = def.id;
    if (isRecord(def.stats) && Object.keys(def.stats).length) out.stats = structuredClone(def.stats);
    if (isRecord(def.effect) && Object.keys(def.effect).length) out.effect = structuredClone(def.effect);
    if (Array.isArray(def.tags) && def.tags.length) out.tags = [...def.tags];
    if (typeof def.note === 'string' && def.note) out.note = def.note;
    return out;
}

/**
 * The file for your character: { rpgBattleCharacter: 1, name, role, background?, origin?, level,
 * xp, points, stats, skills: [{ name, level, uses, active }], custom: [{ name, type, stat,
 * target, element?, note? }], items: [{ def, qty, equipped }], purse, currency }. `inventory` is
 * Story Block's inventory slice (null without one); `currency` the chat's currency name.
 */
export function exportCharacter(party, inventory, { currency = '' } = {}) {
    const pc = party?.pc ? party.actors?.[party.pc] : null;
    if (!pc) return null;
    const known = new Set((pc.skills ?? []).map(skill => nameKey(skill.name)));
    // A built skill keeps its element only as the condition it puts on (v1 skills.ELEMENTS: ice → slow).
    const elementOf = skill => (skill.type === 'physical' || skill.type === 'magic')
        ? Object.keys(ELEMENTS).find(element => skill.effect && Object.hasOwn(skill.effect, ELEMENTS[element])) ?? null
        : null;
    const custom = Object.values(party.custom ?? {})
        .filter(skill => known.has(nameKey(skill.name)) && !findSkill(DEFAULT_SKILLS, skill.name))
        .map(skill => ({
            name: skill.name, type: skill.type, stat: skill.stat, target: skill.target,
            ...(skill.element || elementOf(skill) ? { element: skill.element ?? elementOf(skill) } : {}),
            ...(typeof skill.description === 'string' && skill.description ? { note: skill.description } : {}),
        }));
    // What your character carries and the party's bag: the companions do not come along.
    const owners = new Set([pc.id, 'party']);
    const items = Object.entries(inventory?.stacks ?? {})
        .filter(([, stack]) => owners.has(stack?.owner) && stack.qty > 0 && inventory.defs?.[stack.def])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, stack]) => ({ def: portableDef(inventory.defs[stack.def]), qty: stack.qty, equipped: Boolean(stack.equipped) }));
    const purse = [pc.id, 'party'].reduce((sum, owner) => sum + (Number(inventory?.wallets?.[owner]?.coin) || 0), 0);
    return {
        rpgBattleCharacter: CHARACTER_FILE_VERSION,
        name: pc.name,
        role: pc.role ?? '',
        ...(pc.background ? { background: pc.background } : {}),
        ...(pc.origin ? { origin: structuredClone(pc.origin) } : {}),
        level: pc.level,
        xp: pc.xp,
        points: pc.points,
        stats: { ...pc.stats },
        skills: (pc.skills ?? []).map(skill => ({ name: skill.name, level: skill.level, uses: skill.uses, active: skill.active !== false })),
        custom,
        items,
        purse,
        currency: String(currency ?? ''),
    };
}

/** The ids of a file's origin, as creation.build takes them. */
export function originIds(origin) {
    if (!isRecord(origin)) return null;
    const id = entry => (typeof entry === 'string' ? entry : isRecord(entry) && typeof entry.id === 'string' ? entry.id : null);
    return { race: id(origin.race), talents: (Array.isArray(origin.talents) ? origin.talents : []).map(id).filter(Boolean) };
}

/**
 * A character file checked by this chat's `rules` → { ok: true, character } with
 * character = { name, role, background, origin, sheet (a v1 Sheet, rested, no conditions),
 * custom: [skill defs to keep in party.custom], items: [{ def, qty, equipped }], purse }, or
 * { ok: false, code, message } (INVALID for a malformed file, REFUSED for one the rules do not
 * allow). `bonus` is the most the file's race and talents add to the stats here (0 when this
 * chat does not know them), `penalty` what they take off each stat ({ STAT: n ≤ 0 }): no stat
 * may be below the start value less its penalty, and only what is above it is paid for (B-b4-9).
 * `name` overrides the file's (the persona's, MODULES §F22). The items are held to this chat's
 * limits (def numbers: limits.js, at the file's level; never legendary; no price), their count to
 * MAX_THINGS and the purse to purseCap(level); what is cut is in `character.cut`.
 */
export function readCharacter(file, { rules, bonus = 0, penalty = {}, name: nameOverride = null } = {}) {
    if (!isRecord(file) || file.rpgBattleCharacter === undefined) return refuse('INVALID', 'That is not an RPG Battle character file.');
    if (file.rpgBattleCharacter !== CHARACTER_FILE_VERSION) return refuse('INVALID', `That character file is version ${file.rpgBattleCharacter}; this RPG Battle reads version ${CHARACTER_FILE_VERSION}.`);
    const name = cleanName(nameOverride ?? file.name);
    if (!name) return refuse('INVALID', 'The character file has no name.');
    const r = rules;
    const cap = maxLevel(r);
    if (!isWhole(file.level, 1)) return refuse('INVALID', 'The level must be a whole number from 1.');
    if (file.level > cap) return refuse('REFUSED', `${name} is level ${file.level}; this chat's level cap is ${cap}.`);
    if (!isWhole(file.xp)) return refuse('INVALID', 'XP must be a whole number, 0 or more.');
    if (file.level < cap && file.xp >= xpToNext(file.level, r)) return refuse('REFUSED', `${name} has ${file.xp} XP, more than level ${file.level} holds (${xpToNext(file.level, r)}).`);
    const points = file.points ?? 0;
    if (!isWhole(points)) return refuse('INVALID', 'Unspent points must be a whole number, 0 or more.');
    if (!isRecord(file.stats) || STATS.some(stat => !isWhole(file.stats[stat])) || Object.keys(file.stats).some(key => !STATS.includes(key))) {
        return refuse('INVALID', `The stats must be ${STATS.join(', ')} as whole numbers, 0 or more.`);
    }
    const top = statCap(r);
    const over = STATS.find(stat => file.stats[stat] > top);
    if (over) return refuse('REFUSED', `${over} is ${file.stats[over]}; no stat can go higher than ${top} in this chat.`);
    // Every stat starts at startStat; start points, each level's points and the origin's bonuses are all a character gets.
    const c = r.character;
    const floor = stat => c.startStat + Math.min(0, Math.round(Number(penalty?.[stat]) || 0));
    const low = STATS.find(stat => file.stats[stat] < floor(stat));
    if (low) return refuse('REFUSED', `${low} is ${file.stats[low]}; every stat starts at ${floor(low)} here, so no stat can be lower.`);
    const allowed = c.startPoints + (file.level - 1) * c.pointsPerLevel + Math.max(0, Math.round(Number(bonus) || 0));
    const used = STATS.reduce((sum, stat) => sum + Math.max(0, file.stats[stat] - c.startStat), 0) + points;
    if (used > allowed) return refuse('REFUSED', `${name}'s stats and points add up to ${used} points; a level ${file.level} character here has ${allowed} at most.`);

    // Skills: a library one, or a story-taught one built again from the file's template at this level.
    if (file.skills !== undefined && !Array.isArray(file.skills)) return refuse('INVALID', 'Skills must be a list.');
    if (file.custom !== undefined && !Array.isArray(file.custom)) return refuse('INVALID', 'Story-taught skills must be a list.');
    const rawSkills = file.skills ?? [];
    if (rawSkills.length > MAX_SKILLS) return refuse('REFUSED', `A character file holds ${MAX_SKILLS} skills at most.`);
    const templates = new Map();
    for (const entry of file.custom ?? []) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name.trim()) return refuse('INVALID', 'Each story-taught skill needs a name.');
        if (entry.type !== undefined && !SKILL_TYPES.includes(entry.type)) return refuse('INVALID', `${entry.name}: the type must be ${SKILL_TYPES.join(', ')}.`);
        templates.set(nameKey(entry.name), entry);
    }
    const custom = [];
    const skills = [];
    const seen = new Set();
    for (const entry of rawSkills) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name.trim()) return refuse('INVALID', 'Each skill needs a name.');
        const key = nameKey(entry.name);
        if (seen.has(key)) return refuse('INVALID', `${entry.name} is listed twice.`);
        seen.add(key);
        const mastery = entry.level ?? 1;
        if (!isWhole(mastery, 1) || mastery > r.masteryMax) return refuse('INVALID', `${entry.name}: the skill level must be a whole number from 1 to ${r.masteryMax}.`);
        const uses = entry.uses ?? 0;
        if (!isWhole(uses)) return refuse('INVALID', `${entry.name}: uses must be a whole number, 0 or more.`);
        let skillName = findSkill(DEFAULT_SKILLS, entry.name)?.name ?? null;
        if (!skillName) {
            const template = templates.get(key);
            if (!template) return refuse('INVALID', `"${entry.name}" is neither in the skill library nor described in the file.`);
            const built = skillFromTemplate({ name: String(template.name).trim().slice(0, 40), type: template.type, stat: template.stat, target: template.target, element: template.element ?? null }, file.level, r);
            const note = typeof template.note === 'string' ? template.note.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
            if (note) built.description = note;
            custom.push(built);
            skillName = built.name;
        }
        skills.push({ name: skillName, mastery, ...(entry.active === false ? { aside: true } : {}), uses });
    }
    const inUse = skills.filter(skill => !skill.aside).length;
    if (inUse > c.activeSkills) return refuse('REFUSED', `${name} uses ${inUse} skills; this chat allows ${c.activeSkills} in use.`);

    // Items and the purse.
    if (file.items !== undefined && !Array.isArray(file.items)) return refuse('INVALID', 'Items must be a list.');
    if ((file.items ?? []).length > MAX_ITEMS) return refuse('REFUSED', `A character file holds ${MAX_ITEMS} kinds of item at most.`);
    const items = [];
    let room = MAX_THINGS;
    let thingsCut = 0;
    for (const entry of file.items ?? []) {
        if (!isRecord(entry) || !isRecord(entry.def) || typeof entry.def.name !== 'string' || !entry.def.name.trim()) return refuse('INVALID', 'Each item needs a definition with a name.');
        if (!isWhole(entry.qty, 1) || entry.qty > MAX_QTY) return refuse('INVALID', `${entry.def.name}: the quantity must be a whole number from 1 to ${MAX_QTY}.`);
        const qty = Math.min(entry.qty, room);
        thingsCut += entry.qty - qty;
        room -= qty;
        if (qty > 0) items.push({ def: fileDef(entry.def, file.level, r), qty, equipped: entry.equipped === true });
    }
    const written = file.purse ?? 0;
    if (!isWhole(written)) return refuse('INVALID', 'The purse must be a whole number, 0 or more.');
    const purse = Math.min(written, purseCap(file.level));

    const role = cleanRole(file.role ?? '');
    const background = typeof file.background === 'string' ? file.background.trim().slice(0, MAX_BACKGROUND) : '';
    const sheet = recompute({
        name, level: file.level, xp: file.level >= cap ? 0 : file.xp, points,
        hp: {}, mp: {}, sp: {},
        stats: Object.fromEntries(STATS.map(stat => [stat, file.stats[stat]])),
        skills: skills.map(({ uses: _uses, ...skill }) => skill),
        conditions: [],
        uses: Object.fromEntries(skills.filter(skill => skill.uses > 0 && skill.mastery < r.masteryMax).map(skill => [skill.name, skill.uses])),
    }, [], r);
    const cut = { things: thingsCut, purse: written - purse };
    return { ok: true, character: { name, role, background, origin: originIds(file.origin), sheet, custom, items, purse, cut } };
}

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** A file's effect as the fields an effect has: { heal, mp, cure, damage? }. */
function fileEffect(effect) {
    const out = {
        heal: Number.isFinite(effect.heal) ? effect.heal : 0,
        mp: Number.isFinite(effect.mp) ? effect.mp : 0,
        cure: Array.isArray(effect.cure) ? effect.cure.filter(entry => typeof entry === 'string').map(entry => text(entry, 20)).filter(Boolean).slice(0, 5) : [],
    };
    if (isRecord(effect.damage) && Number.isFinite(effect.damage.amount)) {
        out.damage = { amount: effect.damage.amount, element: text(String(effect.damage.element ?? ''), 20), target: effect.damage.target === 'all' ? 'all' : 'one' };
    }
    return out;
}

/**
 * A file's item def as this chat takes it: only the fields a def has, no price (the chat prices
 * it), never legendary, stats capped to the rarity's budget at the character's `level`, an effect
 * to the largest built-in potion's (limits.js). Its id is kept for the importer to match against
 * the chat's own defs (creation.import drops one the chat does not have).
 */
function fileDef(def, level, rules) {
    const kind = ITEM_KINDS.includes(def.kind) ? def.kind : 'goods';
    const rarity = storyRarity(typeof def.rarity === 'string' ? def.rarity : 'common');
    const slot = kind === 'equipment' && typeof def.slot === 'string' ? text(def.slot, 20) || null : null;
    const numbers = isRecord(def.stats) ? Object.fromEntries(Object.entries(def.stats).filter(([key, value]) => /^[A-Za-z]{2,8}$/.test(key) && Number.isFinite(value)).slice(0, 12)) : {};
    const out = {
        name: text(def.name, 60),
        kind,
        rarity,
        stack: kind !== 'equipment' && def.stack !== false,
        slot,
        stats: kind === 'equipment' ? capStats(numbers, { slot, rarity, level, rules }) ?? {} : {},
        effect: kind === 'consumable' && isRecord(def.effect) ? capEffect(fileEffect(def.effect)) : {},
        tags: Array.isArray(def.tags) ? def.tags.filter(tag => typeof tag === 'string').map(tag => text(tag, 30)).filter(Boolean).slice(0, 10) : [],
        note: text(def.note, 300),
    };
    if (typeof def.id === 'string') out.id = def.id;
    if (Number.isInteger(def.weight) && def.weight >= 0 && def.weight <= 100) out.weight = def.weight;
    return out;
}
