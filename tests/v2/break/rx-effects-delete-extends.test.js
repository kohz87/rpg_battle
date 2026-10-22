// rx-combat (RB #92 effects): with no story clock an effect lasts `replies` replies, counted as
// (now chat index − the index it was made at) / 2 (effects.js repliesSince). `start.at` is the chat
// index stored when it was made; deleting earlier messages lowers every later index but not the
// stored one, so each two messages deleted before it give it one more reply. A "for: 2 replies"
// buff with six earlier messages deleted lasts 5 replies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';

async function lasted(deleted) {
    return seeded(4, async () => {
        const h = await rpgHost();
        try {
            assert.equal((await h.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await h.send('We walk in.', h.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement']));
            for (let n = 0; n < 4; n += 1) await h.send(`Small talk ${n}.`, h.reply(`They talk (${n}).`));
            await h.send('We pray.', h.reply('Blessed.', ['+ effect War Blessing — strength | on: attack | for: 2 replies']));
            for (let n = 0; n < deleted; n += 1) await h.st.deleteMessage(2);
            let replies = 0;
            for (let n = 0; n < 10; n += 1) {
                await h.send(`On ${n}.`, h.reply('We go on.'));
                if (h.q('party.effects', {}).length) replies += 1;
            }
            return replies;
        } finally {
            h.close();
        }
    });
}

test('rx-combat: deleting older messages does not make a timed effect last longer', async t => {
    t.mock.method(console, 'warn', () => {});
    const plain = await lasted(0);
    const after = await lasted(6);
    assert.equal(after, plain, `a "for: 2 replies" buff lasted ${plain} replies, and ${after} after six older messages were deleted`);
});
