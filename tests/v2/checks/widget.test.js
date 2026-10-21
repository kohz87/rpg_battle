// The check card widget against the fake DOM: what it shows of a waiting check, the commands its
// buttons send, a rejection shown on the card, and a check no longer waiting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { part } from '../../../src/v2/checks/index.js';
import { capture, pcOf, pendingOf, run, toolsFor, withItem, withParty } from './helpers/fake-ctx.js';

const doc = installFakeDom();
const widget = part.widgets['rpg-battle.check-card'];
const settle = () => new Promise(resolve => setImmediate(resolve));

function scene() {
    let state = capture(withParty(), '? check stealth — slipping past the guard | dc: hard', { seed: 7 }).state;
    state = withItem(state, { id: 'grey-cloak', name: 'Grey Cloak', note: 'for slipping by', stack: 'it_cloak001' });
    const id = pendingOf(state)[0].id;
    state = run(state, 'check.addModifier', { id, source: 'custom', amount: -1, reason: 'wet boots' }).state;
    return { state, id };
}

function apiFor(state, answer = { ok: true }) {
    const calls = [];
    const tools = toolsFor(state);
    return {
        calls,
        api: {
            query: (name, args) => tools.query(name, args),
            command: async (type, payload, options) => { calls.push({ type, payload, options }); return answer; },
        },
    };
}

test('the card shows the check, its modifiers and suggestions, and sends commands', async () => {
    const { state, id } = scene();
    const el = doc.createElement('div');
    const { calls, api } = apiFor(state);
    const handle = widget.render(el, { id }, api);
    const card = el.querySelector('.rpg-check-card');
    assert.equal(card.getAttribute('data-check'), id);
    assert.equal(card.querySelector('.rpg-check-title').textContent, 'Ren — stealth (slipping past the guard)');
    assert.equal(card.querySelector('.rpg-check-dc').textContent, 'DC 20 (hard) · d20 + 1');
    assert.deepEqual(texts(card, '.rpg-check-mod-text'), ['DEX +2', 'wet boots −1']);
    assert.equal(card.querySelectorAll('.rpg-check-remove').length, 1, 'the stat cannot be removed');
    assert.deepEqual(texts(card, '.rpg-check-pick option'), ['item: Grey Cloak', 'custom reason']);

    card.querySelector('.rpg-check-add-go').click();                 // the first suggestion, +2
    card.querySelector('.rpg-check-pick').value = 'custom';
    card.querySelector('.rpg-check-amount').value = '-3';
    card.querySelector('.rpg-check-reason').value = 'the dogs';
    card.querySelector('.rpg-check-add-go').click();
    card.querySelector('.rpg-check-remove').click();
    card.querySelector('.rpg-check-roll').click();
    card.querySelector('.rpg-check-cancel').click();
    await settle();
    assert.deepEqual(calls.map(call => [call.type, call.payload]), [
        ['check.addModifier', { id, source: 'item', amount: 2, reason: 'Grey Cloak', stack: 'it_cloak001' }],
        ['check.addModifier', { id, source: 'custom', amount: -3, reason: 'the dogs' }],
        ['check.removeModifier', { id, index: 1 }],
        ['check.roll', { id }],
        ['check.cancel', { id }],
    ]);
    assert.ok(calls.every(call => call.options.cause === 'ui'));
    handle.destroy();
    assert.equal(el.querySelector('.rpg-check-card'), null);
});

test('a custom modifier without a reason is not sent; a rejection is shown', async () => {
    const { state, id } = scene();
    const el = doc.createElement('div');
    const { calls, api } = apiFor(state, { ok: false, code: 'REFUSED', message: 'Grey Cloak already counts for this check.' });
    widget.render(el, { id }, api);
    el.querySelector('.rpg-check-pick').value = 'custom';
    el.querySelector('.rpg-check-add-go').click();
    assert.equal(calls.length, 0);
    assert.equal(el.querySelector('.rpg-check-status').textContent, 'Give the custom modifier a reason.');
    el.querySelector('.rpg-check-pick').value = 's0';
    el.querySelector('.rpg-check-add-go').click();
    await settle();
    assert.equal(el.querySelector('.rpg-check-status').textContent, 'Grey Cloak already counts for this check.');
});

test('a rolled check shows its result; an unknown one says it is not waiting', async () => {
    const { state, id } = scene();
    const rolled = run(state, 'check.roll', { id }, { dice: [12] }).state;
    const el = doc.createElement('div');
    const handle = widget.render(el, { id }, apiFor(rolled).api);
    assert.equal(el.querySelector('.rpg-check-gone').textContent, 'Rolled: d20 12 + 1 = 13 against 20 (hard).');
    handle.update({ id: 'ck_00000000' });
    assert.equal(el.querySelector('.rpg-check-gone').textContent, 'This check is no longer waiting.');
    assert.equal(el.querySelector('.rpg-check-roll'), null);
    assert.deepEqual(widget.validate({ id: 3 }).length, 1);
    assert.deepEqual(widget.validate({ id }), []);
    assert.equal(typeof pcOf(state).id, 'string');
});

test('an async api works too', async () => {
    const { state, id } = scene();
    const el = doc.createElement('div');
    const tools = toolsFor(state);
    widget.render(el, { id }, { query: async (name, args) => tools.query(name, args), command: async () => ({ ok: true }) });
    await settle();
    assert.equal(el.querySelector('.rpg-check-title').textContent, 'Ren — stealth (slipping past the guard)');
});
