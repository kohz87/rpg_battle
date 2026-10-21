// The checks part's commands and its `check` change-line kind (MODULES §F80: checks roll in the
// same reply, like v1's dice).
//
// * `checks.prepare { for }` (system, from beforeGenerate): before every reply, swipe and
//   regenerate, a fresh set of d20s from the receipt's seed, kept for that reply index. The tail
//   hands them to the model tied to attempts (index.js).
// * The `check` kind: the reply already narrated the outcome and wrote
//   `? check stealth — slipping past the guard | dc: hard | roll: 1 | result: success`. Code takes
//   the roll it names (Roll 1, Roll 2; a die value handed over is read as that roll), adds its own
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
 * The die a check takes: { roll (1-based; 0 when code rolled), die, note }. `written` is the
 * line's `roll:` ("1", "Roll 2", or a die value that was handed over); `used` the rolls earlier
 * checks of this reply took; `place` this check's place in the reply (1, 2).
 */
export function pickRoll(prepared, written, used, place, rollCode) {
    const rolls = Array.isArray(prepared?.rolls) ? prepared.rolls : [];
    const free = index => index >= 1 && index <= rolls.length && !used.includes(index);
    const firstFree = () => {
        if (free(place)) return place;
        for (let index = 1; index <= rolls.length; index++) if (free(index)) return index;
        return 0;
    };
    if (!rolls.length) {
        return { roll: 0, die: rollCode(), note: 'no dice were handed over for this reply: code rolled' };
    }
    const number = Number.parseInt(/(\d+)/.exec(String(written ?? ''))?.[1] ?? '', 10);
    let roll = 0;
    let note = '';
    if (!Number.isInteger(number)) {
        roll = firstFree();
        if (roll) note = `no roll was named: Roll ${roll} taken`;
    } else if (number >= 1 && number <= rolls.length) {
        if (free(number)) roll = number;
        else {
            roll = firstFree();
            if (roll) note = `Roll ${number} was already used: Roll ${roll} taken`;
        }
    } else {
        const found = rolls.findIndex((die, index) => die === number && free(index + 1));
        if (found >= 0) roll = found + 1;
        else {
            roll = firstFree();
            if (roll) note = `${number} is not a roll that was handed over: Roll ${roll} taken`;
        }
    }
    if (!roll) return { roll: 0, die: rollCode(), note: 'every roll handed over was used: code rolled' };
    return { roll, die: rolls[roll - 1], note };
}

/** The d20 code rolls when no handed roll is left (ctx.roll, else ctx.rng). */
function d20(ctx) {
    const rolled = typeof ctx.roll === 'function' ? ctx.roll('1d20') : null;
    const value = typeof rolled === 'number' ? rolled : rolled?.dice?.[0] ?? rolled?.total;
    if (Number.isInteger(value) && value >= 1 && value <= 20) return value;
    return Math.floor(ctx.rng() * 20) + 1;
}

// ---------------------------------------------------------------------------------------
// A check the reply wrote

/** The key results of one reply share: its carrier ("index:swipe"), else its rolls' index. */
function replyKey(ctx, prepared) {
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
    check: { grammar: GRAMMAR, apply: applyCheck },
};
