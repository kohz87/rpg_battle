import test from 'node:test';
import assert from 'node:assert/strict';
import { ok } from './helpers.js';
import { savedWorld, coordinator } from './return-helper.js';
import { createDeathCoordinator } from '../../../src/v2/death/coordinator.js';
import { wipe } from './fight-helper.js';
import { seeded } from '../integration/helpers/host.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';

test('a pending host recovery cannot proceed to death delivery or a wake', async t => {
    const w = await savedWorld(t);
    const c = createDeathCoordinator({ timeline: w.host.sdk.timeline, host: { ...w.host.timeline.host,
        recover: async () => ({ ok: true, state: 'pending', return: 'rt_00000001' }),
    }, state: w.head, command() { assert.fail('no wake while pending'); }, query() { assert.fail('no module read while pending'); } });
    assert.equal((await c.deliver({ id: 'br_00000001', hash: 'a'.repeat(64) })).code, 'RESTORE_PENDING');
});

test('a changed outbox cannot skip the native death recorded by its sealed result', async t => seeded(17, async () => {
    const w = await savedWorld(t);
    const e = w.lethal(w.friend);
    ok(w.command('death.resolve', { event: e.event }));
    const ref = w.slice('death').batches[e.batch].result;
    const state = structuredClone(w.head());
    // [damaged file] A surviving outbox and a valid immutable result disagree.
    state.domains.death.outbox[e.batch].native = [];
    const c = createDeathCoordinator({ timeline: w.host.sdk.timeline, host: w.host.timeline.host, state: () => state, command: w.command, query: w.q });
    assert.equal((await c.deliver(ref)).code, 'CONFLICT');
    assert.equal(w.native.live.dossiers.lyra.alive, true);
}));

test('missing native checkpoint bytes hold the exact return without rolling or waking', async t => seeded(91, async () => {
    const w = await savedWorld(t);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const ref = (await wipe(w)).receipt.data.deathBatch;
    const bytes = structuredClone(w.slice('progress').batches[ref.id].bytes);
    w.native.missing.add(w.target.participants[0].checkpoint);
    assert.equal((await w.coordinator.deliver(ref)).code, 'SNAPSHOT_UNAVAILABLE');
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'dead');
    assert.equal(Object.keys(w.slice('death').wakes).length, 0);
    assert.deepEqual(w.slice('progress').batches[ref.id].bytes, bytes);
    w.native.missing.clear();
    ok(await w.coordinator.deliver(ref));
    assert.deepEqual(w.host.timeline.host.pin(ref.id).bytes, bytes);
}));

test('another epoch death has a different return and cue even at the same saved point', async t => seeded(91, async () => {
    const w = await savedWorld(t);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const first = (await wipe(w)).receipt.data.deathBatch;
    ok(await w.coordinator.deliver(first));
    const r1 = structuredClone(w.q('return.status').lastReturn);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const second = (await wipe(w)).receipt.data.deathBatch;
    ok(await w.coordinator.deliver(second));
    const r2 = w.q('return.status').lastReturn;
    assert.equal(r2.snapshot, r1.snapshot);
    assert.notEqual(r2.id, r1.id);
    assert.notEqual(r2.cue, r1.cue);
    assert.notEqual(first.id, second.id);
    assert.notEqual(r1.newEpoch, r2.newEpoch);
    assert.equal(Object.keys(w.slice('death').wakes).length, 1, 'the earlier future wake was restored away');
    assert.equal((await coordinator(w).deliver(first)).ok, false);
}));

test('a stale prepared head aborts before restore; retry retains the original target and checks', async t => seeded(91, async () => {
    let w, armed = false;
    w = await savedWorld(t, { faults: { at(phase) {
        if (armed && phase === 'prepare.prepared') {
            armed = false;
            ok(w.command('test.reward'));
        }
    } } });
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const ref = (await wipe(w)).receipt.data.deathBatch;
    const bytes = structuredClone(w.slice('progress').batches[ref.id].bytes);
    armed = true;
    assert.equal((await w.coordinator.deliver(ref)).code, 'STALE');
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'dead');
    assert.equal(w.native.calls.filter(c => c.method === 'activate').length, 0);
    assert.equal(Object.keys(w.slice('death').wakes).length, 0);
    ok(await w.coordinator.deliver(ref));
    assert.deepEqual(w.host.timeline.host.pin(ref.id).bytes, bytes);
    assert.equal(w.q('return.status').lastReturn.snapshot, w.target.id);
}));

test('the most recent manual point after day10 wins for a day11 death', async t => seeded(91, async () => {
    const w = await savedWorld(t);
    await w.say('<Changes>\n~ time 15000\n</Changes>');
    const save = ok(await w.host.sdk.command('savepoint.make', { name: 'Before the pass' }));
    const manual = w.q('savepoint.list').find(p => p.kind === 'manual');
    assert.ok(save.receipt);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const ref = (await wipe(w)).receipt.data.deathBatch;
    assert.equal(w.slice('progress').batches[ref.id].bytes.snapshot.id, manual.id);
    ok(await w.coordinator.deliver(ref));
    assert.equal(w.q('director.time').minutes, 15000);
    assert.equal(w.q('return.status').lastReturn.snapshot, manual.id);
}));

test('simultaneous companion and PC death seals both original checks and makes one return', async t => seeded(1, async () => {
    const w = await savedWorld(t);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const friend = w.lethal(w.friend);
    const pc = w.lethal(w.pc);
    assert.equal(friend.batch, pc.batch);
    const result = ok(w.command('death.resolve', { event: pc.event }));
    const ref = w.slice('death').batches[pc.batch].result;
    const original = structuredClone(w.slice('progress').batches[ref.id].bytes);
    assert.deepEqual(original.events.map(e => e.outcome), ['dead', 'dead']);
    assert.ok(original.events.every(e => e.check !== null));
    assert.equal(original.returnRequested, true);
    const delivered = await Promise.all([w.coordinator.deliver(ref), w.coordinator.deliver(ref)]);
    delivered.forEach(ok);
    assert.equal(w.host.timeline.host.journal().filter(e => e.kind === 'restore' && e.phase === 'complete').length, 1);
    assert.equal(Object.keys(w.slice('death').wakes).length, 1);
    assert.deepEqual(w.host.timeline.host.pin(ref.id).bytes, original);
    assert.equal(w.native.live.dossiers.lyra.alive, true);
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'alive');
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'alive');
    assert.ok(result.receipt.data.v2.result.batch);
}));
