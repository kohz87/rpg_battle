// The checks part's commands and its `check` change-line kind (MODULES §F16). A `? check` line
// makes a **pending** check (nothing is rolled): the member who tries, the skill word, the stat
// that answers it (with its automatic modifier) and the difficulty. The reader may add a skill,
// an ability, an item they carry or a custom ±n with a reason, then rolls it (check.roll: a d20
// from the receipt's seed + the modifiers, read by Story Block's dice rules); a check still
// waiting when the next reply is asked for is rolled with what it has (index.js beforeGenerate).
// The roll's receipt is what the next reply narrates. Members and items are found through the
// party and inventory queries, never by reading those domains. Synchronous and pure apart from ctx.

import { STATS } from '../../rules.js';
import { OUTCOMES, dcOf, outcomeOf, statForCheck } from '../party/checks.js';
import {
    MAX_EXTRA, MAX_LOG, MAX_PENDING, MOD_MAX, MOD_MIN, READER_SOURCES,
    attemptText, clip, dcText, modifierList, nameKey, short, signed, statModifier, sumOf,
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

/** A new `ck_xxxxxxxx` id drawn from the receipt's dice, not used by any check kept. */
function newId(ctx, checks) {
    const used = id => checks.pending.some(entry => entry.id === id) || checks.log.some(entry => entry.id === id);
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

function pendingOf(ctx, checks, id) {
    const check = checks.pending.find(entry => entry.id === id);
    return check ?? fail(ctx, 'NOT_FOUND', 'That check is no longer waiting.');
}

/** The names an actor record gives for its abilities (race traits, talents), when it keeps any. */
export function abilitiesOf(actor) {
    const out = [];
    for (const field of ['abilities', 'talents', 'traits']) {
        for (const entry of Array.isArray(actor?.[field]) ? actor[field] : []) {
            const name = typeof entry === 'string' ? entry : entry?.name;
            if (typeof name === 'string' && name.trim()) out.push(clip(name, 60));
        }
    }
    return out;
}

/** The items a member can bring to a check: their own and the party's shared pack. */
export function carriedBy(query, actorId) {
    const own = query('inventory.items', { owner: actorId }) ?? [];
    const pack = query('inventory.items', { owner: 'party' }) ?? [];
    const seen = new Set();
    return [...own, ...pack].filter(item => item && !seen.has(item.stack) && seen.add(item.stack));
}

// ---------------------------------------------------------------------------------------
// The pending check

/**
 * check.open { actor? | who?, skill, stat?, dc, what? } (internal; the `check` kind's work): a
 * pending check with its automatic stat modifier. Not narrated: nothing has happened yet.
 */
function openCheck(ctx, payload = {}) {
    const checks = ctx.draft('checks');
    const actor = actorFor(ctx, payload);
    const skill = clip(payload.skill, 40);
    const statWord = String(payload.stat ?? '').trim();
    if (!skill && !statWord) fail(ctx, 'INVALID', 'A check needs a skill or a stat.');
    if (statWord && !STATS.includes(statWord.toUpperCase())) fail(ctx, 'INVALID', `${clip(statWord, 20)} is not a stat.`);
    const stat = statForCheck(skill, statWord || null);
    const target = dcOf(payload.dc);
    if (!target) fail(ctx, 'INVALID', 'The difficulty is easy, normal, hard or a number from 1 to 40.');
    if (checks.pending.length >= MAX_PENDING) fail(ctx, 'REFUSED', `${MAX_PENDING} checks are already waiting: roll or cancel some first.`);
    const check = {
        id: newId(ctx, checks),
        actor: actor.id,
        skill,
        stat,
        dc: target.dc,
        word: target.word,
        what: clip(payload.what, 120),
        rev: revOf(ctx),
        modifiers: [{ source: 'stat', amount: statModifier(actor, stat), reason: stat }],
    };
    checks.pending.push(check);
    return {
        summary: `${actor.name} must check ${attemptText(check)} against ${dcText(check)}: ${modifierList(check.modifiers)} so far, waiting for the roll.`,
        data: { check: check.id, actor: actor.id, skill, stat, dc: check.dc, modifiers: copy(check.modifiers) },
        narrate: false,
    };
}

/** `? check stealth — slipping past the guard | dc: hard | who: Ren` → a pending check. */
function applyCheck(ctx, line) {
    const labels = {};
    for (const [key, value] of Object.entries(line?.labels ?? {})) labels[nameKey(key)] = String(value ?? '').trim();
    return openCheck(ctx, {
        who: labels.who ?? labels.by ?? null,
        skill: line?.name ?? '',
        stat: labels.stat ?? null,
        dc: labels.dc ?? '',
        what: line?.text ?? '',
    });
}

// ---------------------------------------------------------------------------------------
// Modifiers

/**
 * The name a reader's modifier stands for, checked against what the member has: a skill they
 * know, an ability their record keeps, an item they or the party carry. A custom one is the
 * reader's own reason.
 */
function sourceName(ctx, actor, payload) {
    const written = String(payload.name ?? payload.reason ?? '').trim();
    if (payload.source === 'custom') {
        const reason = clip(payload.reason ?? payload.name, 60);
        return reason || fail(ctx, 'INVALID', 'A custom modifier needs a reason.');
    }
    if (payload.source === 'skill') {
        if (!written) fail(ctx, 'INVALID', 'Name the skill.');
        const skill = (actor.skills ?? []).find(entry => nameKey(entry.name) === nameKey(written));
        return skill?.name ?? fail(ctx, 'REFUSED', `${actor.name} does not know ${clip(written, 40)}.`);
    }
    if (payload.source === 'ability') {
        if (!written) fail(ctx, 'INVALID', 'Name the ability.');
        const ability = abilitiesOf(actor).find(name => nameKey(name) === nameKey(written));
        return ability ?? fail(ctx, 'REFUSED', `${actor.name} has no ability called ${clip(written, 40)}.`);
    }
    const items = carriedBy((name, args) => ask(ctx, name, args), actor.id);
    const byStack = payload.stack ? items.find(item => item.stack === payload.stack) : null;
    if (payload.stack && !byStack) fail(ctx, 'REFUSED', `${actor.name} does not carry that item.`);
    if (byStack) return clip(byStack.name, 60);
    if (!written) fail(ctx, 'INVALID', 'Name the item.');
    const item = items.find(entry => nameKey(entry.name) === nameKey(written));
    return item ? clip(item.name, 60) : fail(ctx, 'REFUSED', `${actor.name} does not carry ${clip(written, 40)}.`);
}

/**
 * check.addModifier { id, source: 'skill'|'ability'|'item'|'custom', amount (−10…+10, not 0),
 * reason, name?, stack? }: the reader adds something that fits. `reason` (or `name`) names the
 * skill, ability or item; an item may be given by its `stack` instead. The same thing counts once.
 */
function addModifier(ctx, payload = {}) {
    const checks = ctx.draft('checks');
    const check = pendingOf(ctx, checks, payload.id);
    if (payload.source === 'stat') fail(ctx, 'REFUSED', 'The stat is added by itself.');
    if (!READER_SOURCES.includes(payload.source)) fail(ctx, 'INVALID', 'A modifier comes from a skill, an ability, an item or a custom reason.');
    const amount = payload.amount;
    if (!Number.isInteger(amount) || amount < MOD_MIN || amount > MOD_MAX) fail(ctx, 'INVALID', `A modifier is a whole number from ${MOD_MIN} to +${MOD_MAX}.`);
    if (amount === 0) fail(ctx, 'INVALID', 'A modifier of 0 changes nothing.');
    const actor = ask(ctx, 'party.actor', { id: check.actor }) ?? fail(ctx, 'NOT_FOUND', 'The person making this check is no longer in the party.');
    const reason = sourceName(ctx, actor, payload);
    if (check.modifiers.some(entry => entry.source === payload.source && nameKey(entry.reason) === nameKey(reason))) {
        fail(ctx, 'REFUSED', `${reason} already counts for this check.`);
    }
    if (check.modifiers.filter(entry => entry.source !== 'stat').length >= MAX_EXTRA) fail(ctx, 'REFUSED', `A check takes at most ${MAX_EXTRA} added modifiers.`);
    const modifier = { source: payload.source, amount, reason };
    check.modifiers.push(modifier);
    return {
        summary: `${reason} ${short(amount)} on ${actor.name}'s ${attemptText(check)} check (now ${signed(sumOf(check.modifiers))}).`,
        data: { check: check.id, modifier: copy(modifier), modifiers: copy(check.modifiers) },
        narrate: false,
    };
}

/**
 * check.removeModifier { id, index } or { id, source, reason }: takes back a modifier the reader
 * added. The automatic stat modifier stays.
 */
function removeModifier(ctx, payload = {}) {
    const checks = ctx.draft('checks');
    const check = pendingOf(ctx, checks, payload.id);
    let index = -1;
    if (payload.index !== undefined && payload.index !== null) {
        if (!Number.isInteger(payload.index)) fail(ctx, 'INVALID', 'The modifier is given by its place in the list.');
        index = payload.index;
    } else {
        index = check.modifiers.findIndex(entry => entry.source === payload.source && nameKey(entry.reason) === nameKey(payload.reason));
    }
    const modifier = check.modifiers[index];
    if (!modifier) fail(ctx, 'NOT_FOUND', 'That modifier is not on this check.');
    if (modifier.source === 'stat') fail(ctx, 'REFUSED', 'The stat counts for every check.');
    check.modifiers.splice(index, 1);
    return {
        summary: `${modifier.reason} no longer counts for the ${attemptText(check)} check (now ${signed(sumOf(check.modifiers))}).`,
        data: { check: check.id, removed: copy(modifier), modifiers: copy(check.modifiers) },
        narrate: false,
    };
}

// ---------------------------------------------------------------------------------------
// Rolling and calling off

/** The d20 from the receipt's dice (ctx.roll, else ctx.rng). */
function d20(ctx) {
    const rolled = typeof ctx.roll === 'function' ? ctx.roll('1d20') : null;
    const value = typeof rolled === 'number' ? rolled : rolled?.dice?.[0] ?? rolled?.total;
    if (Number.isInteger(value) && value >= 1 && value <= 20) return value;
    return Math.floor(ctx.rng() * 20) + 1;
}

/**
 * check.roll { id }: d20 + the check's modifiers against its difficulty (a natural 20 a critical
 * success, a natural 1 a critical fail, total ≥ DC a success, DC−1 or DC−2 a success at a cost,
 * lower a fail). The check leaves the waiting list for the log (last 30); the summary carries the
 * numbers and is narrated by the next reply.
 */
function rollCheck(ctx, payload = {}) {
    const checks = ctx.draft('checks');
    const check = pendingOf(ctx, checks, payload.id);
    const actor = ask(ctx, 'party.actor', { id: check.actor }) ?? fail(ctx, 'NOT_FOUND', 'The person making this check is no longer in the party.');
    const die = d20(ctx);
    const mod = sumOf(check.modifiers);
    const total = die + mod;
    const outcome = outcomeOf(die, mod, check.dc);
    const parts = check.modifiers.map(entry => `${signed(entry.amount)} ${entry.reason}`).join(' ');
    const summary = `${actor.name} tries ${attemptText(check)}: d20 ${die}${parts ? ` ${parts}` : ''} = ${total} against ${dcText(check)}, ${OUTCOMES[outcome]}.`;
    checks.pending = checks.pending.filter(entry => entry.id !== check.id);
    const entry = { ...check, rev: revOf(ctx), die, mod, total, outcome };
    checks.log = [...checks.log, entry].slice(-MAX_LOG);
    return {
        summary,
        data: { check: check.id, actor: actor.id, skill: check.skill, stat: check.stat, die, mod, total, dc: check.dc, outcome, modifiers: copy(check.modifiers) },
        narrate: true,
    };
}

/** check.cancel { id }: the reader calls a waiting check off; the next reply hears it was not tried. */
function cancelCheck(ctx, payload = {}) {
    const checks = ctx.draft('checks');
    const check = pendingOf(ctx, checks, payload.id);
    checks.pending = checks.pending.filter(entry => entry.id !== check.id);
    const name = ask(ctx, 'party.actor', { id: check.actor })?.name ?? 'Nobody';
    return {
        summary: `${name} does not try ${attemptText(check)} after all.`,
        data: { check: check.id, actor: check.actor },
        narrate: true,
    };
}

export const handlers = { openCheck, applyCheck, addModifier, removeModifier, rollCheck, cancelCheck };

export const commands = {
    'check.open': openCheck,
    'check.addModifier': addModifier,
    'check.removeModifier': removeModifier,
    'check.roll': rollCheck,
    'check.cancel': cancelCheck,
};

export const GRAMMAR = '? check <skill or stat> — what is attempted | dc: easy|normal|hard|<number> | who: Name';

export const kinds = {
    check: { grammar: GRAMMAR, apply: applyCheck },
};
