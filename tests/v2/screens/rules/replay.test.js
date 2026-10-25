// Track C fixture C14 (replay in the UI): a swipe, a re-read or a deleted middle reply takes away what a choice, a reward or a
// save depended on. The screens then show those as gone or inactive on the next drawing, in the owner's words, and never put
// something else in their place: no option is picked for the reader, no reward is paid again by itself, no other save is
// listed. They have no handler to rerun and no die to roll; they only read again.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { progressScreen, questsScreen, setupScreen } from '../../../../src/v2/screens/rules/screens.js';
import { renderPermanentChoice } from '../../../../src/v2/screens/rules/widgets.js';
import { failureLine } from '../../../../src/v2/screens/rules/format.js';
import { installDom } from '../helpers/dom.js';
import { C14, PC, QF, answers, c02, c05, seed } from './fixtures.js';
import { all, drawOver, settle, skip, text, widgetsIn } from './helpers.js';

const options = ids => ids.map(id => ({ id, label: id, sub: '' }));

test('C14 replay: deleting an earlier prerequisite closes the promotion that depended on it, and nothing is picked or sent', { skip }, () => {
    const table = c02({ uses: [35, 35, 35] }).answers;
    const { drawn: d } = drawOver(progressScreen, table);
    assert.equal(widgetsIn(d.el, 'rpg-battle.permanent-choice').length, 1);
    // The reply that paid the last use is deleted: the form is back at 4 / 5.
    Object.assign(table, c02({ uses: [35, 35, 22] }).answers);
    d.rerender();
    assert.equal(widgetsIn(d.el, 'rpg-battle.permanent-choice').length, 0);
    assert.deepEqual(all(d.el, '.skill').map(node => text(node.querySelector('.skill-note'))).length, 3);
    assert.match(text(all(d.el, '.promotions .why')[0]), /Needs all three forms at 5 \/ 5 \(2 of 3\)/);
    assert.equal(all(d.el, '[aria-pressed="true"]').length, 0);
    assert.deepEqual(d.commands, []);
});

test('C14 replay: a path step whose parent was deleted is closed with its reason; nothing is chosen in its place', { skip }, () => {
    const table = c05().answers;
    const { drawn: d } = drawOver(progressScreen, table);
    assert.equal(widgetsIn(d.el, 'rpg-battle.permanent-choice').length, 3);
    Object.assign(table, c05({ missingParent: true }).answers);
    d.rerender();
    assert.equal(widgetsIn(d.el, 'rpg-battle.permanent-choice').length, 0);
    assert.equal(all(d.el, '.rpg-pc-option').length, 0, 'no replacement option is offered');
    assert.match(text(all(d.el, '.pathways .why')[0]), /Nothing was chosen in its place/);
    assert.deepEqual(d.commands, []);
});

test('C14 replay: an option the reader had pressed but not confirmed is dropped when it is no longer offered, and not replaced', { skip }, async () => {
    const doc = installDom();
    const host = doc.createElement('div');
    doc.body.append(host);
    const sent = [];
    const api = { command: (type, payload) => { sent.push({ type, payload }); return { ok: true }; } };
    const spec = { command: 'path.choose', field: 'option', label: 'Step', confirm: 'Take', base: { actor: PC }, options: options(['a', 'b', 'c']) };
    const widget = renderPermanentChoice(host, { value: spec }, api);
    const node = id => host.querySelector(`.rpg-pc-option[data-choice="${id}"]`);
    node('a').dispatch('click');
    assert.equal(host.querySelector('.rpg-pc-confirm').disabled, false);
    widget.update({ value: { ...spec, options: options(['b', 'c']) } });
    assert.equal(host.querySelector('.rpg-pc-confirm').disabled, true, 'the choice that vanished leaves nothing to confirm');
    assert.equal(host.querySelectorAll('.rpg-pc-option').filter(option => option.getAttribute('aria-pressed') === 'true').length, 0, 'and nothing else is picked');
    widget.update({ value: spec });
    assert.equal(node('a').getAttribute('aria-pressed'), 'false', 'it does not come back by itself');
    host.querySelector('.rpg-pc-confirm').dispatch('click');
    await settle();
    assert.deepEqual(sent, []);
});

