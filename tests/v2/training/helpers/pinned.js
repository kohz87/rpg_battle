// A production-shaped host for the pinned-chat fixtures: Story Block's real host (the vendored runtime), a Story
// Director stand-in (clock, place), RPG Battle booted through index.js exactly as SillyTavern boots it, and packs
// installed in the library, so a chat is pinned through Setup's own `rules.pin` and later reloaded cold.
import assert from 'node:assert/strict';
import { createHost } from '../../../vendor/story-block/testkit/index.js';
import { SD } from '../../progress/helpers/world.js';

// Keep the entry point's automatic boot from registering a module on a test's host twice.
const original = globalThis.StoryBlock;
globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve({ settings: () => ({}), preflight: () => ({}), registerModule: async () => {} }) };
const { boot, booted } = await import('../../../../index.js');
await booted;
if (original === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = original;

export const ok = result => { assert.equal(result.ok, true, `${result.code}: ${result.message}`); return result; };
const payload = offer => { const { name, ...choice } = offer; return choice; };

/** A host with `packs` installed and RPG Battle booted. `st`: a saved chat to open (`{ chat, extensionSettings }`). Close it with `h.close()`. */
export async function openWorld({ packs = [], st } = {}) {
    const h = await createHost({ st, modules: [{ ...SD, version: '2.0.0' }] });
    for (const pack of packs) ok(await h.packs.packs.install(pack));
    ok(await boot({ global: { StoryBlock: { apiVersion: 2, ready: Promise.resolve(h.sdk) } }, doc: null }));
    h.q = (name, args = {}) => h.sdk.query(name, args);
    h.selection = () => h.q('rules.selection');
    h.pin = offer => h.sdk.command('rules.pin', payload(offer ?? h.selection().offers[0]));
    h.say = (text, lines = []) => h.send('Go on.', lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
    return h;
}
