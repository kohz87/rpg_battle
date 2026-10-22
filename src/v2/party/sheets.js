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
import { CONDITION_KINDS, conditionKind } from '../../combat.js';

// The reader's 'Character' settings (MODULES §A settings): v1's reader-tunable character rules.
export const SETTINGS_DEFAULTS = Object.freeze({
    startPoints: DEFAULT_RULES.character.startPoints,
    statCap: DEFAULT_RULES.character.statCap,
    pointsPerLevel: DEFAULT_RULES.character.pointsPerLevel,
    xpBase: DEFAULT_RULES.character.xpBase,
    maxLevel: DEFAULT_RULES.character.maxLevel,
    activeSkills: DEFAULT_RULES.character.activeSkills,
    autoSpend: true,
    // MODULES §F48: you and this many companions at most.
    maxCompanions: 3,
});

export const SETTINGS_SCHEMA = Object.freeze({
    startPoints: { type: 'int', min: 0, max: 60, label: 'Points a new character spends' },
    statCap: { type: 'int', min: 0, max: 999, label: 'Highest a stat goes with points (0: no cap)' },
    pointsPerLevel: { type: 'int', min: 1, max: 20, label: 'Stat points per level' },
    xpBase: { type: 'int', min: 10, max: 10000, label: 'XP each level needs' },
    maxLevel: { type: 'int', min: 1, max: 999, label: 'Level cap' },
    activeSkills: { type: 'int', min: 3, max: 12, label: 'Skills each member fights with' },
    autoSpend: { type: 'bool', label: 'Companions on auto spend their points by build' },
    maxCompanions: { type: 'int', min: 0, max: 12, label: 'Companions beside you at most' },
});

const COMBAT_CONDITIONS = ['poison', 'burn', 'bleed', 'stun', 'slow', 'weaken', 'shield', 'regen', 'guard'];

// The one table from the fight's condition names to the kinds a party record keeps (MODULES
// §B1: `poisoned`) lives in v1's combat.js, shared with the combat part.
export { CONDITION_KINDS, conditionKind };
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
        conditions: mergeConditions((sheet.conditions ?? []).map(entry => ({ kind: conditionKind(entry.name), stacks: int(entry.rounds, 1) }))),
    };
}

// A kind written twice (a fight's "poison" over a story's "poisoned") is one condition, the most stacks.
function mergeConditions(list) {
    const out = [];
    for (const entry of list) {
        if (!entry.kind) continue;
        const same = out.find(other => other.kind.toLowerCase() === entry.kind.toLowerCase());
        if (same) same.stacks = Math.max(same.stacks, entry.stacks);
        else out.push(entry);
    }
    return out;
}

/** v1's member control word for an actor ('command' for a companion the reader commands). */
export const v1Control = actor => (actor?.control === 'player' ? 'command' : 'auto');

/**
 * How a companion's stat points are spent (MODULES §F29): 'auto' (by build, when the setting
 * allows) or 'manual' (the reader spends them). A record from before the toggle has none: it
 * keeps what v1's control word meant, a companion the reader commands spends by hand.
 */
export const growthOf = actor => (actor?.growth === 'manual' || actor?.growth === 'auto' ? actor.growth : actor?.control === 'player' ? 'manual' : 'auto');

/** The most companions beside your character (MODULES §F48), from the Character settings. */
export function maxCompanionsOf(settings) {
    return whole(settingsOf(settings).maxCompanions, SETTINGS_DEFAULTS.maxCompanions, 0, 12);
}

const V1_SLOTS = ['weapon', 'offhand', 'armour', 'worn', 'accessory'];

/**
 * The equipped stacks `owner` has in Story Block's inventory domain (and the shared bag's when
 * `owner` is your character, `pc`), as v1 Items
 * ({ name, equipped, slot, rarity, stats, tags }) that items.gearBonuses counts.
 */
export function gearOf(inventory, owner, { pc = null } = {}) {
    const out = [];
    for (const stack of Object.values(inventory?.stacks ?? {})) {
        // The shared bag's worn pieces are your character's (the items part's wearer rule).
        const worn = stack?.owner === owner || (stack?.owner === 'party' && owner && owner === pc);
        if (!stack || !worn || !stack.equipped) continue;
        const def = inventory?.defs?.[stack.def];
        if (!def) continue;
        const slot = V1_SLOTS.includes(stack.equipped) ? stack.equipped : V1_SLOTS.includes(def.slot) ? def.slot : null;
        if (!slot) continue;
        out.push({ name: def.name, equipped: true, slot, rarity: def.rarity ?? 'common', stats: { ...(def.stats ?? {}) }, tags: [...(def.tags ?? [])], qty: stack.qty });
    }
    // In the inventory's own key order: v1 counts the first equipped piece per slot.
    return out;
}

/**
 * What `owner` wears as the items part counts it, as v1 Items: the items part's `items.gear`
 * (through `query`: the pieces it counts, with their stats as it gives them: capped at the
 * wearer's level, and with the items part's wear and refinement where it has them; broken pieces
 * left out) marked `final`, else, without the items part, gearOf on the inventory.
 */
export function wornGear(query, inventory, owner, { pc = null } = {}) {
    let listed = null;
    if (typeof query === 'function' && owner) {
        try {
            listed = query('items.gear', { actor: owner });
        } catch {
            listed = null;
        }
    }
    const counted = Array.isArray(listed) ? listed : Array.isArray(listed?.counted) ? listed.counted : null;
    if (!counted) return gearOf(inventory, owner, { pc });
    return counted.filter(row => row && row.name && V1_SLOTS.includes(row.slot)).map(row => {
        const def = inventory?.defs?.[inventory?.stacks?.[row.stack]?.def];
        return {
            name: row.name, equipped: true, slot: row.slot, rarity: row.rarity ?? 'common', stats: { ...(row.stats ?? {}) },
            tags: [...(Array.isArray(row.tags) ? row.tags : def?.tags ?? [])], qty: 1, final: true, ...(row.stack ? { stack: row.stack } : {}),
        };
    });
}
