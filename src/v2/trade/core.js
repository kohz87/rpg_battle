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
import { formatMoney, nameKey, oneCurrency, slotFromWord } from '../../items.js';
import {
    COMMISSIONERS, buyerKind, commissionHours, craftFee, craftSpan, isMaterial, itemWorth, kindOf, marketHere, placePrices,
    pricedLevel, readyAt, readyWords, sellPrice, shopStock, tradeLine,
} from '../../trade.js';
import { DEFAULT_RULES } from '../../rules.js';
import { craftPiece } from './craft-plan.js';
import { pcOf, sceneOf } from './calls.js';

export const DAY = 24 * 60;
/** The trader kinds the page offers (v1 0.5.38). */
export const TRADER_KINDS = Object.freeze(['general', 'apothecary', 'smith', 'crafter', 'fence', 'guild']);
/** Who a trader kind is in a told line when no name is given. */
export const TRADER_WHO = Object.freeze({ general: 'the general store', apothecary: 'the apothecary', smith: 'the smith', crafter: 'the bone-carver', fence: 'a fence', guild: 'the guild' });
// A scene kind that is a market by itself (SPEC §7 `place.kind`), beside v1's words in its name.
const MARKET_KINDS = ['settlement'];
// The most of one thing bought at once.
const MOST = 99;

/**
 * The error codes trade rejects with (SPEC §12, MODULES §F4): a rule refusing (no market here,
 * not ready yet, a piece still worn, a thing that cannot be sold, a trader who takes no
 * commissions) is REFUSED; a malformed request (a count that is no count, a missing name) INVALID.
 */
export const CODES = Object.freeze({ noMarket: 'REFUSED', notReady: 'REFUSED', refused: 'REFUSED', invalid: 'INVALID', notFound: 'NOT_FOUND', notEnough: 'NOT_ENOUGH', claimed: 'CLAIMED' });

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

// ---------------------------------------------------------------------------------------
// Market shortages (MODULES §F36)
//
// The story marks a supply problem with `! market Bluewatch — blockade on the river | until: …`
// and lifts it with `~ market Bluewatch — supplies back`. v1 had no shortage rules, so these are
// RPG Battle's own, kept conservative: while a shortage holds at a place, its shops do not restock
// (each keeps the stock of the day the shortage began, less what was bought since), and what they
// sell costs `shortagePrices` percent of the usual (setting, 150 by default; commissions there cost
// as much more, materials being short too). What they pay for the party's things is unchanged. It
// holds until the story lifts it; `until:` is kept as the story's words, for the tail and the screen.

export const SHORTAGE_PRICES = 150;
export const MAX_SHORTAGES = 20;

// ---------------------------------------------------------------------------------------
// Bookkeeping later replies write (B-b1r2-13, SPEC §2): each write is a new key `<what>#<rev>`
// (a place's shortage, a shop's purchase, a price paid), never a field of an entry an earlier reply
// made, so a reply deleted from the middle of the chat takes only its own writes with it and every
// later one still applies on replay. A write removes the ones it supersedes (the place's earlier
// shortage, the shop's purchases of another day, a higher price paid; a lift removes the place's
// shortage): Story Block 2.0.0-alpha.2 passes over the remove of a key that is already gone, so
// deleting the later reply brings the earlier write back, and deleting the earlier one leaves the
// later as it is. What holds now is read from them: a place's newest shortage write, a shop's
// purchases on its latest day, the least paid for a thing. An older chat's entries (kept under the
// bare key) are read the same way. MAX_SHOP_WRITES purchases are kept in all (the oldest go).
export const MAX_SHOP_WRITES = 500;
const WRITE = /#(?:\d+|n\d+)$/;

/** The keys of `record` written about `base` (its writes and an older chat's bare entry). */
export const writesOf = (record, base) => Object.keys(record ?? {}).filter(key => baseOf(key) === base);

/** The key a write is kept under: `<base>#<rev>` (else `#n<count>` when the host gives no rev). */
export function writeKey(record, base, rev) {
    if (Number.isInteger(rev) && rev > 0) return `${base}#${rev}`;
    let n = Object.keys(record ?? {}).length;
    while (Object.hasOwn(record ?? {}, `${base}#n${n}`)) n += 1;
    return `${base}#n${n}`;
}

