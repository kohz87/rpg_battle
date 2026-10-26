// RPG Battle v2, a pinned ruleset's foe as an engine enemy (B4: "foeToEngine adapter"; contract §3 P05/P24). A pack's foe is
// { id, name, tier, level, stats, skills[ref], loot[{ def, chance 0..100 (v1's percent), qty }], loreTags }; the engine reads an enemy by its
// fields. The adapter is private (not a module API) and pure: `area` is Story Director's canonical AreaTier for the place
// (`world.areaTier`), never a number from the caller.
//
//   1. the area must have a tier (0..9): without one nothing can be bounded, and the foe is refused ('AREA');
//   2. the foe must be a well-formed record of the pack (stats 1..99, 1..3 skills, up to 8 loot rows, up to 8 tags) ('FOE');
//   3. its level may not pass the area's ceiling, min(99, 10 x (tier + 1)) ('LEVEL');
//   3b. its stats may not total more than the point-buy a player of its level could reach, 35 + 10 + 4 x (level - 1) (the level held to the
//      area's ceiling): a foe over it is refused, never clamped ('BUDGET'). INTERIM (lead decision) until the ruleset's authors publish a foe budget;
//   4. `allowedFoes`, when the area lists any, must name it ('FOE_NOT_ALLOWED'); `allowedTags`, when it lists any, must name every
//      one of its lore tags ('TAG_NOT_ALLOWED'). An empty list says nothing (contract: only an unknown place has "empty lists" and no tier);
//   5. every skill is a skill of the ruleset with a base form, every loot row an item with a complete definition ('REF').
//
// Then the numbers are the player's own formulas with no gear (combatantFromSheet: pools, attack, defence, crit), the skills are the
// frozen base forms (formSkill, mastery 0), and the loot rows are the pack's, with their chances and quantities; the foe's XP is the
// engine's (foeXpWorth: the level gap against each member), so nothing is stored here for it. The id is `fo_` + the ordinal, the same
// record id the setup gives every enemy.

import { combatantFromSheet } from '../../party.js';
import { formSkill } from './forms.js';
import { levelCeiling, STATS } from '../rules/bounds.js';
import { isObject } from '../rules/ids.js';

const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const text = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max;
/** The most a foe's seven stats may total at `level`: the player's point-buy (7 stats at the start value 5, 10 starting points, 4 a level). Interim. */
export const foeStatBudget = level => 35 + 10 + 4 * (level - 1);
const refuse = (code, why) => ({ ok: false, code, why });
const foeRecord = ordinal => `fo_${String(ordinal).padStart(8, '0')}`;

/** Why `foe` is not a record of a pack (stats, skills, loot and tags within the schema's bounds), or '' when it is. */
function shapeProblem(foe) {
    if (!isObject(foe) || !text(foe.id, 160) || !text(foe.name, 120)) return 'A foe has an id and a name.';
    if (!int(foe.tier, 0, 9) || !int(foe.level, 1, 99)) return 'A foe has a tier 0 to 9 and a level 1 to 99.';
    if (!isObject(foe.stats) || STATS.some(stat => !int(foe.stats[stat], 1, 99))) return 'A foe has the seven stats, each 1 to 99.';
    if (!Array.isArray(foe.skills) || foe.skills.length < 1 || foe.skills.length > 3 || new Set(foe.skills).size !== foe.skills.length || !foe.skills.every(ref => text(ref, 160))) return 'A foe has one to three different skills.';
    if (!Array.isArray(foe.loot) || foe.loot.length > 8 || !foe.loot.every(row => isObject(row) && text(row.def, 160) && int(row.chance, 0, 100) && int(row.qty, 1, 99))) return 'A foe has up to eight loot rows of { def, chance 0 to 100, qty 1 to 99 }.';
    if (!Array.isArray(foe.loreTags) || foe.loreTags.length > 8 || !foe.loreTags.every(tag => text(tag, 40))) return 'A foe has up to eight lore tags of 1 to 40 characters.';
    return '';
}

/**
 * foe, { rules (the fight's), forms (the pinned index), items (ref -> complete ItemDef or null), area (AreaTier), ordinal (1-based) }
 * -> { ok: true, enemy } | { ok: false, code: 'AREA' | 'FOE' | 'LEVEL' | 'BUDGET' | 'FOE_NOT_ALLOWED' | 'TAG_NOT_ALLOWED' | 'REF', why }.
 */
