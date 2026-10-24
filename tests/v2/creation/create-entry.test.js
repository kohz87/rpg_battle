// Ways into the creation wizard before a character exists (MODULES §F12): the widget
// `rpg-battle.create-character` on the Party screen's empty state, the HUD strip and the card under a
// reply; the party part's canGenerate words for Story Block's Home button; and what happens without
// Story Block's dialog (a plain line, never a silent click).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATE_BUTTON_WIDGET, CREATE_LABEL, CREATE_SCREEN_ID, createButton, creationApi, onBlocked, openCreation } from '../../../src/v2/creation/index.js';
import { canGenerate } from '../../../src/v2/party/index.js';
import { canGenerate as deadCheck } from '../../../src/v2/return/index.js';
import { rpgBattleModule } from '../../../src/v2/module.js';
import { hudScreen, partyScreen, statusCardScreen } from '../../../src/v2/screens/index.js';
import { installDom } from '../screens/helpers/dom.js';
import { renderer, rendererMissing } from '../screens/helpers/runtime.js';
import { emptyState, makeState } from '../screens/helpers/state.js';

const skip = renderer ? false : rendererMissing;
const helpers = renderer ? await import('../screens/helpers/render.js') : null;
const all = (root, selector) => [...root.querySelectorAll(selector)];

// A dialog api like Story Block's sdk / widget api: `open` (and `current` unless `withCurrent` is false).
function fakeDialog({ withCurrent = true } = {}) {
    const opened = [];
    const dialog = {
        open(screenId, opts) {
            const handle = { screenId, opts, open: true, root: { addEventListener() {} }, isOpen() { return this.open; }, close() { this.open = false; } };
            opened.push(handle);
            return handle;
        },
        ...(withCurrent ? { current: () => opened.filter(handle => handle.isOpen()).at(-1) ?? null } : {}),
    };
    return { dialog, opened };
}

async function withGlobalSdk(sdk, fn) {
    const before = globalThis.StoryBlock;
    try {
        globalThis.StoryBlock = sdk ? { sdk } : undefined;
        return await fn();
    } finally {
        globalThis.StoryBlock = before;
    }
}

test('party screen, no character: "Create your character" opens the wizard through the widget api', { skip }, async () => {
    const { dialog, opened } = fakeDialog();
    const drawn = helpers.draw(partyScreen, emptyState(), { dialog });
    assert.deepEqual(drawn.warnings, []);
    const go = drawn.el.querySelector('.empty .rpg-create-go');
    assert.ok(go, 'the button is in the empty state');
    assert.equal(go.textContent, CREATE_LABEL);
    go.click();
    assert.equal(opened.length, 1);
    assert.equal(opened[0].screenId, CREATE_SCREEN_ID);
    assert.equal(opened[0].opts.submitLabel, 'Create');
    assert.deepEqual(Object.keys(opened[0].opts.draft).sort(), ['background', 'name', 'points', 'portrait', 'preset', 'race', 'talents']);
    go.click();
    assert.equal(opened.length, 1, 'clicked again while it is open: the same window');
    assert.equal(drawn.el.querySelector('.rpg-create-note').hidden, true);
});

test('with a character: the Party screen has cards and no Create button; the HUD neither', { skip }, () => {
    for (const screen of [partyScreen, hudScreen, statusCardScreen]) {
        const drawn = helpers.draw(screen, makeState(), { dialog: fakeDialog().dialog });
        assert.equal(all(drawn.el, '.rpg-create-go').length, 0, screen.id);
    }
});

test('HUD and the card under a reply: a Create button before a character exists', { skip }, () => {
    for (const [screen, label] of [[hudScreen, 'Create'], [statusCardScreen, CREATE_LABEL]]) {
        const { dialog, opened } = fakeDialog();
        const drawn = helpers.draw(screen, emptyState(), { dialog });
        assert.deepEqual(drawn.warnings, [], screen.id);
        const go = drawn.el.querySelector('.rpg-create-go');
        assert.equal(go.textContent, label, screen.id);
        assert.ok(go.closest('.rpg-create').classList.contains('compact'), screen.id);
        go.click();
        assert.equal(opened.length, 1, screen.id);
    }
});

