// Real module.js + rules/death parts in one owner on SB fa1853d. No query is moved to
// another module or replaced for replay; SD's clock and the native participant are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModule } from '../../../src/v2/module.js';
import { part as deathPart } from '../../../src/v2/death/index.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';
import { resolveBatch } from '../../../src/v2/fight/batch.js';
import { seeded } from '../integration/helpers/host.js';
import { world, ok, ref } from './helpers.js';
import { savedWorld } from './return-helper.js';
import { wipe } from './fight-helper.js';
import { assertFullReplay } from './replay-helper.js';

const snapshot = w => structuredClone({ domains: w.head().domains, claims: w.head().meta.claims });
const spans = w => w.host.ctx.chat.flatMap(m => m.extra?.storySuite?.spans ?? []);

async function reloadAndReplay(w) {
    assert.deepEqual(w.problems(), []);
    const before = snapshot(w);
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    assert.deepEqual(snapshot(w), before, 'reload preserves the selected timeline');
    assert.deepEqual(w.problems(), []);
    assertFullReplay(w);
    assert.deepEqual(snapshot(w), before, 'rebuild preserves every domain and claim');
    assert.deepEqual(w.problems(), []);
}

test('real module death guards declare only their own replay queries, each once', async t => {
    const w = await world(t);
    const def = w.host.registry.module('rpg-battle');
    const expected = [...new Set([...createModule().replayQueries, ...deathPart.replayQueries])].sort();
    assert.deepEqual([...def.replayQueries].sort(), expected);
    for (const name of deathPart.replayQueries) {
        assert.equal(w.host.registry.queryOwner(name), 'rpg-battle', name);
        assert.equal(typeof def.queries[name], 'function', name);
    }
    for (const name of ['director.time', 'savepoint.list', 'npc.identity', 'atlas.canonical', 'inventory.wallet']) {
        assert.equal(def.replayQueries.includes(name), false, `${name} must come from state or recorded inputs`);
    }
});

test('real module lethal/intervention/resolve guards survive reload and full replay without Problems', async t => seeded(72, async () => {
    const w = await world(t);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const event = w.lethal(w.friend);
    assert.equal(w.slice('death').batches[event.batch].status, 'pending');
    await reloadAndReplay(w);
    const mp = w.q('party.actor', { id: w.pc }).mp.cur;
    ok(w.command('skill.use', { actor: w.pc, skill: ref('s00'), form: ref('s00-base') }));
    const paid = w.q('story.evidence').find(p => p.kind === 'use').id;
    const proof = w.proof('rescue', { event: event.event, batch: event.batch, actor: w.friend,
        rescuer: w.pc, skill: ref('s00'), form: ref('s00-base'), effect: 1, payment: paid }, [paid]);
    ok(w.command('test.intervene', { event: event.event, evidence: proof }));
    const out = ok(w.command('death.resolve', { event: event.event }));
    const batch = resolveBatch({ id: out.receipt.data.v2.result.batch, state: w.head() });
    assert.equal(batch.bytes.events[0].check, null);
    assert.equal(batch.bytes.events[0].outcome, 'gravely-injured');
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'gravely-injured');
    assert.equal(w.q('party.actor', { id: w.pc }).mp.cur, mp - 4, 'one payment');
    await reloadAndReplay(w);
    assert.deepEqual(resolveBatch({ id: batch.id, state: w.head() }), batch, 'same sealed decisions');
    for (const kind of ['lethal', 'intervention', 'death.resolve']) {
        assert.ok(spans(w).some(s => s.guard?.predicate?.kind === kind), kind);
    }
}));

