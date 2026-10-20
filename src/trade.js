// RPG Battle: the Trade tab's numbers and what a trade does to the Inventory (pure).
//
// (0.5.37) Selling, crafting and ordering are the reader's choices, made in the Trade tab and
// worked out here, so the story never has to be parsed for them: what a thing is worth (its
// rarity and kind: gear by its stat budget, a potion by what it does, a material by rarity),
// what the place does to prices (a village pays less and sells for less than a city, by the
// words of its name, or the reader's own word for it: cheap, fair, dear), and what the one
// trading pays for what (a fence little, an apothecary well for potions and parts, a smith for
// gear). The tab writes the result into the latest reply's Inventory, as a fight's loot is, and
// the next reply is told what happened in a line the story turns into the scene (tradeHandoff).

import { DEFAULT_RULES } from './rules.js';
import { addLoot, applyCrafts, capItem, collectOrders, formatMoney, nameKey, parseInventory, purseOf, spendMoney, useItems } from './items.js';

const tradeRules = rules => ({ ...DEFAULT_RULES.trade, ...(rules?.trade ?? {}) });
const words = text => String(text ?? '').toLowerCase().split(/[^a-z-]+/).filter(Boolean);

/** What kind of thing an Inventory item is to a buyer: 'equipment', 'consumable', 'material' or 'goods'. */
export function kindOf(item) {
    if (item?.slot) return 'equipment';
    if (item?.effect) return 'consumable';
    if (/\bmaterial\b/i.test(String(item?.note ?? '')) || item?.kind === 'material' || item?.category && /loot|material|troph|component/i.test(item.category)) return 'material';
    return 'goods';
}

/** What `item` (an Inventory item, or a crafted piece) is worth, in the smallest coin; at least 1. */
export function itemWorth(item, { level = 1, rules = DEFAULT_RULES } = {}) {
    const t = tradeRules(rules);
    const rarity = item?.rarity ?? 'common';
    const factor = t.rarityFactor[rarity] ?? 1;
    const kind = kindOf(item);
    if (kind === 'equipment') {
        const { cost, budget } = capItem({ ...item, slot: item.slot }, level, rules);
        return Math.max(1, Math.round((cost || budget) * t.gearPerPoint * factor));
    }
    if (kind === 'consumable') {
        const e = item.effect ?? {};
        const damage = e.damage ? e.damage.amount * (e.damage.target === 'all' ? 2 : 1) : 0;
        const points = (e.heal ?? 0) * t.effect.heal + (e.mp ?? 0) * t.effect.mp + (e.cure?.length ?? 0) * t.effect.cure + damage * t.effect.damage;
        return Math.max(1, Math.round(points * factor));
    }
    if (kind === 'material') return Math.max(1, Math.round(t.material[rarity] ?? t.material.common));
    return Math.max(1, Math.round(t.goods * factor));
}

/**
 * The prices of a place: { tier, buy, sell, level } from the words of its name (`place`,
 * "Bluewatch Village | Adventurer Guild Post"), or `level` ('cheap' | 'fair' | 'dear' or a
 * number), the reader's own word for it, × both. An unknown place is a town.
 */
export function placePrices(place, { level = null, rules = DEFAULT_RULES } = {}) {
    const t = tradeRules(rules);
    const said = words(place);
    let tier = 'town';
    for (const [name, area] of Object.entries(t.areas)) if (area.words.some(word => said.includes(word))) tier = name;
    const area = t.areas[tier] ?? { buy: 1, sell: 1 };
    const by = typeof level === 'number' && level > 0 ? level : t.levels[level] ?? 1;
    return { tier, buy: area.buy * by, sell: area.sell * by, level: level ?? null };
}

/** Who trades, by the words of their name or trade: 'apothecary', 'smith', 'crafter', 'fence', 'guild' or 'general'. */
export function buyerKind(name, rules = DEFAULT_RULES) {
    const t = tradeRules(rules);
    const said = String(name ?? '').toLowerCase();
    for (const [kind, buyer] of Object.entries(t.buyers)) {
        if (kind === 'general') continue;
        if (buyer.words.some(word => new RegExp(`(?<![a-z])${word.replace(/[-]/g, '[- ]?')}s?(?![a-z])`).test(said))) return kind;
    }
    return 'general';
}

