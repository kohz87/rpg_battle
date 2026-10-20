// The Inventory block as RPG Battle sees it: equipment (slot, rarity, stats, tags),
// consumables (heal 30, mp 20, cure poison, fire 25 all enemies) and money.
//
// The block belongs to the model and is in Story Block's `rows` format (`[Category > Sub]`
// headers, then `Name | Qty | Note` rows). Reading is lenient because the model writes it;
// writing (loot in, consumables out) touches only the rows it has to, so every other line
// stays byte-identical and the model's own wording survives. Item stats are capped by a
// budget for their rarity and the wearer's level (DESIGN §5.4) for combat only; the text is
// never rewritten to the capped values. Pure.

import { DEFAULT_RULES, STATS, rarityBudget } from './rules.js';

const RARITY_WORDS = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
const SLOTS = ['weapon', 'offhand', 'armour', 'worn', 'accessory'];
const ITEM_STATS = ['ATK', 'MATK', 'DEF', 'MDEF', 'HP', 'MP', ...STATS, 'crit'];
const TAGS = ['range', 'fire', 'ice', 'holy', 'poison', 'two-handed'];
// (0.5.33) The tags that do something in a fight (combat.js gearOnHit, holy against the undead).
export const ELEMENTS = ['fire', 'ice', 'poison', 'holy'];
// Combat condition names; a written "poisoned" or "stunned" maps to them by prefix.
const CONDITIONS = ['poison', 'burn', 'bleed', 'stun', 'slow', 'weaken', 'shield', 'regen', 'guard'];

// Item kinds by name, checked in order (a "battle staff" is a staff, a "robe" is not mail).
// Words match at the end of a word so compounds count: longsword, shortbow, chainmail.
const KINDS = [
    { words: ['staff', 'staves', 'wand', 'rod', 'sceptre', 'scepter'], slot: 'weapon', main: 'MATK' },
    { words: ['tome', 'grimoire', 'focus', 'orb'], slot: 'offhand', main: 'MATK' },
    { words: ['shield', 'buckler'], slot: 'offhand', main: 'DEF' },
    { words: ['robe', 'cloak', 'mantle', 'vestments'], slot: 'armour', main: 'MDEF' },
    {
        words: ['sword', 'axe', 'mace', 'dagger', 'spear', 'bow', 'blade', 'knife', 'knives', 'hammer', 'club', 'halberd',
            'rapier', 'scimitar', 'sabre', 'saber', 'crossbow', 'flail', 'whip', 'sling', 'glaive', 'pike', 'katana',
            'falchion', 'maul', 'lance', 'trident', 'scythe', 'cudgel', 'stiletto', 'dirk', 'cutlass', 'claymore'],
        slot: 'weapon', main: 'ATK',
    },
    {
        words: ['armour', 'armor', 'mail', 'plate', 'jerkin', 'cuirass', 'brigandine', 'gambeson', 'leathers', 'hauberk',
            'coat', 'vest', 'tunic'],
        slot: 'armour', main: 'DEF',
    },
    // Head, hands, feet and waist: worn pieces, a slot of their own so a helm and boots leave
    // the rings alone.
    {
        words: ['helm', 'helmet', 'hood', 'coif', 'boot', 'shoe', 'sandal', 'sabaton', 'glove', 'gauntlet', 'mitten', 'bracer',
            'vambrace', 'greave', 'belt', 'girdle', 'sash'],
        slot: 'worn', main: 'DEF',
    },
    {
        words: ['ring', 'amulet', 'charm', 'necklace', 'pendant', 'talisman', 'bracelet', 'brooch', 'earring', 'trinket',
            'circlet', 'torc', 'locket', 'crown', 'diadem', 'tiara'],
        slot: 'accessory', main: 'LUK',
    },
].map(kind => ({ ...kind, pattern: new RegExp(`(?:${kind.words.join('|')})s?\\b`, 'i') }));

const MAIN_BY_SLOT = { weapon: 'ATK', offhand: 'DEF', armour: 'DEF', worn: 'DEF', accessory: 'LUK' };

// ---------------------------------------------------------------------------------------
// Text helpers shared by reading and writing.

const clean = value => String(value ?? '').replace(/\r?\n/g, ' ').trim();
const stripBold = value => String(value ?? '').replace(/\*\*|__/g, '').trim();
export const nameKey = value => stripBold(value).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
const LIST_MARKER = /^(?:[-*•]|\d+[.)])\s+/;
// (0.5.19) A line that only says a section is empty ("(empty)", "*(None)*", "—") is no item.
const EMPTY_LINE = /^[\s*_([{]*(?:empty|none|nothing|nothing yet|n\/a|-+|—|–)[\s*_)\]}.]*$/i;
const TABLE_RULE = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/;
const TAG_LINE = /^<\/?[A-Za-z][\w-]*>$/;

