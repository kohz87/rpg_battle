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
 * the host's `ctx.carrier` ({ index, swipe }) as `<index>:<swipe>`, or a plain key as written.
 */
export function replyOf(ctx, line) {
    for (const value of [ctx?.carrier, line?.carrier, line?.reply]) {
        if (value === undefined || value === null || value === '') continue;
        if (typeof value === 'object') {
            if (Number.isInteger(value.index)) return `${value.index}:${value.swipe ?? 0}`;
            continue;
        }
        return String(value);
    }
    return null;
}

export const nameKey = name => String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** A member's name as the Party heading keeps it (v1 headingText): no bars, dashes or brackets. */
export const cleanName = value => headingText(value, 40);
export const cleanRole = value => headingText(value, 30);

/** The actors in display order (pc first). */
export function actorsInOrder(party) {
    return (party?.order ?? []).map(id => party.actors?.[id]).filter(Boolean);
}

/**
 * The member a written name means (v1 story.findTarget: the full name, then the first name; your
 * character before the companions; "you", "me" are your character), or { error } when no one or
 * more than one person fits.
 */
export function resolveName(party, name) {
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

/** Lower-case label keys with spaces and underscores as one: `Taught by` and `taught_by` are `taught by`. */
export function labelsOf(line) {
    const out = {};
    for (const [key, value] of Object.entries(line?.labels ?? {})) out[nameKey(key).replace(/[_-]+/g, ' ')] = String(value ?? '').trim();
    return out;
}

export const plainCopy = value => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
