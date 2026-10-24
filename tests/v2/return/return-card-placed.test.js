// The return card (widget rpg-battle.return-card) is placed (UI audit: no template drew it, so after a
// death "Return in time" was never shown): it leads the Fight screen and the Party screen while your
// character is dead, and draws nothing while they live. End to end on the testkit host: a fight to the
// death lost, the card on both screens, Return clicked (the chat branches back to the moment before the
// fight), the card gone and your character alive again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, playOut, seeded, started } from '../break/helpers.js';
import { renderer } from '../screens/helpers/runtime.js';
import { installDom } from '../screens/helpers/dom.js';
import { fightScreen } from '../../../src/v2/board/index.js';
import { partyScreen } from '../../../src/v2/screens/index.js';
import { part as returnPart, WIDGET } from '../../../src/v2/return/index.js';

const skip = renderer ? false : 'Story Block\'s template renderer was not found';
const settle = () => new Promise(resolve => setImmediate(resolve));
const isDead = host => (host.q('party.pc')?.conditions ?? []).some(entry => entry?.kind === 'dead');

/** `screen` drawn on the host's head (its data queries asked of the host), the return card drawn for real. */
function show(host, screen) {
    const doc = installDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const compiled = renderer.compileTemplate(screen.template);
    const api = { query: (name, args) => host.q(name, args), command: (type, payload) => host.cmd(type, payload), rewind: options => host.sdk.rewind(options) };
    const stub = { render(node) { const root = node.ownerDocument.createElement('div'); node.appendChild(root); return { update() {}, destroy() { root.remove(); } }; } };
    const widgets = new Proxy({ [WIDGET]: returnPart.widgets[WIDGET] }, { get: (own, name) => own[name] ?? stub, has: () => true });
    const draw = () => {
        const q = Object.fromEntries(Object.entries(screen.data ?? {}).map(([alias, binding]) => {
            try { return [alias, host.q(binding.query, binding.args ?? {})]; } catch { return [alias, null]; }
        }));
        renderer.renderTemplate(el, compiled, { state: host.head(), q, draft: {}, settings: {}, changes: [], mount: 'screen', index: 0, screenId: screen.id, api: {} },
            { widgets, api, evaluate: renderer.conditionEvaluator({ compile: renderer.events.compile, evaluate: renderer.events.evaluate }), command: api.command, onWarn: () => {} });
    };
    draw();
    const card = () => el.querySelector('.rpg-return-card');
    return { el, draw, card, shown: () => Boolean(card()) && !card().hidden };
}

test('after a fight to the death is lost, the Fight and Party screens show the return card; Return takes it away', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(111, async () => {
        const host = await started();
        try {
            const fight = show(host, fightScreen);
            const party = show(host, partyScreen);
            assert.equal(fight.shown(), false, 'nothing while your character lives');
            assert.equal(party.shown(), false);
            const { start } = await offerAndStart(host, '! encounter 1 Lich (boss) | tier: deadly | stakes: death');
            assert.equal(start?.ok, true, start?.message);
            await playOut(host);
            assert.equal((await host.cmd('combat.end')).receipt.data.outcome, 'lost');
            assert.equal(isDead(host), true, 'your character died');
            assert.ok(host.q('return.point'), 'there is a moment to return to');
            fight.draw();
            party.draw();
            for (const drawn of [fight, party]) {
                assert.equal(drawn.shown(), true, 'the card shows while your character is dead');
                assert.equal(drawn.el.querySelector('.rpg-return-title')?.textContent, 'You died');
                assert.ok(drawn.el.querySelector('.rpg-return-go'), 'with Return');
            }
            fight.el.querySelector('.rpg-return-go').dispatch?.('click') ?? fight.el.querySelector('.rpg-return-go').click();
            for (let n = 0; n < 20 && isDead(host); n += 1) await settle();
            assert.equal(isDead(host), false, 'Return went back to the moment before the fight');
            fight.draw();
            party.draw();
            assert.equal(fight.shown(), false, 'the card is gone after returning');
            assert.equal(party.shown(), false);
            await host.send('Again.', 'We stand at the moment before.');
            assert.match(host.tails().at(-1) ?? '', /back at the moment before the fight/, 'the next reply is told');
        } finally {
            host.close();
        }
    });
});
