// The new pages only change navigation for a chat that has a valid rules answer (a pinned ruleset). An unpinned (legacy) chat on the
// real host shows exactly the tabs and screens it showed before track C; a pinned one shows the five new pages. Both ways are checked
// on Story Block's real runtime and tab mount (the vendored copy), not on a hand-made query.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../../vendor/story-block/src/v2/runtime.js';
import { mountUi } from '../../../vendor/story-block/src/v2/ui-host.js';
import { activeNow } from '../../../vendor/story-block/src/v2/view/mounts/common.js';
import { createFakeContext } from '../../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../../src/v2/module.js';
import { mergeInto, realWorld, rulesModule } from '../../progress/helpers/world.js';
import { installDom } from '../helpers/dom.js';

const NEW_PAGES = ['rpg-battle/progress', 'rpg-battle/quests', 'rpg-battle/roster', 'rpg-battle/links', 'rpg-battle/setup'];
const LEGACY_TABS = ['rpg-battle/party', 'story-block/inventory', 'rpg-battle/crafting', 'rpg-battle/trade', 'story-block/scene'];

/** The host's tab bar and game-view bar entries on an unpinned chat, the way the mounts compute them. */
async function legacyChat(module) {
    const doc = installDom();
    const st = createFakeContext({});
    let ui = null;
    const runtime = createRuntime({ ctx: st.ctx, modules: [module], onRegister: () => ui?.syncScreens(), notify: () => {} });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.turn.install({ globalName: null });
    st.interceptor = runtime.turn.interceptor;
    runtime.markReady();
    await runtime.turn.onChatChanged();
    // The host's own reading: a query nobody registered answers null (ui-host queryAt); a registered one answers or throws.
    const query = (name, args) => { try { return runtime.sdk.query(name, args); } catch { return null; } };
    const bar = ui.screens.list('screen').filter(entry => activeNow(entry.screen, null, query).on).map(entry => entry.id);
    return { tabs: ui.mounts.tab.register(), bar, query, close: () => runtime.turn.uninstall({ globalName: null }) };
}

const legacyHosts = [
    ['as shipped today, without the rules queries', () => createModule({ settings: () => ({}) })],
    ['with the rules queries registered but no pinned ruleset', () => mergeInto(createModule({ settings: () => ({}) }), rulesModule())],
];
for (const [name, make] of legacyHosts) {
    test(`an unpinned (legacy) chat ${name} shows exactly the old tabs and navigation: none of the five new pages`, async () => {
        const chat = await legacyChat(make());
        try {
            assert.equal(chat.query('rules.party', {}), null);
            assert.deepEqual(chat.tabs, LEGACY_TABS);
            assert.deepEqual(chat.bar.filter(id => NEW_PAGES.includes(id)), []);
            assert.ok(chat.bar.includes('rpg-battle/party') && chat.bar.includes('rpg-battle/trade') && chat.bar.includes('rpg-battle/crafting'));
        } finally { chat.close(); }
    });
}

test('a pinned chat shows the five new pages, with and without a character, and an unpinned real world shows none', async t => {
    const screens = createModule().screens;
    const query = w => (name, args) => w.q(name, args);
    const on = w => NEW_PAGES.filter(id => activeNow(screens.find(screen => screen.id === id), w.head(), query(w)).on);
    const pinned = await realWorld(t, {});
    assert.deepEqual(on(pinned), NEW_PAGES);
    const fresh = await realWorld(t, { character: false });
    assert.deepEqual(on(fresh), NEW_PAGES, 'pinned, no character yet: the pages show their create state');
    const legacy = await realWorld(t, { pin: false });
    assert.equal(legacy.q('rules.party'), null);
    assert.deepEqual(on(legacy), [], 'a legacy character with no pin: no new page');
});
