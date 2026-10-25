// A missing native checkpoint still holds visibly; a settled host selection retracts the death automatically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ok } from './helpers.js';
import { savedWorld } from './return-helper.js';
import { seeded } from '../integration/helpers/host.js';
import { createDeathPart } from '../../../src/v2/death/index.js';
import { generationProblem } from '../../../src/v2/death/selection.js';

test('F4: an unavailable native checkpoint keeps the story held with a player-facing reason and a remedy', async t => seeded(17, async () => {
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