/** Split on unescaped `|`, keeping each cell's raw text (escapes and padding included). */
function splitRaw(line) {
    const cells = [];
    let current = '';
    let escaped = false;
    for (const char of line) {
        if (escaped) {
            current += char;
            escaped = false;
        } else if (char === '\\') {
            current += char;
            escaped = true;
        } else if (char === '|') {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells;
}

function unescape(value) {
    return String(value ?? '').replace(/\\(.)/g, '$1');
}

// The same escapes Story Block writes, so a row RPG Battle adds reads back verbatim there.
function escapeCell(value) {
    return clean(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function escapeName(value) {
    const text = escapeCell(value);
    return /^(?:[-*•:[]|\d+[.)])/.test(text) ? `\\${text}` : text;
}

function headerName(line) {
    let text = stripBold(line);
    if (/^#{1,6}\s+/.test(text)) return text.replace(/^#{1,6}\s+/, '').trim();
    if (!text.startsWith('[') || !text.endsWith(']')) return null;
    const inner = text.slice(1, -1);
    // A whole row wrapped in brackets (`[Spare Rope | 1 | coiled]`) is a row (Story Block's rule).
    if (splitRaw(inner).length >= 3) return null;
    let escaped = false;
    for (const char of inner) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === ']') return null;
    }
    return unescape(inner).split('>').map(part => part.trim()).filter(Boolean).join(' > ') || null;
}

/**
 * The structure of an inventory text, line by line: headers and rows with where their
 * cells are, so a writer can change one cell and leave the rest of the line alone.
 */
function scan(lines) {
    const headers = [];
    const rows = [];
    let category = '';
    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || TABLE_RULE.test(trimmed) || TAG_LINE.test(trimmed)) return;
        const header = headerName(trimmed);
        if (header !== null) {
            category = header;
            headers.push({ index, category });
            return;
        }
        const body = trimmed.replace(LIST_MARKER, '').replace(/^\[(.*)\]$/, '$1');
        if (EMPTY_LINE.test(body)) return;
        const raw = splitRaw(line);
        const table = body.startsWith('|');
        const cells = splitRaw(body).map(cell => clean(unescape(cell)));
        if (table) cells.shift();
        if (table && cells.length >= 2 && cells.at(-1) === '') cells.pop();
        const [name = '', qty = '', ...rest] = cells;
        const plainName = stripBold(name);
        if (!plainName) return;
        // A markdown table's own header row is not an item.
        if (table && /^(?:name|items?)$/i.test(plainName) && /^(?:qty|quantity|amount|count|#)$/i.test(qty)) return;
        rows.push({
            index, category, raw, table,
            name: plainName, key: nameKey(plainName), qty, note: rest.join(' | '),
            // Index of the quantity cell in `raw` (a table row starts with an empty cell).
            qtyCell: table ? 2 : 1,
        });
    });
    return { headers, rows };
}

function eolOf(text) {
    return /\r\n/.test(text) ? '\r\n' : '\n';
}

// ---------------------------------------------------------------------------------------
// Reading a row's note.

export function slotFromWord(word) {
    const w = String(word ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (/^(?:weapon|mainhand|hand)$/.test(w)) return 'weapon';
    if (/^(?:offhand|shield)$/.test(w)) return 'offhand';
    if (/^(?:armour|armor|body|chest)$/.test(w)) return 'armour';
    if (/^(?:worn|head|hands|feet|waist|helm|helmet|boots|gloves|belt)$/.test(w)) return 'worn';
    if (/^(?:accessory|accessories|ring|amulet|trinket|neck)$/.test(w)) return 'accessory';
    return null;
}

function slotFromCategory(category) {
    const segments = String(category ?? '').toLowerCase().split('>').map(part => part.trim());
    // The deepest segment that names a slot wins: [Equipment > Weapons] is a weapon.
    for (const segment of segments.reverse()) {
        if (/weapon/.test(segment)) return 'weapon';
        if (/off-?\s?hand|shield/.test(segment)) return 'offhand';
        if (/head\s?(?:gear|wear)|helm|hand\s?wear|gloves|gauntlets|foot\s?wear|boots|shoes|belts/.test(segment)) return 'worn';
        if (/accessor|jewel|rings?\b|amulet|trinket/.test(segment)) return 'accessory';
        if (/armou?r|clothing|apparel|outfit/.test(segment)) return 'armour';
    }
    return null;
}

const EQUIPMENT_CATEGORY = /equip|gear|weapon|armou?r|accessor|jewel/i;

function kindOf(name) {
    return KINDS.find(kind => kind.pattern.test(String(name ?? ''))) ?? null;
}

function signed(text) {
    return Number(String(text).replace(/[−–]/g, '-').replace(/\s+/g, ''));
}

const STAT_NAMES = 'MATK|ATK|MDEF|DEF|HP|MP|STR|VIT|AGI|DEX|INT|LUK|CHA|CRIT|CRITICAL|ATTACK|DEFEN[CS]E';
const STAT_AFTER = new RegExp(`\\b(${STAT_NAMES})\\b\\s*:?\\s*([+\\-−–]\\s*\\d+(?:\\.\\d+)?)\\s*%?`, 'gi');
const STAT_BEFORE = new RegExp(`([+\\-−–]\\d+(?:\\.\\d+)?)\\s*%?\\s*(${STAT_NAMES})\\b`, 'gi');

function statName(word) {
    const w = word.toUpperCase();
    if (w === 'CRIT' || w === 'CRITICAL') return 'crit';
    if (w === 'ATTACK') return 'ATK';
    if (w.startsWith('DEFEN')) return 'DEF';
    return w;
}

/** `ATK +6, DEX -1, crit +3%` (or `+6 ATK`) → { ATK: 6, DEX: -1, crit: 3 }. */
export function parseStats(text) {
    const stats = {};
    const add = (word, value) => {
        const name = statName(word);
        if (Number.isFinite(value) && value !== 0) stats[name] = (stats[name] ?? 0) + Math.round(value);
    };
    // Named-first is the canonical form; the remainder is read the other way round so
    // `ATK +6 DEX -1` cannot be misread as `+6 DEX`.
    const rest = String(text ?? '').replace(STAT_AFTER, (_, word, value) => {
        add(word, signed(value));
        return ' ';
    });
    rest.replace(STAT_BEFORE, (_, value, word) => {
        add(word, signed(value));
        return ' ';
    });
    return stats;
}

function parseTags(text, name) {
    const lower = ` ${String(text ?? '').toLowerCase()} `;
    const tags = [];
    if (/\branged?\b/.test(lower) || /(?:bow|sling)s?\b/i.test(name)) tags.push('range');
    for (const tag of ['fire', 'ice', 'holy', 'poison']) if (new RegExp(`\\b${tag}\\b`).test(lower)) tags.push(tag);
    if (/\b(?:two[- ]?handed|2h)\b/.test(lower)) tags.push('two-handed');
    return TAGS.filter(tag => tags.includes(tag));
}

function conditionName(word) {
    const w = String(word ?? '').trim().toLowerCase();
    return CONDITIONS.find(name => w.startsWith(name)) ?? w;
}

/** A consumable's effect from its note, or null: heal 30, mp 20, cure poison, fire 25 all enemies. */
export function parseEffect(note) {
    const text = String(note ?? '').toLowerCase();
    const effect = {};
    const heal = text.match(/\bheal(?:s|ing)?\s*(?:for\s*)?\+?(\d+)/)
        ?? text.match(/\b(?:restores?|recovers?)\s*(\d+)\s*(?:hp|health)\b/)
        ?? text.match(/\b(?:hp|health)\s*\+\s*(\d+)/)
        ?? text.match(/\+(\d+)\s*(?:hp|health)\b/);
    if (heal) effect.heal = Number(heal[1]);
    const mp = text.match(/\b(?:mp|mana)\s*\+?\s*(\d+)/)
        ?? text.match(/(\d+)\s*(?:mp|mana)\b/);
    if (mp) effect.mp = Number(mp[1]);
    const clauses = text.split(/[,;·]/).map(part => part.trim()).filter(Boolean);
    const cure = [];
    let curing = false;
    for (const clause of clauses) {
        const match = clause.match(/^(?:cures?|removes?)\s+(.+)$/);
        if (match) {
            curing = true;
            cure.push(...match[1].split(/\s*(?:\band\b|&|\/)\s*/).filter(Boolean));
        } else if (curing && /^[a-z]+$/.test(clause) && CONDITIONS.some(name => clause.startsWith(name))) {
            cure.push(clause);
        } else {
            curing = false;
        }
    }
    if (/\bantidote\b/.test(text) && !cure.length) cure.push('poison');
    if (cure.length) effect.cure = [...new Set(cure.map(conditionName))];
    const elements = 'fire|ice|frost|holy|lightning|shock|poison|acid|dark|damage|dmg';
    const before = text.match(new RegExp(`\\b(${elements})\\s*(\\d+)`));
    const after = before ? null : text.match(new RegExp(`(\\d+)\\s*(${elements})\\b`));
    if (before || after) {
        const [word, amount] = before ? [before[1], before[2]] : [after[2], after[1]];
        const element = { frost: 'ice', shock: 'lightning', damage: 'physical', dmg: 'physical' }[word] ?? word;
        const target = /\ball\b|\bevery(?:one)?\b|\barea\b|\baoe\b/.test(text) ? 'all' : 'one';
        effect.damage = { amount: Number(amount), element, target };
    }
    return Object.keys(effect).length ? effect : null;
}

function rarityOf(...texts) {
    for (const text of texts) {
        const lower = String(text ?? '').toLowerCase();
        const word = RARITY_WORDS.find(rarity => new RegExp(`\\b${rarity}\\b`).test(lower));
        if (word) return word;
    }
    return 'common';
}

function hasRarityWord(text) {
    const lower = String(text ?? '').toLowerCase();
    return RARITY_WORDS.some(rarity => new RegExp(`\\b${rarity}\\b`).test(lower));
}

function isEquippedMark(note) {
    const lower = String(note ?? '').toLowerCase();
    if (/\b(?:not|un)[\s-]?equipped\b/.test(lower)) return false;
    if (/\bequipped\b/.test(lower)) return true;
    // "worn" alone is a mark; "worn smooth" describes a keepsake.
    return lower.split(/[·,;()]/).some(clause => /^\s*(?:worn|wielded|in use)\s*$/.test(clause));
}

function slotFromStats(stats) {
    if (stats.ATK || stats.MATK) return 'weapon';
    if (stats.DEF || stats.MDEF) return 'armour';
    return 'accessory';
}

/** (0.5.33) The slot a piece of gear takes, by its name's kind, else by its stats. */
export function itemSlot(name, stats = {}) {
    return kindOf(name)?.slot ?? slotFromStats(stats ?? {});
}

/**
 * Everything a row's name, category and note say about it: { equipped, rarity, slot,
 * stats, tags, effect }. Equipment needs a signal (an equipment category, `equipped`, a
 * rarity, stats or `slot:`) so a keepsake ring in [Keepsakes] is not worn into battle.
 */
export function describeRow({ name, category = '', note = '' }) {
    const text = String(note ?? '');
    const stats = parseStats(text);
    const equippedMark = isEquippedMark(text);
    const explicit = text.match(/\bslot\s*:\s*([a-z-]+)/i);
    const fromCategory = slotFromCategory(category);
    const kind = kindOf(name);
    let slot = explicit ? slotFromWord(explicit[1]) : null;
    // [Armour] holds shields, helms and boots too; their kind says which slot they take.
    if (!slot && fromCategory) slot = fromCategory === 'armour' && (kind?.slot === 'offhand' || kind?.slot === 'worn') ? kind.slot : fromCategory;
    // (0.5.36) A piece on order is not here yet: nothing to wear or use until it is collected.
    if (ON_ORDER.test(text)) return { equipped: false, rarity: rarityOf(text, name), slot: null, stats: {}, tags: [], effect: null, onOrder: true };
    // (0.5.32) "uncommon material": a rare find, not gear to wear.
    const material = /\bmaterial\b/i.test(text) && !explicit && !Object.keys(stats).length;
    const equipmentish = !material && (EQUIPMENT_CATEGORY.test(category) || equippedMark || hasRarityWord(text) || Object.keys(stats).length > 0);
    if (!slot && equipmentish && kind) slot = kind.slot;
    if (!slot && (equippedMark || EQUIPMENT_CATEGORY.test(category)) && Object.keys(stats).length) slot = slotFromStats(stats);
    if (!slot && equippedMark) slot = 'accessory';
    // Only a stat that makes no sense on a potion makes HP +30 equipment; otherwise it heals.
    if (!slot && Object.keys(stats).some(key => key !== 'HP' && key !== 'MP')) slot = kind?.slot ?? slotFromStats(stats);
    if (slot) {
        return { equipped: equippedMark, rarity: rarityOf(text, name), slot, stats, tags: parseTags(text, name), effect: null };
    }
    // (0.5.35) A potion whose note the story retold ("weak restorative fluid") works by its name.
    return { equipped: false, rarity: rarityOf(text, name), slot: null, stats: {}, tags: [], effect: parseEffect(text) ?? (material ? null : effectByName(name)) };
}

// (0.5.36) A row for a piece ordered from a crafter, not collected yet.
const ON_ORDER = /\bon order\b/i;
const ORDER_PART = /\s*·\s*on order\b/i;
const ORDER_SECTION = 'On Order';

// (0.5.35) What a potion does by its name, when its note does not say: the shipped ones exactly
// (Minor Healing Draught heal 20, Healing Draught 30, Greater 60, Elixir 120, Grand Elixir 250,
// Mana Tonic mp 20, Antidote), and one the story names the same way by the same words.
const CONTAINER = /\b(?:draughts?|potions?|tonics?|elixirs?|salves?|tinctures?|philt(?:er|re)s?|brews?|flasks?|vials?|poultices?|balms?|remed(?:y|ies)|drafts?)\b/;
const HEALING = /\b(?:heal(?:ing)?|health|restorative|restoration|regeneration|vitality|life|mending)\b/;
const SMALL = /\b(?:minor|lesser|weak|small|little|light)\b/;
const LARGE = /\b(?:greater|strong|major|large|potent|regeneration)\b/;
const HUGE = /\b(?:grand|superior|supreme|full|perfect)\b/;

export function effectByName(name) {
    const lower = String(name ?? '').toLowerCase();
    if (/\b(?:antidote|anti-?venom)s?\b/.test(lower)) return { cure: ['poison'] };
    const container = CONTAINER.test(lower);
    if (container && /\b(?:mana|ether|aether|arcane)\b/.test(lower)) {
        return { mp: SMALL.test(lower) ? 10 : LARGE.test(lower) || HUGE.test(lower) ? 40 : 20 };
    }
    const elixir = /\belixirs?\b/.test(lower);
    if (!elixir && !(container && HEALING.test(lower))) return null;
    if (HUGE.test(lower)) return { heal: 250 };
    if (elixir && !HEALING.test(lower)) return { heal: 120 };
    return { heal: SMALL.test(lower) ? 20 : LARGE.test(lower) ? 60 : 30 };
}

function quantity(text) {
    const match = String(text ?? '').replace(/,(?=\d{3}\b)/g, '').match(/\d+/);
    return match ? Number(match[0]) : 1;
}

/** Every row of an Inventory block as an Item. */
export function parseInventory(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    const { rows } = scan(lines);
    const items = rows.map(row => ({
        name: row.name,
        qty: quantity(row.qty),
        category: row.category,
        ...describeRow(row),
        note: row.note,
        raw: lines[row.index],
    }));
    return { items };
}

// ---------------------------------------------------------------------------------------
// Rarity budgets.

function costOf(stats, rules) {
    let cost = 0;
    for (const [name, value] of Object.entries(stats ?? {})) {
        const unit = rules.statCost?.[name] ?? 1;
        cost += value > 0 ? value * unit : value * unit * rules.negativeRefund;
    }
    return cost;
}

/** The stat an item without stats gets its budget on: a sword's ATK, a robe's MDEF… */
export function mainStat(item) {
    const kind = kindOf(item?.name) ?? kindOf(String(item?.category ?? '').split('>').at(-1));
    return kind?.main ?? MAIN_BY_SLOT[item?.slot] ?? 'ATK';
}

/**
 * Combat stats of an item within its rarity budget at this level:
 * { stats, capped, budget, cost } where `cost` is what the item as written costs.
 * Over budget, positive stats shrink by the same factor (negatives stay: shrinking a
 * drawback would raise the item); an item with no stats gets its whole budget on its
 * kind's main stat, because DESIGN §3.3 says a bare "Iron Sword" still hits harder.
 */
export function capItem(item, level, rules = DEFAULT_RULES) {
    const budget = rarityBudget(item?.rarity ?? 'common', level, rules);
    const written = Object.fromEntries(Object.entries(item?.stats ?? {}).filter(([, value]) => Number.isFinite(value) && value !== 0));
    if (!Object.keys(written).length) {
        if (!item?.slot) return { stats: {}, capped: false, budget, cost: 0 };
        const stat = mainStat(item);
        const amount = Math.floor(budget / (rules.statCost?.[stat] ?? 1));
        const stats = amount > 0 ? { [stat]: amount } : {};
        return { stats, capped: false, budget, cost: costOf(stats, rules) };
    }
    const cost = costOf(written, rules);
    if (cost <= budget) return { stats: written, capped: false, budget, cost };
    const positive = costOf(Object.fromEntries(Object.entries(written).filter(([, value]) => value > 0)), rules);
    const refund = positive - cost;
    const factor = Math.max(0, Math.min(1, (budget + refund) / positive));
    const stats = {};
    for (const [name, value] of Object.entries(written)) stats[name] = value > 0 ? Math.min(value, Math.round(value * factor)) : value;
    // Rounding up can overshoot by a point or two; take it back from the dearest stat.
    while (costOf(stats, rules) > budget + 1e-9) {
        const dearest = Object.keys(stats)
            .filter(name => stats[name] > 0)
            .sort((a, b) => stats[b] * (rules.statCost?.[b] ?? 1) - stats[a] * (rules.statCost?.[a] ?? 1))[0];
        if (!dearest) break;
        stats[dearest] -= 1;
    }
    for (const name of Object.keys(stats)) if (stats[name] === 0) delete stats[name];
    return { stats, capped: true, budget, cost };
}

/** How many worn pieces and accessories count (the reader's rules.gear), whole and at least 0. */
export function gearLimits(rules = DEFAULT_RULES) {
    const limit = (value, fallback) => (Number.isFinite(Number(value)) ? Math.max(0, Math.min(9, Math.round(Number(value)))) : fallback);
    return { worn: limit(rules?.gear?.worn, 1), accessory: limit(rules?.gear?.accessories, 2) };
}

const SLOT_NAMES = { weapon: 'weapon', offhand: 'off-hand', armour: 'armour', worn: 'worn piece', accessory: 'accessory' };
// "only 2 accessories count", "only 1 worn piece counts", "no accessories count".
function limitText(count, slot) {
    const word = slot === 'accessory' ? (count === 1 ? 'accessory' : 'accessories') : (count === 1 ? 'worn piece' : 'worn pieces');
    return count ? `only ${count} ${word} ${count === 1 ? 'counts' : 'count'}` : `no ${word} count`;
}

/**
 * The gear that counts: the first equipped item per slot, as many worn pieces and accessories
 * as the rules allow (one and two by default), no off-hand with a two-handed weapon.
 * `unused` is every other equipped item with why it does not count, for the Battle tab.
 */
export function equipped(items, rules = DEFAULT_RULES) {
    const limits = gearLimits(rules);
    const worn = (items ?? []).filter(item => item?.equipped && item.slot);
    const first = slot => worn.find(item => item.slot === slot) ?? null;
    const weapon = first('weapon');
    const gear = {
        weapon,
        offhand: weapon?.tags?.includes('two-handed') ? null : first('offhand'),
        armour: first('armour'),
        worn: worn.filter(item => item.slot === 'worn').slice(0, limits.worn),
        accessory: worn.filter(item => item.slot === 'accessory').slice(0, limits.accessory),
    };
    const counted = new Set([gear.weapon, gear.offhand, gear.armour, ...gear.worn, ...gear.accessory].filter(Boolean));
    const unused = worn.filter(item => !counted.has(item)).map(item => {
        let why;
        if (item.slot === 'offhand' && weapon?.tags?.includes('two-handed') && first('offhand') === item) why = `${weapon.name} is two-handed`;
        else if (item.slot === 'worn' || item.slot === 'accessory') why = limitText(limits[item.slot], item.slot);
        else why = `one ${SLOT_NAMES[item.slot]} counts`;
        return { item, why };
    });
    return { ...gear, unused };
}

/**
 * What the Battle tab lists under Gear: { counted: [{ name, slot, stats, capped, from }],
 * unused: [{ name, slot, why }] }. `stats` are what the fight uses (capped by rarity);
 * `from` is what the inventory says, when it was more.
 */
export function gearSummary(items, level, rules = DEFAULT_RULES) {
    const gear = equipped(items, rules);
    const counted = [gear.weapon, gear.offhand, gear.armour, ...gear.worn, ...gear.accessory].filter(Boolean).map(item => {
        const result = capItem(item, level, rules);
        return { name: item.name, slot: item.slot, stats: result.stats, capped: result.capped, from: result.capped ? { ...item.stats } : null };
    });
    return { counted, unused: gear.unused.map(({ item, why }) => ({ name: item.name, slot: item.slot, why })) };
}

/**
 * Summed capped stats of the equipped gear: { ATK, MATK, DEF, MDEF, HP, MP, STR…, crit,
 * tags, capped: [{ name, from, to }] }. `tags` (range, fire…) are the weapon's and armour's
 * tags together, for combat's elements.
 */
export function gearBonuses(items, level, rules = DEFAULT_RULES) {
    const totals = Object.fromEntries(ITEM_STATS.map(name => [name, 0]));
    const tags = new Set();
    const onHit = new Set();
    const capped = [];
    const gear = equipped(items, rules);
    for (const item of [gear.weapon, gear.offhand, gear.armour, ...gear.worn, ...gear.accessory].filter(Boolean)) {
        const result = capItem(item, level, rules);
        for (const [name, value] of Object.entries(result.stats)) totals[name] = (totals[name] ?? 0) + value;
        for (const tag of item.tags ?? []) tags.add(tag);
        // (0.5.33) An element on what strikes or is worn to (weapon, off-hand, accessory) works in a fight.
        if (item === gear.weapon || item === gear.offhand || gear.accessory.includes(item)) for (const tag of item.tags ?? []) if (ELEMENTS.includes(tag)) onHit.add(tag);
        if (result.capped) capped.push({ name: item.name, from: { ...item.stats }, to: result.stats });
    }
    return { ...totals, tags: [...tags], onHit: ELEMENTS.filter(tag => onHit.has(tag)), capped };
}

/** Rows a fight can use: an effect and something left. */
export function consumables(items) {
    return (items ?? []).filter(item => item?.effect && item.qty > 0);
}

// ---------------------------------------------------------------------------------------
// Gear entries on a Party section's Equipped line: `Ashwood Staff (rare) · MATK +7, INT +1`.

/** `ATK +6, DEX -1, crit +3%` from a stats object, in a stable order. */
export function formatStats(stats) {
    const order = ITEM_STATS.filter(name => stats?.[name]);
    for (const name of Object.keys(stats ?? {})) if (stats[name] && !order.includes(name)) order.push(name);
    return order.map(name => `${name} ${stats[name] > 0 ? '+' : ''}${stats[name]}${name === 'crit' ? '%' : ''}`).join(', ');
}

/** One entry of an Equipped line as an equipped Item. */
export function parseGearEntry(text) {
    const raw = clean(text);
    const [head, ...rest] = raw.split(/\s*·\s*/);
    const match = head.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const name = stripBold(match ? match[1] : head);
    const note = [match ? match[2] : '', ...rest].filter(Boolean).join(' · ');
    const described = describeRow({ name, category: 'Equipment', note });
    return {
        name, qty: 1, category: '',
        ...described,
        equipped: true,
        slot: described.slot ?? kindOf(name)?.slot ?? 'accessory',
        effect: null,
        note, raw,
    };
}

/** An equipped Item as an Equipped-line entry; `slot:` only when the name does not tell. */
export function formatGearEntry(item) {
    const extras = [formatStats(item.stats), ...(item.tags ?? [])];
    if (item.slot && kindOf(item.name)?.slot !== item.slot) extras.push(`slot: ${item.slot}`);
    const tail = extras.filter(Boolean).join(', ');
    return `${item.name} (${item.rarity ?? 'common'})${tail ? ` · ${tail}` : ''}`;
}

// ---------------------------------------------------------------------------------------
// Money.

function currencyOf(currency) {
    return { ...DEFAULT_RULES.currency, ...(currency ?? {}) };
}

// Each tier's value in the smallest unit (tiers are smallest first).
function tierValues(currency) {
    let value = 1;
    return (currency.tiers ?? []).map((tier, index) => {
        if (index > 0) value *= Math.max(1, Number(tier.rate) || 1);
        return { name: String(tier.name), value };
    });
}

function unitLabel(name, count) {
    // "1 crowns" reads wrong; copper, silver and gold have no plural to drop.
    return count === 1 && /[^s]s$/i.test(name) ? name.slice(0, -1) : name;
}

/** An amount in the smallest unit as words: '1 gold, 3 silver, 4 copper' | '134 coins'. */
export function formatMoney(amount, currency = DEFAULT_RULES.currency) {
    const c = currencyOf(currency);
    let left = Math.max(0, Math.round(Number(amount) || 0));
    const tiers = tierValues(c);
    if (c.mode === 'single' || !tiers.length) return `${left} ${c.single || 'coins'}`;
    const parts = [];
    for (const tier of [...tiers].reverse()) {
        const count = Math.floor(left / tier.value);
        left -= count * tier.value;
        if (count) parts.push(`${count} ${unitLabel(tier.name, count)}`);
    }
    return parts.length ? parts.join(', ') : `0 ${tiers[0].name}`;
}

function matchTier(word, tiers) {
    const w = word.toLowerCase();
    const forms = name => {
        const n = name.toLowerCase();
        return [n, `${n}s`, n.endsWith('s') ? n.slice(0, -1) : n];
    };
    const exact = tiers.find(tier => forms(tier.name).includes(w));
    if (exact) return exact;
    // Abbreviations: 1g 3s, 5gp.
    const short = w.length === 2 && w.endsWith('p') ? w[0] : w;
    return tiers.find(tier => tier.name.toLowerCase().startsWith(short)) ?? null;
}

/** Words back to an amount in the smallest unit; lenient ('1g 3s', '13 silver', '134'). */
export function parseMoney(text, currency = DEFAULT_RULES.currency) {
    const c = currencyOf(currency);
    const tiers = tierValues(c);
    let total = 0;
    const pattern = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([A-Za-z]+)?/g;
    for (const [, number, word] of String(text ?? '').matchAll(pattern)) {
        const amount = Number(number.replace(/,/g, ''));
        const tier = c.mode === 'single' || !word ? null : matchTier(word, tiers);
        total += amount * (tier ? tier.value : 1);
    }
    return Math.round(total);
}

// ---------------------------------------------------------------------------------------
// Writing: loot in, consumables out.

function setCell(raw, index, value) {
    const cells = [...raw];
    if (index >= cells.length) {
        // `Coins` alone, or `Coins |`: give it a quantity cell.
        while (cells.length < index) cells.push(' ');
        cells.push(` ${value}`);
        return cells;
    }
    const cell = cells[index];
    const lead = cell.match(/^\s*/)[0];
    const trail = index === cells.length - 1 ? '' : cell.match(/\s*$/)[0] || ' ';
    cells[index] = `${lead || ' '}${value}${trail}`;
    return cells;
}

// Only the quantity cell changes; the name's bold, the padding and the note stay as written.
function rewriteCell(line, row, index, value) {
    const cells = setCell(row.raw, index, value);
    return cells.join('|').replace(/\s+$/, '') + (line.match(/\s*$/)?.[0] ?? '');
}

function rewriteQty(line, row, value) {
    const cells = setCell(row.raw, row.qtyCell, value);
    return cells.join('|').replace(/\s+$/, '') + (line.match(/\s*$/)?.[0] ?? '');
}

function endOfSection(lines, scanned, category) {
    const key = nameKey(category);
    const header = [...scanned.headers].reverse().find(entry => nameKey(entry.category) === key);
    if (!header && category) return null;
    const rows = scanned.rows.filter(row => nameKey(row.category) === key && (!header || row.index > header.index));
    const nextHeader = scanned.headers.find(entry => entry.index > (header?.index ?? -1));
    const inSection = rows.filter(row => !nextHeader || row.index < nextHeader.index);
    if (inSection.length) return inSection.at(-1).index + 1;
    return header ? header.index + 1 : 0;
}

function endOfText(lines) {
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end -= 1;
    // Rows go inside a `<Inventory>…</Inventory>` wrapper if the text carries one.
    if (end > 0 && /^<\/[A-Za-z][\w-]*>$/.test(lines[end - 1].trim())) end -= 1;
    return end;
}

function insertRow(lines, category, rowText) {
    const scanned = scan(lines);
    const at = endOfSection(lines, scanned, category);
    if (at !== null) {
        lines.splice(at, 0, rowText);
        return;
    }
    const end = endOfText(lines);
    const block = [`[${escapeCell(category).replace(/\]/g, '\\]')}]`, rowText];
    if (end > 0 && lines[end - 1].trim() && !/^<[A-Za-z][\w-]*>$/.test(lines[end - 1].trim())) block.unshift('');
    lines.splice(end, 0, ...block);
}

const KIND_CATEGORY = {
    equipment: /equip|gear|weapon|armou?r|accessor/i,
    consumable: /consumable|potion|suppl|provision/i,
    material: /material|loot|trophies|trophy|component|misc/i,
};

function categoryFor(item, scanned) {
    const kind = item.kind ?? (item.slot || Object.keys(item.stats ?? {}).length ? 'equipment' : item.effect ? 'consumable' : 'material');
    const categories = [...new Set(scanned.headers.map(entry => entry.category))];
    const slot = kind === 'equipment' ? item.slot ?? kindOf(item.name)?.slot ?? null : null;
    if (kind === 'equipment') {
        const exact = slot && categories.find(category => slotFromCategory(category) === slot);
        if (exact) return { category: exact, kind };
    }
    // A weapon does not go under [Equipment > Armour], nor a potion under [Weapons].
    const fits = category => !slotFromCategory(category) || (kind === 'equipment' && slotFromCategory(category) === slot);
    const loose = categories.find(category => KIND_CATEGORY[kind]?.test(category) && fits(category));
    return { category: loose ?? 'Loot', kind };
}

// enemies.js loot tables carry a consumable's effect as its note text already ('heal 30').
function formatEffect(effect) {
    if (!effect) return '';
    if (typeof effect === 'string') return clean(effect);
    const parts = [];
    if (effect.heal) parts.push(`heal ${effect.heal}`);
    if (effect.mp) parts.push(`mp ${effect.mp}`);
    if (effect.cure?.length) parts.push(`cure ${effect.cure.join(', ')}`);
    if (effect.damage) {
        const element = effect.damage.element && effect.damage.element !== 'physical' ? effect.damage.element : 'damage';
        parts.push(`${element} ${effect.damage.amount}${effect.damage.target === 'all' ? ', all enemies' : ''}`);
    }
    return parts.join(', ');
}

function lootNote(item, kind) {
    if (item.note) return clean(item.note);
    if (kind === 'equipment') {
        const slot = item.slot ?? kindOf(item.name)?.slot ?? slotFromStats(item.stats ?? {});
        const extras = [formatStats(item.stats ?? {}), ...(item.tags ?? [])];
        // The row must read back as equipment in the slot it was rolled for.
        if (kindOf(item.name)?.slot !== slot) extras.push(`slot: ${slot}`);
        const tail = extras.filter(Boolean).join(', ');
        return `${item.rarity ?? 'common'}${tail ? ` · ${tail}` : ''}`;
    }
    // (0.5.32) A rarer find says so ("uncommon material", "rare · heal 40"): the rarity was dropped
    // for everything but gear.
    const rarity = item.rarity && item.rarity !== 'common' ? `${item.rarity}${item.kind === 'material' ? ' material' : ''}` : '';
    // (0.5.34) A material says what it would lend a crafted piece: `uncommon material · MDEF, poison`.
    const affinity = item.kind === 'material' ? [item.affinity?.stat, item.affinity?.element].filter(Boolean).join(', ') : '';
    if (affinity) return `${rarity || 'material'} · ${affinity}`;
    return [rarity, formatEffect(item.effect)].filter(Boolean).join(' · ');
}

/**
 * Loot written into the Inventory text: money onto the currency row (created under
 * [Money] when missing), items stacked onto a same-named row or added under a matching
 * category or [Loot]. Every other line is left exactly as it was.
 */
// (0.5.25) A purse kept under its own name ("Coin Pouch | 1 | 1 Gold, 35 Silver, 14 Copper"):
// a row named for money whose quantity or note is written in the currency's coins.
const PURSE_NAME = /\b(?:coins?|purse|pouch|money|wallet|funds|coffer|strongbox)\b/i;

function hasCoins(text, c) {
    const tiers = tierValues(c);
    return [...String(text ?? '').matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z]+)/g)].some(([, , word]) => matchTier(word, tiers));
}

