// A fake of Story Block's command bus for the combat part's tests (SPEC §3.2, MODULES §A): a
// State with a history of committed states, handlers run on a draft copy with a ctx offering
// read, draft (own domains only), call, query, claim, rng, roll, settings, time, fail and
// receiptId. A rejection keeps nothing. The other agents' commands and queries (party, items,
// inventory, wallet) are faked here with the MODULES §B1/§B2 and SPEC §7 shapes.

import { makeRng } from '../../../../src/rng.js';
import { combatNumbers } from '../../../../src/party.js';
import { part } from '../../../../src/v2/combat/index.js';

const RECORD_ID = /^[a-z][a-z0-9]*_[0-9a-z]{8}$/;
const DEF_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const ID_KEY = /^(?:id|.+Id|.+_id)$/;

export function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
}

/** Story Block's generic rules (SPEC §2.5) over a whole value: plain JSON, qty whole, ids well-formed. */
export function genericProblems(value, path = '', key = '') {
    const out = [];
    if (value === undefined) return [`${path} is undefined`];
    if (typeof value === 'number' && !Number.isFinite(value)) out.push(`${path} is not finite`);
    if (typeof value === 'function') out.push(`${path} is a function`);
    if (key === 'qty' && !(Number.isInteger(value) && value >= 0)) out.push(`${path}: qty ${JSON.stringify(value)}`);
    if (ID_KEY.test(key)) {
        const ok = key === 'id' ? typeof value === 'string' && (RECORD_ID.test(value) || DEF_ID.test(value)) : value === null || (typeof value === 'string' && (RECORD_ID.test(value) || DEF_ID.test(value)));
        if (!ok) out.push(`${path}: ${key} ${JSON.stringify(value)}`);
    }
    if (Array.isArray(value)) value.forEach((item, i) => out.push(...genericProblems(item, `${path}/${i}`, String(i))));
    else if (value && typeof value === 'object') for (const k of Object.keys(value)) out.push(...genericProblems(value[k], `${path}/${k}`, k));
    return out;
}

class Fail extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

// --- the other agents' parts, faked -----------------------------------------------------------

export const ac = n => `ac_${String(n).padStart(8, '0')}`;
export const it = n => `it_${String(n).padStart(8, '0')}`;

export function actor(n, over = {}) {
    return {
        id: ac(n), name: n === 1 ? 'Ren' : `Ally ${n}`, kind: n === 1 ? 'pc' : 'companion', control: n === 1 ? 'player' : 'auto', role: '',
        level: 3, xp: 0, points: 0,
        hp: { cur: 80, max: 80 }, mp: { cur: 30, max: 30 }, sp: { cur: 30, max: 30 },
        stats: { STR: 9, VIT: 8, AGI: 8, DEX: 8, INT: 6, LUK: 5, CHA: 6 },
        skills: [{ name: 'Power Strike', level: 1, uses: 0, active: true }],
        conditions: [], npc: null,
        ...over,
    };
}

export function baseDomains({ actors = [actor(1)], stacks = {}, defs = {}, place = 'Bluewatch Village' } = {}) {
    return {
        scene: { place: { name: place, kind: 'settlement', region: '' }, present: [] },
        inventory: { defs, stacks, wallets: {}, aliases: {} },
        party: { pc: actors[0]?.id ?? null, order: actors.map(a => a.id), actors: Object.fromEntries(actors.map(a => [a.id, a])), custom: {} },
        combat: part.domains.combat.initial(),
        bestiary: part.domains.bestiary.initial(),
    };
}

// MODULES §F5: inventory.items({ owner? }) → [{ stack, def, name, kind, qty, owner, equipped, note }].
const stackRow = (inv, s) => ({ stack: s.id, def: s.def, name: inv.defs[s.def].name, kind: inv.defs[s.def].kind, qty: s.qty, owner: s.owner, equipped: s.equipped, note: s.note });

