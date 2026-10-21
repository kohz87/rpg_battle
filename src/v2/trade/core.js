// RPG Battle v2, trade part: the market, prices, stock and what each trade would do (pure).
//
// Everything here works on a plain "world": the scene, the inventory and trade slices, the
// player character's level, the story clock and the reader's settings, as either a command's
// ctx or a query's state gives them. Each plan* function says what a trade would do, with the
// code's numbers, or why it cannot be done ({ ok: false, code, message }); the commands apply
// a plan through Story Block's inventory and wallet commands, and trade.quote returns it as it
// is, so a preview and the trade itself can never disagree. The numbers are v1's (src/trade.js:
// itemWorth, placePrices, marketHere, sellPrice, craftFee, shopStock, commissionHours).

import { makeRules } from '../../rules.js';
import { formatMoney, nameKey, slotFromWord } from '../../items.js';
import {
    COMMISSIONERS, buyerKind, commissionHours, craftFee, craftSpan, isMaterial, itemWorth, marketHere, placePrices,
    pricedLevel, readyAt, readyWords, sellPrice, shopStock, tradeLine,
} from '../../trade.js';
import { craftPiece } from './craft-plan.js';
import { currencyOf, pcOf, sceneOf } from './calls.js';

export const DAY = 24 * 60;
/** The trader kinds the page offers (v1 0.5.38). */
export const TRADER_KINDS = Object.freeze(['general', 'apothecary', 'smith', 'crafter', 'fence', 'guild']);
/** Who a trader kind is in a told line when no name is given. */
export const TRADER_WHO = Object.freeze({ general: 'the general store', apothecary: 'the apothecary', smith: 'the smith', crafter: 'the bone-carver', fence: 'a fence', guild: 'the guild' });
// A scene kind that is a market by itself (SPEC §7 `place.kind`), beside v1's words in its name.
const MARKET_KINDS = ['settlement'];
// The most of one thing bought at once.
const MOST = 99;

/** The error codes trade rejects with (SPEC §12): no market and not ready are INVALID requests. */
export const CODES = Object.freeze({ noMarket: 'INVALID', notReady: 'INVALID', invalid: 'INVALID', notFound: 'NOT_FOUND', notEnough: 'NOT_ENOUGH', claimed: 'CLAIMED' });

const no = (code, message) => ({ ok: false, code, message });
const isCount = (value, max = Infinity) => Number.isInteger(value) && value >= 1 && value <= max;
const clean = (value, max = 80) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The first part of a place's name, lowercased: what a shop is kept under (v1 placeKey). */
export const placeKey = name => String(name ?? '').split('|')[0].trim().toLowerCase();
/** A trader kind's shop at a place: `bluewatch village|smith`. */
export const shopKey = (kind, placeName) => `${placeKey(placeName)}|${kind}`;

/** A slug for a def id: lowercase words joined by '-'. */
export const slug = name => String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'thing';

/** Settings as given: an object, a getter (`settings(moduleId)`), or nothing. */
export function settingsOf(source, id = 'rpg-battle') {
    const value = typeof source === 'function' ? source(id) : source;
    return value && typeof value === 'object' ? value : {};
}

/**
 * The world a trade happens in. `scene`: { place: { name, kind }, present }; `inventory`,
 * `trade`, `party`: the slices; `settings`: this module's; `now`: story minutes or null.
 */
export function makeWorld({ scene, inventory, trade, party, settings = {}, now = null, hook = null }) {
    const rules = makeRules(settings.rules ?? null);
    const place = { name: String(scene?.place?.name ?? ''), kind: String(scene?.place?.kind ?? '') };
    const present = Array.isArray(scene?.present) ? scene.present : [];
    // The name first ("Bluewatch Village"), then the scene's kind as one more part ("settlement").
    const placeText = [place.name, place.kind].filter(Boolean).join(' | ');
    // (v1 0.5.46) The reader's word for this place (cheap, fair, dear), from the settings only.
    const level = pricedLevel(place.name, settings.placePrices);
    const prices = placePrices(placeText, { level, rules });
    let market = marketHere(placeText, present, { rules, priced: Boolean(level) });
    if (!market.open && MARKET_KINDS.includes(place.kind.toLowerCase())) market = { open: true, by: 'place' };
    const clock = typeof now === 'number' && Number.isFinite(now) ? Math.floor(now) : null;
    const pc = pcOf(party);
    return {
        place, present, placeText, level, prices, market, rules,
        plevel: pc.level, pcName: pc.name,
        now: clock, day: clock === null ? null : Math.floor(clock / DAY),
        inventory: { defs: inventory?.defs ?? {}, stacks: inventory?.stacks ?? {} },
        trade: { orders: trade?.orders ?? {}, shops: trade?.shops ?? {} },
        currency: currencyOf({ hook }, rules.currency),
    };
}

