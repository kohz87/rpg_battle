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

import { DEFAULT_RULES, STATS, clampXpRate, makeRules, maxHp, maxMp, maxSp, xpToNext } from '../../rules.js';
import { DEFAULT_SKILLS } from '../../skills.js';
import { CONDITION_KINDS, conditionKind } from '../../combat.js';
import { STEPS_KEPT, fitActor, levelSteps, stepKey, storedPool } from './pools.js';

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
    // MODULES §F105: the world's words for XP and levels (blank: the pack's, else XP and Level).
    xpName: '',
    levelName: '',
    // terms2: the world's rank ladder (one `{ rank }` a line) and how many levels a rank spans (0: spread
    // to the level cap). Handed to Story Block by the `ranks.reader` hook (terms.js readerLadderLines).
    ranks: Object.freeze([]),
    levelsPerRank: 0,
});

// The Levels per rank help; the module adds the ladder's preview after it (module.js, terms.js ladderPreview).
export const LEVELS_PER_RANK_HELP = 'How many levels one rank spans when a ladder line gives no first level: 10 makes Soul Class I levels 1-10 and II 11-20. A line\'s own first level wins.';

export const SETTINGS_SCHEMA = Object.freeze({
    startPoints: { type: 'int', min: 0, max: 60, label: 'Points a new character spends' },
    statCap: { type: 'int', min: 0, max: 999, label: 'Highest a stat goes with points (0: no cap)' },
    pointsPerLevel: { type: 'int', min: 1, max: 20, label: 'Stat points per level' },
    xpBase: { type: 'int', min: 10, max: 10000, label: 'XP each level needs' },
    maxLevel: { type: 'int', min: 1, max: 999, label: 'Level cap' },
    activeSkills: { type: 'int', min: 3, max: 12, label: 'Skills each member fights with' },
    autoSpend: { type: 'bool', label: 'Companions on auto spend their points by build' },
    maxCompanions: { type: 'int', min: 0, max: 12, label: 'Companions beside you at most' },
    // Folded into `terms` for every part (src/v2/module.js, terms.js foldReaderTerms).
    xpName: { type: 'text', group: 'Terms', max: 30, label: 'XP word (blank: the pack\'s, else XP)', help: 'What this world calls experience: "Soul Growth", "Power". Every screen, fight summary and note to the model uses it.' },
    levelName: { type: 'text', group: 'Terms', max: 30, label: 'Level word (blank: the pack\'s, else Level)', help: 'What this world calls a level: "Soul Class", "Circle".' },
    ranks: {
        type: 'list', group: 'Terms', label: 'Rank ladder (lowest first)', form: 'lines',
        of: { rank: { type: 'text', label: 'Rank', max: 40 } },
        help: 'The ranks of this world, one per line from lowest to highest: "Soul Class I" to "Soul Class IX", or F, E, D, C, B, A, S, SS, SSS. A line may give its first level ("Soul Class II: 11"). Quest ranks, foe ranks, the party\'s rank and a fight\'s tier all use it. Empty: the pack\'s ladder, else the built-in F to S.',
    },
    levelsPerRank: { type: 'int', group: 'Terms', min: 0, max: 999, label: 'Levels per rank (0: spread to the level cap)', help: LEVELS_PER_RANK_HELP },
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

/** An actor record as a v1 Sheet (a fresh copy), its numbers as they stand now (pools.js fitActor). */
export function toSheet(record) {
    const actor = fitActor(record);
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
        // A fight-left condition keeps its own rounds (and the story minute the fight ended, `at`).
        conditions: (actor?.conditions ?? []).map(entry => ({
            name: entry.kind,
            rounds: Number.isInteger(entry.rounds) && entry.rounds >= 1 ? entry.rounds : isCombatCondition(entry.kind) && entry.stacks > 1 ? entry.stacks : null,
            ...(Number.isInteger(entry.at) ? { at: entry.at } : {}),
        })),
        uses: Object.fromEntries((actor?.skills ?? []).filter(skill => skill.uses > 0).map(skill => [skill.name, skill.uses])),
    };
}

const int = (value, min = 0) => Math.max(min, Math.round(Number(value) || 0));

/**
 * The fields a v1 Sheet sets on an actor record (id, kind, control, role and npc stay the actor's).
 * HP, MP and SP are stored with `lost` (pools.js storedPool), so a replay after a deleted reply adds
 * this change to what is there; the pools in `filled` (a rest's, pools.js filledBy) are stored full,
 * without `lost`.
 */
export function fromSheet(actor, sheet, rules = DEFAULT_RULES, { filled = [], at = null } = {}) {
    const top = rules.masteryMax ?? DEFAULT_RULES.masteryMax;
    const pool = (name, entry) => storedPool(entry, { full: filled.includes(name) });
    const level = int(sheet.level, 1);
    const xp = int(sheet.xp);
    return {
        ...withoutSteps(actor),
        ...levelBook(actor, sheet, level, xp, rules),
        name: String(sheet.name ?? actor.name),
        level,
        xp,
        // Unspent points below 0 are owed (pools.js): kept, and paid first by the next level's points.
        points: Math.round(Number(sheet.points) || 0),
        hp: pool('hp', sheet.hp),
        mp: pool('mp', sheet.mp),
        sp: pool('sp', sheet.sp ?? fitActor(actor).sp),
        stats: Object.fromEntries(STATS.map(stat => [stat, int(sheet.stats?.[stat])])),
        skills: (sheet.skills ?? []).map(skill => {
            const level = Math.min(top, int(skill.mastery, 1));
            return { name: skill.name, level, uses: level >= top ? 0 : int(sheet.uses?.[skill.name]), active: !skill.aside };
        }),
        conditions: mergeConditions((sheet.conditions ?? []).flatMap(entry => conditionRecord(entry, at))),
    };
}

const withoutSteps = actor => Object.fromEntries(Object.entries(actor ?? {}).filter(([key]) => !/^up\d{1,4}$/.test(key)));

/**
 * The XP book a sheet's write keeps (pools.js, confirm C-2): the level steps kept (`up<N>`: the latest
 * STEPS_KEPT up to the level, one added for each level this write reached: the XP it took, the points
 * and the pool growth it gave) and `earned` (the XP shown plus what the kept steps took).
 */
function levelBook(actor, sheet, level, xp, rules) {
    const before = fitActor(actor);
    const steps = new Map(levelSteps(before, level));
    const was = Math.max(1, int(before?.level, 1));
    const per = rules?.character?.pointsPerLevel ?? DEFAULT_RULES.character.pointsPerLevel;
    // Only a member who was there before levels up (a new or imported one starts at its level).
    for (let reached = was + 1; reached <= level && Number.isInteger(actor?.level); reached += 1) {
        const stats = sheet.stats ?? before.stats ?? {};
        steps.set(reached, {
            xp: xpToNext(reached - 1, rules),
            points: per,
            hp: Math.max(0, maxHp(stats, reached, rules) - maxHp(stats, reached - 1, rules)),
            mp: Math.max(0, maxMp(stats, reached, rules) - maxMp(stats, reached - 1, rules)),
            sp: Math.max(0, maxSp(stats, reached, rules) - maxSp(stats, reached - 1, rules)),
        });
    }
    const kept = [...steps].filter(([at]) => at > level - STEPS_KEPT).sort((a, b) => a[0] - b[0]);
    return {
        earned: xp + kept.reduce((sum, [, step]) => sum + step.xp, 0),
        ...Object.fromEntries(kept.map(([at, step]) => [stepKey(at), { ...step }])),
    };
}

/**
 * A v1 sheet condition as a party record (MODULES §B1 `{ kind, stacks }`). One a fight left (a fight
 * condition with rounds, B-c1-1) keeps those `rounds`, so the next fight starts it with what was left
 * and not a story's usual 3, and `at`, the story minute the fight ended (`at` given, else its own), so
 * it wears off with story time (pools.js fitActor); one at 0 rounds is over and is not kept. A story's
 * condition (no rounds) is stacks 1, as before.
 */
function conditionRecord(entry, at) {
    const kind = conditionKind(entry?.name);
    const rounds = entry?.rounds === null || entry?.rounds === undefined ? null : Math.round(Number(entry.rounds));
    if (!isCombatCondition(entry?.name) || rounds === null || !Number.isFinite(rounds)) return [{ kind, stacks: int(entry?.rounds, 1) }];
    if (rounds < 1) return [];
    const when = Number.isInteger(entry?.at) ? entry.at : Number.isInteger(at) ? at : null;
    return [{ kind, stacks: rounds, rounds, ...(when === null ? {} : { at: when }) }];
}

// A kind written twice (a fight's "poison" over a story's "poisoned") is one condition, the most stacks
// (and the most rounds left, from the later fight).
function mergeConditions(list) {
    const out = [];
    for (const entry of list) {
        if (!entry.kind) continue;
        const same = out.find(other => other.kind.toLowerCase() === entry.kind.toLowerCase());
        if (!same) { out.push(entry); continue; }
        same.stacks = Math.max(same.stacks, entry.stacks);
        if (Number.isInteger(entry.rounds)) same.rounds = Math.max(same.rounds ?? 0, entry.rounds);
        if (Number.isInteger(entry.at)) same.at = Math.max(same.at ?? entry.at, entry.at);
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
