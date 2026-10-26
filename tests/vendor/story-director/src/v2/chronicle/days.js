// Story Director v2, chronicle part: the day digest (feature `story-director.digest`, TRS idea 2). Pure.
//
// When the story clock has crossed into a new day, code writes what each finished day held, from
// the stored receipts and the state alone: no model call, no model prose. What a digest holds:
//   happened  the code-written summaries of the day's other receipts (what the story was told first),
//             at most 8, with how many more there were;
//   places    where the scene moved to (Story Block's `place` receipts);
//   quests    taken on, finished, failed or given up that day (the threads' own `taken` and `ended`
//             stamps, by the receipt that made them);
//   fights    how many ended, won, lost, fled (RPG Battle's fight results);
//   money     what came in and went out, in the currency's smallest unit (the receipts' own amounts);
//   npcs      stage moves of NPC State Delta's meters (its receipts' `stages`);
//   world     the chronicle's own world lines of that day (their receipt summaries);
//   met       who came into the scene that day (Story Block's `present` receipts' `added` names), kept
//             only when there is someone (older digests have none), for the World screen's Journal.
// and one line made of those facts. Every number is one code wrote down; every text is a receipt's
// own summary, a name the state keeps, or a calendar date.
//
// Which day a receipt belongs to: receipts are walked in chat order and the clock is followed through
// the receipts that set it (the tracker's `time` line, the pack's start, the time part's settle and
// `director.advance`, each with `data.minutes`). A receipt belongs to the day the clock was on when it was committed; before the
// clock was first set, to the first day it was set to.
//
// chronicle.days    = { [day]: [Digest] }   each day a slot (../slot.js), written whole
//   a whole Digest made from the day's kept entries has `src` (their revisions) and follows them (daysOf);
// chronicle.written = null | [{ through, days: [day], at, skip }]
//   through: the day the clock was on when digests were last written (days before it are done);
//   days:    the days that had a digest then, so one a deleted reply took away is written again;
//   at:      the chat's length then (the reply that was about to be written);
//   skip:    the story had just jumped far ahead (a time skip), so that reply hears the last day.
// Older days are kept short (their line only) and the oldest dropped: see `capDays`.

import { slotValue } from '../slot.js';

export const DIGEST_FEATURE = 'story-director.digest';
export const DIGEST = 'chronicle.digest';
export const DAY_MINUTES = 1440;

/** Settings: full digests kept, days kept in all (older ones are dropped). */
export const DIGEST_DEFAULTS = Object.freeze({ digestDays: 14, digestKeep: 120, digestTail: true });
export const FULL_MAX = 60;
export const KEEP_MAX = 365;
// The validator's ceilings: twice the settings' tops, so a replay that brings back an entry a deleted
// reply had dropped is never refused for it (SPEC §2.2 rule a); the next digest drops it again.
const FULL_CEILING = FULL_MAX * 2;
const KEEP_CEILING = KEEP_MAX * 2;

// What a digest may hold.
export const MAX_HAPPENED = 8;
export const MAX_PLACES = 8;
export const MAX_QUESTS = 6;
export const MAX_NPCS = 6;
export const MAX_WORLD = 6;
export const MAX_ITEM = 160;
export const MAX_LINE = 200;
export const MAX_DATE = 80;
export const MAX_NAME = 80;
export const MAX_MET = 8;

// Receipts that set the clock (module story-director, `data.minutes`). `director.advance` called by
// another module's command has no receipt of its own; the time part's settle before the next reply
// sets the clock right again.
const CLOCK_TYPES = new Set(['capture.time', 'director.seed', 'time.settle', 'director.advance']);
// Receipts that are bookkeeping only: never a fact of the day. Besides these, every receipt Story Block
// or a module committed on its own (cause `system`) that the story was not told (RX-cap-5: RPG Battle's
// `checks.prepare` dice for the next reply, a module set up): per-reply bookkeeping, not what happened.
// Making a character is the start of the story, not a day's event.
const QUIET_TYPES = new Set([DIGEST, 'chronicle.note', 'chronicle.surface', 'director.seed', 'checks.prepare', 'party.create']);
// The arc planner's commands (arc/commands.js): what was planned stays behind the scenes, so an arc's
// name and counts are never a fact of the day (the Journal shows only what {{user}} knows).
const PLANNED_TYPES = new Set(['director.arc.accept', 'director.arc.update', 'director.arc.end']);
const quiet = receipt => QUIET_TYPES.has(receipt.type) || String(receipt.type).startsWith('creation.')
    || (receipt.cause === 'system' && receipt.narrate !== true);
const SETTLE = 'time.settle';
// Story Block's scene receipts that name who came into the scene (`data.added`).
const PRESENT_TYPES = new Set(['capture.present', 'scene.present']);
// Receipts a section of the digest already tells (places, money, world), or the reader's own edits and
// a fight's blow-by-blow: never repeated under "happened".
const TOLD_ELSEWHERE = new Set([
    'capture.place', 'capture.coin', 'capture.world', 'capture.faction', 'wallet.receive', 'wallet.pay',
    'atlas.visit', 'atlas.edit', 'atlas.focus', 'chronicle.edit', 'chronicle.remove', 'combat.act',
]);
// A tracker line's receipt repeats the line itself ("Director: + quest …"): the model's words, not code's.
const ECHO = /^Director: /;

const isInt = value => Number.isSafeInteger(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value : '');

// Invisible format marks and control characters go; whitespace folds to one space.
const INVISIBLE = /[\p{Cf}\p{Cc}]+/gu;

