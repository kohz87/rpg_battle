// RPG Battle v2, items part: gear condition and refinement (MODULES §F101, TRS ideas 1, 2 and 9).
// Pure: the numbers, the bands and how a piece's record is kept and read.
//
// **Condition.** An equipment stack has a condition from 0 to its maximum (100 when new). Its band
// says how much of its stats it gives: good (75 and up) all of them, worn (40 and up) 85%,
// tattered (10 and up) 60%, broken (under 10) nothing; a broken piece stays equipped. Only code
// events wear it: a fight (each armour piece by the share of its wearer's HP the blows took, each
// weapon once a fight) and the story's word (`~ item Coat — torn by brambles | wear: scuff|tear|ruin`,
// the word picks code's number). A field patch (a repair kit) gives condition back but takes a little
// off the maximum each time; a smith's or tailor's repair puts both back to full.
//
// **Refinement.** A piece refined at a smith is +1 to +3: each level gives +8% on its stats, and it
// shows in the piece's name ("Iron Sword +2"). Its rarity stays what it is. A piece that breaks may
// lose a level.
//
// **Resale.** A piece sells for its sale price × the condition it has kept since its last proper
// repair (`low`: the lowest it has been; a field patch does not raise it) × its refinement, and never
// for more than it would have fetched at the worst it ever was (`ever`, which no repair raises) plus
// the repair fees paid for it (`paid`). trade.paid still holds every sale under what was paid for the
// thing: repairing never mints money; a refinement costs at least what it adds anywhere.
//
// **Where it is kept** (SPEC §2.2): RPG Battle's own `gear` domain is the one source of truth for a
// piece's condition and refinement (Story Block's own `stack.cond` is for a chat without RPG Battle;
// it is neither written nor read here). Each thing a reply does to a piece is an event of its own,
// added under its own key `<stack>#<rev>` (the receipt's rev): `{ wear }`, `{ patch, fray }`,
// `{ repair: true }`, `{ refine }`, `{ lost }` (a level a break cost). A piece's condition, maximum,
// lowest point and refinement are worked out by folding its events in order (foldPiece), never
// stored. A reply deleted from the middle of a chat takes exactly its own events with it, so what it
// paid for and what it did roll back together, and every later event still applies. Past MAX_EVENTS
// the oldest go.

export const WEAR_FEATURE = 'rpg-battle.wear';
export const REFINE_FEATURE = 'rpg-battle.refine';

/** What a refusal says while a feature is off: it is the reader's choice for every chat, in the Features settings. */
export const WEAR_OFF = 'Gear wear and repair is turned off in the Features settings';
export const REFINE_OFF = 'Gear refinement is turned off in the Features settings';

export const FULL = 100;
/** The bands, best first: from this condition up, the share of the stats a piece gives. */
export const BANDS = Object.freeze([
    Object.freeze({ band: 'good', from: 75, factor: 1 }),
    Object.freeze({ band: 'worn', from: 40, factor: 0.85 }),
    Object.freeze({ band: 'tattered', from: 10, factor: 0.6 }),
    Object.freeze({ band: 'broken', from: 0, factor: 0 }),
]);
export const MAX_REFINE = 3;
/** Each refinement level: this much more of every stat. */
export const REFINE_STEP = 0.08;

/** The story's wear words and code's number for each (TRS idea 1: the word, never a number). */
export const STORY_WEAR = Object.freeze({ scuff: 5, tear: 15, ruin: 40 });
// Other words a story may write for the same three.
const WEAR_WORDS = Object.freeze({
    scuff: 'scuff', scuffed: 'scuff', scratch: 'scuff', scratched: 'scuff', nick: 'scuff', nicked: 'scuff', dent: 'scuff', dented: 'scuff',
    tear: 'tear', torn: 'tear', tore: 'tear', rip: 'tear', ripped: 'tear', cut: 'tear', gash: 'tear', crack: 'tear', cracked: 'tear', burn: 'tear', burned: 'tear', burnt: 'tear',
    ruin: 'ruin', ruined: 'ruin', wreck: 'ruin', wrecked: 'ruin', smash: 'ruin', smashed: 'ruin', shatter: 'ruin', shattered: 'ruin', destroy: 'ruin', destroyed: 'ruin',
});
/** A weapon's wear for each fight it is wielded in. */
export const WEAPON_WEAR = 3;
/** Armour's wear when its wearer takes blows worth their whole HP in one fight (less in proportion), and the most a fight wears it. */
export const ARMOUR_WEAR = 20;
export const ARMOUR_WEAR_MAX = 25;
/** What a field patch takes off a piece's maximum, and the lowest maximum patches leave. */
export const PATCH_FRAY = 5;
export const MIN_MAX = 50;
/** Events kept at most (the oldest go first). */
export const MAX_EVENTS = 2000;
/** The largest repair fee an event keeps. */
export const MAX_FEE = 1e12;

