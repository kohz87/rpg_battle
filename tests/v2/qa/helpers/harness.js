// QA harness: RPG Battle's v2 module run through Story Block's REAL command bus and registry,
// with Story Block's core module (scene, inventory, the one currency) registered beside it.
//
// Two hosts (`host` option):
// * 'sb'  — Story Block's `v2` branch, vendored unchanged in ../vendor (see ../vendor/VERSION).
//   Its bus gives handlers no `ctx.caller` (read by inventory.grant) and no `ctx.rev` (MODULES
//   §F2); RPG Battle's module.js works out ctx.rev itself, and with `shim: true` (the default)
//   each handler's ctx also gets `caller` = the module whose handler made the ctx.call (null for
//   a top-level command). `shim: false` runs the bus exactly as vendored (host-gaps.test.js).
// * 'int' — the Story Block runtime RPG Battle's integration vendors (tests/vendor/story-block,
//   Story Block's `v2-int`), whose bus gives ctx.caller, ctx.rev, ctx.id itself; no shim.
// HOSTS lists both; most suites run every test on each (`each`).
//
// The module is the coordinator's src/v2/module.js (`createModule`), the one Story Block
// registers. `mergeParts` (MODULES §A by hand, the four first parts only) is kept for the
// registry test that shows the parts register as written.
//
// Deterministic: receipt ids and seeds come from counters, never crypto. While a harness runs a
// command, `globalThis.StoryBlock.sdk` is a small sdk over it (query, settings), as live, so the
// item.define hook reads the chat's currency.

import { test } from 'node:test';
import * as sbRegistry from '../vendor/src/v2/registry.js';
import * as sbCommands from '../vendor/src/v2/commands.js';
import * as sbOps from '../vendor/src/v2/ops.js';
import * as sbCore from '../vendor/src/v2/domains/index.js';
import * as sbRng from '../vendor/src/v2/rng.js';
import * as intRegistry from '../../../vendor/story-block/src/v2/registry.js';
import * as intCommands from '../../../vendor/story-block/src/v2/commands.js';
import * as intOps from '../../../vendor/story-block/src/v2/ops.js';
import * as intCore from '../../../vendor/story-block/src/v2/domains/index.js';
import { createModule } from '../../../../src/v2/module.js';
import { part as party } from '../../../../src/v2/party/index.js';
import { part as items } from '../../../../src/v2/items/index.js';
import { part as combat } from '../../../../src/v2/combat/index.js';
import { part as trade } from '../../../../src/v2/trade/index.js';
import { sessionOf } from '../../../../src/v2/combat/stored.js';

const { deepFreeze } = sbOps;
const makeRng = sbRng.rng;

export const RB_ID = 'rpg-battle';
export const CORE_ID = 'story-block';
/** MODULES §B order: party, items, combat, trade (the first four parts, for mergeParts). */
export const PARTS = Object.freeze({ party, items, combat, trade });

const RUNTIMES = {
    sb: { registry: sbRegistry, commands: sbCommands, ops: sbOps, core: sbCore },
    int: { registry: intRegistry, commands: intCommands, ops: intOps, core: intCore },
};
export const HOSTS = Object.freeze(['sb', 'int']);

let defaultHost = 'sb';

/**
 * test() once per host: `[sb] name` and `[int] name`. `options` may be a function of the host
 * (a todo on one host only). The body runs with that host as createHarness's default.
 */
export function each(name, options, fn) {
    if (fn === undefined) [fn, options] = [options, {}];
    for (const host of HOSTS) {
        const opts = typeof options === 'function' ? options(host) : options;
        test(`[${host}] ${name}`, opts ?? {}, () => {
            const saved = defaultHost;
            defaultHost = host;
            try { return fn(host); } finally { defaultHost = saved; }
        });
    }
}

