// B4-3: combat.act names no fight. A click from a board that still shows an older fight (a stale
// session id, a second window, a double click across a combat.end/combat.start) is played on
// whatever fight is under way now. Invariant 2/4: an action meant for one fight must not land on another.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, playOut, seeded, started } from './helpers.js';

test('B4-3: combat.act with a session id that is not the fight under way is refused', async () => {
    await seeded(11, async () => {
        const host = await started();
        try {
            const first = await offerAndStart(host, '! encounter 1 Wolf | tier: trivial');
            const old = first.start.receipt.data.session;
            await playOut(host);
            assert.equal((await host.cmd('combat.end')).ok, true);
            await offerAndStart(host, '! encounter 2 Bandit | tier: even');
            const now = host.q('combat.session');
            assert.notEqual(now.id, old);
            const before = host.head().domains.combat.session.actions.length;
            const stale = await host.cmd('combat.act', { session: old, action: { type: 'flee' } });
            assert.equal(stale.ok, false, 'an action for the finished fight was played on the new one');
            assert.equal(host.head().domains.combat.session.actions.length, before);
            const bogus = await host.cmd('combat.act', { session: 'fi_zzzzzzzz', action: { type: 'defend' } });
            assert.equal(bogus.ok, false, 'an unknown session id is accepted');
        } finally {
            host.close();
        }
    });
});
