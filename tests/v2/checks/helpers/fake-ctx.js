// A fake command context for the checks part's tests (SPEC §3.2, MODULES §A): read, draft (own
// domains only), call, claim, rng (sfc32 from the receipt's seed), roll, settings, time, fail,
// receiptId, rev, cause, carrier (a capture's reply, { index, swipe, key }) and query. The queries
// are the checks part's, the party part's, a small `inventory.items` shaped as Story Block's
// (MODULES §F5) and any extra ones a test gives (`queries`, e.g. creation.content). `run` plays Story Block's commit step
// in miniature: the handler works on a copy, the touched domains' validators run, and a throw or
// a validator error rejects the whole command, leaving the state passed in exactly as it was.

import { part } from '../../../../src/v2/checks/index.js';
import { part as party } from '../../../../src/v2/party/index.js';
import { logEntries, preparedEntries } from '../../../../src/v2/checks/shared.js';

export function sfc32(seed) {
    let a = 0x9e3779b9;
    let b = 0x243f6a88;
    let c = 0xb7e15162;
    let d = seed >>> 0;
    const next = () => {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        const t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        const out = (t + d) | 0;
        c = (c + out) | 0;
        return (out >>> 0) / 4294967296;
    };
    for (let i = 0; i < 12; i++) next();
    return next;
}

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

const clone = value => structuredClone(value);

export class Rejection extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/** Story Block's inventory.items in miniature: [{ stack, def, name, kind, qty, owner, equipped, note }]. */
function inventoryItems(state, args = {}) {
    const inv = state?.domains?.inventory ?? {};
    return Object.values(inv.stacks ?? {})
        .filter(stack => inv.defs?.[stack.def] && (!args?.owner || stack.owner === args.owner))
        .map(stack => ({ stack: stack.id, def: stack.def, name: inv.defs[stack.def].name, kind: inv.defs[stack.def].kind, qty: stack.qty, owner: stack.owner, equipped: stack.equipped ?? null, note: stack.note ?? '' }));
}

export const allQueries = { ...party.queries, ...part.queries, 'inventory.items': inventoryItems };
const validators = { party: party.domains.party.validate, checks: part.domains.checks.validate };
const allCommands = { ...party.commands, ...part.commands };

/** The query tools a host passes a query (MODULES §F3); `extra` adds or replaces queries. */
export const toolsFor = (state, extra = {}) => ({ query: (name, args) => {
    const fn = extra[name] ?? allQueries[name];
    if (!fn) throw new Rejection('NOT_FOUND', `No query ${name}.`);
    return clone(fn(state, args, toolsFor(state, extra)));
} });

/** A view as Story Block hands one to a tail or a hook: { state, query, settings, chat }. */
export const viewOf = (state, { queries = {}, chat = { length: 3, lastUser: '' }, settings = {} } = {}) => ({
    state, query: toolsFor(state, queries).query, settings: () => settings, chat,
});

/** A state with party (from its initial unless given), checks and an empty inventory. */
export function makeState(domains = {}) {
    return {
        v: 2,
        meta: { rev: 0, claims: {} },
        domains: {
            party: party.domains.party.initial(),
            checks: part.domains.checks.initial(),
            inventory: { defs: {}, stacks: {}, wallets: {}, aliases: {} },
            ...clone(domains),
        },
    };
}

export function makeCtx(working, { seed = 1, settings = {}, own = ['checks'], rev = null, dice = null, cause = 'story', carrier = null, queries = {} } = {}) {
    const rng = sfc32(seed);
    const touched = new Set();
    const forced = dice ? [...dice] : null;
    const ctx = {
        receiptId: 'rc_test0001',
        rev: rev ?? working.meta.rev + 1,
        cause,
        carrier: carrier ? { swipe: 0, ...carrier, key: `${carrier.index}:${carrier.swipe ?? 0}` } : null,
        touched,
        read: domain => deepFreeze(clone(working.domains[domain])),
        draft: domain => {
            if (!own.includes(domain)) throw new Rejection('NOT_OWNER', `The checks part does not own ${domain}.`);
            touched.add(domain);
            return working.domains[domain];
        },
        call: (type, payload) => {
            const handler = allCommands[type];
            if (!handler) throw new Rejection('UNKNOWN_COMMAND', `No command ${type}.`);
            return handler(ctx, payload);
        },
        claim: key => {
            if (working.meta.claims[key]) return false;
            working.meta.claims[key] = true;
            return true;
        },
        rng,
        roll: expr => {
            const match = /^(\d*)d(\d+)([+-]\d+)?$/.exec(String(expr).replace(/\s+/g, ''));
            const count = Number(match[1] || 1);
            const dice = Array.from({ length: count }, () => (forced?.length ? forced.shift() : Math.floor(rng() * Number(match[2])) + 1));
            return { total: dice.reduce((sum, die) => sum + die, 0) + Number(match[3] || 0), dice };
        },
        settings: () => clone(settings),
        time: () => null,
        fail: (code, message) => {
            throw new Rejection(code, message);
        },
        query: (name, args) => {
            const fn = queries[name] ?? allQueries[name];
            if (!fn) throw new Rejection('NOT_FOUND', `There is no query called "${name}".`);
            return deepFreeze(clone(fn(working, clone(args ?? {}), toolsFor(working, queries))));
        },
    };
    return ctx;
}