// Which cell of `row` holds its money: 'qty' or 'note', or null for a row that is no purse.
function moneyCellOf(row, c) {
    if (row.key === nameKey(c.row)) return 'qty';
    if (!PURSE_NAME.test(row.name) || c.mode === 'single') return null;
    if (hasCoins(row.note, c)) return 'note';
    if (hasCoins(row.qty, c)) return 'qty';
    return null;
}

/**
 * (0.5.25) The party's money as the inventory holds it: { total } in the smallest coin, over
 * every purse row (the currency's own "Coins" row and any "Coin Pouch", "Purse"… written in
 * coins), with `rows` naming them; null when the inventory has none.
 */
export function purseOf(inventoryText, currency = DEFAULT_RULES.currency) {
    const c = currencyOf(currency);
    const rows = scan(String(inventoryText ?? '').split(/\r?\n/)).rows
        .map(row => ({ row, cell: moneyCellOf(row, c) }))
        .filter(entry => entry.cell);
    if (!rows.length) return null;
    const total = rows.reduce((sum, { row, cell }) => sum + parseMoney(cell === 'note' ? row.note : row.qty, c), 0);
    return { total, rows: rows.map(({ row, cell }) => ({ name: row.name, cell })) };
}

export function addLoot(inventoryText, { items = [], money = 0 } = {}, currency = DEFAULT_RULES.currency) {
    const text = String(inventoryText ?? '');
    const eol = eolOf(text);
    const lines = text === '' ? [] : text.split(/\r?\n/);
    const c = currencyOf(currency);
    const amount = Math.max(0, Math.round(Number(money) || 0));
    if (amount > 0) {
        const scanned = scan(lines);
        // The currency's own row first, else (0.5.25) the purse the story keeps under its own name.
        const row = scanned.rows.find(entry => entry.key === nameKey(c.row)) ?? scanned.rows.find(entry => moneyCellOf(entry, c));
        const cell = row ? moneyCellOf(row, c) : null;
        if (row && cell === 'note') {
            const total = parseMoney(row.note, c) + amount;
            lines[row.index] = rewriteCell(lines[row.index], row, row.qtyCell + 1, formatMoney(total, c));
        } else if (row) {
            const total = parseMoney(row.qty, c) + amount;
            // A one-coin purse written as a bare number stays a bare number.
            const value = c.mode === 'single' && /^\s*[\d,]*\s*$/.test(row.qty) ? String(total) : formatMoney(total, c);
            lines[row.index] = rewriteQty(lines[row.index], row, value);
        } else {
            const value = c.mode === 'single' ? String(amount) : formatMoney(amount, c);
            insertRow(lines, 'Money', `${escapeName(c.row)} | ${value}`);
        }
    }
    for (const item of items ?? []) {
        const qty = Math.max(1, Math.round(Number(item?.qty) || 1));
        const name = clean(item?.name);
        if (!name) continue;
        const scanned = scan(lines);
        const row = scanned.rows.find(entry => entry.key === nameKey(name));
        if (row) {
            const have = /\d/.test(row.qty) ? quantity(row.qty) : 1;
            const value = /\d/.test(row.qty) ? row.qty.replace(/\d[\d,]*/, String(have + qty)) : String(have + qty);
            lines[row.index] = rewriteQty(lines[row.index], row, value);
            continue;
        }
        const { category, kind } = categoryFor(item, scanned);
        const note = lootNote(item, kind);
        insertRow(lines, category, `${escapeName(name)} | ${qty}${note ? ` | ${escapeCell(note)}` : ''}`);
    }
    return dropEmptyMarks(lines).join(eol);
}

