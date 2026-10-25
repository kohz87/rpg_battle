import test from 'node:test';
import assert from 'node:assert/strict';
import { realQuestHost, questPin, skip } from './helpers/real-host.js';
const ok = out => assert.equal(out.ok, true, JSON.stringify(out));
const checkReplay = async (h, check) => { check(); await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check(); };
async function scene(t) {
    const h = await realQuestHost(t, { given: questPin({ objectives: [{ id: 'ob_00000001', kind: 'story', text: 'Greet' }] }) });
    await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
    const id = h.sdk.query('director.thread', { key: 'Mill job' }).id;
    ok(await h.sdk.command('quest.take', { id }));
    return { h, id };
}
for (const met of ['no', 'maybe', 'true', '', 'YES']) test(`met: ${JSON.stringify(met)} cannot prove completion`, { skip }, async t => {
    const { h, id } = await scene(t);
    await h.send('No greeting.', `<Changes>\n~ quest Mill job | met: ${met}\n</Changes>`);
    const check = () => {
        assert.equal(h.sdk.query('quest.progress', { id }).met, false);
        assert.equal(Object.keys(h.sdk.query('director.thread', { id }).rpg.evidence).length, 0);
        assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0);
    };
    await checkReplay(h, check);
    assert.equal((await h.sdk.command('quest.finish', { id })).ok, false);
    if (met !== 'no') {
        const out = h.registry.module('rpg-battle').capture.apply({ query: h.sdk.query, settings: () => ({}), fail: (code, message) => ({ code, message }) },
            { kind: 'quest', op: '~', name: 'Mill job', labels: { met } });
        assert.equal(out.code, 'INVALID_MET');
    }
});
test('met yes → no retracts effective evidence; deletion restores it and another yes may satisfy it once', { skip }, async t => {
    const { h, id } = await scene(t);
    await h.send('Greet.', '<Changes>\n~ quest Mill job | met: yes\n</Changes>');
    assert.equal(h.sdk.query('quest.progress', { id }).met, true);
    await h.send('Undone.', '<Changes>\n~ quest Mill job | met: no\n</Changes>');
    const at = h.ctx.chat.length - 1;
    await checkReplay(h, () => {
        assert.equal(h.sdk.query('quest.progress', { id }).met, false);
        assert.equal(h.sdk.query('party.pc').xp, 0);
        assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0);
    });
    assert.equal((await h.sdk.command('quest.finish', { id })).ok, false);
    await h.st.deleteMessage(at);
    await checkReplay(h, () => assert.equal(h.sdk.query('quest.progress', { id }).met, true));
    await h.send('Undo again.', '<Changes>\n~ quest Mill job | met: no\n</Changes>');
    await h.send('Greet again.', '<Changes>\n~ quest Mill job | met: yes\n</Changes>');
    ok(await h.sdk.command('quest.finish', { id }));
    await checkReplay(h, () => { assert.equal(h.sdk.query('inventory.wallet').coin, 30); assert.equal(h.sdk.query('party.pc').xp, 25); assert.deepEqual(h.store.problems(), []); });
});