/** `value` as one flat line: invisible marks and line breaks gone, spaces folded. */
export function flat(value) {
    return text(value).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

/** `value` cut to `max` code points (never inside a character), with "…" when it was longer. */
export function cut(value, max) {
    const chars = Array.from(flat(value));
    if (chars.length <= max) return chars.join('');
    return `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

const codePoints = value => Array.from(text(value)).length;

/** The story day of `minutes` (whole days since the calendar's start). */
export const dayOf = minutes => Math.floor(minutes / DAY_MINUTES);

/**
 * The day digests a chronicle keeps, by day number, as the day's facts stand now. A digest written
 * from the day's kept entries (`src`: their revisions) follows them: when a reply of that day is
 * deleted later (its entry goes with it), the digest is worked out again from the entries left
 * (followDigest), and a day none is left of is not there (the next digest drops it). Nothing of
 * this is stored: it is read from the state. `state` (the threads' stamps, for the quests) and
 * `currency` (the money's words in the line) are for a digest worked out again; without `state`
 * its quests stay as written.
 */
export function daysOf(chronicle, { state = null, currency = null } = {}) {
    const out = {};
    let byDay = null;
    let dayOfRev = null;
    for (const [key, stored] of Object.entries(isRecord(chronicle?.days) ? chronicle.days : {})) {
        const digest = slotValue(stored);
        if (!digest || !isInt(digest.day) || String(digest.day) !== key) continue;
        if (digest.brief || !Array.isArray(digest.src) || !digest.src.length) {
            out[key] = digest;
            continue;
        }
        byDay ??= entriesByDay(chronicle);
        const src = new Set(digest.src);
        const left = (byDay.get(digest.day) ?? []).filter(item => src.has(item.rev));
        if (!left.length) continue;
        if (left.length === src.size) {
            out[key] = digest;
            continue;
        }
        dayOfRev ??= rangeDays(byDay);
        out[key] = followDigest(digest, left, { state, currency, dayOfRev });
    }
    return out;
}

/**
 * `digest` worked out again from `left` (the day's entries still kept, `[{ rev, entry }]` in order):
 * its facts and line from them, its date and `made` as written, its quests from `state` when given.
 */
export function followDigest(digest, left, { state = null, currency = null, dayOfRev = () => null } = {}) {
    const facts = factsOf(left.map(item => item.entry), { state, day: digest.day, dayOfRev });
    const quests = state ? facts.quests : digest.quests;
    return makeDigest(digest.day, { ...facts, quests }, { date: digest.date, currency, made: digest.made, revs: facts.revs, src: left.map(item => item.rev) });
}

/** The days kept, oldest first (daysOf's options). */
export const orderedDays = (chronicle, options) => Object.values(daysOf(chronicle, options)).sort((a, b) => a.day - b.day);

/** `chronicle.written` (where digests were last written), or null. */
export const writtenOf = chronicle => slotValue(chronicle?.written);

// ---- the digest settings ---------------------------------------------------------------------

/** The digest settings out of the chronicle part's settings (a function, an object, or nothing). */
export function digestSettings(source) {
    let value = source;
    if (typeof source === 'function') {
        try { value = source(); } catch { value = null; }
    }
    const own = isRecord(value) ? value : {};
    const whole = (raw, min, max, fallback) => {
        const n = Number(raw);
        return isInt(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    const full = whole(own.digestDays, 1, FULL_MAX, DIGEST_DEFAULTS.digestDays);
    const keep = Math.max(full, whole(own.digestKeep, 1, KEEP_MAX, DIGEST_DEFAULTS.digestKeep));
    const hours = Number(own.recapHours);
    return {
        full,
        keep,
        tail: typeof own.digestTail === 'boolean' ? own.digestTail : DIGEST_DEFAULTS.digestTail,
        // The time part's While away threshold (read through `settings.reads`): a jump this long is a skip.
        skipMinutes: (isInt(hours) && hours >= 1 ? hours : 6) * 60,
    };
}

// ---- which day each receipt belongs to --------------------------------------------------------

const receiptOf = entry => (isRecord(entry?.receipt) ? entry.receipt : isRecord(entry) && typeof entry.type === 'string' ? entry : null);
const clockSet = receipt => CLOCK_TYPES.has(receipt.type) && (receipt.module === undefined || receipt.module === 'story-director') && isInt(receipt.data?.minutes);

/**
 * The receipts (`[{ index, receipt }]` in chat order, as `tools.receipts()` gives them) by story
 * day (only those after revision `after` when given, with the clock at `minutes` before them): `{ days: Map(day → [receipt]), revs: Map(rev → day), settle: { from, to } | null }`.
 * `settle` is the last time settle's jump (the time part's receipt: the clock before and after it).
 */
export function walkDays(entries, { after = null, minutes: start = null } = {}) {
    const list = (Array.isArray(entries) ? entries : []).map(receiptOf).filter(Boolean)
        .filter(receipt => after === null || (isInt(receipt.rev) && receipt.rev > after));
    const days = new Map();
    const revs = new Map();
    let minutes = isInt(start) ? start : null;
    let waiting = [];
    let settle = null;
    const put = (day, receipt) => {
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(receipt);
        if (isInt(receipt.rev)) revs.set(receipt.rev, day);
    };
    for (const receipt of list) {
        if (clockSet(receipt)) {
            minutes = receipt.data.minutes;
            if (receipt.type === SETTLE) settle = { from: isInt(receipt.data.from) ? receipt.data.from : null, to: minutes };
        }
        if (minutes === null) {
            waiting.push(receipt);
            continue;
        }
        const day = dayOf(minutes);
        // What came before the clock was first set belongs to its first day.
        if (waiting.length) {
            for (const early of waiting) put(day, early);
            waiting = [];
        }
        put(day, receipt);
    }
    return { days, revs, settle, minutes };
}

// ---- facts out of one day's receipts ----------------------------------------------------------

const keyOf = name => flat(name).normalize('NFKC').toLowerCase();

function pushUnique(list, value, max, seen) {
    const item = cut(value, MAX_NAME);
    const key = keyOf(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (list.length < max) list.push(item);
}

// The money a receipt says moved for the party: { in, out } (whole numbers, smallest unit).
function moneyOf(receipt) {
    const data = isRecord(receipt.data) ? receipt.data : {};
    const amount = value => (isInt(value) && value > 0 ? value : 0);
    const out = { in: 0, out: 0 };
    // Story Block's wallet: the reader's or a module's top-level wallet commands, and the story's coin lines.
    if (data.owner === 'party' && isInt(data.amount)) {
        if (receipt.type === 'wallet.receive') out.in += amount(data.amount);
        else if (receipt.type === 'wallet.pay') out.out += amount(data.amount);
        else if (receipt.type === 'capture.coin') {
            const said = text(receipt.summary);
            if (/ receives /.test(said)) out.in += amount(data.amount);
            else if (/ pays /.test(said)) out.out += amount(data.amount);
        }
    }
    // A quest turned in (the quests part's own receipt, or the tracker's story turn-in carrying it).
    out.in += amount(data.paid?.amount);
    // A Director line that also paid turn-ins its reply left waiting carries each under `settled`.
    if (Array.isArray(data.settled)) for (const item of data.settled) out.in += amount(item?.turnIn?.paid?.amount);
    else out.in += amount(data.turnIn?.paid?.amount);
    // RPG Battle: a fight's loot, a sale, a purchase, a commission's fee.
    if (receipt.module === 'rpg-battle') {
        out.in += amount(data.loot?.money);
        if (data.kind === 'sell') out.in += amount(data.total);
        else if (data.kind === 'buy') out.out += amount(data.total);
        else if (data.kind === 'commission') out.out += amount(data.fee);
    }
    return out;
}

// A fight that ended (RPG Battle): 'won' | 'lost' | 'fled', or null.
function fightOf(receipt) {
    const data = receipt.data;
    if (receipt.module !== 'rpg-battle' || !isRecord(data) || typeof data.session !== 'string') return null;
    return ['won', 'lost', 'fled'].includes(data.outcome) ? data.outcome : null;
}

// One entry's lists at most (an entry is one reply's part of a day, see entryOf).
const ENTRY_HAPPENED = MAX_HAPPENED;

/**
 * What a run of receipts (one reply's, on one day) holds, as a day-facts entry is kept
 * (`chronicle.dayFacts`): `{ day, count, happened: [{ text, told }], more, places, fights, money,
 * npcs: [{ name, meter, from, to }], world: [{ id, text }], revs: [first, last] }`. Quests are not in
 * it: they are read from the threads' own stamps when the day is written.
 */
export function entryOf(receipts, day = null) {
    const candidates = [];
    const seenHappened = new Set();
    const places = [];
    const seenPlaces = new Set();
    const fights = { count: 0, won: 0, lost: 0, fled: 0 };
    const money = { in: 0, out: 0 };
    const npcMoves = new Map();
    const world = new Map();
    const met = [];
    const seenMet = new Set();
    const revs = [];
    let count = 0;
    for (const receipt of receipts) {
        if (isInt(receipt.rev)) revs.push(receipt.rev);
        // Bookkeeping and the clock's own receipts are no fact of the day (a day only slept through has none).
        if (quiet(receipt) || clockSet(receipt) || PLANNED_TYPES.has(receipt.type)) continue;
        count += 1;
        const data = isRecord(receipt.data) ? receipt.data : {};
        const said = cut(receipt.summary, MAX_ITEM);
        if (said && !TOLD_ELSEWHERE.has(receipt.type) && !ECHO.test(said) && !seenHappened.has(said)) {
            seenHappened.add(said);
            candidates.push({ text: said, told: receipt.narrate === true, at: candidates.length });
        }
        if (receipt.type === 'capture.place' && data.moved === true) pushUnique(places, data.name, MAX_PLACES, seenPlaces);
        // Story Block's scene: who came into the scene (`+ present`, the reader's scene.present).
        if (PRESENT_TYPES.has(receipt.type) && Array.isArray(data.added)) for (const name of data.added) pushUnique(met, name, MAX_MET, seenMet);
        const fight = fightOf(receipt);
        if (fight) {
            fights.count += 1;
            fights[fight] += 1;
        }
        const moved = moneyOf(receipt);
        money.in += moved.in;
        money.out += moved.out;
        // NPC State Delta: a meter crossed a stage (its receipt's data, code-made).
        if (typeof data.name === 'string' && Array.isArray(data.stages)) {
            for (const move of data.stages) {
                if (!isRecord(move) || typeof move.meter !== 'string') continue;
                const key = `${keyOf(data.name)}\u0000${move.meter}`;
                const before = npcMoves.get(key);
                npcMoves.set(key, { name: cut(data.name, MAX_NAME), meter: cut(move.meter, MAX_NAME), from: before ? before.from : textOrNull(move.from), to: textOrNull(move.to) });
            }
        }
        // The chronicle's own world lines: the last summary of each event that day.
        if (receipt.type === 'capture.world' && said && (receipt.module === undefined || receipt.module === 'story-director')) {
            const id = cut(typeof data.event === 'string' ? data.event : said, MAX_NAME);
            world.delete(id);
            world.set(id, said);
        }
    }
    const kept = pickHappened(candidates);
    return {
        day,
        count,
        happened: kept.map(({ text: said, told }) => ({ text: said, told })),
        more: candidates.length - kept.length,
        places,
        fights,
        money,
        npcs: [...npcMoves.values()].slice(0, MAX_NPCS * 2),
        world: [...world].slice(-MAX_WORLD).map(([id, said]) => ({ id, text: said })),
        revs: revs.length ? [Math.min(...revs), Math.max(...revs)] : [],
        ...(met.length ? { met } : {}),
    };
}

const textOrNull = value => (typeof value === 'string' && value ? cut(value, MAX_NAME) : null);

// At most MAX_HAPPENED, those the story was told first, in the order they came.
function pickHappened(candidates) {
    return [...candidates].sort((a, b) => Number(b.told) - Number(a.told) || a.at - b.at).slice(0, ENTRY_HAPPENED).sort((a, b) => a.at - b.at);
}

/** Entries of one day merged into one (in their order): what a fold keeps (see digest.js). */
export function foldEntries(entries, day) {
    const out = { day, count: 0, happened: [], more: 0, places: [], fights: { count: 0, won: 0, lost: 0, fled: 0 }, money: { in: 0, out: 0 }, npcs: [], world: [], revs: [] };
    const candidates = [];
    const seenHappened = new Set();
    const seenPlaces = new Set();
    const npcMoves = new Map();
    const world = new Map();
    const met = [];
    const seenMet = new Set();
    const revs = [];
    for (const entry of entries) {
        out.count += entry.count;
        out.more += entry.more;
        for (const item of entry.happened) {
            if (seenHappened.has(item.text)) continue;
            seenHappened.add(item.text);
            candidates.push({ text: item.text, told: item.told, at: candidates.length });
        }
        for (const place of entry.places) pushUnique(out.places, place, MAX_PLACES, seenPlaces);
        for (const name of ['count', 'won', 'lost', 'fled']) out.fights[name] += entry.fights[name];
        out.money.in += entry.money.in;
        out.money.out += entry.money.out;
        for (const move of entry.npcs) {
            const key = `${keyOf(move.name)}\u0000${move.meter}`;
            const before = npcMoves.get(key);
            npcMoves.set(key, { ...move, from: before ? before.from : move.from });
        }
        for (const item of entry.world) {
            world.delete(item.id);
            world.set(item.id, item.text);
        }
        for (const name of Array.isArray(entry.met) ? entry.met : []) pushUnique(met, name, MAX_MET, seenMet);
        revs.push(...entry.revs);
    }
    const kept = pickHappened(candidates);
    out.happened = kept.map(({ text: said, told }) => ({ text: said, told }));
    out.more += candidates.length - kept.length;
    out.npcs = [...npcMoves.values()].slice(0, MAX_NPCS * 2);
    out.world = [...world].slice(-MAX_WORLD).map(([id, said]) => ({ id, text: said }));
    out.revs = revs.length ? [Math.min(...revs), Math.max(...revs)] : [];
    if (met.length) out.met = met;
    return out;
}

/**
 * A day's facts out of its entries (entryOf, in order) and the state now (the threads' `taken` and
 * `ended` stamps; `dayOfRev(rev)` → the day a receipt revision belongs to, or null):
 * `{ count, happened, more, places, quests, fights, money, npcs, world }`.
 */
export function factsOf(entries, { state = null, day = null, dayOfRev = () => null } = {}) {
    const merged = foldEntries(entries, day);
    const npcs = merged.npcs.filter(move => move.from !== move.to).slice(0, MAX_NPCS)
        .map(move => cut(`${flat(move.name)}: ${move.meter} ${move.from ? `${flat(move.from)} → ` : '→ '}${move.to ? flat(move.to) : 'none'}`, MAX_ITEM));
    return {
        count: merged.count,
        happened: merged.happened.map(item => item.text),
        more: merged.more,
        places: merged.places,
        quests: questsOf(state, { dayOfRev, day }),
        fights: merged.fights,
        money: merged.money,
        npcs,
        world: merged.world.map(item => item.text),
        revs: merged.revs,
        ...(merged.met?.length ? { met: [...merged.met] } : {}),
    };
}

/**
 * The facts of `day` from its receipts (in order), the day of every receipt revision (`revDay`, from
 * walkDays) and the state now: what factsOf gives for one entry of those receipts.
 */
export function dayFacts(receipts, { revDay = new Map(), state = null, day = null } = {}) {
    return factsOf([entryOf(receipts, day)], { state, day, dayOfRev: rev => (revDay.has(rev) ? revDay.get(rev) : null) });
}

// The quests taken on and ended on that day, by the stamps the threads keep: the day of the receipt
// whose revision a stamp names, else the day of its story minutes.
function questsOf(state, { dayOfRev, day }) {
    const out = { taken: [], done: [], failed: [], dropped: [] };
    const seen = { taken: new Set(), done: new Set(), failed: new Set(), dropped: new Set() };
    const threads = Object.values(isRecord(state?.domains?.director?.threads) ? state.domains.director.threads : {})
        .filter(isRecord)
        .sort((a, b) => (a.track?.order ?? 0) - (b.track?.order ?? 0) || (String(a.id) < String(b.id) ? -1 : 1));
    const onDay = stamp => {
        if (!isRecord(stamp) || day === null) return false;
        const known = isInt(stamp.rev) ? dayOfRev(stamp.rev) : null;
        if (known !== null && known !== undefined) return known === day;
        return isInt(stamp.at) && dayOf(stamp.at) === day;
    };
    for (const thread of threads) {
        const quest = thread.kind === 'quest' || Boolean(thread.taken);
        if (!quest) continue;
        if (thread.taken && onDay(thread.taken)) pushUnique(out.taken, thread.key, MAX_QUESTS, seen.taken);
        if (thread.status !== 'active' && thread.ended && onDay(thread.ended)) {
            const outcome = thread.ended.outcome;
            if (outcome === 'done') pushUnique(out.done, thread.key, MAX_QUESTS, seen.done);
            else if (outcome === 'failed') pushUnique(out.failed, thread.key, MAX_QUESTS, seen.failed);
            // A declined offer or a superseded thread was never on the party's hands.
            else if (outcome === 'abandoned' || (thread.taken && outcome !== 'declined' && outcome !== 'superseded')) pushUnique(out.dropped, thread.key, MAX_QUESTS, seen.dropped);
        }
    }
    return out;
}

/** Whether facts hold anything at all. */
export const hasFacts = facts => Boolean(facts && facts.count > 0);

// ---- the one line -----------------------------------------------------------------------------

const unitOf = (amount, currency) => {
    const name = flat(currency?.name) || 'coin';
    const plural = flat(currency?.plural) || `${name}s`;
    return `${amount} ${amount === 1 ? name : plural}`;
};
const listed = (items, max = 3) => (items.length > max ? `${items.slice(0, max).join(', ')} and ${items.length - max} more` : items.join(', '));

/** The money of a day as words: "150 marks in, 20 out" ('' when nothing moved). */
export function moneyText(money, currency) {
    const income = isInt(money?.in) ? money.in : 0;
    const spent = isInt(money?.out) ? money.out : 0;
    if (!income && !spent) return '';
    if (income && spent) return `${unitOf(income, currency)} in, ${spent} out`;
    return income ? `${unitOf(income, currency)} in` : `${unitOf(spent, currency)} out`;
}

/** The fights of a day as words: "2 fights (1 won, 1 fled)" ('' when there were none). */
export function fightText(fights) {
    if (!isInt(fights?.count) || fights.count <= 0) return '';
    const parts = ['won', 'lost', 'fled'].filter(word => fights[word] > 0).map(word => `${fights[word]} ${word}`);
    return `${fights.count} ${fights.count === 1 ? 'fight' : 'fights'}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

/**
 * The day's one line: its date and the facts in a fixed order, at most 200 code points.
 * "June 3, 1200: to Harrow, Old Weir; took on Rat Cellar; finished Lost Ring; 2 fights (2 won); 150 marks in, 20 out; 1 NPC stage moved; 1 world event."
 */
export function dayLine(date, facts, { currency = null } = {}) {
    const parts = [];
    if (facts.places.length) parts.push(`to ${listed(facts.places)}`);
    if (facts.quests.taken.length) parts.push(`took on ${listed(facts.quests.taken)}`);
    if (facts.quests.done.length) parts.push(`finished ${listed(facts.quests.done)}`);
    if (facts.quests.failed.length) parts.push(`failed ${listed(facts.quests.failed)}`);
    if (facts.quests.dropped.length) parts.push(`gave up ${listed(facts.quests.dropped)}`);
    const fought = fightText(facts.fights);
    if (fought) parts.push(fought);
    const paid = moneyText(facts.money, currency);
    if (paid) parts.push(paid);
    if (facts.npcs.length) parts.push(`${facts.npcs.length} NPC ${facts.npcs.length === 1 ? 'stage' : 'stages'} moved`);
    if (facts.world.length) parts.push(`${facts.world.length} world ${facts.world.length === 1 ? 'event' : 'events'}`);
    if (!parts.length) parts.push(facts.happened[0] ? facts.happened[0].replace(/[.!?…]+$/, '') : `${facts.count} ${facts.count === 1 ? 'change' : 'changes'} kept`);
    return cut(`${flat(date) || 'A day'}: ${parts.join('; ')}.`, MAX_LINE);
}

/**
 * The digest kept for a day (full), from its facts. `made`: the receipt revision writing it; `src`:
 * the revisions of the day-facts entries it was made from (it follows them, daysOf), none when it was
 * read from the receipts.
 */
export function makeDigest(day, facts, { date = '', currency = null, made = 0, revs = [], src = null } = {}) {
    const sorted = [...revs].filter(isInt).sort((a, b) => a - b);
    const sources = Array.isArray(src) ? [...new Set(src.filter(isInt))].sort((a, b) => a - b) : [];
    return {
        day,
        date: cut(date, MAX_DATE),
        line: dayLine(date, facts, { currency }),
        brief: false,
        count: facts.count,
        happened: [...facts.happened],
        more: facts.more,
        places: [...facts.places],
        quests: { taken: [...facts.quests.taken], done: [...facts.quests.done], failed: [...facts.quests.failed], dropped: [...facts.quests.dropped] },
        fights: { ...facts.fights },
        money: { ...facts.money },
        npcs: [...facts.npcs],
        world: [...facts.world],
        ...(Array.isArray(facts.met) && facts.met.length ? { met: facts.met.slice(0, MAX_MET) } : {}),
        revs: sorted.length ? [sorted[0], sorted.at(-1)] : [],
        made,
        ...(sources.length ? { src: sources } : {}),
    };
}

/** An older day kept short: its date, its line and how many things it held. */
export function briefOf(digest) {
    return { day: digest.day, date: digest.date, line: digest.line, brief: true, count: digest.count, made: digest.made };
}

/**
 * The caps on `days` (a `{ [day]: Digest }` map): the newest `full` days stay whole, older ones are
 * kept short, and beyond `keep` the oldest go. → `{ [day]: Digest | null }`: what changes (null: drop).
 */
export function capDays(days, { full, keep }) {
    const order = Object.values(days).sort((a, b) => b.day - a.day);
    const changes = {};
    order.forEach((digest, index) => {
        if (index >= keep) changes[digest.day] = null;
        else if (index >= full && !digest.brief) changes[digest.day] = briefOf(digest);
    });
    return changes;
}

// ---- the validator ----------------------------------------------------------------------------

const KEYS_FULL = ['day', 'date', 'line', 'brief', 'count', 'happened', 'more', 'places', 'quests', 'fights', 'money', 'npcs', 'world', 'met', 'revs', 'made', 'src'];
const KEYS_BRIEF = ['day', 'date', 'line', 'brief', 'count', 'made'];
const textOk = (value, max) => typeof value === 'string' && codePoints(value) <= max;
const textsOk = (list, max, each) => Array.isArray(list) && list.length <= max && list.every(item => textOk(item, each));
const countOk = value => isInt(value) && value >= 0;

function digestErrors(key, stored) {
    const at = `chronicle.days.${key}`;
    if (!Array.isArray(stored) || stored.length !== 1 || !isRecord(stored[0])) return [`${at} must hold one day digest.`];
    const digest = stored[0];
    const errors = [];
    if (!isInt(digest.day) || String(digest.day) !== key) errors.push(`${at} is kept under another day.`);
    if (!textOk(digest.date, MAX_DATE)) errors.push(`${at}.date must be text of at most ${MAX_DATE} characters.`);
    if (!textOk(digest.line, MAX_LINE)) errors.push(`${at}.line must be text of at most ${MAX_LINE} characters.`);
    if (typeof digest.brief !== 'boolean') errors.push(`${at}.brief must be true or false.`);
    if (!countOk(digest.count)) errors.push(`${at}.count must be a whole number.`);
    if (!countOk(digest.made)) errors.push(`${at}.made must be a revision.`);
    const keys = digest.brief === true ? KEYS_BRIEF : KEYS_FULL;
    for (const field of Object.keys(digest)) if (!keys.includes(field)) errors.push(`${at} has an unknown field "${field}".`);
    if (digest.brief !== false) return errors;
    if (!textsOk(digest.happened, MAX_HAPPENED, MAX_ITEM)) errors.push(`${at}.happened must be at most ${MAX_HAPPENED} lines.`);
    if (!countOk(digest.more)) errors.push(`${at}.more must be a whole number.`);
    if (!textsOk(digest.places, MAX_PLACES, MAX_NAME)) errors.push(`${at}.places must be at most ${MAX_PLACES} names.`);
    const quests = digest.quests;
    if (!isRecord(quests) || Object.keys(quests).some(name => !['taken', 'done', 'failed', 'dropped'].includes(name))
        || !['taken', 'done', 'failed', 'dropped'].every(name => textsOk(quests[name], MAX_QUESTS, MAX_NAME))) errors.push(`${at}.quests must be lists of at most ${MAX_QUESTS} names.`);
    const fights = digest.fights;
    if (!isRecord(fights) || Object.keys(fights).length !== 4 || !['count', 'won', 'lost', 'fled'].every(name => countOk(fights[name]))) errors.push(`${at}.fights must be whole numbers.`);
    const money = digest.money;
    if (!isRecord(money) || Object.keys(money).length !== 2 || !countOk(money.in) || !countOk(money.out)) errors.push(`${at}.money must be { in, out } in whole numbers.`);
    if (!textsOk(digest.npcs, MAX_NPCS, MAX_ITEM)) errors.push(`${at}.npcs must be at most ${MAX_NPCS} lines.`);
    if (!textsOk(digest.world, MAX_WORLD, MAX_ITEM)) errors.push(`${at}.world must be at most ${MAX_WORLD} lines.`);
    if (digest.met !== undefined && !textsOk(digest.met, MAX_MET, MAX_NAME)) errors.push(`${at}.met must be at most ${MAX_MET} names.`);
    if (!Array.isArray(digest.revs) || digest.revs.length > 2 || !digest.revs.every(countOk)) errors.push(`${at}.revs must be [first, last] revisions.`);
    if (digest.src !== undefined && (!Array.isArray(digest.src) || !digest.src.length || digest.src.length > FOLD_AT * 2 || !digest.src.every(countOk))) errors.push(`${at}.src must be the revisions of its day's entries.`);
    return errors;
}

// ---- the day facts kept as replies go (chronicle.dayFacts, chronicle.noted) ----------------------
//
// Story Block keeps a receipt's `data` only for the last couple of hundred replies (its storage trim),
// so a long day cannot be read back from the receipts when it ends (RX-TL-3). Instead, before each
// reply, `chronicle.note` reads the receipts committed since the last note (fresh, whole) and keeps
// what they hold for the day digest as small entries under `chronicle.dayFacts["<day>.<rev>"]` (`rev`
// is the note's own receipt revision): added whole, never changed, on the reply the note is a receipt
// of, so deleting or swiping that reply takes exactly its facts away. When a day's digest is written
// from them, its entries stay while the digest is whole (the newest FOLLOW_MAX of them, newest days
// first): the digest follows them (daysOf), so a reply of that day deleted later takes its facts out
// of the digest and its time-skip line. They are removed by key when the day goes short or past
// FOLLOW_MAX (its digest then stays as it was, `src` cleared), and at once for a day not written from
// them. `chronicle.noted = [{ rev, minutes, from, settle, gap? }]` is where the
// notes got to: the revision and the clock after the last one, the day notes began (`from`), the
// time part's last settle jump seen (`settle`), and, while the digest feature is off, where the day
// facts stopped (`gap: { rev, minutes }`): the first note with the feature back on reads the receipts
// from there, so the days that ended while it was off are written too (B-c2-3).

// The quest history (quest.details, F84) is read from receipts too: `chronicle.questLog["<rev>"] =
// { thread, text }` keeps, per receipt revision, the summary of each receipt that touched a quest or
// thread, written by the note on the reply it belongs to; the newest QUEST_LOG_KEPT per thread stay.
export const QUEST_LOG_KEPT = 8;
const QUEST_LOG_CEILING = 3000;
export const QUEST_LOG_TEXT = 200;
const THREAD_REF = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A thread's kept history, oldest first: `[{ rev, text }]` (the last QUEST_LOG_KEPT). */
export function questLogOf(chronicle, id) {
    if (typeof id !== 'string' || !id) return [];
    return Object.entries(isRecord(chronicle?.questLog) ? chronicle.questLog : {})
        .filter(([key, entry]) => /^\d+$/.test(key) && isRecord(entry) && entry.thread === id)
        .map(([key, entry]) => ({ rev: Number(key), text: entry.text }))
        .sort((a, b) => a.rev - b.rev)
        .slice(-QUEST_LOG_KEPT);
}

/** Entries a day may keep before a note folds them into its own one (a very long day). */
export const FOLD_AT = 200;
/** Entries the written days keep in all, so their digests follow them (newest days first, each day whole). */
export const FOLLOW_MAX = 800;
const ENTRY_CEILING = 4000;
const ENTRY_KEY = /^(-?\d{1,15})\.(\d{1,15})$/;

/** `chronicle.noted` (where the notes got to), or null. */
export const notedOf = chronicle => slotValue(chronicle?.noted);

/** The day-facts entries kept, by day: `Map(day → [{ key, entry }])`, each day's in revision order. */
export function entriesByDay(chronicle) {
    const out = new Map();
    for (const [key, entry] of Object.entries(isRecord(chronicle?.dayFacts) ? chronicle.dayFacts : {})) {
        const match = ENTRY_KEY.exec(key);
        if (!match || !isRecord(entry) || entry.day !== Number(match[1])) continue;
        if (!out.has(entry.day)) out.set(entry.day, []);
        out.get(entry.day).push({ key, rev: Number(match[2]), entry });
    }
    for (const list of out.values()) list.sort((a, b) => a.rev - b.rev);
    return out;
}

/** `dayOfRev(rev)`: the day whose entries' revision ranges hold `rev`, else null. */
export function rangeDays(byDay) {
    const ranges = [];
    for (const [day, list] of byDay) for (const { entry } of list) if (entry.revs.length === 2) ranges.push([entry.revs[0], entry.revs[1], day]);
    return rev => ranges.find(([lo, hi]) => rev >= lo && rev <= hi)?.[2] ?? null;
}

function entryErrors(key, entry) {
    const at = `chronicle.dayFacts.${key}`;
    const match = ENTRY_KEY.exec(key);
    if (!match) return [`chronicle.dayFacts["${key}"] is not "<day>.<rev>".`];
    if (!isRecord(entry) || entry.day !== Number(match[1])) return [`${at} is not a day's facts.`];
    const errors = [];
    if (!countOk(entry.count) || !countOk(entry.more)) errors.push(`${at}.count and .more must be whole numbers.`);
    if (!Array.isArray(entry.happened) || entry.happened.length > ENTRY_HAPPENED
        || !entry.happened.every(item => isRecord(item) && textOk(item.text, MAX_ITEM) && typeof item.told === 'boolean')) errors.push(`${at}.happened must be at most ${ENTRY_HAPPENED} { text, told }.`);
    if (!textsOk(entry.places, MAX_PLACES, MAX_NAME)) errors.push(`${at}.places must be at most ${MAX_PLACES} names.`);
    const fights = entry.fights;
    if (!isRecord(fights) || !['count', 'won', 'lost', 'fled'].every(name => countOk(fights[name]))) errors.push(`${at}.fights must be whole numbers.`);
    if (!isRecord(entry.money) || !countOk(entry.money.in) || !countOk(entry.money.out)) errors.push(`${at}.money must be { in, out } in whole numbers.`);
    const nameOrNull = value => value === null || textOk(value, MAX_NAME);
    if (!Array.isArray(entry.npcs) || entry.npcs.length > MAX_NPCS * 2
        || !entry.npcs.every(move => isRecord(move) && textOk(move.name, MAX_NAME) && textOk(move.meter, MAX_NAME) && nameOrNull(move.from) && nameOrNull(move.to))) errors.push(`${at}.npcs must be stage moves.`);
    if (!Array.isArray(entry.world) || entry.world.length > MAX_WORLD
        || !entry.world.every(item => isRecord(item) && textOk(item.id, MAX_NAME) && textOk(item.text, MAX_ITEM))) errors.push(`${at}.world must be at most ${MAX_WORLD} { id, text }.`);
    if (!Array.isArray(entry.revs) || ![0, 2].includes(entry.revs.length) || !entry.revs.every(countOk)) errors.push(`${at}.revs must be [first, last] revisions.`);
    if (entry.met !== undefined && !textsOk(entry.met, MAX_MET, MAX_NAME)) errors.push(`${at}.met must be at most ${MAX_MET} names.`);
    for (const field of Object.keys(entry)) {
        if (!['day', 'count', 'happened', 'more', 'places', 'fights', 'money', 'npcs', 'world', 'met', 'revs'].includes(field)) errors.push(`${at} has an unknown field "${field}".`);
    }
    return errors;
}

/** The validator's part for `days` and `written` (both optional: a chronicle from before digests has neither). */
export function validateDays(slice) {
    const errors = [];
    if (slice.dayFacts !== undefined) {
        if (!isRecord(slice.dayFacts)) errors.push('chronicle.dayFacts is not an object.');
        else {
            const entries = Object.entries(slice.dayFacts);
            for (const [key, entry] of entries) errors.push(...entryErrors(key, entry));
            if (entries.length > ENTRY_CEILING) errors.push(`The chronicle keeps at most ${ENTRY_CEILING} day-facts entries.`);
        }
    }
    if (slice.questLog !== undefined) {
        if (!isRecord(slice.questLog)) errors.push('chronicle.questLog is not an object.');
        else {
            const entries = Object.entries(slice.questLog);
            if (entries.some(([key, entry]) => !/^\d{1,15}$/.test(key) || !isRecord(entry) || !THREAD_REF.test(entry.thread ?? '') || !textOk(entry.text, QUEST_LOG_TEXT)
                || Object.keys(entry).some(field => field !== 'thread' && field !== 'text'))) errors.push('chronicle.questLog entries must be { thread, text } under a revision.');
            if (entries.length > QUEST_LOG_CEILING) errors.push(`The chronicle keeps at most ${QUEST_LOG_CEILING} quest history lines.`);
        }
    }
    if (slice.noted !== undefined && slice.noted !== null) {
        const noted = slotValue(slice.noted);
        const settleOk = value => value === null || (isRecord(value) && (value.from === null || isInt(value.from)) && isInt(value.to));
        const gapOk = value => value === undefined || (isRecord(value) && (value.rev === null || countOk(value.rev))
            && (value.minutes === null || isInt(value.minutes)) && Object.keys(value).every(key => key === 'rev' || key === 'minutes'));
        if (!noted || !Array.isArray(slice.noted) || slice.noted.length !== 1 || !countOk(noted.rev)
            || !(noted.minutes === null || isInt(noted.minutes)) || !(noted.from === null || isInt(noted.from)) || !settleOk(noted.settle)
            || !gapOk(noted.gap) || Object.keys(noted).some(key => !['rev', 'minutes', 'from', 'settle', 'gap'].includes(key))) {
            errors.push('chronicle.noted must be null or { rev, minutes, from, settle, gap? }.');
        }
    }
    if (slice.days !== undefined) {
        if (!isRecord(slice.days)) errors.push('chronicle.days is not an object.');
        else {
            const entries = Object.entries(slice.days);
            for (const [key, stored] of entries) {
                if (!/^-?\d{1,15}$/.test(key)) errors.push(`chronicle.days["${key}"] is not a day.`);
                else errors.push(...digestErrors(key, stored));
            }
            if (entries.length > KEEP_CEILING) errors.push(`The chronicle keeps at most ${KEEP_CEILING} days.`);
            if (entries.filter(([, stored]) => slotValue(stored)?.brief === false).length > FULL_CEILING) errors.push(`The chronicle keeps at most ${FULL_CEILING} whole days.`);
        }
    }
    if (slice.written !== undefined && slice.written !== null) {
        const written = slotValue(slice.written);
        if (!written || !Array.isArray(slice.written) || slice.written.length !== 1 || !isInt(written.through)
            || !Array.isArray(written.days) || written.days.length > KEEP_CEILING || !written.days.every(isInt)
            || !(written.at === null || countOk(written.at)) || typeof written.skip !== 'boolean'
            || Object.keys(written).some(key => !['through', 'days', 'at', 'skip'].includes(key))) {
            errors.push('chronicle.written must be null or { through, days, at, skip }.');
        }
    }
    return errors;
}

// ---- what the queries give ---------------------------------------------------------------------

/** A digest as the queries give it: a plain copy, with the money in words. */
export function digestOut(digest, { currency = null, substitute = value => value } = {}) {
    const sub = value => flat(substitute(value));
    const base = { day: digest.day, date: digest.date, line: sub(digest.line), brief: digest.brief, count: digest.count, made: digest.made };
    if (digest.brief) {
        return {
            ...base, happened: [], more: 0, places: [], quests: { taken: [], done: [], failed: [], dropped: [] },
            fights: { count: 0, won: 0, lost: 0, fled: 0 }, money: { in: 0, out: 0 }, npcs: [], world: [], met: [], revs: [],
            moneyText: '', fightText: '',
        };
    }
    return {
        ...base,
        happened: digest.happened.map(sub),
        more: digest.more,
        places: [...digest.places],
        quests: { taken: [...digest.quests.taken], done: [...digest.quests.done], failed: [...digest.quests.failed], dropped: [...digest.quests.dropped] },
        fights: { ...digest.fights },
        money: { ...digest.money },
        npcs: [...digest.npcs],
        world: digest.world.map(sub),
        met: Array.isArray(digest.met) ? [...digest.met] : [],
        revs: [...digest.revs],
        moneyText: moneyText(digest.money, currency),
        fightText: fightText(digest.fights),
    };
}
