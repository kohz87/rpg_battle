// The party part's bridge to v1's pure rules: a v2 actor record (MODULES §B1) as the v1 Sheet
// that sheet.js, growth.js, recovery.js and story.js work on, and back; the rules object built
// from the reader's 'Character' settings; the skill library (v1's plus the story-taught skills
// kept in party.custom); and the equipped gear an actor wears, read from Story Block's
// inventory domain (SPEC §7) in the shape v1's items.js counts. Pure.
//
// The two shapes differ only in naming: a skill's `level` is v1's mastery, its `uses` v1's
// progress toward the next mastery (`sheet.uses[name]`), `active: false` v1's `aside: true`; a
// condition's `kind` is v1's name and its `stacks` the rounds a fight left on it (a story
// condition, which has no rounds in v1, is stacks 1, and stacks 1 reads back as no rounds: the
// v1 rules this part calls go by a condition's name, never its rounds).

import { DEFAULT_RULES, STATS, clampXpRate, makeRules } from '../../rules.js';
import { DEFAULT_SKILLS } from '../../skills.js';

// The reader's 'Character' settings (MODULES §A settings): v1's reader-tunable character rules.
export const SETTINGS_DEFAULTS = Object.freeze({
    startPoints: DEFAULT_RULES.character.startPoints,
    statCap: DEFAULT_RULES.character.statCap,
    pointsPerLevel: DEFAULT_RULES.character.pointsPerLevel,
    xpBase: DEFAULT_RULES.character.xpBase,
    maxLevel: DEFAULT_RULES.character.maxLevel,
    activeSkills: DEFAULT_RULES.character.activeSkills,
    autoSpend: true,
});

export const SETTINGS_SCHEMA = Object.freeze({
    startPoints: { type: 'int', min: 0, max: 60, label: 'Points a new character spends' },
    statCap: { type: 'int', min: 0, max: 999, label: 'Highest a stat goes with points (0: no cap)' },
    pointsPerLevel: { type: 'int', min: 1, max: 20, label: 'Stat points per level' },
    xpBase: { type: 'int', min: 10, max: 10000, label: 'XP each level needs' },
    maxLevel: { type: 'int', min: 1, max: 999, label: 'Level cap' },
    activeSkills: { type: 'int', min: 3, max: 12, label: 'Skills each member fights with' },
    autoSpend: { type: 'bool', label: 'Companions on auto spend their points by build' },
});

const COMBAT_CONDITIONS = ['poison', 'burn', 'bleed', 'stun', 'slow', 'weaken', 'shield', 'regen', 'guard'];
const isCombatCondition = name => COMBAT_CONDITIONS.some(base => String(name ?? '').trim().toLowerCase().startsWith(base));

const whole = (value, fallback, min, max) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** The module's settings with the defaults under them, whether `source` is an object or ctx.settings / view.settings. */
export function settingsOf(source) {
    let raw = source;
    if (typeof raw === 'function') {
        try { raw = raw(); } catch { raw = null; }
    }
    return { ...SETTINGS_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

/**
 * v1 rules from the reader's settings: the Character fields over DEFAULT_RULES, and the XP rate
 * and display terms when another part of the module keeps them (`xpRate`, `terms`).
 */
export function rulesFrom(settings) {
    const s = settingsOf(settings);
    const d = SETTINGS_DEFAULTS;
    return makeRules({
        character: {
            startPoints: whole(s.startPoints, d.startPoints, 0, 60),
            statCap: whole(s.statCap, d.statCap, 0, 999),
            pointsPerLevel: whole(s.pointsPerLevel, d.pointsPerLevel, 1, 20),
            xpBase: whole(s.xpBase, d.xpBase, 10, 10000),
            maxLevel: whole(s.maxLevel, d.maxLevel, 1, 999),
            activeSkills: whole(s.activeSkills, d.activeSkills, 3, 12),
        },
        xpRate: clampXpRate(s.xpRate ?? DEFAULT_RULES.xpRate),
        ...(s.terms && typeof s.terms === 'object' ? { terms: { ...DEFAULT_RULES.terms, ...s.terms } } : {}),
    });
}

/** The skills a member can know: v1's library, then the story-taught ones kept in party.custom. */
export function libraryOf(party) {
    return [...DEFAULT_SKILLS, ...Object.values(party?.custom ?? {})];
}

/** An actor record as a v1 Sheet (a fresh copy). */
export function toSheet(actor) {
    const skills = (actor?.skills ?? []).map(skill => ({ name: skill.name, mastery: skill.level, ...(skill.active === false ? { aside: true } : {}) }));
    return {
        name: actor.name,
        level: actor.level,
        xp: actor.xp,
        points: actor.points,
        hp: { ...actor.hp },
        mp: { ...actor.mp },
        sp: { ...actor.sp },
        stats: { ...actor.stats },
        skills,
        conditions: (actor?.conditions ?? []).map(entry => ({ name: entry.kind, rounds: isCombatCondition(entry.kind) && entry.stacks > 1 ? entry.stacks : null })),
        uses: Object.fromEntries((actor?.skills ?? []).filter(skill => skill.uses > 0).map(skill => [skill.name, skill.uses])),
    };
}

const int = (value, min = 0) => Math.max(min, Math.round(Number(value) || 0));
const pool = entry => {
    const max = int(entry?.max);
    return { cur: Math.min(max, int(entry?.cur)), max };
};

/** The fields a v1 Sheet sets on an actor record (id, kind, control, role and npc stay the actor's). */
export function fromSheet(actor, sheet, rules = DEFAULT_RULES) {
    const top = rules.masteryMax ?? DEFAULT_RULES.masteryMax;
    return {
        ...actor,
        name: String(sheet.name ?? actor.name),
        level: int(sheet.level, 1),
        xp: int(sheet.xp),
        points: int(sheet.points),
        hp: pool(sheet.hp),
        mp: pool(sheet.mp),
        sp: pool(sheet.sp ?? actor.sp),
        stats: Object.fromEntries(STATS.map(stat => [stat, int(sheet.stats?.[stat])])),
        skills: (sheet.skills ?? []).map(skill => {
            const level = Math.min(top, int(skill.mastery, 1));
            return { name: skill.name, level, uses: level >= top ? 0 : int(sheet.uses?.[skill.name]), active: !skill.aside };
        }),
        conditions: (sheet.conditions ?? []).map(entry => ({ kind: String(entry.name), stacks: int(entry.rounds, 1) })),
    };
}

/** v1's member control word for an actor ('command' for a companion the reader commands). */
export const v1Control = actor => (actor?.control === 'player' ? 'command' : 'auto');

const V1_SLOTS = ['weapon', 'offhand', 'armour', 'worn', 'accessory'];

/**
 * The equipped stacks `owner` has in Story Block's inventory domain, as v1 Items
 * ({ name, equipped, slot, rarity, stats, tags }) that items.gearBonuses counts.
 */
export function gearOf(inventory, owner) {
    const out = [];
    for (const stack of Object.values(inventory?.stacks ?? {})) {
        if (!stack || stack.owner !== owner || !stack.equipped) continue;
        const def = inventory?.defs?.[stack.def];
        if (!def) continue;
        const slot = V1_SLOTS.includes(stack.equipped) ? stack.equipped : V1_SLOTS.includes(def.slot) ? def.slot : null;
        if (!slot) continue;
        out.push({ name: def.name, equipped: true, slot, rarity: def.rarity ?? 'common', stats: { ...(def.stats ?? {}) }, tags: [...(def.tags ?? [])], qty: stack.qty });
    }
    // In the inventory's own key order: v1 counts the first equipped piece per slot.
    return out;
}
