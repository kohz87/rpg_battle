// Timed buffs and debuffs (feature `rpg-battle.effects`, default on): the `effects` domain, its
// commands, the `effect` change-line kind, and the pure rules that say whether an effect is still
// on and what it does. Owned by the party part.
//
// An effect is on one member (or on everyone: actor 'party') and has code's meaning only:
// * `checks`: ± on the checks it matches, in the F80 modifier table (checks/modifiers.js reads
//   them through `party.effects`): `on: 'all'`, a stat (a check answered by DEX), or a check topic
//   (perception, stealth, …: modifiers.js TOPICS);
// * `combat`: ± a share of fight numbers (attack, magic, defence, mdef, crit: COMBAT_STEP % a
//   band, all effects together at most COMBAT_CAP %), counted in `party.combatNumbers`, which the
//   fight reads; a share, so a band means the same at every level.
// The amounts are code's, from a word band (minor 1, moderate 2, major 3), never a number the
// story writes. The model is told only names and short notes (the party's tail); the numbers reach
// it as code's modifier table.
//
// What the story may write (rx-combat): one new effect a reply, always the weak size (band 1,
// whatever its words say: code picks the size), and one story effect on a check or a fight number
// at a time per member: a new one takes the place of the story effect that acts on the same thing.
// Effects from code (items, quests, gear, perks) keep their own sizes.
//
// How long it lasts: a timed effect ends at whichever comes first,
// * its `minutes` of story time passing, when there was a clock as it began (Story Director's
//   `director.time`, `ctx.time()`). No absolute end is stored (RX-TL-4): the time passed is summed
//   from the turns (each turn keeps the clock it saw and how far it moved forward since the turn
//   before, never backwards), so a deleted earlier time jump does not stretch an effect made after
//   it, and a clock set back counts as no time; and
// * its `replies` limit always holds too: replies are counted in **turns** (`effects.turns`), one
//   added before every new reply (party.effectsTurn, not for a swipe or a Continue), each keyed by
//   its receipt and numbered one past the highest, so a reply deleted from the middle never makes
//   later numbers smaller (an effect never lasts longer for it); the effect remembers the turn it
//   began on;
// * while its source lasts: a worn piece (`source: { kind: 'gear', ref: <stack id> }`, on while
//   that stack is equipped by the member) or a perk (`{ kind: 'perk', ref: <talent id or name, or
//   skill name> }`). Only code (another part through `party.addEffect`) makes these: a story line
//   always makes a timed one.
// Sources: consumables (the items part, `source.kind: 'item'`), quest rewards (`quest`), the
// Setback debuff for a failed quest (`setback`, preset 'setback', once per quest), and story
// lines (`story`): `+ effect Keen Sight — sharper eyes | on: perception | for: 2h | who: Lyra`.
//
// Bookkeeping (SPEC §2.2): `effects.active` is keyed by effect id, each added on its own; an
// effect is never changed in place: renewing one removes the old key and adds a new one. Effects
// that are over are pruned by key (party.effectsTurn before a reply, and every effects write);
// replay passes over the remove of a key a deleted reply had made. `effects.turns` is keyed by
// receipt (a `scratch` field: replay makes it when a deleted reply had made it) and pruned to the
// newest MAX_TURNS. The story line a reply may write is claimed (`effect:<reply>`), so nothing is
// a shared counter.

import { STATS } from '../../rules.js';
import { TOPIC_NAMES, topicsOf } from '../checks/modifiers.js';
import { clipped } from '../lines.js';
import { ACTOR_ID } from './validate.js';
import { clipText, fail, labelsOf, nameKey, newId, replyOf, resolveName, revOf } from './util.js';

export const FEATURE = 'rpg-battle.effects';
export const FEATURES = Object.freeze([{
    id: FEATURE,
    label: 'Timed buffs and debuffs',
    describe: 'Potions, quest rewards, a failed quest\'s Setback and the story give effects that fade on the story clock (or after some replies); code applies them to checks and fights.',
    default: true,
    // Its change-line kind's grammar is in the fixed prompt part.
    prompt: true,
}]);

