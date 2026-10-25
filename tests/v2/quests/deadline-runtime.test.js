// C07: equality expires before objectives, consumption or reward are considered.
import assert from 'node:assert/strict';
import { test, questHost, offer, template } from './helpers/host.js';

test('C07 deadline 7199 active, 7200 expires before an unmet turn-in can pay', async t => {
    const h = await questHost({ minute: 7100, templates: [template({ durationMinutes: 100 })] });
    t.after(() => h.close());
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    assert.equal(h.sdk.query('director.thread', { id: thread.id }).rpg.deadline, 7200);
    assert.equal(h.bus.command('director.advance', { minutes: 99, cause: 'deadline-before' }, { cause: 'system' }).ok, true);
    assert.equal(h.sdk.query('director.time').minutes, 7199);
    assert.equal(h.sdk.query('director.thread', { id: thread.id }).rpg.state, 'active');
    assert.equal(h.sdk.query('rules.quests')[0].remainingMinutes, 1);
    assert.equal(h.bus.command('director.advance', { minutes: 1, cause: 'deadline-at' }, { cause: 'system' }).ok, true);
    assert.equal(h.sdk.query('director.time').minutes, 7200);
    assert.equal(h.sdk.query('quest.progress', { id: thread.id }).finish.reason, 'Expired');
    const out = await h.sdk.command('quest.finish', { id: thread.id });
    assert.equal(out.ok, true, out.message);
    assert.equal(out.receipt.data.v2.result.outcome, 'expired');
    assert.equal(h.sdk.query('director.thread', { id: thread.id }).rpg.state, 'expired');
    assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0);
    assert.equal(h.sdk.query('party.pc').xp, 0);
});
