import test from 'node:test';
import assert from 'node:assert/strict';
import { realQuestHost, questPin, skip } from './helpers/real-host.js';
for (const narrated of [false, true]) test(`Continue repeats one reward (${narrated ? 'narrated' : 'code'} first), through Re-read, reload, rebuild and parent deletion`, { skip }, async t => {
    const h = await realQuestHost(t, { given: questPin({ objectives: [{ id: 'ob_00000001', kind: 'story', text: 'Greet' }] }) });
    await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
    const id = h.sdk.query('director.thread', { key: 'Mill job' }).id;
    assert.equal((await h.sdk.command('quest.take', { id })).ok, true);
    await h.send('Greet.', '<Changes>\n~ quest Mill job | met: yes\n</Changes>');
    const objective = h.ctx.chat.length - 1;
    await h.send('Turn in.', `<Changes>\n${narrated ? '+ coin 30\n' : ''}- quest Mill job — done\n</Changes>`);
    const payout = h.ctx.chat.length - 1;
    const check = (amount = 30) => {
        assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, amount);
        assert.equal(h.sdk.query('party.pc').xp, amount ? 25 : 0);
    };
    check();
    for (let n = 0; n < 2; n++) { await h.cont('<Changes>\n+ coin 30\n</Changes>'); check(); }
    await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
    assert.equal((await h.turn.reread(payout)).ok, true); check(); assert.deepEqual(h.store.problems(), []);
    await h.st.deleteMessage(objective); check(0);
    await h.st.loadChat(structuredClone(h.ctx.chat)); check(0); h.store.rebuild(); check(0);
});

test('ambiguous equal rewards stay unbound; a UI finish cannot invent attribution or pay twice', { skip }, async t => {
    const extra = { slug: 'other', name: 'Other job', category: 'side', giver: null, turnInPlace: null, requirements: [],
        objectives: [{ id: 'ob_00000002', kind: 'story', text: 'Work' }], reward: { coin: 30, xp: 25, items: [] }, durationMinutes: null, repeat: null, chain: null };
    const h = await realQuestHost(t, { given: questPin({ objectives: [{ id: 'ob_00000001', kind: 'story', text: 'Greet' }] }, [extra]) });
    await h.send('Work?', '<Changes>\n+ quest Mill job\n+ quest Other job\n</Changes>');
    for (const key of ['Mill job', 'Other job']) assert.equal((await h.sdk.command('quest.take', { id: h.sdk.query('director.thread', { key }).id })).ok, true);
    await h.send('Work.', '<Changes>\n~ quest Mill job | met: yes\n~ quest Other job | met: yes\n</Changes>');
    await h.send('Coin.', '<Changes>\n+ coin 30\n</Changes>');
    const check = async () => {
        const before = structuredClone(h.head());
        for (const key of ['Mill job', 'Other job']) assert.equal((await h.sdk.command('quest.finish', { id: h.sdk.query('director.thread', { key }).id })).code, 'CREDIT_UNBOUND');
        assert.deepEqual(h.head(), before); assert.equal(h.sdk.query('inventory.wallet').coin, 30); assert.equal(h.sdk.query('party.pc').xp, 0);
    };
    await check(); await h.st.loadChat(structuredClone(h.ctx.chat)); await check(); h.store.rebuild(); await check();
});
