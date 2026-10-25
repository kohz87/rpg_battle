// Real SB host + RB module/death part + NSD's shipped adapter, identity and participant.
// Only the native storage/DOM ports are synthetic; no participant callback or selection rule is replaced.
// NSD is an optional sibling checkout, as in the shared matrix. Set NATIVE_DEATH_NSD to require another path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { world, ok } from './helpers.js';
import { coordinator } from './return-helper.js';
import { seeded } from '../integration/helpers/host.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';
import { generationProblem } from '../../../src/v2/death/selection.js';
import { assertFullReplay } from './replay-helper.js';

const root = resolve(process.env.NATIVE_DEATH_NSD ?? fileURLToPath(new URL('../../../../npc_state_delta/', import.meta.url)));
const entry = resolve(root, 'src/storysuite-v2.js');
const available = existsSync(entry);
if (process.env.NATIVE_DEATH_NSD && !available) throw new Error(`NSD not found at ${entry}`);
const options = { skip: available ? false : 'NSD sibling checkout is absent (set NATIVE_DEATH_NSD)' };
const nsd = available ? await import(pathToFileURL(entry)) : null;
const vaults = available ? await import(pathToFileURL(resolve(root, 'src/storysuite-participant/vault.js'))) : null;

function nativeModule({ live, vault }) {
    const runtime = {
        isEnabled: () => true,
        chatKey: () => 'native-death-test',
        getState: () => structuredClone(live.state),
        getNpc: id => live.state.npcs.find(npc => npc.id === id) ?? null,
        timelineStarted: () => Boolean(live.state.timeline?.lineage),
        installState: async state => {
            if (live.hold) await live.hold;
            live.state = structuredClone(state);
        },
        writeTimeline: async timeline => { live.state.timeline = structuredClone(timeline); },
        scanActive: () => false, scanIdle: async () => true,
    };
    const adapter = nsd.createStorySuiteV2Adapter({
        delta: () => runtime,
        suiteApi: { npcs: () => live.state.npcs },
        participantVault: vault,
        version: '1.2.21',
        doc: null,
    });
    return { module: adapter.definition };
}

async function story(t, saved = null, { withSave = true } = {}) {
    const live = saved?.live ?? { state: {
        npcs: [{ id: 'lyra', name: 'Lyra', aliases: [], lifeState: 'alive', lifeStateCertainty: 'explicit', present: true, archived: false }],
        socialGraph: { edges: [] }, checkpoints: [], lineage: [], turn: 1,
    } };
    const vault = saved?.vault ?? vaults.memoryVault();
    const w = await world(t, { native: nativeModule({ live, vault }), image: saved?.image });
    w.live = live;
    w.vault = vault;
    w.coordinator = coordinator(w);
    if (!saved) {
        // A manual point starts NSD's lineage and saves the living baseline; no scan or model request.
        if (withSave) ok(await w.host.sdk.timeline.make({ kind: 'manual', name: 'Before death' }));
        let identity = w.q('npc.identity', { name: 'Lyra' });
        for (let i = 0; !identity && i < 20; i++) {
            await new Promise(resolve => setImmediate(resolve));
            identity = w.q('npc.identity', { name: 'Lyra' });
        }
        assert.ok(identity?.id);
        ok(w.command('test.linkNpc', { actor: w.friend, npc: identity.id }));
        await w.say('<Changes>\n~ time 15840\n</Changes>');
        const evidence = w.proof('story', { actor: w.friend, cause: 'execution', lethal: true });
        // Capture and settle through the real module's afterCapture, with deterministic command entropy.
        await seeded(2, () => w.say(`The lethal reply.\n<Changes>\n! lethal ${w.friend} | cause: execution | evidence: ${evidence}\n</Changes>`));
        w.ref = Object.values(w.slice('death').batches)[0].result;
        ok(await w.coordinator.deliver(w.ref));
    }
    return w;
}

async function agrees(w, dead) {
    ok(await w.coordinator.recover());
    assert.equal(w.host.registry.restore().state, 'idle');
    assert.equal(w.q('savepoint.contract').participantsReady, true);
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), dead ? 'dead' : 'alive');
    const npc = w.live.state.npcs[0];
    assert.equal(npc.lifeState, dead ? 'deceased' : 'alive');
    assert.equal(npc.archived, dead);
    assert.equal(Object.keys(w.live.state.timeline.applied).length, dead ? 1 : 0);
    assert.equal(generationProblem(w.head(), w.host.timeline.host, w.q('savepoint.contract')), null);
    assert.deepEqual(await w.host.turn.blockers(), []);
    assert.deepEqual(w.problems(), []);
    const selected = ok(await w.host.sdk.timeline.status()).participants.find(p => p.module === 'npc-state-delta');
    const index = await w.vault.getIndex(w.live.state.timeline.lineage);
    assert.equal(index.base.checkpoint, selected.checkpoint, 'NSD confirms the checkpoint selected by SB');
}