const FAKE_QUERIES = {
    'party.actors': state => state.domains.party.order.map(id => structuredClone(state.domains.party.actors[id])),
    'party.combatNumbers': (state, { id }) => {
        const a = state.domains.party.actors[id];
        if (!a) return null;
        const gear = FAKE_QUERIES['items.gear'](state, { actor: id }).map(row => ({ ...row, equipped: true }));
        return combatNumbers({ name: a.name, level: a.level, stats: a.stats, hp: a.hp, mp: a.mp, sp: a.sp, skills: [], conditions: [] }, { gear });
    },
    // Equipped stacks with their def's numbers (MODULES §B2 `items.gear`).
    'items.gear': (state, { actor: owner }) => {
        const inv = state.domains.inventory;
        return Object.values(inv.stacks).filter(s => s.owner === owner && s.equipped).map(s => ({ stack: s.id, name: inv.defs[s.def].name, slot: s.equipped, stats: { ...inv.defs[s.def].stats }, rarity: inv.defs[s.def].rarity, tags: [...inv.defs[s.def].tags] }));
    },
    'inventory.items': (state, { owner } = {}) => Object.values(state.domains.inventory.stacks).filter(s => owner === undefined || s.owner === owner).map(s => stackRow(state.domains.inventory, s)),
};

function fakeCommands(world) {
    return {
        'party.applyResult'(ctx, payload) {
            const party = ctx.draft('party');
            for (const entry of payload.actors) {
                const a = party.actors[entry.id];
                if (!a) continue;
                a.hp.cur = Math.min(a.hp.max, entry.hp.cur);
                a.mp.cur = Math.min(a.mp.max, entry.mp.cur);
                if (entry.sp) a.sp.cur = Math.min(a.sp.max, entry.sp.cur);
            }
            return { summary: '' };
        },
        // MODULES §B1 party.fightPools: HP, MP, SP as the running fight has them.
        'party.fightPools'(ctx, { actors }) {
            const party = ctx.draft('party');
            for (const entry of actors) {
                const a = party.actors[entry.id];
                if (!a) continue;
                for (const key of ['hp', 'mp', 'sp']) if (entry[key] !== undefined) a[key].cur = Math.min(a[key].max, entry[key]);
            }
            return { summary: '' };
        },
        'party.grantXp'(ctx, { actor: id, amount }) {
            ctx.draft('party').actors[id].xp += amount;
            return { summary: '' };
        },
        // MODULES §F5: inventory.grant { def | defId, qty, owner, note? }.
        'inventory.grant'(ctx, { def, defId, qty, owner, note = '' }) {
            const inv = ctx.draft('inventory');
            const id = def?.id ?? defId;
            if (!inv.defs[id]) {
                if (!def) ctx.fail('NOT_FOUND', `No item ${id}.`);
                inv.defs[id] = structuredClone(def);
            }
            const stack = it(100 + Object.keys(inv.stacks).length);
            inv.stacks[stack] = { id: stack, def: id, qty, owner, equipped: null, note, from: ctx.receiptId };
            return { summary: '' };
        },
        'inventory.consume'(ctx, { stack, qty }) {
            const inv = ctx.draft('inventory');
            const s = inv.stacks[stack];
            if (!s || s.qty < qty) ctx.fail('NOT_ENOUGH', 'Not enough left.');
            s.qty -= qty;
            if (!s.qty) delete inv.stacks[stack];
            return { summary: '' };
        },
        'wallet.receive'(ctx, { owner, amount }) {
            const inv = ctx.draft('inventory');
            inv.wallets[owner] ??= {};
            inv.wallets[owner].copper = (inv.wallets[owner].copper ?? 0) + amount;
            return { summary: '' };
        },
        ...world.extraCommands,
    };
}

const OWNERS = { combat: 'rpg-battle', bestiary: 'rpg-battle', party: 'rpg-battle', inventory: 'story-block', scene: 'story-block' };
const moduleOf = type => (/^(?:inventory|wallet)\./.test(type) ? 'story-block' : 'rpg-battle');

/**
 * A world: { state, history, receipts, calls, run(type, payload, { seed, cause }), capture(line, opts),
 * query(name, args, state?) }. `settings` are the module's settings; `seed` the first receipt seed.
 */
