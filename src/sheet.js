// The Party block (DESIGN §3.1, §3.2): reading it back from the text the reader sees, writing
// it out canonically, and every change RPG Battle makes to a sheet (spending points, learning a
// skill, a fight's result, a recompute after a gear change).
//
// Since 0.4 the reader's character and the companions share one kept block: the character is
// the first section, `## Ren (you)`, with everything the old Character block had (level line,
// HP/MP, stats, Checks, State, Skills, Conditions), and each companion follows as before
// (`## Lyra — healer | control: auto`). Older chats kept a separate Character block; readSheets
// still takes it when the Party block has no "(you)" section, and the next write makes them one.
//
// A member keeps every skill they learn, but only `rules.character.activeSkills` of them are
// in use; the rest are written on a `Set aside:` line and sit out fights until swapped back.
// Each skill carries its mastery and, since 0.4.1, the fight uses toward the next mastery level
// (`Rending Strike (Lv 2, 3/12)`, `Lv 5, max` at the top), so that progress lives in the block
// and rolls back with the reply that wrote it, like everything else on the sheet.
//
// The blocks are kept by RPG Battle, so the canonical text is what normally comes back;
// the parser is still lenient (bold labels, any order, `|` or `,` between fields) because
// the reader can edit the block by hand and older copies may have been written by a model.
// It never throws: missing fields get defaults and are listed in `errors`. The State line
// (narrative.js) is written out for the model and never read back: it follows from HP, MP and
// conditions, so an edited or missing State line changes nothing.
//
// The level line speaks the reader's terms (terms.js): `Soul Class: III (Lv 24) | Soul Growth:
// 54/100 | Points: 2` (0.5.2: XP within the level, never a tier's share), or `Level: 4 | XP:
// 31/100 | Points: 2` with the plain ones. The
// exact level is always in it, so the parsers read it back from the canonical form, from any
// terms form (with or without the colon after the level name) and from older blocks. Pure.

import { DEFAULT_RULES, STATS, checkModifiers, maxHp, maxMp, xpToNext } from './rules.js';
import { formatGearEntry, gearBonuses, parseGearEntry } from './items.js';
import { stateWords } from './narrative.js';
import { maxLevel, numeral as numeralFor, parseLevelLabel, progress, termsOf, xpFromProgress } from './terms.js';

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
    'set aside': 'aside', aside: 'aside',
    conditions: 'conditions', condition: 'conditions', status: 'conditions',
    equipped: 'equipped', equipment: 'equipped', gear: 'equipped',
    ...Object.fromEntries(STATS.map(stat => [stat.toLowerCase(), stat])),
};
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The labels with the reader's level and XP terms added ("soul class" → level), built once
// per pair of terms. A term never takes over another field's label (a world that calls its
// levels "Points" keeps Points as points).
const labelCache = new Map();

function labelsFor(rules) {
    const terms = termsOf(rules);
    const key = `${terms.levelName}|${terms.xpName}`;
    if (labelCache.has(key)) return labelCache.get(key);
    const labels = { ...LABELS };
    for (const [term, field] of [[terms.levelName, 'level'], [terms.xpName, 'xp']]) {
        const label = term.toLowerCase().replace(/\s+/g, ' ');
        if (!(label in labels)) labels[label] = field;
    }
    const pattern = new RegExp(
        `(?:^|[|,;]|\\s)\\s*(${Object.keys(labels).sort((a, b) => b.length - a.length).map(label => escapeRegExp(label).replace(/ /g, '\\s+')).join('|')})\\s*:`,
        'gi',
    );
    // "Soul Class III (Lv 24)" written without a colon is still the level field.
    const bare = new RegExp(`(^|\\|)\\s*(${escapeRegExp(terms.levelName).replace(/ /g, '\\s+')})\\s+(?=[^:|]*\\blv\\.?\\s*\\d)`, 'gi');
    const entry = { labels, pattern, bare };
    labelCache.set(key, entry);
    return entry;
}

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

/** How many skills a member uses in fights (rules.character.activeSkills, 6 by default; 1 to 99). */
export function activeCap(rules = DEFAULT_RULES) {
    const value = Math.round(Number(rules?.character?.activeSkills));
    return Number.isFinite(value) && value >= 1 ? Math.min(99, value) : DEFAULT_RULES.character.activeSkills;
}

