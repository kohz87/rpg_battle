import test from 'node:test';
import assert from 'node:assert/strict';
import { realQuestHost, questPin, skip } from './helpers/real-host.js';
for (const reversed of [false, true]) test(`same-reply visit and turn-in pay once (reverse lines ${reversed}), through reload and rebuild`, { skip }, async t => {
    const h = await realQuestHost(t, { given: questPin({ objectives: [{ id: 'ob_00000001', kind: 'visit', place: 'pack.fixture/haven' }] }) });
    assert.equal((await h.packs.packs.install(JSON.stringify({ id: 'fixture', version: '2.0.0', name: 'Places', requires: { storyBlock: '^2' }, content: { places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }] } }))).ok, true);
    await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
    const id = h.sdk.query('director.thread', { key: 'Mill job' }).id;
    assert.equal((await h.sdk.command('quest.take', { id })).ok, true);
    const lines = ['~ place Haven', '- quest Mill job — done']; if (reversed) lines.reverse();
    await h.send('Arrive and turn in.', `<Changes>\n${lines.join('\n')}\n</Changes>`);
    const at = h.ctx.chat.length - 1;
    const check = () => {
        assert.equal(h.sdk.query('director.thread', { id }).rpg.state, 'done');
        assert.equal(h.sdk.query('inventory.wallet').coin, 30); assert.equal(h.sdk.query('party.pc').xp, 25);
        assert.deepEqual(h.store.problems(), []);
    };
    check(); await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
    assert.equal((await h.turn.reread(at)).ok, true); check();
    await h.send('Next.', 'The miller thanks you.'); check();
});
