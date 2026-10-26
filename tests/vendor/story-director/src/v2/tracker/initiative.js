// Story Director v2, tracker part: NPC initiative, a seeded pick by code (no model call).
//
// Feature `story-director.initiative` (on by default, MODULES §F100). Before each reply, code picks at
// most one NPC who takes the initiative in it (approaches, interrupts, asks), and the Director note says
// so in one line: "Initiative: Elula may approach {{user}} about Wolf Contract."
//
// * Who can: someone present (Story Block's `scene.present`, NPC State Delta's `npc.present`) or nearby
//   (an NPC NSD knows, `npc.known`, whose dossier `location` is the scene's place or region), with an
//   open thread that names them (its key, `giver:` or `people:`; a secret never counts).
// * Weight: the urgency of their most urgent thread (due now 4, ready to turn in or due within the
//   "Due soon" days 3, else 2), times their trust with {{user}} when NPC State Delta answers
//   (`npc.meters` trust, else the dossier's relationship trust: -100 → ×0.25 … 0 → ×1 … +100 → ×2), else
//   even (×1). Whole numbers, so the pick never depends on rounding.
// * Cooldown (setting `tracker.initiativeCooldown`, default 2, at least 2): someone picked at round r is
//   not picked again before round r + cooldown, so never two replies running.
// * Seed: the pick is a `system` step before the reply (`director.initiative { at }`, from beforeGenerate),
//   drawn with the receipt's seed (`ctx.rng()`), and recorded as a slot written whole (SPEC §2.2):
//   `director.initiative = [{ at, round, key, name, recent: [{ key, round }] }]`. A swipe, a regenerate, a
//   Continue or a Re-read of the same reply finds the pick made (`at`, the chat's length, as the chronicle's
//   world pick) and shows it again; replay applies the receipt's ops, so a rebuild gives the same pick.
//   Without the hook (a host that runs none), the tail picks the same way with a hash of the head's rev.
// * Known only: the line names the thread only when {{user}} knows of it (a quest taken on, a hook, an
//   event the story wrote: world/known.js rules); an agenda, beat or clock, or anything the arc planner
//   made, is never named ("Initiative: Geva may approach {{user}}.").

import { lineKey } from '../../changes.js';
import { isDue } from '../../relevance.js';
import { waitsForPay } from '../../tracker.js';
import { slotValue, toSlot } from '../slot.js';
import { orderedThreads, toTracker } from './convert.js';
import { calendarOf, packCalendarOf, settingsFrom } from './time.js';
import { ask, cutPoints, dueWithin, flat, knownToUser, namesPerson, sceneOf } from './scene.js';

export const FEATURE = 'story-director.initiative';
export const INITIATIVE = 'director.initiative';
export const DEFAULT_COOLDOWN = 2;
export const MAX_COOLDOWN = 20;
// NPCs NSD knows that are asked for where they are, at most (nearby).
const NEARBY_ASKED = 24;
const KINDS = new Set(['agenda', 'event', 'hook', 'quest', 'clock', 'beat']);

/** The Director's static line while the feature is on: the same bytes every reply. */
export const INITIATIVE_STATIC = 'Initiative: when the Director note names someone under Initiative, they take the first step in this reply (approach, interrupt or ask) where the scene allows it; what {{user}} does stays theirs.';

const isInt = value => Number.isSafeInteger(value);