/**
 * Skill entries with at most activeCap of them in use: the first ones not set aside stay
 * active, any past the cap are set aside (an older sheet over the cap keeps its first N), a
 * name written twice counts once. Active ones first, then the ones set aside, in order.
 */
export function activeWithin(skills, rules = DEFAULT_RULES) {
    const cap = activeCap(rules);
    const seen = new Set();
    const unique = [];
    for (const skill of skills ?? []) {
        const key = skillKey(skill?.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(skill);
    }
    const active = unique.filter(skill => !skill.aside).map(skill => ({ ...skill }));
    const aside = unique.filter(skill => skill.aside).map(skill => ({ ...skill }));
    for (const skill of active.slice(cap)) aside.unshift({ ...skill, aside: true });
    return [
        ...active.slice(0, cap).map(({ aside: _, ...skill }) => skill),
        ...aside.map(skill => ({ ...skill, aside: true })),
    ];
}

/** The skills a member fights with: the ones not set aside. */
export function activeSkills(sheet) {
    return (sheet?.skills ?? []).filter(skill => !skill?.aside);
}

// ---------------------------------------------------------------------------------------
// Reading

function stripMarkup(line) {
    return line
        .replace(/\*\*|__/g, '')
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
        .trim();
}

/** `Label: value` fields of one line, wherever the labels are and whatever separates them. */
function fieldsOf(line, rules) {
    const { labels, pattern, bare } = labelsFor(rules);
    const text = stripMarkup(line).replace(bare, '$1 $2: ');
    const marks = [];
    for (const match of text.matchAll(pattern)) {
        marks.push({ field: labels[match[1].toLowerCase().replace(/\s+/g, ' ')], start: match.index, valueStart: match.index + match[0].length });
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

// Splits a Skills line at its separators, but not inside brackets: `(Lv 2, 3/12)` is one skill.
function skillParts(value) {
    const parts = [];
    let depth = 0;
    let part = '';
    for (const char of String(value ?? '')) {
        if (char === '(') depth += 1;
        else if (char === ')') depth = Math.max(0, depth - 1);
        if (!depth && /[|,;]/.test(char)) {
            parts.push(part);
            part = '';
        } else {
            part += char;
        }
    }
    return [...parts, part].map(text => text.trim()).filter(Boolean);
}

// What one bracket after a skill's name says: its mastery (`Lv 2`, `2`, `mastery 2`), its
// progress (`3/12`, `3 of 12`, `3/12 uses`) and `max`, in any order. null when the bracket says
// anything else: it is part of the name then ("Strike (Ice)").
function skillMarks(inner) {
    const marks = {};
    let rest = String(inner ?? '').replace(/(\d+)\s*(?:\/|of)\s*\d+(?:\s*uses?)?/i, (_, done) => {
        marks.progress = Number(done);
        return ' ';
    });
    rest = rest.replace(/\bmax(?:ed|imum)?\b/i, () => {
        marks.max = true;
        return ' ';
    });
    rest = rest.replace(/(?:\b(?:lv|lvl|level|mastery)\.?\s*)?(\d+)/i, (_, level) => {
        marks.mastery = Number(level);
        return ' ';
    });
    return Object.keys(marks).length && /^[\s,;·]*$/.test(rest) ? marks : null;
}

/**
 * The skills of a Skills (or Set aside) line: [{ name, mastery, progress }], `progress` being
 * the uses toward the next mastery as written, or null when the line does not say (an older
 * line, a skill at the top). Lenient: `Name`, `Name (Lv 2)`, `Name Lv 2`, `Name (Lv 2, 3/12)`,
 * `Name Lv 2 (3/12)`, `Name (Lv 5, max)`.
 */
function parseSkills(value, rules) {
    if (isNone(value)) return [];
    const skills = [];
    for (const part of skillParts(value)) {
        let name = part;
        let mastery = null;
        let progress = null;
        for (let bracket = name.match(/\(([^()]*)\)\s*$/); bracket; bracket = name.match(/\(([^()]*)\)\s*$/)) {
            const marks = skillMarks(bracket[1]);
            if (!marks) break;
            mastery = marks.mastery ?? mastery;
            progress = marks.progress ?? progress;
            name = name.slice(0, bracket.index).trim();
        }
        const bare = name.match(/^(.*?)\s*\b(?:lv\.?|lvl\.?)\s*(\d+)\s*$/i);
        if (bare && mastery === null) [name, mastery] = [bare[1].trim(), Number(bare[2])];
        if (!name) continue;
        mastery = clamp(Number(mastery ?? 1) || 1, 1, rules.masteryMax);
        if (skills.some(skill => skillKey(skill.name) === skillKey(name))) continue;
        skills.push({ name, mastery, progress: mastery < rules.masteryMax && progress !== null ? Math.max(0, Math.round(progress)) : null });
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
 * The level and XP of a level line written in terms these rules do not know (the reader
 * changed or turned off their terms since): the line with the Points field is always
 * `<level name>: <level> | <xp name>: <progress> | Points: n`, so its first two segments are
 * taken as the level and the XP. "(Lv 24)" in the first one gives the exact level.
 */
function levelLineFields(lines, found) {
    for (const line of lines) {
        const segments = stripMarkup(line).split('|').map(part => part.trim());
        if (segments.length < 2 || !segments.some(part => /^points\s*:/i.test(part)) || /^points\s*:/i.test(segments[0])) continue;
        const valueOf = part => (part.includes(':') ? part.slice(part.indexOf(':') + 1).trim() : part);
        const lv = segments[0].match(/\(\s*lv\.?\s*(\d+)\s*\)/i)?.[1] ?? int(valueOf(segments[0]));
        if (lv === null || lv === undefined) return {};
        const out = { level: String(lv) };
        if (!('xp' in found) && segments[1].includes(':') && !/^points\s*:/i.test(segments[1])) out.xp = valueOf(segments[1]);
        return out;
    }
    return {};
}

/**
 * A sheet from the lines of one block or Party section; `found` also carries the fields a
 * caller handles itself (a Party section's Equipped line).
 */
function sheetFromLines(lines, rules, { name: givenName = null, label = 'Character' } = {}) {
    const found = {};
    for (const line of lines) {
        for (const { field, value } of fieldsOf(line, rules)) {
            // The first value wins: a repeated field is more likely a stray copy than a fix.
            if (!(field in found)) found[field] = value;
        }
    }
    if (!('level' in found)) Object.assign(found, levelLineFields(lines, found));
    const errors = [];
    const missing = (what, fallback) => errors.push(`${label}: no ${what}, using ${fallback}.`);
    const name = (givenName ?? found.name ?? '').trim();
    if (!name) missing('Name', 'an empty name');
    // "III (Lv 24)", "4", "Soul Class III": the exact level when written, else what the terms say.
    let level = 'level' in found ? parseLevelLabel(found.level, rules) ?? int(found.level) : null;
    if (level === null || level < 1) {
        if ('level' in found) errors.push(`${label}: Level "${found.level}" is not a number, using 1.`);
        else missing('Level', '1');
        level = 1;
    }
    level = Math.min(level, maxLevel(rules));
    const stats = {};
    for (const stat of STATS) {
        const value = int(found[stat]);
        if (value === null) missing(stat, String(rules.character.startStat));
        stats[stat] = value === null ? rules.character.startStat : Math.max(0, value);
    }
    // XP within the level (its first number, kept below the level's need), or MAX at the cap.
    const xp = level >= maxLevel(rules) ? 0 : Math.max(0, xpFromProgress(found.xp ?? '', level, rules));
    const points = Math.max(0, int(found.points) ?? 0);
    const pool = (field, max) => {
        const pair = parsePair(found[field]);
        if (!pair) missing(field.toUpperCase(), 'full');
        const top = pair?.max !== null && pair?.max !== undefined && pair.max >= 0 ? pair.max : max;
        return { cur: clamp(pair?.cur ?? top, 0, top), max: top };
    };
    const written = [
        ...parseSkills(found.skills, rules),
        ...parseSkills(found.aside, rules).map(skill => ({ ...skill, aside: true })),
    ];
    const sheet = {
        name,
        level,
        xp,
        points,
        hp: pool('hp', maxHp(stats, level, rules)),
        mp: pool('mp', maxMp(stats, level, rules)),
        stats,
        skills: activeWithin(written.map(({ progress: _, ...skill }) => skill), rules),
        conditions: parseConditions(found.conditions),
        // Each skill's uses toward its next mastery, as the line wrote them. A skill the line
        // gives no progress (an older block, written before 0.4.1) has no entry: it counts from 0,
        // and foldUses may still fill it in from an older chat's metadata.
        uses: Object.fromEntries(written.filter(skill => skill.progress !== null).map(skill => [skill.name, skill.progress])),
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
    if (!lines.some(line => fieldsOf(line, r).length)) return { sheet: null, errors: ['Character: no fields found.'] };
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

/**
 * The ids parseParty gives members with these names, in order: the slug of the name, "-2",
 * "-3"… for a repeat, never 'pc' (the Character's id in a fight). An id follows the name, so
 * a renamed member gets a new id; whoever renames must carry what is kept by id along.
 */
export function memberIds(names) {
    const taken = new Set(['pc']);
    return (names ?? []).map(name => {
        let id = slug(name);
        for (let n = 2; taken.has(id); n += 1) id = `${slug(name)}-${n}`;
        taken.add(id);
        return id;
    });
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

// `## Ren (you)`: the reader's own section. Whatever follows a bar is ignored, and an empty
// name (`## (you)`) says the character is being made anew, so an older Character block is not
// taken instead.
const YOU_HEADING = /^(.*?)\s*\(\s*you\s*\)\s*$/i;

function youHeading(text) {
    const head = stripMarkup(text.replace(/^\s*#{1,6}\s*/, '')).split('|')[0].trim();
    const match = head.match(YOU_HEADING);
    return match ? { name: match[1].trim() } : null;
}

function sectionsOf(text) {
    const sections = [];
    for (const line of blockLines(text)) {
        if (/^\s*#{1,6}\s+\S/.test(line)) sections.push({ heading: line, lines: [] });
        else if (sections.length) sections.at(-1).lines.push(line);
    }
    return sections;
}

function membersFrom(sections, r, errors) {
    const members = [];
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
        members.push({ id: null, name: heading.name, role: heading.role || 'companion', control, sheet, gear });
    }
    const ids = memberIds(members.map(member => member.name));
    members.forEach((member, index) => { member.id = ids[index]; });
    return members;
}

/** The Party block's companions as Members (the reader's "(you)" section is left out); never throws. */
export function parseParty(text, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const errors = [];
    const members = membersFrom(sectionsOf(text).filter(section => !youHeading(section.heading)), r, errors);
    return { members, errors };
}

/**
 * The whole Party block: { pc: Sheet | null, members, you, errors }. `you` says whether the
 * block has the reader's section at all (an older Party block has none, and its character is
 * in the old Character block); `pc` is null for `## (you)` with no name, a character being
 * made anew. The first "(you)" section counts; never throws.
 */
export function parsePartyBlock(text, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const sections = sectionsOf(text);
    const errors = [];
    const mine = sections.find(section => youHeading(section.heading));
    let pc = null;
    if (mine) {
        const { name } = youHeading(mine.heading);
        if (name && mine.lines.some(line => fieldsOf(line, r).length)) {
            const read = sheetFromLines(mine.lines, r, { name, label: `Party (${name}, you)` });
            pc = read.sheet;
            errors.push(...read.errors);
        }
    }
    const members = membersFrom(sections.filter(section => !youHeading(section.heading)), r, errors);
    return { pc, members, you: Boolean(mine), errors };
}

/**
 * The sheets from the kept blocks: the Party block (`party`), and an older chat's separate
 * Character block (`character`) for the reader's sheet when the Party block has no "(you)"
 * section, or when that Character copy is the newer one (a chat played on with an older RPG
 * Battle). `partyIndex` / `characterIndex` are the messages the copies are in, when known.
 * { pc, members, legacy }: `legacy` is true while the reader's sheet comes from the old block
 * (the next write makes them one).
 */
export function readSheets({ party = '', character = '', partyIndex = null, characterIndex = null } = {}, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const block = String(party ?? '').trim() ? parsePartyBlock(party, r) : { pc: null, members: [], you: false };
    const older = String(character ?? '').trim() ? parseCharacter(character, r).sheet : null;
    const newer = older && block.you && Number.isFinite(characterIndex) && Number.isFinite(partyIndex) && characterIndex > partyIndex;
    if (older && (!block.you || newer)) return { pc: older, members: block.members, legacy: true };
    return { pc: block.pc, members: block.members, legacy: false };
}

/**
 * An older chat's mastery progress folded into the sheets read from its block. RPG Battle 0.4.0
 * and older kept it in chat metadata (`{ [memberId]: { [skill]: n } }`, 'pc' for yours), out of
 * the block; since 0.4.1 the Skills line carries it. A skill whose line gives no progress takes
 * the old value; one whose line gives any keeps the line's, so once the sheets are written again
 * the metadata has nothing left to add. { pc, members, folded }: `folded` says whether any
 * skill took a value from it. The sheets passed in are not changed.
 */
export function foldUses({ pc = null, members = [] } = {}, uses = {}, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    let folded = false;
    const fold = (sheet, id) => {
        const old = uses?.[id];
        if (!sheet || !old || typeof old !== 'object') return sheet;
        const next = copySheet(sheet);
        for (const skill of next.skills) {
            if (skill.mastery >= r.masteryMax || skill.name in next.uses) continue;
            const entry = Object.entries(old).find(([name]) => skillKey(name) === skillKey(skill.name));
            const n = Math.round(Number(entry?.[1]) || 0);
            if (n <= 0) continue;
            next.uses[skill.name] = n;
            folded = true;
        }
        return next;
    };
    const nextPc = fold(pc, 'pc');
    const nextMembers = (members ?? []).map(member => ({ ...member, sheet: fold(member.sheet, member.id) }));
    return { pc: nextPc, members: nextMembers, folded };
}

// ---------------------------------------------------------------------------------------
// Writing

// `Rending Strike (Lv 2, 3/12)`: the mastery and the uses toward the next level (the sheet's
// `uses`, 0 when it has none); `(Lv 5, max)` at the top. Rules without a number of uses for that
// level (none to reach) write the mastery alone.
function skillText(skill, sheet, rules) {
    if (skill.mastery >= rules.masteryMax) return `${skill.name} (Lv ${skill.mastery}, max)`;
    const needed = Number(rules.masteryUses?.[skill.mastery]);
    if (!(needed > 0)) return `${skill.name} (Lv ${skill.mastery})`;
    const done = Math.max(0, Math.round(Number(sheet.uses?.[skill.name]) || 0));
    return `${skill.name} (Lv ${skill.mastery}, ${done}/${needed})`;
}

// The Skills line holds the skills in use; the ones set aside get a line of their own, only
// when there are any, so the model knows they exist but not that they are at hand.
function skillsLines(sheet, rules) {
    const text = skill => skillText(skill, sheet, rules);
    const active = activeSkills(sheet).map(text);
    const aside = (sheet.skills ?? []).filter(skill => skill?.aside).map(text);
    return [`Skills: ${active.length ? active.join(' | ') : 'none'}`, ...(aside.length ? [`Set aside: ${aside.join(' | ')}`] : [])];
}

function conditionsText(sheet) {
    const list = (sheet.conditions ?? []).map(condition => (condition.rounds ? `${condition.name} (${condition.rounds})` : condition.name));
    return list.length ? list.join(', ') : 'none';
}

function statsLine(sheet) {
    return STATS.map(stat => `${stat}: ${sheet.stats?.[stat] ?? 0}`).join(' | ');
}

// `Level: 4 | XP: 31/100 | Points: 2`, in the reader's terms. With tiers the level field
// is the tier and the exact level (`Soul Class: III (Lv 24)`), with a colon so Story Block's
// Fields display reads it as the level field. XP shows MAX at the cap.
function levelLine(sheet, rules) {
    const terms = termsOf(rules);
    const level = terms.tiers ? `${levelLabelValue(sheet.level, rules)} (Lv ${sheet.level})` : String(sheet.level);
    return `${terms.levelName}: ${level} | ${terms.xpName}: ${progress(sheet, rules).text} | Points: ${sheet.points}`;
}

// The tier part of a level label ("III" of "Soul Class III").
function levelLabelValue(level, rules) {
    const terms = termsOf(rules);
    return numeralFor(Math.ceil(Math.min(level, terms.cap) / terms.tiers.size), terms.tiers.numerals);
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
        ...skillsLines(sheet, r),
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
            ...skillsLines(sheet, r),
        ];
        if (sheet.conditions?.length) lines.push(`Conditions: ${conditionsText(sheet)}`);
        if (member.gear?.length) lines.push(`Equipped: ${member.gear.map(formatGearEntry).join(' | ')}`);
        return lines.join('\n');
    }).join('\n\n');
}

/**
 * The canonical Party block: the reader's section first (`## Ren (you)` with the Character
 * block's lines, Checks included, since the Dice block reads them there), then each companion
 * as formatParty writes them. With no character (being made anew) the section is `## (you)`
 * with one line, so an older Character block is not read in its place.
 */
export function formatPartyBlock(pc, members, rules = DEFAULT_RULES) {
    const r = rulesOf(rules);
    const mine = pc
        ? [`## ${pc.name} (you)`, ...formatCharacter(pc, r).split('\n').filter(line => !/^Name:/.test(line))].join('\n')
        : '## (you)\nNo character yet.';
    const companions = formatParty(members ?? [], r);
    return companions ? `${mine}\n\n${companions}` : mine;
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
    for (const skill of skills ?? []) sheet = learnSkill(sheet, typeof skill === 'string' ? skill : skill?.name, { rules: r });
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

/**
 * A skill added at mastery 1; a name already known (any case) changes nothing. At the cap of
 * skills in use (activeCap) something must sit out: `setAside` names it, an active skill or
 * the new one itself (kept, set aside); without it the call throws, so the reader is asked.
 */
export function learnSkill(sheet, name, { rules = DEFAULT_RULES, setAside = null } = {}) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new Error('Learn skill: a name is needed.');
    const next = copySheet(sheet);
    if (next.skills.some(skill => skillKey(skill.name) === skillKey(trimmed))) return next;
    const cap = activeCap(rulesOf(rules));
    if (activeSkills(next).length < cap) {
        next.skills.push({ name: trimmed, mastery: 1 });
    } else if (setAside && skillKey(setAside) === skillKey(trimmed)) {
        next.skills.push({ name: trimmed, mastery: 1, aside: true });
    } else {
        const out = next.skills.find(skill => !skill.aside && skillKey(skill.name) === skillKey(setAside));
        if (!out) throw new Error(`${sheet.name || 'They'} already use ${cap} skills: choose one to set aside.`);
        out.aside = true;
        next.skills.push({ name: trimmed, mastery: 1 });
    }
    next.skills = activeWithin(next.skills, rules);
    return next;
}

/**
 * A known skill put in use (`active`) or set aside. Setting aside is always allowed; putting
 * one in use at the cap throws (set another aside first). An unknown name throws.
 */
export function setSkillActive(sheet, name, active, rules = DEFAULT_RULES) {
    const next = copySheet(sheet);
    const skill = next.skills.find(entry => skillKey(entry.name) === skillKey(name));
    if (!skill) throw new Error(`${sheet.name || 'They'} do not know ${name}.`);
    if (active && skill.aside) {
        const cap = activeCap(rulesOf(rules));
        if (activeSkills(next).length >= cap) throw new Error(`${sheet.name || 'They'} already use ${cap} skills: set one aside first.`);
        delete skill.aside;
    } else if (!active) {
        skill.aside = true;
    }
    next.skills = activeWithin(next.skills, rules);
    return next;
}

function isCombatCondition(name) {
    const lower = String(name ?? '').trim().toLowerCase();
    return COMBAT_CONDITIONS.some(condition => lower.startsWith(condition));
}

/**
 * A fight's Result applied to one sheet: HP/MP and lasting conditions as the fight left
 * them, XP with level-ups (xp carries over), mastery from skill uses (the sheet's `uses`, the
 * progress its Skills line writes, carried over like XP).
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
    const cap = maxLevel(r);
    next.xp += Math.max(0, Math.round(Number(result?.xp?.[memberId]) || 0));
    while (next.level < cap && next.xp >= xpToNext(next.level, r)) {
        const before = { stats: next.stats, level: next.level };
        next.xp -= xpToNext(next.level, r);
        next.level += 1;
        levelsGained += 1;
        growPools(next, before, r);
    }
    // XP stops at the cap: the sheet shows MAX, and nothing piles up for a later, higher cap.
    if (next.level >= cap) next.xp = 0;
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
