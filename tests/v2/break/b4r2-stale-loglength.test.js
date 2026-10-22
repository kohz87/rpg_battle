// B4r2-2: the stale-board guard compares the log's length only (combat.act { session, logLength }).
// Within one line of history the log only grows, but a swipe or a delete takes actions back, and a
// different action afterwards can bring the log to the same length at another moment of the fight
// (other HP, other last lines). A click chosen on the board as it stood before the swipe is then
// played on the new moment. Seed 5: two defends (log 21), swipe, attacks reach log 21 again.
// Fix (coordinator): the view carries `board`, an identity token of the moment (the actions
// played and a short hash of them); the battle board sends it with every click, as here, and
// combat.act compares it. (`logLength` alone, an older caller's, cannot tell the two moments apart.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, seeded, started } from './helpers.js';

const moment = view => JSON.stringify({ log: view.log.slice(-5).map(entry => entry.text), hp: view.combatants.map(c => c.hp) });

test('B4r2-2: a click chosen before a swipe is refused at another moment with the same log length', async () => {
    // The first seed whose fight comes back to the same log length after the swipe (seed 5 before wave C).
    let checked = 0;
    for (let seed = 1; seed <= 40 && !checked; seed += 1) {
        await seeded(seed, async () => {
            const host = await started();
            try {
                await offerAndStart(host, '! encounter 3 Bandit | tier: weak');
                await host.send('Fight on.', 'Steel rings.');
                for (let n = 0; n < 2; n += 1) if (!(await host.cmd('combat.act', { action: { type: 'defend' } })).ok) return;
                const before = host.q('combat.session');
                if (before.status !== 'active') return;
                await host.swipe('Steel rings again.');
                let now = host.q('combat.session');
                for (let n = 0; n < 6 && now.status === 'active' && now.logLength < before.logLength; n += 1) {
                    const target = now.actions.targets?.enemies?.[0];
                    await host.cmd('combat.act', { action: target ? { type: 'attack', target } : { type: 'defend' } });
                    now = host.q('combat.session');
                }
                if (now.status !== 'active' || now.logLength !== before.logLength || moment(now) === moment(before)) return;
                const stale = await host.cmd('combat.act', { action: { type: 'flee' }, session: before.id, board: before.board, logLength: before.logLength });
                assert.equal(typeof before.board, 'string', 'the view says which moment it shows');
                assert.equal(stale.ok, false, `seed ${seed}: the click from the board before the swipe was played`);
                checked = seed;
            } finally {
                host.close();
            }
        });
    }
    assert.ok(checked, 'a seed reaches the same log length at another moment');
});
