// rules/queries.js: the lookups track C's screens read (rules.identity, rules.classes, rules.names, rules.training).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR, DAY, FRIEND, ref, started, world } from '../progress/helpers/world.js';

test('rules.identity: the pinned rules hash class.choose and path.choose need, with the pack and its version', async t => {
    const w = await started(t);
    const identity = w.q('rules.identity', {});
    assert.deepEqual(Object.keys(identity).sort(), ['hash', 'packId', 'version']);
    assert.equal(identity.hash, w.slice('rules').rulesHash);
    assert.equal(identity.packId, 'fixture');
    assert.equal(identity.version, '2.0.0');
    assert.equal(w.q('rules.identity', { x: 1 }), null, 'malformed arguments');
    const bare = await world(t);
    await bare.say('Dawn.');
    assert.equal(bare.q('rules.identity', {}), null, 'no pin, no identity');
});

test('rules.classes: the pack\'s classes in its order with their three skills, filtered by tier', async t => {
    const w = await started(t);
    const all = w.q('rules.classes', {});
    assert.deepEqual(all.map(item => item.id), [0, 1, 2, 3].map(n => ref(`c${n}`)));
    assert.deepEqual(all[1], { id: ref('c1'), name: 'Class 1', tier: 1, parent: ref('c0'), skills: [ref('s10'), ref('s11'), ref('s12')] });
    assert.equal(all[0].parent, null);
    assert.deepEqual(w.q('rules.classes', { tier: 0 }).map(item => item.id), [ref('c0')]);
    assert.deepEqual(w.q('rules.classes', { tier: 7 }), []);
    assert.deepEqual(w.q('rules.classes', { tier: 'x' }), []);
    assert.deepEqual(w.q('rules.classes', { nope: 1 }), []);
    const bare = await world(t);
    await bare.say('Dawn.');
    assert.deepEqual(bare.q('rules.classes', {}), []);
});

test('rules.names: class, skill and form names for refs; unknown refs and bad arguments leave nothing', async t => {
    const w = await started(t);
    const names = w.q('rules.names', { refs: [ref('c2'), ref('s30'), ref('s30-base-a-g'), ref('nope'), 7, ref('s30')] });
    assert.deepEqual(names, { [ref('c2')]: 'Class 2', [ref('s30')]: 's30', [ref('s30-base-a-g')]: 's30-base-a' });
    assert.deepEqual(w.q('rules.names', { refs: 'x' }), {});
    assert.deepEqual(w.q('rules.names', {}), {});
    assert.deepEqual(w.q('rules.names', { refs: [] }), {});
});

test('rules.training: the caps of today from the clock and the credits, no session and no offers before the training package', async t => {
    const w = await started(t);
    assert.deepEqual(w.q('rules.training', { actor: ACTOR }), { actor: ACTOR, session: null, caps: {
        day: null, actor: { used: 0, max: 30 }, skill: { used: 0, max: 10 },
        skills: { [ref('s00')]: { used: 0, max: 10 }, [ref('s01')]: { used: 0, max: 10 }, [ref('s02')]: { used: 0, max: 10 } },
    }, offers: [] });
    await w.say('Practice.', [`~ time ${3 * DAY + 600}`, ...['s00', 's00', 's01'].map((s, i) => `! attempt ${ACTOR} | skill: ${s} | form: ${s}-base | key: t${i}`)]);
    const caps = w.q('rules.training', { actor: ACTOR }).caps;
    assert.equal(caps.day, 3);
    assert.deepEqual(caps.actor, { used: 3, max: 30 });
    assert.deepEqual(caps.skill, { used: 2, max: 10 });
    assert.deepEqual(caps.skills[ref('s00')], { used: 2, max: 10 });
    await w.say('Next day.', [`~ time ${4 * DAY + 5}`]);
    assert.deepEqual(w.q('rules.training', { actor: ACTOR }).caps.actor, { used: 0, max: 30 }, 'another story day has its own room');
    assert.equal(w.q('rules.training', { actor: FRIEND }), null, 'not in the party');
    assert.equal(w.q('rules.training', { actor: 'x' }), null);
    assert.equal(w.q('rules.training', {}), null);
});
