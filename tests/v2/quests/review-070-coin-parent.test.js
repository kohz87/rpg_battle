import test from 'node:test';
import assert from 'node:assert/strict';
import { realQuestHost, questPin, skip } from './helpers/real-host.js';
for (const mode of ['system', 'ui']) test(`attributed ${mode} coin retracts with its objective through delete, reload, rebuild and Re-read`, { skip }, async t => {
    const h = await realQuestHost(t, { given: questPin({ objectives: [{ id: 'ob_00000001', kind: 'story', text: 'Greet' }] }) });
    await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
    const id = h.sdk.query('director.thread', { key: 'Mill job' }).id;
    assert.equal((await h.sdk.command('quest.take', { id })).ok, true);
    await h.send('Greet.', '<Changes>\n~ quest Mill job | met: yes\n</Changes>');
    const objective = h.ctx.chat.length - 1;
    await h.send('Turn in.', `<Changes>\n+ coin 30\n${mode === 'system' ? '- quest Mill job — done\n' : ''}</Changes>`);
    const payout = h.ctx.chat.length - 1;
    if (mode === 'ui') assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
    const check = amount => {
        assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, amount);
        assert.equal(h.sdk.query('party.pc').xp, amount ? 25 : 0);
        assert.equal(h.sdk.query('director.thread', { id }).rpg.state, amount ? 'done' : 'active');
    };
    check(30); await h.st.loadChat(structuredClone(h.ctx.chat)); check(30); h.store.rebuild(); check(30);
    await h.st.deleteMessage(objective); check(0);
    await h.st.loadChat(structuredClone(h.ctx.chat)); check(0); h.store.rebuild(); check(0);
    // The coin's immutable attribution is retained when the system step is reconciled again.
    await h.send('Next.', 'The work is still undone.'); check(0);
    if (mode === 'system') { assert.equal((await h.turn.reread(payout - 1)).ok, true); check(0); }
});
