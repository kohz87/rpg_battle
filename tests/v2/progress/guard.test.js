// progress/guard.js: the replay hook and the guard builder, over built states (no host).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_KINDS, PREREQUISITE_REMOVED, buildGuard, replayGuard } from '../../../src/v2/progress/guard.js';
import { assess } from '../../../src/v2/progress/assess.js';
import { initialRules, pinOf, pinRules } from '../../../src/v2/rules/pin.js';
import { indexOf } from '../../../src/v2/rules/graph.js';
import { hashJson } from '../../vendor/story-block/src/v2/replay.js';
import { ACTOR, H, basic, ref, slice } from './helpers/states.js';
import { fixturePin } from './helpers/fixture.js';

const rules = initialRules();
assert.equal(pinRules(rules, fixturePin()), '');
const ix = indexOf(pinOf({ domains: { rules } }));
const SOURCE = { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001', ordinal: 3 };
const mastered = Object.fromEntries(['s00-base', 's01-base', 's02-base'].map(form => [form, 35]));
const stateOf = (progress, over = {}) => ({ domains: { rules, progress, ...over } });
const member = (level = 10) => (name, args) => (name === 'party.actor' && args.id === ACTOR ? { id: ACTOR, name: 'Astra', level } : null);
const payload = { actor: ACTOR, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash: H() };

function guardFor(progress, level = 10) {
    const answer = assess('class.choose', { ix, progress, query: member(level) }, payload);
    assert.equal(answer.ok, true, answer.why);
    return buildGuard({ hash: hashJson, owner: 'rpg-battle', source: SOURCE, rulesHash: ix.rulesHash, kind: 'class.choose', payload, inputs: answer.inputs });
}
const ask = (state, guard, level = 10, source = SOURCE) => replayGuard({ state, query: member(level), hash: hashJson }, { guard, source });

const ready = slice({ choices: [basic(ACTOR, 'c0')], uses: mastered });

test('a guard is the contract\'s: owner, version 2, epoch, rules hash, input hash, predicate', () => {
    const guard = guardFor(ready);
    assert.deepEqual(Object.keys(guard).sort(), ['epoch', 'inputHash', 'owner', 'predicate', 'rulesHash', 'version']);
    assert.equal(guard.version, 2);
    assert.match(guard.epoch, /^ep_/);
    assert.match(guard.inputHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(guard.predicate, { kind: 'class.choose', payload });
    assert.deepEqual(GUARD_KINDS, ['class.choose', 'path.choose', 'rules.settle']);
});

test('the hook holds on the state the guard was made on, whatever the level above the milestone, and never reads the ordinal', () => {
    const guard = guardFor(ready);
    assert.deepEqual(ask(stateOf(ready), guard), { ok: true });
    assert.deepEqual(ask(stateOf(ready), guard, 63), { ok: true }, 'a higher level is the same choice');
    assert.deepEqual(ask(stateOf(ready), guard, 10, { ...SOURCE, ordinal: 9 }), { ok: true }, 'a block planned again has a new ordinal');
    assert.notDeepEqual(guardFor(ready).inputHash, buildGuard({ hash: hashJson, owner: 'rpg-battle', source: { ...SOURCE, swipeKey: 'sw_00000002' }, rulesHash: ix.rulesHash, kind: 'class.choose', payload, inputs: assess('class.choose', { ix, progress: ready, query: member(10) }, payload).inputs }).inputHash, 'another swipe is another source');
});

test('the hook turns the block off when a prerequisite is gone, with the contract\'s words first', () => {
    const guard = guardFor(ready);
    const level = ask(stateOf(ready), guard, 9);
    assert.equal(level.ok, false);
    assert.ok(level.reason.startsWith(PREREQUISITE_REMOVED));
    assert.match(level.reason, /Level 10 is needed \(this character is level 9\)/);
    const less = slice({ choices: [basic(ACTOR, 'c0')], uses: { ...mastered, 's02-base': 34 } });
    assert.match(ask(stateOf(less), guard).reason, /s02 is 4\/5/);
    const nobody = replayGuard({ state: stateOf(ready), query: () => null, hash: hashJson }, { guard, source: SOURCE });
    assert.match(nobody.reason, /not in the party/);
    const changedClass = slice({ choices: [basic(ACTOR, 'c0'), { ...basic(ACTOR, 'c0'), milestone: 10, previous: ref('c0'), selected: ref('c1') }], uses: mastered });
    assert.equal(ask(stateOf(changedClass), guard).ok, false, 'the promotion is already taken on that state');
    assert.equal(ask(stateOf(slice()), guard).ok, false, 'no basic class');
});

test('the hook refuses a guard whose inputs, rules or kind are not the ones it would make', () => {
    const guard = guardFor(ready);
    assert.equal(ask(stateOf(ready), { ...guard, inputHash: 'a'.repeat(64) }).ok, false);
    assert.equal(ask(stateOf(ready), { ...guard, rulesHash: 'b'.repeat(64) }).ok, false);
    assert.match(ask(stateOf(ready), { ...guard, rulesHash: 'b'.repeat(64) }).reason, /other rules/);
    assert.equal(ask(stateOf(ready), { ...guard, version: 3 }).ok, false);
    // A different payload under the same hash is not the same operation.
    assert.equal(ask(stateOf(ready), { ...guard, predicate: { kind: 'class.choose', payload: { ...payload, class: ref('c2') } } }).ok, false);
    assert.equal(ask(stateOf(ready), { ...guard, predicate: { kind: 'class.choose', payload: null } }).ok, false);
    assert.equal(ask({ domains: { progress: ready } }, guard).ok, false, 'no ruleset pinned');
    assert.match(ask({ domains: { progress: ready } }, guard).reason, /No rules are pinned/);
    assert.equal(ask({ domains: { rules } }, guard).ok, false, 'no progress slice');
    // Not this file's kinds: no answer (the host fails closed on none, and another part may answer).
    assert.equal(ask(stateOf(ready), { ...guard, predicate: { kind: 'something.else', payload: {} } }), undefined);
    assert.equal(replayGuard({ state: stateOf(ready), query: member(), hash: hashJson }, {}), undefined);
    assert.equal(replayGuard({ state: stateOf(ready), query: member(), hash: hashJson }, null), undefined);
});

test('the settlement guard names the whole plan: another plan on the state before it is another guard', () => {
    const progress = { schema: 2, choices: {}, credits: {}, attempts: { at_00000001: { actor: ACTOR, skill: ref('s00'), form: ref('s00-base'), kind: 'narrative', source: { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001' }, capSource: { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001' }, cost: null, session: null, minute: null } } };
    const withClock = minute => (name) => (name === 'director.time' ? { minutes: minute, text: '' } : null);
    const plan = clock => assess('rules.settle', { ix, progress, query: withClock(clock) }, {});
    const guard = buildGuard({ hash: hashJson, owner: 'rpg-battle', source: SOURCE, rulesHash: ix.rulesHash, kind: 'rules.settle', payload: {}, inputs: plan(600).inputs });
    const hook = clock => replayGuard({ state: stateOf(progress), query: withClock(clock), hash: hashJson }, { guard, source: SOURCE });
    assert.deepEqual(hook(600), { ok: true });
    assert.deepEqual(hook(900), { ok: false, reason: PREREQUISITE_REMOVED }, 'another minute is another credit record');
    assert.equal(hook(null).ok, false, 'the clock gone holds the credit back');
    assert.equal(plan(600).plan[0].award, 1);
    assert.equal(plan(null).plan[0].reason, 'clock');
    const done = { ...progress, credits: { at_00000001: plan(600).plan[0] } };
    assert.equal(assess('rules.settle', { ix, progress: done, query: withClock(600) }, {}).code, 'NO_LONGER_DONE');
    assert.equal(replayGuard({ state: stateOf(done), query: withClock(600), hash: hashJson }, { guard, source: SOURCE }).ok, false, 'nothing left to settle: the block is off');
});
