// Story Block v2's runtime, wired once for SillyTavern (index.js) and for the testkit alike: the
// registry with the core module (scene, inventory, packs, events), settings under
// extension_settings.storySuite, the store over the chat, the command bus, the public sdk and the
// turn. No DOM: the settings overlay, the tab host and the mounts are index.js's (src/v2/ui-host.js).
//
// What the runtime adds on top of the parts:
// * the initial state of a chat with none is the registry's, with the enabled packs' start merged
//   in (SPEC §2.6; `start` hooks, packs' applyStart);
// * the chat's one currency (MODULES §F1) is the reader's name for it, else the first enabled
//   pack's suggestion, else the default (gold);
// * the events part commits and asks through this runtime's sdk.

import { createCommandBus as realBus } from './commands.js';
import { CORE_MODULE_ID, createCoreModule } from './domains/index.js';
import { WALLET_KEY } from './domains/money.js';
import { createAssistPart } from './assist/index.js';
import { applyStart, createPacksPart } from './packs/index.js';
import { createRegistry } from './registry.js';
import { createEvents, createSdk, createSettings, newId } from './sdk.js';
import { createRewind } from './rewind.js';
import { createStore as realStore } from './store.js';
import { createTurn, substituteNames } from './turn.js';

export const VERSION = '2.0.0-alpha.1';

/**
 * Settings where Story Block's `currency` (and `currencyShort`) fall back to `suggest()` →
 * { name, short } | null when the reader has not set them. Same interface as createSettings().
 */
export function withPackCurrency(base, suggest) {
    const settings = id => {
        const values = base(id);
        if (id !== CORE_MODULE_ID) return values;
        const stored = base.stored(id);
        if (Object.hasOwn(stored, 'currency') && String(stored.currency ?? '').trim()) return values;
        let offer = null;
        try { offer = suggest(); } catch { offer = null; }
        if (offer && typeof offer.name === 'string' && offer.name.trim()) {
            values.currency = offer.name.trim();
            if (!Object.hasOwn(stored, 'currencyShort') || !String(stored.currencyShort ?? '').trim()) values.currencyShort = String(offer.short ?? '');
        }
        return values;
    };
    settings.stored = base.stored;
    settings.set = base.set;
    return settings;
}

/** The initial State: the registry's, with each `start` hook's merged pack start applied. */
export function initialWithStart(registry, { id = newId } = {}) {
    let state = registry.initialState();
    for (const hook of registry.hooks('start')) {
        let start = null;
        try { start = hook(); } catch (error) {
            console.warn('[Story Suite] a pack start could not be read', error);
            continue;
        }
        if (!start || !Array.isArray(start.packs) || !start.packs.length) continue;
        try { state = applyStart(state, start, { id, coin: WALLET_KEY }); } catch (error) {
            console.warn('[Story Suite] a pack start could not be applied', error);
        }
    }
    return state;
}

/** A packs part over `ctx.extensionSettings.storySuite` (the testkit's; index.js uses the live one). */
export function packsFor(ctx, options = {}) {
    return createPacksPart({
        settings: {
            read() {
                const root = ctx.extensionSettings ?? (ctx.extensionSettings = {});
                if (!root.storySuite || typeof root.storySuite !== 'object') root.storySuite = {};
                return root.storySuite;
            },
            save: () => ctx.saveSettingsDebounced?.(),
        },
        ...options,
    });
}

/**
 * createRuntime({ ctx, packs?, core = true, modules = [], createStore?, createCommandBus?, notify?,
 * onBlocked?, onSaveError?, onRegister?(def), branch?(index) (src/v2/rewind.js stBranch), callModel? (assist) }) → { registry, settings, store, bus, events, sdk, turn, markReady,
 * initial, packs }. `ctx` is SillyTavern's context (or the testkit's fake); `packs` a
 * createPacksPart() result (default: one over ctx.extensionSettings).
 */
export function createRuntime({
    ctx, packs = null, core = true, modules = [], createStore = realStore, createCommandBus = realBus,
    notify, onBlocked = null, onSaveError = null, onRegister = null, branch = null, callModel = null,
} = {}) {
    const registry = createRegistry();
    const packPart = packs ?? packsFor(ctx);
    const base = createSettings({ root: () => ctx.extensionSettings, registry, save: () => ctx.saveSettingsDebounced?.() });
    const settings = withPackCurrency(base, () => packPart.startState().currency);
    let sdk = null;
    if (core) {
        registry.register(createCoreModule({
            hooks: name => registry.hooks(name),
            settings: () => settings(CORE_MODULE_ID),
            version: VERSION,
            packs: packPart,
            command: (type, payload, options) => (sdk ? sdk.command(type, payload, options) : { ok: false, code: 'FAILED', message: 'Story Block is not ready.' }),
            query: (name, args) => {
                if (!sdk) throw new Error('Story Block is not ready.');
                return sdk.query(name, args);
            },
            // The two optional helpers, off until the reader turns them on (Assist settings).
            assist: createAssistPart({
                settings: () => settings(CORE_MODULE_ID),
                grammar: () => registry.contexts().flatMap(context => context.kinds.map(kind => kind.grammar)),
                chat: () => ctx.chat,
                chatId: () => ctx.getCurrentChatId?.() ?? ctx.chatId ?? '',
                hasKind: kind => Boolean(registry.capture(kind)),
                ...(callModel ? { callModel } : {}),
            }),
        }));
    }
    for (const def of modules) registry.register(def);

    const store = createStore({ chat: () => ctx.chat, save: () => ctx.saveChat(), onSaveError });
    const bus = createCommandBus({ store, registry, settings });
    const events = createEvents();
    const rewind = createRewind({ ctx, store, events, ...(branch ? { branch } : {}) });
    let dialogOpener = null;
    const made = createSdk({ store, bus, registry, settings, events, chat: () => ctx.chat, onRegister: def => onRegister?.(def), rewind,
        substitute: text => substituteNames(text, ctx), dialog: (screenId, opts) => dialogOpener?.(screenId, opts) ?? null });
    sdk = made.sdk;
    const initial = () => initialWithStart(registry);
    const turn = createTurn({ ctx, store, bus, registry, settings, events, onBlocked, initial, ...(notify ? { notify } : {}) });
    // The UI (ui-host.js) plugs its dialog mount in here, for sdk.dialog.open.
    const setDialog = fn => { dialogOpener = typeof fn === 'function' ? fn : null; };
    return { registry, settings, store, bus, events, sdk, turn, markReady: made.markReady, initial, packs: packPart, setDialog };
}
