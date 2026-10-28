// RPG Battle v2, quests: the rank ladder (F86) and rewards held inside a rank's range (F87).
// Pure. The suite keeps one ladder: the reader's (Story Block's Rank ladder setting, which answers the
// packs' `ranks` content with `reader: true` records), else the enabled packs' `ranks` content when they
// have one (complete, rewards included), else RPG Battle's level tiers (`party.ranks`, rewards added here by place on the
// ladder), else the built-in F to S ladder. A quest's `rank:` (or `difficulty:` when it names a rank)
// is matched against whichever ladder is in use. A quest from a pack takes the pack's rank. A quest with
// no rank gets one from its difficulty (defaultRank, B-b4-10 / B-b3-18), so every reward is held inside
// some rank's range. A rank the story writes is held to the party's own (questRank, RX-E-1).

import { currencyName, money } from './parse.js';
import { tryQuery } from './progress.js';

const clean = value => String(value ?? '').normalize('NFKC').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();

// Rewards by place on a ladder, in whole units of the chat's one currency: the first rank pays about
// 10 to 50, each rank after it about four and a half times the one before (two significant digits).
const FIRST_REWARD = Object.freeze([10, 50]);
const STEP = 4.5;

function roughly(value) {
    if (value < 100) return Math.round(value / 5) * 5;
    const scale = 10 ** (Math.floor(Math.log10(value)) - 1);
    return Math.round(value / scale) * scale;
}

/** The reward range `[lo, hi]` of the rank at `index` (0 = the lowest) on a ladder with no rewards of its own. */
export function rewardByPlace(index) {
    if (!Number.isSafeInteger(index) || index <= 0) return [...FIRST_REWARD];
    return [rewardByPlace(index - 1)[1], roughly(FIRST_REWARD[1] * STEP ** index)];
}

// The built-in ladder, for a level cap of about 60.
const DEFAULT_LEVELS = [[1, 5], [6, 12], [13, 20], [21, 30], [31, 40], [41, 50], [51, 60]];
export const DEFAULT_RANKS = Object.freeze(['F', 'E', 'D', 'C', 'B', 'A', 'S'].map((id, index) => Object.freeze({
    id, title: `${id}-rank`, levels: Object.freeze(DEFAULT_LEVELS[index]), reward: Object.freeze(rewardByPlace(index)),
})));

const isPair = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isSafeInteger(n) && n >= 0) && value[0] <= value[1];

// A record's own id: the pack's slug (`pack.<pack>/<slug>` → `<slug>`; a short letter slug in capitals,
// as ranks are written: `d` → `D`), RPG Battle's id as it is.
function rankId(record) {
    const own = clean(record.rank ?? record.short);
    if (own) return own;
    const raw = clean(record.slug) || clean(record.id).replace(/^pack\.[^/]*\//, '');
    return /^[a-z]{1,3}$/.test(raw) ? raw.toUpperCase() : raw;
}

/**
 * A ladder from a list of records (`{ id, title?, levels?, reward?, xp? }`, a pack's or RPG Battle's), lowest
 * first: records without an id (or with one already seen) are left out; missing or bad levels are the
 * built-in band at that place (null past it); a missing or bad reward is given one by place
 * (`withRewards: false` always gives them by place). Null when nothing is left.
 */
export function ladderFrom(list, { withRewards = true } = {}) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const record of list) {
        if (!record || typeof record !== 'object') continue;
        const id = rankId(record);
        if (!id || out.some(rank => rank.id.toLowerCase() === id.toLowerCase())) continue;
        const own = Array.isArray(record.levels) ? record.levels.map(Number) : null;
        const levels = isPair(own) ? own : DEFAULT_LEVELS[out.length] ?? null;
        const given = Array.isArray(record.reward) ? record.reward.map(Number) : null;
        const reward = withRewards && isPair(given) ? given : rewardByPlace(out.length);
        // A rank's experience range (`xp`, optional, 2.5.0) is the pack's own and is never worked out from its coin reward.
        const xp = Array.isArray(record.xp) ? record.xp.map(Number) : null;
        out.push({ id, title: clean(record.title ?? record.name) || id, levels: levels ? [...levels] : null, reward: [...reward], ...(isPair(xp) ? { xp: [...xp] } : {}) });
    }
    return out.length ? out : null;
}