/**
 * (0.5.33) The loot a fight wrote, put back where the reply after it lost it: the model rewrites
 * the Inventory each reply, and narrating the fight it may leave a dropped row out or retell its
 * note ("uncommon · LUK +2" as "a charm on a cord"). A row it left out is added again; a row whose
 * note lost what the fight wrote (its rarity, stats, effect) gets that note back. Its quantity and
 * every other line are the story's. `items`: the loot as addLoot took it; `written`: the
 * Inventory the fight wrote, whose row's note is the one put back (a stack the loot joined keeps
 * the note it had).
 */
export function restoreLoot(inventoryText, items = [], currency = DEFAULT_RULES.currency, written = null) {
    let text = String(inventoryText ?? '');
    const writtenRows = written === null ? [] : scan(String(written).split(/\r?\n/)).rows;
    for (const item of items ?? []) {
        const name = clean(item?.name);
        if (!name) continue;
        const lines = text === '' ? [] : text.split(/\r?\n/);
        const scanned = scan(lines);
        const row = scanned.rows.find(entry => entry.key === nameKey(name));
        if (!row) {
            text = addLoot(text, { items: [item] }, currency);
            continue;
        }
        const kept = writtenRows.find(entry => entry.key === row.key);
        const note = kept ? clean(kept.note ?? '') : lootNote(item, categoryFor(item, scanned).kind);
        if (!note || nameKey(row.note ?? '').includes(nameKey(note))) continue;
        lines[row.index] = rewriteCell(lines[row.index], row, row.qtyCell + 1, escapeCell(note));
        text = lines.join(eolOf(text));
    }
    return text;
}

