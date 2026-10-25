// Real-module regressions: host cursor/epoch, production quest policies and replay-safe forwarding, never D1 shims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realQuestHost, questPin, herb, skip } from './helpers/real-host.js';

const reload = async (t, host, given) => realQuestHost(t, { given, st: {
    chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings),
} });
const offer = async host => {
    await host.send('What work is offered?', '<Changes>\n+ quest Mill job\n</Changes>');
    return host.sdk.query('director.thread', { key: 'Mill job' });
};
const ok = out => assert.equal(out.ok, true, JSON.stringify(out));

for (const by of ['ui', 'reader']) test(`real module ${by} acceptance to one reward survives reload, rebuild and Re-read`, { skip }, async t => {
    const given = questPin({ requirements: [{ kind: 'class', classes: ['c0'] }, { kind: 'level', min: 1 }, { kind: 'stat', stat: 'STR', min: 5 }] });
    const h = await realQuestHost(t, { given });
    const thread = await offer(h);
    if (by === 'reader') await h.send('I accept the Mill job.', '<Changes>\n+ quest Mill job\n</Changes>');
    else ok(await h.sdk.command('quest.take', { id: thread.id }));
    const accepted = h.sdk.query('director.thread', { id: thread.id });
    assert.equal(accepted.rpg.state, 'active', JSON.stringify(h.store.problems()));
    const acceptanceIndex = h.ctx.chat.length - 1;
    const block = h.ctx.chat[acceptanceIndex].extra.storySuite.spans.find(span => span.guard?.predicate?.kind === 'quest.take');
    assert.deepEqual(accepted.rpg.acceptedCursor, block.boundaries[0].cursor, 'the real host boundary is retained');
    await h.send('Gather herbs.', 'Two herbs.');
    ok(h.bus.command('inventory.grant', { def: herb.id, qty: 2, owner: 'party' }, { cause: 'system' }));
    await h.send('Return to the mill.', 'The miller counts the herbs.');
    ok(await h.sdk.command('quest.finish', { id: thread.id }));
    const assertPaid = host => {
        assert.equal(host.sdk.query('inventory.wallet').coin, 30);
        assert.equal(host.sdk.query('party.pc').xp, 25);
        assert.equal(host.sdk.query('director.thread', { id: thread.id }).rpg.state, 'done');
        assert.deepEqual(host.store.problems(), []);
    };
    assertPaid(h);
    const loaded = await reload(t, h, given);
    assertPaid(loaded);
    loaded.store.rebuild();
    assertPaid(loaded);
    const reread = await loaded.turn.reread(acceptanceIndex);
    ok(reread);
    assertPaid(loaded);
    assert.equal((await loaded.sdk.command('quest.finish', { id: thread.id })).code, 'CLAIMED');
});

test('place, giver and frozen reward carry are recorded; reload never queries a foreign guard name', { skip }, async t => {
    const given = questPin({ giver: 'np_00000001', turnInPlace: 'pack.fixture/haven', reward: { coin: 30, xp: 25, items: [{ def: 'herb', qty: 1 }] } });
    const npc = { id: 'npc-state-delta', version: '1.2.20', queries: { 'npc.identity': () => ({ id: 'np_00000001', name: 'Miller', nativeKey: 'miller' }) } };
    const h = await realQuestHost(t, { given, modules: [npc] });
    // Canonical pack places come from a real installed pack, through the SD resolver.
    ok(await h.packs.packs.install(JSON.stringify({ id: 'fixture', version: '2.0.0', name: 'Places', requires: { storyBlock: '^2' }, content: { places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }] } })));
    const thread = await offer(h);
    ok(await h.sdk.command('quest.take', { id: thread.id }));
    ok(h.bus.command('inventory.grant', { def: herb.id, qty: 2, owner: 'party' }, { cause: 'system' }));
    assert.equal((await h.sdk.command('quest.finish', { id: thread.id })).code, 'REFUSED');
    await h.send('Return to Haven.', '<Changes>\n~ place Haven\n+ present Miller\n</Changes>');
    ok(await h.sdk.command('quest.finish', { id: thread.id }));
    const span = h.ctx.chat.at(-1).extra.storySuite.spans.find(span => span.guard?.predicate?.kind === 'quest.settlement');
    assert.equal(span.recorded.external.place.id, 'pack.fixture/haven');
    assert.equal(span.recorded.external.giverPresent, true);
    assert.ok(span.recorded.external.carry);
    const loaded = await reload(t, h, given);
    loaded.store.rebuild();
    assert.equal(loaded.sdk.query('inventory.wallet').coin, 30);
    assert.equal(loaded.sdk.query('party.pc').xp, 25);
    assert.deepEqual(loaded.store.problems(), []);
});