/**
 * Runs `handler(ctx, payload)` on a copy of `state`: { ok: true, state, result, ctx } with the
 * new state, or { ok: false, code, message, state } with the state given back untouched.
 */
export function run(state, handler, payload, options = {}) {
    const before = JSON.stringify(state);
    const working = clone(state);
    const ctx = makeCtx(working, options);
    const fn = typeof handler === 'string' ? allCommands[handler] : handler;
    try {
        const result = fn(ctx, payload);
        for (const domain of ctx.touched) {
            const errors = validators[domain]?.(working.domains[domain], working) ?? [];
            if (errors.length) return { ok: false, code: 'INVALID', message: errors.join(' '), errors, state };
        }
        JSON.stringify(working); // plain JSON only
        working.meta.rev += 1;
        return { ok: true, state: working, result, ctx };
    } catch (error) {
        if (JSON.stringify(state) !== before) throw new Error('the state passed in was changed');
        return { ok: false, code: error.code ?? 'FAILED', message: error.message, state };
    }
}

/** A change line as the host's parser gives it (SPEC §12 parseChanges): `op kind Name[ — text][ | label: value]*`. */
export function line(raw) {
    const [head, ...pairs] = raw.split('|').map(piece => piece.trim());
    const match = /^([+\-~!?])\s+(\w+)\s+(.*)$/.exec(head);
    const [, op, kind, rest] = match;
    const dash = rest.match(/^(.*?)\s+—\s+(.*)$/);
    const labels = {};
    for (const pair of pairs) {
        const at = pair.indexOf(':');
        if (at > 0) labels[pair.slice(0, at).trim().toLowerCase()] = pair.slice(at + 1).trim();
    }
    return { op, kind, name: (dash ? dash[1] : rest).trim(), text: dash ? dash[2].trim() : '', labels, raw, index: 0 };
}

/** Runs a change line through the checks part's kind, as a story command (reply 4 unless `carrier` says). */
export function capture(state, raw, options = {}) {
    const parsed = line(raw);
    return run(state, (ctx, l) => part.kinds[l.kind].apply(ctx, l), parsed, { carrier: { index: 4 }, ...options });
}

/** Commits `checks.prepare { for }` as beforeGenerate would (cause system); `rolls` forces the dice. */
// `table: false` (the default here) makes it an older chat's prepare (no table members: the reply's Roll 1 and
// Roll 2 by place, F80), which these tests were written for; `table: true` keeps the check table's members.
export function prepared(state, index = 4, { rolls = null, seed = 3, table = false } = {}) {
    const out = run(state, 'checks.prepare', { for: index }, { seed, cause: 'system' });
    if (!out.ok) throw new Error(out.message);
    const entry = preparedEntries(out.state.domains.checks).at(-1);
    if (!table) delete entry.actors;
    if (rolls) entry.rolls = [...rolls];
    return out.state;
}

/** Runs a party command (to set the scene up) with the party domain owned. */
export function partyRun(state, type, payload, options = {}) {
    const out = run(state, type, payload, { own: ['party'], ...options });
    if (!out.ok) throw new Error(out.message);
    return out.state;
}

/** Ren (DEX 2 points over the start, so a stealth modifier), with Lyra the archer. */
export function withParty() {
    let state = partyRun(makeState(), 'party.create', { name: 'Ren', points: { STR: 2, VIT: 2, AGI: 2, DEX: 4 } });
    state = partyRun(state, 'party.addCompanion', { name: 'Lyra', role: 'ranger' });
    return state;
}

/** Adds an item def and a stack to the state (as Story Block's inventory keeps them). */
export function withItem(state, { id, name, owner = 'party', kind = 'goods', note = '', tags = [], stack = `it_${id.padEnd(8, '0').slice(0, 8)}` }) {
    const out = clone(state);
    out.domains.inventory.defs[`story/${id}`] = { id: `story/${id}`, name, kind, rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags, note: '' };
    out.domains.inventory.stacks[stack] = { id: stack, def: `story/${id}`, qty: 1, owner, equipped: null, note, from: '' };
    return out;
}

export const pcOf = state => state.domains.party.actors[state.domains.party.pc];
export const byName = (state, name) => Object.values(state.domains.party.actors).find(actor => actor.name === name);
/** The check results kept, oldest first (the log is keyed by check id, B-b1r2-13). */
export const logOf = state => logEntries(state.domains.checks);
