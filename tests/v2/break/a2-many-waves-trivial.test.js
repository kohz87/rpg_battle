// Breaker a2 (v2 break pass 2): "every foe the story wrote is fought; the ones past the field come as
// later waves" and "the tier still means the same danger: it counts the whole encounter" (setup.planWaves /
// effectiveHeadcount, Fights setting help). The headcount a tier reads is held to MAX_EFFECTIVE (24) and a
// foe never shrinks below its floor, so a long string of waves is not held to the tier: a level-1 fighter
// (auto) wins every fight of 27 trivial Cellar Rats but only about half of 54 (six rows of 9, 14 waves of 4).
// Weak gives the same, so at that size the tier word means nothing. Seeded: the same every run.
// Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { market } from './helpers/econ.js';
import { playOut, seeded } from '../integration/helpers/host.js';

async function wins(line, seeds) {
    let won = 0;
    for (let seed = 1; seed <= seeds; seed += 1) {
        await seeded(seed * 101, async () => {
            const host = await market();
            try {
                await host.send('Go.', host.reply('Rats pour out.', [line]));
                const offer = host.q('combat.offers').at(-1);
                assert.equal((await host.cmd('combat.start', { offer: offer.id })).ok, true);
                if (await playOut(host) === 'won') won += 1;
            } finally {
                host.close();
            }
        });
    }
    return won;
}

test('a2-waves: a trivial fight is won about as surely with 54 written foes (in waves) as with 27', async t => {
    t.mock.method(console, 'warn', () => {});
    const rows = n => Array.from({ length: n }, () => '9 Cellar Rat').join(', ');
    const small = await wins(`! encounter ${rows(3)} | tier: trivial`, 10);
    const big = await wins(`! encounter ${rows(6)} | tier: trivial`, 10);
    assert.ok(small >= 9, `27 trivial rats: won ${small}/10`);
    assert.ok(big >= 8, `54 trivial rats (14 waves): won ${big}/10, 27: ${small}/10`);
});
