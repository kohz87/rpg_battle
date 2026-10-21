// The public sdk (docs/v2/SPEC.md §3.1, §6): what modules get from `await StoryBlock.ready`.
// Built from the store, the command bus and the registry; it adds the parts they share: events,
// settings under extension_settings.storySuite, the view modules read, ids, and adding a late
// module's initial state. No SillyTavern import (turn.js wires SillyTavern).

import { INIT_PREFIX } from './registry.js';

// sdk.check comes from check.js (SB-commands); the sdk still loads without it.
const checkModule = await import('./check.js').catch(() => null);

export const EVENTS = Object.freeze(['committed', 'head', 'turn']);
export const HOST_SETTINGS_DEFAULTS = Object.freeze({ tailBudget: 1500 });
export const HOST_SETTINGS_SCHEMA = Object.freeze({
    tailBudget: Object.freeze({
        type: 'int', min: 100, max: 20000, label: 'Notes per reply (tokens)',
        help: 'The most Story Suite adds to the end of each reply\'s prompt, about four characters a token.',
    }),
});

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const ID_PREFIX = /^[a-z][a-z0-9]*$/;
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** `<prefix>_<8 base36 chars>` from crypto randomness (§2.1), e.g. `it_k3f9a2qz`. */
export function newId(prefix) {
    if (typeof prefix !== 'string' || !ID_PREFIX.test(prefix)) throw new Error(`Story Suite: an id prefix is lowercase letters and digits (like "it"), not "${prefix}".`);
    let out = '';
    const bytes = new Uint8Array(16);
    while (out.length < 8) {
        globalThis.crypto.getRandomValues(bytes);
        // 252 = 7 × 36: values above it would favour the first letters.
        for (const byte of bytes) if (byte < 252 && out.length < 8) out += BASE36[byte % 36];
    }
    return `${prefix}_${out}`;
}

/** { on(name, fn) → off, emit(name, payload) }; a listener that throws is logged, not passed on. */
export function createEvents() {
    const listeners = new Map(EVENTS.map(name => [name, new Set()]));
    const known = name => {
        if (!listeners.has(name)) throw new Error(`Story Suite: there is no "${name}" event (known: ${EVENTS.join(', ')}).`);
        return listeners.get(name);
    };
    return {
        on(name, fn) {
            if (typeof fn !== 'function') throw new Error('Story Suite: on() needs a function.');
            const set = known(name);
            set.add(fn);
            return () => set.delete(fn);
        },
        emit(name, payload) {
            for (const fn of [...known(name)]) {
                try { fn(payload); } catch (error) { console.warn(`[Story Suite] a "${name}" listener failed`, error); }
            }
        },
    };
}

/**
 * Settings under `root().storySuite` (`root`: () => SillyTavern's extension_settings):
 * `settings(id)` → the module's values over its defaults (a plain copy); `settings()` → the
 * host's ({ tailBudget }). `settings.set(id, key, value)` stores one value (id null: the host's)
 * and calls `save` (saveSettingsDebounced). `settings.stored(id)` is the stored object itself.
 */
export function createSettings({ root, registry, save = () => {} }) {
    function bucket() {
        const es = root?.();
        if (!isObject(es)) return { host: {}, modules: {} };
        if (!isObject(es.storySuite)) es.storySuite = {};
        if (!isObject(es.storySuite.modules)) es.storySuite.modules = {};
        if (!isObject(es.storySuite.host)) es.storySuite.host = {};
        return es.storySuite;
    }
    function stored(id) {
        const all = bucket();
        if (id === undefined || id === null) return all.host;
        if (!isObject(all.modules[id])) all.modules[id] = {};
        return all.modules[id];
    }
    function settings(id) {
        const defaults = id === undefined || id === null ? HOST_SETTINGS_DEFAULTS : registry.module(id)?.settings?.defaults ?? {};
        return structuredClone({ ...defaults, ...stored(id) });
    }
    settings.stored = stored;
    settings.set = (id, key, value) => {
        stored(id)[key] = structuredClone(value);
        save();
    };
    return settings;
}

/**
 * Runs a registered query on `state`; the answer is a plain copy. Throws for an unknown query.
 * A query is called (state, args, tools) with tools.query(name, args) over the same state.
 */
