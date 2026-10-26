// A missing native checkpoint still holds visibly; a settled host selection retracts the death automatically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ok } from './helpers.js';
import { savedWorld } from './return-helper.js';
import { seeded } from '../integration/helpers/host.js';
import { createDeathPart } from '../../../src/v2/death/index.js';
import { generationProblem, historySelectionProblem } from '../../../src/v2/death/selection.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';

test('F4: an unavailable native checkpoint keeps the story held with a player-facing reason and a remedy', async t => seeded(1, async () => {
    const w = await savedWorld(t);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    await w.say('The lethal reply.');
    const event = w.lethal(w.friend);
    ok(w.command('death.resolve', { event: event.event }));
    ok(await w.coordinator.deliver(w.slice('death').batches[event.batch].result));
    assert.equal(w.native.live.dossiers.lyra.alive, false);
    const entry = w.host.timeline.host.journal().findLast(e => e.kind === 'native-event');
    for (const id of Object.keys(w.native.checkpoints)) if (id !== entry.after.checkpoint) w.native.missing.add(id);
    const index = w.host.ctx.chat.findIndex(m => !m.is_user && String(m.mes ?? '').includes('The lethal reply.'));
    await w.host.st.deleteMessage(index);
    await w.host.st.deleteMessage(index - 1);
    assert.equal(w.q('party.actor', { id: w.friend }), null, 'reads remain held until the checkpoint can follow');
    assert.equal(w.native.live.dossiers.lyra.alive, false, 'while the native record still says dead');
    const host = w.host.timeline.host;
    const reason = generationProblem(w.head(), host, w.q('savepoint.contract'));
    assert.ok(reason, 'generation is held');
    const part = createDeathPart({ host: () => host });
    assert.deepEqual(part.hooks.canGenerate({ state: w.head(), query: w.q }), { ok: false, reason, action: false });
    const recovered = await w.coordinator.recover();
    assert.equal(recovered.code, 'SNAPSHOT_UNAVAILABLE');
    for (const text of [reason, recovered.message]) {
        assert.doesNotMatch(text, /E6b|Story Block must|native checkpoint/i, 'no internal wording');
        assert.match(text, /death/);
        assert.match(text, /restore a save point from before the death/);
        assert.match(text, /put that reply back/);
    }
}));

test('F4: deleting the lethal reply selects the living native checkpoint; an older host still reports its mismatch', async t => seeded(1, async () => {
    const w = await savedWorld(t);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    await w.say('The lethal reply.');
    const event = w.lethal(w.friend);
    ok(w.command('death.resolve', { event: event.event }));
    ok(await w.coordinator.deliver(w.slice('death').batches[event.batch].result));
    assert.equal(w.native.live.dossiers.lyra.alive, false);
    const index = w.host.ctx.chat.findIndex(m => !m.is_user && String(m.mes ?? '').includes('The lethal reply.'));
    await w.host.st.deleteMessage(index);
    await w.host.st.deleteMessage(index - 1);
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'alive', 'the story has her alive again');
    assert.equal(w.native.live.dossiers.lyra.alive, true, 'the synced host reselects the native checkpoint too');
    const host = w.host.timeline.host;
    const reason = generationProblem(w.head(), host);
    assert.equal(reason, null, 'a completed native selection removed the mismatch');
    const part = createDeathPart({ host: () => host });
    assert.deepEqual(part.hooks.canGenerate({ state: w.head(), query: w.q }), { ok: true });
    const recovered = await w.coordinator.recover();
    assert.equal(recovered.ok, true);
    const oldJournal = host.journal().filter(entry => entry.kind !== 'selection');
    const oldReason = historySelectionProblem(w.head(), oldJournal);
    assert.ok(oldReason, 'without native selection the older host still holds the mismatch');
    for (const text of [oldReason]) {
        assert.doesNotMatch(text, /E6b|Story Block must|native checkpoint/i, 'no internal wording');
        assert.match(text, /death/);
        assert.match(text, /restore a save point from before the death/);
        assert.match(text, /put that reply back/);
    }
}));

test('a completed host selection must retain each surviving native death acknowledgement', () => {
    const point = hash => ({ module: 'npc-state-delta', schema: 1, hash });
    const state = { domains: { death: { outbox: { batch: { native: [{ event: 'death' }] } } } } };
    const death = { kind: 'native-event', phase: 'done', event: 'death', participant: 'npc-state-delta', before: point('living'), after: point('dead') };
    const select = hash => ({ kind: 'selection', phase: 'complete', desired: { 'npc-state-delta': point(hash) } });
    assert.match(historySelectionProblem(state, [death, select('living')]), /death remains/);
    assert.equal(historySelectionProblem(state, [death, select('living')], { api: 2, participantsReady: true }), null,
        'the current host barrier checks live dossier agreement through nativeSelection');
    assert.equal(historySelectionProblem(state, [death, select('dead')]), null);
    const edit = { kind: 'native-mutation', phase: 'done', before: point('dead'), after: point('dead-with-new-trust') };
    assert.equal(historySelectionProblem(state, [death, edit, select('dead-with-new-trust')]), null,
        'a later native edit retains the acknowledged death');
    const restore = { kind: 'restore', phase: 'complete', before: [point('dead')], participants: { 'npc-state-delta': point('living') } };
    assert.match(historySelectionProblem(state, [death, restore, select('living')]), /death remains/,
        'a restore does not inherit the deaths it undoes');
    assert.equal(historySelectionProblem({ domains: {} }, [death, select('living')]), null,
        'a retracted death and its reselected living checkpoint agree');
});
