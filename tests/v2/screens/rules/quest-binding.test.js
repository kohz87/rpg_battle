import test from 'node:test';
import assert from 'node:assert/strict';
import { renderQuestBinding } from '../../../../src/v2/screens/rules/widgets.js';
import { installDom } from '../helpers/dom.js';
import { settle } from './helpers.js';

test('Make this a quest requires an explicit template and shows every opening refusal through the command widget', async () => {
    const doc = installDom(); const host = doc.createElement('div'); doc.body.append(host);
    const requests = [];
    renderQuestBinding(host, { id: 'th_00000001', text: 'Hunt', templates: [{ id: 'pack.test/hunt', name: 'Hunt', kinds: ['kill'] }] }, {
        command: (type, payload) => { requests.push({ type, payload }); return { ok: false, code: 'REFUSED', message: 'The area forbids this foe.' }; },
    });
    const button = host.querySelector('.rpg-cb-go'); assert.equal(button.disabled, true);
    const select = host.querySelector('select'); select.value = 'pack.test/hunt'; select.dispatch('change');
    host.querySelectorAll('input')[1].value = 'pack.test/wolf~ash-wolf';
    host.querySelectorAll('input')[1].dispatch('input');
    button.dispatch('click'); await settle();
    assert.deepEqual(requests, [{ type: 'quest.open', payload: { id: 'th_00000001', template: 'pack.test/hunt', text: 'Hunt', foe: 'pack.test/wolf~ash-wolf' } }]);
    assert.match(host.querySelector('[role="alert"]').textContent, /area forbids this foe/);
});
