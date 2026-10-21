// A fake command context for the party part's tests (SPEC §3.2, MODULES §A): read, draft (own
// domains only), call, claim, rng (sfc32 from the receipt's seed), roll, settings, time, fail,
// receiptId and query, plus `carrier` (the reply a story line came from) and `rev`. `run` plays
// Story Block's commit step in miniature: the handler works on a copy, the touched domain's
// validator runs, and a throw or a validator error rejects the whole command, leaving the state
// passed in exactly as it was.

import { part } from '../../../../src/v2/party/index.js';

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

/** A state with `domains` (party from part.initial unless given) and meta. */
export function makeState(domains = {}) {
    return {
        v: 2,
        meta: { rev: 0, claims: {} },
        domains: { party: part.domains.party.initial(), inventory: { defs: {}, stacks: {}, wallets: {}, aliases: {} }, ...clone(domains) },
    };
}

export function makeCtx(working, { seed = 1, settings = {}, own = ['party'], carrier = null, rev = 1, extraCommands = {} } = {}) {
    const rng = sfc32(seed);
    const touched = new Set();
    const ctx = {
        receiptId: 'rc_test0001',
        carrier,
        rev,
        touched,
        read: domain => deepFreeze(clone(working.domains[domain])),
        draft: domain => {
            if (!own.includes(domain)) throw new Rejection('NOT_OWNER', `The party part does not own ${domain}.`);
            touched.add(domain);
            return working.domains[domain];
        },
        call: (type, payload) => {
            const handler = part.commands[type] ?? extraCommands[type];
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
            const dice = Array.from({ length: count }, () => Math.floor(rng() * Number(match[2])) + 1);
            return { total: dice.reduce((sum, die) => sum + die, 0) + Number(match[3] || 0), dice };
        },
        settings: () => clone(settings),
        time: () => null,
        fail: (code, message) => {
            throw new Rejection(code, message);
        },
        query: (name, args) => part.queries[name](working, args),
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
    const fn = typeof handler === 'string' ? part.commands[handler] : handler;
    try {
        const result = fn(ctx, payload);
        for (const domain of ctx.touched) {
            const errors = part.domains[domain]?.validate(working.domains[domain], working) ?? [];
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
    const [head, ...pairs] = raw.split('|').map(part => part.trim());
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

/** Runs a change line through its kind's apply, as a story command. */
export function capture(state, raw, options = {}) {
    const parsed = line(raw);
    return run(state, (ctx, l) => part.kinds[l.kind].apply(ctx, l), parsed, options);
}

/** A state with your character made (Fighter preset unless `payload` says otherwise). */
export function withPc(payload = { name: 'Ren', points: { STR: 4, VIT: 3, AGI: 1, DEX: 2 } }, options = {}) {
    const out = run(makeState(), 'party.create', payload, options);
    if (!out.ok) throw new Error(out.message);
    return out.state;
}

export const pcOf = state => state.domains.party.actors[state.domains.party.pc];
export const byName = (state, name) => Object.values(state.domains.party.actors).find(actor => actor.name === name);
