// From the sheets to the fighters: your sheet (or a companion's) with its gear and
// consumables becomes a Combatant, and the setup's enemy rows become projected enemies. Also
// the party's own changes: a companion joining (built open-ended, builds.js), and one renamed
// (whose id follows the name, so what the chat keeps by id has to move with it). Pure.

import { STATS, derive, maxHp, maxMp } from './rules.js';
import { findSkill, resolveSkills } from './skills.js';
import { focusWeights, lockedReason, spreadByWeights } from './builds.js';
import { projectEnemy } from './enemies.js';
import { consumables, gearBonuses, parseGearEntry } from './items.js';
import { activeSkills, memberIds, newSheet, recompute, slug } from './sheet.js';
import { maxLevel } from './terms.js';

const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));

/**
 * A party Combatant from a sheet: stats plus gear, max HP/MP with gear bonuses, current HP/MP
 * from the sheet (clamped), the skills in use (not set aside) resolved against the library,
 * consumables from `items`.
 */
export function combatantFromSheet(sheet, { memberId = 'pc', controller = 'player', gear = [], items = [], library = [], rules }) {
    const bonus = gearBonuses(gear, sheet.level, rules);
    const stats = { ...sheet.stats };
    const withGear = Object.fromEntries(Object.entries(stats).map(([name, value]) => [name, value + (Number(bonus[name]) || 0)]));
    const hpMax = maxHp(withGear, sheet.level, rules, bonus.HP);
    const mpMax = maxMp(withGear, sheet.level, rules, bonus.MP);
    const numbers = derive(stats, bonus, rules);
    return {
        id: memberId,
        memberId,
        name: sheet.name || 'You',
        side: 'party',
        controller,
        level: sheet.level,
        rank: null,
        role: null,
        boss: false,
        stats: withGear,
        hp: { cur: clampInt(sheet.hp?.cur ?? hpMax, 0, hpMax), max: hpMax },
        mp: { cur: clampInt(sheet.mp?.cur ?? mpMax, 0, mpMax), max: mpMax },
        ...numbers,
        skills: resolveSkills(activeSkills(sheet), library, sheet.level, rules).map(skill => ({ ...skill, cooldownLeft: 0 })),
        items: consumables(items),
        conditions: (sheet.conditions ?? []).filter(entry => entry.rounds).map(entry => ({ name: entry.name, rounds: entry.rounds, power: 0 })),
        morale: 0,
        talks: false,
        fleesBelow: 0,
        xp: 0,
        loot: null,
        gone: null,
        capped: bonus.capped ?? [],
    };
}

/**
 * The enemies for setup rows [{ name, count, rank, level, role, boss }], with stable ids e1,
 * e2…. A row's `level` (a power picked in the reader's terms) is interpolated from the rank
 * table; otherwise its rank, or the bestiary's.
 */
export function enemiesFromRows(rows, { bestiary, library, rules, rng }) {
    const enemies = [];
    for (const row of rows ?? []) {
        const name = String(row?.name ?? '').trim();
        if (!name) continue;
        const count = clampInt(row.count ?? 1, 1, 9);
        for (let n = 1; n <= count; n++) {
            const id = `e${enemies.length + 1}`;
            const level = Number(row.level) >= 1 ? Math.round(Number(row.level)) : null;
            const enemy = projectEnemy({ name, rank: row.rank || null, level, role: row.role || null, boss: Boolean(row.boss) }, { bestiary, library, rules, rng, id });
            // Several of a kind are told apart by letter: "Goblin A", "Goblin B".
            enemies.push({ ...enemy, id, name: count > 1 ? `${name} ${String.fromCharCode(64 + n)}` : name });
        }
    }
    return enemies;
}

/**
 * A new companion: { name, role, control, level, focus, skills, gearLines } → Member. Built
 * open-ended (builds.js): every stat at the start value, the starting points and those of each
 * level after the first spread over up to three focus stats by weight (3, 2, 1; none: evenly),
 * so a level-6 healer joins as a level-6 healer. `skills` are up to starterSkills library
 * names their built stats allow (with `library` given, an unknown or locked one throws, saying
 * why). A `preset` ({ points, skills }, internal data) still builds the old way. `gearLines`
 * are Equipped entries ("Ashwood Staff (rare) · MATK +7"), one per line.
 */
