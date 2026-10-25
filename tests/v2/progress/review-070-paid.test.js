import test from 'node:test';
import assert from 'node:assert/strict';
import { SD, realWorld } from './helpers/world.js';
import { fightPin, ref } from './helpers/fixture.js';
const sd = { ...SD, commands: { ...SD.commands, 'sd.rescue': (ctx, p) => ctx.call('rescue.use', p) } };
const ok = out => assert.equal(out.ok, true, JSON.stringify(out));
test('a genuine paid skill use funds one rescue and keeps exactly one mastery attempt; parent deletion retracts the rescue', async t => {
    const w = await realWorld(t, { given: fightPin(), companions: ['Lyra'], sd });
    await w.say('Night.', ['~ time 900']);
    ok(w.ui('test.death', { id: 'br_00000009', events: [{ id: 'de_00000001', actor: w.mates[0] }, { id: 'de_00000002', actor: w.pc }] }));
    await w.say('A paid healing action.', ['~ time 1000']);
    const mp = w.q('party.actor', { id: w.pc }).mp.cur;
    ok(w.host.bus.command('skill.use', { actor: w.pc, skill: ref('s00'), form: ref('s00-base') }, { cause: 'system' }));
    assert.equal(w.q('party.actor', { id: w.pc }).mp.cur, mp - 4);
    const index = w.host.ctx.chat.length - 1;
    const paid = w.q('story.evidence').find(p => p.kind === 'use').id;
    const attempts = structuredClone(w.slice('progress').attempts);
    await w.say('The blow is turned.', ['~ time 1005']);
    const remaining = w.q('party.actor', { id: w.pc }).mp.cur;
    const payload = { event: 'de_00000001', batch: { id: 'br_00000009', hash: w.slice('progress').batches.br_00000009.hash }, actor: w.mates[0], rescuer: w.pc,
        skill: ref('s00'), form: ref('s00-base'), effect: 1, paid };
    ok(w.host.bus.command('sd.rescue', payload, { cause: 'system' }));
    const check = () => {
        assert.deepEqual(w.slice('progress').attempts, attempts);
        assert.equal(w.q('party.actor', { id: w.pc }).mp.cur, remaining);
        assert.equal(w.q('story.evidence').filter(p => p.kind === 'rescue').length, 1);
        assert.equal(Object.keys(w.head().meta.claims).filter(k => k.includes(':rescue-use:')).length, 1);
        assert.deepEqual(w.problems(), []);
    };
    check(); await w.host.st.loadChat(structuredClone(w.host.ctx.chat)); check(); w.host.store.rebuild(); check();
    ok(w.ui('test.death', { id: 'br_0000000a', events: [{ id: 'de_00000003', actor: w.mates[0] }] }));
    const before = structuredClone(w.head());
    assert.equal(w.host.bus.command('sd.rescue', { ...payload, event: 'de_00000003', batch: { id: 'br_0000000a', hash: w.slice('progress').batches.br_0000000a.hash } }, { cause: 'system' }).code, 'CLAIMED');
    assert.deepEqual(w.head(), before);
    await w.host.st.deleteMessage(index);
    const removed = () => {
        assert.equal(w.q('story.evidence').filter(p => p.kind === 'rescue').length, 0);
        assert.equal(Object.keys(w.head().meta.claims).filter(k => k.includes(':rescue')).length, 0);
        assert.deepEqual(w.slice('progress').attempts, {});
    };
    removed(); await w.host.st.loadChat(structuredClone(w.host.ctx.chat)); removed(); w.host.store.rebuild(); removed();
});
