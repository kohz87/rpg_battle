import test from 'node:test';
import assert from 'node:assert/strict';
import { world, ok } from './helpers.js';
import { resultOK, deathProblems } from '../../../src/v2/death/records.js';
import { seal, resolveBatch } from '../../../src/v2/fight/batch.js';
import { storeBatch } from '../../../src/v2/fight/index.js';

test('sealed death records reject contradictory outcomes, duplicate actors and lost outboxes', async t => {
    const w = await world(t);
    const event = w.lethal(w.friend);
    const out = ok(w.command('death.resolve', { event: event.event }));
    const { bytes } = resolveBatch({ id: out.receipt.data.v2.result.batch, state: w.head() });
    assert.equal(resultOK(bytes), true);
    for (const change of [
        b => { b.events.push(structuredClone(b.events[0])); },
        b => { b.events[0].outcome = b.events[0].outcome === 'dead' ? 'gravely-injured' : 'dead'; },
        b => { b.events[0].check.total++; },
        b => { b.returnRequested = true; },
        b => { b.events[0] = null; },
    ]) {
        const bad = structuredClone(bytes);
        change(bad);
        assert.equal(resultOK(bad), false);
    }
    const domain = structuredClone(w.slice('death'));
    delete domain.outbox[event.batch];
    assert.notDeepEqual(deathProblems(domain), []);
});

test('the fight writer prunes fights while retaining resolvable immutable death results', async t => {
    const w = await world(t);
    const event = w.lethal(w.friend);
    const out = ok(w.command('death.resolve', { event: event.event }));
    const id = out.receipt.data.v2.result.batch;
    const state = structuredClone(w.head());
    const before = resolveBatch({ id, state });
    const ctx = { draft: name => state.domains[name], fail(code, message) { throw Object.assign(new Error(message), { code }); } };
    for (let i = 0; i < 20; i++) storeBatch(ctx, `br_${i.toString(36).padStart(8, '0')}`, seal({ v: 1, kind: 'fight', ordinal: i }));
    assert.equal(Object.values(state.domains.progress.batches).filter(e => e.bytes.kind === 'fight').length, 8);
    assert.deepEqual(resolveBatch({ id, state }), before);
    assert.throws(() => storeBatch(ctx, id, seal({ changed: true })), { code: 'CONFLICT' });
    assert.deepEqual(resolveBatch({ id, state }), before);
});
