// B-a1-13 (a1, story-suite break pass 2): story-time recovery (party/recovery.js, feature
// rpg-battle.recovery) runs as a `party.recover` cue before the next reply and is kept on the reply whose
// time it was. When the reader edits that reply so it no longer passes the time and Re-reads it, Story
// Block replaces the reply's story receipts (the clock goes back) but keeps the system cue's receipt after
// them, so its heal and its move of `party.rested` stay: the party is fully healed by 8 hours that no
// longer happened, and `rested` sits 8 hours past the clock (the next 8 story hours heal nothing). A middle
// delete of the same reply takes the heal back (recovery.test.js), so Re-read and delete disagree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { CLOCK } from '../party/helpers/clock.js';

test('editing the time out of a reply and Re-reading it takes back the heal that time gave', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(7, async () => {
        const host = await rpgHost({ modules: [CLOCK] });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await host.send('Start.', host.reply('Morning.', ['~ time 600']));
            await host.send('Fall.', host.reply('Ren falls into the weir.', ['~ wound Ren — fell into the weir | harm: severe']));
            const hurt = host.q('party.pc').hp;
            assert.ok(hurt.cur < hurt.max, 'setup: hurt');
            await host.send('Sleep.', host.reply('They sleep the day away.', ['! time +8h']));
            const slept = host.ctx.chat.length - 1;
            await host.send('Wake.', host.reply('Morning again.'));
            assert.equal(host.q('party.pc').hp.cur, hurt.max, 'setup: 8 hours are a full rest');
            await host.st.editMessage(slept, 'They do not sleep after all.');
            assert.equal((await host.sdk.reread(slept)).ok, true);
            assert.equal(host.head().domains.director.time.minutes, 600, 'setup: the clock is back');
            assert.deepEqual(host.q('party.pc').hp, hurt, 'no heal from time that no longer passed');
            assert.ok(host.head().domains.party.rested <= 600, `rested (${host.head().domains.party.rested}) is not past the clock`);
        } finally {
            host.close();
        }
    });
});
