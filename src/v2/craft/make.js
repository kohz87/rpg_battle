// RPG Battle v2, part **craft**: what a craft makes, as a whole inventory def (SPEC §7) for
// inventory.grant (pure).
//
// * The output is the recipe's item as the pack (or the inventory) has it; a story-taught recipe
//   whose item nobody defines is made by code: gear only when the recipe names a slot or the item is a
//   piece of gear by its name (v1's item kinds: a sword, a helm, a ring), its stats from its materials'
//   affinities sized to their rarity at the crafter's level (the trade part's craftPiece, v1's rule);
//   a thing whose name says what it does (v1 effectByName), or anything alchemy or cooking makes, a
//   consumable (else a small heal by its rarity), held to what the shipped draughts of its rarity do
//   (STORY_EFFECT_BY_RARITY); anything else goods.
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
import { ELEMENTS, effectByName, kindOf, mainStat, slotFromWord } from '../../items.js';
import { craftPiece, defAffinity } from '../trade/craft-plan.js';
import { TRADER_KINDS, sellEach, worthOf } from '../trade/core.js';
import { itemWorth } from '../../trade.js';
import { SCALE, clip, scaled, slugOf } from './rules.js';

// A story-taught consumable's effect, at most what the shipped draughts of its rarity do (Minor 20,
// Healing 30, Greater 60, Elixir 120; mana 10–40), before the quality: a name never buys a big potion.
export const STORY_EFFECT_BY_RARITY = Object.freeze({
    heal: Object.freeze({ common: 20, uncommon: 30, rare: 60, epic: 120, legendary: 120 }),
    mp: Object.freeze({ common: 10, uncommon: 20, rare: 30, epic: 40, legendary: 40 }),
});
// Crafts whose made things are used up (eaten, drunk, applied) when they are not gear.
const USED_CRAFTS = ['alchemy', 'cooking'];
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
            slot: def.slot ?? null, stats: { ...(def.stats ?? {}) }, effect: effectOf(def.effect), tags: [...(def.tags ?? [])],
        };
    }
    // Gear only when the recipe names a slot or the item is a piece of gear by its name (a sword, a
    // helm, a ring: v1's item kinds), never by the craft alone: a tonic is drunk, not worn.
    const slot = slotFromWord(recipe.makes?.slot ?? '') ?? kindOf(name)?.slot ?? null;
    const rarity = RARITIES.includes(recipe.rarity) ? recipe.rarity : 'common';
    if (slot) {
        const piece = craftPiece({ name, slot, parts: parts.filter(part => part.def).map(part => ({ def: part.def, qty: part.need ?? part.qty ?? 1 })) }, { level, rules });
        return { name, kind: 'equipment', rarity: piece.rarity, slot: piece.slot, stats: { ...piece.stats }, effect: {}, tags: [...(piece.tags ?? [])] };
    }
    const named = effectByName(name);
    if (named || USED_CRAFTS.includes(recipe.craft)) {
        const effect = { heal: 0, mp: 0, cure: [], ...(named ?? { heal: 10 * (RARITIES.indexOf(rarity) + 1) }) };
        for (const key of ['heal', 'mp']) effect[key] = Math.min(Math.max(0, Math.round(Number(effect[key]) || 0)), STORY_EFFECT_BY_RARITY[key][rarity]);
        return { name, kind: 'consumable', rarity, slot: null, stats: {}, effect, tags: [] };
    }
    // Anything else (an ingot, a rope, a charm with no slot) is goods: no stats, no effect.
    return { name, kind: 'goods', rarity, slot: null, stats: {}, effect: {}, tags: [] };
}

// A def's effect in the inventory's shape: a pack's bare `damage: 6` is { amount: 6, element: 'physical',
// target: 'one' }, so neither this note nor the item.define hook reads an element that is not there.
function effectOf(effect) {
    const out = isRecord(effect) ? { ...effect } : {};
    if (typeof out.damage === 'number') out.damage = { amount: Math.max(0, Math.round(out.damage)), element: 'physical', target: 'one' };
    else if (isRecord(out.damage)) out.damage = { amount: Math.max(0, Math.round(Number(out.damage.amount) || 0)), element: typeof out.damage.element === 'string' && out.damage.element ? out.damage.element : 'physical', target: out.damage.target === 'all' ? 'all' : 'one' };
    else delete out.damage;
    return out;
}

/**
 * What a recipe's item is worth at a quality (fine ×1.2, masterwork ×1.5 of its normal worth): its def's
 * own value when it has one, else v1's itemWorth of what code made, times the money scale (F104).
 */
export function outputWorth(base, quality = 'normal', { level = 1, rules = DEFAULT_RULES, scale = 1, def = null } = {}) {
    const factor = SCALE[quality] ?? 1;
    const own = Number.isInteger(def?.value) && def.value > 0 ? def.value : null;
    const by = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const worth = own ?? Math.max(1, Math.round(itemWorth({ name: base.name, kind: base.kind, rarity: base.rarity, slot: base.slot, stats: base.stats, effect: Object.keys(base.effect ?? {}).length ? base.effect : null, tags: base.tags ?? [], note: '' }, { level, rules }) * by));
    return Math.round(worth * factor);
}

