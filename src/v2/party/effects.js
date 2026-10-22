// Timed buffs and debuffs (feature `rpg-battle.effects`, default on): the `effects` domain, its
// commands, the `effect` change-line kind, and the pure rules that say whether an effect is still
// on and what it does. Owned by the party part.
//
// An effect is on one member (or on everyone: actor 'party') and has code's meaning only:
// * `checks`: ± on the checks it matches, in the F80 modifier table (checks/modifiers.js reads
//   them through `party.effects`): `on: 'all'`, a stat (a check answered by DEX), or a check topic
//   (perception, stealth, …: modifiers.js TOPICS);
// * `combat`: ± on fight numbers (attack, magic, defence, mdef, crit), counted in
//   `party.combatNumbers`, which the fight reads.
// The amounts are code's, from a word band (minor 1, moderate 2, major 3; a story line at most
// moderate), never a number the story writes. The model is told only names and short notes
// (the party's tail); the numbers reach it as code's modifier table.
//
// How long it lasts:
// * timed: until the story clock (Story Director's `director.time`, `ctx.time()`) passes `until`;
//   with no clock, `replies` replies after the one that made it (counted on the chat index: the
//   reply index the checks part hands the dice for, else the carrier's), and the reply count is
//   kept as the fallback for when a clock goes away;
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
// that are over are pruned by key (party.pruneEffects before a reply, and every effects write);
// replay passes over the remove of a key a deleted reply had made. Story lines are capped per
// reply by claims (`effect:<reply>:<n>`), so nothing is a shared counter.

import { STATS } from '../../rules.js';
import { TOPIC_NAMES, topicsOf } from '../checks/modifiers.js';
import { preparedEntries } from '../checks/shared.js';
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
export const STORY_PER_REPLY = 3;
export const MAX_CHECKS = 4;
export const SOURCE_KINDS = Object.freeze(['item', 'quest', 'setback', 'story', 'gear', 'perk']);
export const COMBAT_KEYS = Object.freeze(['attack', 'magic', 'defence', 'mdef', 'crit']);
// What one band adds to a fight number (crit is a share in %).
const COMBAT_STEP = Object.freeze({ attack: 2, magic: 2, defence: 2, mdef: 2, crit: 3 });
// The most all of a member's effects move one check or one fight number, either way.
export const CHECK_CAP = 3;
export const COMBAT_CAP = Object.freeze({ attack: 6, magic: 6, defence: 6, mdef: 6, crit: 9 });
// Durations: a story line between 10 minutes and a day (default an hour); code up to a week.
const MINUTES = Object.freeze({ least: 10, story: 24 * 60, most: 7 * 24 * 60, fallback: 60 });
const REPLIES = Object.freeze({ least: 1, most: 30, perMinutes: 30 });
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

export const initialEffects = () => ({ active: {} });

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
    if (!isRecord(effect.combat) || Object.entries(effect.combat).some(([name, amount]) => !COMBAT_KEYS.includes(name) || !isInt(amount, -COMBAT_CAP[name], COMBAT_CAP[name]))) {
        errors.push(`${where}: combat numbers are ${COMBAT_KEYS.join(', ')}, whole numbers within their caps.`);
    }
    const start = effect.start;
    if (!isRecord(start) || !(start.minutes === null || isInt(start.minutes, 0)) || !(start.at === null || isInt(start.at, 0))) errors.push(`${where}: start is { minutes, at }, whole numbers or null.`);
    if (!(effect.until === null || isInt(effect.until, 0))) errors.push(`${where}: until is the story minute it ends, or null.`);
    if (!(effect.replies === null || isInt(effect.replies, REPLIES.least, REPLIES.most))) errors.push(`${where}: replies is ${REPLIES.least} to ${REPLIES.most}, or null.`);
    const bound = source?.kind === 'gear' || source?.kind === 'perk';
    if (!bound && effect.until === null && effect.replies === null) errors.push(`${where}: an effect that is not worn or a perk must end.`);
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
    return errors;
}

// ---------------------------------------------------------------------------------------
// Now, and whether an effect is on

const ask = (query, name, args) => {
    if (typeof query !== 'function') return undefined;
    try { return query(name, args); } catch { return undefined; }
};
const minutesOf = value => (isInt(value, 0) ? value : isRecord(value) && isInt(value.minutes, 0) ? value.minutes : null);

/** The reply index the latest dice were handed for (the reply being written), else null. */
export const latestReply = state => {
    const at = preparedEntries(state?.domains?.checks).at(-1)?.for;
    return isInt(at, 0) ? at : null;
};

