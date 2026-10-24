// The Party tab's minimal renderer against the fake DOM: what it shows from the head state and
// which command each button sends. Kept small on purpose until the UI spec (SPEC §13) lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { byName, capture, makeState, pcOf, run, withPc } from './helpers/fake-ctx.js';
import { part } from '../../../src/v2/party/index.js';

const doc = installFakeDom();
const render = part.tabs[0].render;

function recorder(answer = { ok: true }) {
    const calls = [];
    return { calls, api: { command: async (type, payload, options) => { calls.push({ type, payload, options }); return answer; } } };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('no character yet: the create form sends party.create', async () => {
    const pane = doc.createElement('div');
    const { calls, api } = recorder();
    render(pane, { state: makeState() }, api);
    assert.equal(pane.querySelectorAll('.rpg-party-actor').length, 0);
    pane.querySelector('.rpg-party-name').value = 'Ren';
    pane.querySelector('.rpg-party-preset').value = 'caster';
    pane.querySelector('.rpg-party-create-go').click();
    await settle();
    assert.deepEqual(calls, [{ type: 'party.create', payload: { name: 'Ren', preset: 'caster' }, options: { cause: 'ui' } }]);
});

test('members, offers and their buttons', async () => {
    let state = run(withPc({ name: 'Ren', preset: 'fighter' }), 'party.grantXp', { xp: 100 }).state;
    state = run(state, 'party.addCompanion', { name: 'Lyra', role: 'ranger', level: 2 }).state;
    state = capture(state, '+ join Bram — a smith').state;
    const pane = doc.createElement('div');
    const { calls, api } = recorder();
    render(pane, { state }, api);
    assert.equal(pane.querySelector('.rpg-party-create'), null);
    assert.deepEqual(texts(pane, '.rpg-party-title'), ['Ren (you) · Lv 2 · XP 0', 'Lyra — ranger · Lv 2 · XP 0']);
    assert.match(texts(pane, '.rpg-party-pools')[0], /^HP \d+\/\d+ · MP \d+\/\d+ · SP \d+\/\d+$/);
    assert.match(pane.querySelector('.rpg-party-offer').textContent, /Bram asks to join \(smith\)/);
    const ren = pane.querySelector(`[data-actor="${pcOf(state).id}"]`);
    assert.equal(ren.querySelectorAll('.rpg-party-spend').length, 7, 'a + per stat while points are left');
    ren.querySelector('[data-stat="VIT"] .rpg-party-spend').click();
    ren.querySelector('[data-skill="Sweep"] .rpg-party-toggle').click();
    ren.querySelector('[data-skill="Sweep"] .rpg-party-forget').click();
    pane.querySelector('.rpg-party-accept').click();
    pane.querySelector('.rpg-party-dismiss').click();
    await settle();
    const offer = Object.values(state.domains.party.offers)[0].id;
    const id = pcOf(state).id;
    assert.deepEqual(calls.map(call => [call.type, call.payload]), [
        ['party.spend', { actor: id, points: { VIT: 1 } }],
        ['party.setSkillActive', { actor: id, name: 'Sweep', active: false }],
        ['party.forgetSkill', { actor: id, name: 'Sweep' }],
        ['party.acceptOffer', { offer }],
        ['party.dismissOffer', { offer }],
    ]);
    const lyra = pane.querySelector(`[data-actor="${byName(state, 'Lyra').id}"]`);
    assert.equal(lyra.querySelectorAll('.rpg-party-spend').length, 0, 'auto companions spent theirs');
});

test('a refused command shows its message', async () => {
    const pane = doc.createElement('div');
    const { api } = recorder({ ok: false, code: 'REFUSED', message: 'Ren already uses 6 skills: set one aside first.' });
    render(pane, { state: withPc({ name: 'Ren', preset: 'fighter' }) }, api);
    pane.querySelector('[data-skill="Sweep"] .rpg-party-toggle').click();
    await settle();
    assert.equal(pane.querySelector('.rpg-party-status').textContent, 'Ren already uses 6 skills: set one aside first.');
});