export function newCompanion({ name, role = 'companion', control = 'auto', level = 1, preset = null, focus = [], skills = null, gearLines = '' }, { rules, existing = [], library = null }) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new Error('Give the companion a name.');
    const target = Math.max(1, Math.min(maxLevel(rules), Math.round(Number(level) || 1)));
    const weights = preset ? preset.points ?? {} : focusWeights(focus);
    const start = preset ? preset.points ?? {} : spreadByWeights(rules.character.startPoints, weights);
    const extra = spreadByWeights((target - 1) * rules.character.pointsPerLevel, weights);
    const stats = Object.fromEntries(STATS.map(stat => [stat, rules.character.startStat + (Number(start[stat]) || 0) + extra[stat]]));
    const names = [...new Set((preset ? preset.skills : skills ?? []).map(entry => String(entry ?? '').trim()).filter(Boolean))];
    if (names.length > rules.character.starterSkills) throw new Error(`A new companion starts with ${rules.character.starterSkills} skills at most.`);
    if (library) {
        for (const skillName of names) {
            const found = findSkill(library, skillName);
            if (!found) throw new Error(`"${skillName}" is not in the skill library.`);
            const why = lockedReason(stats, found);
            if (why) throw new Error(`${trimmed} cannot take ${found.name}: it ${why}.`);
        }
    }
    let sheet = newSheet({ name: trimmed, stats: Object.fromEntries(STATS.map(stat => [stat, Number(start[stat]) || 0])), skills: names }, rules);
    sheet = { ...sheet, level: target, stats };
    const gear = String(gearLines ?? '').split(/\n|\s+\|\s+/).map(line => line.trim()).filter(Boolean).map(parseGearEntry);
    sheet = recompute({ ...sheet, hp: { cur: Infinity, max: 0 }, mp: { cur: Infinity, max: 0 } }, gear, rules);
    const taken = new Set(['pc', ...existing.map(member => member.id)]);
    let id = slug(trimmed) || 'companion';
    for (let n = 2; taken.has(id); n++) id = `${slug(trimmed) || 'companion'}-${n}`;
    return { id, name: trimmed, role: String(role ?? '').trim() || 'companion', control: control === 'command' ? 'command' : 'auto', sheet, gear };
}

// What a Party heading can hold: `## Name — role | control: auto` is split on the dash, the
// bar and a trailing bracket, so a name or role carrying them would not read back as written.
function headingText(value, max) {
    return String(value ?? '')
        .replace(/[|#\r\n<>]/g, ' ')
        .replace(/\s+[—–-]+\s+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s*\([^)]*\)\s*$/, '')
        .slice(0, max)
        .trim();
}

const nameKey = name => String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A companion's name, role and control changed: { members, idMap }. Everything else (sheet,
 * stats, gear, skills) stays as it was; the sheet takes the new name too. Ids follow names
 * (sheet.memberIds), so a rename can change the renamed member's id, and with two of a name
 * another member's; `idMap` is { oldId: newId } for every member, for whatever is kept by id
 * (index.js moves the chat's mastery `uses`). Throws on an unknown member, an empty name, or a
 * name another companion or the Character (`pcName`) already has.
 */
export function editCompanion(members, memberId, { name, role, control } = {}, { pcName = '' } = {}) {
    const list = members ?? [];
    const index = list.findIndex(member => member.id === memberId);
    if (index < 0) throw new Error('That companion is not in the party.');
    const member = list[index];
    const nextName = name === undefined ? member.name : headingText(name, 40);
    if (!nextName) throw new Error('Give the companion a name.');
    if (list.some((other, at) => at !== index && nameKey(other.name) === nameKey(nextName))) throw new Error(`There is already a ${nextName} in the party.`);
    if (pcName && nameKey(pcName) === nameKey(nextName)) throw new Error(`${nextName} is your character's name.`);
    const nextRole = role === undefined ? member.role : headingText(role, 30) || 'companion';
    const nextControl = control === undefined ? member.control : control === 'command' ? 'command' : 'auto';
    const edited = list.map((entry, at) => (at === index
        ? { ...entry, name: nextName, role: nextRole, control: nextControl, sheet: { ...entry.sheet, name: nextName } }
        : entry));
    const ids = memberIds(edited.map(entry => entry.name));
    const idMap = Object.fromEntries(list.map((entry, at) => [entry.id, ids[at]]));
    return { members: edited.map((entry, at) => ({ ...entry, id: ids[at] })), idMap };
}

/**
 * Per-member records (the chat's `uses`: { [memberId]: … }) moved to new ids. The members in
 * `idMap` keep their records under their new id; anyone else's (the Character's 'pc') stay.
 */
export function remapIds(records, idMap) {
    const out = {};
    const moving = new Set(Object.keys(idMap ?? {}));
    for (const [id, value] of Object.entries(records ?? {})) if (!moving.has(id)) out[id] = value;
    for (const [from, to] of Object.entries(idMap ?? {})) if (records && from in records) out[to] = records[from];
    return out;
}