for (const durationMinutes of [null, 10]) test(`neutral upgrade retains its unset acceptance minute (${durationMinutes ?? 'untimed'})`, { skip }, async t => {
    const h = await realQuestHost(t, { given: questPin({ durationMinutes }) });
    const thread = 'th_00000001';
    ok(await h.sdk.command('threads.offer', { write: 'wr_00000001', thread, kind: 'hook', key: 'Mill job', summary: '', fields: {}, expectedHash: null }));
    ok(await h.sdk.command('threads.accept', { write: 'wr_00000002', thread, expectedHash: h.sdk.query('threads.hash', { thread }) }));
    const accepted = h.sdk.query('director.thread', { id: thread }).acceptance;
    assert.equal(accepted.minute, null);
    await h.send('The morning begins.', '<Changes>\n~ time June 3, 1200, 10:00 am\n</Changes>');
    const before = structuredClone(h.head());
    const taken = await h.sdk.command('quest.take', { id: thread });
    if (durationMinutes !== null) {
        assert.equal(taken.code, 'CLOCK_UNSET', JSON.stringify(taken));
        assert.deepEqual(h.head(), before, 'held upgrade writes no extension, claim or retry ledger');
    } else {
        ok(taken);
        const quest = h.sdk.query('director.thread', { id: thread }).rpg;
        assert.equal(quest.acceptedAt, null);
        assert.deepEqual(quest.acceptedCursor, accepted.cursor);
        h.store.rebuild();
        assert.equal(h.sdk.query('director.thread', { id: thread }).rpg.state, 'active');
        assert.deepEqual(h.store.problems(), []);
    }
});

test('removing an item required at acceptance retracts the acceptance and whole reward on reload', { skip }, async t => {
    const given = questPin({ requirements: [{ kind: 'item', def: 'herb', qty: 1 }] });
    const h = await realQuestHost(t, { given });
    const thread = await offer(h);
    await h.send('Find the required herb.', 'One herb.');
    const requirementIndex = h.ctx.chat.length - 1;
    ok(h.bus.command('inventory.grant', { def: herb.id, qty: 1, owner: 'party' }, { cause: 'system' }));
    await h.send('I take the job.', 'The miller agrees.');
    ok(await h.sdk.command('quest.take', { id: thread.id }));
    await h.send('Gather more herbs.', 'Two more herbs.');
    ok(h.bus.command('inventory.grant', { def: herb.id, qty: 2, owner: 'party' }, { cause: 'system' }));
    ok(await h.sdk.command('quest.finish', { id: thread.id }));
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
    await h.st.deleteMessage(requirementIndex);
    const loaded = await reload(t, h, given);
    loaded.store.rebuild();
    assert.equal(loaded.sdk.query('inventory.wallet').coin ?? 0, 0);
    assert.equal(loaded.sdk.query('party.pc').xp, 0);
    assert.equal(loaded.sdk.query('director.thread', { id: thread.id }).rpg.state, 'offered');
    assert.equal(loaded.head().meta.claims[`rb:ep_00000000:quest:${thread.id}:1:settled`], undefined);
});

test('overweight frozen reward leaves materials, XP, wallet, thread and retry ledger untouched', { skip }, async t => {
    const h = await realQuestHost(t, { given: questPin({ reward: { coin: 30, xp: 25, items: [{ def: 'herb', qty: 999 }] } }) });
    const thread = await offer(h);
    ok(await h.sdk.command('quest.take', { id: thread.id }));
    ok(h.bus.command('inventory.grant', { def: herb.id, qty: 2, owner: 'party' }, { cause: 'system' }));
    const before = structuredClone(h.head());
    const result = await h.sdk.command('quest.finish', { id: thread.id });
    assert.equal(result.code, 'REFUSED', JSON.stringify(result));
    assert.deepEqual(h.head(), before);
    assert.equal(h.sdk.query('rules.quests', {})[0].ready, false);
});

for (const sweep of ['afterCapture', 'beforeGenerate']) test(`real-module ${sweep} expires at the deadline with no payout`, { skip }, async t => {
    const given = questPin({ durationMinutes: 10 });
    const h = await realQuestHost(t, { given });
    await h.send('Morning.', '<Changes>\n~ time June 3, 1200, 08:00 am\n</Changes>');
    const thread = await offer(h);
    ok(await h.sdk.command('quest.take', { id: thread.id }));
    if (sweep === 'afterCapture') await h.send('Wait ten minutes.', '<Changes>\n~ time June 3, 1200, 08:10 am\n</Changes>');
    else {
        ok(h.bus.command('director.advance', { minutes: 10, cause: 'expiry-test' }, { cause: 'system' }));
        const intercept = h.st.interceptor;
        h.st.interceptor = async (...args) => {
            await intercept(...args);
            assert.equal(h.sdk.query('director.thread', { id: thread.id }).rpg.state, 'expired', 'expiry precedes the generated reply');
        };
        await h.send('Look around.', 'The miller waits.');
    }
    const verify = host => {
        const quest = host.sdk.query('director.thread', { id: thread.id }).rpg;
        assert.equal(quest.state, 'expired');
        assert.equal(quest.settlement.coinPaid, 0);
        assert.equal(host.sdk.query('inventory.wallet').coin ?? 0, 0);
        assert.equal(host.sdk.query('party.pc').xp, 0);
        assert.deepEqual(host.store.problems(), []);
    };
    verify(h);
    const loaded = await reload(t, h, given);
    loaded.store.rebuild();
    verify(loaded);
});
