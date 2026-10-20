// RPG Battle: the Trade tab's numbers and what a trade does to the Inventory (pure).
//
// (0.5.37) Selling, commissioning and collecting are the reader's choices, made in the Trade tab and
// worked out here, so the story never has to be parsed for them: what a thing is worth (its
// rarity and kind: gear by its stat budget, a potion by what it does, a material by rarity),
// what the place does to prices (a village pays less and sells for less than a city, by the
// words of its name, or the reader's own word for it: cheap, fair, dear), and what the one
// trading pays for what (a fence little, an apothecary well for potions and parts, a smith for
// gear). The tab writes the result into the latest reply's Inventory, as a fight's loot is, and
// the next reply is told what happened in a line the story turns into the scene (tradeHandoff).

import { DEFAULT_RULES, RARITIES, rarityBudget } from './rules.js';
import { addLoot, applyCrafts, capItem, collectOrders, formatMoney, itemSlot, mainStat, nameKey, parseEffect, parseInventory, purseOf, spendMoney, useItems } from './items.js';
import { makeRng } from './rng.js';

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
    // The settlement's own name first ("Bluewatch Village | Market Square" is a village, not a market town).
    let tier = 'town';
    for (const part of String(place ?? '').split('|')) {
        const said = words(part);
        const found = Object.entries(t.areas).filter(([, area]) => area.words.some(word => said.includes(word))).map(([name]) => name);
        if (found.length) {
            tier = found.at(-1);
            break;
        }
    }
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

// ---------------------------------------------------------------------------
// (0.5.44) Commissions: a piece made through the Trade tab is always ordered from a crafter, and
// how long it takes is the crafter's word, worked out here, never the reader's choice: a span by
// the piece's rarity (the day's own draw within it, so a swipe or a redraw gives the same), a
// specialist in their own line faster, one outside it slower, a small place slower. The ready
// time is written into the order's row as a date on the story's calendar ("ready Goldwane 14,
// 06:00 pm"), so the row stands alone and Collect waits until the story clock reaches it.

/** The trader kinds that take commissions. */
export const COMMISSIONERS = Object.freeze(['smith', 'crafter', 'apothecary']);
// What each makes in its own line, by the slot the piece is worn in.
const CRAFT_LINES = { smith: ['weapon', 'offhand', 'armour'], crafter: ['accessory', 'worn'], apothecary: [] };
const DAY = 24 * 60;

/** Story hours `crafter` (a COMMISSIONERS kind) takes over `piece` (a craftPlan item) at a `tier` place; `seed` fixes the draw. */
export function commissionHours(piece, { crafter = 'crafter', tier = 'town', seed = '', rules = DEFAULT_RULES } = {}) {
    const t = tradeRules(rules);
    const [low, high] = t.craftHours[piece?.rarity] ?? t.craftHours.common;
    const base = low + makeRng(`commission:${seed}`).next() * (high - low);
    const line = (CRAFT_LINES[crafter] ?? []).includes(piece?.slot) ? t.craftLine.specialist : t.craftLine.outside;
    const area = Number(t.areas[tier]?.craft) || 1;
    return Math.max(1, Math.round(base * line * area));
}

/** When `hours` from `now` (story minutes) is: on the hour after it; null without a clock. */
export function readyAt(hours, now) {
    if (typeof now !== 'number' || !Number.isFinite(now)) return null;
    return Math.ceil((now + hours * 60) / 60) * 60;
}

const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** How long `hours` is, as a crafter says it: "a few hours", "a day", "two days", "a week". */
export function craftSpan(hours) {
    if (hours <= 12) return 'a few hours';
    const days = Math.max(1, Math.round(hours / 24));
    if (days === 1) return 'a day';
    if (days === 7) return 'a week';
    if (days === 14) return 'two weeks';
    return `${NUMBER_WORDS[days] ?? days} days`;
}

// A story time as the calendar writes it, without the era and year ("Goldwane 14, 06:00 pm").
const WITHOUT_YEAR = text => String(text ?? '').replace(/^(?:[A-Z]{1,5}\s+)?\d+,\s*/, '').trim();
const TIME_OF_DAY = /,?\s*(\d{1,2}):(\d{2})\s*(am|pm)?\s*$/i;
const datePart = text => WITHOUT_YEAR(text).replace(TIME_OF_DAY, '').trim();

/** `at` (story minutes) as the order row keeps it: "Goldwane 14, 06:00 pm"; '' without a calendar. */
export function readyDateText(at, format) {
    if (at === null || typeof format !== 'function') return '';
    return WITHOUT_YEAR(format(at));
}

