// rules.settle, the attempt ledger and the progress validator, on the real host and on built slices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR, DAY, ref, started } from './helpers/world.js';
import { MAX_ATTEMPTS, initialProgress, progressProblems } from '../../../src/v2/progress/domain.js';
import { slice, basic, promo } from './helpers/states.js';

const attempt = (w, over = {}, cause = 'ui') => w.host.bus.command('test.attempt', { actor: ACTOR, skill: ref('s00'), form: ref('s00-base'), kind: 'combat', key: 'k1', ...over }, { cause });
const settle = (w, payload = {}, cause = 'system') => w.host.bus.command('rules.settle', payload, { cause });

test('rules.settle is the host\'s step: not the player\'s, not the story\'s; it credits every waiting attempt once and says which', async t => {
    const w = await started(t);
    await w.say('Clock.', [`~ time ${2 * DAY + 5}`]);
    for (const key of ['a', 'b', 'c']) assert.equal(attempt(w, { key }).ok, true);
    assert.equal(Object.keys(w.slice('progress').credits).length, 0, 'a click records an attempt; nothing credits it until the host settles');
    for (const cause of ['ui', 'story']) assert.equal(settle(w, {}, cause).code, 'REFUSED', cause);
    assert.equal(settle(w, { nope: 1 }).code, 'INVALID');
    assert.equal(settle(w, { boundary: { sid: 'sr_zzzzzzzz', swipeKey: 'sw_zzzzzzzz' } }).code, 'REFUSED', 'a boundary that is not this reply');
    const out = settle(w);
    assert.equal(out.ok, true, out.message);
    const result = out.receipt.data.v2.result;
    assert.deepEqual(Object.keys(result).sort(), ['completed', 'credited', 'expired', 'started']);
    assert.deepEqual([result.started, result.completed, result.expired], [[], [], []]);
    assert.equal(result.credited.length, 2, 'two a reply for one skill; the third earns nothing');
    assert.equal(out.receipt.narrate, false);
    assert.equal(out.receipt.replan?.payload !== undefined || out.receipt.summary.length > 0, true);
    const credits = Object.values(w.slice('progress').credits);
    assert.deepEqual(credits.map(credit => credit.reason).sort(), ['skill-reply', null, null].sort());
    assert.equal(settle(w).code, 'NO_LONGER_DONE', 'nothing is left to settle');
    assert.equal(Object.keys(w.head().meta.claims).filter(key => key.includes(':credit:')).length, 3, 'one claim for each');
    assert.deepEqual(w.problems(), []);
});

test('a boundary naming this very reply is accepted', async t => {
    const w = await started(t);
    await w.say('Clock.', [`~ time ${2 * DAY + 5}`]);
    attempt(w, { key: 'x' });
    const record = w.host.ctx.chat.at(-1).extra.storySuite.source;
    const out = settle(w, { boundary: { sid: record.logical, swipeKey: record.swipeKey, evidence: record.evidence, ordinal: 0 } });
    assert.equal(out.ok, true, out.message);
});

test('an attempt: the same key is the same attempt, other contents are a conflict, odd input is refused', async t => {
    const w = await started(t);
    assert.equal(attempt(w).receipt.data.created, true);
    assert.equal(attempt(w).receipt.data.created, false, 'the same attempt again records nothing');
    assert.equal(Object.keys(w.slice('progress').attempts).length, 1);
    assert.equal(attempt(w, { cost: 'wp_00000009' }).code, 'CONFLICT');
    // A form belongs to one skill: a skill and a form of another one is not an attempt (review fix 6).
    assert.equal(attempt(w, { skill: ref('s01') }).code, 'INVALID');
    assert.equal(attempt(w, { key: 'k5', skill: ref('s01'), form: ref('s00-base') }).code, 'INVALID');
    assert.equal(attempt(w, { key: 'k5', form: ref('s00-base-x') }).code, 'INVALID', 'a form the ruleset does not have');
    assert.equal(attempt(w, { key: 'k5', skill: ref('s01'), form: ref('s01-base') }).ok, true, 'the skill\'s own form is fine');
    assert.equal(attempt(w, { key: 'k2', kind: 'wish' }).code, 'INVALID');
    assert.equal(attempt(w, { key: '' }).code, 'INVALID');
    assert.equal(attempt(w, { key: 'k3', actor: 'nobody' }).code, 'INVALID');
    assert.equal(attempt(w, { key: 'k3', minute: 1.5 }).code, 'INVALID');
    assert.equal(attempt(w, { key: 'k3', cost: 7 }).code, 'INVALID');
    assert.equal(attempt(w, { key: 'k3', capSource: { sid: 'x' } }).code, 'INVALID');
    const mine = Object.values(w.slice('progress').attempts)[0];
    assert.deepEqual(Object.keys(mine.source).sort(), ['evidence', 'sid', 'swipeKey'], 'a Source without its ordinal');
    assert.deepEqual(mine, { actor: ACTOR, skill: ref('s00'), form: ref('s00-base'), kind: 'combat', source: mine.source, capSource: mine.source, cost: null, session: null, minute: null });
    assert.equal(attempt(w, { key: 'k4', kind: 'training', session: 'tr_00000001', cost: 'wp_00000001', minute: 5 * DAY }).ok, true);
    assert.equal(Object.keys(w.slice('progress').attempts).length, 3);
});

