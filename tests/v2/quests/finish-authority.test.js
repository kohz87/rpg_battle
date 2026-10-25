// Root cause is not authority for an unrelated module to settle an RPG quest.
import assert from 'node:assert/strict';
import { test, questHost, offer, herb } from './helpers/host.js';

async function ready(t, options = {}) {
    const h = await questHost(options);
    t.after(() => h.close());
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
    return { h, id: thread.id };
}

test('quest.finish refuses third-module, unauthenticated story and root system calls; UI remains valid', async t => {
    const { h, id } = await ready(t, { extra: [{ id: 'third', version: '1.0.0', commands: {
        'third.finish': (ctx, payload) => ctx.call('quest.finish', payload),
    } }] });
    const before = structuredClone(h.head());
    assert.equal((await h.sdk.command('third.finish', { id })).code, 'REFUSED');
    for (const cause of ['system', 'story']) {
        assert.equal(h.bus.command('third.finish', { id }, { cause }).code, 'REFUSED');
        assert.equal(h.bus.command('quest.finish', { id }, { cause }).code, 'REFUSED');
    }
    assert.deepEqual(h.head(), before);
    assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
});

test('RB may settle through its own trusted nested command', async t => {
    const { h, id } = await ready(t, { commands: { 'fixture.finish': (ctx, payload) => ctx.call('quest.finish', payload) } });
    const out = h.bus.command('fixture.finish', { id }, { cause: 'system' });
    assert.equal(out.ok, true, out.message);
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
});

test('Continue before and after a settlement preserves one payment, XP award and settlement claim', async t => {
    const { h, id } = await ready(t);
    await h.send('Return the herbs.', 'We arrive at the mill.');
    await h.cont(' The miller counts them.');
    assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
    await h.cont(' He thanks us.');
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
    assert.equal(h.sdk.query('party.pc').xp, 25);
    assert.equal(Object.keys(h.head().meta.claims).filter(key => key === `rb:ep_00000000:quest:${id}:1:settled`).length, 1);
    const loaded = await questHost({ st: { chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) } });
    t.after(() => loaded.close());
    assert.equal(loaded.sdk.query('inventory.wallet').coin, 30);
    assert.equal(loaded.sdk.query('party.pc').xp, 25);
});
