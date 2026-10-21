// RPG Battle v2, trade part: what a commission makes, from inventory defs (pure).
//
// v1's craftPlan (src/craft.js) reads its materials out of the Inventory block's text; in v2
// they are inventory stacks with defs. This is the same arithmetic on defs, built from v1's
// own pieces (materialAffinity, rarityBudget, itemSlot, mainStat, rules.craft): the rarity is
// the best material's, one step up for enough of them; the stats come from the materials'
// affinities, sized to that rarity at the player character's level; an element carries over.
// tests/v2/trade/craft-plan.test.js checks it against v1's craftPlan.

import { DEFAULT_RULES, RARITIES, rarityBudget } from '../../rules.js';
import { itemSlot, mainStat } from '../../items.js';
import { materialAffinity } from '../../craft.js';

const bumpRarity = (rarity, steps) => RARITIES[Math.min(RARITIES.length - 1, Math.max(0, RARITIES.indexOf(rarity)) + steps)];

/** A material def's affinity: its note and tags first (`MDEF, poison`), else its name (v1 materialAffinity). */
export function defAffinity(def) {
    const note = [def?.note ?? '', ...(Array.isArray(def?.tags) ? def.tags : [])].filter(Boolean).join(' · ');
    return materialAffinity(def?.name ?? '', note);
}

/**
 * The piece `name` made from `parts` ([{ def, qty }], defs as SPEC §7 has them), worn in `slot`
 * (null: by its kind): { name, qty: 1, kind: 'equipment', rarity, stats, slot, tags? }, the
 * shape v1's craftPlan gives as `item`. `level`: the player character's.
 */
export function craftPiece({ name, slot = null, parts = [] }, { level = 1, rules = DEFAULT_RULES } = {}) {
    const c = { ...DEFAULT_RULES.craft, ...(rules.craft ?? {}) };
    const read = parts.map(part => ({ qty: part.qty, rarity: RARITIES.includes(part.def?.rarity) ? part.def.rarity : 'common', ...defAffinity(part.def) }));
    const top = read.reduce((best, part) => (RARITIES.indexOf(part.rarity) > RARITIES.indexOf(best) ? part.rarity : best), 'common');
    const atTop = read.filter(part => part.rarity === top).reduce((sum, part) => sum + part.qty, 0);
    const rarity = atTop >= c.bumpAt ? bumpRarity(top, 1) : top;
    const named = [...new Set(read.map(part => part.stat).filter(Boolean))].slice(0, c.maxStats);
    const worn = slot ?? itemSlot(name, named.length ? Object.fromEntries(named.map(stat => [stat, 1])) : {});
    const chosen = named.length ? named : [mainStat({ name, slot: worn })];
    const budget = rarityBudget(rarity, level, rules);
    const stats = Object.fromEntries(chosen.map(stat => [stat, Math.max(1, Math.floor(budget / chosen.length / (rules.statCost?.[stat] ?? 1)))]));
    const element = read.find(part => part.element)?.element ?? null;
    return { name, qty: 1, kind: 'equipment', rarity, stats, slot: worn, ...(element ? { tags: [element] } : {}) };
}