/**
 * `each` options for a test that wears something: item.equip is Story Block's `inventory.equipOn` asking this
 * module's `rules.equipPlan` (P07, E4), which the 'sb' host (alpha.2, kept for the older bus) does not have.
 */
export const equipsOnInt = host => (host === 'sb' ? { skip: 'item.equip needs the E4 host (inventory.equipOn with rules.equipPlan); the alpha.2 host has neither' } : {});

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function mergeInto(target, source, what, partName) {
    for (const [key, value] of Object.entries(source ?? {})) {
        if (Object.hasOwn(target, key)) throw new Error(`Parts clash: ${what} "${key}" (again in ${partName}).`);
        target[key] = value;
    }
}

/** The parts as one module definition, by MODULES §A, settings keys as the parts write them. */
export function mergeParts(parts = PARTS, { id = RB_ID, name = 'RPG Battle' } = {}) {
    const def = { id, name, version: '2.0.0-qa', domains: {}, commands: {}, queries: {}, hooks: {}, tabs: [] };
    const kinds = {};
    const defaults = {};
    const schema = {};
    for (const [partName, p] of Object.entries(parts)) {
        mergeInto(def.domains, p.domains, 'domain', partName);
        mergeInto(def.commands, p.commands, 'command', partName);
        mergeInto(def.queries, p.queries, 'query', partName);
        mergeInto(kinds, p.kinds, 'kind', partName);
        mergeInto(defaults, p.settings?.defaults, 'setting', partName);
        mergeInto(schema, p.settings?.schema, 'setting', partName);
        def.tabs.push(...(p.tabs ?? []));
    }
    def.capture = {
        kinds: Object.fromEntries(Object.entries(kinds).map(([kind, spec]) => [kind, { grammar: spec.grammar }])),
        apply: (ctx, line) => kinds[line?.kind]?.apply(ctx, line) ?? ctx.fail('INVALID', 'no such kind'),
    };
    def.settings = { defaults, schema };
    void isObject;
    return def;
}

