// The checks part's commands and its `check` change-line kind (MODULES §F80: checks roll in the
// same reply, like v1's dice).
//
// * `checks.prepare { for }` (system, from beforeGenerate): before every reply, swipe and
//   regenerate, a fresh set of d20s from the receipt's seed, kept for that reply index. The tail
//   hands them to the model tied to attempts (index.js).
// * The `check` kind: the reply already narrated the outcome and wrote
//   `? check stealth — slipping past the guard | dc: hard | roll: 1 | result: success`. Code takes
//   the roll of the line's place among the reply's checks (the first Roll 1, the second Roll 2,
//   whatever the line names: a line naming the other roll is noted on the card), adds its own
//   modifiers (modifiers.js), reads the total against the difficulty (a natural 20 always
//   succeeds, a natural 1 always fails, F31) and records **that** result in the log and the
//   receipt (not narrated: the reply told it already). When the model's stated result disagrees,
//   the result carries a `mismatch` ("narrated as success, the dice say fail") for the reply's
//   card. Up to 2 checks per reply (F32); a third is refused, so it lands in the Problems list.
//
// Members and items are found through the party and inventory queries, never by changing those
// domains. Synchronous and pure apart from ctx.

import { OUTCOMES, dcOf, outcomeOf, statForCheck } from '../party/checks.js';
import { drawFrom, promptRolls, rollDice } from './dice.js';
import { memberOf, modifiersFor, rulesFor } from './modifiers.js';
import { clipped } from '../lines.js';
import {
    MAX_LOG, MAX_PER_REPLY, MAX_PREPARED, ROLLS_PER_REPLY,
    attemptText, clip, dcText, mismatchOf, nameKey, saidOutcome, short, sumOf,
} from './shared.js';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

const copy = value => JSON.parse(JSON.stringify(value));

/** Rejects the command (SPEC §3.2 ctx.fail); a ctx without it still gets a coded throw. */
export function fail(ctx, code, message) {
    if (typeof ctx?.fail === 'function') ctx.fail(code, message);
    const error = new Error(message);
    error.code = code;
    throw error;
}

/** The rev this receipt will have (MODULES §F2), else 0 when the host does not say. */
function revOf(ctx) {
    if (Number.isInteger(ctx?.rev)) return ctx.rev;
    if (typeof ctx?.rev === 'function') {
        const rev = ctx.rev();
        if (Number.isInteger(rev)) return rev;
    }
    return 0;
}

/** A query of another part, or null when it is not registered (a module without that part). */
function ask(ctx, name, args) {
    try {
        return ctx.query(name, args);
    } catch (error) {
        if (error?.code === 'NOT_FOUND') return null;
        throw error;
    }
}

/** The checks slice to change, in its F80 shape (an older chat's `pending` list is dropped). */
function draftChecks(ctx) {
    const checks = ctx.draft('checks');
    if (!Array.isArray(checks.prepared)) checks.prepared = [];
    if (!Array.isArray(checks.log)) checks.log = [];
    if (checks.last === undefined) checks.last = null;
    if ('pending' in checks) delete checks.pending;
    return checks;
}

/** A new `ck_xxxxxxxx` id drawn from the receipt's dice, not used by any check kept. */
function newId(ctx, checks) {
    const used = id => checks.log.some(entry => entry.id === id) || (checks.last?.results ?? []).some(entry => entry.id === id);
    for (let guard = 0; guard < 100; guard++) {
        let id = 'ck_';
        for (let n = 0; n < 8; n++) id += BASE36[Math.floor(ctx.rng() * 36) % 36];
        if (!used(id)) return id;
    }
    return fail(ctx, 'FAILED', 'No free id could be made.');
}

/** The member a check is for: `actor` (an id), else `who` (a written name), else your character. */
function actorFor(ctx, { actor, who } = {}) {
    if (actor !== undefined && actor !== null && actor !== '') {
        return ask(ctx, 'party.actor', { id: String(actor) }) ?? fail(ctx, 'NOT_FOUND', 'That person is not in the party.');
    }
    const name = String(who ?? '').trim();
    if (name) return ask(ctx, 'party.actor', { name }) ?? fail(ctx, 'NOT_FOUND', `${clip(name, 40)} is not in the party.`);
    return ask(ctx, 'party.pc', {}) ?? fail(ctx, 'NOT_FOUND', 'Make your character first.');
}

/** The rules the modifiers are read with (modifiers.js rulesFor on this part's settings). */
function rulesOf(ctx) {
    try { return rulesFor(ctx.settings?.() ?? null); } catch { return rulesFor(null); }
}

// ---------------------------------------------------------------------------------------
// The rolls of a reply

/**
 * checks.prepare { for } (system; beforeGenerate's): 2 fresh d20s from this receipt's seed for
 * the reply at chat index `for` (null when unknown), replacing that index's earlier rolls (a
 * swipe or a regenerate gets new ones). The last 8 replies' rolls are kept.
 */