const EVENT_KEY = /#(\d+)(?:\.(\d+))?$/;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clampInt = (value, lo, hi, fallback) => (Number.isFinite(Number(value)) ? Math.max(lo, Math.min(hi, Math.round(Number(value)))) : fallback);

/**
 * Whether a feature is on (MODULES §F100): `source.feature(id)` (a ctx or a view), else the host's
 * `sdk.feature(id)` (a query's tools carry none); on when neither is there (an older host), or when
 * it answers nothing.
 */
export function featureOn(source, id) {
    try {
        const own = source?.feature;
        if (typeof own === 'function') return own.call(source, id) !== false;
        const sdk = globalThis.StoryBlock?.sdk;
        if (typeof sdk?.feature === 'function') return sdk.feature(id) !== false;
        return true;
    } catch {
        return true;
    }
}

/** Both gear features for a ctx, view or tools: { wear, refine }. */
export const gearFeatures = source => ({ wear: featureOn(source, WEAR_FEATURE), refine: featureOn(source, REFINE_FEATURE) });

/** The band of a condition: 'good' | 'worn' | 'tattered' | 'broken'. */
export function bandOf(cond) {
    const n = Number.isFinite(Number(cond)) ? Number(cond) : FULL;
    return (BANDS.find(entry => n >= entry.from) ?? BANDS.at(-1)).band;
}

/** The share of its stats a piece in `band` gives. */
export const bandFactor = band => BANDS.find(entry => entry.band === band)?.factor ?? 1;

/** The stat multiplier of a refinement level (+8% each). */
export const refineFactor = level => 1 + REFINE_STEP * clampInt(level, 0, MAX_REFINE, 0);

/** A story's wear word as one of the three ('scuff' | 'tear' | 'ruin'), or null. */
export function wearWord(value) {
    const said = String(value ?? '').normalize('NFKC').toLowerCase().trim().split(/[^a-z]+/).filter(Boolean);
    for (const word of said) if (Object.hasOwn(WEAR_WORDS, word)) return WEAR_WORDS[word];
    return null;
}

/** The name a piece shows: "Iron Sword +2" (its def's name with its refinement). */
export function pieceName(name, refine = 0) {
    const base = String(name ?? '').replace(/\s*\+[1-9]$/, '').trim() || 'piece';
    const level = clampInt(refine, 0, MAX_REFINE, 0);
    return level ? `${base} +${level}` : base;
}

/** A written piece name without a refinement suffix: "Iron Sword +2" → "Iron Sword". */
export const bareName = name => String(name ?? '').replace(/\s*\+[1-9]\s*$/, '').trim();

// ---------------------------------------------------------------------------------------
// The events

/** What a key is about: the stack id of `<stack>#<rev>` (or `<stack>#<rev>.<n>`). */
export const pieceBase = key => String(key).replace(EVENT_KEY, '');
// Where an event sits in the chat's order: its rev, then its number within the receipt.
const orderOf = key => {
    const match = EVENT_KEY.exec(String(key));
    return match ? [Number(match[1]), Number(match[2] ?? 0)] : [0, 0];
};
const byOrder = (a, b) => {
    const [ra, na] = orderOf(a);
    const [rb, nb] = orderOf(b);
    return ra - rb || na - nb || (a < b ? -1 : a > b ? 1 : 0);
};

/** The keys of the events about `stack`, in the chat's order. */
export const eventsOf = (events, stack) => Object.keys(isObject(events) ? events : {}).filter(key => pieceBase(key) === stack).sort(byOrder);

/** A new piece: { cond, max, low, ever, paid, refine } (`ever`: the lowest it ever was; `paid`: repair fees). */
export const freshRecord = () => ({ cond: FULL, max: FULL, low: FULL, ever: FULL, paid: 0, refine: 0 });

