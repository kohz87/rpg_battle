// RPG Battle v2, part **craft**: what a craft makes, as a whole inventory def (SPEC §7) for
// inventory.grant (pure).
//
// * The output is the recipe's item as the pack (or the inventory) has it; a story-taught recipe
//   whose item nobody defines is made by code: gear from its materials' affinities sized to their
//   rarity at the crafter's level (the trade part's craftPiece, v1's rule), anything else a consumable
//   with what its name says it does (v1 effectByName), else a small heal by its rarity.
// * The quality scales its stats and its effect (fine ×1.2, masterwork ×1.5; rules.js scaled); a
//   masterwork piece of gear carries +1 refinement (a `refined` tag and the note). Element tags carry
//   over from the materials (their tags and what their names say, v1 materialAffinity).
// * Its worth is what went into it, never more (B-b3-13, as a commission): the materials' worth;
//   the trade part's resale cap (trade.paid) is set by the command to what the materials would fetch.
// * Each quality of each recipe is a def of its own (`craft/<recipe>`, `-fine`, `-masterwork`, with the
//   elements it carries), named "Fine Iron Sword" / "Masterwork Iron Sword"; a ruined craft makes
//   "Botched <name>", worth nothing (gear: its main stat −1, the small debuff).
// * The note says the numbers the way v1's notes do, because RPG Battle's item.define hook reads a
//   new def's note (items/define.js): so the hook keeps code's numbers, held to its own caps.

import { DEFAULT_RULES, RARITIES } from '../../rules.js';
import { ELEMENTS, effectByName, itemSlot, mainStat } from '../../items.js';
import { craftPiece, defAffinity } from '../trade/craft-plan.js';
import { TRADER_KINDS, sellEach, worthOf } from '../trade/core.js';
import { SCALE, clip, scaled, slugOf } from './rules.js';

const GEAR_CRAFTS = ['smithing', 'leatherwork', 'enchanting'];
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const KINDS = ['goods', 'material', 'consumable', 'equipment', 'quest', 'money'];

/** The elements the materials carry (their tags, else what their names say), in ELEMENTS order. */
export function elementsOf(parts = []) {
    const found = new Set();
    for (const part of parts) {
        const def = part?.def;
        if (!def) continue;
        for (const tag of Array.isArray(def.tags) ? def.tags : []) if (ELEMENTS.includes(String(tag).toLowerCase())) found.add(String(tag).toLowerCase());
        const element = defAffinity(def).element;
        if (element) found.add(element);
    }
    return ELEMENTS.filter(element => found.has(element));
}

/**
 * What the materials are worth, and what they would fetch at the meanest buyer (the resale cap).
 * A def with its own `value` (a pack's, a recipe's) counts as written; one without is priced by v1's
 * itemWorth, a code default, times the pack's money scale (`scale`, inventory.economy, F104), whole,
 * at least 1. What they would fetch is the lower of the scaled and unscaled reckoning, so the cap is
 * never above what a seller that does not scale would pay.
 */
export function inputWorth(parts = [], { level = 1, rules = DEFAULT_RULES, scale = 1 } = {}) {
    const world = { plevel: level, rules, prices: { sell: 1, buy: 1 } };
    const by = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const own = def => Number.isInteger(def?.value) && def.value > 0;
    const scaledBy = (amount, def) => (own(def) || by === 1 ? amount : Math.max(1, Math.round(amount * by)));
    let worth = 0;
    let fetch = 0;
    for (const part of parts) {
        if (!part?.def) continue;
        const qty = part.qty ?? part.need ?? 1;
        worth += scaledBy(worthOf(part.def, world), part.def) * qty;
        const least = Math.min(...TRADER_KINDS.map(buyer => sellEach(part.def, buyer, world)));
        fetch += Math.min(least, scaledBy(least, part.def)) * qty;
    }
    return { worth, fetch };
}

/** The item a recipe makes before any quality: a def's fields (no id), from its def or by code. */
export function baseOutput(recipe, parts = [], { level = 1, rules = DEFAULT_RULES } = {}) {
    const def = recipe.makes?.def;
    const name = clip(recipe.makes?.name || recipe.name, 80) || 'Thing';
    if (isRecord(def)) {
        return {
            name: clip(def.name || name, 80), kind: KINDS.includes(def.kind) ? def.kind : 'goods', rarity: RARITIES.includes(def.rarity) ? def.rarity : 'common',
            slot: def.slot ?? null, stats: { ...(def.stats ?? {}) }, effect: { ...(def.effect ?? {}) }, tags: [...(def.tags ?? [])],
        };
    }
    const gear = GEAR_CRAFTS.includes(recipe.craft) || Boolean(itemSlot(name));
    if (gear) {
        const piece = craftPiece({ name, parts: parts.filter(part => part.def).map(part => ({ def: part.def, qty: part.need ?? part.qty ?? 1 })) }, { level, rules });
        return { name, kind: 'equipment', rarity: piece.rarity, slot: piece.slot, stats: { ...piece.stats }, effect: {}, tags: [...(piece.tags ?? [])] };
    }
    const rarity = RARITIES.includes(recipe.rarity) ? recipe.rarity : 'common';
    const effect = effectByName(name) ?? { heal: 10 * (RARITIES.indexOf(rarity) + 1) };
    return { name, kind: 'consumable', rarity, slot: null, stats: {}, effect: { heal: 0, mp: 0, cure: [], ...effect }, tags: [] };
}

