import test from 'node:test';
import assert from 'node:assert/strict';
import { realQuestHost, questPin, skip } from './helpers/real-host.js';
for (const path of ['ui', 'system']) test(`narrated coin and ${path} finish share one reward credit through reload and rebuild`, { skip }, async t => {
    const h = await realQuestHost(t, { given: questPin({ objectives: [{ id: 'ob_00000001', kind: 'story', text: 'Greet' }] }) });
    await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
    const id = h.sdk.query('director.thread', { key: 'Mill job' }).id;
    assert.equal((await h.sdk.command('quest.take', { id })).ok, true);
    await h.send('Greet.', '<Changes>\n~ quest Mill job | met: yes\n</Changes>');
    await h.send('Paid.', `<Changes>\n+ coin 30\n${path === 'system' ? '- quest Mill job — done\n' : ''}</Changes>`);
    if (path === 'ui') assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
    const check = () => {
        const q = h.sdk.query('director.thread', { id }).rpg;
        assert.equal(q.state, 'done'); assert.equal(q.storyCredit.coin, 30);
        assert.equal(h.sdk.query('inventory.wallet').coin, 30); assert.equal(h.sdk.query('party.pc').xp, 25);
        assert.deepEqual(h.store.problems(), []);
    };
    check(); await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
});
