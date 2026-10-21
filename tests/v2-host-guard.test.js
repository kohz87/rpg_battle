// B-b7-combos-9 (v1 / `main`, 0.5.51): RPG Battle v1 on a page whose Story Block is v2. storyBlock()
// accepts any `apiVersion >= 1` with a version >= 0.7.0, so the v2 global
// ({ apiVersion: 2, version: '2.0.0-alpha.1', ready, sdk }) is taken for a v1 host and init() →
// ensureUi() → registerWithStoryBlock() throws "sb.registerBlock is not a function" while the module
// is evaluated: SillyTavern logs a page error, nothing of RPG Battle is set up (no events, its old
// prompt keys are not cleared) and the reader is told nothing. Seen live (combinations M1, M4).
// (B-b7-combos-9)

import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './ui-fake-dom.js';

const doc = installFakeDom();
const drawer = doc.createElement('div');
drawer.id = 'extensions_settings';
doc.body.appendChild(drawer);

const sdk = Object.freeze({ apiVersion: 2, registerModule: async () => sdk, modules: () => [] });
globalThis.StoryBlock = Object.freeze({ apiVersion: 2, version: '2.0.0-alpha.1', ready: Promise.resolve(sdk), sdk });
globalThis.toastr = Object.fromEntries(['info', 'success', 'warning', 'error'].map(level => [level, () => null]));
const ctx = {
    chat: [], chatMetadata: {}, chatId: 'chat-0', extensionSettings: {}, name1: 'Ren',
    getCurrentChatId: () => ctx.chatId, saveMetadataDebounced: () => {}, saveMetadata: async () => {},
    saveSettingsDebounced: () => {}, setExtensionPrompt: () => {}, eventSource: { on: () => {} }, event_types: {},
};
globalThis.SillyTavern = { getContext: () => ctx };

test('RPG Battle v1 does not take Story Block v2 for a v1 host (and does not throw on load)', async () => {
    await assert.doesNotReject(import('../index.js'), 'loading v1 RPG Battle next to Story Block v2 must not throw');
});

// The module keeps timers running once it is set up; end the process when the test is done.
test.after(() => setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref?.());
