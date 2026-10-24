// SB coin capture and the one RB settlement must not pay the same reward twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { questHost, offer, herb } from './helpers/host.js';

for (const order of ['turn-in first', 'coin first']) test(`story coin credits before payout (${order}), including Re-read and reload`, async t => {
    const h = await questHost();
    t.after(() => h.close());
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
    const lines = ['- quest Mill job — done', '+ coin 30'];
    if (order === 'coin first') lines.reverse();
    await h.send('Turn in the herbs.', `<Changes>\n${lines.join('\n')}\n</Changes>`);
    const at = h.ctx.chat.length - 1;
    function paid(host) {
        assert.equal(host.sdk.query('inventory.wallet').coin, 30, JSON.stringify(host.store.problems()));
        const q = host.sdk.query('director.thread', { id: thread.id }).rpg;
        assert.equal(q.state, 'done');
        assert.equal(q.storyCredit.coin, 30);
        assert.equal(q.settlement.coinPaid, 0);
        assert.equal(host.sdk.query('party.pc').xp, 25);
        assert.equal(q.storyCredit.claims.length, 1);
        assert.equal(host.head().meta.claims[q.storyCredit.claims[0]], true);
    }
    paid(h);
    assert.equal((await h.turn.reread(at)).ok, true);
    paid(h);
    const loaded = await questHost({ st: { chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    paid(loaded);
    await h.st.editMessage(at, '<Changes>\n+ coin 30\n</Changes>');
    assert.equal((await h.turn.reread(at)).ok, true);
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
    assert.equal(h.sdk.query('party.pc').xp, 0);
    assert.equal(h.sdk.query('director.thread', { id: thread.id }).rpg.state, 'active');
});

test('a Continue that repeats a paid reward counts its coin once', async t => {
    const h = await questHost();
    t.after(() => h.close());
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
    await h.send('Turn in the herbs.', '<Changes>\n- quest Mill job — done\n</Changes>');
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
    await h.cont('<Changes>\n+ coin 30\n</Changes>');
    assert.equal(h.sdk.query('inventory.wallet').coin, 30, JSON.stringify(h.store.problems()));
    assert.equal(h.sdk.query('party.pc').xp, 25);
    assert.equal(h.sdk.query('quest.repeatedCoin').amount, 0);
    const loaded = await questHost({ st: { chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.equal(loaded.sdk.query('inventory.wallet').coin, 30);
    assert.equal(loaded.sdk.query('party.pc').xp, 25);
});
