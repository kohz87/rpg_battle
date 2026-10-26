// A pinned timeline's crafting reads the pin's recipes, never the packs installed now: a pack reinstalled at the
// same version with other numbers, disabled or removed moves nothing in a running chat. A chat that never pinned still
// follows the installed packs (the control).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { inputsPack } from '../progress/helpers/fixture.js';
import { SD } from '../progress/helpers/world.js';

// Avoid the entry point's automatic boot installing a module on a test's host twice.
const original = globalThis.StoryBlock;
globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve({ settings: () => ({}), preflight: () => ({}), registerModule: async () => {} }) };
const { boot, booted } = await import('../../../index.js');
await booted;
if (original === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = original;

const director = { ...SD, version: '2.0.0' };
const ok = result => { assert.equal(result.ok, true, `${result.code}: ${result.message}`); return result; };

async function world(t) {
    const h = await createHost({ modules: [director] });
    t.after(() => h.close());
    ok(await h.packs.packs.install(inputsPack()));
    ok(await boot({ global: { StoryBlock: { apiVersion: 2, ready: Promise.resolve(h.sdk) } }, doc: null }));
    h.q = (name, args = {}) => h.sdk.query(name, args);
    return h;
}
const forge = h => h.q('craft.recipes').find(recipe => recipe.name === 'Forge a blade');
const reinstall = async (h, change) => {
    const pack = inputsPack();
    change(pack.content.recipes[0], pack.content.items);
    ok(await h.packs.packs.install(pack));
};
const harder = recipe => { recipe.dc = 20; recipe.minutes = 99; };
const create = h => h.sdk.command('creation.finish', { name: 'Astra', race: 'rpg-battle/human', talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: 'pack.fixture/c0', checkActor: null });

test('a pinned chat crafts from the pin: a same-version reinstall with other numbers, a disabled pack and a removed pack change nothing', async t => {
    const h = await world(t);
    ok(await h.sdk.command('rules.pin', (({ name, ...choice }) => choice)(h.q('rules.selection').offers[0])));
    ok(await create(h));
    const pinned = structuredClone(forge(h));
    assert.deepEqual([pinned.dc, pinned.minutes, pinned.craft, pinned.makes], [10, 10, 'smithing', 'Iron Sword']);
    const view = () => h.q('craft.view').people[0].recipes.find(recipe => recipe.name === 'Forge a blade');
    const seen = structuredClone(view());
    assert.equal(seen.dc, 10);

    await reinstall(h, harder);
    assert.equal(h.q('packs.content', { kind: 'recipes' }).find(recipe => recipe.name === 'Forge a blade').dc, 20, 'the installed pack really changed');
    assert.deepEqual(forge(h), pinned);
    assert.deepEqual(view(), seen);
    assert.equal(h.q('craft.known').find(recipe => recipe.name === 'Forge a blade').dc, 10);

    await h.packs.packs.setEnabled('fixture', false);
    assert.equal(h.q('packs.content', { kind: 'recipes' }).length, 0, 'the installed pack is really off');
    assert.deepEqual(forge(h), pinned, 'a disabled pack');
    assert.deepEqual(view(), seen);

    await h.packs.packs.remove('fixture');
    assert.deepEqual(forge(h), pinned, 'a removed pack');
    assert.deepEqual(view(), seen);
});

test('a chat that never pinned still follows the installed pack (the control)', async t => {
    const h = await world(t);
    assert.deepEqual([forge(h).dc, forge(h).minutes], [10, 10]);
    await reinstall(h, harder);
    assert.deepEqual([forge(h).dc, forge(h).minutes], [20, 99]);
});
