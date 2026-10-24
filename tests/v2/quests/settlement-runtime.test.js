// Real retained commands share one guarded SD/SB/RB settlement; missing prerequisites retract it.
import assert from 'node:assert/strict';
import { run, withPc, pcOf } from '../party/helpers/fake-ctx.js';
import { test, offer, questHost, template, herb } from './helpers/host.js';

async function ready(t, options = {}) {
    const h = await questHost(options);
    t.after(() => h.close());
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    await h.send('Gather the herbs.', 'We return with herbs.');
    const given = h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' });
    assert.equal(given.ok, true, given.message);
    return { h, id: thread.id };
}

for (const selector of ['id', 'key']) test(`quest.finish retains ${selector} selector and commits one reward/closure/journal/claim`, async t => {
    const { h, id } = await ready(t);
    const before = h.sdk.query('party.pc');
    const finished = await h.sdk.command('quest.finish', { [selector]: selector === 'id' ? id : 'Mill job' });
    assert.equal(finished.ok, true, finished.message);
    const thread = h.sdk.query('director.thread', { id });
    assert.equal(thread.rpg.state, 'done');
    assert.equal(thread.status, 'resolved');
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
    assert.equal(h.sdk.query('party.pc').xp - before.xp, 25);
    assert.equal(h.sdk.query('chronicle.questLog', { id }).filter(row => row.text === 'Mill job: done.').length, 1);
    const key = `rb:ep_00000000:quest:${id}:1:settled`;
    assert.equal(thread.rpg.settlement.claim, key);
    assert.equal(h.head().meta.claims[key], true);
    const last = h.ctx.chat.at(-1).extra.storySuite;
    const span = last.spans.find(s => s.guard?.predicate?.kind === 'quest.settlement');
    assert.ok(span);
    assert.equal(span.operation.type, 'quest.finish');
    assert.equal(span.recorded.inputs.plan.payout.xp, 25);
    assert.ok(span.claims.includes(key));
    assert.equal((await h.sdk.command('quest.finish', { id })).code, 'CLAIMED');
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
});

test('a failure after closure rolls back journal, claim, consumption, coin and XP', async t => {
    const { h, id } = await ready(t, { templates: [template({ reward: { coin: 30, xp: 25, items: [{ def: 'pack.fixture/missing', qty: 1 }] } })],
        policy: { canReceive: () => ({ ok: true }) } });
    const before = structuredClone(h.head());
    const failed = await h.sdk.command('quest.finish', { id });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'NOT_FOUND');
    assert.deepEqual(h.head(), before);
});

test('zero XP omits the XP call and abandoned pays no reward', async t => {
    const { h, id } = await ready(t, { templates: [template({ reward: { coin: 30, xp: 0, items: [] } })] });
    const xp = h.sdk.query('party.pc').xp;
    assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
    assert.equal(h.sdk.query('party.pc').xp, xp);
    assert.equal(Object.keys(h.head().meta.claims).filter(key => key.startsWith('xp:')).length, 0);
    const next = await ready(t);
    assert.equal((await next.h.sdk.command('quest.abandon', { id: next.id })).ok, true);
    assert.equal(next.h.sdk.query('inventory.wallet').coin ?? 0, 0);
    assert.equal(next.h.sdk.query('director.thread', { id: next.id }).rpg.state, 'abandoned');
});

test('raw fight results cannot grant a second XP award', () => {
    const state = withPc();
    const pc = pcOf(state);
    const result = run(state, 'party.applyResult', { result: { party: [{ memberId: pc.id, hp: pc.hp, mp: pc.mp }], xp: { [pc.id]: 99 }, uses: {} } });
    assert.equal(result.ok, true, result.message);
    assert.equal(pcOf(result.state).xp, pc.xp);
});
