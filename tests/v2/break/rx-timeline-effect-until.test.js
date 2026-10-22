// rx-timeline (beta rolling attack), RB-party2 (#92, merged): a timed effect stores `until` as an absolute
// story minute, worked out from the clock when its reply was written. Delete an earlier reply that moved
// the clock on, and the effect's own reply now happened earlier on the clock, but `until` still holds the
// deleted reply's hours: a "2h" buff lasts 5 h (and a debuff the same). Like RX-TL-1, a later record keeps
// what a deleted reply did. Invariant #2. LOW.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';

// A story clock in the shape of Story Director's: `director.time`, moved by a change line.
const CLOCK = {
    id: 'rx-clock',
    name: 'rx clock',
    version: '0.0.0',
    domains: { director: { initial: () => ({ time: { minutes: 600 } }), validate: () => [] } },
    queries: { 'director.time': state => ({ minutes: state?.domains?.director?.time?.minutes ?? null }) },
    capture: {
        kinds: { clock: { grammar: '! clock +<minutes>' } },
        apply(ctx, line) {
            ctx.draft('director').time.minutes += Number(String(line.name).replace('+', '')) || 0;
            return { summary: 'time passes', narrate: false };
        },
    },
};

test('deleting the reply that moved the clock leaves a later effect its own length', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(52, async () => {
        const host = await rpgHost({ modules: [CLOCK] });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await host.send('Walk.', host.reply('A long walk.', ['! clock +180']));
            await host.send('Skin.', host.reply('Stone skin.', ['+ effect Iron Skin — tough | on: defence | for: 2h']));
            assert.deepEqual(host.q('party.effects', {}).map(effect => effect.left), ['2 h']);
            const at = host.ctx.chat.findIndex(message => message.is_user && message.mes === 'Walk.');
            await host.st.deleteMessage(at + 1);
            await host.st.deleteMessage(at);
            assert.equal(host.head().domains.director.time.minutes, 600, 'the walk is gone');
            assert.deepEqual(host.q('party.effects', {}).map(effect => effect.left), ['2 h'], 'the 2h effect still has 2 h');
        } finally {
            host.close();
        }
    });
});
