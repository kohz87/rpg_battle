// What the Progress page says about how mastery grows (RPG Battle 2.3.0): `rules.pace` is the pin's own numbers, and a checklist row of `rules.progress` says how
// many uses of its form are held for the story clock (only while no clock is set; an attempt with a minute of its own is not held).
import test from 'node:test';
import assert from 'node:assert/strict';
import { paceOf, progressView } from '../../../src/v2/progress/offers.js';
import { rulesPace } from '../../../src/v2/progress/queries.js';
import { seeded } from '../integration/helpers/host.js';
import { bluewatch } from '../quests/helpers/bluewatch.js';
import { ACTOR, basic, golden, ref, slice } from './helpers/states.js';

const ix = golden();
const held = (progress, ...forms) => {
    forms.forEach((form, n) => {
        const source = { sid: `sr_${String(900 + n).padStart(8, '0')}`, swipeKey: `sw_${String(900 + n).padStart(8, '0')}`, evidence: `ev_${String(900 + n).padStart(8, '0')}` };
        progress.attempts[`at_${String(900 + n).padStart(8, '0')}`] = { actor: ACTOR, skill: ref(form.slice(0, 3)), form: ref(form), kind: 'narrative', source, capSource: source, cost: null, session: null, minute: null };
    });
    return progress;
};

test('rules.pace is the pin\'s numbers: the top mastery, the uses that reach it, and the credits a skill earns a reply and a day', () => {
    assert.deepEqual(paceOf(ix), { top: 5, usesForTop: 35, perReply: ix.constants.usePerSkillReply, perDay: ix.constants.usePerSkillDay });
    assert.deepEqual(paceOf(ix), { top: 5, usesForTop: 35, perReply: 2, perDay: 10 });
    const other = { ...ix, constants: { ...ix.constants, masteryAt: [1, 4, 9, 15], usePerSkillReply: 3, usePerSkillDay: 6 } };
    assert.deepEqual(paceOf(other), { top: 4, usesForTop: 15, perReply: 3, perDay: 6 });
});

test('the query answers null without a pin and takes no arguments', () => {
    assert.equal(rulesPace({ domains: {} }, {}), null);
    assert.equal(rulesPace({ domains: { rules: { pin: null } } }, {}), null);
    assert.equal(rulesPace({ domains: {} }, { actor: 'x' }), null);
});

test('a checklist row says how many uses of its form are held for the clock, only while there is no clock', () => {
    const progress = held(slice({ choices: [basic(ACTOR, 'c0')] }), 's00-base', 's00-base', 's01-base');
    const rows = clock => progressView(ix, progress, ACTOR, 1, clock).checklist.map(row => row.waiting ?? 0);
    assert.deepEqual(rows(null), [2, 1, 0], 'no clock: two uses of the first skill and one of the second wait');
    assert.deepEqual(rows(7200), [0, 0, 0], 'a clock is set: the next settlement credits them, nothing waits for it');
    assert.deepEqual(rows(undefined), [0, 0, 0], 'a caller that did not ask for the clock is told nothing');
    assert.ok(!progressView(ix, progress, ACTOR, 1, 7200).checklist.some(row => 'waiting' in row), 'the row keeps its old shape when nothing waits');
    // An attempt with a minute of its own is settled whatever the clock says.
    const timed = held(slice({ choices: [basic(ACTOR, 'c0')] }), 's00-base');
    Object.values(timed.attempts)[0].minute = 600;
    assert.deepEqual(progressView(ix, timed, ACTOR, 1, null).checklist.map(row => row.waiting ?? 0), [0, 0, 0]);
    // A credited use is not held, and another character's use is not this one's.
    const credited = held(slice({ choices: [basic(ACTOR, 'c0')] }), 's00-base');
    credited.credits.at_00000900 = { award: 1, reason: null, minute: 600, day: 0, reply: 'sr_00000900' };
    assert.deepEqual(progressView(ix, credited, ACTOR, 1, null).checklist.map(row => row.waiting ?? 0), [0, 0, 0]);
    const other = held(slice({ choices: [basic(ACTOR, 'c0')] }), 's00-base');
    Object.values(other.attempts)[0].actor = 'ac_00000099';
    assert.deepEqual(progressView(ix, other, ACTOR, 1, null).checklist.map(row => row.waiting ?? 0), [0, 0, 0]);
});

test('on the real host rules.pace answers the pack\'s own constants, and the Progress query sees no held use while the clock is set', async t => {
    await seeded(9301, async () => {
        const h = await bluewatch(t);
        const pace = h.q('rules.pace', {});
        assert.deepEqual(Object.keys(pace), ['top', 'usesForTop', 'perReply', 'perDay']);
        assert.ok(Object.values(pace).every(value => Number.isInteger(value) && value > 0), JSON.stringify(pace));
        assert.equal(pace.top, 5);
        assert.equal(h.q('rules.progress', {}).checklist.every(row => !('waiting' in row)), true);
    });
});
