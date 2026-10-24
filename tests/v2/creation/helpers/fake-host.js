// A small stand-in for Story Block's command bus (SPEC §3, MODULES §A) for the creation part's
// tests: the creation and party parts' commands and queries (as the coordinator's module.js
// merges them), an optional packs.content query, a ctx with read / draft (own module's domains)
// / call / claim / rng (sfc32 from the seed) / settings / fail / query (with tools, MODULES §F3),
// and command, preview and commit with Story Block's rules: the handler works on a copy, the
// touched domains' validators run, any throw or failed call rejects everything, and a commit
// whose head changed since the preview is STALE.
//
// `party: 'origin'` replaces party.create with the version this part asks the party part for
// (src/v2/creation/index.js): with `origin`, the final stats come from `creation.build`, and a
// `background` is kept. `party: 'real'` is the party part as it is; `'plain'` one that ignores both.

import { part as creation } from '../../../../src/v2/creation/index.js';
import { part as party } from '../../../../src/v2/party/index.js';
import { DEFAULT_RULES, STATS, makeRules, maxHp, maxMp, maxSp } from '../../../../src/rules.js';

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

export class Rejection extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const clone = value => structuredClone(value);
function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

export function makeState() {
    return {
        v: 2,
        meta: { rev: 0, claims: {} },
        domains: {
            party: party.domains.party.initial(),
            creation: creation.domains.creation.initial(),
            inventory: { defs: {}, stacks: {}, wallets: {}, aliases: {} },
        },
    };
}

/**
 * The party.create this part asks for: with `origin`, the checked result of creation.build; the
 * real party.create makes the sheet (any points that pass v1 newSheet), then the actor gets the
 * final stats, HP/MP/SP from them, and its origin.
 */
export function originCreate(realCreate) {
    const keepBackground = (ctx, payload) => {
        if (!payload.background) return;
        const draft = ctx.draft('party');
        draft.actors[draft.pc].background = String(payload.background).slice(0, 2000);
    };
    return (ctx, payload = {}) => {
        if (!payload.origin) {
            const out = realCreate(ctx, payload);
            keepBackground(ctx, payload);
            return out;
        }
        const settings = ctx.settings();
        const built = ctx.query('creation.build', { race: payload.origin.race ?? '', talents: payload.origin.talents ?? [], points: payload.points, settings });
        if (!built.ok) ctx.fail(built.code, built.message);
        const startPoints = Number.isInteger(settings.startPoints) ? settings.startPoints : DEFAULT_RULES.character.startPoints;
        const filler = Object.fromEntries(STATS.map(stat => [stat, 0]));
        for (let i = 0; i < startPoints; i++) filler[STATS[i % STATS.length]] += 1;
        const out = realCreate(ctx, { ...payload, origin: undefined, points: filler });
        const draft = ctx.draft('party');
        const actor = draft.actors[draft.pc];
        const rules = makeRules({ character: { startPoints, statCap: settings.statCap ?? DEFAULT_RULES.character.statCap } });
        actor.stats = { ...built.stats };
        for (const [key, fn] of [['hp', maxHp], ['mp', maxMp], ['sp', maxSp]]) {
            const max = fn(actor.stats, 1, rules);
            actor[key] = { cur: max, max };
        }
        actor.origin = built.origin;
        keepBackground(ctx, payload);
        return out;
    };
}

/**
 * host({ settings, packs: { races, talents } | null, party: 'real' | 'origin' }) →
 * { state, command, preview, commit, query, log }
 */
