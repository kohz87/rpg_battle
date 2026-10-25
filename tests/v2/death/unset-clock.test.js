// B6 review F2: an unset story clock must not make a PC wipe permanent when a manual or initial save exists (contract §8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { world, ok } from './helpers.js';
import { nativeFixture, NPC } from './native.js';
import { coordinator } from './return-helper.js';
import { wipe } from './fight-helper.js';
import { seeded } from '../integration/helpers/host.js';
import { selectSnapshot } from '../../../src/v2/death/plan.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';

const p = (id, kind, extra = {}) => ({ id, kind, payloadHash: `h-${id}`, ...extra });

test('F2: with no clock the latest manual save wins, else the initial save, else none; with a clock the day rule is unchanged', () => {
    const initial = p('i', 'initial');
    const manual = p('m1', 'manual');
    const later = p('m2', 'manual');
    assert.deepEqual(selectSnapshot([initial], null), { id: 'i', payloadHash: 'h-i' });
    assert.deepEqual(selectSnapshot([initial, manual, later], null), { id: 'm2', payloadHash: 'h-m2' });
    assert.deepEqual(selectSnapshot([manual], null), { id: 'm1', payloadHash: 'h-m1' });
    assert.equal(selectSnapshot([p('d', 'day-start', { day: 3 })], null), null, 'no previous day is invented without a clock');
    assert.equal(selectSnapshot([], null), null);
    assert.equal(selectSnapshot(undefined, null), null);
    const d10 = p('d10', 'day-start', { day: 10 });
    assert.deepEqual(selectSnapshot([initial, d10, manual], 15840), { id: 'm1', payloadHash: 'h-m1' }, 'a more recent manual save wins');
    assert.deepEqual(selectSnapshot([initial, manual, d10], 15840), { id: 'd10', payloadHash: 'h-d10' });
    assert.deepEqual(selectSnapshot([initial], 15840), { id: 'i', payloadHash: 'h-i' });
});

async function unset(t) {
    const native = nativeFixture();
    const w = await world(t, { native });
    ok(w.command('test.linkNpc', { actor: w.friend, npc: NPC }));
    assert.equal(w.q('director.time').minutes, null, 'the clock is unset');
    return { ...w, native: native.native, coordinator: coordinator(w) };
}

test('F2: a PC wipe with an unset clock returns to the initial save, and to a later manual one', async t => seeded(91, async () => {
    const w = await unset(t);
    const initial = ok(await w.host.timeline.host.make({ kind: 'initial' })).snapshot;
    const manual = ok(await w.host.timeline.host.make({ kind: 'manual', name: 'Before the road' })).snapshot;
    await w.say('The road goes on.');
    const ref = (await wipe(w)).receipt.data.deathBatch;
    const bytes = w.slice('progress').batches[ref.id].bytes;
    assert.equal(bytes.returnRequested, true);
    assert.equal(bytes.minute, null);
    assert.equal(bytes.snapshot.id, manual.id, 'the manual save is more recent than the initial one');
    assert.notEqual(bytes.snapshot.id, initial.id);
    assert.equal(w.q('return.status').point.snapshot, manual.id);
    ok(await w.coordinator.deliver(ref));
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'alive');
    assert.equal(w.q('return.status').lastReturn.snapshot, manual.id);
    assert.deepEqual(w.problems(), []);
}));

test('F2: with only the initial save and no clock the wipe returns to it instead of blocking the story', async t => seeded(92, async () => {
    const w = await unset(t);
    const initial = ok(await w.host.timeline.host.make({ kind: 'initial' })).snapshot;
    await w.say('The road goes on.');
    const ref = (await wipe(w)).receipt.data.deathBatch;
    const bytes = w.slice('progress').batches[ref.id].bytes;
    assert.equal(bytes.snapshot.id, initial.id);
    assert.equal(w.q('return.status').point.snapshot, initial.id);
    const out = await w.coordinator.deliver(ref);
    assert.equal(out.code, undefined, out.message);
    ok(out);
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'alive');
    assert.deepEqual(w.problems(), []);
}));