export const EFFECT_ID = /^ef_[0-9a-z]{8}$/;
export const MAX_ACTIVE = 40;
export const MAX_PER_ACTOR = 8;
export const STORY_PER_REPLY = 1;
// The turns kept (more than the longest replies limit, so a count is never cut short).
export const MAX_TURNS = 70;
export const MAX_CHECKS = 4;
export const SOURCE_KINDS = Object.freeze(['item', 'quest', 'setback', 'story', 'gear', 'perk']);
export const COMBAT_KEYS = Object.freeze(['attack', 'magic', 'defence', 'mdef', 'crit']);
// What one band moves a fight number by, in % of it; the most all of a member's effects move one
// fight number (in %) or one check, either way.
export const COMBAT_STEP = 5;
export const COMBAT_CAP = 15;
export const CHECK_CAP = 3;
// The size a story line's effect has, whatever it says (rx-combat: code picks the size).
export const STORY_BAND = 1;
// Durations: a story line between 10 minutes and a day (default an hour); code up to a week.
const MINUTES = Object.freeze({ least: 10, story: 24 * 60, most: 7 * 24 * 60, fallback: 60 });
const REPLIES = Object.freeze({ least: 1, most: 60, perMinutes: 30 });
export const SETBACK = Object.freeze({ name: 'Setback', note: 'a failed quest weighs on the party', tone: 'bad', band: 1, on: ['all'], minutes: 24 * 60 });

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isInt = (value, min = -Infinity, max = Infinity) => Number.isInteger(value) && value >= min && value <= max;
const isText = (value, max) => typeof value === 'string' && value.length <= max;
const oneLine = (value, max) => clipText(value, max * 4).replace(/[\r\n|<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();

/** Is the feature on? `source` is a ctx, a view or a query's tools; a host without features: on. */
export function featureOn(source) {
    try {
        return typeof source?.feature === 'function' ? source.feature(FEATURE) !== false : true;
    } catch {
        return true;
    }
}

// ---------------------------------------------------------------------------------------
// The domain

export const initialEffects = () => ({ active: {}, turns: {} });

/** The effects kept, in id order: a record (or nothing, before the domain was there). */
export const effectList = slice => Object.values(isRecord(slice?.active) ? slice.active : {}).filter(isRecord)
    .sort((a, b) => ((a.rev ?? 0) - (b.rev ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function checkEffect(errors, key, effect) {
    const where = `effects.active.${key}`;
    if (!isRecord(effect)) return errors.push(`${where} is not a record.`);
    if (!EFFECT_ID.test(key) || effect.id !== key) errors.push(`${where}: the id must be an effect id (ef_ and 8 letters or digits) and match its key.`);
    if (effect.actor !== 'party' && !ACTOR_ID.test(String(effect.actor))) errors.push(`${where}: the actor is an actor id or "party".`);
    if (!isText(effect.name, 40) || !effect.name.trim()) errors.push(`${where}: a name of up to 40 characters is needed.`);
    if (!isText(effect.note ?? '', 60)) errors.push(`${where}: the note is up to 60 characters.`);
    if (effect.tone !== 'good' && effect.tone !== 'bad') errors.push(`${where}: the tone is good or bad.`);
    const source = effect.source;
    if (!isRecord(source) || !SOURCE_KINDS.includes(source.kind) || !isText(source.name ?? '', 60) || (source.ref !== undefined && source.ref !== null && !isText(source.ref, 80))) {
        errors.push(`${where}: the source is { kind: ${SOURCE_KINDS.join('|')}, name, ref? }.`);
    }
    if (!Array.isArray(effect.checks) || effect.checks.length > MAX_CHECKS || effect.checks.some(entry => !isRecord(entry)
        || !(entry.on === 'all' || STATS.includes(entry.on) || TOPIC_NAMES.includes(entry.on)) || !isInt(entry.amount, -CHECK_CAP, CHECK_CAP) || entry.amount === 0)) {
        errors.push(`${where}: checks are up to ${MAX_CHECKS} of { on: all | a stat | a check topic, amount: ±1 to ±${CHECK_CAP} }.`);
    }
    if (!isRecord(effect.combat) || Object.entries(effect.combat).some(([name, amount]) => !COMBAT_KEYS.includes(name) || !isInt(amount, -COMBAT_CAP, COMBAT_CAP) || amount === 0)) {
        errors.push(`${where}: combat numbers are ${COMBAT_KEYS.join(', ')}, a share of ±1 to ±${COMBAT_CAP} %.`);
    }
    const start = effect.start;
    const legacy = start?.turn === undefined && (start?.at === null || isInt(start?.at, 0));
    if (!isRecord(start) || !(start.minutes === null || isInt(start.minutes, 0)) || !(legacy || isInt(start.turn, 0))) errors.push(`${where}: start is { minutes, turn }, whole numbers (minutes may be null).`);
    if (!(effect.minutes === null || effect.minutes === undefined || isInt(effect.minutes, 1, MINUTES.most))) errors.push(`${where}: minutes is how long it lasts in story time (up to a week), or null.`);
    if (effect.until !== undefined && effect.until !== null && !isInt(effect.until, 0)) errors.push(`${where}: until (an older effect's end) is a story minute, or null.`);
    if (!(effect.replies === null || isInt(effect.replies, REPLIES.least, REPLIES.most))) errors.push(`${where}: replies is ${REPLIES.least} to ${REPLIES.most}, or null.`);
    const bound = source?.kind === 'gear' || source?.kind === 'perk';
    if (!bound && !effect.minutes && !effect.until && effect.replies === null) errors.push(`${where}: an effect that is not worn or a perk must end.`);
    if (!isInt(effect.rev, 0)) errors.push(`${where}: rev must be a whole number.`);
}

/** The effects slice's problems, [] when it is fine. */
export function validateEffects(slice) {
    if (!isRecord(slice) || !isRecord(slice.active)) return ['effects.active must be a record.'];
    const errors = [];
    const entries = Object.entries(slice.active);
    // 4× the kept number: a replay after a middle delete may keep one a deleted reply had pruned.
    if (entries.length > MAX_ACTIVE * 4) errors.push(`effects keeps about ${MAX_ACTIVE} effects at most.`);
    for (const [key, effect] of entries) checkEffect(errors, key, effect);
    if (slice.turns !== undefined) {
        if (!isRecord(slice.turns)) errors.push('effects.turns must be a record.');
        else {
            const turns = Object.entries(slice.turns);
            if (turns.length > MAX_TURNS * 4) errors.push(`effects keeps about ${MAX_TURNS} turns at most.`);
            for (const [key, turn] of turns) {
                if (!/^r\d{1,15}$/.test(key) || !isRecord(turn) || !isInt(turn.n, 1) || !isInt(turn.rev, 0)
                    || !(turn.seen === undefined || turn.seen === null || isInt(turn.seen, 0)) || !(turn.dm === undefined || isInt(turn.dm, 0))) errors.push(`effects.turns.${key.slice(0, 20)} must be { n, rev, seen, dm } under r<rev>.`);
            }
        }
    }
    return errors;
}

/** The turn now: the highest turn number kept (0 before the first). */
export function turnOf(slice) {
    let most = 0;
    for (const turn of Object.values(isRecord(slice?.turns) ? slice.turns : {})) if (isInt(turn?.n, 1) && turn.n > most) most = turn.n;
    return most;
}

// ---------------------------------------------------------------------------------------
// Now, and whether an effect is on

const ask = (query, name, args) => {
    if (typeof query !== 'function') return undefined;
    try { return query(name, args); } catch { return undefined; }
};
const minutesOf = value => (isInt(value, 0) ? value : isRecord(value) && isInt(value.minutes, 0) ? value.minutes : null);

/** Now for a command: { minutes (the story clock, or null), turn (effects.turns' highest), turns }. */
export function nowOfCtx(ctx) {
    let minutes = null;
    try { minutes = minutesOf(typeof ctx?.time === 'function' ? ctx.time() : null); } catch { minutes = null; }
    if (minutes === null) minutes = minutesOf(ask(typeof ctx?.query === 'function' ? (n, a) => ctx.query(n, a) : null, 'director.time', {}));
    let slice = null;
    try { slice = ctx.read('effects'); } catch { slice = null; }
    return { minutes, turn: turnOf(slice), turns: isRecord(slice?.turns) ? slice.turns : {} };
}

/** Now for a query or a view: the clock through `query` (else the director slice), the turns from the state. */
export function nowOfState(state, query) {
    const minutes = minutesOf(ask(query, 'director.time', {})) ?? minutesOf(state?.domains?.director?.time);
    const slice = state?.domains?.effects;
    return { minutes, turn: turnOf(slice), turns: isRecord(slice?.turns) ? slice.turns : {} };
}

/**
 * The story minutes that passed since the effect began, or null when it began without a clock or
 * there is none now: from its own clock reading to the first turn after it, then each later turn's
 * forward move (`dm`), then from the last turn's reading to now; a move back counts as none.
 */
export function minutesSince(effect, now) {
    const from = effect?.start?.minutes;
    if (!isInt(from, 0) || !isInt(now?.minutes, 0)) return null;
    const begun = isInt(effect.start.turn, 0) ? effect.start.turn : 0;
    const after = Object.values(isRecord(now.turns) ? now.turns : {}).filter(turn => isInt(turn?.n, 1) && turn.n > begun).sort((a, b) => a.n - b.n);
    let passed = 0;
    let seen = from;
    after.forEach((turn, index) => {
        if (!isInt(turn.seen, 0)) return;
        passed += index === 0 ? Math.max(0, turn.seen - from) : isInt(turn.dm, 0) ? turn.dm : Math.max(0, turn.seen - seen);
        seen = turn.seen;
    });
    return passed + Math.max(0, now.minutes - seen);
}

/** How long a timed effect lasts in story minutes (an older effect's `until` read as a length). */
const lengthOf = effect => (isInt(effect?.minutes, 1) ? effect.minutes : isInt(effect?.until, 0) && isInt(effect?.start?.minutes, 0) ? Math.max(1, effect.until - effect.start.minutes) : null);

/** Turns since the one the effect began on (an effect from before turns were kept counts from turn 0: it never outlasts its replies). */
const repliesSince = (effect, now) => (isInt(now?.turn, 0) ? Math.max(0, now.turn - (isInt(effect?.start?.turn, 0) ? effect.start.turn : 0)) : null);

const holdsTalent = (actor, ref) => (actor?.origin?.talents ?? []).some(talent => nameKey(talent?.id) === nameKey(ref) || nameKey(talent?.name) === nameKey(ref))
    || (actor?.skills ?? []).some(skill => nameKey(skill?.name) === nameKey(ref));

/**
 * Is the effect on now? Its member is still in the party; a worn one's stack is still equipped
 * by them (the shared bag's worn pieces are your character's); a perk's talent or skill is still
 * theirs; a timed one is before `until` on the clock, else within its replies.
 */
export function isOn(effect, { party, inventory, now }) {
    const actors = party?.actors ?? {};
    if (effect?.actor !== 'party' && !Object.hasOwn(actors, effect?.actor)) return false;
    const source = effect.source ?? {};
    if (source.kind === 'gear') {
        const stack = inventory?.stacks?.[source.ref];
        if (!stack?.equipped) return false;
        const wearer = stack.owner === 'party' ? party?.pc : stack.owner;
        if (effect.actor !== 'party' && wearer !== effect.actor) return false;
    }
    if (source.kind === 'perk') {
        const holders = effect.actor === 'party' ? Object.values(actors) : [actors[effect.actor]];
        if (!holders.some(actor => holdsTalent(actor, source.ref))) return false;
    }
    // Whichever ends first: the clock (when there is one) and the replies (always).
    const length = lengthOf(effect);
    const passed = length ? minutesSince(effect, now) : null;
    if (length && passed !== null && passed >= length) return false;
    if (isInt(effect.replies, 1)) {
        const since = repliesSince(effect, now);
        if (since !== null && since > effect.replies) return false;
    }
    return true;
}

/** The effects on now for a state: [effect]. */
export function activeEffects(state, now) {
    const party = state?.domains?.party;
    const inventory = state?.domains?.inventory;
    return effectList(state?.domains?.effects).filter(effect => isOn(effect, { party, inventory, now }));
}

/** "2 h", "45 min", "1 d 3 h", "3 replies", "while worn", "" for how long an effect has left. */
export function leftText(effect, now) {
    if (effect.source?.kind === 'gear') return 'while worn';
    if (effect.source?.kind === 'perk') return '';
    const since = repliesSince(effect, now);
    const repliesLeft = isInt(effect.replies, 1) ? Math.max(0, effect.replies - (since ?? 0)) : null;
    // The clock's words, unless the replies will end it sooner (about REPLIES.perMinutes a reply).
    const length = lengthOf(effect);
    const passed = length ? minutesSince(effect, now) : null;
    if (passed !== null && !(repliesLeft !== null && repliesLeft * REPLIES.perMinutes < length - passed)) {
        const left = Math.max(1, length - passed);
        const days = Math.floor(left / 1440);
        const hours = Math.floor((left % 1440) / 60);
        const mins = left % 60;
        if (days) return hours ? `${days} d ${hours} h` : `${days} d`;
        if (hours) return mins >= 30 && hours < 3 ? `${hours} h ${mins} min` : `${hours} h`;
        return `${mins} min`;
    }
    if (repliesLeft !== null) return repliesLeft ? `${repliesLeft} repl${repliesLeft === 1 ? 'y' : 'ies'}` : 'this reply';
    return '';
}

/** What gave it, in a few words: 'Hawk Draught', 'quest: Rats in the Cellar', 'worn: Ember Ring'. */
export function sourceText(effect) {
    const source = effect.source ?? {};
    const name = source.name || '';
    if (source.kind === 'quest') return name ? `quest: ${name}` : 'quest reward';
    if (source.kind === 'setback') return name ? `failed: ${name}` : 'a failed quest';
    if (source.kind === 'gear') return name ? `worn: ${name}` : 'worn';
    if (source.kind === 'perk') return name || 'perk';
    if (source.kind === 'item') return name || 'item';
    return name || 'story';
}

/** An effect as the queries give it (screens, the checks table, the fight). */
export function shown(effect, now) {
    return {
        id: effect.id, actor: effect.actor, name: effect.name, note: effect.note ?? '', tone: effect.tone,
        left: leftText(effect, now), source: sourceText(effect),
        checks: effect.checks.map(entry => ({ ...entry })), combat: { ...effect.combat },
    };
}

/**
 * How much a member's effects (and everyone's) move each fight number, in %: { attack: 10, … }
 * summed and held to ±COMBAT_CAP. `effects` are shown() or stored effects already found to be on.
 */
export function combatShift(effects) {
    const out = {};
    for (const effect of effects) for (const [name, amount] of Object.entries(effect.combat ?? {})) if (COMBAT_KEYS.includes(name) && Number.isFinite(amount)) out[name] = (out[name] ?? 0) + amount;
    for (const name of Object.keys(out)) out[name] = Math.max(-COMBAT_CAP, Math.min(COMBAT_CAP, out[name]));
    return out;
}

/** A fight number moved by `percent` % (one decimal, never below 0). */
export const shifted = (value, percent) => Math.max(0, Math.round(value * (1 + percent / 100) * 10) / 10);

// ---------------------------------------------------------------------------------------
// Reading what an effect does (words, never numbers)

/** The strength band a text means: 1 (minor: the default), 2 (moderate), 3 (major). */
export function bandOf(text) {
    const words = ` ${String(text ?? '').slice(0, 200).toLowerCase()} `;
    if (/\b(?:major|strong|great|greater|powerful|mighty|potent|heavy|severe|grave)\b/.test(words)) return 3;
    if (/\b(?:moderate|notable|marked|solid|medium|fair)\b/.test(words)) return 2;
    return 1;
}

const COMBAT_WORDS = [
    [/\b(?:magic(?:al)?\s*(?:defen[cs]e|resist\w*|ward)|spell\s*(?:defen[cs]e|resist\w*)|mdef)\b/, 'mdef'],
    [/\b(?:attack|damage|offen[cs]e|strike|strikes|blows?|atk)\b/, 'attack'],
    [/\b(?:magic|spells?|spellcraft|matk|sorcery)\b/, 'magic'],
    [/\b(?:defen[cs]e|armou?r|guard|toughness|def)\b/, 'defence'],
    [/\b(?:crit\w*)\b/, 'crit'],
];
const ALL_WORDS = /^(?:all|any|every\w*|checks?|all checks|rolls?|everything)$/;

/**
 * What an `on:` value names: { checks: [on], combat: [key] }: 'all', stats (DEX), check topics
 * (perception), fight numbers (attack, defence, magic, mdef, crit). Parts are split on , ; / and "and".
 */
export function readOn(value) {
    const out = { checks: [], combat: [] };
    const add = (list, item) => { if (!list.includes(item)) list.push(item); };
    for (const raw of String(value ?? '').slice(0, 200).split(/[,;/]|\band\b/)) {
        const part = raw.trim().toLowerCase();
        if (!part) continue;
        if (ALL_WORDS.test(part)) { add(out.checks, 'all'); continue; }
        const stat = STATS.find(name => part === name.toLowerCase() || part === `${name.toLowerCase()} checks`);
        if (stat) { add(out.checks, stat); continue; }
        const combat = COMBAT_WORDS.find(([pattern]) => pattern.test(part));
        if (combat) { add(out.combat, combat[1]); continue; }
        for (const topic of topicsOf(part)) add(out.checks, topic);
    }
    out.checks = out.checks.includes('all') ? ['all'] : out.checks.slice(0, MAX_CHECKS);
    return out;
}

const UNIT = [
    [/^(?:m|mins?|minutes?)$/, 1], [/^(?:h|hrs?|hours?)$/, 60], [/^(?:d|days?)$/, 1440], [/^(?:w|wks?|weeks?)$/, 10080],
    [/^(?:repl(?:y|ies)|turns?|messages?)$/, 'reply'],
];
const COUNT_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };

/** A `for:` value: { minutes } or { replies }, or null when it says no length ("2h", "30 min", "a day", "3 replies"). */
export function readDuration(value) {
    const text = String(value ?? '').slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    if (/^(?:a while|a bit|briefly|short(?:ly)?)$/.test(text)) return { minutes: 60 };
    const match = /^(\d{1,4}(?:\.\d+)?|a|an|one|two|three|four|five|six|half(?: an?)?)\s*([a-z]+)/.exec(text);
    if (!match) return null;
    const count = /^\d/.test(match[1]) ? Number(match[1]) : COUNT_WORDS[match[1].split(' ')[0]];
    const unit = UNIT.find(([pattern]) => pattern.test(match[2]))?.[1];
    if (!unit || !(count > 0)) return null;
    if (unit === 'reply') return { replies: Math.round(count) };
    return { minutes: Math.round(count * unit) };
}

const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));

/**
 * How long an effect made now lasts: { minutes, replies } (minutes null without a clock; replies
 * always, the fallback). `story`: a story line's limits.
 */
function lastsFor(duration, now, { story }) {
    const most = story ? MINUTES.story : MINUTES.most;
    if (duration?.replies) {
        const replies = clampInt(duration.replies, REPLIES.least, story ? 10 : REPLIES.most);
        return { minutes: null, replies };
    }
    const minutes = clampInt(duration?.minutes ?? MINUTES.fallback, MINUTES.least, most);
    const replies = clampInt(Math.ceil(minutes / REPLIES.perMinutes), REPLIES.least, REPLIES.most);
    return { minutes: isInt(now.minutes, 0) ? minutes : null, replies };
}

// ---------------------------------------------------------------------------------------
// Making and ending effects

/** The effects slice to change: its `active` record (the domain is made when a chat has none yet). */
function draftEffects(ctx) {
    const slice = ctx.draft('effects');
    if (!isRecord(slice.active)) slice.active = {};
    return slice.active;
}

/** The turns record to change (a scratch field: made when missing). */
function draftTurns(ctx) {
    const slice = ctx.draft('effects');
    if (!isRecord(slice.turns)) slice.turns = {};
    return slice.turns;
}

function readSlice(ctx, name) {
    try { return ctx.read(name); } catch { return null; }
}

/** Effects that are over removed by key (each a key of its own; a gone key's remove is passed over on replay). */
function pruneOver(ctx, active, now) {
    const party = readSlice(ctx, 'party');
    const inventory = readSlice(ctx, 'inventory');
    const gone = [];
    for (const effect of Object.values(active)) {
        if (!isOn(effect, { party, inventory, now })) {
            delete active[effect.id];
            gone.push(effect.id);
        }
    }
    return gone;
}

/** What an effect acts on, as keys: `check:perception`, `combat:attack`. */
const targetsOf = effect => [...(effect.checks ?? []).map(entry => `check:${entry.on}`), ...Object.keys(effect.combat ?? {}).map(key => `combat:${key}`)];

/**
 * One effect made (shared by party.addEffect and the `effect` kind). `spec`: { actor, name, note,
 * tone, band, on: { checks, combat }, duration, source }. Renews an effect of that name on that
 * member (the old key goes, a new one comes). `story`: a story line's limits (STORY_BAND, a day,
 * and it takes the place of the member's story effects that act on any of the same things).
 */
function makeEffect(ctx, spec, { story }) {
    if (!featureOn(ctx)) fail(ctx, 'FEATURE_OFF', 'Timed buffs and debuffs are switched off in this chat.');
    const name = oneLine(spec.name, 40);
    if (!name) fail(ctx, 'INVALID', 'An effect needs a name.');
    const tone = spec.tone === 'bad' ? 'bad' : 'good';
    const band = story ? STORY_BAND : clampInt(Number(spec.band) || 1, 1, CHECK_CAP);
    const sign = tone === 'bad' ? -1 : 1;
    if (!spec.on.checks.length && !spec.on.combat.length) fail(ctx, 'INVALID', `${name}: say what it acts on (on: perception, stealth, DEX, attack, defence, all checks…).`);
    const checks = spec.on.checks.slice(0, MAX_CHECKS).map(on => ({ on, amount: sign * band }));
    const combat = Object.fromEntries(spec.on.combat.map(key => [key, sign * Math.min(COMBAT_CAP, band * COMBAT_STEP)]));
    const source = { kind: SOURCE_KINDS.includes(spec.source?.kind) ? spec.source.kind : 'story', name: oneLine(spec.source?.name ?? '', 60) };
    if (spec.source?.ref !== undefined && spec.source?.ref !== null && String(spec.source.ref).trim()) source.ref = oneLine(spec.source.ref, 80);
    const bound = source.kind === 'gear' || source.kind === 'perk';
    if (bound && !source.ref) fail(ctx, 'INVALID', `${name}: a worn piece's or a perk's effect names its stack or perk.`);
    const now = nowOfCtx(ctx);
    const lasts = bound && !spec.duration ? { minutes: null, replies: null } : lastsFor(spec.duration, now, { story });
    const active = draftEffects(ctx);
    pruneOver(ctx, active, now);
    // Renewed, not stacked: the same name on the same member replaces the one there; a story line
    // also takes the place of that member's story effects on the same checks or fight numbers.
    const targets = new Set(targetsOf({ checks, combat }));
    const same = Object.values(active).filter(effect => effect.actor === spec.actor && (nameKey(effect.name) === nameKey(name)
        || (story && effect.source?.kind === 'story' && targetsOf(effect).some(target => targets.has(target)))));
    // A new key even for a renewal (taken before the old one goes), so nothing is changed in place.
    const id = newId(ctx, 'ef', candidate => Object.hasOwn(active, candidate));
    for (const effect of same) delete active[effect.id];
    const mine = Object.values(active).filter(effect => effect.actor === spec.actor).length;
    if (mine >= MAX_PER_ACTOR) fail(ctx, 'REFUSED', `${spec.who ?? 'They'} already ${spec.who ? 'has' : 'have'} ${MAX_PER_ACTOR} effects: ${name} does not take.`);
    if (Object.keys(active).length >= MAX_ACTIVE) fail(ctx, 'REFUSED', `The party already has ${MAX_ACTIVE} effects: ${name} does not take.`);
    const effect = {
        id, actor: spec.actor, name, note: oneLine(spec.note ?? '', 60), tone, source, checks, combat,
        start: { minutes: now.minutes, turn: now.turn }, minutes: lasts.minutes, replies: lasts.replies, rev: revOf(ctx),
    };
    active[id] = effect;
    const who = spec.who ?? 'Everyone';
    const how = leftText(effect, now);
    return {
        summary: `${who}: ${name}${same.length ? ' (renewed)' : ''}${how ? `, ${how}` : ''}.`,
        data: { effect: id, actor: spec.actor, renewed: same.map(entry => entry.id) },
        narrate: false,
        ...(spec.clamped ? { problem: spec.clamped } : {}),
    };
}

/** The member a payload or line names: { actor: id | 'party', who }. */
function memberFor(ctx, { actor, who } = {}, { everyone = false } = {}) {
    const party = readSlice(ctx, 'party') ?? { actors: {}, order: [] };
    if (actor === 'party' || (everyone && actor === undefined && !who)) return { actor: 'party', who: 'Everyone' };
    if (actor !== undefined && actor !== null) {
        const found = party.actors?.[actor];
        return found ? { actor: found.id, who: found.name } : fail(ctx, 'NOT_FOUND', 'That person is not in the party.');
    }
    const name = String(who ?? '').trim();
    if (/^(?:everyone|all|the party|party|us|we)$/i.test(name)) return { actor: 'party', who: 'Everyone' };
    if (name) {
        const found = resolveName(party, name);
        return found.actor ? { actor: found.actor.id, who: found.actor.name } : fail(ctx, found.error, found.message);
    }
    const pc = party.pc ? party.actors?.[party.pc] : null;
    return pc ? { actor: pc.id, who: pc.name } : fail(ctx, 'NOT_FOUND', 'Make your character first.');
}

/**
 * party.addEffect (internal: another part, never a click) { actor? | who?, name, note?, tone?:
 * 'good'|'bad', strength?: 1–3 or a word, on: text | [text], for?: '2h' | { minutes } | { replies },
 * source: { kind, name?, ref? }, claim?, preset?: 'setback' }. The items part (a consumable's
 * buff: kind 'item'; a worn piece's: kind 'gear', ref its stack, no `for`), quests (kind 'quest';
 * a failed one: preset 'setback', on everyone for a day, once per quest ref) and creation (perks).
 * With `claim` (claimed as `effect:<claim>`) it is given once on this line of history.
 */
function addEffect(ctx, payload = {}) {
    if (ctx.cause === 'ui' && !ctx.caller) fail(ctx, 'REFUSED', 'Effects come from the story, things used and quests, not from a button.');
    const setback = payload.preset === 'setback';
    if (payload.preset !== undefined && payload.preset !== null && !setback) fail(ctx, 'INVALID', `"${payload.preset}" is not an effect preset (setback).`);
    const base = setback ? { ...SETBACK, on: SETBACK.on.join(', ') } : payload;
    const member = memberFor(ctx, setback && payload.actor === undefined && !payload.who ? { actor: 'party' } : payload, { everyone: setback });
    const source = setback ? { kind: 'setback', name: payload.source?.name ?? payload.quest ?? '', ref: payload.source?.ref ?? payload.quest ?? null } : payload.source ?? { kind: 'story' };
    const claimKey = payload.claim ? `effect:${String(payload.claim).slice(0, 80)}` : setback && source.ref ? `effect:setback:${String(source.ref).slice(0, 80)}` : null;
    if (claimKey && !ctx.claim(claimKey)) fail(ctx, 'CLAIMED', 'That effect was already given.');
    const strength = Number.isInteger(payload.strength) ? payload.strength : bandOf(payload.strength ?? '');
    const on = readOn(Array.isArray(base.on) ? base.on.join(', ') : base.on);
    const duration = setback ? { minutes: SETBACK.minutes } : typeof payload.for === 'string' ? readDuration(payload.for) : isRecord(payload.for) ? payload.for : null;
    if (typeof payload.for === 'string' && payload.for.trim() && !duration) fail(ctx, 'INVALID', `"${clipText(payload.for, 30)}" is not a length of time (2h, 30 min, a day, 3 replies).`);
    return makeEffect(ctx, {
        ...member, name: base.name, note: base.note, tone: base.tone, band: setback ? SETBACK.band : strength, on, duration, source,
    }, { story: false });
}

/** party.endEffect (internal) { effect }: an effect taken off by another part (a cure, a quest put right). */
function endEffect(ctx, payload = {}) {
    if (ctx.cause === 'ui' && !ctx.caller) fail(ctx, 'REFUSED', 'Effects wear off by themselves.');
    const active = draftEffects(ctx);
    const effect = active[payload.effect];
    if (!effect) fail(ctx, 'NOT_FOUND', 'That effect is not on anyone.');
    delete active[effect.id];
    return { summary: `${effect.name} wears off.`, data: { effect: effect.id }, narrate: false };
}

/**
 * party.effectsTurn {} (system, before each new reply while there are effects): a turn passes,
 * one more in `effects.turns` (keyed by this receipt, numbered one past the highest; the oldest
 * past MAX_TURNS go), then the effects that are over are removed by key. Refused from a click.
 */
function effectsTurn(ctx) {
    if (ctx.cause === 'ui') fail(ctx, 'REFUSED', 'Turns pass by themselves, before each reply.');
    const turns = draftTurns(ctx);
    const rev = revOf(ctx);
    const n = turnOf({ turns }) + 1;
    // The clock this turn saw, and how far it moved forward since the turn before (never back).
    const { minutes } = nowOfCtx(ctx);
    const before = Object.values(turns).find(turn => turn?.n === n - 1);
    const dm = isInt(minutes, 0) && isInt(before?.seen, 0) ? Math.max(0, minutes - before.seen) : 0;
    turns[`r${rev}`] = { n, rev, seen: isInt(minutes, 0) ? minutes : null, dm };
    const keys = Object.keys(turns).sort((x, y) => (turns[x].n - turns[y].n) || (x < y ? -1 : 1));
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_TURNS))) delete turns[key];
    const gone = pruneOver(ctx, draftEffects(ctx), nowOfCtx(ctx));
    return { summary: gone.length ? `${gone.length} effect${gone.length === 1 ? '' : 's'} wore off.` : 'A turn passes.', data: { turn: n, gone }, narrate: false };
}