export function runQuery(registry, state, name, args) {
    const query = registry.query(name);
    if (!query) throw new Error(`Story Suite: no module answers the query "${name}".`);
    const tools = Object.freeze({ query: (other, otherArgs) => runQuery(registry, state, other, otherArgs) });
    const answer = query(state, args === undefined ? undefined : structuredClone(args), tools);
    return answer === undefined ? undefined : structuredClone(answer);
}

/**
 * The mounts' query (src/v2/view/mounts/common.js): `(name, args, state)` → runQuery over that
 * state, so a card asks against its own reply's state and the registry's queries still get
 * (state, args, tools). A query that throws is the mount's to report (resolveData gives null).
 */
export const mountQuery = registry => (name, args, state) => runQuery(registry, state, name, args);

/**
 * What modules read (§6): { state (frozen head), query(name, args), settings(id), chat: { length,
 * lastUser } }. `chat`: SillyTavern's chat array (or nothing).
 */
export function makeView({ store, registry, settings, chat = [] }) {
    const state = store.head();
    const messages = Array.isArray(chat) ? chat : [];
    const lastUser = [...messages].reverse().find(message => message?.is_user);
    return Object.freeze({
        state,
        query: (name, args) => runQuery(registry, state, name, args),
        settings,
        chat: Object.freeze({ length: messages.length, lastUser: String(lastUser?.mes ?? '') }),
    });
}

/** The registered modules whose domains the head state lacks (enabled after the chat began). */
export function missingModules(registry, state) {
    const domains = state?.domains ?? {};
    return registry.modules().filter(def => Object.keys(def.domains ?? {}).some(name => !Object.hasOwn(domains, name)));
}

/**
 * Adds each late module's initial slices with a `system` receipt on the head carrier (§2.6).
 * Does nothing without a head carrier. Returns the command results.
 */
export async function ensureModules({ store, bus, registry, events = null }) {
    if (store.headIndex() < 0) return [];
    const results = [];
    for (const def of missingModules(registry, store.head())) {
        const result = await bus.command(`${INIT_PREFIX}${def.id}`, {}, { cause: 'system' });
        if (result?.ok) events?.emit('committed', { receipt: result.receipt });
        else console.warn(`[Story Suite] ${def.name ?? def.id} could not be set up in this chat: ${result?.message ?? 'unknown error'}`);
        results.push(result);
    }
    return results;
}

/**
 * The public sdk. `deps`: { store, bus, registry, settings (createSettings), events
 * (createEvents), chat?: () => Message[], check?, onRegister?(def) (after each registerModule) }. Returns { sdk, events, markReady }:
 * `sdk.ready` resolves to the sdk once the host calls markReady().
 */
export function createSdk({ store, bus, registry, settings, events = createEvents(), chat = () => [], check = checkModule, onRegister = null }) {
    let markReady;
    const ready = new Promise(resolve => { markReady = () => resolve(sdk); });
    const committed = result => {
        if (result?.ok) events.emit('committed', { receipt: result.receipt });
        return result;
    };
    const sdk = Object.freeze({
        apiVersion: 2,
        ready,
        /** Registers a module (§6); a module enabled mid-chat gets its initial state now. */
        async registerModule(def) {
            registry.register(def);
            if (typeof onRegister === 'function') {
                try { onRegister(def); } catch (error) { console.warn('[Story Suite] a module was registered, but the screens could not follow', error); }
            }
            await ensureModules({ store, bus, registry, events });
            return sdk;
        },
        command: async (type, payload, options = {}) => committed(await bus.command(type, payload, { cause: 'ui', ...options })),
        preview: async (type, payload) => bus.preview(type, payload),
        commit: async token => committed(await bus.commit(token)),
        query: (name, args) => runQuery(registry, store.head(), name, args),
        /** The view tabs and contexts get: { state, query, settings, chat }. */
        view: () => makeView({ store, registry, settings, chat: chat() }),
        on: (name, fn) => events.on(name, fn),
        id: newId,
        check: check ? Object.freeze({ ...check }) : null,
        settings: id => settings(id),
        /** [{ id, name, version, domains, commands, kinds, tabs }] in id order. */
        modules: () => registry.modules().map(def => Object.freeze({
            id: def.id,
            name: def.name ?? def.id,
            version: def.version ?? '',
            domains: Object.keys(def.domains ?? {}),
            commands: Object.keys(def.commands ?? {}),
            kinds: Object.keys(def.capture?.kinds ?? {}),
            tabs: (def.tabs ?? []).map(tab => tab.id),
        })),
    });
    return { sdk, events, markReady };
}
