// RPG Battle v2, part **checks** (MODULES §F80: checks roll in the same reply, like v1's dice;
// F31 natural 20/1; F32 up to 2 per reply).
//
// Before every reply, swipe and regenerate (beforeGenerate) code rolls a fresh pair of d20s for
// that reply (`checks.prepare`, a system receipt, seeded) and the tail hands them over tied to
// attempts, with a short table of the PC's and companions' check modifiers built by code
// (modifiers.js documents the rule). The model decides whether an attempt is uncertain and how
// hard it is, takes the next roll, narrates the outcome in the same reply and writes
// `? check stealth — slipping past the guard | dc: hard | roll: 1 | result: success`. Capture
// recomputes the total with code's modifiers against the DC; that result is recorded (checks
// log, receipt, the reply's card), and a stated result that disagrees is flagged on the card.
// Nobody adds or changes a modifier; a swipe or regenerate brings fresh rolls. The reply's status
// card (screens part) shows the log entries that reply added; there is no check widget any more. The party part's
// check.resolve stays for a direct roll. The coordinator's src/v2/module.js merges this part
// with the others; its `check` kind takes over from the party part's.

import { commands, kinds, preparedFor } from './commands.js';
import { preparedEntries } from './shared.js';
import { promptRolls } from './dice.js';
import { memberOf, rulesFor, tableLine } from './modifiers.js';
import { queries } from './queries.js';
import { initialChecks, validateChecks } from './shared.js';

// The instruction every reply carries (byte-identical: no names, no numbers that change). The
// line's own grammar is added by Story Block from `kinds.check.grammar`.
export const STATIC_TEXT = 'Uncertain actions (sneaking, climbing, persuading, searching, picking a lock, resisting) are settled by the dice handed over in this reply\'s notes: the first uncertain attempt takes Roll 1, the next Roll 2, at most two per reply. Add the acting character\'s modifier from the notes\' table (the stat that answers the skill, plus a bonus listed for that kind of check), set the difficulty (easy 10, normal 15, hard 20, very hard 25) and compare: reaching it succeeds, 1 or 2 short succeeds at a cost, less fails; a natural 20 always succeeds and a natural 1 always fails. Narrate the outcome in this same reply, then write `? check <skill> — <what> | dc: … | roll: <1 or 2> | result: success|cost|fail` in <Changes> (add `| who: Name` for a companion).';

export const BUDGET = 260;

function ask(view, name, args) {
    if (typeof view?.query !== 'function') return null;
    try {
        return view.query(name, args) ?? null;
    } catch {
        return null;
    }
}

function settingsOf(view) {
    try {
        const value = typeof view?.settings === 'function' ? view.settings() : view?.settings;
        return value && typeof value === 'object' ? value : null;
    } catch {
        return null;
    }
}

/**
 * The tail: this reply's rolls, tied to attempts (v1 promptRolls), and code's modifier table, one
 * line per member, your character first. Nothing before a character exists.
 */
export function tail(view) {
    const pc = ask(view, 'party.pc', {});
    if (!pc) return { lines: [], optional: [] };
    const lines = [];
    const prepared = preparedFor(view?.state?.domains?.checks, null);
    if (prepared?.rolls?.length) lines.push(`Dice for this reply: ${promptRolls(prepared.rolls)}.`);
    const rules = rulesFor(settingsOf(view));
    const defs = view?.state?.domains?.inventory?.defs ?? {};
    const query = (name, args) => ask(view, name, args);
    const actors = ask(view, 'party.actors', {}) ?? [pc];
    for (const actor of actors) {
        lines.push(`Check modifiers — ${tableLine(memberOf(query, actor, defs), { you: actor.id === pc.id, rules })}`);
    }
    return { lines, optional: [] };
}

/**
 * beforeGenerate(view, info?): fresh rolls for the reply about to be written, as a `system`
 * receipt (`checks.prepare { for }`). `for` is that reply's chat index: the last message for a
 * swipe or a continue (`info.type`), else the next one. A Continue keeps the rolls its reply
 * already has.
 */
export function beforeGenerate(view, info = {}) {
    const type = String(info?.type ?? 'normal').toLowerCase();
    const length = view?.chat?.length;
    const index = Number.isInteger(length) ? (type === 'swipe' || type === 'continue' ? Math.max(0, length - 1) : length) : null;
    if (type === 'continue' && preparedEntries(view?.state?.domains?.checks).some(entry => entry.for === index)) return { commands: [] };
    return { commands: [{ type: 'checks.prepare', payload: { for: index } }] };
}

export const part = {
    domains: {
        checks: { initial: initialChecks, validate: slice => validateChecks(slice) },
    },
    commands,
    queries,
    kinds,
    context: { static: () => STATIC_TEXT, tail, budget: BUDGET },
    hooks: { beforeGenerate },
};