/** `at` said from `now`: "this evening", "tomorrow morning", else the date ("Goldwane 14"). */
export function readyWords(at, now, format) {
    if (at === null || typeof now !== 'number') return '';
    const hour = Math.floor((at % DAY) / 60);
    const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const days = Math.floor(at / DAY) - Math.floor(now / DAY);
    if (days <= 0) return `this ${part}`;
    if (days === 1) return `tomorrow ${part}`;
    return typeof format === 'function' ? datePart(format(at)) : '';
}

/**
 * The story time an order row's note says it is ready (`… on order with X, ready Goldwane 14,
 * 06:00 pm`), found with the calendar's own `format` near `now`; null when it says a span
 * ("ready in about two days"), there is no clock, or the date is not one the calendar writes.
 */
export function orderReadyAt(note, { now = null, format = null } = {}) {
    const said = String(note ?? '').match(/\bready\s+([^·]+)/i)?.[1]?.trim() ?? '';
    if (!said || /^in\b/i.test(said) || typeof format !== 'function' || typeof now !== 'number') return null;
    const want = datePart(said).toLowerCase();
    if (!want) return null;
    const time = said.match(TIME_OF_DAY);
    let minutes = 0;
    if (time) {
        const h = Number(time[1]) % 12 + (/pm/i.test(time[3] ?? '') ? 12 : 0);
        minutes = (time[3] ? h : Number(time[1])) * 60 + Number(time[2]);
    }
    const today = Math.floor(now / DAY);
    // Nearest first: an order is a few days off, rarely more than a season.
    for (let step = 0; step <= 800; step++) {
        const day = today + (step % 2 ? (step + 1) / 2 : -step / 2);
        if (datePart(format(day * DAY)).toLowerCase() === want) return day * DAY + minutes;
    }
    return null;
}

