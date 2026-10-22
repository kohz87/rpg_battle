// The checks part's queries (MODULES §F80): the results, the rolls handed over for the latest
// reply, the latest reply's checks (for its card), and code's modifier table (the same rule the
// capture uses, modifiers.js). Members and items come through the party and inventory queries
// (MODULES §F3 tools); item tags are read from the inventory's defs as they are. Pure.

import { memberOf, modifiersFor, rulesFor, statModifiers } from './modifiers.js';
import { MAX_LOG, latestChecks, logEntries, preparedEntries } from './shared.js';
import { OUTCOMES } from '../party/checks.js';
import { viewAll } from './card.js';

const copy = value => JSON.parse(JSON.stringify(value ?? null));
const checksOf = state => state?.domains?.checks ?? { prepared: {}, log: {} };

/** A query through the host's tools, null when it is not registered or fails. */
export function asker(tools) {
    return (name, args) => {
        if (typeof tools?.query !== 'function') return null;
        try {
            return tools.query(name, args);
        } catch {
            return null;
        }
    };
}

/** The last results (up to MAX_LOG, 30), oldest first: the log is keyed by check id (B-b1r2-13), read in rev order. */
export function log(state) {
    return copy(logEntries(checksOf(state)).slice(-MAX_LOG));
}

/** `checks.rolls({ for? })` → { for, rolls, rev } handed over for that reply (else the latest), or null. */
export function rolls(state, args = {}) {
    const list = preparedEntries(checksOf(state));
    const found = (Number.isInteger(args?.for) ? list.findLast(entry => entry.for === args.for) : null) ?? list.at(-1) ?? null;
    return copy(found);
}

/**
 * `checks.last` → the latest reply's checks as its card shows them: { carrier, rev, results:
 * [{ id, actor, name, text, outcome, outcomeText, mismatch, note }] } or null. Read from the log
 * (the newest carrier's entries); an older chat's `last` record when its log has none.
 */
export function last(state) {
    const checks = checksOf(state);
    const latest = latestChecks(checks);
    if (!latest) return copy(checks.last ?? null);
    const actors = state?.domains?.party?.actors ?? {};
    const results = latest.results.map(entry => ({
        id: entry.id, actor: entry.actor,
        name: entry.name ?? (Object.hasOwn(actors, entry.actor) ? actors[entry.actor].name : ''),
        text: entry.text ?? `${entry.skill || entry.stat}${entry.what ? ` (${entry.what})` : ''}`,
        outcome: entry.outcome, outcomeText: entry.outcomeText ?? OUTCOMES[entry.outcome] ?? entry.outcome,
        mismatch: entry.mismatch ?? '', note: entry.note ?? '',
    }));
    return copy({ carrier: latest.carrier, rev: latest.rev, results });
}

/**
 * `checks.modifiers({ actor?, skill?, stat? })`: code's modifiers. With `skill` (or `stat`), one
 * member's (your character's when no actor is named) for that check: [{ source, amount, reason }].
 * Without, the table for the whole party: [{ actor, name, you, stats: { STR: n, … }, extras:
 * [{ source, name, topics, amount }] }], your character first. [] / null for nobody.
 */
export function modifiers(state, args = {}, tools = null) {
    const query = asker(tools);
    const defs = state?.domains?.inventory?.defs ?? {};
    const rules = rulesFor(args?.settings ?? tools?.settings ?? null);
    if (args?.skill || args?.stat) {
        const actor = args.actor ? query('party.actor', { id: args.actor }) : query('party.pc', {});
        if (!actor) return null;
        return copy(modifiersFor(memberOf(query, actor, defs), String(args.skill ?? ''), args.stat ?? null, rules));
    }
    const pc = query('party.pc', {});
    const actors = query('party.actors', {}) ?? [];
    return copy(actors.map(actor => {
        const member = memberOf(query, actor, defs);
        return { actor: actor.id, name: actor.name, you: actor.id === pc?.id, stats: statModifiers(actor, rules), extras: member.extras };
    }));
}

export const queries = {
    'checks.log': log,
    // { [check id]: { text, summary, flag, note, outcomeText, pass, … } }: each result as the reader sees it (card.js).
    'checks.view': state => copy(viewAll(state)),
    'checks.rolls': rolls,
    'checks.last': last,
    'checks.modifiers': modifiers,
};
