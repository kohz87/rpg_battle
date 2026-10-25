import test from 'node:test';
import assert from 'node:assert/strict';
import { isId } from '../../../src/v2/rules/ids.js';
import { isId as hostId } from '../../vendor/story-block/src/v2/check.js';
import { realQuestHost, questPin, skip } from './helpers/real-host.js';

for (const objective of ['ob_00000001', 'pack.fixture/greet', 'story/greet']) test(`contract objective ID ${objective} proves and settles through reload and rebuild`, { skip }, async t => {
    const h = await realQuestHost(t, { given: questPin({ objectives: [{ id: objective, kind: 'story', text: 'Greet' }] }) });
    await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
    const id = h.sdk.query('director.thread', { key: 'Mill job' }).id;
    assert.equal((await h.sdk.command('quest.take', { id })).ok, true);
    await h.send('Greet.', `<Changes>\n~ quest Mill job | met: yes | objective: ${objective}\n</Changes>`);
    assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
    const check = () => {
        assert.equal(h.sdk.query('inventory.wallet').coin, 30);
        assert.equal(h.sdk.query('director.thread', { id }).rpg.state, 'done');
        assert.deepEqual(h.store.problems(), []);
    };
    check(); await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
});
test('the full contract ID validator shares the record and definition validators', () => {
    for (const id of ['ob_00000001', 'pack.fixture/greet', 'story/greet', 'Greet', '', null, 'ob_short', '../greet']) assert.equal(isId(id), hostId(id));
});