const statsText = stats => Object.entries(stats ?? {}).filter(([, value]) => Number.isFinite(value) && value !== 0)
    .map(([stat, value]) => `${stat} ${value < 0 ? '-' : '+'}${Math.abs(value)}`).join(', ');

function effectText(effect) {
    const out = [];
    if (effect?.heal > 0) out.push(`heals ${effect.heal}`);
    if (effect?.mp > 0) out.push(`MP +${effect.mp}`);
    if (Array.isArray(effect?.cure) && effect.cure.length) out.push(`cures ${effect.cure.join(' and ')}`);
    if (effect?.damage?.amount > 0) out.push(`${effect.damage.element === 'physical' ? 'damage' : effect.damage.element} ${effect.damage.amount}${effect.damage.target === 'all' ? ' all' : ''}`);
    return out.join(', ');
}

/** The note a def is told by (v1's note form: `rare · ATK +4, fire · weapon · crafted, fine`). */
function noteOf(def, words) {
    const numbers = def.kind === 'equipment' ? [statsText(def.stats), ...def.tags.filter(tag => ELEMENTS.includes(tag))].filter(Boolean).join(', ') : effectText(def.effect);
    return clip([def.kind === 'equipment' && def.rarity !== 'common' ? def.rarity : '', numbers, def.kind === 'equipment' ? def.slot : '', words].filter(Boolean).join(' · '), 300);
}

const PREFIX = { normal: '', fine: 'Fine', masterwork: 'Masterwork' };

/**
 * The def a craft of `quality` (normal, fine, masterwork) makes: { def, refine } with `def` whole
 * (id, name, kind, rarity, value, stack, slot, stats, effect, tags, note).
 */
export function outputDef(recipe, quality, parts = [], { level = 1, rules = DEFAULT_RULES, base = null, scale = 1 } = {}) {
    const made = base ?? baseOutput(recipe, parts, { level, rules });
    const factor = SCALE[quality] ?? 1;
    const elements = elementsOf(parts);
    const stats = Object.fromEntries(Object.entries(made.stats ?? {}).map(([stat, value]) => [stat, scaled(value, factor)]));
    const effect = { ...(made.effect ?? {}) };
    for (const key of ['heal', 'mp']) if (Number.isFinite(effect[key])) effect[key] = scaled(effect[key], factor);
    if (isRecord(effect.damage)) effect.damage = { ...effect.damage, amount: scaled(effect.damage.amount, factor) };
    const refine = quality === 'masterwork' && made.kind === 'equipment' ? 1 : 0;
    const tags = [...new Set([...(made.tags ?? []).map(String), ...elements, ...(refine ? ['refined'] : [])])].slice(0, 12);
    const name = clip(PREFIX[quality] ? `${PREFIX[quality]} ${made.name}` : made.name, 80);
    const { worth } = inputWorth(parts.map(part => ({ def: part.def, qty: part.need ?? part.qty })), { level, rules, scale });
    const id = `craft/${[slugOf(String(recipe.id ?? recipe.name).split('/').at(-1)), quality === 'normal' ? '' : quality, ...elements].filter(Boolean).join('-')}`.slice(0, 100);
    const def = {
        id, name, kind: made.kind, rarity: made.rarity, value: Math.max(1, worth), stack: made.kind !== 'equipment',
        slot: made.kind === 'equipment' ? made.slot ?? 'accessory' : null, stats: made.kind === 'equipment' ? stats : {},
        effect: made.kind === 'consumable' ? effect : {}, tags, note: '',
    };
    def.note = noteOf(def, [`crafted${quality === 'normal' ? '' : `, ${quality}`}`, refine ? '+1 refinement' : ''].filter(Boolean).join(', '));
    return { def, refine };
}

/** The junk a ruined craft leaves: "Botched <name>", worth nothing; gear has its main stat −1. */
export function junkDef(recipe, parts = [], { level = 1, rules = DEFAULT_RULES, base = null } = {}) {
    const made = base ?? baseOutput(recipe, parts, { level, rules });
    const id = `craft/${slugOf(String(recipe.id ?? recipe.name).split('/').at(-1))}-botched`.slice(0, 100);
    const name = clip(`Botched ${made.name}`, 80);
    if (made.kind === 'equipment') {
        const slot = made.slot ?? 'accessory';
        const stat = mainStat({ name: made.name, slot });
        const def = { id, name, kind: 'equipment', rarity: 'common', value: 0, stack: false, slot, stats: { [stat]: -1 }, effect: {}, tags: ['junk'], note: '' };
        def.note = `${statsText(def.stats)} · ${slot} · junk, a botched craft`;
        return def;
    }
    return { id, name, kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: ['junk'], note: 'junk, a botched craft: worth nothing' };
}