/**
 * (0.5.34) The crafts of a reply in its Inventory (`inventoryText`, as the reply wrote it):
 * `plans` from craft.js craftPlan, worked out from `before` (the Inventory before the reply).
 * Each material comes down by what was used (the row goes at none; a row the story already
 * brought lower stays lower) and the piece is there with the note the code gives it (`equipped`
 * kept when the story wrote it so). The same reply worked again gives the same text.
 */
export function applyCrafts(inventoryText, before, plans = [], currency = DEFAULT_RULES.currency) {
    let text = String(inventoryText ?? '');
    const old = scan(String(before ?? '').split(/\r?\n/)).rows;
    for (const plan of plans ?? []) {
        const { item, used } = plan;
        for (const material of used ?? []) {
            const had = old.find(row => row.key === nameKey(material.name));
            if (!had) continue;
            const left = (/\d/.test(had.qty) ? quantity(had.qty) : 1) - material.qty;
            const lines = text === '' ? [] : text.split(/\r?\n/);
            const row = scan(lines).rows.find(entry => entry.key === nameKey(material.name));
            if (!row) continue;
            const now = /\d/.test(row.qty) ? quantity(row.qty) : 1;
            if (left <= 0) lines.splice(row.index, 1);
            else if (now > left) lines[row.index] = rewriteQty(lines[row.index], row, /\d/.test(row.qty) ? row.qty.replace(/\d[\d,]*/, String(left)) : String(left));
            text = lines.join(eolOf(text));
        }
        const lines = text === '' ? [] : text.split(/\r?\n/);
        const scanned = scan(lines);
        const row = scanned.rows.find(entry => entry.key === nameKey(item.name));
        const order = plan.order ? ` · on order, ready ${clean(plan.order)}` : '';
        const note = `${lootNote(item, 'equipment')}${order}`;
        if (!row && order) {
            insertRow(lines, ORDER_SECTION, `${escapeName(item.name)} | 1 | ${escapeCell(note)}`);
            text = dropEmptyMarks(lines).join(eolOf(text));
            continue;
        }
        if (!row) {
            text = addLoot(text, { items: [item] }, currency);
            const added = text.split(/\r?\n/);
            const placed = scan(added).rows.find(entry => entry.key === nameKey(item.name));
            if (placed && placed.note !== note) {
                added[placed.index] = rewriteCell(added[placed.index], placed, placed.qtyCell + 1, escapeCell(note));
                text = added.join(eolOf(text));
            }
            continue;
        }
        const wanted = isEquippedMark(row.note) && !order ? `equipped · ${note}` : note;
        if (clean(row.note ?? '') === wanted) continue;
        lines[row.index] = rewriteCell(lines[row.index], row, row.qtyCell + 1, escapeCell(wanted));
        text = lines.join(eolOf(text));
    }
    return text;
}