/** A tiny in-memory store with the bits the bus uses (SPEC §12): head, headIndex, append, scheduleSave. */
export function memoryStore(initial, opsLib = sbOps) {
    let head = opsLib.deepFreeze(structuredClone(initial));
    const log = [];
    return {
        head: () => head,
        headIndex: () => 0,
        append({ ops: changes, receipt }) {
            head = opsLib.deepFreeze(opsLib.apply(head, changes));
            log.push({ ops: changes, receipt, state: head });
        },
        scheduleSave() {},
        log,
        reset(state) {
            head = opsLib.deepFreeze(structuredClone(state));
        },
    };
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const base36 = (n, width = 8) => {
    let out = '';
    let left = n;
    for (let i = 0; i < width; i++) {
        out = BASE36[left % 36] + out;
        left = Math.floor(left / 36);
    }
    return out;
};

/**
 * createHarness({ host, shim, settings, coreSettings, seed }) → {
 *   host, registry, bus, store, state(), command(type, payload, { cause }), preview(…),
 *   capture(line), query(name, args, state?), calls (every ctx.call: { type, payload, caller,
 *   top }), receipts, settingsOf(id)
 * }. `settings` are RPG Battle's module settings (namespaced as module.js keeps them:
 * `combat.hitBase`), `coreSettings` Story Block's (currency).
 */
export function createHarness({ host = defaultHost, shim = true, settings = {}, coreSettings = {}, seed = 1, queryOverrides = {} } = {}) {
    const runtime = RUNTIMES[host];
    if (!runtime) throw new Error(`No host ${host}.`);
    const registry = runtime.registry.createRegistry();
    const calls = [];
    const receipts = [];
    const stack = [];
    let top = null;
    // The sb bus has no ctx.caller: the shim adds it (unless shim: false); the int bus has its own.
    const addCaller = host === 'sb' && shim;

    function wrap(moduleId, type, fn) {
        return function recorded(ctx, payload) {
            const caller = stack.length ? stack.at(-1) : null;
            if (caller) calls.push({ type, payload: structuredClone(payload), caller, top });
            const view = addCaller ? Object.freeze({ ...ctx, caller }) : ctx;
            stack.push(moduleId);
            try { return fn(view, payload); } finally { stack.pop(); }
        };
    }
    function wrapModule(def) {
        def.commands = Object.fromEntries(Object.entries(def.commands ?? {}).map(([type, fn]) => [type, wrap(def.id, type, fn)]));
        if (def.capture) def.capture = { ...def.capture, apply: wrap(def.id, 'capture', def.capture.apply) };
        return def;
    }

    let rbDefaults = {};
    const settingsOf = id => (id === RB_ID ? { ...rbDefaults, ...settings } : id === CORE_ID ? { currency: 'gold', currencyShort: '', ...coreSettings } : {});
    const core = wrapModule(runtime.core.createCoreModule({ hooks: name => registry.hooks(name), settings: () => settingsOf(CORE_ID) }));
    const rb = wrapModule(createModule({ settings: () => settingsOf(RB_ID) }));
    Object.assign(rb.queries, queryOverrides);
    rbDefaults = rb.settings.defaults;
    registry.register(core);
    registry.register(rb);

    const store = memoryStore(registry.initialState(), runtime.ops);
    let receiptN = 0;
    const seeds = makeRng(seed >>> 0);
    const bus = runtime.commands.createCommandBus({
        store,
        registry,
        settings: settingsOf,
        id: prefix => `${prefix}_${base36(++receiptN)}`,
        seed: () => Math.floor(seeds() * 4294967296) >>> 0,
    });

    // As live: the host's sdk on globalThis while this harness runs something (item.define reads
    // the currency through it).
    const sdk = { query: (name, args) => h.query(name, args), settings: id => settingsOf(id) };
    function running(label, fn) {
        const saved = globalThis.StoryBlock;
        globalThis.StoryBlock = { apiVersion: 2, sdk, ready: Promise.resolve(sdk) };
        top = label;
        try {
            return fn();
        } finally {
            top = null;
            if (saved === undefined) delete globalThis.StoryBlock;
            else globalThis.StoryBlock = saved;
        }
    }

    const h = {
        host, registry, bus, store, calls, receipts, settingsOf,
        state: () => store.head(),
        /** A command as a click (or `cause`) sends it, committed on success. */
        command(type, payload, { cause = 'ui' } = {}) {
            return running(type, () => {
                const result = bus.command(type, payload, { cause });
                if (result.ok) receipts.push(result.receipt);
                return result;
            });
        },
        /** bus.preview: the result, nothing stored. */
        preview(type, payload, { cause = 'ui' } = {}) {
            return running(`preview:${type}`, () => bus.preview(type, payload, { cause }));
        },
        /** A parsed change line ({ op, kind, name, text, labels }) captured as turn.js does, then stored. */
        capture(line) {
            const entry = registry.capture(line.kind);
            if (!entry) return { ok: false, code: 'UNKNOWN_KIND', message: `No owner for ${line.kind}.` };
            const full = { op: line.op ?? '+', kind: entry.kind, word: line.kind, name: line.name ?? '', text: line.text ?? '', labels: line.labels ?? {}, raw: line.raw ?? '', index: line.index ?? 0 };
            return running(`capture.${entry.kind}`, () => {
                const result = bus.run(`capture.${entry.kind}`, full, { cause: 'story', state: store.head(), capture: entry });
                if (result.ok) {
                    store.append({ ops: result.ops, receipt: result.receipt });
                    receipts.push(result.receipt);
                }
                return result;
            });
        },
        /** A query on the head (or `state`), called (state, args, tools) as MODULES §F3 says. */
        query(name, args = {}, state = store.head()) {
            const fn = registry.query(name);
            if (!fn) throw new Error(`No query ${name}.`);
            const frozen = deepFreeze(structuredClone(state));
            const tools = { query: (other, more) => h.query(other, more, frozen) };
            return structuredClone(fn(frozen, args, tools));
        },
    };
    return h;
}

// ---------- ready-made worlds ----------

export const POTION = { name: 'Minor Healing Draught', kind: 'consumable', note: '' };

/** A harness with a character made (party.create) in a settlement with a market. */
export function withHero({ name = 'Ren', preset = 'fighter', place = { name: 'Bluewatch Village', kind: 'settlement' }, ...options } = {}) {
    const h = createHarness(options);
    const made = h.command('party.create', { name, preset });
    if (!made.ok) throw new Error(`party.create failed: ${made.message}`);
    if (place) {
        const moved = h.command('scene.place', place);
        if (!moved.ok) throw new Error(`scene.place failed: ${moved.message}`);
    }
    return { h, pc: h.state().domains.party.pc };
}

/** Puts items in the party's keeping as the story does (`+ item Name | qty | note`); returns the def id. */
export function storyItem(h, name, qty = 1, note = '') {
    const r = h.capture({ op: '+', kind: 'item', name, labels: { qty: String(qty), ...(note ? { note } : {}) } });
    if (!r.ok) throw new Error(`+ item ${name} failed: ${r.message}`);
    return r.receipt.data.def;
}

/** Coins as the story gives them (`+ coin n`). */
export function storyCoin(h, amount) {
    const r = h.capture({ op: '+', kind: 'coin', name: String(amount), labels: {} });
    if (!r.ok) throw new Error(`+ coin ${amount} failed: ${r.message}`);
    return r;
}

/** The stacks of a def, as inventory.items rows. */
export const stacksOf = (h, defId) => h.query('inventory.items').filter(row => row.def === defId);

/** How many of each def the party side holds (all owners), and the money in every wallet. */
export function holdings(state) {
    const inv = state.domains.inventory;
    const goods = {};
    for (const stack of Object.values(inv.stacks)) goods[stack.def] = (goods[stack.def] ?? 0) + stack.qty;
    let money = 0;
    for (const wallet of Object.values(inv.wallets)) money += wallet.coin ?? 0;
    return { goods, money };
}

/** Plays a started fight by attacking the first foe until it is over. */
export function fightOut(h, max = 300) {
    for (let n = 0; n < max; n++) {
        const view = h.query('combat.session');
        if (!view || view.status !== 'active') return n;
        const target = view.actions.targets?.enemies?.[0];
        const r = h.command('combat.act', { action: target ? { type: 'attack', target } : { type: 'defend' } });
        if (!r.ok) throw new Error(`combat.act failed: ${r.code} ${r.message}`);
    }
    throw new Error('The fight did not end.');
}

/** Test setup only: rewrites the head state by hand (no receipt), e.g. to lower someone's MP. */
export function patch(h, fn) {
    const next = structuredClone(h.state());
    fn(next);
    h.store.reset(next);
    return h.state();
}

/** The ctx.call payloads `top` sent to `type` (in order). */
export const sent = (h, top, type) => h.calls.filter(call => call.top === top && call.type === type).map(call => call.payload);

/** A whole-state fingerprint: byte-identical states have the same one. */
export const bytes = state => JSON.stringify(state);

/** Wins a fight against one foe from the story's `! encounter` line; returns { start, end }. */
export function winFight(h, name = 'Bandit', labels = { tier: 'weak' }) {
    const offered = h.capture({ op: '!', kind: 'encounter', name, text: 'on the road', labels });
    if (!offered.ok) throw new Error(`encounter failed: ${offered.message}`);
    const offer = h.query('combat.offers').at(-1).id;
    const start = h.command('combat.start', { offer });
    if (!start.ok) throw new Error(`combat.start failed: ${start.message}`);
    fightOut(h);
    const status = sessionOf(h.state().domains.combat).status;
    const end = h.command('combat.end');
    return { start, end, status };
}
