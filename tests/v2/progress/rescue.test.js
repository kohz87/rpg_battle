// B3 rescue proofs on the real module: the lethal event, the sealed result, the rescued actor, a living active rescuer, the skill and form
// and a frozen effect, the cost (paid now or one surviving paid use) and one consumption. Taking back any parent takes the rescue back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SD, realWorld } from './helpers/world.js';
import { fightPin, ref } from './helpers/fixture.js';

const EVENT = 'de_00000001';
const BATCH = 'br_00000009';
const sd = { ...SD, commands: { ...SD.commands, 'sd.rescue': (ctx, payload) => ctx.call('rescue.use', payload) } };
const ok = out => assert.equal(out.ok, true, JSON.stringify(out));

async function scene(t) {
    const w = await realWorld(t, { given: fightPin(), companions: ['Lyra', 'Bram', 'Cass'], sd });
    const [mate] = w.mates;
    await w.say('Night falls.', ['~ time 900']);
    ok(w.ui('test.death', { id: BATCH, events: [{ id: EVENT, actor: mate }] }));
    const deathIndex = w.host.ctx.chat.length - 1;
    await w.say('The wolf lunges at Lyra.', ['~ time 1000']);
    const hash = w.slice('progress').batches[BATCH].hash;
    const request = (over = {}) => ({ event: EVENT, batch: { id: BATCH, hash }, actor: mate, rescuer: w.pc, skill: ref('s00'), form: ref('s00-base'), effect: 1, ...over });
    const rescue = (over = {}) => w.host.bus.command('sd.rescue', request(over), { cause: 'system' });
    return { w, mate, hash, request, rescue, deathIndex };
}
const claims = w => Object.keys(w.head().meta.claims).filter(key => key.includes(':rescue:'));

test('a rescue pays its cost, publishes one proof that binds the event, the result, the actors, the form and its effect, and consumes the event once', async t => {
    const { w, mate, hash, rescue } = await scene(t);
    const mp = w.q('party.actor', { id: w.pc }).mp.cur;
    ok(rescue());
    const proof = w.q('story.evidence', {}).find(p => p.kind === 'rescue');
    assert.equal(proof.owner, 'rpg-battle');
    const use = w.q('story.evidence', {}).find(p => p.kind === 'use');
    assert.deepEqual(proof.parents, [use.id], 'the paid use is the proof\'s only parent');
    assert.deepEqual(proof.payload, { event: EVENT, batch: { id: BATCH, hash }, actor: mate, rescuer: w.pc, skill: ref('s00'), form: ref('s00-base'), effect: 1, use: use.id });
    assert.equal(w.q('party.actor', { id: w.pc }).mp.cur, mp - 4, 'paid once, in the same root');
    assert.deepEqual(claims(w), [`rb:ep_00000000:rescue:${EVENT}:${mate}`]);
    assert.deepEqual(w.problems(), []);
});

test('reused event, wrong event, wrong batch, wrong actor, a dead or reserve rescuer or a button refuse atomically', async t => {
    const { w, mate, rescue, request } = await scene(t);
    const refused = (over, code, call = () => rescue(over), why = null) => {
        const before = structuredClone(w.head());
        const out = call();
        assert.equal(out.code, code, `${JSON.stringify(over)} ${JSON.stringify(out)}`);
        if (why) assert.match(out.message, why);
        assert.deepEqual(w.head(), before, 'no proof, no payment, no claim, no attempt');
    };
    refused({ event: 'de_00000002' }, 'NOT_FOUND');
    refused({ batch: { id: BATCH, hash: 'f'.repeat(64) } }, 'NOT_FOUND');
    refused({ batch: { id: 'br_00000008', hash: request().batch.hash } }, 'NOT_FOUND');
    refused({ actor: w.pc }, 'REFUSED');
    refused({ rescuer: mate }, 'REFUSED');
    refused({ rescuer: w.mates[2] }, 'REFUSED', undefined, /not an active member/);
    refused({ effect: 0 }, 'REFUSED');
    refused({ effect: 5 }, 'INVALID');
    refused({ skill: ref('s01'), form: ref('s00-base') }, 'REFUSED');
    refused({}, 'REFUSED', () => w.ui('rescue.use', request()));
    refused({}, 'REFUSED', () => w.host.bus.command('rbtest.call', { type: 'rescue.use', payload: request() }, { cause: 'ui' }));
    ok(rescue());
    refused({}, 'CLAIMED');
    // A dead rescuer: Lyra is struck down in a later event and cannot answer for the party.
    ok(w.ui('test.condition', { actor: mate, kind: 'dead', rounds: 1, at: 1000 }));
    ok(w.ui('test.death', { id: 'br_0000000a', events: [{ id: 'de_00000003', actor: w.pc }] }));
    const hash = w.slice('progress').batches.br_0000000a.hash;
    refused({ event: 'de_00000003', batch: { id: 'br_0000000a', hash }, actor: w.pc, rescuer: mate }, 'REFUSED', undefined, /not alive/);
});

