// rules.flags / rules.flagSet (contract §3; B3 "flag: declared boolean default false; only a validated authorized event"; C18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { realWorld } from '../progress/helpers/world.js';
import { inputsPin } from '../progress/helpers/fixture.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { declaredFlags } from '../../../src/v2/rules/pin.js';

const sys = (w, type, payload) => w.host.bus.command(type, payload, { cause: 'system' });
const flags = (w, keys) => w.q('rules.flags', keys === undefined ? {} : { keys });
const rbClaims = w => Object.keys(w.head().meta.claims).filter(key => key.startsWith('rb:'));
const ready = t => realWorld(t, { given: inputsPin(), sd: true });
const prove = (w, flag, value) => { const out = sys(w, 'sd.prove', { flag, value }); assert.equal(out.ok, true, out.message); return out.receipt.data.evidence; };
const set = (w, over) => sys(w, 'test.flagSet', { write: 'wr_00000001', key: 'bell.rung', value: true, evidence: 'ev_00000000', expectedHash: flags(w).hash, ...over });

test('the flags a ruleset declares are the keys its flag requirements name, sorted; each is false until an event sets it', async t => {
    const w = await ready(t);
    assert.deepEqual(declaredFlags(w.slice('rules').pin.resolved), ['bell.rung', 'gate.open']);
    const read = flags(w);
    assert.deepEqual(read.values, { 'bell.rung': false, 'gate.open': false });
    assert.match(read.hash, /^[0-9a-f]{64}$/);
    assert.equal(read.hash, hashJson(read.values), 'the hash covers the whole declared map');
    assert.deepEqual(declaredFlags({}), []);
});

test('keys narrow the answer (unknown ones are left out) and the hash still covers the whole map; malformed arguments are null', async t => {
    const w = await ready(t);
    const all = flags(w);
    assert.deepEqual(flags(w, ['gate.open']).values, { 'gate.open': false });
    assert.equal(flags(w, ['gate.open']).hash, all.hash);
    assert.deepEqual(flags(w, ['nothing.here']).values, {});
    assert.deepEqual(flags(w, []).values, {});
    for (const bad of [5, 'x', [], { keys: 'bell.rung' }, { keys: [1] }, { keys: [''] }, { keys: ['x'.repeat(81)] }, { keys: ['a'], extra: 1 }, { keys: Array(501).fill('a') }]) {
        assert.equal(w.q('rules.flags', bad), null, JSON.stringify(bad).slice(0, 40));
    }
    const bare = await realWorld(t, { pin: false });
    assert.equal(bare.q('rules.flags', {}), null, 'no ruleset: null');
});

test('an event of Story Director sets a flag: the proof names exactly the flag and the value; the answer is { key, value, hash }', async t => {
    const w = await ready(t);
    const before = flags(w);
    const out = sys(w, 'sd.event', { flag: 'bell.rung', value: true });
    assert.equal(out.ok, true, out.message);
    const result = out.receipt.data;
    assert.equal(result.key, 'bell.rung');
    assert.equal(result.value, true);
    assert.deepEqual(flags(w).values, { 'bell.rung': true, 'gate.open': false });
    assert.equal(result.hash, flags(w).hash);
    assert.notEqual(result.hash, before.hash);
    const stored = w.slice('rules').flags['bell.rung'];
    assert.deepEqual(Object.keys(stored).sort(), ['evidence', 'value', 'write']);
    assert.ok(w.head().meta.claims[`rb:ep_00000000:flag:${stored.evidence}`], 'the evidence is claimed once');
    assert.deepEqual(w.problems(), []);
    // The adapter gave the proof and asked for the flag in one block: a rebuild (the guard asked on the state before the block, which
    // does not hold the block\'s own proof yet) keeps the flag.
    w.host.store.rebuild();
    assert.deepEqual(flags(w).values, { 'bell.rung': true, 'gate.open': false });
    assert.deepEqual(w.problems(), []);
});

