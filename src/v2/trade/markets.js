// RPG Battle v2, trade part: a place's prices from what kind of market it is (MODULES §F107). Pure.
//
// v1 guessed a place's prices from words in its name ("Harbour", "Royal"): that guess is now the
// `guessPrices` setting, off by default. Instead a place's prices come in layers:
//
// 1. its **settlement type** (hamlet, village, town, city, capital, outpost, camp): buy and sell
//    factors and how much one trader has (SETTLEMENT_TYPES; a capital dearer with more, a village
//    cheaper with little);
// 2. its **environment tags** (coastal, river, port, mountain, mining, forest, desert, farmland,
//    frontier, swamp): a factor per item category (ENVIRONMENT_TAGS; fish cheaper on the coast, ore in a
//    mining town, everything dearer on the frontier), all of a place's tags together held to
//    ENV_CAP (±30 %) for any one category;
// 3. a **pack** (Story Block's `packs.markets`: `markets` content types and tags laid over the built-in
//    ones, its places' `market` and `tags`) and a **lorebook** entry's `market: town; coastal, port`
//    line for its place (with the place's own `buy` and `sell` when it gives them).
//
// Where a place's type and tags come from, first that names one: the lorebook's line for that place,
// the pack's place (`market`/`tags`, else its map `kind` when that is a type), the scene's place kind
// when that is a type; with `guessPrices` on, v1's words in the name. Unknown: every factor is 1. The
// story never sets a price: it only names the place (and its kind), and code looks the rest up.

export const SETTLEMENT_TYPES = Object.freeze({
    camp: Object.freeze({ buy: 1.15, sell: 0.8, stock: Object.freeze([2, 4]), tier: 'remote' }),
    outpost: Object.freeze({ buy: 1.1, sell: 0.85, stock: Object.freeze([3, 5]), tier: 'remote' }),
    hamlet: Object.freeze({ buy: 0.9, sell: 0.8, stock: Object.freeze([3, 5]), tier: 'remote' }),
    village: Object.freeze({ buy: 0.9, sell: 0.85, stock: Object.freeze([4, 6]), tier: 'village' }),
    town: Object.freeze({ buy: 1, sell: 1, stock: Object.freeze([5, 7]), tier: 'town' }),
    city: Object.freeze({ buy: 1.1, sell: 1.05, stock: Object.freeze([6, 9]), tier: 'city' }),
    capital: Object.freeze({ buy: 1.2, sell: 1.1, stock: Object.freeze([8, 11]), tier: 'capital' }),
});

// What a place of no known type trades at: town prices and stock.
const USUAL = Object.freeze({ buy: 1, sell: 1, stock: Object.freeze([5, 7]), tier: 'town' });

// A place kind that means a type (the scene's `kind:`, a pack map's `kind`), beside the type names.
const KIND_TYPES = Object.freeze({
    'trading-post': 'outpost', waystation: 'outpost', fort: 'outpost', 'market-town': 'town', port: 'town', harbour: 'town',
    harbor: 'town', metropolis: 'city', 'fortress-city': 'city', 'royal-city': 'capital', steading: 'hamlet', homestead: 'hamlet',
});

export const ENVIRONMENT_TAGS = Object.freeze({
    coastal: Object.freeze({ fish: 0.8, salt: 0.9 }),
    river: Object.freeze({ fish: 0.85 }),
    port: Object.freeze({ all: 0.95, fish: 0.9 }),
    mountain: Object.freeze({ ore: 0.8, metal: 0.9, grain: 1.15 }),
    mining: Object.freeze({ ore: 0.75, metal: 0.85, grain: 1.1 }),
    forest: Object.freeze({ timber: 0.75, herbs: 0.85, cloth: 0.95 }),
    desert: Object.freeze({ all: 1.15, salt: 0.9 }),
    farmland: Object.freeze({ grain: 0.75, cloth: 0.95 }),
    frontier: Object.freeze({ all: 1.15 }),
    swamp: Object.freeze({ herbs: 0.8, all: 1.05 }),
});

/** All of a place's tags together move one category by at most this share either way. */
export const ENV_CAP = 0.3;

