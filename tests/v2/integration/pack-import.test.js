// Importing the bundled Ersveil pack (content.rules, requires rb-rules-v2) through Story Block's own install path
// (the `packs` part's install(), which the Packs panel's import calls) on the real host: it works with RPG Battle
// registered and dormant (no Story Director) as well as with Story Director, and RPG Battle declares the capability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { validatePack } from '../../vendor/story-block/src/v2/packs/validate.js';
import { stCapabilities } from '../../vendor/story-block/src/v2/packs/st-adapter.js';
import { createModule } from '../../../src/v2/module.js';
import { rpgHost } from './helpers/host.js';

const ERSVEIL = readFileSync(new URL('../fight/fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');

async function importErsveil(host) {
    const before = globalThis.StoryBlock;
    globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve(host.sdk), sdk: host.sdk };
    try {
        // What the host's capability list is built from (st-adapter.js stCapabilities), without the host's own names.
        const declared = host.sdk.modules().find(module => module.id === 'rpg-battle');
        assert.deepEqual(declared.capabilities, ['rb-rules-v2'], 'RPG Battle declares the rules capability');
        assert.ok(stCapabilities().includes('rb-rules-v2'));
        const checked = validatePack(ERSVEIL, { capabilities: stCapabilities() });
        assert.equal(checked.ok, true, JSON.stringify(checked.errors));
        const installed = await host.packs.packs.install(ERSVEIL, { source: 'file', origin: 'pack.json' });
        assert.equal(installed.ok, true, JSON.stringify(installed.errors));
        assert.equal(installed.id, 'ersveil-bluewatch');
        assert.equal(installed.action, 'installed');
        assert.equal(host.packs.packs.list().some(entry => entry.id === 'ersveil-bluewatch'), true);
    } finally {
        if (before === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = before;
    }
}

test('the Ersveil pack imports while RPG Battle is dormant (no Story Director)', async t => {
    const host = await createHost({ modules: [createModule()] });
    t.after(() => host.close());
    const entry = host.sdk.modules().find(module => module.id === 'rpg-battle');
    assert.equal(entry.status, 'dormant');
    await importErsveil(host);
});

test('the Ersveil pack imports with RPG Battle ready beside Story Director', async t => {
    const host = await rpgHost();
    t.after(() => host.close());
    assert.equal(host.sdk.modules().find(module => module.id === 'rpg-battle').status, 'ready');
    await importErsveil(host);
});
