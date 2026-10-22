// FIXED (wave C balance PR): every boss fight, ranked or not, is held to at least strong.
// Breaker a2 (final cell): a boss with a written rank is labelled below strong. encounter.js readEncounter
// holds a boss fight's tier to at least strong only when no `rank:` is written (`bossFight = !ranked && …`);
// a ranked foe takes the tier its rank's level gap gives (rankFoe → threatForGap). "Rat King (boss) | rank: F"
// is an even fight for a level-1 character and a trivial one for a seasoned character: the offer's foe says
// `tier: 'trivial'`, and setup's per-tier rules (MAX_STUNNERS for trivial and weak) then apply to the boss.
// The user's call (wave C): a fight with a boss is never below strong.
// Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { market } from './helpers/econ.js';

const AT_LEAST_STRONG = ['strong', 'deadly'];

test('a2-4: a boss of a written rank is never labelled below strong', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await market();
    t.after(() => host.close());
    for (const amount of [0, 50000]) {
        if (amount) assert.equal((await host.internal('party.grantXp', { amount })).ok, true);
        await host.send('Go on.', host.reply('The Rat King waits.', ['! encounter Rat King (boss) | rank: F']));
        const foe = host.q('combat.offers').at(-1)?.foes?.find(entry => entry.boss);
        assert.ok(foe, 'the offer has its boss');
        assert.ok(AT_LEAST_STRONG.includes(foe.tier), `level ${host.q('party.pc')?.level}: the ranked boss is ${foe.tier} (${JSON.stringify(foe)})`);
    }
});
