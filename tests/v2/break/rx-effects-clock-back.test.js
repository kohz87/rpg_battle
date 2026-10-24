// rx-combat (RB #92 effects with Story Director's clock): a timed effect is on while the story clock
// is before `until` (effects.js isOn returns there and never looks at its `replies` fallback). The
// story sets the clock with `~ time …`, backwards too, so model text keeps a "for: 1h" buff on
// forever: twelve replies of "! time +50m" followed by "~ time March 3, 8:00 am" leave it at "1 h";
// one "~ time March 2, 8:00 am" makes it "1 d 1 h". Needs the sibling Story_director checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { storyDirector } from './helpers.js';

test('rx-combat: setting the story clock back does not keep a timed effect on', async t => {
    t.mock.method(console, 'warn', () => {});
    const sd = await storyDirector();
    if (!sd) return t.skip('Story_director checkout not found');
    await seeded(2, async () => {
        const h = await rpgHost({ modules: [sd] });
        try {
            assert.equal((await h.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await h.send('We walk in.', h.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement', '~ time March 3, 8:00 am']));
            await h.send('We pray.', h.reply('Blessed.', ['+ effect War Blessing — solid strength | on: attack, defence | for: 1h']));
            assert.equal(h.q('party.effects', {}).length, 1);
            for (let n = 0; n < 12; n += 1) await h.send(`On ${n}.`, h.reply('Later.', ['! time +50m', '~ time March 3, 8:00 am']));
            assert.deepEqual(h.q('party.effects', {}).map(effect => `${effect.name} (${effect.left})`), [], 'a one-hour buff outlived twelve replies of 50 minutes each');
        } finally {
            h.close();
        }
    });
});
