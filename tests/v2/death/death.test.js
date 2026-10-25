import test from 'node:test';
import assert from 'node:assert/strict';
import { world, ok, ref } from './helpers.js';
import { resolveBatch, seal } from '../../../src/v2/fight/batch.js';
import { progressProblems, initialProgress } from '../../../src/v2/progress/domain.js';
import { deathProblems, initialDeath } from '../../../src/v2/death/records.js';
import { selectSnapshot } from '../../../src/v2/death/plan.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';
import { assessDeath } from '../../../src/v2/death/plan.js';
import { indexOfState } from '../../../src/v2/rules/graph.js';
import { rescueProof } from '../../../src/v2/death/proofs.js';

test('C11: pending death is sealed once, checks survive rebuild and the shared batch resolver', async t => {
    const w = await world(t);
    const e = w.lethal(w.friend);
    assert.equal(w.slice('death').batches[e.batch].status, 'pending');
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'alive');
    const out = ok(w.command('death.resolve', { event: e.event }));
    const id = out.receipt.data.v2.result.batch;
    const sealed = resolveBatch({ id, state: w.head() });
    assert.equal(sealed.bytes.kind, 'death');
    assert.equal(sealed.bytes.events[0].check.dc, 15);
    assert.ok(sealed.bytes.events[0].check.die >= 1);
    assert.equal(w.slice('death').outbox[e.batch].result.hash, sealed.hash);
    const before = structuredClone(w.head().domains);
    ok(w.command('death.resolve', { event: e.event }));
    assert.deepEqual(w.head().domains, before);
    w.host.store.rebuild();
    assert.deepEqual(resolveBatch({ id, state: w.head() }), sealed);
    assert.deepEqual(w.problems(), []);
});

test('C11: actor order fixes simultaneous checks and there is one sealed batch', async t => {
    const w = await world(t);
    const a = w.lethal(w.friend);
    const b = w.lethal(w.pc);
    assert.equal(a.batch, b.batch);
    const out = ok(w.command('death.resolve', { event: a.event }));
    const bytes = resolveBatch({ id: out.receipt.data.v2.result.batch, state: w.head() }).bytes;
    assert.equal(bytes.events.length, 2);
    assert.deepEqual(bytes.events.map(e => e.actor), [w.friend, w.pc].sort());
    assert.equal(Object.keys(w.slice('death').outbox).length, 1);
});

test('C11: paid intervention binds exact event and living rescuer; no check or second payment', async t => {
    const w = await world(t);
    const e = w.lethal(w.friend);
    const before = w.q('party.actor', { id: w.pc }).mp.cur;
    ok(w.command('skill.use', { actor: w.pc, skill: ref('s00'), form: ref('s00-base') }));
    const paid = w.q('story.evidence').find(p => p.kind === 'use').id;
    assert.equal(w.q('party.actor', { id: w.pc }).mp.cur, before - 4);
    const rescue = w.proof('rescue', { event: e.event, batch: e.batch, actor: w.friend, rescuer: w.pc, skill: ref('s00'), form: ref('s00-base'), effect: 1, payment: paid }, [paid]);
    ok(w.command('test.intervene', { event: e.event, evidence: rescue }));
    const pool = w.q('party.actor', { id: w.pc }).mp;
    const out = ok(w.command('death.resolve', { event: e.event }));
    const bytes = resolveBatch({ id: out.receipt.data.v2.result.batch, state: w.head() }).bytes;
    assert.equal(bytes.events[0].check, null);
    assert.equal(bytes.events[0].outcome, 'gravely-injured');
    assert.equal(w.q('party.actor', { id: w.friend }).hp.cur, 1);
    assert.deepEqual(w.q('party.actor', { id: w.pc }).mp, pool);
    assert.equal(w.command('test.intervene', { event: e.event, evidence: rescue }).ok, false);
    w.host.store.rebuild();
    assert.deepEqual(w.problems(), []);
});

