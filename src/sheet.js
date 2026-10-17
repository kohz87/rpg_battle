// The Character and Party blocks (DESIGN §3.1, §3.2): reading them back from the text the
// reader sees, writing them out canonically, and every change RPG Battle makes to a sheet
// (spending points, learning a skill, a fight's result, a recompute after a gear change).
//
// The blocks are kept by RPG Battle, so the canonical text is what normally comes back;
// the parser is still lenient (bold labels, any order, `|` or `,` between fields) because
// the reader can edit the block by hand and older copies may have been written by a model.
// It never throws: missing fields get defaults and are listed in `errors`. The State line
// (narrative.js) is written out for the model and never read back: it follows from HP, MP and
// conditions, so an edited or missing State line changes nothing. Pure.

import { DEFAULT_RULES, STATS, checkModifiers, maxHp, maxMp, xpToNext } from './rules.js';
import { formatGearEntry, gearBonuses, parseGearEntry } from './items.js';
import { stateWords } from './narrative.js';

// Condition names a fight resolves; anything else on a sheet (exhausted, cursed) is story
// the fight cannot see, so a result never clears it. A written "poisoned" counts as poison.
const COMBAT_CONDITIONS = ['poison', 'burn', 'bleed', 'stun', 'slow', 'weaken', 'shield', 'regen', 'guard'];

const LABELS = {
    name: 'name',
    level: 'level', lvl: 'level', lv: 'level',
    xp: 'xp', exp: 'xp', experience: 'xp',
    points: 'points', 'unspent points': 'points', 'stat points': 'points',
    hp: 'hp', health: 'hp',
    mp: 'mp', mana: 'mp',
    checks: 'checks',
    skills: 'skills',
    conditions: 'conditions', condition: 'conditions', status: 'conditions',
    equipped: 'equipped', equipment: 'equipped', gear: 'equipped',
    ...Object.fromEntries(STATS.map(stat => [stat.toLowerCase(), stat])),
};
const LABEL_PATTERN = new RegExp(
    `(?:^|[|,;]|\\s)\\s*(${Object.keys(LABELS).sort((a, b) => b.length - a.length).map(label => label.replace(/ /g, '\\s+')).join('|')})\\s*:`,
    'gi',
);

