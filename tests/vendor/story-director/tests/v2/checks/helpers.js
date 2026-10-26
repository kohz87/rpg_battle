// A command context for the checks part (SPEC §3.2) in outline: the handler runs on drafts, the drafts are diffed with Story Block's own
// ops.js (vendored), the validators run, claims are a real set (a second claim of a key is false), `roll` is the host's seeded die, and the
// queries other modules answer (rules.sheet, rules.modifier, npc.identity, npc.socialModifier, story.evidence) are given by the test.
import { checkKind, part } from '../../../src/v2/checks/index.js';
import { apply, checkOps, diff } from '../../vendor/story-block/src/v2/ops.js';
import { projection } from '../../../src/v2/checks/domain.js';

export function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

function sfc32(seed) {
    let a = 0x9e3779b9;
    let b = 0x243f6a88;
    let c = 0xb7e15162;
    let d = seed >>> 0;
    return () => {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        const t = (a + b | 0) + d | 0;
        d = d + 1 | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = c << 21 | c >>> 11;
        c = c + t | 0;
        return (t >>> 0) / 4294967296;
    };
}

export class Rejected extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export const makeState = () => deepFreeze({ v: 2, meta: { rev: 0, claims: {} }, domains: { checks: part.domains.checks.initial() } });

/**
 * Runs `type` on `state`: `{ ok, state, result, ops }` or `{ ok: false, code, message, state }`. Options: `cause` ('ui' | 'capture' | 'system'),
 * `caller` (a module id), `settings`, `queries` (a map of name -> (args) => answer, or a function that throws), `source`, `die`
 * (the d20 the host rolls), `seed`.
 */
export function run(state, type, payload, options = {}) {
    return execute(state, payload, options, ctx => (type === 'check' ? checkKind.apply(ctx, payload) : part.commands[type](ctx, deepFreeze(structuredClone(payload)))));
}

function execute(state, payload, { cause = 'ui', caller = null, settings = {}, queries = {}, source = null, die = 10, seed = 7 } = {}, handler) {
    const rev = state.meta.rev + 1;
    const drafts = {};
    const random = sfc32(seed + rev);
    const claims = { ...state.meta.claims };
    const ctx = {
        rev, cause, caller, source,
        receiptId: `rc_test${String(rev).padStart(4, '0')}`,
        read: domain => deepFreeze(structuredClone(drafts[domain] ?? state.domains[domain])),
        draft: domain => { drafts[domain] ??= structuredClone(state.domains[domain]); return drafts[domain]; },
        call: (name, args) => {
            if (!part.commands[name]) throw new Rejected('UNKNOWN_COMMAND', `No command ${name} in this test.`);
            return part.commands[name]({ ...ctx, caller: 'story-director' }, deepFreeze(structuredClone(args)));
        },
        claim: key => { if (Object.hasOwn(claims, key)) return false; claims[key] = true; return true; },
        rng: random,
        roll: () => ({ total: die, dice: [die] }),
        settings: () => structuredClone(settings),
        time: () => null,
        fail: (code, message) => { throw new Rejected(code, message); },
        query: (name, args) => {
            if (name === 'checks.policy') return projection(drafts.checks ?? state.domains.checks, settings);
            if (!Object.hasOwn(queries, name)) throw new Rejected('NOT_FOUND', `There is no query called "${name}".`);
            const answer = queries[name];
            return typeof answer === 'function' ? deepFreeze(structuredClone(answer(args))) : answer;
        },
    };
    let result;
    try {
        result = handler(ctx);
    } catch (error) {
        return { ok: false, code: error.code ?? 'FAILED', message: error.message, state };
    }
    for (const [domain, draft] of Object.entries(drafts)) {
        const errors = part.domains[domain]?.validate(draft, state) ?? [];
        if (errors.length) return { ok: false, code: 'INVALID', message: errors.join(' '), state };
    }
    const next = { ...state, meta: { rev, claims }, domains: { ...state.domains, ...structuredClone(drafts) } };
    const ops = diff(state, next);
    const problems = checkOps(ops, state);
    if (problems.length) return { ok: false, code: 'INVALID', message: problems.join(' '), state };
    return { ok: true, state: deepFreeze(next), result, ops };
}

/** The policy hash of a state under settings. */
export const hashOf = (state, settings = {}) => projection(state.domains.checks, settings).hash;
export const replay = (initial, runs) => runs.reduce((state, one) => apply(state, one.ops), initial);
let writes = 0;
export const write = () => `wr_${(writes += 1).toString(36).padStart(8, '0')}`;

import { PARTS, createModule } from '../../../src/v2/module.js';

/**
 * Story Director's module with the checks part registered, as the flip release will register it. The module as shipped does not register it
 * (RPG Battle's checks part owns the `checks` domain, the `check` kind and `checks.*` until the flip retires it).
 */
export const moduleWithChecks = (options = {}) => createModule(options);

/** The module as the flip release leaves it: the checks part registered with the `check` kind (contract P09: capture.check is Story Director's). */
export const moduleAfterFlip = (options = {}) => createModule(options);
