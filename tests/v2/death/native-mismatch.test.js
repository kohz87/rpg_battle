// B6 review F4: a native mismatch (the dossier says dead, the reply that killed is gone) is held, and the hold says what
// the player can do today. The full fix is the host's native checkpoint selection (GAPS.md, "must close before release").
import test from 'node:test';
import assert from 'node:assert/strict';
import { ok } from './helpers.js';
import { savedWorld } from './return-helper.js';
import { seeded } from '../integration/helpers/host.js';
import { createDeathPart } from '../../../src/v2/death/index.js';
import { generationProblem } from '../../../src/v2/death/selection.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';

test('F4: native history reselects after a delete; a legacy mismatch still gives a player-facing remedy', async t => seeded(1, async () => {
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
    assert.equal(w.native.live.dossiers.lyra.alive, true, 'E6b reselects the surviving native checkpoint');
    // Preserve the old-host refusal coverage by recreating its unmatched native dossier explicitly.
    w.native.live.dossiers.lyra.alive = false;
    assert.equal(w.native.live.dossiers.lyra.alive, false, 'legacy host mismatch fixture');
    const host = w.host.timeline.host;
    const reason = generationProblem(w.head(), host);
    assert.ok(reason, 'generation is held');
    const part = createDeathPart({ host: () => host });
    assert.deepEqual(part.hooks.canGenerate({ state: w.head() }), { ok: false, reason, action: false });
    const recovered = await w.coordinator.recover();
    assert.equal(recovered.code, 'DEPENDENCY_UNAVAILABLE');
    for (const text of [reason, recovered.message]) {
        assert.doesNotMatch(text, /E6b|Story Block must|native checkpoint/i, 'no internal wording');
        assert.match(text, /death/);
        assert.match(text, /restore a save point from before the death/);
        assert.match(text, /put that reply back/);
    }
}));