function prepare(ctx, payload = {}) {
    if (ctx?.cause === 'ui') fail(ctx, 'REFUSED', 'The dice are rolled by code before a reply, not from a screen.');
    const at = payload?.for;
    if (at !== null && at !== undefined && !(Number.isInteger(at) && at >= 0)) fail(ctx, 'INVALID', 'The reply index must be a whole number.');
    const index = Number.isInteger(at) ? at : null;
    const checks = draftChecks(ctx);
    const rolls = rollDice(ROLLS_PER_REPLY, 20, drawFrom(() => ctx.rng()));
    const entry = { for: index, rolls, rev: revOf(ctx) };
    checks.prepared = [...checks.prepared.filter(other => other.for !== index), entry].slice(-MAX_PREPARED);
    return {
        summary: `Dice for the next reply: ${promptRolls(rolls)}.`,
        data: { for: index, rolls: [...rolls] },
        narrate: false,
    };
}

/**
 * The rolls handed over for the reply at chat index `index`. Captures only ever run on the newest
 * reply, and a prepare always comes right before a generation, so the latest prepare is that
 * reply's: when it names this index, names none, or names the next one (a swipe or a continue whose
 * type the hook was not told, so it counted one message too many). Otherwise (an older reply read
 * again) that reply's own rolls when they are still kept, else the latest.
 */
export function preparedFor(checks, index) {
    const list = Array.isArray(checks?.prepared) ? checks.prepared : [];
    const latest = list.at(-1) ?? null;
    if (!latest || !Number.isInteger(index) || latest.for === null || latest.for === index || latest.for === index + 1) return latest;
    return list.find(entry => entry.for === index) ?? latest;
}

/**
 * The die a check takes: { roll (1-based; 0 when code rolled), die, note }. The roll is fixed by the
 * check's place among the checks this reply wrote (F80: the first uncertain attempt takes Roll 1,
 * the next Roll 2, "whatever they say"): `place` (1, 2). What the line names (`written`: "1",
 * "Roll 2", or a die value that was handed over) never picks another die, or the model could take
 * the better of the two (B-b4-2); a line that names another roll gets the roll of its place and a
 * note saying so, for the reply's card. `used`: the rolls earlier checks of this reply took.
 */
export function pickRoll(prepared, written, used, place, rollCode) {
    const rolls = Array.isArray(prepared?.rolls) ? prepared.rolls : [];
    if (!rolls.length) {
        return { roll: 0, die: rollCode(), note: 'no dice were handed over for this reply: code rolled' };
    }
    const roll = Number.isInteger(place) && place >= 1 && place <= rolls.length && !used.includes(place) ? place : 0;
    if (!roll) return { roll: 0, die: rollCode(), note: 'every roll handed over was used: code rolled' };
    const die = rolls[roll - 1];
    const number = Number.parseInt(/(\d+)/.exec(String(written ?? ''))?.[1] ?? '', 10);
    let note = '';
    if (!Number.isInteger(number)) note = `no roll was named: Roll ${roll} taken`;
    else if (number >= 1 && number <= rolls.length) {
        // A roll number; a die value that is also a roll number counts as the die when it is this one.
        if (number !== roll && die !== number) note = `the line named Roll ${number}, but this is the reply's ${ORDINALS[roll - 1] ?? `${roll}th`} check: Roll ${roll} taken`;
    } else if (number !== die) {
        note = rolls.includes(number)
            ? `the line named ${number}, Roll ${rolls.indexOf(number) + 1}'s die, but this is the reply's ${ORDINALS[roll - 1] ?? `${roll}th`} check: Roll ${roll} taken`
            : `${number} is not a roll that was handed over: Roll ${roll} taken`;
    }
    return { roll, die, note };
}

const ORDINALS = ['first', 'second', 'third'];

/** The d20 code rolls when no handed roll is left (ctx.roll, else ctx.rng). */
function d20(ctx) {
    const rolled = typeof ctx.roll === 'function' ? ctx.roll('1d20') : null;
    const value = typeof rolled === 'number' ? rolled : rolled?.dice?.[0] ?? rolled?.total;
    if (Number.isInteger(value) && value >= 1 && value <= 20) return value;
    return Math.floor(ctx.rng() * 20) + 1;
}

// ---------------------------------------------------------------------------------------
// A check the reply wrote

/**
 * The key results of one reply share: its record id (`s:<sid>`, which a middle delete never
 * moves), else its carrier ("index:swipe"), else its rolls' index.
 */
function replyKey(ctx, prepared) {
    if (typeof ctx?.carrier?.sid === 'string' && ctx.carrier.sid) return `s:${ctx.carrier.sid.slice(0, 36)}`;
    if (typeof ctx?.carrier?.key === 'string') return ctx.carrier.key;
    if (Number.isInteger(ctx?.carrier?.index)) return `${ctx.carrier.index}:${Number.isInteger(ctx.carrier.swipe) ? ctx.carrier.swipe : 0}`;
    return prepared ? `r${prepared.for ?? 'x'}:${prepared.rev}` : `rev${revOf(ctx)}`;
}