test('only a trusted step may set a flag, and only with the evidence that names exactly this change', async t => {
    const w = await ready(t);
    const good = prove(w, 'bell.rung', true);
    // Not the player, not the story, not any other module.
    assert.equal(w.ui('rules.flagSet', { write: 'wr_00000001', key: 'bell.rung', value: true, evidence: good, expectedHash: flags(w).hash }).code, 'REFUSED');
    assert.equal(w.host.bus.command('rules.flagSet', { write: 'wr_00000001', key: 'bell.rung', value: true, evidence: good, expectedHash: flags(w).hash }, { cause: 'story' }).code, 'REFUSED');
    assert.equal((await w.internal('rules.flagSet', { write: 'wr_00000001', key: 'bell.rung', value: true, evidence: good, expectedHash: flags(w).hash })).code, 'REFUSED', 'a module that is not Story Director or this one');
    // The evidence.
    assert.equal(set(w, { evidence: 'ev_zzzzzzzz' }).code, 'NOT_FOUND', 'no such proof');
    assert.equal(set(w, { evidence: good, key: 'gate.open' }).code, 'REFUSED', 'the proof is for another flag');
    assert.equal(set(w, { evidence: good, value: false }).code, 'REFUSED', 'and for another value');
    assert.equal(set(w, { evidence: good, key: 'not.declared' }).code, 'NOT_FOUND', 'an undeclared flag is not set by anything');
    assert.equal(set(w, { evidence: good, expectedHash: hashJson({ 'bell.rung': true, 'gate.open': true }) }).code, 'STALE', 'the flags as the caller read them');
    // Malformed payloads.
    for (const bad of [{ key: '' }, { value: 'yes' }, { write: 'x' }, { evidence: 5 }, { expectedHash: 'x' }, { extra: 1 }]) assert.equal(set(w, { evidence: good, ...bad }).code, 'INVALID', JSON.stringify(bad));
    assert.deepEqual(flags(w).values, { 'bell.rung': false, 'gate.open': false }, 'nothing moved');
    // The rule event (this module) with Story Director\'s evidence works, once.
    assert.equal(set(w, { evidence: good }).ok, true);
    assert.equal(flags(w).values['bell.rung'], true);
    assert.equal(set(w, { evidence: good }).ok, true, 'the same write again is the same answer');
    assert.equal(set(w, { evidence: good, write: 'wr_00000002' }).code, 'REFUSED', 'another write for a change already made');
});

test('the evidence is consumed once: a proof that turned a flag on cannot be used again after the flag is turned off', async t => {
    const w = await ready(t);
    const on = prove(w, 'bell.rung', true);
    const off = prove(w, 'bell.rung', false);
    assert.equal(set(w, { evidence: on }).ok, true);
    assert.equal(set(w, { evidence: off, value: false, write: 'wr_00000002' }).ok, true);
    assert.equal(flags(w).values['bell.rung'], false);
    assert.equal(set(w, { evidence: on, write: 'wr_00000003' }).code, 'CLAIMED');
    assert.equal(flags(w).values['bell.rung'], false);
    assert.equal(set(w, { evidence: off, value: false, write: 'wr_00000004' }).code, 'REFUSED', 'already off');
});

test('a deleted proof deactivates the write: the flag is back, the claim is gone, and putting the reply back brings both back', async t => {
    const w = await ready(t);
    await w.say('The bell is struck.');
    const proofReply = w.host.ctx.chat.length - 1;
    const evidence = prove(w, 'bell.rung', true);
    await w.say('And it rings.');
    assert.equal(set(w, { evidence }).ok, true);
    assert.equal(flags(w).values['bell.rung'], true);
    const claims = rbClaims(w).length;
    // Delete the reply that held the proof (and the player\'s message before it): the later write has lost its reason.
    await w.host.st.deleteMessage(proofReply);
    await w.host.st.deleteMessage(proofReply - 1);
    assert.equal(flags(w).values['bell.rung'], false);
    assert.deepEqual(w.slice('rules').flags, {});
    assert.ok(rbClaims(w).length < claims, 'its claim went with it');
    assert.ok(w.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'));
    const live = JSON.stringify(w.slice('rules'));
    w.host.store.rebuild();
    assert.equal(JSON.stringify(w.slice('rules')), live, 'a rebuild gives the same');
});

test('a flag taken out of the ruleset by nothing: a stored flag that is not declared fails the domain validator', async t => {
    const w = await ready(t);
    const slice = structuredClone(w.slice('rules'));
    slice.flags['made.up'] = { value: true, evidence: 'ev_00000001', write: 'wr_00000001' };
    const { rulesProblems } = await import('../../../src/v2/rules/pin.js');
    assert.match(rulesProblems(slice)[0], /not a declared flag/);
    slice.flags = { 'bell.rung': { value: 'yes', evidence: 'x', write: 'y' } };
    assert.match(rulesProblems(slice)[0], /\{ value, evidence, write \}/);
});

test('a number or a use the story wrote is not evidence: a `use` proof (this module\'s own kind) authorizes no flag', async t => {
    const w = await ready(t);
    await w.say('Clock.', ['~ time 2900']);
    await w.say('She swings.', [`! skill-use ${w.pc} | skill: pack.fixture/s00 | form: pack.fixture/s00-base`]);
    const [use] = w.host.sdk.query('story.evidence', {}).filter(proof => proof.kind === 'use');
    assert.ok(use, 'a use proof exists');
    assert.equal(set(w, { evidence: use.id }).code, 'REFUSED');
    assert.deepEqual(flags(w).values, { 'bell.rung': false, 'gate.open': false });
});
