// Final soak helper (from b5b-robust): all four Story Suite v2 modules on Story Block's testkit with the Ersveil pack.
// Ersveil starter pack installed. Dropped into any repo's tests/v2/break/helpers/, it finds the four
// checkouts as siblings of that repo (STORY_SUITE_ROOT overrides the parent folder).
//
//   suiteHost({ pack = true, settings, seed }) → testkit host + { q, cmd, reply, wallet, ... }
//
// Deterministic: globalThis.crypto is a seeded counter while the host lives (receipt ids, seeds).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
function findRoot() {
    if (process.env.STORY_SUITE_ROOT) return process.env.STORY_SUITE_ROOT;
    // <root>/<repo>/tests/v2/break/helpers → <root>
    let dir = here;
    for (let n = 0; n < 8; n += 1) {
        if (existsSync(path.join(dir, 'Story_block', 'testkit', 'index.js')) && existsSync(path.join(dir, 'rpg_battle', 'src', 'v2', 'module.js'))) return dir;
        dir = path.dirname(dir);
    }
    throw new Error('b5b harness: no folder holding Story_block, rpg_battle, Story_director and npc_state_delta found above ' + here);
}
export const ROOT = findRoot();
const at = rel => pathToFileURL(path.join(ROOT, rel)).href;

const { createHost } = await import(at('Story_block/testkit/index.js'));
const RB = await import(at('rpg_battle/src/v2/module.js'));
const SD = await import(at('Story_director/src/v2/module.js'));
const NSD = await import(at('npc_state_delta/src/storysuite-v2.js'));
export const PACK_TEXT = readFileSync(path.join(ROOT, 'Story_block/examples/packs/ersveil-bluewatch/pack.json'), 'utf8');
export const PACK = JSON.parse(PACK_TEXT);

function source(seed) {
    let x = seed | 0;
    const next = () => {
        x = (x + 0x9E3779B9) | 0;
        let z = x;
        z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B);
        z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35);
        return (z ^ (z >>> 16)) >>> 0;
    };
    return {
        getRandomValues(array) {
            for (let i = 0; i < array.length; i += 1) {
                const value = next();
                array[i] = array instanceof Uint8Array ? value & 0xFF : value;
            }
            return array;
        },
        randomUUID: () => `00000000-0000-4000-8000-${String(next()).padStart(12, '0').slice(0, 12)}`,
    };
}

/**
 * A host with Story Block core, RPG Battle, Story Director and NPC State Delta, the Ersveil pack
 * installed and enabled before the chat starts (so its start state, currency and calendar apply).
 */
export async function suiteHost({ pack = true, settings = null, seed = 1, nsdNpcs = [] } = {}) {
    const savedCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: source(seed), configurable: true, writable: true });
    let sdk = null;
    const rb = RB.createModule({ settings: () => sdk?.settings(RB.MODULE_ID) ?? {} });
    const sd = SD.createModule({ host: { settings: id => sdk?.settings(id) ?? null, substitute: text => sdk?.substitute(text) } });
    const nsd = NSD.createStorySuiteV2Adapter({ suiteApi: { npcs: () => nsdNpcs }, delta: () => ({ isEnabled: () => true, getNpc: () => null }), doc: null, timers: {}, logger: { warn() {} } }).definition;
    // Install the pack into a settings object first, so the chat's initial state sees it.
    let storySuite = settings ? structuredClone(settings) : {};
    if (pack) {
        const probe = await createHost({ settings: storySuite });
        const done = await probe.packs.packs.install(PACK_TEXT, { origin: 'pack.json' });
        if (!done.ok) throw new Error('pack install failed: ' + JSON.stringify(done.errors));
        storySuite = structuredClone(probe.ctx.extensionSettings.storySuite);
        probe.close();
    }
    const host = await createHost({ settings: storySuite, modules: [rb, sd, nsd] });
    sdk = host.sdk;
    const savedSB = globalThis.StoryBlock;
    globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve(sdk), sdk };
    const close = host.close;
    host.close = () => {
        close();
        if (savedSB === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = savedSB;
        if (savedCrypto) Object.defineProperty(globalThis, 'crypto', savedCrypto);
    };
    host.q = (name, args) => sdk.query(name, args);
    host.cmd = (type, payload = {}, opts) => sdk.command(type, payload, opts);
    host.reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
    host.wallet = (owner = 'party') => host.head().domains.inventory.wallets?.[owner]?.coin ?? 0;
    host.items = (owner) => sdk.query('inventory.items', owner ? { owner } : {});
    host.claims = () => Object.keys(host.head().meta.claims ?? {}).sort();
    host.receipts = () => sdk.receipts().map(entry => entry.receipt);
    return host;
}

/** suiteHost + a PC made (party.create) + one opening reply in Bluewatch. */
export async function started(options = {}) {
    const host = await suiteHost(options);
    const made = await host.cmd('party.create', { name: 'Wessel', preset: options.preset ?? 'fighter' });
    if (!made.ok) throw new Error('party.create: ' + made.message);
    await host.send('We look around Bluewatch.', host.reply('The village smells of salt and tar.', ['~ place Bluewatch Village | kind: settlement']));
    return host;
}

/** The rebuilt state (from the chat's records, cold) vs the live head. */
export async function rebuilt(host) {
    const { createStore } = await import(at('Story_block/src/v2/store.js'));
    const fresh = createStore({ chat: () => host.ctx.chat, save: () => {} });
    return fresh.head();
}