/** "Roll 1 = 12 + 3 = 15 against 20 (hard)" for a result. */
function rollText(entry) {
    const die = entry.roll ? `Roll ${entry.roll} = ${entry.die}` : `d20 ${entry.die}`;
    return `${die} ${entry.mod < 0 ? '−' : '+'} ${Math.abs(entry.mod)} = ${entry.total} against ${dcText(entry)}`;
}

/**
 * The `check` kind: `? check <skill> — <what> | dc: … | roll: N | result: … | who: Name |
 * stat: STAT`. Records code's result; the receipt is not narrated (the reply did that).
 */
function applyCheck(ctx, line) {
    const labels = {};
    for (const [key, value] of Object.entries(line?.labels ?? {})) labels[nameKey(key)] = String(value ?? '').trim();
    const actor = actorFor(ctx, { who: labels.who ?? labels.by ?? null });
    const skill = clip(line?.name ?? '', 40);
    const statWord = String(labels.stat ?? '').trim();
    if (!skill && !statWord) fail(ctx, 'INVALID', 'A check needs a skill or a stat.');
    const stat = statForCheck(skill, statWord || null);
    if (statWord && stat !== statWord.toUpperCase()) fail(ctx, 'INVALID', `${clip(statWord, 20)} is not a stat.`);
    const target = dcOf(labels.dc ?? '');
    if (!target) fail(ctx, 'INVALID', 'The difficulty is easy, normal, hard or a number from 1 to 40.');

    const checks = draftChecks(ctx);
    const prepared = preparedFor(checks, ctx?.carrier?.index);
    const key = replyKey(ctx, prepared);
    const earlier = checks.log.filter(entry => entry.carrier === key);
    const what = clip(line?.text ?? '', 120);
    if (earlier.length >= MAX_PER_REPLY) {
        fail(ctx, 'REFUSED', `Only ${MAX_PER_REPLY} checks count in one reply: ${attemptText({ skill, stat, what })} was not rolled.`);
    }
    const picked = pickRoll(prepared, labels.roll, earlier.map(entry => entry.roll).filter(Boolean), earlier.length + 1, () => d20(ctx));
    const rules = rulesOf(ctx);
    let defs = {};
    try { defs = ctx.read('inventory')?.defs ?? {}; } catch { defs = {}; }
    const member = memberOf((name, args) => ask(ctx, name, args), actor, defs);
    const modifiers = modifiersFor(member, skill, statWord || null, rules);
    const mod = sumOf(modifiers);
    const outcome = outcomeOf(picked.die, mod, target.dc);
    const said = saidOutcome(labels.result);
    const mismatch = mismatchOf(said, outcome);
    const rev = revOf(ctx);
    const entry = {
        id: newId(ctx, checks), actor: actor.id, skill, stat, dc: target.dc, word: target.word, what, rev,
        carrier: key, roll: picked.roll, die: picked.die, modifiers, mod, total: picked.die + mod, outcome,
        said, mismatch, note: clip(picked.note, 160),
    };
    checks.log = [...checks.log, entry].slice(-MAX_LOG);
    const shown = {
        id: entry.id, actor: actor.id, name: clip(actor.name, 80),
        text: clip(`${attemptText(entry)}: ${rollText(entry)}`, 240),
        outcome, outcomeText: OUTCOMES[outcome], mismatch, note: entry.note,
    };
    checks.last = checks.last?.carrier === key ? { ...checks.last, rev, results: [...checks.last.results, shown] } : { carrier: key, rev, results: [shown] };

    const parts = modifiers.map(modifier => `${modifier.reason} ${short(modifier.amount)}`).join(', ');
    const flag = mismatch ? ` The story ${mismatch.replace(/^narrated/, 'narrated it')}.` : '';
    const summary = `${actor.name} tries ${attemptText(entry)}: ${entry.roll ? `Roll ${entry.roll} = ${entry.die}` : `d20 ${entry.die}`}${parts ? `, ${parts}` : ''} → ${entry.total} against ${dcText(entry)}: ${OUTCOMES[outcome]}.${flag}`;
    return {
        summary,
        data: {
            check: entry.id, actor: actor.id, skill, stat, dc: entry.dc, roll: entry.roll, die: entry.die, modifiers: copy(modifiers),
            mod, total: entry.total, outcome, said, mismatch, note: entry.note, carrier: key,
        },
        narrate: false,
    };
}

export const handlers = { prepare, applyCheck };

export const commands = {
    'checks.prepare': prepare,
};

export const GRAMMAR = '? check <skill or stat> — what is attempted | dc: easy|normal|hard|<number> | roll: <1 or 2> | result: success|fail | who: Name';

export const kinds = {
    check: { grammar: GRAMMAR, apply: clipped(applyCheck) },
};
