// RPG Battle v2, what a generated item may be (B3 "generation bounds"; contract §5 P05/P06/P25, §3 rules.registerItem). Pure.
//
// An item the story, a craft, a trade or a fight's loot brings in is not a pack's: its numbers come from words or from an
// adapter, so code holds them to a published budget and **rejects** (never clamps, never guesses) what exceeds it:
//
//   * the place's tier (0..9) comes from Story Director's `world.areaTier`, never from the caller; an unknown area refuses;
//   * level ceiling   min(99, 10 * (tier + 1))              the level its stat budget is read at
//   * rarity ceiling  tier 0-1 common, 2-3 uncommon, 4-6 rare, 7-9 epic;  a generated item is **never legendary**
//   * stat budget     rarityBudget(rarity, level ceiling)   >=  the cost of its stats (statCost per point; a negative point
//                     refunds negativeRefund of its cost, v1's rules unchanged), stats only on equipment, only the named stats
//   * effect          heal <= 250, mp <= 40, damage.amount <= 250, repair <= 50, cure up to 8 condition words; no other key, only
//                     on a consumable (the numbers a story's words were already held to, items/define.js STORY_EFFECT_MAX)
//   * rule            the ItemRule shape of the pack schema, and consistent with the def: a non-equipment item has no slots and
//                     no hands; a hand item (weapon/offhand) is held in 1 or 2 hands, two only with a weapon alone; the def's
//                     own slot is one of the rule's
//   * closure         a ruleset holds at most 1000 item rules, the packs' and the generated ones together
//
// The numbers below are v1's DEFAULT_RULES (src/rules.js), copied so that a later change of v1's tuning cannot move a running
// timeline; tests/v2/rules/bounds.test.js holds them equal and fails when they drift. Not decided here (written down as gaps in
// docs/dev/progress.md): a ceiling and floor for `value`, and a per-template budget (the pack schema has no generation template).

import { isDefId, isObject } from './ids.js';

export const SLOTS = Object.freeze(['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2']);
export const STATS = Object.freeze(['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA']);
export const KINDS = Object.freeze(['goods', 'material', 'consumable', 'equipment', 'quest', 'money']);
export const RARITIES = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);
export const GENERATED_PREFIXES = Object.freeze(['story', 'craft', 'trade']);
export const MAX_ITEM_RULES = 1000;

export const RARITY_BUDGET = Object.freeze({
    common: Object.freeze({ base: 2, perLevel: 0.5 }),
    uncommon: Object.freeze({ base: 4, perLevel: 0.8 }),
    rare: Object.freeze({ base: 6, perLevel: 1.2 }),
    epic: Object.freeze({ base: 9, perLevel: 1.6 }),
    legendary: Object.freeze({ base: 12, perLevel: 2 }),
});
export const STAT_COST = Object.freeze({ ATK: 1, MATK: 1, DEF: 1, MDEF: 1, HP: 0.2, MP: 0.25, STR: 2, VIT: 2, AGI: 2, DEX: 2, INT: 2, LUK: 2, CHA: 2, crit: 0.5 });
export const NEGATIVE_REFUND = 0.5;
export const EFFECT_MAX = Object.freeze({ heal: 250, mp: 40, damage: 250, repair: 50, cure: 8 });
const TARGETS = ['one', 'all'];

const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/** The level a generated item's budget is read at, from the place's tier. */
export const levelCeiling = tier => Math.min(99, 10 * (tier + 1));

/** The highest rarity a place of this tier yields (index into RARITIES). */
export const rarityCeiling = tier => (tier <= 1 ? 'common' : tier <= 3 ? 'uncommon' : tier <= 6 ? 'rare' : 'epic');

/** The stat budget of a rarity at a level (v1's rarityBudget with the frozen numbers). */
export function budgetOf(rarity, level) {
    const entry = RARITY_BUDGET[rarity] ?? RARITY_BUDGET.common;
    return entry.base + entry.perLevel * Math.max(1, level);
}