/**
 * (0.5.36) Orders collected in a reply: each piece `names` lists that waited under [On Order]
 * in the Inventory before it (`before`) is in this reply's (`inventoryText`) as the gear it is,
 * its note the order's without "on order" (`equipped` kept when the story wrote it so), and its
 * order row gone. A name with no order before is left alone. The same reply again: no change.
 */
export function collectOrders(inventoryText, before, names = [], currency = DEFAULT_RULES.currency) {
    let text = String(inventoryText ?? '');
    const old = scan(String(before ?? '').split(/\r?\n/)).rows;
    for (const name of names ?? []) {
        const ordered = old.find(row => row.key === nameKey(name) && ON_ORDER.test(row.note ?? ''))
            ?? old.find(row => ON_ORDER.test(row.note ?? '') && row.key.includes(nameKey(name)));
        if (!ordered) continue;
        // What it is, without the order and what the story said about the wait ("being carved").
        const note = clean(ordered.note).split(ORDER_PART)[0].trim();
        let lines = text === '' ? [] : text.split(/\r?\n/);
        const rows = scan(lines).rows.filter(row => row.key === ordered.key);
        const kept = rows.find(row => !ON_ORDER.test(row.note ?? ''));
        for (const row of rows.filter(entry => entry !== kept).sort((a, b) => b.index - a.index)) lines.splice(row.index, 1);
        if (kept) {
            const now = scan(lines).rows.find(row => row.key === ordered.key);
            const wanted = isEquippedMark(now.note) ? `equipped · ${note}` : note;
            if (clean(now.note ?? '') !== wanted) lines[now.index] = rewriteCell(lines[now.index], now, now.qtyCell + 1, escapeCell(wanted));
            text = lines.join(eolOf(text));
            continue;
        }
        text = addLoot(lines.join(eolOf(text)), { items: [{ name: ordered.name, qty: 1, kind: 'equipment', note }] }, currency);
    }
    return text;
}