// The world as a query or a page sees it: a state, with the settings and hook the host gives.
// The story clock is the Director's (MODULES §C1 `director.time.minutes`) when it is there.
export function worldFromState(state, env = {}) {
    const domains = state?.domains ?? {};
    const minutes = domains.director?.time?.minutes;
    return makeWorld({
        scene: sceneOf({ query: env.query ?? null, read: name => domains[name] ?? null }),
        inventory: domains.inventory,
        trade: domains.trade,
        party: domains.party,
        settings: settingsOf(env.settings),
        now: Number.isInteger(minutes) ? minutes : null,
        hook: env.hook ?? null,
    });
}

/** The money words of the chat's coins: '1 silver, 3 copper'. */
export const money = (world, amount) => formatMoney(amount, world.currency);

/** What a trade line is told as: "Ren sold 5 Rat Tail to the general store for 3 silver." */
export function summaryOf(world, line) {
    const who = world.pcName || 'The party';
    return `${who} ${line}.`;
}

/** A def as v1's pricing reads an item (src/trade.js kindOf: a slot is gear, an effect a consumable). */
export function legacyItem(def) {
    const effect = def?.effect && typeof def.effect === 'object' && Object.keys(def.effect).length ? def.effect : null;
    return { name: def?.name ?? '', kind: def?.kind ?? 'goods', rarity: def?.rarity ?? 'common', slot: def?.slot ?? null, stats: def?.stats ?? {}, effect, tags: def?.tags ?? [], note: def?.note ?? '' };
}

/** A trader kind from a kind ('smith') or a name or trade ("Hesk the bone-carver"); 'general' when nothing says. */
export function traderKind(value, rules) {
    const said = clean(value);
    if (!said) return 'general';
    if (TRADER_KINDS.includes(said.toLowerCase())) return said.toLowerCase();
    return buyerKind(said, rules);
}

// Who a told line names: the name given, else the kind's own words.
const whoOf = (value, kind) => (TRADER_KINDS.includes(clean(value).toLowerCase()) || !clean(value) ? TRADER_WHO[kind] : clean(value));

function noMarket(world) {
    const where = world.place.name ? ` (${world.place.name})` : '';
    return no(CODES.noMarket, `No market here${where}. Trade in a settlement, or with a trader on the road.`);
}

/** The market here: { open, by, place, tier, buy, sell, level, day }. */
export function marketOf(world) {
    return { open: world.market.open, by: world.market.by, place: world.place.name, tier: world.prices.tier, buy: world.prices.buy, sell: world.prices.sell, level: world.level, day: world.day };
}

// A stock item (v1 shopStock's) as the inventory def it is bought as. Gear's stats are sized
// to its rarity and the buyer's level, so both are in its id: the same id is the same thing.
function stockDef(item, world) {
    const gear = item.kind === 'equipment';
    const id = gear ? `trade/${slug(item.name)}-${item.rarity}-l${world.plevel}` : `trade/${slug(item.name)}`;
    const value = itemWorth({ ...item }, { level: world.plevel, rules: world.rules });
    return {
        id, name: item.name, kind: item.kind, rarity: item.rarity, value, stack: !gear, slot: item.slot ?? null,
        stats: { ...(item.stats ?? {}) }, effect: item.effect ? { ...item.effect } : {}, tags: [...(item.tags ?? [])], note: item.note ?? '',
    };
}

/**
 * What `kind` of trader has for sale here today: { shop, kind, day, open, items: [{ def, price,
 * note }] }, the same all day for this place and trader (v1 shopStock, seeded by place, kind
 * and story day), less what was bought from it today.
 */
