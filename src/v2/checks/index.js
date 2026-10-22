// RPG Battle v2, part **checks** (MODULES §F80: checks are settled in the same reply, like v1's dice;
// F31 natural 20/1; F32 up to 2 per reply; the user's check-table decision after the beta.1 live test).
//
// Before every reply, swipe and regenerate (beforeGenerate) code rolls two d20s for each party member for
// that reply (`checks.prepare`, a system receipt, seeded) and the tail hands the narrator the **check
// table** (table.js): the results worked out in advance for every stat and skill row with code's
// modifiers, the 1st column for the reply's first uncertain attempt, the 2nd for the next. The narrator
// picks the row and the difficulty, reads the result, narrates it and writes
// `? check Stealth — slipping past the guard | dc: hard | result: success`. Capture works the check out
// again from the same die and modifiers (plus other modules' bounded say, outside.js), records **that**
// result (checks log, receipt, the reply's cards: card.js, Story Block's hooks.replyCard) and flags a
// written result that disagrees; the next reply is told such a result back (card.js toldBack). When Story
// Block's pre-roll (strict mode, `story-block.preroll`) already made a check for the reader's message, the
// tail names its fixed result. Settings → Diagnostics tells the dice (`hooks.diagnostics`). Nobody adds or
// changes a modifier; a swipe or regenerate brings fresh dice. An older chat's prepare (no table members)
// keeps the raw "Roll 1 / Roll 2" dice and modifier lines of old. The party part's check.resolve stays for
// a direct roll; this part's `check` kind takes over from the party part's (src/v2/module.js).

import { commands, kinds, preparedFor } from './commands.js';
import { logEntries, preparedEntries } from './shared.js';
import { promptRolls } from './dice.js';
import { memberOf, rulesFor, tableLine as oldTableLine } from './modifiers.js';
import { MAX_SOCIAL_ROWS, diceOf, rowsFor, tableLine as rowLine } from './table.js';
import { checkView } from './card.js';
import { queries } from './queries.js';
import { diagnostics, replyCard } from './card.js';
import { DEFAULT_CAP, MAX_CAP, SOCIAL_QUERY, capOf } from './outside.js';
import { initialChecks, validateChecks } from './shared.js';

// The instruction every reply carries (byte-identical: no names, no numbers that change). The
// line's own grammar is added by Story Block from `kinds.check.grammar`. Since the user's decision after
// the beta.1 live test it reads the ready-made check table (table.js) instead of raw dice.
export const STATIC_TEXT = 'Uncertain actions (sneaking, climbing, persuading, searching, picking a lock, resisting) are settled by the check table in this reply\'s notes, worked out by code from this reply\'s dice and each character\'s modifiers. The first uncertain attempt in this reply reads the acting character\'s 1st column, the next their 2nd, at most two per reply. Pick the row that answers the action (a stat, a skill listed, or "vs Name" for a social check against that person) and the difficulty (E easy, N normal, H hard, V very hard), and read the result: a letter shown is the hardest difficulty that succeeds, ~ before a letter means that difficulty succeeds at a cost, ✗ fails, ★ always succeeds, ✗! always fails. Narrate that result in this same reply, then write `? check <the row> — <what> | dc: easy|normal|hard|very hard | result: success|cost|fail` in <Changes> (add `| who: Name` for a companion, `| vs: Name` for a check against someone). When the notes say a check was already made for the reader\'s message, narrate that result and write no check line for it.';

export const BUDGET = 320;

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
 * The tail (table.js): the dice told back for the reply before (card.js toldBack), a check Story Block's
 * pre-roll already made for the reader's message, then the check table: your character's line (always),
 * the companions' (as room allows). Nothing before a character exists. An older chat's rolls with no
 * table members (or a prepare before the party) fall back to the dice and the modifier lines of old.
 */
export function tail(view) {
    const pc = ask(view, 'party.pc', {});
    if (!pc) return { lines: [], optional: [] };
    const lines = [];
    const optional = [];
    const checks = view?.state?.domains?.checks;
    const prepared = preparedFor(checks, null);
    if (Number.isInteger(prepared?.for)) {
        const told = ask(view, 'checks.toldBack', { for: prepared.for });
        if (Array.isArray(told)) lines.push(...told.filter(line => typeof line === 'string'));
    }
    const rules = rulesFor(settingsOf(view));
    const defs = view?.state?.domains?.inventory?.defs ?? {};
    const query = (name, args) => ask(view, name, args);
    const actors = ask(view, 'party.actors', {}) ?? [pc];
    // Strict mode: Story Block's pre-roll (feature story-block.preroll) made a check for the reader's message.
    const pre = prepared ? logEntries(checks).filter(entry => entry.pre && (entry.rev ?? 0) > (prepared.rev ?? 0)) : [];
    for (const entry of pre.slice(0, 1)) {
        lines.push(`Check already made for the reader's message: ${checkView(entry, { name: actors.find(actor => actor.id === entry.actor)?.name ?? '' }).text}. Narrate that; the next uncertain attempt reads the 2nd column.`);
    }
    if (!Array.isArray(prepared?.actors)) {
        if (prepared?.rolls?.length) lines.push(`Dice for this reply: ${promptRolls(prepared.rolls)}.`);
        for (const actor of actors) lines.push(`Check modifiers — ${oldTableLine(memberOf(query, actor, defs), { you: actor.id === pc.id, rules })}`);
        return { lines, optional };
    }
    let settings = null;
    try { settings = settingsOf(view); } catch { settings = null; }
    const cap = capOf(settings);
    // Social rows: Delta's opinion of the people here (not party members), when it has one.
    const members = new Set(actors.map(actor => String(actor.name ?? '').toLowerCase()));
    const here = (view?.state?.domains?.scene?.present ?? []).filter(name => typeof name === 'string' && !members.has(name.toLowerCase())).slice(0, MAX_SOCIAL_ROWS);
    const social = cap > 0 ? here.map(name => ({ name, mod: ask(view, SOCIAL_QUERY, { name, skill: 'social' })?.mod ?? 0 })).filter(row => Number.isInteger(row.mod) && row.mod !== 0) : [];
    for (const actor of actors) {
        const dice = diceOf(prepared, actor.id);
        if (!dice) continue;
        const line = rowLine(actor.name, dice, rowsFor(memberOf(query, actor, defs), rules, social, cap), { you: actor.id === pc.id });
        (actor.id === pc.id ? lines : optional).push(line);
    }
    return { lines, optional };
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
    // Other modules' check modifiers (outside.js, Story Block MODULES §F126): the sum held to ±this.
    settings: {
        section: 'Checks',
        defaults: { outsideCap: DEFAULT_CAP },
        schema: {
            outsideCap: { type: 'int', label: 'Other modules\' check modifiers, at most (±)', min: 0, max: MAX_CAP, help: 'What other modules add to a check (NPC State Delta: how a person feels about you) is held to this much, up or down. 0 turns it off.' },
        },
    },
    hooks: { beforeGenerate, replyCard, diagnostics: () => diagnostics() },
};