// A paid use some other step of the module gave proof of (a fight's, a training's): the rescue cites it as its cost.
const paidUse = (w, over = {}) => {
    const out = w.ui('test.useProof', { actor: w.pc, skill: ref('s00'), form: ref('s00-base'), use: 'us_00000001', ...over });
    ok(out);
    return out.receipt.data.proof;
};

test('a paid use is cited once: nothing is paid again, another skill\'s use is no cost, and one paid use pays one thing', async t => {
    const { w, mate, rescue } = await scene(t);
    const use = paidUse(w);
    const other = paidUse(w, { skill: ref('s01'), form: ref('s01-base'), use: 'us_00000002' });
    const mp = w.q('party.actor', { id: w.pc }).mp.cur;
    const before = structuredClone(w.head());
    assert.equal(rescue({ paid: 'pf_00000000' }).code, 'NOT_FOUND');
    assert.equal(rescue({ paid: other }).code, 'NOT_FOUND', 'a use of another skill is not this rescue\'s cost');
    assert.deepEqual(w.head(), before);
    ok(rescue({ paid: use }));
    assert.equal(w.q('party.actor', { id: w.pc }).mp.cur, mp, 'nothing is paid again');
    const proof = w.q('story.evidence', {}).find(p => p.kind === 'rescue');
    assert.deepEqual(proof.parents, [use]);
    ok(w.ui('test.death', { id: 'br_0000000a', events: [{ id: 'de_00000003', actor: mate }] }));
    const hash = w.slice('progress').batches.br_0000000a.hash;
    const second = structuredClone(w.head());
    assert.equal(rescue({ event: 'de_00000003', batch: { id: 'br_0000000a', hash }, paid: use }).code, 'CLAIMED', 'one paid use pays one thing');
    assert.deepEqual(w.head(), second);
    assert.deepEqual(w.problems(), []);
});

test('taking back the paid use or the sealed result retracts the rescue and its claims; a reload and a rebuild keep it', async t => {
    const { w, rescue } = await scene(t);
    await w.say('Astra steadies herself.', ['~ time 1005']);
    const use = paidUse(w);
    const useIndex = w.host.ctx.chat.length - 1;
    await w.say('Lyra is saved.', ['~ time 1010']);
    ok(rescue({ paid: use }));
    assert.equal(claims(w).length, 1);
    const snap = () => JSON.stringify({ claims: Object.keys(w.head().meta.claims), proofs: w.q('story.evidence', {}).map(p => [p.id, p.payloadHash]), attempts: w.slice('progress').attempts });
    const before = snap();
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    assert.equal(snap(), before, 'after the reload');
    w.host.store.rebuild();
    assert.equal(snap(), before, 'after the rebuild');
    assert.deepEqual(w.problems(), []);
    await w.host.st.deleteMessage(useIndex);
    w.host.store.rebuild();
    assert.deepEqual(w.q('story.evidence', {}).filter(p => ['use', 'rescue'].includes(p.kind)), [], 'the rescue proof is hidden with its parent');
    assert.deepEqual(claims(w), [], 'and its claim goes with the block');
    assert.equal(Object.keys(w.head().meta.claims).some(key => key.includes(':paid:')), false);
    assert.deepEqual(w.slice('progress').attempts, {}, 'no attempt survives either');
});

test('taking back the reply that sealed the lethal result retracts the rescue, its payment and its claims', async t => {
    const { w, rescue, deathIndex } = await scene(t);
    ok(rescue());
    assert.equal(claims(w).length, 1);
    await w.host.st.deleteMessage(deathIndex);
    w.host.store.rebuild();
    assert.deepEqual(w.q('story.evidence', {}).filter(p => ['use', 'rescue'].includes(p.kind)), []);
    assert.deepEqual(claims(w), []);
    assert.deepEqual(w.slice('progress').attempts, {});
    assert.equal(w.q('party.actor', { id: w.pc }).mp.cur, w.q('party.actor', { id: w.pc }).mp.max, 'the payment went with it');
});
