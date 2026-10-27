// Make this a trainer (RB open trainers §10.2): the widget that picks someone who is here, a trainer template and the skills it teaches, and
// sends `trainer.open` through the refusal-reporting command button. Copy of quest-binding.test.js's checks, plus the narrowing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTrainerBinding, rulesWidgets } from '../../../../src/v2/screens/rules/widgets.js';
import { installDom } from '../helpers/dom.js';
import { settle } from './helpers.js';

const TEMPLATES = [
    { id: 'pack.test/drills', name: 'Blade drills', skills: [{ id: 'pack.test/thrust', name: 'Swift Thrust' }, { id: 'pack.test/turn', name: 'Parrying Turn' }, { id: 'pack.test/step', name: 'Poised Step' }] },
    { id: 'pack.test/lore', name: 'Hedge lessons', skills: [{ id: 'pack.test/spark', name: 'Spark Dart' }] },
];
const PEOPLE = ['Old Reka', 'Zed'];

function drawn(props = { people: PEOPLE, templates: TEMPLATES }, reply = { ok: true }) {
    const doc = installDom();
    const host = doc.createElement('div');
    doc.body.append(host);
    const requests = [];
    const widget = renderTrainerBinding(host, props, { command: (type, payload) => { requests.push({ type, payload }); return typeof reply === 'function' ? reply(type, payload) : reply; } });
    const selects = () => host.querySelectorAll('select');
    const pick = (label, value) => { const select = selects()[label === 'Person' ? 0 : 1]; select.value = value; select.dispatch('change'); };
    const boxes = () => host.querySelectorAll('.rpg-tb-skills input');
    return { host, requests, widget, pick, boxes, selects, button: () => host.querySelector('.rpg-cb-go'), doc };
}
const press = async w => { w.button().dispatch('click'); await settle(); };

test('the widget is registered under its name, and the button stays disabled until a person and a template are chosen', async () => {
    assert.ok(Object.hasOwn(rulesWidgets, 'rpg-battle.trainer-binding'));
    const w = drawn();
    assert.equal(w.button().textContent, 'Make this a trainer');
    assert.equal(w.button().disabled, true);
    w.pick('Person', 'Old Reka');
    assert.equal(w.button().disabled, true, 'a person alone is not enough');
    w.pick('Trainer template', 'pack.test/drills');
    assert.equal(w.button().disabled, false);
    w.pick('Person', '');
    assert.equal(w.button().disabled, true);
    await press(w);
    assert.deepEqual(w.requests, [], 'a disabled button sends nothing');
});

test('the exact payload: the person, the template, and nothing else when nothing was narrowed', async () => {
    const w = drawn();
    w.pick('Person', 'Zed');
    w.pick('Trainer template', 'pack.test/drills');
    assert.equal(w.boxes().length, 3, 'one box for each of the template\'s skills');
    assert.ok(w.boxes().every(box => box.checked), 'all ticked');
    await press(w);
    assert.deepEqual(w.requests, [{ type: 'trainer.open', payload: { name: 'Zed', template: 'pack.test/drills' } }]);
});

test('unticking narrows the list; ticking again widens it back; the text goes with it', async () => {
    const w = drawn();
    w.pick('Person', 'Old Reka');
    w.pick('Trainer template', 'pack.test/drills');
    const [thrust, turn, step] = w.boxes();
    turn.checked = false; turn.dispatch('change');
    const text = w.host.querySelector('.rpg-tb-text');
    text.value = '  light drills '; text.dispatch('input');
    await press(w);
    assert.deepEqual(w.requests.at(-1), { type: 'trainer.open', payload: { name: 'Old Reka', template: 'pack.test/drills', text: 'light drills', skills: ['pack.test/thrust', 'pack.test/step'] } });
    turn.checked = true; turn.dispatch('change');
    await press(w);
    assert.deepEqual(w.requests.at(-1).payload.skills, undefined, 'all ticked again: the whole list, so nothing is narrowed');
    for (const box of [thrust, turn, step]) { box.checked = false; box.dispatch('change'); }
    assert.equal(w.button().disabled, true, 'a trainer teaches at least one skill');
});

test('a skill that is not the template\'s cannot be sent: changing the template changes the boxes, and only its own ids can ever be sent', async () => {
    const w = drawn();
    w.pick('Person', 'Zed');
    w.pick('Trainer template', 'pack.test/drills');
    w.boxes()[0].checked = false; w.boxes()[0].dispatch('change');
    w.pick('Trainer template', 'pack.test/lore');
    assert.deepEqual(w.boxes().map(box => box.value), ['pack.test/spark']);
    assert.ok(w.boxes().every(box => box.checked), 'a new template starts with all its skills ticked');
    await press(w);
    assert.deepEqual(w.requests, [{ type: 'trainer.open', payload: { name: 'Zed', template: 'pack.test/lore' } }], 'no leftover from the other template');
    // A template that is not offered cannot be sent either, whatever the select is made to say.
    const sent = w.requests.length;
    w.pick('Trainer template', 'pack.test/other');
    assert.equal(w.button().disabled, true);
    await press(w);
    assert.equal(w.requests.length, sent);
});

test('a refusal is shown beside the button in its own words', async () => {
    const w = drawn(undefined, { ok: false, code: 'REFUSED', message: 'Drills does not teach pack.test/spark; a trainer teaches only what its template lists.' });
    w.pick('Person', 'Zed');
    w.pick('Trainer template', 'pack.test/drills');
    await press(w);
    assert.match(w.host.querySelector('[role="alert"]').textContent, /a trainer teaches only what its template lists/);
    const again = drawn(undefined, { ok: false, code: 'NOT_FOUND', message: 'Zed is not here.' });
    again.pick('Person', 'Zed'); again.pick('Trainer template', 'pack.test/lore');
    await press(again);
    assert.equal(again.host.querySelector('[role="alert"]').textContent, 'Zed is not here.');
});

test('update keeps what the reader chose while the same person and template are offered, and drops what is no longer offered', async () => {
    const w = drawn();
    w.pick('Person', 'Zed');
    w.pick('Trainer template', 'pack.test/drills');
    w.boxes()[1].checked = false; w.boxes()[1].dispatch('change');
    w.widget.update({ people: ['Zed', 'Mia'], templates: TEMPLATES });
    await press(w);
    assert.deepEqual(w.requests.at(-1).payload, { name: 'Zed', template: 'pack.test/drills', skills: ['pack.test/thrust', 'pack.test/step'] });
    w.widget.update({ people: ['Mia'], templates: TEMPLATES });
    assert.equal(w.button().disabled, true, 'Zed left: the choice is dropped, not replaced');
    w.widget.update({ people: ['Mia'], templates: [TEMPLATES[1]] });
    assert.equal(w.selects()[1].value, '', 'the template is gone');
});

test('nothing from the data is read as markup', () => {
    const w = drawn({ people: ['<img src=x onerror=alert(1)>'], templates: [{ id: 'pack.test/x', name: '<b>Bold</b>', skills: [{ id: 'pack.test/y', name: '<i>Skill</i>' }] }] });
    w.pick('Trainer template', 'pack.test/x');
    assert.equal(w.host.querySelectorAll('img').length, 0);
    assert.equal(w.host.querySelectorAll('b').length, 0);
    assert.equal(w.host.querySelectorAll('i').length, 0);
});

test('a widget given no props draws an empty, disabled form', () => {
    const w = drawn({});
    assert.equal(w.button().disabled, true);
    assert.equal(w.boxes().length, 0);
});