export function stockOf(world, kind) {
    const k = traderKind(kind, world.rules);
    const shop = shopKey(k, world.place.name);
    const all = shopStock({ kind: k, prices: world.prices, seed: `${shop}|${world.day ?? ''}`, seen: [], level: world.plevel, rules: world.rules });
    const kept = world.trade.shops[shop];
    const bought = kept && kept.day === world.day ? kept.bought ?? [] : [];
    const items = all.map(item => ({ def: stockDef(item, world), price: item.price, note: item.note })).filter(entry => !bought.includes(entry.def.id));
    return { shop, kind: k, day: world.day, open: world.market.open, items };
}

/** Selling `qty` of `stack` to `kind` (or `who`, read for their trade): what is paid. */
export function planSell(world, { stack, qty = 1, kind = null, who = '' } = {}) {
    if (!world.market.open) return noMarket(world);
    if (!isCount(qty)) return no(CODES.invalid, 'Say how many to sell: a whole number, at least 1.');
    const row = world.inventory.stacks[stack];
    const def = row ? world.inventory.defs[row.def] : null;
    if (!row || !def) return no(CODES.notFound, 'That is not in the inventory.');
    if (row.equipped) return no(CODES.invalid, `Take off the ${def.name} before selling it.`);
    if (def.kind === 'money' || def.kind === 'quest') return no(CODES.invalid, `The ${def.name} cannot be sold.`);
    if (row.qty < qty) return no(CODES.notEnough, row.qty ? `There ${row.qty === 1 ? 'is' : 'are'} only ${row.qty} ${def.name}.` : `There is no ${def.name} left.`);
    const buyer = traderKind(kind || who, world.rules);
    const each = sellPrice(legacyItem(def), { buyer, prices: world.prices, level: world.plevel, rules: world.rules });
    const total = each * qty;
    const name = whoOf(who || kind, buyer);
    const line = tradeLine({ kind: 'sell', name: def.name, qty, total, who: name }, world.currency);
    return { ok: true, type: 'sell', stack, def: def.id, name: def.name, qty, each, total, buyer, who: name, line };
}

/** Buying `qty` of `def` from `shop` (a stock's key, or a trader kind): what it costs. */
export function planBuy(world, { shop, def, qty = 1, who = '' } = {}) {
    if (!world.market.open) return noMarket(world);
    if (!isCount(qty, MOST)) return no(CODES.invalid, `Say how many to buy: a whole number from 1 to ${MOST}.`);
    const said = clean(shop, 120);
    let kind = said;
    if (said.includes('|')) {
        const at = said.lastIndexOf('|');
        if (said.slice(0, at) !== placeKey(world.place.name)) return no(CODES.notFound, 'That shop is not here.');
        kind = said.slice(at + 1);
    }
    const stock = stockOf(world, kind);
    const name = whoOf(who || kind, stock.kind);
    const entry = stock.items.find(item => item.def.id === def);
    if (!entry) return no(CODES.notFound, `${name.charAt(0).toUpperCase()}${name.slice(1)} has none of that left today.`);
    // A piece of gear on the shelf is one piece; a supply (draughts, rope) is sold by the count.
    if (entry.def.kind === 'equipment' && qty > 1) return no(CODES.notEnough, `There is only one ${entry.def.name}.`);
    const total = entry.price * qty;
    const line = tradeLine({ kind: 'buy', name: qty > 1 ? `${qty} ${entry.def.name}` : entry.def.name, total, who: name }, world.currency);
    return { ok: true, type: 'buy', shop: stock.shop, kind: stock.kind, day: stock.day, def: entry.def, qty, each: entry.price, total, who: name, line };
}

/**
 * Commissioning `piece` (a name, or { name, slot }) from `crafter` (a kind or a name) made from
 * `materials` ([{ stack, qty }]): the piece, the fee now, and when it is ready by the crafter's
 * time (v1 0.5.44: rarity span, the day's draw, their line, the place).
 */