export function foeToEngine(foe, { rules, forms, items, area, ordinal } = {}) {
    if (!isObject(area) || !int(area.tier, 0, 9)) return refuse('AREA', 'The place has no tier, so no foe can be bounded.');
    const bad = shapeProblem(foe);
    if (bad) return refuse('FOE', bad);
    if (!int(ordinal, 1, 99999999)) return refuse('FOE', 'A foe has an ordinal from 1.');
    const ceiling = levelCeiling(area.tier);
    if (foe.level > ceiling) return refuse('LEVEL', `A tier ${area.tier} place holds foes to level ${ceiling}, not ${foe.level}.`);
    const total = STATS.reduce((sum, stat) => sum + foe.stats[stat], 0);
    const room = foeStatBudget(Math.min(foe.level, ceiling));
    if (total > room) return refuse('BUDGET', `${foe.name}'s stats total ${total}; a level ${foe.level} foe may total ${room}.`);
    const foes = Array.isArray(area.allowedFoes) ? area.allowedFoes : [];
    if (foes.length && !foes.includes(foe.id) && !foes.includes(baseFoeRef(foe.id))) return refuse('FOE_NOT_ALLOWED', `${foe.name} is not among the foes this place allows.`);
    const tags = Array.isArray(area.allowedTags) ? area.allowedTags : [];
    const stray = tags.length ? foe.loreTags.find(tag => !tags.includes(tag)) : undefined;
    if (stray !== undefined) return refuse('TAG_NOT_ALLOWED', `${foe.name} has the lore tag "${stray}", which this place does not allow.`);

    const skills = [];
    for (const ref of foe.skills) {
        const base = forms?.skill?.(ref) ? forms.baseForm(ref) : null;
        const form = base ? forms.form(base) : null;
        if (!form) return refuse('REF', `${foe.name}'s skill ${ref} is not a skill of this ruleset.`);
        skills.push({ ...formSkill(form, 0, forms), cooldownLeft: 0 });
    }
    const loot = [];
    for (const row of foe.loot) {
        const def = typeof items === 'function' ? items(row.def) : null;
        if (!isObject(def) || typeof def.name !== 'string') return refuse('REF', `${foe.name}'s loot ${row.def} is not an item with a definition.`);
        loot.push({
            def: row.def, name: def.name, kind: def.kind ?? 'goods', rarity: def.rarity ?? 'common', stats: { ...(def.stats ?? {}) },
            ...(isObject(def.effect) && Object.keys(def.effect).length ? { effect: structuredClone(def.effect) } : {}),
            ...(Array.isArray(def.tags) && def.tags.length ? { tags: [...def.tags] } : {}),
            chance: row.chance, qty: [row.qty, row.qty],
        });
    }

    const fighter = combatantFromSheet({ name: foe.name, level: foe.level, stats: { ...foe.stats }, skills: [], conditions: [] }, { memberId: foeRecord(ordinal), controller: 'auto', gear: [], items: [], library: [], rules });
    const base = rules?.enemy ?? {};
    const enemy = {
        ...fighter,
        id: foeRecord(ordinal),
        memberId: null,
        side: 'enemy',
        controller: 'auto',
        rank: null,
        role: null,
        boss: false,
        skills,
        items: [],
        conditions: [],
        morale: Number.isFinite(base.moraleBase) ? base.moraleBase : 2,
        talks: false,
        fleesBelow: Number.isFinite(base.fleesBelow) ? base.fleesBelow : 0.25,
        xp: 0,
        loot,
        coins: false,
        gone: null,
        capped: [],
        onHit: [],
        pack: foe.id,
    };
    return { ok: true, enemy };
}

/** Variant identity is derived only from an explicit base binding and a normalized name. */
export const variantSlug = name => String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const isFoeRef = ref => typeof ref === 'string' && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[_-][a-z0-9]+)*(?:~[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(ref);
export const baseFoeRef = ref => String(ref ?? '').split('~')[0];
export const matchesFoe = (objective, ref) => ref === objective.foe || objective.allowVariants === true && !objective.foe.includes('~') && baseFoeRef(ref) === objective.foe;

/** Scale the base's level position within its ten-level tier band, and each stat by the budget ratio.
 * No points are redistributed: an over-budget or out-of-bounds result is refused, never clamped.
 */
export function foeVariant(base, name, area) {
    const bad = shapeProblem(base);
    if (bad) return refuse('FOE', bad);
    if (!int(area?.tier, 0, 9)) return refuse('AREA', 'The place has no tier for this variant.');
    const slug = variantSlug(name);
    if (!text(name, 120) || !slug || slug.length > 80) return refuse('FOE', 'A variant needs a name with a stable slug.');
    const level = base.level + 10 * (area.tier - base.tier);
    if (!int(level, 1, levelCeiling(area.tier))) return refuse('LEVEL', 'This base cannot scale into the area level band.');
    const stats = Object.fromEntries(STATS.map(stat => [stat, Math.ceil(base.stats[stat] * foeStatBudget(level) / foeStatBudget(base.level))]));
    if (STATS.some(stat => !int(stats[stat], 1, 99)) || Object.values(stats).reduce((a, b) => a + b, 0) > foeStatBudget(level)) return refuse('BUDGET', 'This variant cannot fit the area stat budget.');
    if (base.stats && Object.values(base.stats).reduce((a, b) => a + b, 0) > foeStatBudget(base.level)) return refuse('BUDGET', 'The base foe exceeds its stat budget.');
    if (area.allowedFoes?.length && !area.allowedFoes.includes(base.id) && !area.allowedFoes.includes(`${base.id}~${slug}`)) return refuse('FOE_NOT_ALLOWED', 'The area does not allow this base or variant.');
    if (area.allowedTags?.length && base.loreTags.some(tag => !area.allowedTags.includes(tag))) return refuse('TAG_NOT_ALLOWED', 'The area does not allow this variant’s tags.');
    return { ok: true, foe: { ...structuredClone(base), id: `${base.id}~${slug}`, name, tier: area.tier, level, stats } };
}
