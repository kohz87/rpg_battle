// RPG Battle 2 (Story Suite v2): the SillyTavern entry point.
//
// RPG Battle 2 is a module of Story Block v2 (docs/v2/SPEC.md §6): Story Block keeps the state,
// runs the commands, reads the replies' change lines and builds the prompt; this file only waits
// for it and registers RPG Battle's definition (src/v2/module.js: the party, creation, checks,
// items, combat, board, return, trade and screens parts). Without a v2 host it shows one line in the extensions drawer saying Story Block
// v2 is needed, and does nothing else. The v1 glue (v1.js) stays in the repository but is not
// loaded: no v1 interceptor, blocks or tabs.

import { MODULE_ID, MODULE_NAME, VERSION, createModule } from './src/v2/module.js';
import { migrateRankLadder } from './src/terms.js';

// How long to wait for Story Block to come up (it loads first, as a dependency, but sets itself
// up asynchronously), and how often to look.
const WAIT_MS = 15000;
const STEP_MS = 100;
const MISSING_CLASS = 'rpg-battle-needs-story-block';
export const MISSING_TEXT = `${MODULE_NAME} ${VERSION} needs Story Block v2: install or enable Story Block 2, then reload. Nothing else runs until then.`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Story Block v2's global ({ apiVersion: 2, ready, sdk }), waited for up to `waitMs`; null when it never comes. */
export async function findHost({ global = globalThis, waitMs = WAIT_MS, stepMs = STEP_MS } = {}) {
    for (let waited = 0; ; waited += stepMs) {
        const host = global.StoryBlock;
        if (host && host.apiVersion === 2 && host.ready && typeof host.ready.then === 'function') return host;
        if (waited >= waitMs) return null;
        await sleep(stepMs);
    }
}

/** The one line in the extensions drawer when there is no v2 host (shown once). */
export function showMissing(doc = globalThis.document) {
    if (!doc?.createElement) return null;
    const drawer = doc.querySelector?.('#extensions_settings2') ?? doc.querySelector?.('#extensions_settings') ?? doc.body;
    if (!drawer) return null;
    const existing = drawer.querySelector?.(`.${MISSING_CLASS}`);
    if (existing) return existing;
    const line = doc.createElement('div');
    line.className = MISSING_CLASS;
    line.textContent = MISSING_TEXT;
    drawer.appendChild(line);
    return line;
}

/**
 * Waits for Story Block v2 and registers RPG Battle with it. Returns { ok: true, sdk } or
 * { ok: false, reason } (and the drawer line).
 */
export async function boot({ global = globalThis, doc = global.document, waitMs = WAIT_MS, stepMs = STEP_MS } = {}) {
    const host = await findHost({ global, waitMs, stepMs });
    if (!host) {
        showMissing(doc);
        return { ok: false, reason: 'no-host' };
    }
    try {
        const sdk = await host.ready;
        // terms2: a rank ladder typed in Story Block's Terms (SB #121) moves to RPG Battle's Terms, once.
        try {
            const st = global.SillyTavern?.getContext?.();
            if (migrateRankLadder(st?.extensionSettings?.storySuite)) st.saveSettingsDebounced?.();
        } catch (error) { console.warn(`[${MODULE_NAME}] the rank ladder could not be moved`, error); }
        await sdk.registerModule(createModule({ settings: () => sdk.settings(MODULE_ID) }));
        return { ok: true, sdk };
    } catch (error) {
        console.error(`[${MODULE_NAME}] Story Block v2 did not take the module:`, error);
        global.toastr?.error?.(String(error?.message ?? error), MODULE_NAME);
        return { ok: false, reason: 'refused', error };
    }
}

export const booted = boot();