export function makeHost({ settings = {}, packs = null, party: partyMode = 'origin', state = makeState() } = {}) {
    const commands = { ...party.commands, ...creation.commands };
    if (partyMode === 'origin') commands['party.create'] = originCreate(party.commands['party.create']);
    // A party.create that takes neither origin nor background (the party part before this part's ask).
    if (partyMode === 'plain') commands['party.create'] = (ctx, payload) => party.commands['party.create'](ctx, { ...payload, origin: undefined, background: undefined });
    const queries = { ...party.queries, ...creation.queries };
    if (packs) queries['packs.content'] = (_state, args) => clone(packs[args?.kind] ?? []);
    const owned = ['party', 'creation'];
    const domains = { ...party.domains, ...creation.domains };
    const moduleSettings = { ...creation.settings.defaults, ...settings };
    const host = { state, log: [] };
    let previews = new Map();
    let counter = 0;

    const runQuery = (current, name, args) => {
        const fn = queries[name];
        if (!fn) throw new Rejection('NOT_FOUND', `There is no query called "${name}".`);
        const tools = { query: (other, otherArgs) => runQuery(current, other, otherArgs) };
        return clone(fn(deepFreeze(clone(current)), args === undefined ? undefined : clone(args), tools));
    };

    function transact(head, type, payload, seed) {
        const working = clone(head);
        const touched = new Set();
        const rng = sfc32(seed);
        let failure = null;
        const ctx = {
            receiptId: `rc_${String(++counter).padStart(8, '0')}`,
            cause: 'ui',
            read: domain => deepFreeze(clone(working.domains[domain] ?? null)),
            draft: domain => {
                if (!owned.includes(domain)) throw new Rejection('NOT_OWNER', `rpg-battle cannot change ${domain}.`);
                touched.add(domain);
                return working.domains[domain];
            },
            call: (other, otherPayload) => {
                const handler = commands[other];
                if (!handler) throw new Rejection('UNKNOWN_COMMAND', `There is no command "${other}".`);
                try {
                    return handler(ctx, deepFreeze(clone(otherPayload)));
                } catch (error) {
                    failure ??= error;
                    throw error;
                }
            },
            claim: key => {
                if (working.meta.claims[key]) return false;
                working.meta.claims[key] = true;
                return true;
            },
            rng,
            roll: () => ({ total: Math.floor(rng() * 20) + 1, dice: [] }),
            settings: () => deepFreeze(clone(moduleSettings)),
            time: () => null,
            fail: (code, message) => { throw new Rejection(code, message); },
            query: (name, args) => runQuery(working, name, args),
        };
        try {
            const handler = commands[type];
            if (!handler) throw new Rejection('UNKNOWN_COMMAND', `There is no command "${type}".`);
            const result = handler(ctx, deepFreeze(clone(payload)));
            if (failure) throw failure;
            for (const domain of touched) {
                const errors = domains[domain].validate(working.domains[domain], working);
                if (errors.length) throw new Rejection('INVALID', errors.join(' '));
            }
            working.meta.rev += 1;
            const receipt = { id: ctx.receiptId, type, seed, summary: result?.summary ?? '', data: result?.data ?? {}, narrate: result?.narrate ?? false };
            return { ok: true, state: working, receipt };
        } catch (error) {
            return { ok: false, code: error.code ?? 'FAILED', message: error.message };
        }
    }

    host.command = (type, payload, { seed = 7 } = {}) => {
        const before = JSON.stringify(host.state);
        const out = transact(host.state, type, payload, seed);
        if (JSON.stringify(host.state) !== before) throw new Error('the head state was changed in place');
        if (out.ok) host.state = out.state;
        host.log.push({ type, ok: out.ok });
        return out.ok ? { ok: true, receipt: out.receipt } : out;
    };
    host.preview = (type, payload, { seed = 11 } = {}) => {
        const out = transact(host.state, type, payload, seed);
        if (!out.ok) return out;
        const token = `pv_${previews.size + 1}_${counter}`;
        previews.set(token, { out, seen: JSON.stringify(host.state) });
        return { ok: true, receipt: out.receipt, token };
    };
    host.commit = token => {
        const saved = previews.get(token);
        if (!saved) return { ok: false, code: 'NOT_FOUND', message: 'That preview is gone.' };
        previews.delete(token);
        if (saved.seen !== JSON.stringify(host.state)) return { ok: false, code: 'STALE', message: 'The story changed since this preview.' };
        host.state = saved.out.state;
        return { ok: true, receipt: saved.out.receipt };
    };
    host.query = (name, args) => runQuery(host.state, name, args);
    host.reset = () => { previews = new Map(); };
    return host;
}

export const pcOf = state => state.domains.party.actors[state.domains.party.pc] ?? null;
export const points = (map = {}) => Object.fromEntries(STATS.map(stat => [stat, map[stat] ?? 0]));