// A note that says the piece was taken off ("stowed", "unequipped"): its equipped mark stays off.
const TAKEN_OFF = /\b(?:(?:un|not)[\s-]?equipped|stowed|sheathed|packed away|taken off|removed)\b/i;

/**
 * (0.5.35) What a row's note did, put back where the reply retold it. The model rewrites the
 * Inventory each reply, and a `heal 20` may come back as "weak restorative fluid", gear's
 * `uncommon · LUK +2` as "a fang on a cord", `uncommon material · MDEF` as "a cracked skull".
 * For each row the Inventory before the reply (`before`) also has: an effect, stats or a
 * material's line the note lost goes back in front of the story's words, which stay. A note
 * that still says something RPG Battle reads (other numbers too) is the story's; a row the
 * reply dropped stays dropped.
 */
export function keepNotes(inventoryText, before) {
    const text = String(inventoryText ?? '');
    const old = scan(String(before ?? '').split(/\r?\n/)).rows;
    if (!old.length) return text;
    const lines = text === '' ? [] : text.split(/\r?\n/);
    let changed = false;
    for (const row of scan(lines).rows) {
        const was = old.find(entry => entry.key === row.key);
        if (!was || clean(was.note ?? '') === clean(row.note ?? '')) continue;
        const b = describeRow(was);
        const c = describeRow(row);
        const prose = clean(row.note ?? '');
        let head = '';
        if (b.slot && Object.keys(b.stats).length && !Object.keys(c.stats).length) {
            const extras = [formatStats(b.stats), ...b.tags];
            if (kindOf(row.name)?.slot !== b.slot) extras.push(`slot: ${b.slot}`);
            const on = b.equipped && !TAKEN_OFF.test(prose) && !c.equipped;
            head = [on ? 'equipped' : '', b.rarity, extras.filter(Boolean).join(', ')].filter(Boolean).join(' · ');
        } else if (!b.slot && b.effect && !parseEffect(row.note ?? '') && !c.slot && (!c.effect || formatEffect(c.effect) === formatEffect(b.effect))) {
            head = [b.rarity !== 'common' ? b.rarity : '', formatEffect(b.effect)].filter(Boolean).join(' · ');
        } else if (/\bmaterial\b/i.test(was.note ?? '') && !/\bmaterial\b/i.test(prose) && !c.slot) {
            head = clean(was.note);
        } else if (ON_ORDER.test(was.note ?? '') && !ON_ORDER.test(prose) && !Object.keys(c.stats).length) {
            // (0.5.36) An order retold ("being carved"): still on order until a <Crafted> collects it.
            head = clean(was.note);
        }
        if (!head) continue;
        lines[row.index] = rewriteCell(lines[row.index], row, row.qtyCell + 1, escapeCell(prose ? `${head} · ${prose}` : head));
        changed = true;
    }
    // (0.5.36) A piece on order is the crafter's until collected: a reply that left its row out
    // gets it back under [On Order].
    const present = new Set(scan(lines).rows.map(row => row.key));
    for (const was of old.filter(row => ON_ORDER.test(row.note ?? '') && !present.has(row.key))) {
        insertRow(lines, ORDER_SECTION, `${escapeName(was.name)} | ${escapeCell(was.qty || '1')} | ${escapeCell(clean(was.note))}`);
        changed = true;
    }
    return changed ? dropEmptyMarks(lines).join(eolOf(text)) : text;
}

