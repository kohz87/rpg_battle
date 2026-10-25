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
const ok = out => assert.equal(out.ok, true, `${out.code}: ${out.message}`);

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
    ok(await h.packs.packs.install(JSON.stringify({ id: 'fixture', version: '2.0.0', name: 'Places', content: { places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }] } })));
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
    h.store.rebuild();
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
    assert.equal(h.sdk.query('party.pc').xp, 25);
    assert.deepEqual(h.store.problems(), []);
});