// ---------------------------------------------------------------------------------------
// The `effect` change-line kind

export const GRAMMAR = '+ effect Name — short note | on: <check, stat, attack or defence> | for: <a time, or some replies> | who: Name | kind: buff|debuff (minor or moderate: code sets the numbers); - effect Name | who: Name when it ends early';

const DEBUFF = /^(?:debuff|bad|curse[ds]?|harm\w*|malus|penalty|negative|ailment)$/;

/** `+ effect …` adds a timed effect from the story; `- effect Name` ends a story's or a thing's effect early. */
function applyEffect(ctx, line) {
    if (!featureOn(ctx)) fail(ctx, 'FEATURE_OFF', 'Timed buffs and debuffs are switched off in this chat.');
    const labels = labelsOf(line);
    const member = memberFor(ctx, { who: labels.who ?? labels.on_who ?? labels.target ?? labels.by ?? null });
    if (line.op === '-') {
        const active = draftEffects(ctx);
        const named = Object.values(active).filter(effect => (effect.actor === member.actor || (member.actor === 'party' || effect.actor === 'party')) && nameKey(effect.name) === nameKey(oneLine(line.name, 40)));
        // Only what the story or a thing gave ends this way: a quest's reward, a Setback, a worn piece or a perk keep to their own rule.
        const ending = named.filter(effect => effect.source?.kind === 'story' || effect.source?.kind === 'item');
        if (!ending.length) fail(ctx, named.length ? 'REFUSED' : 'NOT_FOUND', named.length ? `${named[0].name} ends by itself, not from the story.` : `${member.who} has no effect called ${oneLine(line.name, 40)}.`);
        for (const effect of ending) delete active[effect.id];
        return { summary: `${member.who}: ${ending[0].name} wears off.`, data: { ended: ending.map(effect => effect.id) }, narrate: false };
    }
    if (line.op !== '+' && line.op !== '!') fail(ctx, 'INVALID', 'An effect is written "+ effect Name — note | on: … | for: …".');
    const reply = replyOf(ctx, line);
    if (reply !== null) {
        let taken = false;
        for (let n = 1; n <= STORY_PER_REPLY && !taken; n += 1) taken = ctx.claim(`effect:${reply}:${n}`);
        if (!taken) fail(ctx, 'REFUSED', `Only ${STORY_PER_REPLY === 1 ? 'one new effect counts' : `${STORY_PER_REPLY} new effects count`} in one reply.`);
    }
    const kind = String(labels.kind ?? labels.tone ?? labels.type ?? '').toLowerCase();
    const written = `${labels.strength ?? ''} ${line.text ?? ''} ${line.name ?? ''}`;
    const band = bandOf(written);
    const duration = labels.for ? readDuration(labels.for) : null;
    if (labels.for && !duration) fail(ctx, 'INVALID', `"${clipText(labels.for, 30)}" is not a length of time (2h, 30 min, a day, 3 replies).`);
    const from = oneLine(labels.from ?? labels.source ?? '', 60);
    return makeEffect(ctx, {
        ...member, name: line.name, note: line.text ?? '', tone: DEBUFF.test(kind) ? 'bad' : 'good', band,
        on: readOn(labels.on ?? ''), duration, source: { kind: 'story', name: from },
        clamped: band > STORY_BAND ? `${oneLine(line.name, 40)}: a story's effect is minor; code sets its size.` : null,
    }, { story: true });
}

// Marked with the feature (MODULES §F100): Story Block refuses them (FEATURE_OFF) while it is off.
const tagged = fn => Object.assign(fn, { feature: FEATURE });

export const effectCommands = {
    'party.addEffect': tagged(addEffect),
    'party.endEffect': tagged(endEffect),
    'party.effectsTurn': tagged(effectsTurn),
};

export const effectKinds = {
    effect: { grammar: GRAMMAR, feature: FEATURE, apply: clipped(applyEffect) },
};

/**
 * beforeGenerate(view, info): while any effect is kept, a `party.effectsTurn` (system) before each
 * new reply (normal or regenerate), never for a swipe (the turn was counted when the reply was
 * first written) or a Continue. Nothing while the feature is off or there are no effects.
 */
export function turnBeforeReply(view, info = {}) {
    if (!featureOn(view)) return { commands: [] };
    const type = String(info?.type ?? 'normal').toLowerCase();
    if (type === 'swipe' || type === 'continue' || type === 'quiet' || type === 'impersonate') return { commands: [] };
    if (!effectList(view?.state?.domains?.effects).length) return { commands: [] };
    return { commands: [{ type: 'party.effectsTurn', payload: {} }] };
}