/** One event applied to a record (a new record; out-of-range numbers clamped). */
export function applyEvent(record, event) {
    const out = { ...record };
    if (!isObject(event)) return out;
    if (event.repair === true) {
        Object.assign(out, { cond: FULL, max: FULL, low: FULL });
        out.paid = (out.paid ?? 0) + clampInt(event.fee, 0, MAX_FEE, 0);
    }
    const wear = clampInt(event.wear, 0, FULL, 0);
    if (wear) {
        out.cond = Math.max(0, out.cond - wear);
        out.low = Math.min(out.low, out.cond);
        out.ever = Math.min(out.ever ?? FULL, out.cond);
    }
    const patch = clampInt(event.patch, 0, FULL, 0);
    if (patch || event.fray !== undefined) {
        out.max = Math.max(MIN_MAX, out.max - clampInt(event.fray, 0, FULL, 0));
        out.cond = Math.min(out.max, out.cond + patch);
        out.low = Math.min(out.low, out.max);
    }
    out.cond = Math.min(out.cond, out.max);
    const step = clampInt(event.refine, -MAX_REFINE, MAX_REFINE, 0) - clampInt(event.lost, 0, MAX_REFINE, 0);
    out.refine = Math.max(0, Math.min(MAX_REFINE, out.refine + step));
    return out;
}

/** A piece's record folded from its events in order, or null when nothing ever happened to it. */
export function foldPiece(gear, stack) {
    const events = isObject(gear?.events) ? gear.events : {};
    const keys = eventsOf(events, stack);
    if (!keys.length) return null;
    return keys.reduce((record, key) => applyEvent(record, events[key]), freshRecord());
}

/**
 * A piece as it stands: { stack, cond, max, low, refine, band, factor, fresh } folded from its
 * events (fresh: nothing ever happened to it). `features` ({ wear, refine }) turn either off: then
 * its condition reads full (band good, factor 1) or its refinement 0. `inventory` is not read (kept
 * for the callers' shape).
 */
export function pieceOf(inventory, gear, stackId, features = { wear: true, refine: true }) {
    void inventory;
    const record = foldPiece(gear, stackId);
    const base = record ?? freshRecord();
    const out = { stack: stackId, cond: base.cond, max: base.max, low: Math.min(base.low, base.cond), ever: base.ever, paid: base.paid, refine: base.refine, fresh: !record };
    if (features?.wear === false) Object.assign(out, { cond: FULL, max: FULL, low: FULL, ever: FULL, paid: 0 });
    if (features?.refine === false) out.refine = 0;
    out.band = bandOf(out.cond);
    out.factor = bandFactor(out.band);
    return out;
}

const EVENT_FIELDS = ['wear', 'patch', 'fray', 'repair', 'fee', 'refine', 'lost'];

/** An event as kept: only its known fields, whole numbers in range. Null when it does nothing. */
export function cleanEvent(event) {
    const out = {};
    if (event?.repair === true) out.repair = true;
    for (const [field, lo, hi] of [['wear', 1, FULL], ['patch', 0, FULL], ['fray', 0, FULL], ['fee', 0, MAX_FEE], ['refine', -MAX_REFINE, MAX_REFINE], ['lost', 1, MAX_REFINE]]) {
        if (event?.[field] === undefined) continue;
        const raw = Number(event[field]);
        if (!Number.isFinite(raw)) continue;
        const n = Math.round(raw);
        // Wear and a lost level below 1 are nothing; the rest is held to its range.
        if ((field === 'wear' || field === 'lost') && n < 1) continue;
        out[field] = Math.max(lo, Math.min(hi, n));
    }
    if (out.refine === 0) delete out.refine;
    if (!out.repair) delete out.fee;
    return Object.keys(out).length ? out : null;
}

/**
 * Adds `event` about `stack` to the gear draft under a key of its own (`<stack>#<rev>`, or
 * `<stack>#<rev>.<n>` for a second one in one receipt). Past MAX_EVENTS the oldest go. → the key,
 * or null.
 */
export function addEvent(gear, stack, event, rev) {
    const clean = cleanEvent(event);
    if (!clean) return null;
    gear.events ??= {};
    const events = gear.events;
    const at = Number.isInteger(rev) && rev > 0 ? rev : 0;
    let key = `${stack}#${at}`;
    for (let n = 1; Object.hasOwn(events, key); n += 1) key = `${stack}#${at}.${n}`;
    events[key] = { stack, ...clean };
    const keys = Object.keys(events);
    if (keys.length > MAX_EVENTS) {
        for (const old of keys.filter(other => other !== key).sort(byOrder).slice(0, keys.length - MAX_EVENTS)) delete events[old];
    }
    return key;
}

/** The gear slice of a new chat. */
export const initialGear = () => ({ events: {} });

