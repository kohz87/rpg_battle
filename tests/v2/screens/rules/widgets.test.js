// The four widgets of the rules screens (src/v2/screens/rules/widgets.js), driven directly: what they draw, what they send,
// what they refuse to do on their own, and that nothing from data is ever read as markup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    COMMAND_BUTTON_WIDGET, COMMAND_INPUT_WIDGET, CLASS_PICK_WIDGET, PERMANENT_CHOICE_WIDGET, SHOW_MORE_WIDGET, choiceOutcomeText, putAt, renderClassPick, renderCommandButton,
    renderCommandInput, renderPermanentChoice, rulesWidgets,
} from '../../../../src/v2/screens/rules/widgets.js';
import { installDom } from '../helpers/dom.js';
import { settle } from './helpers.js';

const setup = () => {
    const doc = installDom();
    const host = doc.createElement('div');
    doc.body.append(host);
    return { doc, host };
};
const opts = [{ id: 'x/one', label: 'One', sub: 'first' }, { id: 'x/two', label: 'Two <b>2</b>', sub: '<i>second</i>' }];
const spec = (extra = {}) => ({ command: 'class.choose', field: 'class', label: 'Promotion', confirm: 'Promote', warning: 'Permanent.', base: { actor: 'ac_00000001', milestone: 10 }, options: opts, ...extra });
const text = node => String(node?.textContent ?? '');

test('the widget set includes the five, each with a render and a validate that accepts nothing but an object', () => {
    assert.deepEqual(Object.keys(rulesWidgets).sort(), [CLASS_PICK_WIDGET, COMMAND_BUTTON_WIDGET, COMMAND_INPUT_WIDGET, PERMANENT_CHOICE_WIDGET, 'rpg-battle.quest-binding', 'rpg-battle.trainer-binding', SHOW_MORE_WIDGET].sort());
    for (const widget of Object.values(rulesWidgets)) {
        assert.equal(typeof widget.render, 'function');
        assert.deepEqual(widget.validate({}), []);
        assert.deepEqual(widget.validate({ value: null }), []);
        assert.equal(widget.validate({ value: [1] }).length, 1);
    }
});

test('permanent-choice: nothing is chosen at the start, Confirm waits, and the payload is the base plus the one chosen field', async () => {
    const { host } = setup();
    const sent = [];
    renderPermanentChoice(host, { value: spec() }, { command: (type, payload) => { sent.push({ type, payload }); return { ok: true }; } });
    const confirm = host.querySelector('.rpg-pc-confirm');
    assert.equal(confirm.disabled, true);
    assert.equal(host.querySelectorAll('.rpg-pc-option').length, 2);
    assert.equal(host.querySelectorAll('.rpg-pc-option').filter(node => node.getAttribute('aria-pressed') === 'true').length, 0);
    confirm.dispatch('click');
    await settle();
    assert.deepEqual(sent, [], 'a disabled Confirm sends nothing');
    host.querySelector('[data-choice="x/two"]').dispatch('click');
    assert.equal(host.querySelector('[data-choice="x/two"]').getAttribute('aria-pressed'), 'true');
    host.querySelector('[data-choice="x/two"]').dispatch('click');
    assert.equal(confirm.disabled, true, 'pressing it again clears it');
    host.querySelector('[data-choice="x/one"]').dispatch('click');
    confirm.dispatch('click');
    await settle();
    assert.deepEqual(sent, [{ type: 'class.choose', payload: { actor: 'ac_00000001', milestone: 10, class: 'x/one' } }]);
    assert.match(text(host.querySelector('.rpg-pc-status')), /Promoted to One/);
    assert.equal(confirm.disabled, true, 'the choice is spent');
});