/** What a key is about: `<base>` of `<base>#<rev>`, or the bare key of an older chat's entry. */
export const baseOf = key => String(key).replace(WRITE, '');

const revAt = (key, entry) => {
    const match = /#(\d+)$/.exec(String(key));
    return match ? Number(match[1]) : Number.isInteger(entry?.rev) ? entry.rev : 0;
};

/** The shortages that hold, as { [place key]: { place, reason, until, day, rev } }: each place's newest write unless it lifted. */
export function currentShortages(raw) {
    const newest = new Map();
    for (const [key, entry] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
        if (!entry || typeof entry !== 'object') continue;
        const base = baseOf(key);
        const at = revAt(key, entry);
        const was = newest.get(base);
        if (!was || at > was.at || (at === was.at && WRITE.test(key))) newest.set(base, { at, entry });
    }
    const out = {};
    for (const base of [...newest.keys()].sort()) {
        const { entry } = newest.get(base);
        if (entry.lifted) continue;
        const { lifted: _lifted, ...rest } = entry;
        out[base] = rest;
    }
    return out;
}

/** What each shop sold on its latest day: { [shop]: { day, bought: [def ids] } }, from its purchases in order. */
export function currentShops(raw) {
    const groups = new Map();
    for (const [key, entry] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
        if (!entry || typeof entry !== 'object') continue;
        const base = baseOf(key);
        if (!groups.has(base)) groups.set(base, []);
        groups.get(base).push({ at: revAt(key, entry), day: entry.day ?? null, bought: Array.isArray(entry.bought) ? entry.bought : [] });
    }
    const out = {};
    for (const [base, list] of groups) {
        list.sort((a, b) => a.at - b.at);
        const day = list.at(-1).day;
        out[base] = { day, bought: list.filter(entry => entry.day === day).flatMap(entry => entry.bought) };
    }
    return out;
}

/** The least paid for each thing: { [def id]: amount }. */
export function leastPaid(raw) {
    const out = {};
    for (const [key, each] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
        if (!Number.isInteger(each)) continue;
        const def = baseOf(key);
        if (!Object.hasOwn(out, def) || each < out[def]) out[def] = each;
    }
    return out;
}

/** The key a shortage is kept under: its place's first part, lowercased, spaces tidied ("bluewatch"). */
export const shortageKey = name => placeKey(name).replace(/\s+/g, ' ');

/** The percent a shortage charges (settings `shortagePrices`, 100–400). */
export function shortageRate(settings) {
    const value = settings?.shortagePrices;
    return Number.isInteger(value) ? Math.max(100, Math.min(400, value)) : SHORTAGE_PRICES;
}

const wordsIn = (outer, inner) => Boolean(inner) && ` ${outer} `.includes(` ${inner} `);

/**
 * The shortage that holds at `placeName`, or null: one kept under the place's key, else one whose
 * place's words are among the place's ("Bluewatch" at "Bluewatch Village") or the other way round.
 */
export function shortageAt(shortages, placeName) {
    const here = shortageKey(placeName);
    if (!here || !shortages || typeof shortages !== 'object') return null;
    // Own keys only (B-b1r2-6): a place keyed "constructor" must not find Object's own.
    if (Object.hasOwn(shortages, here)) return { key: here, ...shortages[here] };
    const key = Object.keys(shortages).sort().find(other => wordsIn(here, other) || wordsIn(other, here));
    return key ? { key, ...shortages[key] } : null;
}

/**
 * The world a trade happens in. `scene`: { place: { name, kind }, present }; `inventory`,
 * `trade`, `party`: the slices; `settings`: this module's; `now`: story minutes or null;
 * `currency`: the chat's one currency, Story Block's `inventory.currency` ({ name, short };
 * gold when it is not given). Amounts are whole numbers of it; only the words depend on it.
 */
