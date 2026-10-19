// The party as a file (0.4): Export writes your character and companions as JSON (sheets,
// skills, gear, plain numbers that do not depend on the terms); Import reads one back into a
// chat. A file is the reader's, but it is cleaned like anything that reaches the sheets: names
// made safe for the Party block's headings, every number whole and within its bounds, max HP
// and MP worked out again from stats, level and gear, gear entries read again as the Equipped
// line reads them (and capped by rarity in a fight, as always), and a story-taught skill's
// numbers built again from its template. Pure.

import { DEFAULT_RULES, STATS, xpToNext } from './rules.js';
import { formatGearEntry, parseGearEntry } from './items.js';
import { activeWithin, recompute } from './sheet.js';
import { headingText } from './party.js';
import { findSkill, skillFromTemplate } from './skills.js';
import { maxLevel } from './terms.js';

export const PARTY_FILE_VERSION = 1;
const MAX_COMPANIONS = 12;
const MAX_SKILLS = 40;
const MAX_GEAR = 12;

const whole = (value, min, max, fallback = min) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function sheetData(sheet) {
    return {
        name: sheet.name, level: sheet.level, xp: sheet.xp, points: sheet.points,
        hp: { ...sheet.hp }, mp: { ...sheet.mp }, ...(sheet.sp ? { sp: { ...sheet.sp } } : {}), stats: { ...sheet.stats },
        skills: (sheet.skills ?? []).map(skill => ({ name: skill.name, mastery: skill.mastery ?? 1, ...(skill.aside ? { aside: true } : {}) })),
        conditions: (sheet.conditions ?? []).map(condition => ({ name: condition.name, rounds: condition.rounds ?? null })),
    };
}

/**
 * The file's content: { rpgBattleParty: 1, character, companions: [{ name, role, control,
 * sheet, gear: [entries] }], gear: [your equipped items as entries], skills: [the story-taught
 * skills the party knows, as templates] }.
 */
export function exportParty({ pc = null, members = [], yourGear = [], skills = [] } = {}) {
    const known = new Set([pc, ...members.map(member => member.sheet)].filter(Boolean).flatMap(sheet => (sheet.skills ?? []).map(skill => String(skill.name).toLowerCase())));
    return {
        rpgBattleParty: PARTY_FILE_VERSION,
        character: pc ? sheetData(pc) : null,
        companions: (members ?? []).map(member => ({ name: member.name, role: member.role, control: member.control, sheet: sheetData(member.sheet), gear: (member.gear ?? []).map(formatGearEntry) })),
        gear: (yourGear ?? []).map(formatGearEntry),
        skills: (skills ?? []).filter(skill => known.has(String(skill.name).toLowerCase())).map(skill => ({ name: skill.name, type: skill.type, stat: skill.stat, target: skill.target, ...(skill.element ? { element: skill.element } : {}) })),
    };
}

function cleanSheet(raw, name, rules, gear) {
    const r = rules;
    const level = whole(raw?.level, 1, maxLevel(r), 1);
    const stats = Object.fromEntries(STATS.map(stat => [stat, whole(raw?.stats?.[stat], 0, 999, r.character.startStat)]));
    const skills = activeWithin((Array.isArray(raw?.skills) ? raw.skills : []).slice(0, MAX_SKILLS).map(skill => ({
        name: headingText(typeof skill === 'string' ? skill : skill?.name, 40).replace(/[,;]/g, ' ').trim(),
        mastery: whole(skill?.mastery, 1, r.masteryMax, 1),
        ...(skill?.aside ? { aside: true } : {}),
    })).filter(skill => skill.name), r);
    const conditions = (Array.isArray(raw?.conditions) ? raw.conditions : []).slice(0, 12).map(condition => ({
        name: String(condition?.name ?? '').replace(/[|,;:#<>\r\n()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30),
        rounds: condition?.rounds === null || condition?.rounds === undefined ? null : whole(condition.rounds, 1, 99, 1),
    })).filter(condition => condition.name);
    const sheet = {
        name, level,
        xp: level >= maxLevel(r) ? 0 : whole(raw?.xp, 0, xpToNext(level, r) - 1, 0),
        points: whole(raw?.points, 0, 999, 0),
        hp: { cur: whole(raw?.hp?.cur, 0, 1e6, Infinity), max: 0 },
        mp: { cur: whole(raw?.mp?.cur, 0, 1e6, Infinity), max: 0 },
        sp: { cur: whole(raw?.sp?.cur, 0, 1e6, Infinity), max: 0 },
        stats, skills, conditions, uses: {},
    };
    return recompute(sheet, gear, r);
}

const gearOf = list => (Array.isArray(list) ? list : []).slice(0, MAX_GEAR).map(entry => parseGearEntry(String(entry ?? ''))).filter(item => item.name);

/**
 * A file's content, cleaned: { pc, members, yourGear: [Items], skills: [Skill] }. Throws when it
 * is not a party file (`rpgBattleParty`) or holds nobody. Companion names that repeat yours or
 * each other's are dropped after the first.
 */
export function cleanParty(data, rules = DEFAULT_RULES, library = []) {
    if (!data || typeof data !== 'object' || !data.rpgBattleParty) throw new Error('That is not an RPG Battle party file.');
    const yourGear = gearOf(data.gear);
    const pcName = headingText(data.character?.name, 60);
    const pc = data.character && pcName ? cleanSheet(data.character, pcName, rules, yourGear) : null;
    const taken = new Set(pc ? [pc.name.toLowerCase()] : []);
    const members = [];
    for (const raw of (Array.isArray(data.companions) ? data.companions : []).slice(0, MAX_COMPANIONS)) {
        const name = headingText(raw?.name ?? raw?.sheet?.name, 40);
        if (!name || taken.has(name.toLowerCase())) continue;
        taken.add(name.toLowerCase());
        const gear = gearOf(raw?.gear);
        members.push({ id: null, name, role: headingText(raw?.role, 30) || 'companion', control: raw?.control === 'command' ? 'command' : 'auto', sheet: cleanSheet(raw?.sheet, name, rules, gear), gear });
    }
    if (!pc && !members.length) throw new Error('That party file holds nobody.');
    // Story-taught skills: only templates, built again at the level of the first who knows them.
    const knowers = [pc, ...members.map(member => member.sheet)].filter(Boolean);
    const skills = (Array.isArray(data.skills) ? data.skills : []).slice(0, MAX_SKILLS).map(raw => {
        const name = headingText(raw?.name, 40);
        if (!name || findSkill(library, name)) return null;
        const level = knowers.find(sheet => sheet.skills.some(skill => skill.name.toLowerCase() === name.toLowerCase()))?.level ?? 1;
        return skillFromTemplate({ name, type: raw?.type, stat: raw?.stat, target: raw?.target, element: raw?.element }, level, rules);
    }).filter(Boolean);
    return { pc, members, yourGear, skills };
}