/** What `buyer` (a kind) pays for one `item` at `prices` (placePrices): in the smallest coin, at least 1. */
export function sellPrice(item, { buyer = 'general', prices = { sell: 1 }, level = 1, rules = DEFAULT_RULES } = {}) {
    const t = tradeRules(rules);
    const pays = t.buyers[buyer]?.[kindOf(item)] ?? 1;
    return Math.max(1, Math.round(itemWorth(item, { level, rules }) * t.sellRate * pays * (prices.sell ?? 1)));
}

/** A crafter's fee for making `piece` (a craftPlan item) at `prices`: in the smallest coin. */
export function craftFee(piece, { prices = { buy: 1 }, level = 1, rules = DEFAULT_RULES } = {}) {
    const t = tradeRules(rules);
    return Math.max(1, Math.round(itemWorth(piece, { level, rules }) * t.craftFee * (prices.buy ?? 1)));
}

// Rows that can be sold: not the purse, not worn, not on order.
export function sellable(inventoryText, currency = DEFAULT_RULES.currency) {
    const purse = new Set((purseOf(inventoryText, currency)?.rows ?? []).map(row => nameKey(row.name)));
    return parseInventory(inventoryText).items.filter(item => !purse.has(nameKey(item.name)) && !item.equipped && !item.onOrder && item.qty > 0);
}

/** Pieces waiting under [On Order]. */
export function ordersIn(inventoryText) {
    return parseInventory(inventoryText).items.filter(item => item.onOrder);
}

/** `qty` of the row `name` sold for `each` apiece: { text, total } — the row down, the purse up. */
export function sellIn(inventoryText, { name, qty = 1, each }, currency = DEFAULT_RULES.currency) {
    const total = Math.max(0, Math.round(each * qty));
    const text = addLoot(useItems(inventoryText, { [name]: qty }), { money: total }, currency);
    return { text, total };
}

/**
 * `plan` (craft.craftPlan's) made or ordered, `fee` paid: { text, ok } — ok false when the
 * purse cannot pay it (nothing changed). `from`: the crafter an order waits with.
 */
export function craftIn(inventoryText, plan, { fee = 0, from = '', currency = DEFAULT_RULES.currency } = {}) {
    const paid = spendMoney(inventoryText, fee, currency);
    if (!paid.ok) return { text: inventoryText, ok: false };
    const text = applyCrafts(paid.text, inventoryText, [{ ...plan, ...(plan.order && from ? { from } : {}) }], currency);
    return { text, ok: true };
}

/** The order `name` collected: { text } (collectOrders). */
export function collectIn(inventoryText, name, currency = DEFAULT_RULES.currency) {
    return { text: collectOrders(inventoryText, inventoryText, [name], currency) };
}

/** One trade as the story is told it: "sold 5 Rat Tail to Elke for 3 silver". */
export function tradeLine(entry, currency = DEFAULT_RULES.currency) {
    const who = String(entry?.who ?? '').trim();
    const money = amount => formatMoney(amount, currency);
    const to = who ? ` to ${who}` : '';
    const by = who ? ` by ${who}` : '';
    if (entry?.kind === 'sell') return `sold ${entry.qty > 1 ? `${entry.qty} ` : ''}${entry.name}${to} for ${money(entry.total)}`;
    if (entry?.kind === 'order') return `ordered ${entry.name}${who ? ` from ${who}` : ''}, made from ${entry.from.join(', ')}, ready ${entry.ready}${entry.fee ? `, for ${money(entry.fee)}` : ''}`;
    if (entry?.kind === 'craft') return `had ${entry.name} made${by} from ${entry.from.join(', ')}${entry.fee ? ` for ${money(entry.fee)}` : ''}`;
    if (entry?.kind === 'collect') return `collected ${entry.name}${who ? ` from ${who}` : ''}`;
    return '';
}

/**
 * The note the next reply is given after trades in the tab: what was done, with the amounts as
 * they are, for the story to tell in its own voice. '' when there is nothing to tell.
 */
export function tradeHandoff(entries, { name = 'The party', currency = DEFAULT_RULES.currency } = {}) {
    const lines = (entries ?? []).map(entry => tradeLine(entry, currency)).filter(Boolean);
    if (!lines.length) return '';
    return `[Trade] Since the last reply, ${name} ${lines.join('; ')}.\nTell it as part of the scene, in the story's own voice. No menus or game terms; keep the amounts and what was made exactly as they are (the Inventory already shows them).`;
}