test('permanent-choice: a second press while the first runs is ignored, and a refusal keeps the choice and says why', async () => {
    const { host } = setup();
    let release;
    const sent = [];
    renderPermanentChoice(host, { value: spec({ command: 'path.choose', field: 'option' }) }, { command: (type, payload) => { sent.push({ type, payload }); return new Promise(resolve => { release = resolve; }); } });
    host.querySelector('[data-choice="x/one"]').dispatch('click');
    const confirm = host.querySelector('.rpg-pc-confirm');
    confirm.dispatch('click');
    confirm.dispatch('click');
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(confirm.disabled, true, 'busy');
    release({ ok: false, code: 'STALE', message: '' });
    await settle();
    assert.match(text(host.querySelector('.rpg-pc-problem')), /changed since it was drawn/);
    assert.equal(confirm.disabled, false);
    assert.equal(host.querySelector('[data-choice="x/one"]').getAttribute('aria-pressed'), 'true', 'still the reader\'s choice, to confirm or change');
    assert.equal(text(host.querySelector('.rpg-pc-status')), '');
});

test('permanent-choice: a command that throws reads as a plain failure; no command api draws and sends nothing', async () => {
    const { host } = setup();
    renderPermanentChoice(host, { value: spec() }, { command: () => { throw new Error('boom'); } });
    host.querySelector('[data-choice="x/one"]').dispatch('click');
    host.querySelector('.rpg-pc-confirm').dispatch('click');
    await settle();
    assert.equal(text(host.querySelector('.rpg-pc-problem')), 'That did not work.');
    const bare = setup().host;
    renderPermanentChoice(bare, { value: spec() }, {});
    bare.querySelector('[data-choice="x/one"]').dispatch('click');
    bare.querySelector('.rpg-pc-confirm').dispatch('click');
    await settle();
    assert.equal(text(bare.querySelector('.rpg-pc-problem')), '');
});

test('permanent-choice: option labels, notes and the warning are text; no element is made from them', () => {
    const { host } = setup();
    renderPermanentChoice(host, { value: spec({ warning: '<script>1</script>' }) }, {});
    assert.equal(host.querySelectorAll('b').length, 0);
    assert.equal(host.querySelectorAll('i').length, 0);
    assert.equal(host.querySelectorAll('script').length, 0);
    assert.equal(text(host.querySelector('[data-choice="x/two"] .rpg-pc-label')), 'Two <b>2</b>');
    assert.equal(text(host.querySelector('[data-choice="x/two"] .rpg-pc-sub')), '<i>second</i>');
    assert.equal(text(host.querySelector('.rpg-pc-warning')), '<script>1</script>');
});

test('permanent-choice: options without an id are left out; an empty spec draws an empty, inert group', async () => {
    const { host } = setup();
    renderPermanentChoice(host, { value: spec({ options: [{ label: 'no id' }, null, 'x', { id: 'ok/id', label: 'Fine' }] }) }, {});
    assert.equal(host.querySelectorAll('.rpg-pc-option').length, 1);
    const empty = setup().host;
    renderPermanentChoice(empty, {}, { command: () => { throw new Error('never'); } });
    assert.equal(empty.querySelectorAll('.rpg-pc-option').length, 0);
    empty.querySelector('.rpg-pc-confirm').dispatch('click');
    await settle();
});

test('choiceOutcomeText: promotion, path and other', () => {
    assert.equal(choiceOutcomeText('class.choose', 'Duelist', { ok: true, receipt: { data: { v2: { result: { skills: ['a', 'b', 'c'] } } } } }),
        'Promoted to Duelist. All three skills were swapped; each starts at 0 / 5.');
    assert.equal(choiceOutcomeText('path.choose', 'Path A', { ok: true }), 'Path chosen: Path A.');
    assert.equal(choiceOutcomeText('x', 'Y', {}), 'Done: Y.');
});

