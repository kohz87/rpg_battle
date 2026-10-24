// Unrelated prefix changes must not become payout prerequisites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { questHost, offer, herb } from './helpers/host.js';

for (const removed of ['unrelated', 'consumed item']) test(`delete ${removed} reply preserves only earned payout`, async t => {
    const h = await questHost();
    t.after(() => h.close());
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    await h.send('Find a keepsake.', 'A keepsake.');
    const unrelated = h.ctx.chat.length - 1;
    assert.equal(h.bus.command('inventory.grant', { def: { ...herb, id: 'pack.fixture/stone', name: 'Stone' }, qty: 1, owner: 'party' }, { cause: 'system' }).ok, true);
    await h.send('Find herbs.', 'Herbs.');
    const material = h.ctx.chat.length - 1;
    assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
    await h.send('Return herbs.', 'The miller counts them.');
    assert.equal((await h.sdk.command('quest.finish', { id: thread.id })).ok, true);
    const span = h.ctx.chat.at(-1).extra.storySuite.spans.find(s => s.guard?.predicate?.kind === 'quest.settlement');
    const inputs = span.recorded.inputs;
    await h.st.deleteMessage(removed === 'unrelated' ? unrelated : material);
    const st = { chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) };
    const loaded = await questHost({ st });
    t.after(() => loaded.close());
    const expected = removed === 'unrelated' ? 30 : 0;
    assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, expected);
    assert.equal(loaded.sdk.query('inventory.wallet').coin ?? 0, expected);
    assert.equal(loaded.sdk.query('party.pc').xp, expected ? 25 : 0);
    assert.equal(loaded.sdk.query('director.thread', { id: thread.id }).rpg.state, expected ? 'done' : 'active');
    assert.equal(Object.hasOwn(inputs, 'party'), false);
    assert.equal(Object.hasOwn(inputs, 'items'), false);
    assert.equal(Object.hasOwn(inputs, 'clock'), false);
    assert.equal(Object.hasOwn(inputs, 'place'), false);
    assert.equal(Object.hasOwn(inputs, 'threadHash'), false);
    assert.deepEqual(inputs.plan.consumed.map(row => row.qty), [2]);
    assert.equal(!!loaded.head().meta.claims[`rb:ep_00000000:quest:${thread.id}:1:settled`], !!expected);
});
