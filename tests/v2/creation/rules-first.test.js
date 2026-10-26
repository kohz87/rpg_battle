// The wizard asks for the rules first. With a rules pack offered and none pinned (rules.selection 'offered'), every step
// shows the rules choice with Setup's own `rules.pin` button in place of its choices, and the You step has no Create, so the
// reader cannot spend a whole wizard before learning a pin was needed. Pinned, or with no pack installed (legacy), the steps
// are what they were. Run on the real module and the real host (the production boot), as tests/v2/rules/selection.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { CREATE_STEPS, createScreen, startDraft } from '../../../src/v2/creation/index.js';
import { smallRulesPack } from '../progress/helpers/fixture.js';
import { SD } from '../progress/helpers/world.js';
import { all, click, draw, text } from '../screens/helpers/render.js';

const original = globalThis.StoryBlock;
globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve({ settings: () => ({}), preflight: () => ({}), registerModule: async () => {} }) };
const { boot, booted } = await import('../../../index.js');
await booted;
if (original === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = original;

const director = { ...SD, version: '2.0.0' };
const ok = result => { assert.equal(result.ok, true, `${result.code}: ${result.message}`); return result; };

async function world(t, { packs = [smallRulesPack()] } = {}) {
    const h = await createHost({ modules: [director] });
    t.after(() => h.close());
    for (const pack of packs) ok(await h.packs.packs.install(pack));
    ok(await boot({ global: { StoryBlock: { apiVersion: 2, ready: Promise.resolve(h.sdk) } }, doc: null }));
    h.q = (name, args = {}) => h.sdk.query(name, args);
    const names = Object.keys(h.registry.module('rpg-battle').queries).concat(['packs.rules', 'packs.content', 'savepoint.list', 'savepoint.contract', 'director.time']);
    h.step = (id, draft = startDraft(null, { persona: { name: 'Astra', background: '', avatar: '' } })) => draw(
        { ...createScreen, template: CREATE_STEPS.find(step => step.id === id).template }, h.head(),
        { draft, queries: Object.fromEntries(names.map(name => [name, args => h.q(name, args)])), result: (type, payload) => h.sdk.command(type, payload) });
    return h;
}

test('offered and not pinned: every step shows "Choose your rules" with the Pin button, and none shows its choices or Create', async t => {
    const h = await world(t);
    assert.equal(h.q('rules.selection').state, 'offered');
    for (const { id } of CREATE_STEPS) {
        const d = h.step(id);
        assert.deepEqual(d.warnings, [], id);
        assert.equal(all(d.el, '.cc-gate').length, 1, `${id}: the rules choice`);
        assert.match(text(all(d.el, '.cc-gate')[0]), /Choose your rules/);
        assert.deepEqual(all(d.el, '.cc-gate-row button').map(text), ['Pin Fixture rules'], id);
        assert.match(text(all(d.el, '.cc-gate-name')[0]), /Fixture rules/);
        // The same summary row and layout, with the pin choice where the step's choices go.
        assert.deepEqual(all(d.el, '.cc-layout')[0].children.map(node => node.className.split(' ')[0]), ['cc-register', 'cc-gate'], `${id}: the summary, then the rules choice`);
        for (const gone of ['.cc-main', '.cc-card', '.rpg-preset', '.cc-go', '[data-submit]', 'form']) assert.equal(all(d.el, gone).length, 0, `${id}: no ${gone} before the pin`);
    }
});

test('offered: the Pin button sends the one rules.pin command with the exact offer; the next draw is the step itself', async t => {
    const h = await world(t);
    const offer = h.q('rules.selection').offers[0];
    const { name, ...choice } = offer;
    const draft = startDraft(null, { persona: { name: 'Astra', background: '', avatar: '' } });
    const d = h.step('start', draft);
    await click(all(d.el, '.cc-gate-row button')[0]);
    assert.equal(h.q('rules.selection').state, 'pinned', 'pinned through the wizard');
    assert.equal(h.sdk.receipts().map(({ receipt }) => receipt).filter(receipt => receipt.type === 'rules.pin').length, 1, 'one pin, one receipt');
    assert.deepEqual(h.sdk.receipts().map(({ receipt }) => receipt).find(receipt => receipt.type === 'rules.pin').data.v2.guard.predicate.payload, choice, 'the payload is the offer\'s');
    assert.equal(d.view.draft().rulesPinned, true, 'the draft is marked, so the dialog draws the step again');
    const after = h.step('start', draft);
    assert.deepEqual(after.warnings, []);
    assert.equal(all(after.el, '.cc-gate').length, 0);
    assert.equal(all(after.el, '.cc-layout > .cc-main').length, 1);
    assert.equal(all(after.el, '.cc-register').length, 1, 'the summary row');
    assert.equal(text(all(after.el, '.cc-review-rules')[0]), 'Fixture rules 2.0.0 (pinned)', 'the pinned rules are named in the row');
    assert.ok(all(after.el, '.rpg-cp-card').length > 0, 'the pinned pack\'s classes are listed');
    const you = h.step('you', draft);
    assert.equal(all(you.el, 'form[data-submit="creation.finish"]').length, 1);
    assert.equal(text(all(you.el, '.cc-go')[0]), 'Create Astra');
});

test('offered: creation.finish itself still refuses without a pin (the guard is not the screen\'s alone)', async t => {
    const h = await world(t);
    const out = await h.sdk.command('creation.finish', { name: 'Astra', race: '', talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, class: 'pack.fixture/c0', checkActor: null });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'REFUSED');
    assert.match(out.message, /Choose a rules pack in Setup/);
});

test('pinned already: the steps are the steps, with no rules choice', async t => {
    const h = await world(t);
    ok(await h.sdk.command('rules.pin', (({ name, ...choice }) => choice)(h.q('rules.selection').offers[0])));
    for (const { id } of CREATE_STEPS) {
        const d = h.step(id);
        assert.deepEqual(d.warnings, [], id);
        assert.equal(all(d.el, '.cc-gate').length, 0, id);
        assert.equal(all(d.el, '.cc-register').length, 1, `${id}: the summary row`);
    }
});

test('no rules pack installed (legacy): the steps are the steps, with no rules choice', async t => {
    const h = await world(t, { packs: [] });
    assert.equal(h.q('rules.selection').state, 'legacy');
    for (const { id } of CREATE_STEPS) {
        const d = h.step(id);
        assert.deepEqual(d.warnings, [], id);
        assert.equal(all(d.el, '.cc-gate').length, 0, id);
        assert.equal(all(d.el, '.cc-register').length, 1, id);
    }
    assert.equal(all(h.step('you').el, 'form[data-submit="creation.finish"]').length, 1);
});