/** How much more than its inputs a story-taught recipe's item may be worth (the Ersveil audit's bound). */
export const STORY_WORTH_TIMES = 1.5;

/**
 * What code makes for a story-taught recipe, sized so that even a masterwork of it is worth at most `cap`
 * (STORY_WORTH_TIMES × its inputs, RX-E-3): its stats or its heal and mana scaled down until it fits;
 * null when nothing of it is left (then it cannot be made from that). A def a pack or the inventory has
 * is never resized: it fits as it is, or the recipe is refused.
 */
export function fitToWorth(base, cap, options = {}) {
    if (outputWorth(base, 'masterwork', options) <= cap) return base;
    // A lower rarity first (it prices lower), then its stats or effect scaled down.
    const from = Math.max(0, RARITIES.indexOf(base.rarity));
    for (let at = from; at >= 0; at -= 1) {
        const rated = { ...base, rarity: RARITIES[at] };
        if (outputWorth(rated, 'masterwork', options) <= cap) return rated;
        let ratio = cap / Math.max(1, outputWorth(rated, 'masterwork', options));
        for (let tries = 0; tries < 12; tries += 1) {
            const stats = Object.fromEntries(Object.entries(rated.stats ?? {}).map(([stat, value]) => [stat, value > 0 ? Math.floor(value * ratio) : value]).filter(([, value]) => value !== 0));
            const effect = { ...(rated.effect ?? {}) };
            for (const key of ['heal', 'mp']) if (Number(effect[key]) > 0) effect[key] = Math.floor(effect[key] * ratio);
            if (isRecord(effect.damage)) effect.damage = { ...effect.damage, amount: Math.floor(effect.damage.amount * ratio) };
            const left = Object.values(stats).some(value => value > 0) || effect.heal > 0 || effect.mp > 0 || effect.damage?.amount > 0 || (effect.cure ?? []).length > 0;
            if (!left) break;
            const fitted = { ...rated, stats, effect };
            if (outputWorth(fitted, 'masterwork', options) <= cap) return fitted;
            ratio *= 0.8;
        }
    }
    return null;
}

/**
 * The best quality, at most `quality`, whose worth fits `cap` (STORY_WORTH_TIMES × the inputs' worth), or
 * null when not even a plain one does. For a story-taught recipe only: a pack's recipes are as written.
 */
export function qualityWithin(base, quality, cap, options = {}) {
    const order = ['normal', 'fine', 'masterwork'];
    for (let at = order.indexOf(quality); at >= 0; at -= 1) {
        if (outputWorth(base, order[at], options) <= cap) return order[at];
    }
    return null;
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
export function outputDef(recipe, quality, parts = [], { level = 1, rules = DEFAULT_RULES, base = null, scale = 1, worthParts = null } = {}) {
    const qty = Number.isInteger(recipe.qty) && recipe.qty > 0 ? recipe.qty : 1;
    const made = base ?? baseOutput(recipe, parts, { level, rules });
    const factor = SCALE[quality] ?? 1;
    const elements = elementsOf(parts);
    const stats = Object.fromEntries(Object.entries(made.stats ?? {}).map(([stat, value]) => [stat, scaled(value, factor)]));
    const effect = effectOf(made.effect);
    for (const key of ['heal', 'mp']) if (Number.isFinite(effect[key])) effect[key] = scaled(effect[key], factor);
    if (isRecord(effect.damage)) effect.damage = { ...effect.damage, amount: scaled(effect.damage.amount, factor) };
    const refine = quality === 'masterwork' && made.kind === 'equipment' ? 1 : 0;
    const tags = [...new Set([...(made.tags ?? []).map(String), ...elements, ...(refine ? ['refined'] : [])])].slice(0, 12);
    const name = clip(PREFIX[quality] ? `${PREFIX[quality]} ${made.name}` : made.name, 80);
    // What went into it (`worthParts`: the counts that count, a key item's none), else every material.
    const { worth } = inputWorth(worthParts ?? parts.map(part => ({ def: part.def, qty: part.need ?? part.qty })), { level, rules, scale });
    const id = `craft/${[slugOf(String(recipe.id ?? recipe.name).split('/').at(-1)), quality === 'normal' ? '' : quality, ...elements].filter(Boolean).join('-')}`.slice(0, 100);
    const def = {
        // Each of the `qty` made is worth its share of what went in (RX-E-4): never more than the inputs in all.
        id, name, kind: made.kind, rarity: made.rarity, value: worth > 0 ? Math.max(1, Math.floor(worth / qty)) : (worthParts ? 0 : 1), stack: made.kind !== 'equipment',
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
