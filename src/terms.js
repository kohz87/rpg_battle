// Display terms: the words a world uses for levels and XP (DESIGN §5.7).
//
// RPG Battle counts levels and XP, but a lorebook may call them "Soul Class" and "Soul
// Growth", "Rank", "Circle" or "Power Growth", and may group levels into titled tiers
// (levels 1–10 are "Soul Class I", 11–20 "Soul Class II"…). The reader names them in the
// settings (`terms`, merged into rules as `rules.terms`); nothing here knows any one world's
// words. The numbers underneath never change: a level is still a level, XP still XP, and
// every block keeps the exact level in a form the parsers read back ("(Lv 24)"), so turning
// the terms on or off, or changing them, never loses a sheet.
//
// Progress is XP within the current level against XP to the next level ("Soul Growth
// 30/100"), with tiers too (0.5.2): the bar beside "Soul Class I (Lv 1)" is read as the way to
// the next level, and a gain reads "+30" everywhere. The text is whole numbers only. Pure.

import { DEFAULT_RULES, xpToNext } from './rules.js';

export const DEFAULT_TERMS = Object.freeze({ levelName: 'Level', xpName: 'XP', tiers: null, cap: null });

const DEFAULT_TIER_SIZE = 10;
// A term is a label in the blocks (`Soul Class: …`), so it may not hold what separates
// fields there, and stays short enough for a tag in the Battle tab.
const MAX_TERM = 30;
// Well past any sensible cap; it only keeps the sums below from running away.
const MAX_CAP = 999;

