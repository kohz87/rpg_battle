// B-b3-11: party.grantXp takes any `claim` key and claims it as it is. A caller (any click today,
// any module tomorrow) can pre-claim another rule's key: `combat:<session>:end` makes the finished
// fight impossible to settle for ever (combat.end CLAIMED, no new fight starts, nobody can leave
// the party), `quest:<id>:paid` makes a quest unpayable. (RB-fix1: a click is refused outright now;
// these calls are sent as `system` so the key space itself is tested.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { foughtOut, market, seeded, show } from './helpers/econ.js';

test('an XP claim cannot take over a fight\'s settlement claim', async () => {
    await seeded(3, async () => {
        const host = await market();
        try {
            const session = await foughtOut(host);
            await host.cmd('party.grantXp', { amount: 1, claim: `combat:${session}:end` }, { cause: 'system' });
            const end = await host.cmd('combat.end');
            assert.equal(end.ok, true, `the fight can no longer be settled: ${show(end)}`);
        } finally { host.close(); }
    });
});

test('an XP claim lives in its own key space (xp:…), never another rule\'s', async () => {
    const host = await market();
    try {
        await host.cmd('party.grantXp', { amount: 1, claim: 'quest:th_abcdefgh:paid' }, { cause: 'system' });
        assert.ok(!Object.hasOwn(host.head().meta.claims, 'quest:th_abcdefgh:paid'), 'the quest payment claim was taken by an XP grant');
    } finally { host.close(); }
});
