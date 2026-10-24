// E1 asks guards before storing, under the same restrictions as replay.
import assert from 'node:assert/strict';
import { test, offer, questHost, herb } from './helpers/host.js';
import { createQuestPart } from '../../../src/v2/quests/index.js';
import { buildGuard } from './helpers/b5.js';
import { hashJson } from '../../vendor/story-block/src/v2/replay.js';

test('enforcing host stores quest take, neutral acceptance and settlement; wrong epoch fails closed', async t => {
    const h = await questHost();
    t.after(() => h.close());
    const thread = await offer(h);
    const take = await h.sdk.command('quest.take', { id: thread.id });
    assert.equal(take.ok, true, take.message);
    assert.equal((await h.sdk.command('threads.offer', { write: 'wr_00000001', thread: 'th_00000001', kind: 'hook',
        key: 'Neutral goal', summary: '', fields: {}, expectedHash: null })).ok, true);
    const accept = await h.sdk.command('threads.accept', { write: 'wr_00000002', thread: 'th_00000001',
        expectedHash: h.sdk.query('threads.hash', { thread: 'th_00000001' }) });
    assert.equal(accept.ok, true, accept.message);
    await h.send('Collect herbs.', 'Herbs collected.');
    assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
    const prefix = structuredClone(h.head());
    const settled = await h.sdk.command('quest.finish', { id: thread.id });
    assert.equal(settled.ok, true, settled.message);
    const span = h.ctx.chat.at(-1).extra.storySuite.spans.find(s => s.guard?.predicate?.kind === 'quest.settlement');
    assert.ok(span, 'settlement is persisted, not just returned');
    const queries = createQuestPart({ buildGuard }).queries;
    const query = (name, args) => name === 'story.evidence' ? h.sdk.query(name, args) : queries[name](prefix, args);
    const guard = createQuestPart({ buildGuard }).hooks.replayGuard;
    assert.equal(guard({ state: prefix, query, hash: hashJson }, span).ok, true);
    prefix.domains.savepoints = { epoch: 'ep_00000001' };
    assert.equal(guard({ state: prefix, query, hash: hashJson }, span).ok, false);
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
});