// The item categories tags price, in the order an item is put in one: its tags first, then the
// words of its name (and a material's note). A thing in none is priced by `all` alone.
export const CATEGORIES = Object.freeze(['fish', 'salt', 'ore', 'grain', 'gems', 'herbs', 'timber', 'cloth', 'metal']);
const CATEGORY_WORDS = Object.freeze({
    fish: ['fish', 'trout', 'salmon', 'eel', 'carp', 'pike', 'perch', 'herring', 'cod', 'crab', 'oyster', 'shellfish', 'clam', 'mussel', 'shrimp'],
    salt: ['salt', 'salts'],
    ore: ['ore', 'ores', 'filings', 'ingot', 'ingots', 'nugget', 'nuggets', 'coal'],
    grain: ['grain', 'wheat', 'barley', 'oats', 'rye', 'flour', 'bread', 'rations', 'meal', 'porridge', 'ale', 'beer', 'food'],
    gems: ['gem', 'gems', 'jewel', 'ruby', 'sapphire', 'emerald', 'diamond', 'pearl', 'crystal', 'ring', 'amulet', 'necklace'],
    herbs: ['herb', 'herbs', 'moss', 'root', 'leaf', 'leaves', 'salve', 'draught', 'potion', 'tonic', 'antidote', 'elixir', 'poultice', 'remedy'],
    timber: ['wood', 'wooden', 'timber', 'plank', 'planks', 'lumber', 'log', 'logs', 'charcoal', 'bow', 'arrow', 'arrows', 'staff', 'torch'],
    cloth: ['cloth', 'wool', 'woollen', 'linen', 'silk', 'leather', 'hide', 'pelt', 'fur', 'cloak', 'blanket', 'bedroll', 'coat', 'gambeson', 'mantle'],
    metal: ['iron', 'steel', 'bronze', 'copper', 'tin', 'metal', 'sword', 'axe', 'mace', 'spear', 'dagger', 'helm', 'mail', 'shield', 'buckler'],
});
// Gear that is not said to be of something else is metal (a smith's work).
const METAL_SLOTS = new Set(['weapon', 'offhand', 'armour', 'armor', 'head', 'hands']);

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isFactor = value => typeof value === 'number' && Number.isFinite(value) && value >= 0.25 && value <= 4;
const words = text => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
const keyOf = text => String(text ?? '').split('|')[0].replace(/\s+/g, ' ').trim().toLowerCase();
const typeWord = text => String(text ?? '').trim().toLowerCase().replace(/\s+/g, '-');

/** The category an item is priced in (CATEGORIES), or null. */
export function categoryOf(def) {
    const tags = (Array.isArray(def?.tags) ? def.tags : []).map(tag => String(tag).toLowerCase());
    for (const category of CATEGORIES) if (tags.includes(category)) return category;
    const said = new Set([...words(def?.name), ...(def?.kind === 'material' ? words(def?.note) : []), ...tags.flatMap(words)]);
    for (const category of CATEGORIES) if (CATEGORY_WORDS[category].some(word => said.has(word))) return category;
    if (def?.kind === 'consumable') return 'herbs';
    if (def?.kind === 'equipment' && METAL_SLOTS.has(String(def?.slot ?? ''))) return 'metal';
    return null;
}

/** The settlement types and tags in force: the built-in ones with a pack's (`packs.markets`) laid over them. */
export function marketTables(markets = null) {
    const types = Object.fromEntries(Object.entries(SETTLEMENT_TYPES).map(([name, type]) => [name, { ...type, stock: [...type.stock] }]));
    const tags = Object.fromEntries(Object.entries(ENVIRONMENT_TAGS).map(([name, tag]) => [name, { ...tag }]));
    for (const record of Array.isArray(markets?.types) ? markets.types : []) {
        if (!isRecord(record) || typeof record.type !== 'string') continue;
        const base = types[record.type] ?? { ...USUAL, stock: [...USUAL.stock] };
        types[record.type] = {
            buy: isFactor(record.buy) ? record.buy : base.buy,
            sell: isFactor(record.sell) ? record.sell : base.sell,
            stock: Array.isArray(record.stock) && record.stock.length === 2 ? [...record.stock] : base.stock,
            tier: base.tier,
            pack: record.pack ?? null,
        };
    }
    for (const record of Array.isArray(markets?.tags) ? markets.tags : []) {
        if (!isRecord(record) || typeof record.tag !== 'string' || !isRecord(record.prices)) continue;
        tags[record.tag] = Object.fromEntries(Object.entries(record.prices).filter(([, value]) => isFactor(value)));
    }
    return { types, tags };
}

// A place entry (packs.markets' places, a pack map's places) that `name` means: its name or an alias.
function placeNamed(list, name) {
    const here = keyOf(name);
    if (!here || !Array.isArray(list)) return null;
    return list.find(entry => isRecord(entry) && [entry.place ?? entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].some(other => keyOf(other) === here)) ?? null;
}

const typeIn = (kind, types) => {
    const word = typeWord(kind);
    if (!word) return null;
    if (Object.hasOwn(types, word)) return word;
    return Object.hasOwn(KIND_TYPES, word) && Object.hasOwn(types, KIND_TYPES[word]) ? KIND_TYPES[word] : null;
};