/** What stats cost against the budget: positive points at their price, negative ones refund part of it. */
export function spendOf(stats) {
    let cost = 0;
    for (const [name, value] of Object.entries(stats ?? {})) {
        const unit = STAT_COST[name] ?? 1;
        cost += value > 0 ? value * unit : value * unit * NEGATIVE_REFUND;
    }
    return cost;
}

const PLAIN_KEYS = ['id', 'name', 'kind', 'rarity', 'value', 'stack', 'slot', 'stats', 'effect', 'tags', 'note', 'carry'];

/** Whether the def is the closed ItemDef shape (contract §4): [] or sentences. Structure only. */
export function defShapeProblems(def) {
    if (!isObject(def)) return ['The definition is not a record.'];
    const errors = Object.keys(def).filter(key => !PLAIN_KEYS.includes(key)).map(key => `The definition has a field "${key}" that an item definition does not.`);
    if (!isDefId(def.id)) errors.push('The definition needs an id like story/bone-charm.');
    if (typeof def.name !== 'string' || !def.name.trim() || [...def.name].length > 80) errors.push('The definition needs a name of 1 to 80 characters.');
    if (!KINDS.includes(def.kind)) errors.push(`The kind is one of ${KINDS.join(', ')}.`);
    if (!RARITIES.includes(def.rarity)) errors.push(`The rarity is one of ${RARITIES.join(', ')}.`);
    if (!int(def.value, 0, Number.MAX_SAFE_INTEGER)) errors.push('The value is a whole number of coin, 0 or more.');
    if (typeof def.stack !== 'boolean') errors.push('The definition says whether it stacks.');
    if (!(def.slot === null || typeof def.slot === 'string')) errors.push('The slot is text or null.');
    if (!isObject(def.stats) || !Object.values(def.stats).every(value => typeof value === 'number' && Number.isFinite(value))) errors.push('The stats are numbers by name.');
    if (!isObject(def.effect)) errors.push('The effect is a record.');
    if (!Array.isArray(def.tags) || !def.tags.every(tag => typeof tag === 'string')) errors.push('The tags are a list of words.');
    if (typeof def.note !== 'string') errors.push('The note is text.');
    if (def.carry !== undefined && !int(def.carry, 1, 1000)) errors.push('A carry capacity is a whole number from 1 to 1000.');
    return errors;
}

/** The ItemRule shape of the pack schema ($defs.itemRule) and its consistency with the def: [] or sentences. */
export function ruleProblems(rule, def) {
    if (!isObject(rule)) return ['The rule is not a record.'];
    const errors = [];
    const allowed = ['def', 'allowedSlots', 'hands', 'requires', 'weight', 'unique'];
    for (const key of Object.keys(rule)) if (!allowed.includes(key)) errors.push(`The rule has a field "${key}" that an item rule does not.`);
    if (rule.def !== def?.id) errors.push('The rule is for another item.');
    const slots = rule.allowedSlots;
    if (!Array.isArray(slots) || slots.length > 2 || new Set(slots).size !== slots.length || !slots.every(slot => SLOTS.includes(slot))) errors.push('The allowed slots are up to two different slots.');
    if (![0, 1, 2].includes(rule.hands)) errors.push('Hands are 0, 1 or 2.');
    if (!isObject(rule.requires) || !Object.entries(rule.requires).every(([stat, min]) => STATS.includes(stat) && int(min, 1, 99))) errors.push('Requirements are stat minimums from 1 to 99.');
    if (!int(rule.weight, 0, 10000)) errors.push('Weight is a whole number from 0 to 10000.');
    if (rule.unique !== undefined && typeof rule.unique !== 'boolean') errors.push('Unique is true or false.');
    if (errors.length) return errors;
    if (def.kind !== 'equipment') {
        if (slots.length || rule.hands !== 0) errors.push('Only equipment has slots and hands.');
        return errors;
    }
    if (!slots.length) errors.push('Equipment is worn in a slot.');
    const hand = slots.some(slot => slot === 'weapon' || slot === 'offhand');
    if (hand && rule.hands === 0) errors.push('A weapon or off-hand piece is held in one or two hands.');
    if (!hand && rule.hands !== 0) errors.push('Only a weapon or off-hand piece is held in hands.');
    if (rule.hands === 2 && !(slots.length === 1 && slots[0] === 'weapon')) errors.push('Only a weapon is held in two hands.');
    if (!slots.includes(def.slot)) errors.push('The definition\'s slot is not one of the rule\'s slots.');
    return errors;
}

