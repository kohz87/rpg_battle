// Small helpers the party part's handlers share: failing with a code (SPEC §3.2 ctx.fail), v1
// helpers that throw a plain Error turned into an INVALID rejection, IDs from the receipt's seed,
// the receipt's rev, and finding a party member by id or by the name the story wrote. Pure
// apart from the ctx they are given.

import { findTarget, meansYou } from '../../story.js';
import { headingText } from '../../party.js';

/** Rejects the command: ctx.fail throws (SPEC §3.2); a ctx without it still gets a coded throw. */
export function fail(ctx, code, message) {
    if (typeof ctx?.fail === 'function') ctx.fail(code, message);
    const error = new Error(message);
    error.code = code;
    throw error;
}

// v1's words for a malformed request (MODULES §F4: INVALID); everything else it throws is a rule
// refusing (REFUSED): over budget, past the stat cap, a locked skill, the skill cap.
const MALFORMED = /is not a stat|must be a whole number|a name is needed|Give the companion a name/i;

/** A v1 rule that throws a plain Error as a rejection: REFUSED, or INVALID for a malformed request. */
export function attempt(ctx, fn) {
    let out;
    try {
        out = fn();
    } catch (error) {
        if (error?.code) throw error;
        const message = String(error?.message ?? error);
        fail(ctx, MALFORMED.test(message) ? 'INVALID' : 'REFUSED', message);
    }
    return out;
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A new `<prefix>_xxxxxxxx` id not in `taken`: ctx.id when the host offers one, else eight base36
 * characters from the receipt's rng, so a replayed command never needs it again.
 */
export function newId(ctx, prefix, taken = () => false) {
    for (let guard = 0; guard < 100; guard++) {
        let id = typeof ctx?.id === 'function' ? ctx.id(prefix) : null;
        if (typeof id !== 'string' || !id.startsWith(`${prefix}_`)) {
            id = `${prefix}_`;
            for (let n = 0; n < 8; n++) id += BASE36[Math.floor(ctx.rng() * 36) % 36];
        }
        if (!taken(id)) return id;
    }
    return fail(ctx, 'FAILED', 'No free id could be made.');
}

/** The rev this receipt will have (meta.rev after it), when the host tells it; else 0. */
export function revOf(ctx) {
    if (Number.isInteger(ctx?.rev)) return ctx.rev;
    if (typeof ctx?.rev === 'function') {
        const rev = ctx.rev();
        if (Number.isInteger(rev)) return rev;
    }
    return 0;
}

/**
 * The reply a story line came from (for one-a-reply rules), or null when the host does not say:
 * the reply's record id (`ctx.carrier.sid`, which a middle delete never moves: B-b2-timeline-10) as
 * `sid:<sid>`, else the host's `ctx.carrier` ({ index, swipe }) as `<index>:<swipe>`, or a plain
 * key as written.
 */
export function replyOf(ctx, line) {
    for (const value of [ctx?.carrier, line?.carrier, line?.reply]) {
        if (value === undefined || value === null || value === '') continue;
        if (typeof value === 'object') {
            if (typeof value.sid === 'string' && value.sid) return `sid:${value.sid.slice(0, 60)}`;
            if (Number.isInteger(value.index)) return `${value.index}:${value.swipe ?? 0}`;
            continue;
        }
        return String(value);
    }
    return null;
}

export const nameKey = name => String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

// What a label value or a written name is cut to before any pattern reads it (B-b5b-robust-13): the
// model's text can be any length, and some patterns are slow on a long run of spaces.
export const MAX_LABEL = 200;

/** Text from the model, cut to `max` characters before anything else reads it. */
export const clipText = (value, max = MAX_LABEL) => String(value ?? '').slice(0, max);

// SillyTavern's macros ({{char}}, {{user}}, <USER>, <BOT>): never part of a name (B-b4-14).
const MACROS = /\{\{[^{}]{0,40}\}\}|<\s*(?:user|bot|char)\s*>/gi;

/**
 * A member's name as the Party heading keeps it (v1 headingText): no bars, dashes or brackets, no
 * SillyTavern macro; '' when nothing is left.
 */
export const cleanName = value => headingText(clipText(value).replace(MACROS, ' '), 40);
export const cleanRole = value => headingText(clipText(value).replace(MACROS, ' '), 30);

/** The actors in display order (pc first). */
export function actorsInOrder(party) {
    return (party?.order ?? []).map(id => party.actors?.[id]).filter(Boolean);
}

/**
 * The member a written name means (v1 story.findTarget: the full name, then the first name; your
 * character before the companions; "you", "me" are your character), or { error } when no one or
 * more than one person fits.
 */
export function resolveName(party, written) {
    const name = clipText(written);
    const list = actorsInOrder(party);
    if (meansYou(name)) {
        const pc = party?.pc ? party.actors[party.pc] : null;
        return pc ? { actor: pc } : { error: 'NOT_FOUND', message: 'There is no character yet.' };
    }
    const key = nameKey(name);
    if (!key) return { error: 'INVALID', message: 'The line names nobody.' };
    const exact = list.filter(actor => nameKey(actor.name) === key);
    if (exact.length === 1) return { actor: exact[0] };
    const first = key.split(' ')[0];
    const byFirst = list.filter(actor => nameKey(actor.name).split(' ')[0] === first);
    if (exact.length > 1 || byFirst.length > 1) return { error: 'INVALID', message: `"${name}" could be more than one person in the party.` };
    const found = findTarget(list, name);
    return found ? { actor: found } : { error: 'NOT_FOUND', message: `${String(name).trim()} is not in the party.` };
}

/** The actor a payload means: `actor` (an id) or `who` (a name), else your character when `pcDefault`. */
export function actorFrom(ctx, party, payload, { pcDefault = true } = {}) {
    if (payload?.actor !== undefined && payload?.actor !== null) {
        const actor = party.actors?.[payload.actor];
        return actor ?? fail(ctx, 'NOT_FOUND', 'That person is not in the party.');
    }
    if (payload?.who !== undefined && payload?.who !== null && String(payload.who).trim()) {
        const found = resolveName(party, payload.who);
        return found.actor ?? fail(ctx, found.error, found.message);
    }
    if (pcDefault && party.pc && party.actors[party.pc]) return party.actors[party.pc];
    return fail(ctx, 'NOT_FOUND', 'Make your character first.');
}

/**
 * Lower-case label keys with spaces and underscores as one: `Taught by` and `taught_by` are `taught
 * by`. Keys and values are cut to MAX_LABEL characters before anything reads them.
 */
export function labelsOf(line) {
    const out = {};
    for (const [key, value] of Object.entries(line?.labels ?? {})) out[nameKey(clipText(key, 60)).replace(/[_-]+/g, ' ')] = String(value ?? '').trim().slice(0, MAX_LABEL).trim();
    return out;
}

/**
 * The offers waiting for the reader, oldest first (B-b1r2-13: `party.offers` is a record keyed by
 * offer id, each added on its own and removed only when it is taken or turned down; an older chat's
 * list is read too). An offer for someone no longer in the party (they left, or your character was
 * remade) is not waiting any more: it stays in the record, untouched, and is never shown.
 */
export function waitingOffers(party) {
    const raw = party?.offers;
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
    const actors = party?.actors ?? {};
    return list
        .filter(offer => offer && typeof offer === 'object' && (offer.kind === 'join' || Object.hasOwn(actors, offer.actor)))
        .sort((a, b) => ((a.rev ?? 0) - (b.rev ?? 0)) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
}

/** The draft's offers as a record (an older chat's list is turned into one, keyed by id). */
export function offersRecord(party) {
    if (!party.offers || typeof party.offers !== 'object' || Array.isArray(party.offers)) {
        const list = Array.isArray(party.offers) ? party.offers : [];
        party.offers = Object.fromEntries(list.filter(offer => offer && typeof offer.id === 'string').map(offer => [offer.id, offer]));
    }
    return party.offers;
}

export const plainCopy = value => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

/**
 * A waiting offer in one plain sentence for the reader (screens, the tab, the prompt's notes):
 * "Lyra asks to join (ranger).", "Ren could learn Shadow Cut.", "Lyra means to leave the party: parts ways at the ford."
 */
export function offerText(offer, party) {
    if (offer?.kind === 'join') return `${offer.name} asks to join${offer.role ? ` (${offer.role})` : ''}.`;
    const who = party?.actors?.[offer?.actor]?.name ?? offer?.name ?? 'Someone';
    if (offer?.kind === 'leave') return `${who} means to leave the party${offer.text ? `: ${offer.text}` : ''}.`;
    return `${who} could learn ${offer?.skill}.`;
}