test('C14 replay: a reward whose carrier was deleted is no longer shown as paid; Hand in returns and waits for the reader', { skip }, () => {
    const paid = { ...QF.C07.queries['rules.quests'][0], state: 'done', deadline: null, ready: false, blocked: [], remainingMinutes: null,
        settlement: { id: 'st_00000011', source: seed.source, outcome: 'done', coinPaid: 30, xpPaid: 25, itemsPaid: [], claim: 'rb:ep_00000001:quest:th_job00001:1:settled' } };
    const table = answers({ 'rules.quests': [paid] });
    const { drawn: d } = drawOver(questsScreen, table);
    assert.match(text(d.el.querySelector('.line.settled')), /Paid: 30 coin, 25 XP\./);
    assert.equal(all(d.el, 'article.quest button').length, 0);
    // The settlement block is skipped with its payout, closure and claim: the quest is active again, ready, unpaid.
    table['rules.quests'] = [{ ...paid, state: 'active', settlement: null, ready: true }];
    d.rerender();
    assert.equal(d.el.querySelector('.line.settled'), null, 'no payment is shown');
    assert.deepEqual(all(d.el, 'article.quest button').map(text), ['Hand in', 'Give up']);
    assert.deepEqual(d.commands, [], 'and it is not handed in by itself');
});

test('C14 replay: a save a deleted reply carried is not listed, and no other save stands in for it', { skip }, () => {
    const table = answers({ 'savepoint.list': C14.savesBefore() });
    const { drawn: d } = drawOver(setupScreen, table);
    assert.deepEqual(all(d.el, 'li.point .row-head b').map(text), ['Day 10 start', 'Before the mill']);
    table['savepoint.list'] = C14.savesAfter();
    d.rerender();
    assert.deepEqual(all(d.el, 'li.point .row-head b').map(text), ['Day 10 start']);
    assert.equal(all(d.el, 'li.point').filter(node => node.classList.contains('missing')).length, 0);
});

test('C14 replay: a save whose saved copy is missing says so and is not swapped for another', { skip }, () => {
    const table = answers({ 'savepoint.list': C14.missingBytes() });
    const { drawn: d } = drawOver(setupScreen, table);
    const [row] = all(d.el, 'li.point');
    assert.ok(row.classList.contains('missing'));
    assert.match(text(row.querySelector('.miss')), /saved copy for this point is missing\. A return will stop and say so; it will not use a different save\./);
    assert.equal(all(d.el, 'li.point').length, 1, 'no other point appears in its place');
});

test('C14 replay: the refusal for a removed prerequisite reads in plain words everywhere a command can be refused', { skip }, async () => {
    assert.deepEqual(C14.result, { ok: false, code: 'REPLAY_PREREQUISITE', message: 'The earlier prerequisite was removed.' });
    assert.equal(failureLine(C14.result), 'The earlier prerequisite was removed.');
    assert.match(failureLine({ ok: false, code: 'REPLAY_PREREQUISITE', message: '' }), /earlier step this depended on was removed, so this choice is no longer valid/);
    // The same line in a command button (roster) and a field (links).
    const { drawn: d } = drawOver(setupScreen, answers(), { result: () => C14.result });
    const save = all(d.el, '.rpg-cb-go').find(node => text(node) === 'Save now');
    save.dispatch('click');
    await settle();
    assert.equal(text(all(d.el, '.rpg-cb-problem').find(node => text(node) !== '')), 'The earlier prerequisite was removed.');
    assert.deepEqual(d.commands, [{ type: 'savepoint.make', payload: {} }]);
});

test('C14 replay: a limit on manual saves is said when the eleventh is refused', { skip }, async () => {
    const { drawn: d } = drawOver(setupScreen, answers(), { result: () => ({ ok: false, code: 'LIMITED', message: '' }) });
    const form = widgetsIn(d.el, 'rpg-battle.command-input')[0].querySelector('form');
    form.querySelector('.rpg-ci-input').value = 'Before the bridge';
    form.querySelector('.rpg-ci-go').dispatch('click');
    await settle();
    assert.deepEqual(d.commands, [{ type: 'savepoint.make', payload: { name: 'Before the bridge' } }]);
    assert.equal(text(form.querySelector('.rpg-ci-status')), 'A limit has been reached.');
});
