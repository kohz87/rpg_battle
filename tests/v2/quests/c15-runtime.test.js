// C15's real command paths: aliases, typed reader intent, fresh offers and atomic SD linking.
import assert from 'node:assert/strict';
import { test, offer, questHost, template, herb } from './helpers/host.js';
import { offeredQuest } from '../../../src/v2/quests/outcomes.js';

async function supply(h) {
    assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
}

test('real take/finish resolve an SD historical alias to the same thread', async t => {
    const neutral = { id: 'th_00000001', kind: 'hook', key: 'Mill job', summary: '', fields: {}, aliases: ['Old mill'],
        status: 'active', offer: true, taken: null, ended: null, target: null, reward: null, acceptance: null, rev: 0 };
    const h = await questHost({ legacy: [neutral] });
    t.after(() => h.close());
    assert.equal((await h.sdk.command('quest.take', { key: 'Old mill' })).ok, true);
    await supply(h);
    const out = await h.sdk.command('quest.finish', { key: 'Old mill' });
    assert.equal(out.ok, true, out.message);
    assert.equal(out.receipt.data.quest, neutral.id);
    assert.deepEqual(out.receipt.data.paid, { amount: 30 });
    assert.equal(out.receipt.data.have, 2);
    assert.equal(out.receipt.data.need, 2);
    assert.equal(out.receipt.data.source, 'inventory');
    assert.ok(Array.isArray(out.receipt.data.consumed));
    assert.equal(out.receipt.data.xp.gains[0].xp, 25);
    assert.equal(h.sdk.query('director.threads').length, 1);
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
});

test('reader intent accepts the offered RPG hook through SD evidence and quest.take', async t => {
    const h = await questHost();
    t.after(() => h.close());
    const thread = await offer(h);
    await h.send("Yes, I'll help, no problem.", '<Changes>\n+ quest Mill job\n</Changes>');
    const accepted = h.sdk.query('director.thread', { id: thread.id });
    assert.equal(accepted.offer, false, JSON.stringify(h.store.problems()));
    assert.equal(accepted.rpg.state, 'active');
    assert.equal(h.sdk.query('story.evidence', { ids: [accepted.acceptance.proof] })[0].payload.words, "Yes, I'll help, no problem");
});

test('narration cannot accept the reader offer and third modules cannot borrow quest.take authority', async t => {
    const h = await questHost({ extra: [{ id: 'third', version: '1.0.0', commands: { 'third.take': (ctx, payload) => ctx.call('quest.take', payload) } }] });
    t.after(() => h.close());
    const thread = await offer(h);
    await h.send('Tell me more.', '<Changes>\n+ quest Mill job\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { id: thread.id }).offer, true);
    assert.equal((await h.sdk.command('third.take', { id: thread.id })).code, 'REFUSED');
    assert.equal(h.sdk.query('story.evidence').length, 0);
});

test('a neutral SD annotation preserves RPG state and its terminal line uses RB settlement', async t => {
    const h = await questHost();
    t.after(() => h.close());
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    const q = h.sdk.query('director.thread', { id: thread.id }).rpg;
    await h.send('Note our progress.', '<Changes>\n~ hook Mill job | progress: herbs gathered\n</Changes>');
    assert.deepEqual(h.sdk.query('director.thread', { id: thread.id }).rpg, q);
    await supply(h);
    await h.send('Give the herbs to the miller.', '<Changes>\n- hook Mill job — done\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { id: thread.id }).rpg.state, 'done', JSON.stringify(h.store.problems()));
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
});

for (const outcome of ['done', 'abandoned']) test(`${outcome} creates a fresh repeat offer; chain follows only done; cooldown is terminal based`, async t => {
    const first = template({ repeat: { cooldownMinutes: 10 }, chain: { previous: null, next: 'pack.fixture/next' } });
    const next = template({ id: 'pack.fixture/next', name: 'Next job', chain: { previous: first.id, next: null } });
    const h = await questHost({ templates: [first, next] });
    t.after(() => h.close());
    const old = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: old.id })).ok, true);
    await supply(h);
    const minute = h.sdk.query('director.time').minutes;
    const result = await h.sdk.command(outcome === 'done' ? 'quest.finish' : 'quest.abandon', { id: old.id });
    assert.equal(result.ok, true, result.message);
    const repeat = h.sdk.query('director.thread', { key: first.name });
    assert.notEqual(repeat.id, old.id);
    assert.equal(repeat.offer, true);
    assert.equal(repeat.taken, null);
    assert.equal(repeat.rpg.acceptedCursor, null);
    assert.equal(repeat.rpg.instance, 2);
    assert.equal(repeat.rpg.repeat.nextOfferAt, minute + 10);
    assert.equal((await h.sdk.command('quest.take', { id: repeat.id })).code, 'REFUSED');
    const chain = h.sdk.query('director.thread', { key: next.name });
    assert.equal(!!chain, outcome === 'done');
    if (chain) { assert.notEqual(chain.id, old.id); assert.equal(chain.offer, true); assert.equal(chain.rpg.state, 'offered'); }
});