/** Now for a command: { minutes (the story clock, or null), at (this reply's chat index, or null) }. */
export function nowOfCtx(ctx, { at = null } = {}) {
    let minutes = null;
    try { minutes = minutesOf(typeof ctx?.time === 'function' ? ctx.time() : null); } catch { minutes = null; }
    if (minutes === null) minutes = minutesOf(ask(typeof ctx?.query === 'function' ? (n, a) => ctx.query(n, a) : null, 'director.time', {}));
    let index = isInt(at, 0) ? at : isInt(ctx?.carrier?.index, 0) ? ctx.carrier.index : null;
    if (index === null) {
        try { index = latestReply({ domains: { checks: ctx.read('checks') } }); } catch { index = null; }
    }
    return { minutes, at: index };
}

/** Now for a query or a view: the clock through `query`, the latest reply index from the state (else `fallbackAt`). */
export function nowOfState(state, query, { fallbackAt = null } = {}) {
    const minutes = minutesOf(ask(query, 'director.time', {})) ?? minutesOf(state?.domains?.director?.time);
    return { minutes, at: latestReply(state) ?? (isInt(fallbackAt, 0) ? fallbackAt : null) };
}

/** Replies since the one that made the effect (an exchange is two messages), or null when not known. */
const repliesSince = (effect, now) => (isInt(effect?.start?.at, 0) && isInt(now?.at, 0) ? Math.max(0, Math.floor((now.at - effect.start.at) / 2)) : null);

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
    if (isInt(effect.until, 0) && isInt(now?.minutes, 0)) return now.minutes < effect.until;
    if (isInt(effect.replies, 1)) {
        const since = repliesSince(effect, now);
        return since === null || since <= effect.replies;
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
    if (isInt(effect.until, 0) && isInt(now?.minutes, 0)) {
        const left = Math.max(1, effect.until - now.minutes);
        const days = Math.floor(left / 1440);
        const hours = Math.floor((left % 1440) / 60);
        const mins = left % 60;
        if (days) return hours ? `${days} d ${hours} h` : `${days} d`;
        if (hours) return mins >= 30 && hours < 3 ? `${hours} h ${mins} min` : `${hours} h`;
        return `${mins} min`;
    }
    if (isInt(effect.replies, 1)) {
        const since = repliesSince(effect, now) ?? 0;
        const left = Math.max(0, effect.replies - since);
        return left ? `${left} repl${left === 1 ? 'y' : 'ies'}` : 'this reply';
    }
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
 * A member's fight numbers moved by their effects (and everyone's): { attack: n, … } summed and
 * held to COMBAT_CAP. `effects` are shown() or stored effects already found to be on.
 */
export function combatShift(effects) {
    const out = {};
    for (const effect of effects) for (const [name, amount] of Object.entries(effect.combat ?? {})) if (COMBAT_KEYS.includes(name)) out[name] = (out[name] ?? 0) + amount;
    for (const name of Object.keys(out)) out[name] = Math.max(-COMBAT_CAP[name], Math.min(COMBAT_CAP[name], out[name]));
    return out;
}

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
 * How long an effect made now lasts: { until, replies } (until null without a clock; replies
 * always, the fallback). `story`: a story line's limits.
 */
function lastsFor(duration, now, { story }) {
    const most = story ? MINUTES.story : MINUTES.most;
    if (duration?.replies) {
        const replies = clampInt(duration.replies, REPLIES.least, story ? 10 : REPLIES.most);
        return { until: null, replies };
    }
    const minutes = clampInt(duration?.minutes ?? MINUTES.fallback, MINUTES.least, most);
    const replies = clampInt(Math.ceil(minutes / REPLIES.perMinutes), REPLIES.least, REPLIES.most);
    return { until: isInt(now.minutes, 0) ? now.minutes + minutes : null, replies };
}

// ---------------------------------------------------------------------------------------
// Making and ending effects

