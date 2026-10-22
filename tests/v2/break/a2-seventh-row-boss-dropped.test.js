// Breaker a2 (v2 break pass 2): "Every foe the story wrote is fought" (setup.planWaves) and bosses take
// their places first — but the encounter reader keeps only the first MAX_FOES (6) rows and counts of at
// most MAX_COUNT (9) (combat/encounter.js:102-109), silently. A boss written as the 7th row is not in the
// offer at all (and the fight is not held to strong, since bossFight only looks at the first 6 rows);
// "12 Cellar Rat" is fought as 9. Nothing tells the reader or the next reply. Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { market } from './helpers/econ.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

async function fight(t, line) {
    const host = await market();
    t.after(() => host.close());
    await host.send('Go.', host.reply('Foes.', [line]));
    const offer = host.q('combat.offers').at(-1);
    assert.ok(offer, 'an offer is made');
    const begun = await host.cmd('combat.start', { offer: offer.id });
    assert.equal(begun.ok, true, begun.message);
    const setup = sessionOf(host.head().domains.combat).setup;
    const told = host.sdk.receipts().map(entry => entry.receipt).filter(receipt => typeof receipt?.problem === 'string').map(receipt => receipt.problem).join(' ');
    return Object.assign([...setup.enemies, ...(setup.waves ?? []).flatMap(wave => wave.enemies)], { told });
}

test('a2-field: a boss written after six other foes is fought', async t => {
    t.mock.method(console, 'warn', () => {});
    const all = await fight(t, '! encounter Rat, Wolf, Bat, Spider, Goblin, Slime, Rat King (boss) | tier: weak');
    assert.ok(all.some(enemy => enemy.boss), `foes fought: ${all.map(enemy => enemy.name).join(', ')} (no Rat King); problems told: "${all.told}"`);
});

test('a2-field: a written count past 9 is fought in full (later waves), or the cut is told — not cut to 9 silently', async t => {
    t.mock.method(console, 'warn', () => {});
    const all = await fight(t, '! encounter 12 Cellar Rat | tier: trivial');
    assert.ok(all.length === 12 || /12/.test(all.told), `12 written, ${all.length} fought; problems told: "${all.told}"`);
});