/** A number in [0, 1) from `text` (FNV-1a, 32 bits): the same text always gives the same number. */
export function hashUnit(text) {
    let hash = 0x811c9dc5;
    for (const char of String(text)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash / 4294967296;
}
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The `initiativeCooldown` setting: 2 to MAX_COOLDOWN, else the default. */
export function cooldownOf(settings) {
    const value = settings?.initiativeCooldown;
    return isInt(value) && value >= DEFAULT_COOLDOWN ? Math.min(MAX_COOLDOWN, value) : DEFAULT_COOLDOWN;
}

/** Whether the feature is on (`ctx.feature` / `view.feature` when the host has them, F100), else on. */
export const initiativeOn = source => (typeof source?.feature === 'function' ? source.feature(FEATURE) !== false : true);

/** The recorded pick, or null. */
export const pickOf = director => {
    const value = slotValue(director?.initiative);
    return value && isInt(value.round) ? value : null;
};

/** Whether `pick` is the one for the reply being written now (`at`: the chat's length), as the chronicle's. */
export function pickFresh(pick, at) {
    if (!pick || !isInt(at) || !isInt(pick.at)) return false;
    return at >= pick.at && at < pick.at + 2;
}

// Trust in -100…100 as a weight in hundredths: ×0.25 at -100 (never 0: anyone can speak up), ×1 at 0, ×2 at +100.
function trustWeight(trust) {
    if (!Number.isFinite(trust)) return 100;
    const t = Math.max(-100, Math.min(100, Math.round(trust)));
    return t >= 0 ? 100 + t : Math.max(25, 100 + Math.round(t * 0.75));
}

function trustOf(query, person, nsd) {
    if (!nsd) return null;
    const meters = ask(query, 'npc.meters', { name: person.name }, null);
    const trust = Number(meters?.meters?.trust ?? person.dossier?.relationship?.trust);
    return Number.isFinite(trust) ? trust : null;
}

// The NPCs NSD knows that are not present but whose dossier says they are at the scene's place or region.
function nearbyPeople(query, scene) {
    if (!scene.nsd || !(scene.place || scene.region)) return [];
    const known = ask(query, 'npc.known', {}, []);
    const here = new Set(scene.people.map(person => person.key));
    const at = [scene.place, scene.region].map(name => lineKey(name)).filter(key => key.length >= 3);
    const out = [];
    for (const entry of (Array.isArray(known) ? known : []).slice(0, NEARBY_ASKED)) {
        const name = cutPoints(entry, 80);
        if (!lineKey(name) || here.has(lineKey(name))) continue;
        const dossier = ask(query, 'npc.dossier', { name }, null);
        const where = lineKey(flat(dossier?.location));
        if (!where || !at.some(key => where.includes(key) || key.includes(where))) continue;
        const own = cutPoints(dossier?.name, 80) || name;
        const aliases = Array.isArray(dossier?.aliases) ? dossier.aliases : [];
        out.push({ name: own, key: lineKey(own), names: [...new Set([own, name, ...aliases.map(alias => cutPoints(alias, 80))].filter(word => word.length >= 3))], dossier, nearby: true });
    }
    return out;
}

/**
 * Who could take the initiative now: `[{ key, name, weight, urgency, topic, dueNow, nearby }]`, by key.
 * `topic`: the key of their most urgent thread when {{user}} knows of it, else ''.
 */
export function initiativeCandidates({ director, state = null, query = null, settings = {}, scene = null } = {}) {
    if (!director) return [];
    const seen = scene ?? sceneOf(query, state);
    const own = settingsFrom(settings);
    let calendar = null;
    try { calendar = calendarOf(own, packCalendarOf(query)); } catch { calendar = null; }
    const now = isInt(director.time?.minutes) ? director.time.minutes : null;
    const threads = orderedThreads(director);
    const records = toTracker(director).records;
    const open = records.map((record, index) => ({ record, thread: threads[index], index }))
        .filter(({ record }) => record.status === 'active' && KINDS.has(record.kind));
    if (!open.length) return [];
    const people = [...seen.people, ...nearbyPeople(query, seen)];
    const out = [];
    for (const person of people) {
        let best = null;
        for (const entry of open) {
            if (!namesPerson(entry.record, person, { strict: true })) continue;
            const dueNow = isDue(entry.record, { calendar, now });
            const urgency = dueNow ? 4
                : (entry.thread?.ready || waitsForPay(entry.record) || dueWithin(entry.record, { calendar, now, days: own.dueSoonDays })) ? 3 : 2;
            if (!best || urgency > best.urgency) best = { ...entry, urgency, dueNow };
        }
        if (!best) continue;
        const weight = best.urgency * trustWeight(trustOf(query, person, seen.nsd));
        out.push({
            key: person.key, name: person.name, weight, urgency: best.urgency, dueNow: best.dueNow, nearby: Boolean(person.nearby),
            topic: knownToUser(best.record) ? cutPoints(best.record.key, 80) : '',
        });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The people still cooling down at `round`: Set of keys. */
export function cooling(pick, round, cooldown) {
    const out = new Set();
    for (const entry of Array.isArray(pick?.recent) ? pick.recent : []) {
        if (isRecord(entry) && typeof entry.key === 'string' && isInt(entry.round) && round - entry.round < cooldown) out.add(entry.key);
    }
    return out;
}

/** One of `candidates` (by key order) by weight, with `draw` in [0, 1); null for none. */
export function weightedPick(candidates, draw) {
    const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
    if (!candidates.length || total <= 0) return null;
    let at = Math.floor(Math.max(0, Math.min(0.999999999, draw)) * total);
    for (const entry of candidates) {
        if (at < entry.weight) return entry;
        at -= entry.weight;
    }
    return candidates.at(-1);
}

/** The pick for the next round: `{ round, chosen, eligible, recent }` (`recent`: those still cooling, plus the chosen). */
export function nextPick(candidates, { pick = null, cooldown = DEFAULT_COOLDOWN, draw = 0 } = {}) {
    const round = (pick?.round ?? 0) + 1;
    const cold = cooling(pick, round, cooldown);
    const eligible = candidates.filter(entry => !cold.has(entry.key));
    const chosen = weightedPick(eligible, draw);
    const recent = (Array.isArray(pick?.recent) ? pick.recent : [])
        .filter(entry => isRecord(entry) && cold.has(entry.key) && round - entry.round < cooldown)
        .map(entry => ({ key: entry.key, round: entry.round }));
    if (chosen) recent.push({ key: chosen.key, round });
    return { round, chosen, eligible, recent };
}

/** "Initiative: Elula may approach {{user}} about Wolf Contract." */
export function initiativeLine(candidate) {
    if (!candidate) return '';
    const name = cutPoints(candidate.name, 60);
    if (!candidate.topic) return `Initiative: ${name} may approach {{user}}.`;
    return candidate.dueNow ? `Initiative: ${name} may interrupt about ${candidate.topic}.` : `Initiative: ${name} may approach {{user}} about ${candidate.topic}.`;
}

const settingsOf = source => settingsFrom(typeof source === 'function' ? source() : source);

/**
 * `director.initiative { at }` (cause `system`, from the hook): the pick for the reply being written, drawn
 * with the receipt's seed, recorded whole. Refused from a click.
 */
export function initiativeCommand(ctx, payload = {}) {
    if (ctx?.cause === 'ui') return ctx.fail('REFUSED', 'Who takes the initiative is picked by Story Director itself.');
    const at = payload?.at ?? null;
    if (!(at === null || (isInt(at) && at >= 0))) return ctx.fail('INVALID', 'director.initiative: "at" must be the chat\'s length (a whole number).');
    const director = ctx.draft('director');
    const query = typeof ctx.query === 'function' ? (name, args) => ctx.query(name, args) : null;
    let scene = null;
    try { scene = typeof ctx.read === 'function' ? ctx.read('scene') : null; } catch { scene = null; }
    const settings = settingsOf(ctx.settings);
    const candidates = initiativeCandidates({ director, state: { domains: { scene } }, query, settings });
    const { round, chosen, recent } = nextPick(candidates, { pick: pickOf(director), cooldown: cooldownOf(settings), draw: ctx.rng() });
    // A slot, written whole (SPEC §2.2): nothing inside an earlier reply's pick is ever changed.
    director.initiative = toSlot({ at, round, key: chosen?.key ?? null, name: chosen?.name ?? null, recent });
    return {
        summary: chosen ? `Initiative for the next reply: ${chosen.name}.` : '',
        narrate: false,
        data: { round, key: chosen?.key ?? null, name: chosen?.name ?? null },
    };
}

/** `beforeGenerate(view)`: `{ commands: [director.initiative] }` when there is a pick to make for this reply. */
export function initiativeHook(view) {
    const director = view?.state?.domains?.director;
    if (!director || !initiativeOn(view)) return undefined;
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    const pick = pickOf(director);
    if (at === null || pickFresh(pick, at)) return undefined;
    const settings = settingsOf(view.settings);
    const query = typeof view.query === 'function' ? view.query : null;
    const candidates = initiativeCandidates({ director, state: view.state, query, settings });
    // Someone could be picked, or someone is still cooling down (the rounds count replies while it matters).
    if (!candidates.length && !cooling(pick, (pick?.round ?? 0) + 1, cooldownOf(settings)).size) return undefined;
    return { commands: [{ type: INITIATIVE, payload: { at } }] };
}

/**
 * The tail's Initiative line for `view` ('' for none): the recorded pick when it is this reply's and that
 * person can still take the initiative; else (no hook ran) the same pick drawn with a hash of the head's rev.
 */
export function initiativeTail(view, { scene = null } = {}) {
    const state = view?.state;
    const director = state?.domains?.director;
    if (!director || !initiativeOn(view)) return '';
    const settings = settingsOf(view.settings);
    const query = typeof view.query === 'function' ? view.query : null;
    const candidates = initiativeCandidates({ director, state, query, settings, scene });
    const pick = pickOf(director);
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    if (pickFresh(pick, at)) return initiativeLine(candidates.find(entry => entry.key === pick.key) ?? null);
    if (!candidates.length) return '';
    const rev = isInt(state?.meta?.rev) ? state.meta.rev : 0;
    const { chosen } = nextPick(candidates, { pick, cooldown: cooldownOf(settings), draw: hashUnit(`initiative:${rev}:${director.turn?.n ?? 0}`) });
    return initiativeLine(chosen);
}

/** The validator's check of `director.initiative`: null or a one-entry slot. */
export function initiativeErrors(slice) {
    const stored = slice?.initiative;
    if (stored === undefined || stored === null) return [];
    const value = Array.isArray(stored) && stored.length === 1 ? stored[0] : null;
    if (!isRecord(value) || !isInt(value.round) || !(value.at === null || isInt(value.at)) || !(value.key === null || typeof value.key === 'string')
        || !Array.isArray(value.recent) || value.recent.some(entry => !isRecord(entry) || typeof entry.key !== 'string' || !isInt(entry.round))) {
        return ['director.initiative must be null or [{ at, round, key, name, recent }].'];
    }
    return [];
}
