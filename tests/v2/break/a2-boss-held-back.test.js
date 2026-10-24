// FIXED (wave C balance PR): bosses take their places first in setup.fielded.
// Breaker a2 (final cell): a boss is the first foe to be held back. combat/setup.js fielded() keeps at
// most MAX_FIELDED (4 a member) foes of an even, strong or deadly fight and lets "the last rows give way
// first", with no exception for a boss. The story writes the boss after its followers, as the grammar's
// own example does ("3 bandit, bandit captain (boss)"), so a lone hero against "4 Wolf, Rat King (boss)"
// fights four wolves and no Rat King: the offer and the encounter say boss, the fight has none, and the
// start receipt only says "1 more hangs back". The same with the boss in a later wave ("4 Wolf; then:
// Rat King (boss)"). A boss is the fight's point (its kill quest, its loot, never below strong).
// Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { market } from './helpers/econ.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

async function fightOf(t, line) {
    t.mock.method(console, 'warn', () => {});
    const host = await market();
    t.after(() => host.close());
    await host.send('We go on.', host.reply('Something waits.', [line]));
    const offer = host.q('combat.offers').at(-1);
    assert.ok(offer?.foes?.some(foe => foe.boss), `the offer has its boss: ${JSON.stringify(offer?.foes)}`);
    const begun = await host.cmd('combat.start', { offer: offer.id });
    assert.equal(begun.ok, true, begun.message);
    const setup = sessionOf(host.head().domains.combat).setup;
    const foes = [...(setup.enemies ?? []), ...(setup.waves ?? []).flatMap(wave => wave?.enemies ?? (Array.isArray(wave) ? wave : []))];
    return { foes, summary: begun.receipt.summary };
}

test('a2-1: a boss written after four followers is in the fight (not the one held back)', async t => {
    const { foes, summary } = await fightOf(t, '! encounter 4 Wolf, Rat King (boss) | tier: strong');
    assert.ok(foes.some(foe => foe.boss), `fought: ${JSON.stringify(foes.map(foe => foe.name))}; ${summary}`);
});

test('a2-1: a boss in a later wave is not dropped because the first wave filled the fight', async t => {
    const { foes, summary } = await fightOf(t, '! encounter 4 Wolf; then: Rat King (boss) | tier: deadly');
    assert.ok(foes.some(foe => foe.boss), `fought: ${JSON.stringify(foes.map(foe => foe.name))}; ${summary}`);
});