test('real module death/wipe/return/wake guards survive reload and full replay without Problems', async t => seeded(17, async () => {
    const w = await savedWorld(t);
    await w.say('The rewarded deed.');
    ok(w.command('test.reward'));
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const event = w.lethal(w.friend);
    ok(w.command('death.resolve', { event: event.event }));
    const companionBatch = w.slice('death').batches[event.batch].result;
    ok(await w.coordinator.deliver(companionBatch));
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'dead');
    assert.equal(w.native.live.dossiers.lyra.alive, false);
    await reloadAndReplay(w);
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'dead', 'permanent on the active timeline');
    await w.say('The fatal fight.');
    ok(w.command('party.setActive', { actors: [w.pc] }, 'ui'));
    const batch = (await wipe(w)).receipt.data.deathBatch;
    const sealed = resolveBatch({ id: batch.id, state: w.head() });
    assert.equal(sealed.bytes.events[0].check, null, 'wipe bypasses the lethal die');
    await reloadAndReplay(w);
    const returned = ok(await w.coordinator.deliver(batch));
    assert.equal(returned.status, 'complete');
    const selected = w.q('return.status').lastReturn;
    assert.deepEqual(selected.batchResult, batch, 'the host uses the shared resolver');
    assert.equal(selected.snapshot, w.target.id);
    await reloadAndReplay(w);
    for (const actor of [w.pc, w.friend]) assert.equal(lifeOf(w.q('party.actor', { id: actor })), 'alive');
    assert.equal(w.native.live.dossiers.lyra.alive, true);
    assert.equal(w.q('inventory.wallet', { owner: 'party' }).coin ?? 0, 0);
    assert.equal(w.q('party.actor', { id: w.pc }).xp, 0);
    assert.equal(Object.keys(w.head().meta.claims).some(c => c.includes('c12:reward')), false);
    assert.equal(Object.keys(w.slice('death').wakes).length, 1);
    assert.deepEqual(w.host.timeline.host.pin(batch.id).bytes, sealed.bytes, 'original decisions survive restore');
    const history = ok(await w.host.sdk.timeline.history({}));
    assert.ok(history.messages.some(m => m.text.includes('rewarded deed') && !m.active));
    assert.ok(w.host.ctx.chat.some(m => m.mes.includes('rewarded deed')), 'raw text retained');
    assert.equal(ok(await w.coordinator.deliver(batch)).receipt.narrate, false, 'one wake');
    ok(w.command('test.reward'));
    assert.equal(w.command('test.reward').code, 'CLAIMED');
    assert.equal(w.q('inventory.wallet', { owner: 'party' }).coin, 30);
    assert.equal(w.q('party.actor', { id: w.pc }).xp, 25);
    await reloadAndReplay(w);
    for (const kind of ['death.fight-end', 'return.cue']) {
        assert.ok(spans(w).some(s => s.guard?.predicate?.kind === kind), kind);
    }
}));

test('one reply through the real module: the credit settlement (progress) and death.resolve (death) both run after it', async t => seeded(72, async () => {
    const w = await world(t);
    const hooks = w.host.registry.module('rpg-battle').hooks;
    assert.equal(typeof hooks.afterCapture, 'function', 'one merged hook, registered by module.js');
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    const evidence = w.proof('story', { actor: w.friend, cause: 'narrative', lethal: true });
    const credits = Object.keys(w.slice('progress').credits).length;
    await w.say(`The blow lands as the spell is cast.\n\n<Changes>\n! skill-use ${w.pc} | skill: ${ref('s00')} | form: ${ref('s00-base')}\n! lethal ${w.friend} | cause: narrative | evidence: ${evidence}\n</Changes>`);
    assert.deepEqual(w.problems(), []);
    assert.equal(Object.keys(w.slice('progress').credits).length, credits + 1, 'the training credit was settled (rules.settle)');
    const [batch] = Object.values(w.slice('death').batches);
    assert.equal(batch.status, 'complete', 'and so was the lethal batch (death.resolve)');
    const steps = w.host.ctx.chat.at(-1).extra.storySuite.receipts.filter(r => r.afterCapture === true).map(r => r.type);
    assert.deepEqual(steps, ['rules.settle', 'death.resolve'], 'in part order, both in this reply');
    await reloadAndReplay(w);
    assert.equal(w.slice('death').batches[batch.id].status, 'complete');
}));