async function reloadAndRebuild(t, w, dead) {
    const before = structuredClone({ domains: w.head().domains, native: w.live.state });
    assertFullReplay(w);
    await agrees(w, dead);
    await w.host.store.flush();
    const image = structuredClone({ chat: w.host.ctx.chat, metadata: w.host.ctx.chatMetadata });
    w.host.close();
    const next = await story(t, { live: w.live, vault: w.vault, image });
    await agrees(next, dead);
    assertFullReplay(next);
    await agrees(next, dead);
    assert.deepEqual({ domains: next.head().domains, native: next.live.state }, before);
    return next;
}

for (const change of ['delete', 'swipe', 'Re-read']) test(`real SB + RB + NSD: ${change} retracts a delivered native death`, options, async t => seeded(17, async () => {
    let w = await story(t);
    await agrees(w, true);
    w = await reloadAndRebuild(t, w, true);
    const at = w.host.ctx.chat.findIndex(m => m.mes.startsWith('The lethal reply.'));
    if (change === 'delete') await w.host.st.deleteMessage(at);
    else if (change === 'swipe') await w.host.swipe('Lyra survives.');
    else {
        await w.host.turn.reread(at);
        await agrees(w, true); // An unchanged Re-read preserves the death.
        w.host.ctx.chat[at].mes = 'Lyra survives.';
        await w.host.turn.reread(at);
    }
    await agrees(w, false);
    w = await reloadAndRebuild(t, w, false);
    if (change === 'swipe') {
        await w.host.st.swipeTo(at, 0);
        await agrees(w, true);
        await reloadAndRebuild(t, w, true);
    }
}));

test('real SB + RB + NSD: a death retracts without any save point', options, async t => seeded(17, async () => {
    const w = await story(t, null, { withSave: false });
    await agrees(w, true);
    assert.deepEqual(ok(await w.host.sdk.timeline.list()).points, []);
    const at = w.host.ctx.chat.findIndex(m => m.mes.startsWith('The lethal reply.'));
    await w.host.st.deleteMessage(at);
    await agrees(w, false);
    await reloadAndRebuild(t, w, false);
}));

test('real SB + RB + NSD: a missing living checkpoint keeps the barrier and visible remedy', options, async t => seeded(17, async () => {
    const w = await story(t);
    await agrees(w, true);
    for (const [id, bytes] of w.vault.docs) if (JSON.parse(bytes).state.npcs[0].lifeState === 'alive') w.vault.lose(id);
    const at = w.host.ctx.chat.findIndex(m => m.mes.startsWith('The lethal reply.'));
    await w.host.st.deleteMessage(at);
    const recovered = await w.coordinator.recover();
    assert.equal(recovered.code, 'SNAPSHOT_UNAVAILABLE');
    assert.match(recovered.message, /restore a save point from before the death/);
    assert.equal(w.host.registry.restore().state, 'pending');
    assert.equal(w.q('party.actor', { id: w.friend }), null, 'reads stay behind the barrier');
    assert.equal(w.live.state.npcs[0].lifeState, 'deceased');
    const reason = generationProblem(w.head(), w.host.timeline.host, w.q('savepoint.contract'));
    assert.match(reason, /put that reply back/);
    assert.equal((await w.host.st.generate('normal', { reply: 'Must wait.' })).aborted, true);
    assert.ok((await w.host.turn.blockers()).length);
}));

test('real SB + RB + NSD: generation stays held until the selected native checkpoint is installed', options, async t => seeded(17, async () => {
    const w = await story(t);
    let release;
    w.live.hold = new Promise(resolve => { release = resolve; });
    const at = w.host.ctx.chat.findIndex(m => m.mes.startsWith('The lethal reply.'));
    const selecting = w.host.st.deleteMessage(at);
    try {
        for (let i = 0; i < 100 && w.host.registry.restore().state !== 'pending'; i++) await new Promise(resolve => setTimeout(resolve, 2));
        assert.equal(w.host.registry.restore().state, 'pending');
        assert.equal(w.live.state.npcs[0].lifeState, 'deceased');
        assert.equal((await w.host.st.generate('normal', { reply: 'Must wait.' })).aborted, true);
    } finally { release(); }
    await selecting;
    await agrees(w, false);
}));
