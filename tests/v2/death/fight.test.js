import test from 'node:test';
import assert from 'node:assert/strict';
import { world, ok } from './helpers.js';
import { seeded } from '../integration/helpers/host.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';
import { resolveBatch } from '../../../src/v2/fight/batch.js';

import { wipe } from './fight-helper.js';

test('C11: a normal-stakes wipe has one death batch, no lethal die and one return request', async t => seeded(91, async () => {
    const w = await world(t);
    const out = await wipe(w);
    const batch = out.receipt.data.deathBatch;
    assert.ok(batch);
    const bytes = resolveBatch({ id: batch.id, state: w.head() }).bytes;
    assert.equal(bytes.events.length, 1);
    assert.equal(bytes.events[0].cause, 'wipe');
    assert.equal(bytes.events[0].check, null);
    assert.equal(bytes.events[0].outcome, 'dead');
    assert.equal(bytes.returnRequested, true);
    assert.equal(bytes.snapshot, null);
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'dead');
    assert.equal(Object.keys(w.slice('death').outbox).length, 1);
    const saved = structuredClone(w.head().domains);
    w.host.store.rebuild();
    assert.deepEqual(w.head().domains, saved);
    assert.deepEqual(w.problems(), []);
}));

test('C11: code-confirmed companion death is permanent; rest/heal and active selection cannot revive it', async t => seeded(17, async () => {
    const w = await world(t);
    // Seed fixes the original die; the command accepts neither die nor outcome.
    const event = w.lethal(w.friend);
    const out = ok(w.command('death.resolve', { event: event.event }));
    const bytes = resolveBatch({ id: out.receipt.data.v2.result.batch, state: w.head() }).bytes;
    assert.equal(bytes.events[0].outcome, 'dead');
    assert.equal(w.command('party.heal', { actor: w.friend, hp: 100 }).code, 'REFUSED');
    assert.equal(w.command('party.setActive', { actors: [w.pc, w.friend] }, 'ui').code, 'REFUSED');
    assert.equal(w.q('rules.party').active.some(m => m.id === w.friend), false);
    await w.say('<Changes>\n~ time 0\n</Changes>');
    ok(w.command('party.rest', { kind: 'long' }, 'story'));
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'dead');
    w.host.store.rebuild();
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'dead');
}));

test('reserves and temporary units cannot prevent a wipe; selected active roster is the fight roster', async t => seeded(92, async () => {
    const w = await world(t);
    ok(w.command('party.setActive', { actors: [w.pc] }, 'ui'));
    ok(w.command('test.unit', { id: 'ac_00000099' }));
    const out = await wipe(w);
    assert.ok(out.receipt.data.deathBatch);
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'alive');
    assert.equal(resolveBatch({ id: out.receipt.data.batch.id, state: w.head() }).bytes.party.length, 1);
}));

test('unpinned old fight and permanent companion behavior are unchanged', async t => seeded(91, async () => {
    const w = await world(t, { pin: false });
    for (const actor of [w.pc, w.friend]) ok(w.command('test.pool', { actor, pool: 'hp', cur: 1 }));
    await w.say('<Changes>\n! encounter 3 Ogre — closing in | tier: deadly | stakes: death\n</Changes>');
    ok(w.command('combat.start', { offer: w.q('combat.offers')[0].id }, 'ui'));
    for (let i = 0; i < 200 && w.q('combat.session').status === 'active'; i++) {
        const v = w.q('combat.session');
        ok(w.command('combat.act', { session: v.id, board: v.board, action: { type: 'defend' } }, 'ui'));
    }
    const out = ok(w.command('combat.end', { session: w.q('combat.session').id }, 'ui'));
    assert.equal(out.receipt.data.deathBatch, undefined);
    assert.equal(out.receipt.data.batch, undefined);
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'dead');
    assert.equal(w.q('party.actor', { id: w.friend }), null);
    assert.deepEqual(w.slice('death'), { schema: 2, events: {}, batches: {}, outbox: {}, wakes: {} });
}));