export function makeWorld({ scene, inventory, trade, party, settings = {}, now = null, currency = null, packs = null }) {
    const rules = makeRules(settings.rules ?? null);
    const place = { name: String(scene?.place?.name ?? ''), kind: String(scene?.place?.kind ?? '') };
    const present = Array.isArray(scene?.present) ? scene.present : [];
    // The name first ("Bluewatch Village"), then the scene's kind as one more part ("settlement").
    const placeText = [place.name, place.kind].filter(Boolean).join(' | ');
    // (v1 0.5.46) The reader's word for this place (cheap, fair, dear), from the settings only.
    const level = pricedLevel(place.name, settings.placePrices);
    const base = placePrices(placeText, { level, rules });
    // (MODULES §F36) A shortage here: restock paused and buying dearer until the story lifts it.
    const shortages = currentShortages(trade?.shortages);
    const shortage = shortageAt(shortages, place.name);
    const rate = shortageRate(settings);
    const prices = shortage ? { ...base, buy: base.buy * rate / 100, shortage: rate } : base;
    let market = marketHere(placeText, present, { rules, priced: Boolean(level) });
    if (!market.open && MARKET_KINDS.includes(place.kind.toLowerCase())) market = { open: true, by: 'place' };
    const clock = typeof now === 'number' && Number.isFinite(now) ? Math.floor(now) : null;
    const pc = pcOf(party);
    return {
        place, present, placeText, level, prices, market, rules,
        plevel: pc.level, pcName: pc.name,
        now: clock, day: clock === null ? null : Math.floor(clock / DAY),
        shortage,
        inventory: { defs: inventory?.defs ?? {}, stacks: inventory?.stacks ?? {} },
        // What holds now, read from the writes (B-b1r2-13): the planners read these as before.
        trade: { orders: trade?.orders ?? {}, shops: currentShops(trade?.shops), shortages, paid: leastPaid(trade?.paid) },
        // Where this place's shops are kept: a known place's name when one is meant (shopPlaceOf).
        shopPlace: shopPlaceOf(place.name, packs?.places),
        currency: oneCurrency(currency),
        // The enabled packs' shops at this place (Story Block's packs.content), with their items' defs.
        packShops: packShopsAt(packs, place.name),
    };
}

// ---------------------------------------------------------------------------------------
// Pack shops (PACKS.md "shops")
//
// A pack may name the shops of a place (`{ name, kind, place, stock: [{ item: def id, qty?,
// price? }] }`). Where the enabled packs have shops for the place the party is in, those are the
// shops there and the generic traders (v1 shopStock) stand back; elsewhere the generic ones trade.
// A pack shop's line costs its `price` when the pack sets one, else the item's own `value` × the
// place's buy prices; a shortage raises both alike. `qty` is how many it has a day (one when
// unsaid); what was bought that day is counted off. Its trader kind (what it pays for the party's
// things) comes from its `kind` words ("general goods" → the general store, "apothecary").

const DEF_FIELDS = ['id', 'name', 'kind', 'rarity', 'value', 'stack', 'slot', 'stats', 'effect', 'tags', 'note'];