export function planCommission(world, { piece, materials, crafter } = {}) {
    if (!world.market.open) return noMarket(world);
    const who = clean(crafter);
    if (!who) return no(CODES.invalid, 'Say who makes it.');
    const kind = traderKind(who, world.rules);
    if (!COMMISSIONERS.includes(kind)) return no(CODES.invalid, 'Only a smith, a crafter (bone-carver, tanner…) or an apothecary takes commissions.');
    const name = clean(typeof piece === 'string' ? piece : piece?.name, 60);
    if (!name) return no(CODES.invalid, 'Name the piece first.');
    const slot = typeof piece === 'object' && piece?.slot ? slotFromWord(piece.slot) : null;
    if (!Array.isArray(materials) || !materials.length) return no(CODES.invalid, 'Pick what it is made from.');
    // The same stack picked twice counts once, with both counts.
    const picked = new Map();
    for (const entry of materials) {
        if (!isCount(entry?.qty ?? 1)) return no(CODES.invalid, 'Say how many of each material: a whole number, at least 1.');
        picked.set(entry?.stack, (picked.get(entry?.stack) ?? 0) + (entry?.qty ?? 1));
    }
    const parts = [];
    for (const [stack, qty] of picked) {
        const row = world.inventory.stacks[stack];
        const def = row ? world.inventory.defs[row.def] : null;
        if (!row || !def) return no(CODES.notFound, 'One of those materials is not in the inventory.');
        if (row.equipped || !isMaterial(legacyItem(def))) return no(CODES.invalid, `The ${def.name} is not a material a piece can be made from.`);
        if (row.qty < qty) return no(CODES.notEnough, `There ${row.qty === 1 ? 'is' : 'are'} only ${row.qty} ${def.name}.`);
        parts.push({ stack, def, qty });
    }
    const made = craftPiece({ name, slot, parts }, { level: world.plevel, rules: world.rules });
    const fee = craftFee(made, { prices: world.prices, level: world.plevel, rules: world.rules });
    const hours = commissionHours(made, { crafter: kind, tier: world.prices.tier, seed: `${placeKey(world.place.name)}|${kind}|${nameKey(name)}|${world.day ?? ''}`, rules: world.rules });
    const ready = readyAt(hours, world.now);
    const span = craftSpan(hours);
    const when = (ready !== null && readyWords(ready, world.now, null)) || `in about ${span}`;
    const said = whoOf(who, kind);
    const stats = Object.entries(made.stats).map(([stat, value]) => `${stat} +${value}`).join(', ');
    const note = [made.rarity, [stats, ...(made.tags ?? [])].filter(Boolean).join(', '), made.slot].filter(Boolean).join(' · ');
    const def = {
        name: made.name, kind: 'equipment', rarity: made.rarity, value: itemWorth(made, { level: world.plevel, rules: world.rules }), stack: false,
        slot: made.slot, stats: { ...made.stats }, effect: {}, tags: [...(made.tags ?? [])], note,
    };
    const from = parts.map(part => (part.qty > 1 ? `${part.qty} ${part.def.name}` : part.def.name));
    const line = tradeLine({ kind: 'order', name: made.name, who: said, from, fee, span, ready: when, when }, world.currency);
    return {
        ok: true, type: 'commission', piece: def, materials: parts.map(part => ({ stack: part.stack, def: part.def.id, qty: part.qty })),
        fee, hours, ready, span, when, crafter: said, kind, place: world.place.name, line,
    };
}

/** Whether `order` can be collected at `now`: its time has come, or there is no clock to say. */
export function orderDue(order, now) {
    return order?.ready === null || order?.ready === undefined || now === null || now >= order.ready;
}

/** Collecting `order`: only when it is ready and at a market. */
export function planCollect(world, { order } = {}) {
    if (!world.market.open) return noMarket(world);
    const found = world.trade.orders[order];
    if (!found) return no(CODES.notFound, 'There is no such order.');
    const name = found.piece?.name ?? 'The piece';
    if (!orderDue(found, world.now)) {
        const when = readyWords(found.ready, world.now, null) || 'later';
        return no(CODES.notReady, `${name} is not ready yet: ${found.crafter || 'the crafter'} said ${when}.`);
    }
    const line = tradeLine({ kind: 'collect', name, who: found.crafter }, world.currency);
    return { ok: true, type: 'collect', order: found.id, piece: found.piece, crafter: found.crafter, line };
}

/** Every order, oldest first (by ready time, then id), with whether it is due. */
export function ordersOf(world) {
    return Object.values(world.trade.orders)
        .map(order => ({ ...order, due: orderDue(order, world.now) }))
        .sort((a, b) => (a.ready ?? -1) - (b.ready ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