test('a pending lethal event cannot migrate to a different native identity', async t => {
    const w = await world(t);
    const e = w.lethal(w.friend);
    ok(w.command('test.linkNpc', { actor: w.friend, npc: 'np_00000002' }));
    const env = { ix: indexOfState(w.head()), death: w.slice('death'), progress: w.slice('progress'), query: w.q };
    assert.equal(assessDeath('death.resolve', env, { event: e.event }).ok, false);
    assert.equal(Object.keys(w.slice('death').outbox).length, 0);
});

test('a rescue binds the hash of the paid parent as well as its id', async t => {
    const w = await world(t);
    const e = w.lethal(w.friend);
    ok(w.command('skill.use', { actor: w.pc, skill: ref('s00'), form: ref('s00-base') }));
    const paid = w.q('story.evidence').find(p => p.kind === 'use');
    const proof = w.proof('rescue', { event: e.event, batch: e.batch, actor: w.friend, rescuer: w.pc, skill: ref('s00'), form: ref('s00-base'), effect: 1, payment: paid.id }, [paid.id]);
    const env = { ix: indexOfState(w.head()), progress: w.slice('progress'), query: w.q };
    const original = rescueProof(env, w.slice('death').events[e.event], proof);
    assert.equal(original.paymentHash, paid.payloadHash);
    const changed = rescueProof({ ...env, query: (name, args) => name === 'story.evidence' ? w.q(name, args).map(p => p.id === paid.id ? { ...p, payloadHash: 'a'.repeat(64) } : p) : w.q(name, args) }, w.slice('death').events[e.event], proof);
    assert.notDeepEqual(changed, original);
});

test('C11: generic evidence, caller outcomes and unknown linked native identity refuse atomically', async t => {
    const w = await world(t);
    const evidence = w.proof('story', { text: 'A lethal-looking blow.' });
    const before = structuredClone(w.head().domains);
    assert.equal(w.command('test.lethal', { actor: w.pc, cause: 'narrative', evidence: [evidence] }).ok, false);
    assert.deepEqual(w.head().domains, before);
    assert.equal(w.command('death.resolve', { event: 'de_00000001', outcome: 'dead' }).code, 'INVALID');
    ok(w.command('test.linkNpc', { actor: w.friend, npc: 'np_00000001' }));
    const p = w.proof('story', { actor: w.friend, cause: 'execution', lethal: true });
    assert.equal(w.command('test.lethal', { actor: w.friend, cause: 'execution', evidence: [p] }).code, 'NOT_FOUND');
    assert.equal(Object.keys(w.slice('death').events).length, 0);
    assert.equal(w.command('death.resolve', { event: 'de_00000001' }, 'ui').code, 'REFUSED');
});

test('death records are closed; retained death results do not hit the fight pruning limit', async t => {
    assert.deepEqual(deathProblems(initialDeath()), []);
    assert.notDeepEqual(deathProblems({ ...initialDeath(), extra: true }), []);
    const w = await world(t);
    const e = w.lethal(w.friend);
    const out = ok(w.command('death.resolve', { event: e.event }));
    const entry = w.slice('progress').batches[out.receipt.data.v2.result.batch];
    const progress = initialProgress();
    for (let i = 0; i < 100; i++) progress.batches[`br_${i.toString(36).padStart(8, '0')}`] = { ...structuredClone(entry), seq: i + 1 };
    assert.deepEqual(progressProblems(progress), []);
    const invalid = structuredClone(entry.bytes);
    invalid.events[0].outcome = 'caller-picked';
    progress.batches.br_00000000 = { ...seal(invalid), seq: 1 };
    assert.notDeepEqual(progressProblems(progress), []);
});

test('day11 targets day10; latest manual wins, missing bytes never selects an older point', () => {
    const p = (id, kind, day, available = true) => ({ id, kind, day, available, payloadHash: 'a'.repeat(64) });
    const initial = p('sp_00000001', 'initial', 1);
    const day10 = p('sp_00000010', 'day-start', 10, false);
    const manual = p('sp_00000011', 'manual', 10);
    const day11 = p('sp_00000012', 'day-start', 11);
    assert.equal(selectSnapshot([initial, day10, day11], 11 * 1440).id, day10.id);
    assert.equal(selectSnapshot([initial, day10, manual, day11], 11 * 1440).id, manual.id);
    assert.equal(selectSnapshot([], 11 * 1440), null);
});
