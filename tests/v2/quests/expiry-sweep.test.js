// C07 expiry is a guarded host step, never a second payout path or a replacement turn-in.
import assert from 'node:assert/strict';
import { test, questHost, offer, template, herb } from './helpers/host.js';

test('the host expires at deadline without a turn-in, and a removed clock retracts closure and claim on reload', async t => {
    const h = await questHost({ minute: 7100, templates: [template({ durationMinutes: 100 })] });
    t.after(() => h.close());
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    await h.send('Wait until the deadline.', '<Changes>\n~ time June 3, 1200, 10:00 am\n</Changes>');
    const clockIndex = h.ctx.chat.length - 1;
    assert.equal(h.sdk.query('director.thread', { id: thread.id }).rpg.state, 'expired');
    assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0);
    assert.equal(h.sdk.query('party.pc').xp, 0);
    const claim = `rb:ep_00000000:quest:${thread.id}:1:settled`;
    assert.equal(h.head().meta.claims[claim], true);
    await h.st.deleteMessage(clockIndex);
    const loaded = await questHost({ minute: 7100, templates: [template({ durationMinutes: 100 })],
        st: { chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    loaded.store.rebuild();
    assert.equal(loaded.sdk.query('director.thread', { id: thread.id }).rpg.state, 'active');
    assert.equal(loaded.head().meta.claims[claim], undefined);
});

test('a system payout without deadline or surviving turn-in intent cannot settle an otherwise complete quest', async t => {
    const h = await questHost();
    t.after(() => h.close());
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
    const before = structuredClone(h.head());
    assert.equal(h.bus.command('quest.payOwed', { id: thread.id }, { cause: 'system' }).code, 'NO_LONGER_DONE');
    assert.deepEqual(h.head(), before);
});