export function createWorld({ domains = baseDomains(), settings = {}, seed = 1, extraCommands = {}, extraQueries = {}, checkGeneric = true } = {}) {
    const world = {
        state: deepFreeze({ v: 2, meta: { rev: 0, claims: {} }, domains: structuredClone(domains) }),
        history: [],
        receipts: [],
        calls: [],
        nextSeed: seed,
        extraCommands,
    };
    world.history.push(world.state);
    const commands = { ...part.commands, ...fakeCommands(world) };
    const queries = { ...part.queries, ...FAKE_QUERIES, ...extraQueries };

    // Queries are called (state, args, tools) with tools.query over the same state (MODULES §F3).
    const runQuery = (name, state, args) => {
        if (!queries[name]) throw new Fail('NOT_FOUND', `No query ${name}.`);
        const frozen = deepFreeze(structuredClone(state));
        const tools = { query: (other, more) => runQuery(other, frozen, more) };
        return queries[name](frozen, args, tools);
    };
    world.query = (name, args, state = world.state) => runQuery(name, state, args);

    function makeCtx(draft, type, receiptId, rng, calls) {
        const owner = moduleOf(type);
        const ctx = {
            receiptId,
            rev: draft.meta.rev + 1,
            read: domain => deepFreeze(structuredClone(draft.domains[domain])),
            draft: domain => {
                if (OWNERS[domain] !== owner) throw new Fail('NOT_OWNER', `${type} may not write ${domain}.`);
                return draft.domains[domain];
            },
            call: (sub, payload) => {
                if (!commands[sub]) throw new Fail('UNKNOWN_COMMAND', `No command ${sub}.`);
                calls.push({ type: sub, payload: structuredClone(payload) });
                return commands[sub](makeCtx(draft, sub, receiptId, rng, calls), payload);
            },
            query: (name, args) => runQuery(name, draft, args),
            claim: key => {
                if (draft.meta.claims[key]) return false;
                draft.meta.claims[key] = true;
                return true;
            },
            rng: () => rng.next(),
            roll: () => { throw new Error('not used'); },
            settings: () => ({ ...part.settings.defaults, ...settings }),
            time: () => null,
            fail: (code, message) => { throw new Fail(code, message); },
        };
        return ctx;
    }

    /** One command as the bus runs it; on any throw nothing is kept. `on` runs it on an older state. */
    world.run = (type, payload = {}, { seed: s, cause = 'ui', on } = {}) => {
        const handler = commands[type];
        const base = on ?? world.state;
        if (!handler) return { ok: false, code: 'UNKNOWN_COMMAND', message: type };
        const receiptSeed = s ?? world.nextSeed++;
        const draft = structuredClone(base);
        const receiptId = `rc_${String(world.receipts.length + 1).padStart(8, '0')}`;
        const calls = [];
        let out;
        try {
            out = handler(makeCtx(draft, type, receiptId, makeRng(receiptSeed), calls), payload);
        } catch (error) {
            if (!(error instanceof Fail)) return { ok: false, code: 'FAILED', message: error.message, error };
            return { ok: false, code: error.code, message: error.message };
        }
        const errors = [
            ...part.domains.combat.validate(draft.domains.combat, draft),
            ...part.domains.bestiary.validate(draft.domains.bestiary, draft),
            ...(checkGeneric ? genericProblems(draft.domains) : []),
        ];
        if (errors.length) return { ok: false, code: 'INVALID', message: errors.join(' ') };
        draft.meta.rev += 1;
        const receipt = { id: receiptId, type, cause, seed: receiptSeed, summary: out?.summary ?? '', narrate: Boolean(out?.narrate), data: out?.data ?? {}, rev: draft.meta.rev };
        if (!on) {
            world.state = deepFreeze(draft);
            world.history.push(world.state);
            world.receipts.push(receipt);
            world.calls.push(...calls.map(call => ({ ...call, receipt: receiptId })));
        }
        return { ok: true, receipt, state: deepFreeze(draft), calls };
    };

    /** A captured change line, run as a `story` command (SPEC §4.2). */
    world.capture = (l, opts = {}) => {
        const kind = part.kinds[l.kind];
        if (!kind) return { ok: false, code: 'UNKNOWN_KIND', message: l.kind };
        commands.capture = (ctx, payload) => kind.apply(ctx, payload);
        try {
            return world.run('capture', l, { cause: 'story', ...opts });
        } finally {
            delete commands.capture;
        }
    };
    return world;
}

/** A change line as Story Block's parser hands it over. */
export function line(op, kind, name, text = '', labels = {}) {
    return { op, kind, name, text, labels, raw: '', index: 0 };
}