const KEY = /^[a-z]{2}_[0-9a-z_]{1,40}#\d+(?:\.\d+)?$/;

/** The gear slice's rules (SPEC §2.5). */
export function validateGear(slice) {
    if (!isObject(slice)) return ['gear: not a record'];
    if (!isObject(slice.events)) return ['gear.events: not a record'];
    const errors = [];
    const keys = Object.keys(slice.events);
    // 4× the number kept: a replay after a middle delete may bring back events a deleted reply removed.
    if (keys.length > MAX_EVENTS * 4) errors.push(`gear.events: at most about ${MAX_EVENTS}`);
    for (const key of keys) {
        const entry = slice.events[key];
        const at = `gear.events.${key}`;
        if (!KEY.test(key)) errors.push(`${at}: not a stack id and a rev`);
        if (!isObject(entry)) {
            errors.push(`${at}: not a record`);
            continue;
        }
        if (entry.stack !== pieceBase(key)) errors.push(`${at}.stack: does not match its key`);
        for (const field of Object.keys(entry)) if (field !== 'stack' && !EVENT_FIELDS.includes(field)) errors.push(`${at}.${field}: not a gear event field`);
        const clean = cleanEvent(entry);
        if (!clean) errors.push(`${at}: does nothing`);
        else for (const field of EVENT_FIELDS) if (entry[field] !== undefined && entry[field] !== clean[field]) errors.push(`${at}.${field}: out of range`);
    }
    return errors;
}

// ---------------------------------------------------------------------------------------
// Stats and prices

/**
 * What a piece's stats come to: `stats` (already capped at the wearer's level) × its band's share ×
 * its refinement (+8% a level), rounded once. A stat of 5 or more (after the band) gains at least +1
 * once refined at all; a smaller one only what the 8% rounds to. A stat below 0 stays as it is unless
 * the piece is broken. Zeros are dropped. (items.gear then holds a refined piece under the next
 * rarity's budget at the wearer's level.)
 */
export function scaleStats(stats, piece) {
    const share = piece?.factor ?? 1;
    const level = Math.max(0, Math.min(MAX_REFINE, Math.round(Number(piece?.refine) || 0)));
    const out = {};
    for (const [name, value] of Object.entries(stats ?? {})) {
        if (!Number.isFinite(value) || value === 0 || share === 0) continue;
        if (value < 0) {
            out[name] = value;
            continue;
        }
        const base = value * share;
        const refined = Math.round(base * refineFactor(level));
        const next = level && base >= 5 ? Math.max(refined, Math.round(base) + 1) : refined;
        if (next !== 0) out[name] = next;
    }
    return out;
}

/** The share of its sale price a piece fetches: condition kept since its last proper repair × refinement. */
export function resaleFactor(piece) {
    const kept = Math.max(0, Math.min(piece?.cond ?? FULL, piece?.low ?? FULL)) / FULL;
    return kept * refineFactor(piece?.refine ?? 0);
}

/**
 * What a piece fetches from a buyer who pays `each` for one as new: × resaleFactor, and never more
 * than it would fetch at the worst it ever was plus the repair fees paid for it (whole, at least 1).
 */
export function resaleOf(each, piece) {
    const ref = refineFactor(piece?.refine ?? 0);
    const now = Math.floor(each * resaleFactor(piece));
    const ever = Math.max(0, Math.min(piece?.ever ?? FULL, piece?.cond ?? FULL, piece?.low ?? FULL)) / FULL;
    const bound = Math.floor(each * ever * ref) + Math.max(0, Math.round(piece?.paid ?? 0));
    return Math.max(1, Math.min(now, bound));
}

/**
 * The most a buyer anywhere may pay for a thing, as a share of its worth (the rules' sell rate × the
 * best buyer's taste for gear × the best place's sell prices × the dearest price word). A repair or a
 * refinement costs at least this share of what it adds, so it can never be sold back for a profit.
 */
export function maxResaleShare(rules) {
    const t = rules?.trade ?? {};
    const sellRate = Number(t.sellRate) || 0.5;
    const pays = Math.max(1, ...Object.values(t.buyers ?? {}).map(buyer => Number(buyer?.equipment) || 0));
    const sell = Math.max(1, ...Object.values(t.areas ?? {}).map(area => Number(area?.sell) || 0));
    const level = Math.max(1, ...Object.values(t.levels ?? {}).map(Number).filter(Number.isFinite));
    return sellRate * pays * sell * level;
}