// `packs.content({ kind: 'ranks' })` lists every enabled pack's ladder one after another, each record
// tagged with its `pack`: the first pack with any records is the chat's ladder.
function firstPack(list) {
    if (!Array.isArray(list)) return null;
    const first = list.find(record => record && typeof record === 'object');
    if (!first) return null;
    return list.filter(record => record && typeof record === 'object' && record.pack === first.pack);
}

/**
 * The pack's money scale (F104): `inventory.economy` → `{ scale }`, a positive finite number; 1 when the
 * query is not there, throws, or gives anything else.
 */
export function moneyScale(query) {
    const scale = tryQuery(query, 'inventory.economy', {}, null)?.scale;
    return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** A DEFAULT_RANKS reward range times `scale`, in whole units, at least 1 each. */
export function scaledReward(reward, scale) {
    return reward.map(n => Math.max(1, Math.round(n * scale)));
}

/**
 * `quest.ranks` → `[{ id, title, levels: [lo, hi] | null, reward: [lo, hi] }]`, lowest first: the first
 * enabled pack's `ranks` content (as written), else RPG Battle's `party.ranks` with rewards by place, else
 * DEFAULT_RANKS. Rewards Story Director sets itself (by place, for RPG Battle's ladder and its own) are
 * times the pack's money scale (moneyScale, F104); a pack's own ladder keeps its rewards as written.
 * Plain copies.
 */
export function ranksOf(query) {
    // Quests: Quest ranks follow the rank ladder (on by default). Off: the packs' own ladder, never the
    // reader's, nor RPG Battle's banding of it.
    const follow = tryQuery(query, 'quest.followsLadder', {}, true) !== false;
    let records = firstPack(tryQuery(query, 'packs.content', { kind: 'ranks' }, null));
    if (!follow && records?.length && records.every(record => record.reader === true)) records = packOwnRanks(query);
    if (!follow) {
        const packs = ladderFrom(records);
        const scale = moneyScale(query);
        return packs ?? DEFAULT_RANKS.map(rank => ({ ...rank, levels: [...rank.levels], reward: scale === 1 ? [...rank.reward] : scaledReward(rank.reward, scale) }));
    }
    // The reader's own ladder (Story Block's Rank ladder setting, MODULES §F105: records with `reader:
    // true`): RPG Battle's `party.ranks` when it is there (it bands the same ranks by its levels and keeps
    // the same rewards), else the reader's ranks as they are, each with the pack's reward Story Block kept
    // at its place, else one by place times the money scale.
    if (records?.length && records.every(record => record.reader === true)) return readerLadder(records, query);
    const packs = ladderFrom(records);
    if (packs) return packs;
    const party = ladderFrom(tryQuery(query, 'party.ranks', {}, null), { withRewards: false });
    const scale = moneyScale(query);
    const scaled = rank => ({ ...rank, levels: rank.levels ? [...rank.levels] : null, reward: scale === 1 ? [...rank.reward] : scaledReward(rank.reward, scale) });
    return (party ?? DEFAULT_RANKS).map(scaled);
}

/** The first enabled pack's own ranks (`packs.content` with its `pack`), past the reader's ladder; null for none. */
function packOwnRanks(query) {
    const list = tryQuery(query, 'packs.list', {}, null);
    for (const entry of Array.isArray(list) ? list : []) {
        if (!entry?.enabled || typeof entry.id !== 'string') continue;
        const own = tryQuery(query, 'packs.content', { kind: 'ranks', pack: entry.id }, null);
        if (Array.isArray(own) && own.length) return own;
    }
    return null;
}

/** The reader's ladder (see ranksOf): RPG Battle's banding of it when that answers with the same ranks, else its own. */
function readerLadder(records, query) {
    const own = ladderFrom(records, { withRewards: true });
    if (!own) return DEFAULT_RANKS.map(rank => ({ ...rank, levels: [...rank.levels], reward: [...rank.reward] }));
    const party = ladderFrom(tryQuery(query, 'party.ranks', {}, null), { withRewards: true });
    const same = party && party.length === own.length && party.every((rank, index) => rank.id.toLowerCase() === own[index].id.toLowerCase());
    if (same) return party;
    const scale = moneyScale(query);
    return own.map((rank, index) => {
        const kept = Array.isArray(records[index]?.reward);
        return { ...rank, levels: rank.levels ? [...rank.levels] : null, reward: kept || scale === 1 ? [...rank.reward] : scaledReward(rank.reward, scale) };
    });
}

// "D", "d-rank", "Rank D", "D rank", "Soul Class II" read the same way: lower case, the word rank set aside.
const words = value => clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(word => word && word !== 'rank');

/**
 * The rank a written value names on `ladder`, or null: by id or title, ignoring case and the word "rank";
 * a value that is only the end of a title ("II" for "Soul Class II") names it too. Exact matches first.
 */
export function rankNamed(value, ladder) {
    const want = words(value).join(' ');
    if (!want || !Array.isArray(ladder)) return null;
    const exact = ladder.find(rank => words(rank.id).join(' ') === want || words(rank.title).join(' ') === want);
    if (exact) return exact;
    return ladder.find(rank => {
        const title = words(rank.title);
        const tail = want.split(' ');
        return tail.length < title.length && tail.every((word, i) => title[title.length - tail.length + i] === word);
    }) ?? null;
}

/** A quest thread's rank on `ladder`: its `rank:` field, else its `difficulty:` when that names a rank. */
export function rankOf(thread, ladder) {
    for (const field of ['rank', 'difficulty']) {
        const found = rankNamed(thread?.fields?.[field], ladder);
        if (found) return found;
    }
    return null;
}

/**
 * How far from the party's own rank a quest's difficulty puts it when it names no rank: easy one rank
 * below, normal the party's, hard one above, nightmare two above (held to the ends of the ladder, and
 * never more than WRITTEN_RANKS_ABOVE above the party's rank: see defaultRank, so today hard and
 * nightmare pay as normal; RPG Battle still scales their XP).
 */
export const DIFFICULTY_STEPS = Object.freeze({ easy: -1, normal: 0, hard: 1, nightmare: 2 });

/**
 * How many ranks above the party's own (defaultRank's base) a rank the story writes may be: none. A
 * written rank or difficulty may lower a reward, never lift it above the party's rank's range. Not even
 * on a quest code counts (RX-E-1): "bring 1 Torch" or "kill 1 rat" is counted but cheap, and RPG
 * Battle's fight records (`combat.foesBeaten`: names and counts) do not say how strong the foes were,
 * so code cannot tell a hard job from a written word. A pack quest keeps its pack's rank.
 */
export const WRITTEN_RANKS_ABOVE = 0;

/**
 * The rank a quest that names none is paid as: the party's rank on `ladder` (the rank whose levels hold
 * `level`, the player character's level; above every band, the highest band below it; the lowest rank
 * when the level is not known) moved by DIFFICULTY_STEPS for `difficulty` (easy, normal, hard,
 * nightmare; anything else is normal), and never more than `above` (WRITTEN_RANKS_ABOVE) above the
 * party's rank: a difficulty reaches no further than a written rank may (B-b3-r2-7). Null only for an
 * empty ladder.
 */
export function defaultRank(ladder, difficulty, level = null, above = WRITTEN_RANKS_ABOVE) {
    if (!Array.isArray(ladder) || !ladder.length) return null;
    let base = 0;
    if (Number.isSafeInteger(level) && level > 0) {
        const at = ladder.findIndex(rank => rank.levels && level >= rank.levels[0] && level <= rank.levels[1]);
        if (at >= 0) base = at;
        else ladder.forEach((rank, index) => { if (rank.levels && rank.levels[1] < level) base = index; });
    }
    const step = Math.min(above, Object.hasOwn(DIFFICULTY_STEPS, difficulty) ? DIFFICULTY_STEPS[difficulty] : 0);
    return ladder[Math.min(ladder.length - 1, Math.max(0, base + step))];
}

/**
 * The rank a quest is paid as: `{ rank, by, said? }`, `by` one of 'pack' (its pack quest's `rank` or
 * `letter`), 'written' (its own `rank:`, or a `difficulty:` that names a rank) or 'difficulty'
 * (defaultRank). `pack` is the quest's pack record or null; `level` the player character's level.
 * Code sets the numbers: a written rank more than WRITTEN_RANKS_ABOVE above the party's own is held
 * there (the party's own today), and `said` is the rank the story wrote: a written rank or difficulty
 * may lower the reward, never raise it. A rank below the party's is kept. A pack's rank is not held.
 */
export function questRank(thread, ladder, { pack = null, level = null, difficulty = 'normal' } = {}) {
    const fromPack = pack ? rankNamed(pack.rank ?? pack.letter ?? '', ladder) : null;
    if (fromPack) return { rank: fromPack, by: 'pack' };
    const written = rankOf(thread, ladder);
    if (written) {
        const most = Math.min(ladder.length - 1, ladder.indexOf(defaultRank(ladder, 'normal', level)) + WRITTEN_RANKS_ABOVE);
        return ladder.indexOf(written) > most ? { rank: ladder[most], by: 'written', said: written } : { rank: written, by: 'written' };
    }
    const rank = defaultRank(ladder, difficulty, level);
    return { rank, by: rank ? 'difficulty' : null };
}

/**
 * The most one reply may pay in quest rewards the story wrote (RX-E-1): the top of the party's own
 * rank's range on `ladder` (the rank defaultRank gives for `level`), as Story Block's per-reply coin
 * budget is by default. 0 for an empty ladder.
 */
export function replyBudget(ladder, level = null) {
    return defaultRank(ladder, 'normal', level)?.reward?.[1] ?? 0;
}

/** "220–1000 gold". */
export function rangeText(rank, currency) {
    // With coins, each end as Story Block writes an amount ("10 copper bits–1 silver mark"), as the wallet does.
    if (Array.isArray(currency?.coins) && currency.coins.length) return `${money(rank.reward[0], currency)}–${money(rank.reward[1], currency)}`;
    return `${rank.reward[0]}–${rank.reward[1]} ${typeof currency === 'string' ? currency : currencyName(currency)}`;
}

/**
 * A total reward held inside its rank's range: `{ total, held }`, `held` true when it was moved. A reward
 * of nothing in money (0, or no amount) is left as it is: "reward: none" is not raised to the range.
 * `capOnly`: only the top of the range holds (a small reward is not raised to the floor). Quests use
 * capOnly unless the pack wrote both the rank and the reward (rewardHold).
 */
export function holdReward(total, rank, { capOnly = false } = {}) {
    if (!rank || !Number.isSafeInteger(total) || total <= 0) return { total, held: false };
    const [lo, hi] = rank.reward;
    const kept = Math.min(hi, capOnly ? total : Math.max(lo, total));
    return { total: kept, held: kept !== total };
}

/**
 * The reward held for a quest whose rank came `by` 'pack', 'written' or 'difficulty' (questRank): only a
 * pack quest's reward is raised to its rank's floor (the pack wrote both); a reward the story wrote is
 * only ever lowered to the top (B-b3-r2-6: a written `rank:` does not raise "reward: 1 mark").
 */
export function rewardHold(total, rank, by) {
    return holdReward(total, rank, { capOnly: by !== 'pack' });
}

/** "the story said S-rank; held to D-rank for a level-12 party". */
export function rankHeldText(said, rank, level) {
    const party = Number.isSafeInteger(level) ? `a level-${level} party` : 'a party whose level is not known';
    return `the story said ${said.title}; held to ${rank.title} for ${party}`;
}

/** "reward clamped to D-rank range: 220–1000 gold (clamped from 5000 gold)". */
export function heldText(rank, said, currency) {
    return `reward clamped to ${rank.title} range: ${rangeText(rank, currency)} (clamped from ${said})`;
}