// A section's "(empty)" line goes once the section holds a row.
function dropEmptyMarks(lines) {
    const { rows } = scan(lines);
    const filled = new Set(rows.map(row => row.category));
    let category = '';
    return lines.filter(line => {
        const trimmed = line.trim();
        const header = headerName(trimmed);
        if (header !== null) category = header;
        return !(header === null && trimmed && EMPTY_LINE.test(trimmed.replace(LIST_MARKER, '')) && filled.has(category));
    });
}

/** Consumables used in a fight taken out: { name: count } down, a row at 0 removed. */
export function useItems(inventoryText, used = {}) {
    const text = String(inventoryText ?? '');
    const eol = eolOf(text);
    const lines = text.split(/\r?\n/);
    for (const [name, count] of Object.entries(used ?? {})) {
        const n = Math.round(Number(count) || 0);
        if (n <= 0) continue;
        const row = scan(lines).rows.find(entry => entry.key === nameKey(name));
        if (!row) continue;
        const have = /\d/.test(row.qty) ? quantity(row.qty) : 1;
        if (have - n <= 0) lines.splice(row.index, 1);
        else lines[row.index] = rewriteQty(lines[row.index], row, /\d/.test(row.qty) ? row.qty.replace(/\d[\d,]*/, String(have - n)) : String(have - n));
    }
    return lines.join(eol);
}

export { SLOTS, SLOT_NAMES, ITEM_STATS };