const int = value => {
    const match = String(value ?? '').match(/-?\d+/);
    return match ? Number(match[0]) : null;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const signed = value => (value < 0 ? `${value}` : `+${value}`);

function rulesOf(rules) {
    return rules ?? DEFAULT_RULES;
}

function copySheet(sheet) {
    return {
        ...sheet,
        hp: { ...sheet.hp },
        mp: { ...sheet.mp },
        stats: { ...sheet.stats },
        skills: (sheet.skills ?? []).map(skill => ({ ...skill })),
        conditions: (sheet.conditions ?? []).map(condition => ({ ...condition })),
        uses: { ...(sheet.uses ?? {}) },
    };
}

const skillKey = name => String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

// ---------------------------------------------------------------------------------------
// Reading

function stripMarkup(line) {
    return line
        .replace(/\*\*|__/g, '')
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
        .trim();
}

/** `Label: value` fields of one line, wherever the labels are and whatever separates them. */
function fieldsOf(line) {
    const text = stripMarkup(line);
    const marks = [];
    for (const match of text.matchAll(LABEL_PATTERN)) {
        marks.push({ field: LABELS[match[1].toLowerCase().replace(/\s+/g, ' ')], start: match.index, valueStart: match.index + match[0].length });
    }
    return marks.map((mark, i) => ({
        field: mark.field,
        value: text.slice(mark.valueStart, i + 1 < marks.length ? marks[i + 1].start : text.length).trim().replace(/^[|,;\s]+|[|,;\s]+$/g, ''),
    }));
}

function parsePair(value) {
    const match = String(value ?? '').match(/(-?\d+)\s*(?:\/|of)\s*(-?\d+)/);
    if (match) return { cur: Number(match[1]), max: Number(match[2]) };
    const single = int(value);
    return single === null ? null : { cur: single, max: null };
}

function isNone(value) {
    return /^(?:none|-+|—|nothing|n\/a)?\.?$/i.test(String(value ?? '').trim());
}

function parseSkills(value, rules) {
    if (isNone(value)) return [];
    const skills = [];
    for (const part of String(value).split(/\s*[|,;]\s*/)) {
        const match = part.match(/^(.*?)\s*(?:\(\s*(?:lv\.?|lvl\.?|level|mastery)?\s*(\d+)\s*\)|\b(?:lv\.?|lvl\.?)\s*(\d+))\s*$/i);
        const name = (match ? match[1] : part).trim();
        if (!name) continue;
        const mastery = clamp(Number(match?.[2] ?? match?.[3] ?? 1) || 1, 1, rules.masteryMax);
        if (!skills.some(skill => skillKey(skill.name) === skillKey(name))) skills.push({ name, mastery });
    }
    return skills;
}

function parseConditions(value) {
    if (isNone(value)) return [];
    const conditions = [];
    for (const part of String(value).split(/\s*[|,;]\s*/)) {
        const match = part.match(/^(.*?)\s*\(\s*(\d+)\s*(?:rounds?|r)?\s*\)\s*$/i);
        const name = (match ? match[1] : part).trim();
        if (name) conditions.push({ name, rounds: match ? Number(match[2]) : null });
    }
    return conditions;
}

/**
 * A sheet from the lines of one block or Party section; `found` also carries the fields a
 * caller handles itself (a Party section's Equipped line).
 */
function sheetFromLines(lines, rules, { name: givenName = null, label = 'Character' } = {}) {
    const found = {};
    for (const line of lines) {
        for (const { field, value } of fieldsOf(line)) {
            // The first value wins: a repeated field is more likely a stray copy than a fix.
            if (!(field in found)) found[field] = value;
        }
    }
    const errors = [];
    const missing = (what, fallback) => errors.push(`${label}: no ${what}, using ${fallback}.`);
    const name = (givenName ?? found.name ?? '').trim();
    if (!name) missing('Name', 'an empty name');
    let level = int(found.level);
    if (level === null || level < 1) {
        if ('level' in found) errors.push(`${label}: Level "${found.level}" is not a number, using 1.`);
        else missing('Level', '1');
        level = 1;
    }
    level = Math.min(level, rules.character.maxLevel);
    const stats = {};
    for (const stat of STATS) {
        const value = int(found[stat]);
        if (value === null) missing(stat, String(rules.character.startStat));
        stats[stat] = value === null ? rules.character.startStat : Math.max(0, value);
    }
    const xp = Math.max(0, int(String(found.xp ?? '').split('/')[0]) ?? 0);
    const points = Math.max(0, int(found.points) ?? 0);
    const pool = (field, max) => {
        const pair = parsePair(found[field]);
        if (!pair) missing(field.toUpperCase(), 'full');
        const top = pair?.max !== null && pair?.max !== undefined && pair.max >= 0 ? pair.max : max;
        return { cur: clamp(pair?.cur ?? top, 0, top), max: top };
    };
    const sheet = {
        name,
        level,
        xp,
        points,
        hp: pool('hp', maxHp(stats, level, rules)),
        mp: pool('mp', maxMp(stats, level, rules)),
        stats,
        skills: parseSkills(found.skills, rules),
        conditions: parseConditions(found.conditions),
        // Mastery progress is not in the text (it would be noise to the model), so a sheet
        // read back starts each skill's progress afresh.
        uses: {},
    };
    return { sheet, errors, found };
}

// Tag lines go, and so does the State line: it is derived, and its free words (a condition
// written by hand may hold anything) must not be mistaken for fields.
function blockLines(text) {
    return String(text ?? '')
        .split(/\r?\n/)
        .filter(line => !/^\s*<\/?[A-Za-z][\w-]*>\s*$/.test(line) && !/^state\s*:/i.test(stripMarkup(line)));
}

/** The Character block's text as a Sheet; never throws. */
export function parseCharacter(text, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const lines = blockLines(text);
    if (!lines.some(line => fieldsOf(line).length)) return { sheet: null, errors: ['Character: no fields found.'] };
    const { sheet, errors } = sheetFromLines(lines, r);
    return { sheet, errors };
}

/** A stable id from a name: "Astra the Bold" → "astra-the-bold". */
export function slug(name) {
    const text = String(name ?? '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return text || 'member';
}

function parseHeading(text) {
    const [first, ...rest] = stripMarkup(text.replace(/^\s*#{1,6}\s*/, '')).split('|');
    const tail = rest.join('|');
    let name = first.trim();
    let role = '';
    const dashed = name.match(/^(.*?)\s+[—–-]+\s+(.*)$/);
    const bracketed = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    if (dashed) [name, role] = [dashed[1].trim(), dashed[2].trim()];
    else if (bracketed) [name, role] = [bracketed[1].trim(), bracketed[2].trim()];
    const control = tail.match(/control\s*:\s*([a-z]+)/i)?.[1]?.toLowerCase() ?? null;
    return { name, role, control };
}

/** The Party block's text as Members; never throws. */
export function parseParty(text, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const sections = [];
    for (const line of blockLines(text)) {
        if (/^\s*#{1,6}\s+\S/.test(line)) sections.push({ heading: line, lines: [] });
        else if (sections.length) sections.at(-1).lines.push(line);
    }
    const members = [];
    const errors = [];
    // 'pc' is the Character's id in a fight, so no companion may take it.
    const taken = new Set(['pc']);
    for (const section of sections) {
        const heading = parseHeading(section.heading);
        if (!heading.name) {
            errors.push(`Party: a section without a name ("${section.heading.trim()}") was skipped.`);
            continue;
        }
        const label = `Party (${heading.name})`;
        let control = heading.control;
        if (control !== 'auto' && control !== 'command') {
            if (control) errors.push(`${label}: control "${control}" is not auto or command, using auto.`);
            control = 'auto';
        }
        const { sheet, errors: sheetErrors, found } = sheetFromLines(section.lines, r, { name: heading.name, label });
        errors.push(...sheetErrors);
        const gear = isNone(found.equipped) ? [] : String(found.equipped).split(/\s*\|\s*/).filter(Boolean).map(parseGearEntry);
        // A section written without HP/MP maxima gets them with its gear counted.
        if (!/\d\s*(?:\/|of)\s*\d/.test(found.hp ?? '') || !/\d\s*(?:\/|of)\s*\d/.test(found.mp ?? '')) {
            const full = recompute(sheet, gear, r);
            if (!/\d\s*(?:\/|of)\s*\d/.test(found.hp ?? '')) sheet.hp = { cur: Math.min(int(found.hp) ?? full.hp.max, full.hp.max), max: full.hp.max };
            if (!/\d\s*(?:\/|of)\s*\d/.test(found.mp ?? '')) sheet.mp = { cur: Math.min(int(found.mp) ?? full.mp.max, full.mp.max), max: full.mp.max };
        }
        let id = slug(heading.name);
        for (let n = 2; taken.has(id); n += 1) id = `${slug(heading.name)}-${n}`;
        taken.add(id);
        members.push({ id, name: heading.name, role: heading.role || 'companion', control, sheet, gear });
    }
    return { members, errors };
}

// ---------------------------------------------------------------------------------------
// Writing

function skillsLine(sheet) {
    const skills = (sheet.skills ?? []).map(skill => (skill.mastery > 1 ? `${skill.name} (Lv ${skill.mastery})` : skill.name));
    return `Skills: ${skills.length ? skills.join(' | ') : 'none'}`;
}

function conditionsText(sheet) {
    const list = (sheet.conditions ?? []).map(condition => (condition.rounds ? `${condition.name} (${condition.rounds})` : condition.name));
    return list.length ? list.join(', ') : 'none';
}

function statsLine(sheet) {
    return STATS.map(stat => `${stat}: ${sheet.stats?.[stat] ?? 0}`).join(' | ');
}

function levelLine(sheet, rules) {
    return `Level: ${sheet.level} | XP: ${sheet.xp}/${xpToNext(sheet.level, rules)} | Points: ${sheet.points}`;
}

function poolsLine(sheet) {
    return `HP: ${sheet.hp.cur}/${sheet.hp.max} | MP: ${sheet.mp.cur}/${sheet.mp.max}`;
}

function stateLine(sheet, rules) {
    return `State: ${stateWords(sheet, rules).text}`;
}

/** The canonical Character block text (DESIGN §3.1), Checks and State worked out by code. */
export function formatCharacter(sheet, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const checks = checkModifiers(sheet.stats, r);
    return [
        `Name: ${sheet.name}`,
        levelLine(sheet, r),
        poolsLine(sheet),
        statsLine(sheet),
        `Checks: ${STATS.map(stat => `${stat} ${signed(checks[stat])}`).join(' | ')}`,
        stateLine(sheet, r),
        skillsLine(sheet),
        `Conditions: ${conditionsText(sheet)}`,
    ].join('\n');
}

/**
 * The canonical Party block text: one `## Name — role | control: auto` section per member
 * with the Character block's lines (no Checks: those are for the reader's own rolls; State
 * right under HP/MP, so each companion's numbers and how to play them sit together), a
 * Conditions line only when there are any and an Equipped line only when there is gear.
 */
export function formatParty(members, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    return (members ?? []).map(member => {
        const sheet = member.sheet;
        const lines = [
            `## ${member.name ?? sheet.name} — ${member.role || 'companion'} | control: ${member.control === 'command' ? 'command' : 'auto'}`,
            levelLine(sheet, r),
            poolsLine(sheet),
            stateLine(sheet, r),
            statsLine(sheet),
            skillsLine(sheet),
        ];
        if (sheet.conditions?.length) lines.push(`Conditions: ${conditionsText(sheet)}`);
        if (member.gear?.length) lines.push(`Equipped: ${member.gear.map(formatGearEntry).join(' | ')}`);
        return lines.join('\n');
    }).join('\n\n');
}

// ---------------------------------------------------------------------------------------
// Changes

function validAllocation(allocation, label) {
    const out = {};
    for (const [stat, value] of Object.entries(allocation ?? {})) {
        if (!STATS.includes(stat)) throw new Error(`${label}: "${stat}" is not a stat.`);
        if (!Number.isInteger(value) || value < 0) throw new Error(`${label}: ${stat} must be a whole number of points, 0 or more.`);
        if (value) out[stat] = value;
    }
    return out;
}

const spent = allocation => Object.values(allocation).reduce((sum, value) => sum + value, 0);

/** A level-1 character: every stat at startStat plus the allocation, which spends exactly startPoints. */
export function newSheet({ name, stats, skills } = {}, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const allocation = validAllocation(stats, 'New character');
    const total = spent(allocation);
    if (total !== r.character.startPoints) {
        throw new Error(`New character: spend exactly ${r.character.startPoints} points (${total} spent).`);
    }
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new Error('New character: a name is needed.');
    const base = Object.fromEntries(STATS.map(stat => [stat, r.character.startStat + (allocation[stat] ?? 0)]));
    const hp = maxHp(base, 1, r);
    const mp = maxMp(base, 1, r);
    let sheet = {
        name: trimmed, level: 1, xp: 0, points: 0,
        hp: { cur: hp, max: hp }, mp: { cur: mp, max: mp },
        stats: base, skills: [], conditions: [], uses: {},
    };
    for (const skill of skills ?? []) sheet = learnSkill(sheet, typeof skill === 'string' ? skill : skill?.name);
    return sheet;
}

// Raising max HP/MP raises current HP/MP by the same amount: a level-up or a VIT point is
// felt at once, and gear bonuses already inside the maxima are kept.
function growPools(sheet, before, rules) {
    const hpGain = maxHp(sheet.stats, sheet.level, rules) - maxHp(before.stats, before.level, rules);
    const mpGain = maxMp(sheet.stats, sheet.level, rules) - maxMp(before.stats, before.level, rules);
    sheet.hp = { max: Math.max(1, sheet.hp.max + hpGain), cur: clamp(sheet.hp.cur + hpGain, 0, Math.max(1, sheet.hp.max + hpGain)) };
    sheet.mp = { max: Math.max(0, sheet.mp.max + mpGain), cur: clamp(sheet.mp.cur + mpGain, 0, Math.max(0, sheet.mp.max + mpGain)) };
}

/** Unspent points into stats; throws when over budget or not whole non-negative numbers. */
export function spendPoints(sheet, allocation, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const clean = validAllocation(allocation, 'Spend points');
    const total = spent(clean);
    if (total > sheet.points) throw new Error(`Spend points: ${total} points asked, ${sheet.points} unspent.`);
    const next = copySheet(sheet);
    for (const [stat, value] of Object.entries(clean)) next.stats[stat] += value;
    next.points -= total;
    growPools(next, sheet, r);
    return next;
}

/** A skill added at mastery 1; a name already known (any case) changes nothing. */
export function learnSkill(sheet, name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new Error('Learn skill: a name is needed.');
    const next = copySheet(sheet);
    if (!next.skills.some(skill => skillKey(skill.name) === skillKey(trimmed))) next.skills.push({ name: trimmed, mastery: 1 });
    return next;
}

function isCombatCondition(name) {
    const lower = String(name ?? '').trim().toLowerCase();
    return COMBAT_CONDITIONS.some(condition => lower.startsWith(condition));
}

/**
 * A fight's Result applied to one sheet: HP/MP and lasting conditions as the fight left
 * them, XP with level-ups (xp carries over), mastery from skill uses.
 */
export function applyResult(sheet, memberId, result, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const next = copySheet(sheet);
    const entry = (result?.party ?? []).find(member => member.memberId === memberId);
    if (entry) {
        // The fight's maxima include gear, which is what the sheet shows too.
        const hpMax = Number.isFinite(entry.hp?.max) ? entry.hp.max : next.hp.max;
        const mpMax = Number.isFinite(entry.mp?.max) ? entry.mp.max : next.mp.max;
        next.hp = { max: hpMax, cur: clamp(Math.round(entry.hp?.cur ?? next.hp.cur), 0, hpMax) };
        next.mp = { max: mpMax, cur: clamp(Math.round(entry.mp?.cur ?? next.mp.cur), 0, mpMax) };
        const lasting = (entry.conditions ?? []).map(condition => ({ name: condition.name, rounds: condition.rounds ?? null }));
        const story = next.conditions.filter(condition => !isCombatCondition(condition.name)
            && !lasting.some(other => skillKey(other.name) === skillKey(condition.name)));
        next.conditions = [...lasting, ...story];
    }

    let levelsGained = 0;
    next.xp += Math.max(0, Math.round(Number(result?.xp?.[memberId]) || 0));
    while (next.level < r.character.maxLevel && next.xp >= xpToNext(next.level, r)) {
        const before = { stats: next.stats, level: next.level };
        next.xp -= xpToNext(next.level, r);
        next.level += 1;
        levelsGained += 1;
        growPools(next, before, r);
    }
    const pointsGained = levelsGained * r.character.pointsPerLevel;
    next.points += pointsGained;

    const masteryGained = [];
    for (const [name, count] of Object.entries(result?.uses?.[memberId] ?? {})) {
        const skill = next.skills.find(entry => skillKey(entry.name) === skillKey(name));
        const n = Math.round(Number(count) || 0);
        if (!skill || n <= 0) continue;
        // Uses count toward the next level and carry over, like XP.
        let progress = (next.uses[skill.name] ?? 0) + n;
        const start = skill.mastery;
        while (skill.mastery < r.masteryMax) {
            const needed = Number(r.masteryUses?.[skill.mastery]);
            if (!(needed > 0) || progress < needed) break;
            progress -= needed;
            skill.mastery += 1;
        }
        if (skill.mastery >= r.masteryMax) delete next.uses[skill.name];
        else next.uses[skill.name] = progress;
        if (skill.mastery > start) masteryGained.push(skill.name);
    }
    return { sheet: next, levelsGained, pointsGained, masteryGained };
}

/**
 * Max HP/MP from stats, level and gear (the gear's HP/MP and stat bonuses, capped, as a
 * fight counts them); current HP/MP kept but never above the new maxima. `gear` is a list of
 * Items (only equipped ones count) or an already-summed gearBonuses() object.
 */
export function recompute(sheet, gear, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const bonus = Array.isArray(gear) ? gearBonuses(gear.map(item => ({ equipped: true, ...item })), sheet.level, r) : gear ?? {};
    const stats = Object.fromEntries(STATS.map(stat => [stat, (sheet.stats?.[stat] ?? 0) + (Number(bonus[stat]) || 0)]));
    const next = copySheet(sheet);
    const hp = maxHp(stats, sheet.level, r, Number(bonus.HP) || 0);
    const mp = maxMp(stats, sheet.level, r, Number(bonus.MP) || 0);
    next.hp = { max: hp, cur: clamp(sheet.hp?.cur ?? hp, 0, hp) };
    next.mp = { max: mp, cur: clamp(sheet.mp?.cur ?? mp, 0, mp) };
    return next;
}
