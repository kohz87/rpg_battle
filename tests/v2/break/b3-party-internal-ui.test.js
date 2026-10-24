// B-b3-10: party.grantXp and party.applyResult are internal (MODULES §B1: from combat.end, quests,
// item.use) but have no caller rule: one click takes a level-1 character to the level cap, or
// writes a fight that never happened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { market, show } from './helpers/econ.js';

test('party.grantXp from a click is refused', async () => {
    const host = await market();
    try {
        const r = await host.cmd('party.grantXp', { amount: 500000 });
        assert.equal(r.ok, false, show(r));
        assert.equal(host.q('party.pc').level, 1);
    } finally { host.close(); }
});

test('party.applyResult from a click is refused', async () => {
    const host = await market();
    try {
        const pc = host.q('party.pc');
        const r = await host.cmd('party.applyResult', { result: { party: [{ memberId: pc.id, hp: { cur: 1, max: 1 } }], xp: { [pc.id]: 5000 }, uses: {} } });
        assert.equal(r.ok, false, show(r));
    } finally { host.close(); }
});
