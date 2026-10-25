import test from 'node:test';
import assert from 'node:assert/strict';
import { world, ok } from './helpers.js';
import { savedWorld, coordinator } from './return-helper.js';
import { nativeFixture } from './native.js';
import { wipe } from './fight-helper.js';
import { seeded } from '../integration/helpers/host.js';
import { crash } from '../../vendor/story-block/src/v2/timeline/util.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';

function track(host) {
    const disk = { image: null };
    const save = host.ctx.saveChat;
    host.ctx.saveChat = async (...args) => {
        const out = await save.apply(host.ctx, args);
        disk.image = structuredClone({ chat: host.ctx.chat, metadata: host.ctx.chatMetadata });
        return out;
    };
    return disk;
}

const phases = ['outbox', 'prepare.journaled', 'prepare.participant:npc-state-delta', 'prepare.prepared', 'activate.checked', 'activate.committed', 'activate.participant:npc-state-delta:before', 'activate.participant:npc-state-delta:acked', 'activate.acked', 'activate.completed'];
for (const phase of phases) test(`B6 crash/reload at ${phase}: keep the sealed choice, recover and wake once`, async t => seeded(91, async () => {
    let armed = false;
    const faults = { at(p) { if (armed && p === phase) throw crash(phase); } };
    const w = await savedWorld(t, { faults });
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const ref = (await wipe(w)).receipt.data.deathBatch;
    const bytes = structuredClone(w.slice('progress').batches[ref.id].bytes);
    const disk = track(w.host);
    await w.host.store.flush();
    armed = true;
    if (phase !== 'outbox') await assert.rejects(w.coordinator.deliver(ref), error => error.message === phase);
    w.host.close();
    const loaded = await world(t, { native: nativeFixture(w.native), image: disk.image });
    const c = coordinator(loaded);
    ok(await c.deliver(ref));
    assert.equal(loaded.q('return.status').lastReturn.snapshot, w.target.id);
    assert.equal(loaded.q('return.status').lastReturn.status, 'complete');
    assert.equal(lifeOf(loaded.q('party.actor', { id: loaded.pc })), 'alive');
    assert.equal(w.native.live.dossiers.lyra.alive, true);
    assert.deepEqual(loaded.host.timeline.host.pin(ref.id).bytes, bytes);
    ok(await c.deliver(ref));
    assert.equal(Object.keys(loaded.slice('death').wakes).length, 1);
    assert.deepEqual(loaded.problems(), []);
}));

test('native-event journal crash: retry resumes one death and returns the durable original ack', async t => seeded(17, async () => {
    let armed = false;
    const w = await savedWorld(t, { faults: { at(p) { if (armed && p === 'native.journaled') throw crash(p); } } });
    const event = w.lethal(w.friend);
    ok(w.command('death.resolve', { event: event.event }));
    const ref = w.slice('death').batches[event.batch].result;
    assert.equal(w.slice('progress').batches[ref.id].bytes.events[0].outcome, 'dead');
    const disk = track(w.host);
    await w.host.store.flush();
    armed = true;
    await assert.rejects(w.coordinator.deliver(ref), /native.journaled/);
    w.host.close();
    const loaded = await world(t, { native: nativeFixture(w.native), image: disk.image });
    const c = coordinator(loaded);
    ok(await c.deliver(ref));
    ok(await c.deliver(ref));
    assert.deepEqual(w.native.live.applied, [event.event]);
    assert.equal(w.native.live.dossiers.lyra.alive, false);
    const first = ok(await loaded.host.sdk.timeline.head({}));
    const ack = ok(await loaded.host.timeline.host.nativeEvent({ event: event.event, participant: 'npc-state-delta', npc: 'np_00000001', kind: 'confirmed-death', expectedHead: first.headHash }));
    const again = ok(await loaded.host.timeline.host.nativeEvent({ event: event.event, participant: 'npc-state-delta', npc: 'np_00000001', kind: 'confirmed-death', expectedHead: first.headHash }));
    assert.deepEqual(ack, again);
    assert.equal((await loaded.host.timeline.host.nativeEvent({ event: event.event, participant: 'npc-state-delta', npc: 'np_00000002', kind: 'confirmed-death', expectedHead: first.headHash })).code, 'CONFLICT');
}));

for (const method of ['activate', 'applyEvent']) test(`native ${method} crash after writing: recovery acknowledges one application`, async t => seeded(method === 'activate' ? 91 : 17, async () => {
    const w = await savedWorld(t);
    let ref, event;
    if (method === 'activate') {
        await w.say('<Changes>\n~ time 15840\n</Changes>');
        ref = (await wipe(w)).receipt.data.deathBatch;
    } else {
        event = w.lethal(w.friend);
        ok(w.command('death.resolve', { event: event.event }));
        ref = w.slice('death').batches[event.batch].result;
    }
    const disk = track(w.host);
    await w.host.store.flush();
    w.native.crashAfter = new Set([method]);
    await assert.rejects(w.coordinator.deliver(ref), new RegExp(`native.${method}.applied`));
    w.host.close();
    const loaded = await world(t, { native: nativeFixture(w.native), image: disk.image });
    ok(await coordinator(loaded).deliver(ref));
    if (method === 'activate') {
        assert.equal(w.native.calls.filter(c => c.method === 'activate').length, 1);
        assert.equal(Object.keys(loaded.slice('death').wakes).length, 1);
    } else {
        assert.deepEqual(w.native.live.applied, [event.event]);
        assert.equal(w.native.live.dossiers.lyra.alive, false);
    }
    assert.deepEqual(loaded.problems(), []);
}));
