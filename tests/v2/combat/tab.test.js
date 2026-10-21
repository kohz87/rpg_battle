// The plain Fight tab (src/v2/combat/tab.js): it renders from the view's queries and acts only
// through api.command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { baseDomains, createWorld, line } from './helpers/fake-ctx.js';
import { part } from '../../../src/v2/combat/index.js';

function mount(world) {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const sent = [];
    const api = { command: (type, payload) => { sent.push([type, payload]); return world.run(type, payload); } };
    const render = () => part.tabs[0].render(el, { state: world.state, query: (name, args) => world.query(name, args) }, api);
    render();
    return { el, sent, render };
}

const buttons = el => el.querySelectorAll('button');
const labels = el => buttons(el).map(node => node.textContent);

test('the Fight tab: an offer, the fight, the result', () => {
    const world = createWorld({ domains: baseDomains() });
    const { el, sent, render } = mount(world);
    assert.match(el.textContent, /No fight on offer/);

    world.capture(line('!', 'encounter', 'Giant Rat', 'in the cellar', { tier: 'weak' }));
    render();
    assert.match(el.textContent, /Giant Rat \(weak\)/);
    assert.deepEqual(labels(el), ['Fight', 'Not now']);
    buttons(el)[0].click();
    assert.equal(sent[0][0], 'combat.start');
    assert.ok(world.state.domains.combat.session, 'the fight started');

    for (let n = 0; n < 60 && world.state.domains.combat.session?.status === 'active'; n++) {
        render();
        const attack = buttons(el).find(node => node.textContent.startsWith('Attack'));
        assert.ok(attack, 'an Attack button per foe');
        attack.click();
    }
    render();
    assert.match(el.textContent, /The fight is over/);
    buttons(el).find(node => node.textContent === 'Finish').click();
    render();
    assert.equal(world.state.domains.combat.session, null);
    assert.ok(el.textContent.includes(world.state.domains.combat.last.summary));
    assert.ok(sent.every(([type]) => type.startsWith('combat.')));
});