/** `packs.content` through a query function: { shops, items } (empty without packs). */
export function packsFrom(query) {
    const ask = kind => {
        if (typeof query !== 'function') return [];
        try {
            const list = query('packs.content', { kind });
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    };
    const shops = ask('shops');
    return { shops, items: shops.length ? ask('items') : [], places: ask('places') };
}

/**
 * The place the shops here belong to (B-b3-14): a known place (an enabled pack's, by its name or
 * an alias) the scene's place name means, so "Old Bluewatch" and "Bluewatch Village" are one market
 * when a pack says so; else the scene's place name as it is.
 */
export function shopPlaceOf(placeName, places) {
    const here = placeKey(placeName);
    if (!here || !Array.isArray(places)) return placeName;
    const known = places.find(entry => entry && typeof entry.name === 'string'
        && [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].some(name => placeKey(name) === here));
    return known ? known.name : placeName;
}

/** A shop's key part after the place: its slug ("watch-stores"). */
export const shopSlug = shop => slug(shop?.slug ?? shop?.name);

function packShopsAt(packs, placeName) {
    const here = placeKey(placeName);
    if (!here || !Array.isArray(packs?.shops) || !packs.shops.length) return [];
    const items = new Map((packs.items ?? []).filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
    return packs.shops.filter(shop => shop && typeof shop.place === 'string' && placeKey(shop.place) && (wordsIn(here, placeKey(shop.place)) || wordsIn(placeKey(shop.place), here)))
        .map(shop => ({
            name: clean(shop.name, 80), slug: shopSlug(shop), kindWords: clean(shop.kind ?? '', 60), keeper: clean(shop.keeper ?? '', 80),
            stock: (Array.isArray(shop.stock) ? shop.stock : []).map(line => {
                const item = items.get(typeof line === 'string' ? line : line?.item);
                if (!item) return null;
                const def = Object.fromEntries(DEF_FIELDS.filter(field => item[field] !== undefined).map(field => [field, JSON.parse(JSON.stringify(item[field]))]));
                return { def, qty: Number.isInteger(line?.qty) && line.qty > 0 ? line.qty : 1, price: Number.isInteger(line?.price) && line.price >= 0 ? line.price : null };
            }).filter(Boolean),
        }))
        .filter(shop => shop.name && shop.slug);
}

/** The pack shop `kind` names here: by its slug or name first, else the first of that trader kind; null when none. */
export function packShopFor(world, kind) {
    const said = clean(kind, 120).toLowerCase();
    if (!world.packShops?.length || !said) return null;
    return world.packShops.find(shop => shop.slug === slug(said) || shop.name.toLowerCase() === said)
        ?? world.packShops.find(shop => traderKind(shop.kindWords || shop.name, world.rules) === traderKind(said, world.rules))
        ?? null;
}

/** What a thing is worth (smallest unit): its def's own `value` when it has one, else v1's itemWorth. */
export function worthOf(def, world) {
    if (Number.isInteger(def?.value) && def.value > 0) return def.value;
    return itemWorth(legacyItem(def), { level: world.plevel, rules: world.rules });
}

/** What `buyer` pays for one `def` here: its worth × v1's sell rate × the buyer's taste × the place's sell prices. */
export function sellEach(def, buyer, world) {
    if (!(Number.isInteger(def?.value) && def.value > 0)) return sellPrice(legacyItem(def), { buyer, prices: world.prices, level: world.plevel, rules: world.rules });
    const t = { ...DEFAULT_RULES.trade, ...(world.rules?.trade ?? {}) };
    const pays = t.buyers?.[buyer]?.[kindOf(legacyItem(def))] ?? 1;
    return Math.max(1, Math.round(def.value * t.sellRate * pays * (world.prices.sell ?? 1)));
}

// The world as a query or a page sees it: a state, with the settings and query tools the host
// gives (the currency from `inventory.currency` through them). The story clock is the
// Director's (MODULES §C1 `director.time.minutes`) when it is there.
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
        currency: currencyFrom(env.query),
        packs: packsFrom(env.query),
    });
}

/** The chat's currency through a query function (`inventory.currency`), or null without one. */
export function currencyFrom(query) {
    if (typeof query !== 'function') return null;
    try {
        return query('inventory.currency') ?? null;
    } catch {
        return null;
    }
}

/** The money words of the chat's one currency: '13 gold'. */
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