test('class-pick: writes the draft field, clears on a second press, follows the draft\'s own value, and says when there is nothing to pick', () => {
    const { host } = setup();
    const writes = [];
    const widget = renderClassPick(host, { value: { field: 'class', options: opts, label: 'Basic class' }, picked: '' }, { draft: { set: (path, value) => writes.push([path, value]) } });
    assert.equal(host.querySelector('.rpg-cp').getAttribute('aria-label'), 'Basic class');
    assert.equal(host.querySelectorAll('.rpg-cp-card').filter(card => card.getAttribute('aria-pressed') === 'true').length, 0);
    host.querySelector('[data-choice="x/one"]').dispatch('click');
    assert.equal(host.querySelector('[data-choice="x/one"]').getAttribute('aria-pressed'), 'true');
    assert.equal(text(host.querySelector('.rpg-cp-tick')), 'Chosen');
    widget.update({ value: { field: 'class', options: opts }, picked: 'x/two' });
    assert.equal(host.querySelector('[data-choice="x/two"]').getAttribute('aria-pressed'), 'true');
    host.querySelector('[data-choice="x/two"]').dispatch('click');
    assert.deepEqual(writes, [['class', 'x/one'], ['class', '']]);
    widget.update({ value: { field: 'class', options: [], empty: 'Nothing yet.' }, picked: '' });
    assert.equal(text(host.querySelector('.rpg-cp-none')), 'Nothing yet.');
    const noDraft = setup().host;
    renderClassPick(noDraft, { value: { field: 'class', options: opts } }, {});
    noDraft.querySelector('[data-choice="x/one"]').dispatch('click');
    assert.equal(noDraft.querySelector('[data-choice="x/one"]').getAttribute('aria-pressed'), 'false', 'with nowhere to write, nothing looks chosen');
});

test('command-input: puts the typed value at the path, trims and cuts it, refuses an empty or non-numeric one itself', async () => {
    const { host } = setup();
    const sent = [];
    renderCommandInput(host, { value: { command: 'atlas.region', valueAt: 'name', payload: { expectedHash: 'h' }, label: 'New region', submit: 'Add', max: 6 } }, { command: (type, payload) => { sent.push({ type, payload }); return { ok: true }; } });
    const go = host.querySelector('.rpg-ci-go');
    const input = host.querySelector('.rpg-ci-input');
    go.dispatch('click');
    await settle();
    assert.equal(text(host.querySelector('.rpg-ci-status')), 'Type something first.');
    assert.deepEqual(sent, []);
    input.value = '  Westmarch  ';
    go.dispatch('click');
    await settle();
    assert.deepEqual(sent, [{ type: 'atlas.region', payload: { expectedHash: 'h', name: 'Westma' } }]);
    assert.equal(text(host.querySelector('.rpg-ci-status')), 'Saved.');
    assert.equal(input.value, '', 'cleared after a save');

    const numeric = setup().host;
    const out = [];
    renderCommandInput(numeric, { value: { command: 'atlas.dangerSet', valueAt: 'policy.tier', numeric: true, payload: { scope: 'world', policy: { tier: 0, lore: [] } } } }, { command: (type, payload) => { out.push(payload); return { ok: true }; } });
    numeric.querySelector('.rpg-ci-input').value = 'abc';
    numeric.querySelector('.rpg-ci-go').dispatch('click');
    await settle();
    assert.equal(text(numeric.querySelector('.rpg-ci-status')), 'That is not a number.');
    numeric.querySelector('.rpg-ci-input').value = '7';
    numeric.querySelector('.rpg-ci-go').dispatch('click');
    await settle();
    assert.deepEqual(out, [{ scope: 'world', policy: { tier: 7, lore: [] } }]);
});

test('command-input: a refusal is shown and the field keeps what was typed; the payload given is never changed', async () => {
    const { host } = setup();
    const base = { expectedHash: 'h' };
    renderCommandInput(host, { value: { command: 'checks.actor', valueAt: 'name', payload: base } }, { command: () => ({ ok: false, code: 'CONFLICT', message: 'That name is taken.' }) });
    host.querySelector('.rpg-ci-input').value = 'Mira';
    host.querySelector('.rpg-ci-go').dispatch('click');
    await settle();
    assert.equal(text(host.querySelector('.rpg-ci-status')), 'That name is taken.');
    assert.equal(host.querySelector('.rpg-ci-input').value, 'Mira');
    assert.deepEqual(base, { expectedHash: 'h' });
});

