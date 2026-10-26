import test from 'node:test';
import assert from 'node:assert/strict';
import { world, ok } from './helpers.js';
import { nativeFixture, NPC } from './native.js';
import { seeded } from '../integration/helpers/host.js';
import { createDeathCoordinator } from '../../../src/v2/death/coordinator.js';
import { returnInTime } from '../../../src/v2/return/index.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';
import { wipe } from './fight-helper.js';

import { coordinator, savedWorld } from './return-helper.js';

test('C12 rules side: full return restores RB/native companion, fades rewards and wakes exactly once', async t => seeded(1, async () => {
    const w = await savedWorld(t);
    await w.say('The rewarded deed.');
    ok(w.command('test.reward'));
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const companion = w.lethal(w.friend);
    const companionOut = ok(w.command('death.resolve', { event: companion.event }));
    const companionRef = w.slice('death').batches[companion.batch].result;
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'dead');
    ok(await w.coordinator.deliver(companionRef));
    assert.equal(w.native.live.dossiers.lyra.alive, false);
    const nativeCount = w.native.live.applied.length;
    ok(await w.coordinator.deliver(companionRef));
    assert.equal(w.native.live.applied.length, nativeCount);
    await w.say('The fatal fight.');
    // Dead companions are excluded; the active PC still wipes directly.
    ok(w.command('party.setActive', { actors: [w.pc] }, 'ui'));
    const result = await wipe(w);
    const ref = result.receipt.data.deathBatch;
    const out = ok(await w.coordinator.deliver(ref));
    assert.equal(out.status, 'complete');
    assert.equal(w.q('director.time').minutes, 14400);
    assert.equal(w.q('inventory.wallet', { owner: 'party' }).coin ?? 0, 0);
    assert.equal(w.q('party.actor', { id: w.pc }).xp, 0);
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'alive');
    assert.equal(w.native.live.dossiers.lyra.alive, true);
    assert.equal(w.native.live.applied.length, 0);
    assert.equal(Object.keys(w.head().meta.claims).includes('xp:c12:reward'), false);
    assert.equal(Object.keys(w.head().meta.claims).includes('c12:reward'), false);
    const status = w.q('return.status');
    assert.equal(status.dead, false);
    assert.equal(status.pending, false);
    assert.equal(status.lastReturn.snapshot, w.target.id);
    assert.deepEqual(status.lastReturn.batchResult, ref);
    assert.equal(Object.keys(w.slice('death').wakes).length, 1);
    const pin = w.host.timeline.host.pin(ref.id);
    assert.equal(pin.bytes.events[0].check, null);
    assert.equal(pin.hash, ref.hash);
    assert.ok(pin.manifestHash && pin.preRestore.payload.domains.death.outbox);
    const history = ok(await w.host.sdk.timeline.history({}));
    assert.ok(history.messages.some(m => m.text.includes('rewarded deed') && !m.active));
    assert.ok(w.host.ctx.chat.some(m => m.mes.includes('rewarded deed')));
    const retry = ok(await w.coordinator.deliver(ref));
    assert.equal(retry.receipt.narrate, false);
    assert.equal(Object.keys(w.slice('death').wakes).length, 1);
    w.host.store.rebuild();
    assert.equal(Object.keys(w.slice('death').wakes).length, 1);
    assert.deepEqual(w.problems(), []);
    ok(w.command('test.reward'));
    assert.equal(w.command('test.reward').code, 'CLAIMED');
    assert.equal(w.q('inventory.wallet', { owner: 'party' }).coin, 30);
    assert.equal(w.q('party.actor', { id: w.pc }).xp, 25);
    void companionOut;
}));

test('C11: missing selected snapshot bytes holds the exact death; another manual save cannot replace it', async t => seeded(91, async () => {
    const w = await savedWorld(t);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const ref = (await wipe(w)).receipt.data.deathBatch;
    ok(await w.host.sdk.command('savepoint.make', { name: 'A later point cannot replace the sealed choice' }));
    const archive = w.host.ctx.chatMetadata.storySuite.timeline;
    delete archive.payloads[w.target.payloadHash];
    const out = await w.coordinator.deliver(ref);
    assert.equal(out.code, 'SNAPSHOT_UNAVAILABLE');
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'dead');
    assert.equal(w.native.live.dossiers.lyra.alive, true);
    assert.equal(Object.keys(w.slice('death').wakes).length, 0);
}));

test('return authority: public SDK, legacy payload, UI wake and a forged complete id all refuse', async t => seeded(91, async () => {
    const w = await savedWorld(t);
    assert.equal((await returnInTime(w.host.sdk)).code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(w.command('return.cue', { return: 'rt_00000001' }, 'ui').code, 'REFUSED');
    assert.equal(w.command('return.cue', { return: 'rt_00000001' }).code, 'REFUSED');
    assert.equal(w.command('return.cue', { fight: 'fi_00000001', place: '' }).code, 'INVALID');
    const publicOnly = createDeathCoordinator({ timeline: w.host.sdk.timeline, state: w.head, command: w.command, query: w.q });
    assert.equal((await publicOnly.deliver({ id: 'br_00000001', hash: 'a'.repeat(64) })).code, 'DEPENDENCY_UNAVAILABLE');
}));

test('native activation failure holds all mechanics and wake until exact journal recovery', async t => seeded(91, async () => {
    const w = await savedWorld(t);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const ref = (await wipe(w)).receipt.data.deathBatch;
    w.native.fail.add('activate');
    const out = await w.coordinator.deliver(ref);
    assert.equal(out.status, 'participants-pending');
    assert.equal((await w.host.sdk.timeline.head({})).code, 'RESTORE_PENDING');
    assert.equal(w.command('return.cue', { return: out.return }).ok, false);
    w.native.fail.delete('activate');
    ok(await w.coordinator.recover());
    assert.equal(w.q('return.status').lastReturn.status, 'complete');
    assert.equal(Object.keys(w.slice('death').wakes).length, 1);
}));