/** The effects slice to change (the domain is made when a chat has none yet). */
function draftEffects(ctx) {
    const slice = ctx.draft('effects');
    if (!isRecord(slice.active)) slice.active = {};
    return slice.active;
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

/**
 * One effect made (shared by party.addEffect and the `effect` kind). `spec`: { actor, name, note,
 * tone, band, on: { checks, combat }, duration, source }. Renews an effect of that name on that
 * member (the old key goes, a new one comes). `story`: a story line's limits (band ≤ 2, a day).
 */
function makeEffect(ctx, spec, { story }) {
    if (!featureOn(ctx)) fail(ctx, 'FEATURE_OFF', 'Timed buffs and debuffs are switched off in this chat.');
    const name = oneLine(spec.name, 40);
    if (!name) fail(ctx, 'INVALID', 'An effect needs a name.');
    const tone = spec.tone === 'bad' ? 'bad' : 'good';
    const band = clampInt(Number(spec.band) || 1, 1, story ? 2 : CHECK_CAP);
    const sign = tone === 'bad' ? -1 : 1;
    if (!spec.on.checks.length && !spec.on.combat.length) fail(ctx, 'INVALID', `${name}: say what it acts on (on: perception, stealth, DEX, attack, defence, all checks…).`);
    const checks = spec.on.checks.slice(0, MAX_CHECKS).map(on => ({ on, amount: sign * band }));
    const combat = Object.fromEntries(spec.on.combat.map(key => [key, sign * Math.min(COMBAT_CAP[key], band * COMBAT_STEP[key])]));
    const source = { kind: SOURCE_KINDS.includes(spec.source?.kind) ? spec.source.kind : 'story', name: oneLine(spec.source?.name ?? '', 60) };
    if (spec.source?.ref !== undefined && spec.source?.ref !== null && String(spec.source.ref).trim()) source.ref = oneLine(spec.source.ref, 80);
    const bound = source.kind === 'gear' || source.kind === 'perk';
    if (bound && !source.ref) fail(ctx, 'INVALID', `${name}: a worn piece's or a perk's effect names its stack or perk.`);
    const now = nowOfCtx(ctx, { at: spec.at });
    const lasts = bound && !spec.duration ? { until: null, replies: null } : lastsFor(spec.duration, now, { story });
    const active = draftEffects(ctx);
    pruneOver(ctx, active, now);
    // Renewed, not stacked: the same name on the same member replaces the one there.
    const same = Object.values(active).filter(effect => effect.actor === spec.actor && nameKey(effect.name) === nameKey(name));
    // A new key even for a renewal (taken before the old one goes), so nothing is changed in place.
    const id = newId(ctx, 'ef', candidate => Object.hasOwn(active, candidate));
    for (const effect of same) delete active[effect.id];
    const mine = Object.values(active).filter(effect => effect.actor === spec.actor).length;
    if (mine >= MAX_PER_ACTOR) fail(ctx, 'REFUSED', `${spec.who ?? 'They'} already ${spec.who ? 'has' : 'have'} ${MAX_PER_ACTOR} effects: ${name} does not take.`);
    if (Object.keys(active).length >= MAX_ACTIVE) fail(ctx, 'REFUSED', `The party already has ${MAX_ACTIVE} effects: ${name} does not take.`);
    const effect = {
        id, actor: spec.actor, name, note: oneLine(spec.note ?? '', 60), tone, source, checks, combat,
        start: { minutes: now.minutes, at: now.at }, until: lasts.until, replies: lasts.replies, rev: revOf(ctx),
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
 * party.pruneEffects { at? } (system, before a reply): effects that are over removed by key, so
 * the slice keeps only what is on. `at` is the reply about to be written. Refused from a click.
 */
function pruneEffects(ctx, payload = {}) {
    if (ctx.cause === 'ui') fail(ctx, 'REFUSED', 'Effects are tidied by code before a reply.');
    const active = draftEffects(ctx);
    const gone = pruneOver(ctx, active, nowOfCtx(ctx, { at: payload?.at }));
    if (!gone.length) fail(ctx, 'REFUSED', 'No effect is over.');
    return { summary: `${gone.length} effect${gone.length === 1 ? '' : 's'} wore off.`, data: { gone }, narrate: false };
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
        if (!taken) fail(ctx, 'REFUSED', `At most ${STORY_PER_REPLY} new effects count in one reply.`);
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
        clamped: band > 2 ? `${oneLine(line.name, 40)}: a story's effect is moderate at most.` : null,
    }, { story: true });
}

// Marked with the feature (MODULES §F100): Story Block refuses them (FEATURE_OFF) while it is off.
const tagged = fn => Object.assign(fn, { feature: FEATURE });

export const effectCommands = {
    'party.addEffect': tagged(addEffect),
    'party.endEffect': tagged(endEffect),
    'party.pruneEffects': tagged(pruneEffects),
};

export const effectKinds = {
    effect: { grammar: GRAMMAR, feature: FEATURE, apply: clipped(applyEffect) },
};

/**
 * beforeGenerate(view, info): when an effect is over, a `party.pruneEffects` (system) for the
 * reply about to be written. Nothing while the feature is off or nothing is over.
 */
export function pruneBeforeReply(view, info = {}) {
    if (!featureOn(view)) return { commands: [] };
    const state = view?.state;
    const stored = effectList(state?.domains?.effects);
    if (!stored.length) return { commands: [] };
    const type = String(info?.type ?? 'normal').toLowerCase();
    const length = view?.chat?.length;
    const at = Number.isInteger(length) ? (type === 'swipe' || type === 'continue' ? Math.max(0, length - 1) : length) : null;
    const query = typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null;
    const now = { ...nowOfState(state, query), at };
    const party = state?.domains?.party;
    const inventory = state?.domains?.inventory;
    if (stored.every(effect => isOn(effect, { party, inventory, now }))) return { commands: [] };
    return { commands: [{ type: 'party.pruneEffects', payload: { at } }] };
}