test('putAt: a nested path, a copy, and no prototype tricks', () => {
    const base = { a: { b: 1 } };
    assert.deepEqual(putAt(base, 'a.c', 2), { a: { b: 1, c: 2 } });
    assert.deepEqual(base, { a: { b: 1 } });
    assert.deepEqual(putAt({}, '__proto__.polluted', 1), {});
    assert.deepEqual(putAt({}, 'constructor.x', 1), {});
    assert.equal({}.polluted, undefined);
    assert.deepEqual(putAt(null, 'name', 'x'), { name: 'x' });
});

test('command-button: sends a copy of the exact payload, once at a time; disabled sends nothing; a refusal is shown beside it', async () => {
    const { host } = setup();
    const payload = { actors: ['ac_00000001', 'ac_00000002'], note: 'He said "hi" \\ ok' };
    const sent = [];
    let answer = { ok: true };
    const widget = renderCommandButton(host, { value: { command: 'party.setActive', payload, label: 'Make active', tone: 'primary', title: 'Moves them' } }, { command: (type, body) => { sent.push({ type, body }); return answer; } });
    const button = host.querySelector('.rpg-cb-go');
    assert.equal(text(button), 'Make active');
    assert.ok(button.classList.contains('ss-button-primary'));
    assert.equal(button.getAttribute('title'), 'Moves them');
    button.dispatch('click');
    await settle();
    assert.deepEqual(sent[0], { type: 'party.setActive', body: payload }, 'quotes and backslashes arrive unchanged');
    assert.notEqual(sent[0].body, payload, 'a copy');
    answer = { ok: false, code: 'REFUSED', message: 'No.' };
    button.dispatch('click');
    await settle();
    assert.equal(text(host.querySelector('.rpg-cb-problem')), 'No.');
    widget.update({ value: { command: 'party.setActive', payload, label: 'Make active', disabled: true } });
    assert.equal(button.disabled, true);
    button.dispatch('click');
    await settle();
    assert.equal(sent.length, 2);
});

test('command-button: label and title are text, however they are written', () => {
    const { host } = setup();
    renderCommandButton(host, { value: { command: 'x.y', payload: {}, label: '<b>Go</b>', title: '<i>t</i>' } }, {});
    assert.equal(host.querySelectorAll('b').length, 0);
    assert.equal(text(host.querySelector('.rpg-cb-go')), '<b>Go</b>');
});


test('clearing the optional check actor writes null, which creation.finish accepts as the default', () => {
    const { host } = setup();
    const writes = [];
    renderClassPick(host, { value: { field: 'checkActor', options: [{ id: 'ca_00000001', label: 'Astra' }] } }, {
        draft: { set: (key, value) => writes.push([key, value]) },
    });
    host.querySelector('button').dispatch('click');
    host.querySelector('button').dispatch('click');
    assert.deepEqual(writes, [['checkActor', 'ca_00000001'], ['checkActor', null]]);
});

test('class-pick: each class is a card (title, skills on their own line, a Chosen badge) and the keyboard focus stays on the card pressed', () => {
    const { doc, host } = setup();
    renderClassPick(host, { value: { field: 'class', options: opts, label: 'Basic class' }, picked: '' }, { draft: { set: () => {} } });
    const card = host.querySelector('[data-choice="x/one"]');
    assert.equal(text(card.querySelector('.cc-card-name')), 'One');
    assert.equal(text(card.querySelector('.cc-card-note')), 'first');
    assert.match(card.className, /\bcc-card\b.*\bcc-row\b|\bcc-row\b.*\bcc-card\b/);
    card.focus();
    card.dispatch('click');
    const again = host.querySelector('[data-choice="x/one"]');
    assert.equal(text(again.querySelector('.cc-card-tick')), 'Chosen');
    assert.equal(doc.activeElement, again, 'the redrawn card has the focus');
});