/** Whether an order (its row's note) can be collected at `now`: true when its time has come or cannot be read. */
export function orderDue(note, { now = null, format = null } = {}) {
    const at = orderReadyAt(note, { now, format });
    return at === null || (typeof now === 'number' && now >= at);
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
export function sellIn(inventoryText, { name, qty = 1, each }, currency = DEFAULT_RULES.currency, from = null, purse = from) {
    const total = Math.max(0, Math.round(each * qty));
    // (0.5.40) `from`: whose row (a member's section, or yours); the coin goes to your purse (`purse`).
    const text = addLoot(useItems(inventoryText, { [name]: qty }, from), { money: total }, currency, purse && purse.owner ? null : purse);
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

// ---------------------------------------------------------------------------
// (0.5.38) Shop stock: what a trader has for sale, by their trade and the place, the same all
// day (seeded by place, trader and story day), different from what they offered before.

const potion = (name, effect, from = 'village') => ({ name, kind: 'consumable', effect, from });
const goods = name => ({ name, kind: 'goods', from: 'remote' });
const gear = (name, from = 'remote') => ({ name, kind: 'equipment', from });
const TIER_ORDER = ['remote', 'village', 'town', 'city', 'capital'];
export const STOCK = {
    general: [potion('Minor Healing Draught', 'heal 20', 'remote'), potion('Healing Draught', 'heal 30'), potion('Antidote', 'cure poison'), goods('Rope'), goods('Torch'), goods('Travel Rations'), goods('Bedroll'), goods('Whetstone'), goods('Flint & Steel'), gear('Leather Gloves'), gear('Walking Boots'), gear('Travelling Cloak')],
    guild: [potion('Minor Healing Draught', 'heal 20', 'remote'), potion('Healing Draught', 'heal 30'), potion('Antidote', 'cure poison'), goods('Rope'), goods('Torch'), goods('Bedroll'), gear('Short Sword'), gear('Leather Jerkin'), gear('Buckler')],
    apothecary: [potion('Minor Healing Draught', 'heal 20', 'remote'), potion('Healing Draught', 'heal 30'), potion('Greater Healing Draught', 'heal 60', 'town'), potion('Mana Tonic', 'mp 20'), potion('Greater Mana Tonic', 'mp 40', 'town'), potion('Antidote', 'cure poison', 'remote'), potion('Elixir', 'heal 120', 'city')],
    smith: [gear('Iron Dagger'), gear('Short Sword'), gear('Hand Axe'), gear('Spear'), gear('Mace'), gear('Longsword', 'town'), gear('Buckler'), gear('Iron Shield', 'village'), gear('Leather Jerkin'), gear('Chain Shirt', 'town'), gear('Iron Helm', 'village'), gear('Gauntlets', 'village')],
    crafter: [gear('Bone Charm'), gear('Copper Ring'), gear('Silver Ring', 'town'), gear('Leather Gloves'), gear('Leather Boots'), gear('Belt'), gear('Travelling Cloak'), gear('Amulet', 'village')],
    fence: [potion('Healing Draught', 'heal 30'), potion('Antidote', 'cure poison'), gear('Stiletto'), gear('Short Sword'), gear('Silver Ring', 'remote'), gear('Studded Coat'), gear('Amulet', 'remote'), goods('Lockpicks')],
};
// The rarity of a piece for sale, by the place (% for common, uncommon, rare, epic).
const STOCK_RARITY = { remote: [85, 15, 0, 0], village: [78, 20, 2, 0], town: [65, 29, 6, 0], city: [55, 32, 11, 2], capital: [45, 35, 15, 5] };
const STOCK_SIZE = [5, 7];
const SEEN_KEPT = 40;

const tierAtLeast = (tier, from) => TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(from);

function stockRarity(rng, tier, fence) {
    const odds = STOCK_RARITY[tier] ?? STOCK_RARITY.town;
    let roll = rng.int(1, 100);
    let index = 0;
    while (index < odds.length - 1 && roll > odds[index]) roll -= odds[index++];
    // A fence's goods came from somewhere better, now and then.
    if (fence && index < 3 && rng.chance(20)) index += 1;
    return RARITIES[index];
}

/**
 * What `kind` of trader (buyerKind) has for sale at `prices` (placePrices) on `day`: [{ name,
 * kind, rarity, stats, slot, effect, note, price }], the same for the same place, trader and
 * day (`seed`), preferring what is not in `seen` (what they offered before). Prices: the
 * thing's worth × the place's goods price (a fence a little under).
 */
export function shopStock({ kind = 'general', prices = placePrices(''), seed = '', seen = [], level = 1, rules = DEFAULT_RULES } = {}) {
    const rng = makeRng(`shop:${seed}`);
    const tier = prices.tier ?? 'town';
    const pool = (STOCK[kind] ?? STOCK.general).filter(entry => tierAtLeast(tier, entry.from));
    const old = new Set((seen ?? []).map(nameKey));
    // New things first, in an order of the day's own; what they had before fills the rest.
    const order = pool.map(entry => ({ entry, key: (old.has(nameKey(entry.name)) ? 1 : 0) + rng.next() * 0.9 })).sort((a, b) => a.key - b.key).map(({ entry }) => entry);
    const count = Math.min(order.length, rng.int(STOCK_SIZE[0], STOCK_SIZE[1]));
    return order.slice(0, count).map(entry => {
        const rarity = entry.kind === 'equipment' ? stockRarity(rng, tier, kind === 'fence') : 'common';
        const item = { name: entry.name, kind: entry.kind, rarity, stats: {}, slot: null, effect: null, tags: [] };
        if (entry.kind === 'equipment') {
            item.slot = itemSlot(entry.name, {});
            const stat = mainStat({ name: entry.name, slot: item.slot });
            const share = Number(rules.generated?.gearBudgetShare ?? DEFAULT_RULES.generated.gearBudgetShare) || 0.75;
            item.stats = { [stat]: Math.max(1, Math.round(rarityBudget(rarity, level, rules) * share / (Number(rules.statCost?.[stat]) || 1))) };
        }
        if (entry.kind === 'consumable') item.effect = parseEffect(entry.effect);
        const worth = itemWorth({ ...item, effect: item.effect }, { level, rules });
        const price = Math.max(1, Math.round(worth * (prices.buy ?? 1) * (kind === 'fence' ? 0.8 : 1)));
        const note = entry.kind === 'equipment'
            ? [rarity, Object.entries(item.stats).map(([name, value]) => `${name} +${value}`).join(', ')].join(' · ')
            : entry.kind === 'consumable' ? entry.effect : '';
        return { ...item, effectText: entry.effect ?? '', note, price };
    });
}

/** What a trader offered before, with `items` added: the newest SEEN_KEPT names. */
export function rememberStock(seen = [], items = []) {
    const names = [...(seen ?? []), ...(items ?? []).map(item => item.name)];
    return [...new Set(names.reverse())].reverse().slice(-SEEN_KEPT);
}

/** `item` (shopStock's) bought for its price: { text, ok } — ok false when the purse cannot pay. */
export function buyIn(inventoryText, item, currency = DEFAULT_RULES.currency) {
    const paid = spendMoney(inventoryText, item.price, currency);
    if (!paid.ok) return { text: inventoryText, ok: false };
    const piece = { name: item.name, qty: 1, kind: item.kind === 'goods' ? 'goods' : item.kind, rarity: item.rarity, stats: item.stats ?? {}, slot: item.slot ?? null, ...(item.effectText ? { effect: item.effectText } : {}), ...(item.kind === 'goods' ? { note: '' } : {}) };
    return { text: addLoot(paid.text, { items: [piece] }, currency), ok: true };
}

/**
 * One trade as the story is told it: "sold 5 Rat Tail to Elke for 3 silver"; with `alone` false
 * (the trader already said, in the errand run) without the trader: "sold 5 Rat Tail for 3 silver".
 */
export function tradeLine(entry, currency = DEFAULT_RULES.currency, { alone = true } = {}) {
    const who = alone ? String(entry?.who ?? '').trim() : '';
    const money = amount => formatMoney(amount, currency);
    const to = who ? ` to ${who}` : '';
    const by = who ? ` by ${who}` : '';
    if (entry?.kind === 'buy') return `bought ${entry.name}${who ? ` from ${who}` : ''} for ${money(entry.total)}`;
    if (entry?.kind === 'sell') return `sold ${entry.qty > 1 ? `${entry.qty} ` : ''}${entry.name}${to} for ${money(entry.total)}`;
    // (0.5.44) A commission says how long, in the crafter's words, and when to come back.
    if (entry?.kind === 'order' && entry.span) {
        const sayer = who || (alone ? 'the crafter' : 'they');
        // "tomorrow morning (Goldwane 13, 09:00 am)"; a date alone once ("Goldwane 14, 03:00 pm").
        // Without a story clock the span is all there is: no "ready in about a day" after it.
        const back = /^in\b/i.test(String(entry.ready ?? '')) ? ''
            : entry.when && !String(entry.ready ?? '').toLowerCase().startsWith(String(entry.when).toLowerCase()) ? `${entry.when} (${entry.ready})` : entry.ready;
        return `commissioned ${entry.name}${who ? ` from ${who}` : ''}, made from ${entry.from.join(', ')}${entry.fee ? `, for ${money(entry.fee)}` : ''}; ${sayer} ${sayer === 'they' ? 'say' : 'says'} ${entry.span}${back ? `, ready ${back}` : ''}`;
    }
    if (entry?.kind === 'order') return `ordered ${entry.name}${who ? ` from ${who}` : ''}, made from ${entry.from.join(', ')}, ready ${entry.ready}${entry.fee ? `, for ${money(entry.fee)}` : ''}`;
    if (entry?.kind === 'craft') return `had ${entry.name} made${by} from ${entry.from.join(', ')}${entry.fee ? ` for ${money(entry.fee)}` : ''}`;
    if (entry?.kind === 'collect') return `collected ${entry.name}${who ? ` from ${who}` : ''}`;
    return '';
}

/**
 * The note the next reply is given after trades in the tab: what was done, with the amounts as
 * they are, for the story to tell in its own voice. '' when there is nothing to tell.
 */
export function tradeHandoff(entries, { name = 'The party', place = '', currency = DEFAULT_RULES.currency } = {}) {
    // (0.5.38) One errand run: the trades grouped by trader, in the order they were first visited.
    const groups = new Map();
    for (const entry of entries ?? []) {
        const line = tradeLine(entry, currency, { alone: false });
        if (!line) continue;
        const who = String(entry.who ?? '').trim();
        if (!groups.has(who)) groups.set(who, []);
        groups.get(who).push(line);
    }
    if (!groups.size) return '';
    const tail = `\nTell it briefly as part of the scene, in the story's own voice. No menus or game terms; keep the amounts and what was made exactly as they are (the Inventory already shows them).`;
    // One trader: plain lines, each saying who ("bought an Antidote from Elke for 7 copper").
    if (groups.size === 1) return `[Trade] Since the last reply, ${name} ${(entries ?? []).map(entry => tradeLine(entry, currency)).filter(Boolean).join(', ')}.${tail}`;
    const at = who => (!who ? '' : /^(?:the|a|an)\s/i.test(who) ? `at ${who}, ` : `with ${who}, `);
    const visits = [...groups.entries()].map(([who, lines]) => `${at(who)}${lines.join(', ')}`);
    const round = groups.size > 1 ? ` went round${place ? ` ${place}` : ''}:` : '';
    return `[Trade] Since the last reply, ${name}${round} ${visits.join('; ')}.${tail}`;
}