test('the widget falls back to Story Block\'s global sdk; with no dialog anywhere it says so plainly', async () => {
    const doc = installDom();
    const { dialog, opened } = fakeDialog({ withCurrent: false });
    await withGlobalSdk({ dialog, query: () => null }, () => {
        const el = doc.createElement('div');
        createButton.render(el, {}, { query: () => null });
        el.querySelector('.rpg-create-go').click();
        assert.equal(opened.length, 1, 'opened through globalThis.StoryBlock.sdk');
        el.querySelector('.rpg-create-go').click();
        assert.equal(opened.length, 1, 'no current() on that api: still the same window');
    });
    await withGlobalSdk(null, () => {
        const el = doc.createElement('div');
        createButton.render(el, {}, {});
        el.querySelector('.rpg-create-go').click();
        const note = el.querySelector('.rpg-create-note');
        assert.equal(note.hidden, false);
        assert.match(note.textContent, /cannot show the character creation window/);
    });
});

test('the widget hides while party.pc answers a character, and openCreation refuses through query alone', () => {
    const doc = installDom();
    const el = doc.createElement('div');
    const { dialog, opened } = fakeDialog();
    const api = { dialog, query: name => (name === 'party.pc' ? { id: 'ac_ren00001', name: 'Ren' } : null) };
    const handle = createButton.render(el, { label: 'Make\nme ' }, api);
    assert.equal(el.querySelector('.rpg-create').hidden, true);
    assert.equal(el.querySelector('.rpg-create-label').textContent, 'Make me');
    assert.equal(openCreation(api).code, 'REFUSED');
    assert.equal(opened.length, 0);
    handle.update({});
    assert.equal(el.querySelector('.rpg-create-label').textContent, CREATE_LABEL);
    handle.destroy();
    assert.equal(el.children.length, 0);
    assert.deepEqual(createButton.validate({ label: 3, compact: 'yes' }), ['label must be text.', 'compact must be true or false.']);
    assert.deepEqual(createButton.validate({}), []);
    const plain = {};
    assert.equal(creationApi(plain), plain, 'no dialog here or on the global sdk: the api as given');
});

test('canGenerate gives Story Block\'s Home the button words; a dead run asks for no button', async () => {
    assert.deepEqual(canGenerate({ state: emptyState() }), { ok: false, reason: 'Create your character first.', action: 'Create your character' });
    assert.deepEqual(canGenerate({ state: makeState() }), { ok: true });
    const merged = await rpgBattleModule.hooks.canGenerate({ state: emptyState(), settings: {}, query: () => null });
    assert.equal(merged.action, 'Create your character');
    const dead = makeState();
    dead.domains.party.actors[dead.domains.party.pc].conditions = [{ kind: 'dead' }];
    assert.deepEqual(deadCheck({ state: dead }).action, false);
});

test('Home\'s button runs the merged module\'s onBlocked, which opens the wizard through the host sdk', async () => {
    const { dialog, opened } = fakeDialog();
    await withGlobalSdk({ dialog, view: () => ({ state: emptyState() }) }, () => {
        rpgBattleModule.hooks.onBlocked('Create your character first.', 'rpg-battle');
        assert.equal(opened.length, 1);
        assert.equal(opened[0].screenId, CREATE_SCREEN_ID);
        onBlocked('Create your character first.', 'rpg-battle');
        assert.equal(opened.length, 1, 'open already: not a second');
    });
    assert.equal(CREATE_BUTTON_WIDGET, 'rpg-battle.create-character');
    assert.ok(rpgBattleModule.widgets[CREATE_BUTTON_WIDGET], 'the merged module registers the widget');
});