/**
 * What kind of market the scene's place is: `{ type, tags, from, buy, sell, stock, tier, factors, own }`.
 * `place`: the scene's `{ name, kind, tags? }`; `markets`: Story Block's `packs.markets` answer (or null);
 * `places`: the packs' map places (`packs.content({ kind: 'places' })`). `from` says where the type came
 * from ('lorebook', 'pack', 'map', 'scene', or null when nothing names it); `factors` is the combined
 * environment factor per category (and `all`), held to ENV_CAP. `own`: the place's own buy/sell (lorebook).
 */
export function marketAt(place, { markets = null, places = null } = {}) {
    const { types, tags: tagTable } = marketTables(markets);
    const listed = Array.isArray(markets?.places) ? markets.places : [];
    const lore = placeNamed(listed.filter(entry => entry?.from === 'lorebook'), place?.name);
    const packed = placeNamed(listed.filter(entry => entry?.from !== 'lorebook'), place?.name);
    const mapped = placeNamed(places, place?.name);
    let type = null;
    let from = null;
    let tags = [];
    const take = (entry, source, kind = null) => {
        if (type) return;
        const named = entry?.type ?? entry?.market;
        const found = named && Object.hasOwn(types, named) ? named : kind ? typeIn(kind, types) : null;
        if (!found) return;
        type = found;
        from = source;
        tags = Array.isArray(entry?.tags) ? entry.tags.filter(tag => typeof tag === 'string') : [];
    };
    take(lore, 'lorebook');
    take(packed, 'pack');
    take(mapped, 'map', mapped?.kind);
    take({ tags: place?.tags }, 'scene', place?.kind);
    // Tags the place's own entries give when its type came from further down.
    if (!tags.length) tags = (lore?.tags?.length ? lore.tags : packed?.tags?.length ? packed.tags : Array.isArray(place?.tags) ? place.tags : []).filter(tag => typeof tag === 'string');
    tags = [...new Set(tags.map(tag => typeWord(tag)).filter(tag => Object.hasOwn(tagTable, tag)))].slice(0, 8);
    const base = type ? types[type] : USUAL;
    const own = lore && (isFactor(lore.buy) || isFactor(lore.sell)) ? { ...(isFactor(lore.buy) ? { buy: lore.buy } : {}), ...(isFactor(lore.sell) ? { sell: lore.sell } : {}) } : null;
    const factors = {};
    for (const tag of tags) {
        for (const [category, value] of Object.entries(tagTable[tag])) factors[category] = (factors[category] ?? 1) * value;
    }
    const clamp = value => Math.min(1 + ENV_CAP, Math.max(1 - ENV_CAP, value));
    for (const category of Object.keys(factors)) factors[category] = clamp(factors[category]);
    return {
        type, tags, from,
        buy: own?.buy ?? base.buy, sell: own?.sell ?? base.sell,
        stock: [...base.stock], tier: base.tier, factors, own,
    };
}

/** The environment factor for one def at `market` (marketAt): its category's with `all`, held to ENV_CAP. */
export function goodsFactor(def, market) {
    const factors = market?.factors ?? {};
    const all = factors.all ?? 1;
    const category = categoryOf(def);
    const own = category && factors[category] !== undefined ? factors[category] : 1;
    return Math.min(1 + ENV_CAP, Math.max(1 - ENV_CAP, own * all));
}

const percent = factor => {
    const n = Math.round((factor - 1) * 100);
    return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}%`;
};
const capital = text => (text ? text.charAt(0).toUpperCase() + text.slice(1).replace(/-/g, ' ') : '');

/**
 * Why prices here are what they are, one line for the Trade screen: "Town · coastal, port: fish −24%,
 * everything −5%", "City: prices +10%, pays +5%", "Usual prices (no market type known here)".
 */
export function marketWhy(market) {
    if (!market?.type) return 'Usual prices (no market type known here)';
    const head = [capital(market.type)];
    const type = [market.buy !== 1 ? `prices ${percent(market.buy)}` : '', market.sell !== 1 ? `pays ${percent(market.sell)}` : ''].filter(Boolean).join(', ');
    const env = Object.entries(market.factors ?? {}).filter(([, value]) => Math.round((value - 1) * 100) !== 0)
        .sort(([a], [b]) => (a === 'all' ? 1 : b === 'all' ? -1 : CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)))
        .map(([category, value]) => `${category === 'all' ? 'everything' : category} ${percent(value)}`);
    const first = type ? `${head[0]}: ${type}` : head[0];
    const tags = market.tags.length ? `${market.tags.join(', ')}${env.length ? `: ${env.join(', ')}` : ''}` : '';
    return [first, tags].filter(Boolean).join(' · ');
}