test('accepted neutral goal links atomically; failed link and stale write leave no extension or retry entry', async t => {
    const h = await questHost({ commands: {
        'fixture.link': (ctx, payload) => {
            const result = ctx.call('threads.link', payload);
            if (payload.write === 'wr_00000002') ctx.fail('FAILED', 'Injected downstream failure.');
            return result;
        },
    } });
    t.after(() => h.close());
    const id = 'th_00000001';
    assert.equal((await h.sdk.command('threads.offer', { write: 'wr_00000001', thread: id, kind: 'hook', key: 'Mill job', summary: '', fields: {}, expectedHash: null })).ok, true);
    const hash = h.sdk.query('threads.hash', { thread: id });
    assert.equal((await h.sdk.command('threads.accept', { write: 'wr_00000003', thread: id, expectedHash: hash })).ok, true);
    const accepted = h.sdk.query('director.thread', { id });
    const quest = { ...offeredQuest(template(), id), state: 'active', acceptedAt: accepted.acceptance.minute, acceptedCursor: accepted.acceptance.cursor };
    const expectedHash = h.sdk.query('threads.hash', { thread: id });
    const before = structuredClone(h.head());
    const payload = { write: 'wr_00000002', thread: id, expectedHash, quest };
    assert.equal((await h.sdk.command('fixture.link', payload)).code, 'FAILED');
    assert.deepEqual(h.head(), before);
    assert.equal((await h.sdk.command('fixture.link', { ...payload, write: 'wr_00000004', expectedHash: hash })).code, 'STALE');
    const linked = await h.sdk.command('fixture.link', { ...payload, write: 'wr_00000004' });
    assert.equal(linked.ok, true, linked.message);
    const retry = await h.sdk.command('fixture.link', { ...payload, write: 'wr_00000004' });
    assert.equal(retry.ok, true, retry.message);
    assert.deepEqual(retry.receipt.data, linked.receipt.data);
    assert.equal((await h.sdk.command('fixture.link', { ...payload, write: 'wr_00000004', quest: { ...quest, instance: 2 } })).code, 'CONFLICT');
    assert.deepEqual(h.sdk.query('director.thread', { id }).acceptance, accepted.acceptance);
});

test('old-chat quest and owed text stay read-only after reload and every retired entry pays zero', async t => {
    const old = { id: 'th_00000001', kind: 'quest', key: 'Old job', summary: 'Old history', fields: { reward: '50' },
        status: 'active', offer: false, taken: { rev: 0 }, ended: null, target: null, reward: null, rev: 0,
        owed: { text: '50 gold', rev: 0, paid: {} } };
    let h = await questHost({ legacy: [old] });
    t.after(() => h.close());
    for (let reload = 0; reload < 2; reload++) {
        const before = h.sdk.query('director.thread', { id: old.id });
        for (const type of ['quest.take', 'quest.finish', 'quest.abandon']) assert.equal((await h.sdk.command(type, { id: old.id })).code, 'REFUSED');
        for (const credit of [false, true]) assert.equal(h.bus.command('quest.payOwed', { id: old.id, ...(credit ? { credit: true } : {}) }, { cause: 'system' }).code, 'REFUSED');
        assert.equal(h.bus.command('quest.settle', { id: old.id }, { cause: 'system' }).code, 'UNKNOWN_COMMAND');
        await h.send('Remember the old job.', '<Changes>\n- quest Old job — done\n</Changes>');
        assert.deepEqual(h.sdk.query('director.thread', { id: old.id }), before);
        const owed = h.sdk.query('quest.owed')[0];
        assert.match(owed.text, /earlier version/);
        assert.equal(owed.payable, 0);
        assert.equal(owed.ask, false);
        assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0);
        assert.equal(h.sdk.query('party.pc').xp, 0);
        const st = { chat: structuredClone(h.ctx.chat) };
        h.close();
        h = await questHost({ legacy: [old], st });
    }
});