test('a training attempt counts on the day it carries, not the clock', async t => {
    const w = await started(t);
    await w.say('Clock.', [`~ time ${9 * DAY}`]);
    assert.equal(attempt(w, { key: 'train', kind: 'training', minute: 5 * DAY + 30 }).ok, true);
    assert.equal(settle(w).ok, true);
    assert.deepEqual(Object.values(w.slice('progress').credits).map(credit => [credit.award, credit.day, credit.minute]), [[1, 5, 5 * DAY + 30]]);
});

test('the ledger is held to its shape', () => {
    assert.deepEqual(progressProblems(initialProgress()), []);
    assert.deepEqual(progressProblems(slice({ choices: [basic(ACTOR, 'c0'), promo(ACTOR, 10, 'c0', 'c1')], uses: { 's00-base': 3 } })), []);
    const bad = mutate => {
        const progress = slice({ choices: [basic(ACTOR, 'c0')], uses: { 's00-base': 2 } });
        mutate(progress);
        return progressProblems(progress);
    };
    assert.notEqual(progressProblems(null).length, 0);
    assert.notEqual(progressProblems({ schema: 1 }).length, 0);
    assert.match(bad(p => { p.choices[`${ACTOR}|0`].skills.pop(); })[0], /exactly three/);
    assert.match(bad(p => { p.choices[`${ACTOR}|0`].skills[1] = p.choices[`${ACTOR}|0`].skills[0]; })[0], /exactly three/);
    assert.match(bad(p => { p.choices['ac_00000001|5'] = p.choices[`${ACTOR}|0`]; })[0], /wrong key/);
    assert.match(bad(p => { p.choices[`${ACTOR}|0`].previous = ref('c0'); })[0], /basic class/);
    assert.match(bad(p => { p.choices[`${ACTOR}|0`].kind = 'wish'; })[0], /neither/);
    assert.match(bad(p => { p.choices[`${ACTOR}|0`].rulesHash = 'x'; })[0], /rules hash/);
    assert.match(bad(p => { p.attempts[Object.keys(p.attempts)[0]].kind = 'x'; })[0], /actor, skill, form and kind/);
    assert.match(bad(p => { p.attempts[Object.keys(p.attempts)[0]].source.ordinal = 1; })[0], /source is/);
    assert.match(bad(p => { p.attempts[Object.keys(p.attempts)[0]].cost = 4; })[0], /cost/);
    assert.match(bad(p => { p.credits[Object.keys(p.credits)[0]].award = 2; })[0], /0 or 1/);
    assert.match(bad(p => { p.credits[Object.keys(p.credits)[0]].reason = 'mastered'; })[0], /says why/);
    assert.match(bad(p => { p.credits.at_zzzzzzzz = p.credits[Object.keys(p.credits)[0]]; })[0], /no attempt/);
    assert.match(bad(p => { p.credits[Object.keys(p.credits)[0]].day = null; })[0], /counts on a minute and a day/);
    assert.ok(MAX_ATTEMPTS >= 1000);
});

test('with no clock the settlement holds (CLOCK_UNSET): no credit, no claim, the attempts wait; the clock set releases them', async t => {
    const w = await started(t);
    assert.equal(attempt(w, { key: 'a' }).ok, true);
    assert.equal(attempt(w, { key: 'b' }).ok, true);
    const held = settle(w);
    assert.equal(held.code, 'CLOCK_UNSET');
    assert.deepEqual(w.slice('progress').credits, {});
    assert.equal(Object.keys(w.head().meta.claims).filter(key => key.includes(':credit:')).length, 0);
    // An attempt that carries its own minute is not held by the clock; the ones that do not still are.
    assert.equal(attempt(w, { key: 'c', kind: 'training', minute: 5 * DAY + 30, session: 'tr_00000001', cost: 'wp_00000001' }).ok, true);
    assert.deepEqual(settle(w).receipt.data.v2.result.credited.length, 1);
    assert.deepEqual(Object.values(w.slice('progress').credits).map(credit => credit.day), [5]);
    assert.equal(settle(w).code, 'CLOCK_UNSET', 'the two without a minute still wait');
    await w.say('Clock.', [`~ time ${6 * DAY + 5}`]);
    assert.equal(Object.keys(w.slice('progress').credits).length, 3, 'the reply that set the clock released them (the host asked for the settlement)');
    assert.deepEqual(w.problems(), []);
});