const num = value => (Number.isFinite(Number(value)) ? Number(value) : null);
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cleanTerm(value, fallback) {
    const text = String(value ?? '').replace(/[|:#\r\n<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TERM).trim();
    return text || fallback;
}

/**
 * The terms in `rules`, checked and filled in: { levelName, xpName, tiers: { size, numerals }
 * | null, cap, custom }. `cap` is the highest level (terms.cap, else rules.character.maxLevel);
 * `custom` is true when anything differs from plain "Level" and "XP".
 */
export function termsOf(rules = DEFAULT_RULES) {
    const t = rules?.terms && typeof rules.terms === 'object' ? rules.terms : {};
    const fallbackCap = Math.max(1, Math.round(num(rules?.character?.maxLevel) ?? DEFAULT_RULES.character.maxLevel));
    const ownCap = num(t.cap);
    const cap = ownCap !== null && ownCap >= 1 ? Math.min(MAX_CAP, Math.round(ownCap)) : fallbackCap;
    let tiers = null;
    if (t.tiers && typeof t.tiers === 'object' && t.tiers.enabled !== false) {
        const size = num(t.tiers.size);
        tiers = {
            size: size !== null && size >= 1 ? Math.min(MAX_CAP, Math.round(size)) : DEFAULT_TIER_SIZE,
            numerals: t.tiers.numerals === 'arabic' ? 'arabic' : 'roman',
        };
    }
    const levelName = cleanTerm(t.levelName, DEFAULT_TERMS.levelName);
    const xpName = cleanTerm(t.xpName, DEFAULT_TERMS.xpName);
    // The reader's own rank ladder (`terms.ranks`: Story Block's Rank ladder setting, or a rules file's):
    // a level is then shown as its rank's title ("Soul Class III (Lv 24)", "D (Lv 24)").
    const named = cleanRanks(t.ranks).length > 0;
    const custom = levelName !== DEFAULT_TERMS.levelName || xpName !== DEFAULT_TERMS.xpName || Boolean(tiers) || named || cap !== fallbackCap;
    return { levelName, xpName, tiers, cap, custom, named };
}

/** The highest level a sheet can reach (the terms' cap, else rules.character.maxLevel). */
export function maxLevel(rules = DEFAULT_RULES) {
    return termsOf(rules).cap;
}

/** True when the reader has named their own terms, so F–SSS give way to their levels. */
export function isCustom(rules = DEFAULT_RULES) {
    return termsOf(rules).custom;
}

// ---------------------------------------------------------------------------------------
// Numerals and tiers

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const ROMAN_PATTERN = /^(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i;

/** 3 → 'III' (or '3' for arabic numerals). */
export function numeral(value, kind = 'roman') {
    const n = Math.max(1, Math.round(num(value) ?? 1));
    if (kind === 'arabic' || n >= 4000) return String(n);
    let rest = n;
    let out = '';
    for (const [amount, letters] of ROMAN) {
        while (rest >= amount) {
            out += letters;
            rest -= amount;
        }
    }
    return out;
}

/** 'III' → 3, 'iv' → 4; anything that is not a Roman numeral → null. */
export function parseRoman(text) {
    const word = String(text ?? '').trim();
    if (!ROMAN_PATTERN.test(word)) return null;
    const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    const letters = word.toUpperCase();
    for (let index = 0; index < letters.length; index++) {
        const value = values[letters[index]];
        const next = values[letters[index + 1]] ?? 0;
        total += value < next ? -value : value;
    }
    return total;
}

const clampLevel = (level, terms) => Math.min(terms.cap, Math.max(1, Math.round(level)));
// The level a label shows: the character's own, even above a cap lowered after they reached it
// (B-b4-13: a level-20 character under a cap of 3 is still "Lv 20", not "Lv 3").
const shownLevel = level => Math.max(1, Math.round(level));

/** The tier (1, 2, …) a level is in; 1 when tiers are off. */
export function tierOf(level, rules = DEFAULT_RULES) {
    const terms = termsOf(rules);
    if (!terms.tiers) return 1;
    return Math.ceil(clampLevel(num(level) ?? 1, terms) / terms.tiers.size);
}

/** The first level of a tier (tier III of size 10 → 21), never above the cap. */
export function tierStart(tier, rules = DEFAULT_RULES) {
    const terms = termsOf(rules);
    const size = terms.tiers?.size ?? 1;
    return clampLevel((Math.max(1, Math.round(num(tier) ?? 1)) - 1) * size + 1, terms);
}

// ---------------------------------------------------------------------------------------
// Labels

/** 'Level 4', 'Soul Power 4', with tiers 'Soul Class III', with the reader's ladder its rank's title ('SS'). */
export function levelLabel(level, rules = DEFAULT_RULES) {
    const terms = termsOf(rules);
    const lv = shownLevel(num(level) ?? 1);
    if (terms.named) return rankAt(lv, rankLadder(rules))?.title ?? `${terms.levelName} ${lv}`;
    if (!terms.tiers) return `${terms.levelName} ${lv}`;
    return `${terms.levelName} ${numeral(Math.ceil(lv / terms.tiers.size), terms.tiers.numerals)}`;
}

/** levelLabel with the exact level when a tier hides it: 'Soul Class III (Lv 24)', 'Level 4'. */
export function levelText(level, rules = DEFAULT_RULES) {
    const terms = termsOf(rules);
    const lv = shownLevel(num(level) ?? 1);
    return terms.tiers || terms.named ? `${levelLabel(lv, rules)} (Lv ${lv})` : levelLabel(lv, rules);
}

/**
 * The compact level tag for a list row: 'Lv 4' with the plain terms (as before), else
 * levelLabel ('Soul Power 4', 'Soul Class III').
 */
export function levelTag(level, rules = DEFAULT_RULES) {
    const terms = termsOf(rules);
    return terms.custom ? levelLabel(level, rules) : `Lv ${shownLevel(num(level) ?? 1)}`;
}

/** The XP term: 'XP', 'Soul Growth'. */
export function xpLabel(rules = DEFAULT_RULES) {
    return termsOf(rules).xpName;
}

/**
 * The choices for an enemy's power when the terms are custom: every tier up to the cap
 * (`{ level: its first level, label: 'Soul Class II' }`), or every level when tiers are off.
 */
export function powerOptions(rules = DEFAULT_RULES) {
    const terms = termsOf(rules);
    const options = [];
    if (terms.named) return rankLadder(rules).map(rank => ({ level: rank.levels[0], label: rank.title }));
    if (terms.tiers) {
        for (let tier = 1; (tier - 1) * terms.tiers.size + 1 <= terms.cap; tier++) {
            const level = tierStart(tier, rules);
            options.push({ level, label: levelLabel(level, rules) });
        }
    } else {
        for (let level = 1; level <= terms.cap; level++) options.push({ level, label: levelLabel(level, rules) });
    }
    return options;
}

// ---------------------------------------------------------------------------------------
// Progress

/**
 * How far a sheet is towards its next level: { cur, max, text, capped }, XP within the level
 * against XP to the next one ("31/100"), with or without tiers; whole numbers only. At the
 * cap: "MAX" (cur = max).
 */
export function progress(sheet, rules = DEFAULT_RULES) {
    const terms = termsOf(rules);
    const level = clampLevel(num(sheet?.level) ?? 1, terms);
    const xp = Math.max(0, Math.round(num(sheet?.xp) ?? 0));
    if (level >= terms.cap) return { cur: 100, max: 100, text: 'MAX', capped: true };
    const next = xpToNext(level, rules);
    return { cur: xp, max: next, text: `${xp}/${next}`, capped: false };
}

/** "Soul Growth 30/100", "XP 31/100", "Soul Growth MAX". */
export function progressLabel(sheet, rules = DEFAULT_RULES) {
    return `${xpLabel(rules)} ${progress(sheet, rules).text}`;
}

/**
 * XP within `level` from a written progress value: its first number, rounded, within the
 * level's own range (0 to xpToNext − 1), so "30/100" is 30 and nothing levels up just from
 * being read (an odd value, "45.20/100" or "140/280", is its first number, kept in range);
 * "MAX" or nothing → 0.
 */
export function xpFromProgress(value, level, rules = DEFAULT_RULES) {
    const terms = termsOf(rules);
    const text = String(value ?? '').trim();
    const lv = clampLevel(num(level) ?? 1, terms);
    const top = Math.max(0, xpToNext(lv, rules) - 1);
    if (/^max\b/i.test(text)) return 0;
    const first = text.match(/\d+(?:\.\d+)?/);
    return first ? Math.min(top, Math.max(0, Math.round(Number(first[0])))) : 0;
}

/** An XP gain as the reader reads it: '+38', with or without tiers (0.5.2: never a share of the tier). */
export function xpGainText(gain) {
    return `+${Math.max(0, Math.round(num(gain) ?? 0))}`;
}

// ---------------------------------------------------------------------------------------
// Reading a level back

/**
 * A level from text written in the terms or plainly: "Level 25", "Lv 24", "Soul Class III
 * (Lv 24)" → 24 (the exact level wins), "Soul Class III" → 21 (the tier's first level),
 * "Soul Power 4" → 4, "III" (tiers on) → 21, "25" → 25. Null when nothing reads.
 * `strict`: a bare number or numeral is not enough, the level name (or "level"/"lv") must be
 * there (for the model's prose, where a stray "II" is not a power).
 */
export function parseLevelLabel(text, rules = DEFAULT_RULES, { strict = false } = {}) {
    const terms = termsOf(rules);
    const source = String(text ?? '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
    if (!source) return null;
    // The exact level first: "(Lv 24)" is what the blocks write next to a tier.
    const exact = source.match(/\b(?:lv|lvl)\.?\s*:?\s*(\d+)\b/i);
    if (exact) return clampLevel(Number(exact[1]), terms);
    // The reader's ladder: a rank's whole title or id ("Soul Class III", "SS") is its first level.
    if (terms.named) {
        const ladder = rankLadder(rules);
        const whole = rankWords(source).join(' ');
        const rank = ladder.find(entry => rankWords(entry.title).join(' ') === whole || rankWords(entry.id).join(' ') === whole);
        if (rank) return clampLevel(rank.levels[0], terms);
    }
    const named = source.match(new RegExp(`(?:^|[^\\p{L}])${escapeRegExp(terms.levelName)}\\s*:?\\s*([\\p{L}\\d]+)`, 'iu'));
    // "Level 25" is always a level, whatever the world calls it.
    const plainLevel = source.match(/\blevel\s*:?\s*(\d+)\b/i);
    if (!named && plainLevel) return clampLevel(Number(plainLevel[1]), terms);
    const rest = named ? named[1] : strict ? null : source.match(/^([\p{L}\d]+)$/u)?.[1] ?? null;
    if (!rest) return null;
    const roman = parseRoman(rest);
    if (terms.tiers) {
        if (roman !== null) return tierStart(roman, rules);
        // A digit after the level name is a tier in an arabic-numeral world; bare digits are levels.
        if (/^\d+$/.test(rest)) return named && terms.tiers.numerals === 'arabic' ? tierStart(Number(rest), rules) : clampLevel(Number(rest), terms);
        return null;
    }
    return /^\d+$/.test(rest) ? clampLevel(Number(rest), terms) : null;
}

// ---------------------------------------------------------------------------------------
// Terms a pack suggests (Story Suite v2, MODULES §F25)

// The words a pack may suggest, as termsOf reads them: { levelName, xpName, tiers }. The
// level cap is a rule, not a word, so a pack does not set it here.
export const TERM_FIELDS = Object.freeze(['levelName', 'xpName', 'tiers']);

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const cleanWord = value => (typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim().slice(0, 30) : null);

function cleanTiers(value) {
    if (value === true) return { size: 10, numerals: 'roman' };
    if (!isRecord(value)) return null;
    const out = {};
    if (Number.isInteger(value.size) && value.size >= 1) out.size = value.size;
    if (value.numerals === 'roman' || value.numerals === 'arabic') out.numerals = value.numerals;
    if (value.enabled === false) out.enabled = false;
    return out;
}

/** One record's terms (`levelName` or `level`, `xpName` or `xp`, `tiers`), only the fields it gives. */
function termsRecord(record) {
    if (!isRecord(record)) return {};
    const source = isRecord(record.terms) ? record.terms : record;
    const out = {};
    const level = cleanWord(source.levelName ?? source.level);
    const xp = cleanWord(source.xpName ?? source.xp);
    const tiers = cleanTiers(source.tiers);
    if (level) out.levelName = level;
    if (xp) out.xpName = xp;
    if (tiers) out.tiers = tiers;
    return out;
}

/**
 * The terms the enabled packs suggest, or null: the first pack's record from Story Block's
 * `packs.content({ kind: 'terms' })` (one `{ pack, levelName?, xpName?, tiers? }` per pack, as
 * `currency` comes). Read defensively: no packs part, a host without the kind, or a failing
 * query all mean none.
 */
export function packTerms(query) {
    if (typeof query !== 'function') return null;
    let list;
    try {
        list = query('packs.content', { kind: 'terms' });
    } catch {
        return null;
    }
    for (const record of Array.isArray(list) ? list : []) {
        const terms = termsRecord(record);
        if (Object.keys(terms).length) return terms;
    }
    return null;
}

/**
 * The terms a part reads: the pack's suggestion with the reader's own `terms` over it, field by
 * field (a reader's field wins whenever it is set; null or empty leaves the pack's).
 */
export function mergeTerms(reader, pack) {
    const own = isRecord(reader) ? reader : {};
    if (!pack) return isRecord(reader) ? reader : undefined;
    const out = { ...own };
    for (const field of TERM_FIELDS) {
        const mine = own[field];
        const set = field === 'tiers' ? isRecord(mine) : typeof mine === 'string' && mine.trim() !== '';
        if (!set && pack[field] !== undefined) out[field] = structuredClone(pack[field]);
    }
    return out;
}

/**
 * The reader's rank ladder as Story Block gives it (its Rank ladder setting: `packs.content({ kind:
 * 'ranks' })` records with `reader: true`), or null. Read defensively, like packTerms.
 */
export function readerRanks(query) {
    if (typeof query !== 'function') return null;
    let list;
    try {
        list = query('packs.content', { kind: 'ranks' });
    } catch {
        return null;
    }
    const own = Array.isArray(list) ? list.filter(record => isRecord(record) && record.reader === true) : [];
    return cleanRanks(own).length ? own.map(record => structuredClone(record)) : null;
}

/**
 * A part's settings with the pack's terms under the reader's (unchanged when no pack suggests any), and
 * the reader's rank ladder from Story Block (readerRanks) as `terms.ranks` when the terms name none.
 */
export function withTerms(settings, query) {
    const pack = packTerms(query);
    const ladder = readerRanks(query);
    if (!pack && !ladder) return settings;
    let terms = pack ? mergeTerms(settings?.terms, pack) : settings?.terms;
    if (ladder && !(isRecord(terms) && cleanRanks(terms.ranks).length)) terms = { ...(isRecord(terms) ? terms : {}), ranks: ladder };
    return { ...settings, terms };
}

/**
 * The module's settings with the reader's own words (the Character part's **XP word** and **Level word**,
 * `party.xpName` and `party.levelName`, MODULES §F105) folded into `terms`, over a rules file's `terms`;
 * blank ones leave it as it was.
 */
export function foldReaderTerms(all) {
    if (!isRecord(all)) return all;
    const words = {};
    for (const field of ['levelName', 'xpName']) {
        const word = cleanWord(all[`party.${field}`]);
        if (word) words[field] = cleanTerm(word, '');
    }
    for (const field of Object.keys(words)) if (!words[field]) delete words[field];
    if (!Object.keys(words).length) return all;
    return { ...all, terms: { ...(isRecord(all.terms) ? all.terms : {}), ...words } };
}

// ---------------------------------------------------------------------------------------
// The rank ladder (Story Suite v2, MODULES §F86, §F91)
//
// There is one ladder in the suite and it is these terms: a rank is a band of levels,
// `{ id, title, levels: [lo, hi] }`, lowest first. Where it comes from, first that has any:
// 1. the reader's own named list (`terms.ranks`, the same fields a pack's ranks have: a rules file's, or
//    Story Block's Rank ladder setting, MODULES §F105); a list with no levels at all is spread over the
//    levels (bands of the tier size, else evenly up to the cap) and its rewards are the ones Story Block
//    kept from the pack at each place, else by place times the money scale;
// 2. the first enabled pack's `ranks` content (Story Block's `packs.content({ kind: 'ranks' })`),
//    a named list whose bands may be uneven and may overlap;
// 3. uniform tiers (`terms.tiers`: size and numerals), one rank per tier ("Soul Class II",
//    levels 11–20);
// 4. the built-in F to S ladder (Story Director's DEFAULT_RANKS bands, the last one reaching the
//    level cap).
// A rank with no levels of its own takes the built-in band at its place, past those the band
// after the one before it, as wide. Each rank has a `reward` range too (in the chat's currency):
// a pack's as written (by place where it gives none, as Story Director reads a pack's). Every
// other ladder (the reader's, the tiers) only renames and re-bands the levels, so it pays by level,
// never by its length (B-a2-1): a rank's reward is the one the base ladder (the first enabled pack's
// own ranks, else the built-in F to S, by place times the pack's money scale: `inventory.economy`'s
// `scale`, F104) pays at the rank's first level (rewardAt), and a reward the reader's ranks carry
// (a rules file's, or the one Story Block kept at that place) only ever lowers it. Bands are held to
// the level cap; a rank that would start above it is left out (the lowest rank always stays). Story
// Director reads this as `party.ranks`; RPG Battle reads it for a foe line's `rank: D`.

export const DEFAULT_RANK_BANDS = Object.freeze([
    ['F', [1, 5]], ['E', [6, 12]], ['D', [13, 20]], ['C', [21, 30]], ['B', [31, 40]], ['A', [41, 50]], ['S', [51, 60]],
].map(([id, levels]) => Object.freeze({ id, levels: Object.freeze(levels) })));

// The most ranks a ladder holds (a tiered world with tiers of 1 level stops here).
export const MAX_RANKS = 40;
const RANK_ID = /^[A-Za-z0-9+-]{1,8}$/;

const isPair = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isInteger(n) && n >= 1 && n <= MAX_CAP) && value[0] <= value[1];
const isRange = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isSafeInteger(n) && n >= 0) && value[0] <= value[1];

// Rewards by place (Story Director's rewardByPlace): the first rank about 10 to 50, each rank after it
// about four and a half times the one before, two significant digits.
const FIRST_REWARD = Object.freeze([10, 50]);
const REWARD_STEP = 4.5;
const roughly = value => {
    if (value < 100) return Math.round(value / 5) * 5;
    const scale = 10 ** (Math.floor(Math.log10(value)) - 1);
    return Math.round(value / scale) * scale;
};

/** The built-in reward range `[lo, hi]` of the rank at `index` (0 = the lowest), times `scale` (whole, at least 1). */
export function rankReward(index, scale = 1) {
    let range = [...FIRST_REWARD];
    for (let n = 1; n <= Math.min(Math.max(0, Math.floor(index)), MAX_RANKS); n += 1) range = [range[1], roughly(FIRST_REWARD[1] * REWARD_STEP ** n)];
    const k = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
    return k === 1 ? range : range.map(n => Math.max(1, Math.round(n * k)));
}

/** A list of rank records (`{ id, title?, levels?, reward?, xp? }`) cleaned: good ids only, once each (ignoring case), in order. */
function cleanRanks(list) {
    const out = [];
    for (const record of Array.isArray(list) ? list : []) {
        if (!isRecord(record) || out.length >= MAX_RANKS) continue;
        const id = String(record.id ?? '').trim();
        if (!RANK_ID.test(id) || out.some(rank => rank.id.toLowerCase() === id.toLowerCase())) continue;
        const title = cleanTerm(record.title ?? '', '');
        out.push({ id, title, levels: isPair(record.levels) ? [...record.levels] : null, reward: isRange(record.reward) ? [...record.reward] : null, ...(isRange(record.xp) ? { xp: [...record.xp] } : {}) });
    }
    return out;
}

/**
 * The first level of each of `n` ranks given no levels (B-a2-8: "spread to the level cap"): bands of
 * `tierSize` levels when the tiers hold them all under `cap`, else the levels shared out evenly (the
 * first ranks `floor(cap / n)` each, one more each for the remainder spread along), so no rank a reader
 * wrote is left out while there are levels for it. RPG Battle bands a bare ladder with it, and hands
 * the bands to Story Block (`ranks.reader`, readerLadderBands), so every module reads the same levels.
 */
export function bareStarts(n, cap, tierSize = null) {
    const count = Math.max(0, Math.floor(Number(n) || 0));
    const top = Math.max(1, Math.floor(Number(cap) || 1));
    const size = Number.isInteger(tierSize) && tierSize >= 1 ? tierSize : null;
    if (size && count * size <= top) return Array.from({ length: count }, (_, i) => i * size + 1);
    return Array.from({ length: count }, (_, i) => Math.floor(i * top / Math.max(1, count)) + 1);
}

/**
 * Bands filled in (the built-in band at a place, else the next band as wide as the last; with `starts`,
 * each rank from its start to the level before the next one's) and held to the cap. A rank's own
 * reward is kept when `ownRewards`, else (and where it has none) by place times `scale` (`packScale`
 * for a pack's ladder: 1).
 */
function settle(list, cap, { extendLast = false, scale = 1, ownRewards = false, packScale = 1, starts = null } = {}) {
    const out = [];
    for (const [index, rank] of list.entries()) {
        let levels = rank.levels;
        if (!levels) {
            const before = out.at(-1)?.levels;
            levels = starts ? [starts[index], index + 1 < starts.length ? Math.max(starts[index], starts[index + 1] - 1) : cap]
                : DEFAULT_RANK_BANDS[index] ? [...DEFAULT_RANK_BANDS[index].levels]
                    : before ? [before[1] + 1, before[1] + 1 + (before[1] - before[0])] : [1, 1];
        }
        if (levels[0] > cap && out.length) break;
        const reward = ownRewards && rank.reward ? [...rank.reward] : rankReward(out.length, ownRewards ? packScale : scale);
        // A pack's rank keeps its experience range (`xp`, optional) as it wrote it: it is never worked out from the coin reward.
        out.push({ id: rank.id, title: rank.title || rank.id, levels: [Math.min(levels[0], cap), Math.min(levels[1], cap)], reward, ...(ownRewards && rank.xp ? { xp: [...rank.xp] } : {}) });
    }
    if (extendLast && out.length) out.at(-1).levels[1] = Math.max(out.at(-1).levels[1], cap);
    return out;
}

/**
 * The reward the base ladder pays at `level`: the reward of its highest rank that starts at or below
 * it (a band index capped at the base ladder's top), else its lowest rank's.
 */
export function rewardAt(level, base) {
    if (!Array.isArray(base) || !base.length) return [...FIRST_REWARD];
    let found = base[0];
    for (const rank of base) if (rank.levels[0] <= level) found = rank;
    return [...found.reward];
}

/** The experience range the base ladder gives at `level`: that of the rank `rewardAt` reads, when it has one (a rank without `xp` gives none). */
export function xpAt(level, base) {
    if (!Array.isArray(base) || !base.length) return null;
    let found = base[0];
    for (const rank of base) if (rank.levels[0] <= level) found = rank;
    return found.xp ? [...found.xp] : null;
}

/** The ladder rewards are reckoned on (rankLadder): the pack's own ranks (`base`) as written, else the built-in F to S × `scale`. */
function baseLadder(base, cap, scale) {
    const packed = cleanRanks(base);
    if (packed.length) return settle(packed, cap, { ownRewards: true });
    return settle(DEFAULT_RANK_BANDS.map(rank => ({ id: rank.id, title: rank.id, levels: [...rank.levels], reward: null })), cap, { extendLast: true, scale });
}

/** `ladder` paying by level on `basis` (rewardAt at each rank's first level); a rank's own reward only lowers it. */
function byLevel(ladder, basis, own = []) {
    return ladder.map((rank, index) => {
        const reward = rewardAt(rank.levels[0], basis);
        const mine = own[index]?.reward;
        // The experience range is paid by level the same way (only when the base ladder has one), and a rank's own only lowers it.
        const xp = xpAt(rank.levels[0], basis);
        const mineXp = own[index]?.xp;
        return { ...rank, reward: mine ? [Math.min(mine[0], reward[0]), Math.min(mine[1], reward[1])] : reward, ...(xp ? { xp: mineXp ? [Math.min(mineXp[0], xp[0]), Math.min(mineXp[1], xp[1])] : xp } : {}) };
    });
}

/**
 * The ladder in use: `[{ id, title, levels: [lo, hi], reward: [lo, hi], xp?: [lo, hi] }]`, lowest first (`xp` only where the pack's rank has one; see
 * above). `pack` is the pack's ranks (packRanks), when there are any; `base` the first enabled pack's
 * own ranks (packOwnRanks: the ones a reader's ladder renames), when there are any; `scale` the money scale.
 */
export function rankLadder(rules = DEFAULT_RULES, { pack = null, base = null, scale = 1 } = {}) {
    const terms = termsOf(rules);
    // The reader's own ladder (or a rules file's): it renames and re-bands; it pays by level on the base
    // ladder (byLevel); ranks with no levels are spread over the levels (bareStarts: by the tiers when they
    // fit, else evenly up to the cap), none left out.
    const own = cleanRanks(rules?.terms?.ranks);
    if (own.length) {
        // A list that gives no levels at all is spread over the levels; one that gives some takes the
        // built-in band where a rank has none, as before.
        const bare = own.every(rank => !rank.levels);
        const ladder = settle(own, terms.cap, { scale, starts: bare ? bareStarts(own.length, terms.cap, terms.tiers?.size) : null, extendLast: bare });
        return byLevel(ladder, baseLadder(base, terms.cap, scale), own);
    }
    const packed = cleanRanks(pack);
    if (packed.length) return settle(packed, terms.cap, { ownRewards: true });
    if (terms.tiers) {
        const out = [];
        for (let tier = 1; (tier - 1) * terms.tiers.size + 1 <= terms.cap && out.length < MAX_RANKS; tier++) {
            const lo = (tier - 1) * terms.tiers.size + 1;
            const id = numeral(tier, terms.tiers.numerals);
            out.push({ id, title: `${terms.levelName} ${id}`, levels: [lo, Math.min(terms.cap, lo + terms.tiers.size - 1)] });
        }
        // Tiers re-band the levels too: they pay by level on the built-in ladder (B-a2-1).
        return byLevel(out, baseLadder(null, terms.cap, scale));
    }
    return settle(DEFAULT_RANK_BANDS.map(rank => ({ id: rank.id, title: `${rank.id}-rank`, levels: [...rank.levels], reward: null })), terms.cap, { extendLast: true, scale });
}

/** The pack's money scale (F104): `inventory.economy` → `{ scale }`, a positive number; 1 without it. */
export function moneyScale(query) {
    if (typeof query !== 'function') return 1;
    let scale;
    try {
        scale = query('inventory.economy', {})?.scale;
    } catch {
        return 1;
    }
    return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * The ranks the first enabled pack suggests, or null: `packs.content({ kind: 'ranks' })` lists
 * every pack's ladder one after another, each record with its `pack`; one pack's ranks are taken
 * (the first that has any). Read defensively, like packTerms.
 */
export function packRanks(query) {
    if (typeof query !== 'function') return null;
    let list;
    try {
        list = query('packs.content', { kind: 'ranks' });
    } catch {
        return null;
    }
    if (!Array.isArray(list)) return null;
    const first = list.find(isRecord);
    if (!first) return null;
    const ranks = list.filter(record => isRecord(record) && record.pack === first.pack);
    return cleanRanks(ranks).length ? ranks : null;
}

/**
 * The first enabled pack's own ranks, past a reader's ladder (Story Block answers `packs.content`'s
 * ranks with the reader's; one pack's are asked for by its id, `packs.list` in order), or null. A
 * pack's ladder when no reader's is in use (packRanks). Read defensively, like packTerms.
 */
export function packOwnRanks(query) {
    const listed = packRanks(query);
    if (listed && !listed.every(record => record?.reader === true)) return listed;
    if (typeof query !== 'function') return null;
    let packs;
    try {
        packs = query('packs.list', {});
    } catch {
        return null;
    }
    for (const entry of Array.isArray(packs) ? packs : []) {
        if (!isRecord(entry) || !entry.enabled || typeof entry.id !== 'string') continue;
        let own;
        try {
            own = query('packs.content', { kind: 'ranks', pack: entry.id });
        } catch {
            own = null;
        }
        const ranks = Array.isArray(own) ? own.filter(record => isRecord(record) && record.reader !== true) : [];
        if (cleanRanks(ranks).length) return ranks;
    }
    return null;
}

// "D", "d-rank", "Rank D", "D rank", "Soul Class II" read alike: lower case, the word "rank" set aside.
const rankWords = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+]+/gu, ' ').split(' ').filter(word => word && word !== 'rank');

/**
 * The rank a written value names on `ladder`, or null: its id or title (case and the word "rank"
 * ignored), else a value that is the end of one title ("II" for "Soul Class II"). Exact first.
 */
export function rankNamed(value, ladder) {
    const want = rankWords(String(value ?? '').slice(0, 60)).join(' ');
    if (!want || !Array.isArray(ladder)) return null;
    const exact = ladder.find(rank => rankWords(rank.id).join(' ') === want || rankWords(rank.title).join(' ') === want);
    if (exact) return exact;
    const tail = want.split(' ');
    const ends = ladder.filter(rank => {
        const title = rankWords(rank.title);
        return tail.length < title.length && tail.every((word, i) => title[title.length - tail.length + i] === word);
    });
    return ends.length === 1 ? ends[0] : null;
}

/** The rank whose band holds `level` (the lowest such), else the highest band below it, else the lowest rank. */
export function rankAt(level, ladder) {
    if (!Array.isArray(ladder) || !ladder.length) return null;
    const lv = Math.max(1, Math.round(num(level) ?? 1));
    const holding = ladder.find(rank => lv >= rank.levels[0] && lv <= rank.levels[1]);
    if (holding) return holding;
    let best = ladder[0];
    for (const rank of ladder) if (rank.levels[1] < lv) best = rank;
    return best;
}

// ---------------------------------------------------------------------------------------
// The reader's rank ladder lines (terms2, MODULES §F105)
//
// The ladder is RPG Battle's setting since terms2 (Character, group Terms: Rank ladder, `party.ranks`, one
// `{ rank }` a line, "Name" or "Name: first level"; Levels per rank, `party.levelsPerRank`): a ladder bands
// levels, so it lives with them. RPG Battle hands the lines to Story Block through the `ranks.reader` hook;
// Story Block turns them into rank records and answers `packs.content({ kind: 'ranks' })` with them, which
// is what every module reads (readerRanks above, Story Director's quest.ranks), so all use the same bands.

export const MAX_LEVELS_PER_RANK = 999;

/** The `ranks.reader` hook's answer from the module's settings: `{ lines, perRank }`, or null with no lines. */
export function readerLadderLines(all) {
    const rows = Array.isArray(all?.['party.ranks']) ? all['party.ranks'] : [];
    const lines = rows.filter(row => isRecord(row) && typeof row.rank === 'string' && row.rank.trim()).map(row => ({ rank: row.rank }));
    if (!lines.length) return null;
    const per = Number(all?.['party.levelsPerRank']);
    return { lines, perRank: Number.isInteger(per) && per >= 1 ? Math.min(MAX_LEVELS_PER_RANK, per) : 0 };
}

const LINE_START = /^(.*?)\s*:\s*(\d{1,3})\s*$/;

/**
 * The `ranks.reader` hook's answer with every rank's levels worked out here (B-a2-8): each line as
 * "Name: first level", so Story Block's ladder (and Story Director's quest ranks, its coin budget) band
 * the ranks exactly as RPG Battle's `party.ranks` does. With Levels per rank: a line's own first level
 * when it rises, else that many after the one before (as Story Block reads it); without, the lines' own
 * when every one gives one and they rise, else spread to the cap (bareStarts: by `tierSize` when the
 * tiers hold them all; `tierSize` may be a function, asked only then). A rank that would start past
 * `cap` is left out (the first always stays). Null with no lines.
 */
export function readerLadderBands(all, { cap = 99, tierSize = null } = {}) {
    const given = readerLadderLines(all);
    if (!given) return null;
    const top = Math.max(1, Math.min(MAX_LEVELS_PER_RANK, Math.floor(Number(cap) || 1)));
    const lines = given.lines.map(({ rank }) => {
        const at = LINE_START.exec(String(rank).trim());
        const from = at ? Number(at[2]) : null;
        return { title: (at ? at[1] : String(rank)).trim(), from: Number.isInteger(from) && from >= 1 ? from : null };
    });
    let starts;
    if (given.perRank) {
        starts = [];
        for (const [index, line] of lines.entries()) {
            const before = starts[index - 1];
            starts.push(line.from !== null && (index === 0 || line.from > before) ? line.from : index === 0 ? 1 : before + given.perRank);
        }
    } else if (lines.every((line, index) => line.from !== null && (index === 0 || line.from > lines[index - 1].from))) {
        starts = lines.map(line => line.from);
    } else {
        starts = bareStarts(lines.length, top, typeof tierSize === 'function' ? tierSize() : tierSize);
    }
    const out = [];
    for (const [index, line] of lines.entries()) {
        const start = starts[index];
        if (out.length && (start > top || start <= starts[index - 1])) break;
        out.push({ rank: `${line.title}: ${Math.min(start, top)}` });
    }
    return { lines: out, perRank: 0 };
}

/**
 * Moves a ladder stored in Story Block's Terms (SB #121: `extension_settings.storySuite.modules['story-block']
 * .ranks`) to RPG Battle's `party.ranks`, once: only when RPG Battle has none stored. `storySuite` is the
 * stored object itself. Story Block's old key is removed either way. Returns true when anything changed (the
 * caller saves).
 */
export function migrateRankLadder(storySuite) {
    const modules = isRecord(storySuite?.modules) ? storySuite.modules : null;
    const old = modules?.['story-block']?.ranks;
    if (!Array.isArray(old)) return false;
    const rows = old.filter(row => isRecord(row) && typeof row.rank === 'string' && row.rank.trim()).map(row => ({ rank: row.rank }));
    if (!isRecord(modules['rpg-battle'])) modules['rpg-battle'] = {};
    const own = modules['rpg-battle'];
    if (rows.length && !Object.hasOwn(own, 'party.ranks')) own['party.ranks'] = rows;
    delete modules['story-block'].ranks;
    return true;
}

const MAX_PREVIEW = 6;

/**
 * The read-only preview of a ladder (`party.ranks`): "Soul Class I: Lv 1–10 · II: 11–20 · III: 21–30 · …
 * · IX: 81–90": the first rank's whole title, the rest without the words every title starts with, at most
 * MAX_PREVIEW ranks (then the last one). '' for none.
 */
export function ladderPreview(ladder) {
    const list = Array.isArray(ladder) ? ladder.filter(rank => isRecord(rank) && isPair(rank.levels)) : [];
    if (!list.length) return '';
    const titles = list.map(rank => String(rank.title || rank.id));
    const words = titles.map(title => title.split(' '));
    let shared = 0;
    while (words.every(list => list.length > shared + 1 && list[shared] === words[0][shared])) shared += 1;
    const range = ([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);
    const part = (rank, index) => `${index === 0 ? titles[0] : words[index].slice(shared).join(' ')}: ${index === 0 ? 'Lv ' : ''}${range(rank.levels)}`;
    const shown = list.length > MAX_PREVIEW ? [...list.slice(0, MAX_PREVIEW - 1).map((rank, index) => part(rank, index)), '…', part(list.at(-1), list.length - 1)] : list.map(part);
    return shown.join(' · ');
}