function effectProblems(effect) {
    const errors = [];
    for (const [key, value] of Object.entries(effect)) {
        if (key === 'heal' || key === 'mp' || key === 'repair') {
            if (!int(value, 0, EFFECT_MAX[key])) errors.push(`The ${key} effect is a whole number from 0 to ${EFFECT_MAX[key]}.`);
        } else if (key === 'cure') {
            if (!Array.isArray(value) || value.length > EFFECT_MAX.cure || !value.every(word => typeof word === 'string' && word && word.length <= 24)) errors.push(`Cure names up to ${EFFECT_MAX.cure} conditions.`);
        } else if (key === 'damage') {
            if (!isObject(value) || !int(value.amount, 0, EFFECT_MAX.damage) || typeof value.element !== 'string' || !TARGETS.includes(value.target) || Object.keys(value).some(name => !['amount', 'element', 'target'].includes(name))) {
                errors.push(`A damage effect is { amount 0 to ${EFFECT_MAX.damage}, element, target one or all }.`);
            }
        } else errors.push(`An effect has no "${key}".`);
    }
    return errors;
}

/**
 * Holds a generated def to the budget of the place it came into: `area` = { tier } (world.areaTier's answer, tier an integer
 * 0..9, or null when the place is unknown). → [] when it is within, else the sentences that say what is over.
 */
export function boundProblems(def, area) {
    const errors = [];
    if (!isObject(area)) return ['There is no place to bound the item by.'];
    const budgeted = def.rarity !== 'common' || Object.keys(def.stats).length > 0 || Object.keys(def.effect).length > 0;
    // A place with no tier (unknown to Story Director, or Story Director absent) can bound nothing: only an item with nothing to bound passes.
    if (area.tier === null && !budgeted && def.rarity !== 'legendary') return errors;
    if (!int(area.tier, 0, 9)) return ['The place has no tier, so nothing can be bounded.'];
    if (def.rarity === 'legendary') errors.push('A generated item is never legendary.');
    else if (RARITIES.indexOf(def.rarity) > RARITIES.indexOf(rarityCeiling(area.tier))) errors.push(`A tier ${area.tier} place yields at most ${rarityCeiling(area.tier)} items, not ${def.rarity}.`);
    const stats = Object.entries(def.stats);
    if (stats.length && def.kind !== 'equipment') errors.push('Only equipment has stats.');
    for (const [name, value] of stats) {
        if (!Object.hasOwn(STAT_COST, name)) errors.push(`"${name}" is not a stat an item has.`);
        else if (!Number.isInteger(value) || Math.abs(value) > 999) errors.push(`${name} is a whole number within 999.`);
    }
    if (!errors.length && stats.length) {
        const budget = budgetOf(def.rarity, levelCeiling(area.tier));
        const spend = spendOf(def.stats);
        if (spend > budget + 1e-9) errors.push(`The stats cost ${spend} and a ${def.rarity} item at tier ${area.tier} may cost ${budget}.`);
    }
    if (Object.keys(def.effect).length && def.kind !== 'consumable') errors.push('Only a consumable has an effect.');
    errors.push(...effectProblems(def.effect));
    return errors;
}