/** The market here: { open, by, place, tier, buy, sell, level, day, shortage: { place, reason, until, prices } | null }. */
export function marketOf(world) {
    const shortage = world.shortage ? { place: world.shortage.place, reason: world.shortage.reason, until: world.shortage.until, prices: world.prices.shortage ?? SHORTAGE_PRICES } : null;
    return { open: world.market.open, by: world.market.by, place: world.place.name, tier: world.prices.tier, buy: world.prices.buy, sell: world.prices.sell, level: world.level, day: world.day, shortage };
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
 * What `kind` of trader has for sale here today: { shop, kind, day, open, shortage, items: [{ def,
 * price, note }] }, the same all day for this place and trader (v1 shopStock, seeded by place,
 * kind and story day), less what was bought from it that day. During a shortage `day` is the day
 * it began: no restock until it is lifted.
 */
export function stockOf(world, kind) {
    // A shortage pauses the restock: the stock stays the one of the day it began.
    const day = world.shortage && world.shortage.day !== null && world.shortage.day !== undefined ? world.shortage.day : world.day;
    const packed = packShopFor(world, kind);
    if (packed) return packStock(world, packed, day);
    const k = traderKind(kind, world.rules);
    const shop = shopKey(k, world.shopPlace ?? world.place.name);
    const all = shopStock({ kind: k, prices: world.prices, seed: `${shop}|${day ?? ''}`, seen: [], level: world.plevel, rules: world.rules });
    const kept = Object.hasOwn(world.trade.shops ?? {}, shop) ? world.trade.shops[shop] : null;
    const bought = kept && kept.day === day ? kept.bought ?? [] : [];
    const items = all.map(item => ({ def: stockDef(item, world), price: item.price, note: item.note })).filter(entry => !bought.includes(entry.def.id));
    return { shop, kind: k, day, open: world.market.open, shortage: Boolean(world.shortage), items };
}

/** A pack shop's stock today: its lines less what was bought that day, priced by the pack or by value. */
function packStock(world, packed, day) {
    const shop = `${placeKey(world.shopPlace ?? world.place.name)}|${packed.slug}`;
    const kept = Object.hasOwn(world.trade.shops ?? {}, shop) ? world.trade.shops[shop] : null;
    const bought = kept && kept.day === day ? kept.bought ?? [] : [];
    const rate = world.prices.shortage ? world.prices.shortage / 100 : 1;
    const items = packed.stock.map(line => {
        const left = line.qty - bought.filter(id => id === line.def.id).length;
        const price = line.price !== null ? Math.round(line.price * rate) : Math.round(worthOf(line.def, world) * (world.prices.buy ?? 1));
        return { def: line.def, price: Math.max(line.price === 0 ? 0 : 1, price), note: line.def.note ?? '', left };
    }).filter(entry => entry.left > 0);
    return { shop, kind: traderKind(packed.kindWords || packed.name, world.rules), name: packed.name, keeper: packed.keeper, pack: true, day, open: world.market.open, shortage: Boolean(world.shortage), items };
}

/** The shops here: the packs' for this place when there are any, else null (the generic traders). */
export function packShopsHere(world) {
    return world.packShops?.length ? world.packShops.map(shop => ({ slug: shop.slug, name: shop.name, kind: traderKind(shop.kindWords || shop.name, world.rules) })) : null;
}

/**
 * Whether a stack is a key item (Story Block 2.0.0-beta.1 `key: true`): the one notable item a reply's
 * story gave outside its goods budget. It is used, worn and given as any other, but has no cash
 * value: no trader buys it, and a commission counts it as worth 0, so story text never turns into
 * money past one reply's goods.
 */
export const isKeyItem = row => row?.key === true;

/** Selling `qty` of `stack` to `kind` (or `who`, read for their trade): what is paid. */
export function planSell(world, { stack, qty = 1, kind = null, who = '' } = {}) {
    if (!world.market.open) return noMarket(world);
    if (!isCount(qty)) return no(CODES.invalid, 'Say how many to sell: a whole number, at least 1.');
    const row = world.inventory.stacks[stack];
    const def = row ? world.inventory.defs[row.def] : null;
    if (!row || !def) return no(CODES.notFound, 'That is not in the inventory.');
    if (row.equipped) return no(CODES.refused, `Take off the ${def.name} before selling it.`);
    if (def.kind === 'money' || def.kind === 'quest') return no(CODES.refused, `The ${def.name} cannot be sold.`);
    if (isKeyItem(row)) return no(CODES.refused, `${def.name} is a key item; it can't be sold.`);
    if (row.qty < qty) return no(CODES.notEnough, row.qty ? `There ${row.qty === 1 ? 'is' : 'are'} only ${row.qty} ${def.name}.` : `There is no ${def.name} left.`);
    const buyer = traderKind(kind || who, world.rules);
    // A thing bought (or commissioned) never sells for more than was paid for it (B-b3-13, -14).
    const paid = Object.hasOwn(world.trade.paid ?? {}, def.id) ? world.trade.paid[def.id] : undefined;
    const each = Number.isInteger(paid) ? Math.min(sellEach(def, buyer, world), paid) : sellEach(def, buyer, world);
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
        if (said.slice(0, at) !== placeKey(world.shopPlace ?? world.place.name)) return no(CODES.notFound, 'That shop is not here.');
        kind = said.slice(at + 1);
    }
    const stock = stockOf(world, kind);
    const name = stock.pack ? (clean(who) || stock.name) : whoOf(who || kind, stock.kind);
    const entry = stock.items.find(item => item.def.id === def);
    if (!entry) return no(CODES.notFound, `${name.charAt(0).toUpperCase()}${name.slice(1)} has none of that left today.`);
    // A piece of gear on the shelf is one piece; a supply (draughts, rope) is sold by the count.
    if (entry.def.kind === 'equipment' && qty > 1 && !stock.pack) return no(CODES.notEnough, `There is only one ${entry.def.name}.`);
    if (stock.pack && qty > entry.left) return no(CODES.notEnough, `${name} has only ${entry.left} ${entry.def.name} left today.`);
    const total = entry.price * qty;
    const line = tradeLine({ kind: 'buy', name: qty > 1 ? `${qty} ${entry.def.name}` : entry.def.name, total, who: name }, world.currency);
    return { ok: true, type: 'buy', shop: stock.shop, kind: stock.kind, day: stock.day, def: entry.def, qty, each: entry.price, total, who: name, line, pack: Boolean(stock.pack) };
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
    if (!COMMISSIONERS.includes(kind)) return no(CODES.refused, 'Only a smith, a crafter (bone-carver, tanner…) or an apothecary takes commissions.');
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
        if (row.equipped || !isMaterial(legacyItem(def))) return no(CODES.refused, `The ${def.name} is not a material a piece can be made from.`);
        if (row.qty < qty) return no(CODES.notEnough, `There ${row.qty === 1 ? 'is' : 'are'} only ${row.qty} ${def.name}.`);
        parts.push({ stack, def, qty, key: isKeyItem(row) });
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
    // The piece is worth what went into it (B-b3-13): its materials' worth and the fee; and it
    // never sells for more than the fee and what the materials would have fetched (`cap`, kept as
    // what was paid for it when it is collected), so a commission mints nothing.
    // A key item counts as worth 0 (isKeyItem).
    const inputs = parts.reduce((sum, part) => sum + (part.key ? 0 : worthOf(part.def, world) * part.qty), 0);
    const raw = parts.reduce((sum, part) => sum + (part.key ? 0 : Math.min(...TRADER_KINDS.map(buyer => sellEach(part.def, buyer, world))) * part.qty), 0);
    const def = {
        name: made.name, kind: 'equipment', rarity: made.rarity, value: Math.max(1, inputs + fee), stack: false,
        slot: made.slot, stats: { ...made.stats }, effect: {}, tags: [...(made.tags ?? [])], note,
    };
    const from = parts.map(part => (part.qty > 1 ? `${part.qty} ${part.def.name}` : part.def.name));
    const line = tradeLine({ kind: 'order', name: made.name, who: said, from, fee, span, ready: when, when }, world.currency);
    return {
        ok: true, type: 'commission', piece: def, materials: parts.map(part => ({ stack: part.stack, def: part.def.id, qty: part.qty })),
        fee, cap: fee + raw, hours, ready, span, when, crafter: said, kind, place: world.place.name, line,
    };
}

/** Whether `order` can be collected at `now`: its time has come, or there is no clock to say. */
export function orderDue(order, now) {
    return order?.ready === null || order?.ready === undefined || now === null || now >= order.ready;
}

/** Collecting `order`: only when it is ready and at a market. */
export function planCollect(world, { order } = {}) {
    if (!world.market.open) return noMarket(world);
    const found = typeof order === 'string' && Object.hasOwn(world.trade.orders ?? {}, order) ? world.trade.orders[order] : null;
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
