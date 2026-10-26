// A narrator's roll label cannot select a better die: SD owns the receipt's one draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';
async function rolled(label) {
    return seeded(17, async () => {
        const host = await rpgHost();
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await host.send('Try.', host.reply('An attempt.', [`? check stealth — try | dc: hard${label}`]));
            assert.deepEqual(host.turn.problems(), []);
            const log = Object.values(host.head().domains.checks.log);
            assert.equal(log.length, 1);
            return { die: log[0].die, mod: log[0].mod, total: log[0].total, outcome: log[0].outcome };
        } finally { host.close(); }
    });
}
for (const label of [' | roll: 2', ' | roll: 20', ' | result: success', ' | result: fail']) {
    test(`checks flip: ignored narrator label ${label}`, async () => assert.deepEqual(await rolled(label), await rolled('')));
}
