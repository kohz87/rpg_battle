// progress/credit.js: what a paid attempt earns under the shared caps (contract §4 Constants, §5 P03, B3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, note, pendingOf, planSettlement, rowsOf, tallyOf, usesOf } from '../../../src/v2/progress/credit.js';
import { RULES_V2_CONSTANTS } from '../../vendor/story-block/src/v2/packs/rules-v2.js';
import { ACTOR, FRIEND, ref } from './helpers/fixture.js';

const C = RULES_V2_CONSTANTS;
const DAY = C.clockMinutesPerDay;
const SR = n => `sr_${String(n).padStart(8, '0')}`;
const source = n => ({ sid: SR(n), swipeKey: `sw_${String(n).padStart(8, '0')}`, evidence: `ev_${String(n).padStart(8, '0')}` });
const AT = n => `at_${String(n).padStart(8, '0')}`;
const attempt = (over = {}) => ({ actor: ACTOR, skill: ref('s00'), form: ref('s00-base'), kind: 'narrative', source: source(1), capSource: source(1), cost: null, session: null, minute: null, ...over });

/** A progress slice from attempts in order, each credited by a settlement of its own (as a chat would). */
function play(list, clock) {
    const progress = { schema: 2, choices: {}, attempts: {}, credits: {} };
    let n = 0;
    for (const item of list) {
        n += 1;
        progress.attempts[AT(n)] = item;
        for (const credit of planSettlement(C, progress, clock)) {
            const { id, ...rest } = credit;
            progress.credits[id] = rest;
        }
    }
    return progress;
}
const awards = progress => Object.keys(progress.attempts).map(id => progress.credits[id].award);
const reasons = progress => Object.keys(progress.attempts).map(id => progress.credits[id].reason);

test('a use earns one credit, counted on its reply and its story day', () => {
    const progress = play([attempt()], 600);
    assert.deepEqual(progress.credits[AT(1)], { award: 1, reason: null, minute: 600, day: 0, reply: SR(1) });
    assert.equal(usesOf(tallyOf(rowsOf(progress)), ACTOR, ref('s00-base')), 1);
});

test('skill cap: 2 credits a reply (the third in the reply earns 0 "skill-reply"), then a new reply earns again', () => {
    const progress = play([attempt(), attempt(), attempt(), attempt({ source: source(2), capSource: source(2) })], 600);
    assert.deepEqual(awards(progress), [1, 1, 0, 1]);
    assert.deepEqual(reasons(progress), [null, null, 'skill-reply', null]);
});

test('actor cap: 6 credits a reply across skills (the seventh earns 0 "actor-reply")', () => {
    const skills = ['s00', 's01', 's02', 's10'];
    const list = Array.from({ length: 8 }, (_, i) => attempt({ skill: ref(skills[i % 4]), form: ref(`${skills[i % 4]}-base`) }));
    const progress = play(list, 600);
    assert.deepEqual(awards(progress), [1, 1, 1, 1, 1, 1, 0, 0]);
    assert.deepEqual(reasons(progress).slice(6), ['actor-reply', 'actor-reply']);
    // The next reply starts again.
    const next = play([...list, attempt({ source: source(2), capSource: source(2) })], 600);
    assert.equal(awards(next).at(-1), 1);
});

test('skill cap per day: 10 credits a story day for a skill; the next day starts again; the day is the minute\'s, never wall time', () => {
    const list = Array.from({ length: 12 }, (_, i) => attempt({ source: source(10 + i), capSource: source(10 + i), minute: 3 * DAY + 100 }));
    const progress = play(list, null);
    assert.deepEqual(awards(progress), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
    assert.deepEqual(reasons(progress).slice(10), ['skill-day', 'skill-day']);
    const next = play([...list, attempt({ source: source(30), capSource: source(30), minute: 4 * DAY })], null);
    assert.equal(awards(next).at(-1), 1, 'day 4 has room again');
});

test('actor cap per day: 30 credits a story day over every skill (the 31st earns 0 "actor-day")', () => {
    const forms = ['s00', 's01', 's02', 's10', 's11', 's12'];
    const list = [];
    for (let n = 0; n < 33; n += 1) {
        const skill = forms[n % forms.length];
        list.push(attempt({ skill: ref(skill), form: ref(`${skill}-base`), source: source(100 + n), capSource: source(100 + n), minute: 9 * DAY + 5 }));
    }
    const progress = play(list, null);
    assert.equal(awards(progress).reduce((sum, n) => sum + n, 0), 30);
    assert.deepEqual(reasons(progress).slice(30), ['actor-day', 'actor-day', 'actor-day']);
});

test('two characters have their own caps', () => {
    const list = [attempt(), attempt(), attempt(), attempt({ actor: FRIEND }), attempt({ actor: FRIEND }), attempt({ actor: FRIEND })];
    assert.deepEqual(awards(play(list, 600)), [1, 1, 0, 1, 1, 0]);
});

test('the skill caps span forms: a new form of the same skill cannot reset them; the actor caps span skills and classes', () => {
    const a = attempt({ skill: ref('s30'), form: ref('s30-base') });
    const b = attempt({ skill: ref('s30'), form: ref('s30-base-a') });
    const progress = play([a, a, b, b], 600);
    assert.deepEqual(awards(progress), [1, 1, 0, 0], 'the same reply, the same skill, another form');
    assert.deepEqual(reasons(progress).slice(2), ['skill-reply', 'skill-reply']);
    const next = play([a, a, b, b, attempt({ source: source(2), capSource: source(2), skill: ref('s30'), form: ref('s30-base-a') })], 600);
    assert.deepEqual(awards(next).slice(0, 4), [1, 1, 0, 0]);
    assert.equal(awards(next)[4], 1);
    assert.equal(usesOf(tallyOf(rowsOf(next)), ACTOR, ref('s30-base-a')), 1, 'each form counts for itself');
    assert.equal(usesOf(tallyOf(rowsOf(next)), ACTOR, ref('s30-base')), 2);
});

test('mastered: a form at 35 credited uses earns 0 ("mastered"), whichever reply, day or cap; its uses stay 35', () => {
    const list = Array.from({ length: 40 }, (_, i) => attempt({ source: source(200 + i), capSource: source(200 + i), minute: (i % 4) * DAY + 10 }));
    const progress = play(list, null);
    // 10 a day for four days, the caps never the reason: 35 credits and then "mastered".
    assert.equal(usesOf(tallyOf(rowsOf(progress)), ACTOR, ref('s00-base')), 35);
    assert.deepEqual(reasons(progress).slice(35), ['mastered', 'mastered', 'mastered', 'mastered', 'mastered']);
    assert.equal(awards(progress).slice(35).reduce((sum, n) => sum + n, 0), 0);
});

test('"mastered" is checked before the caps: a mastered form earns 0 "mastered" whatever else is full', () => {
    const progress = play(Array.from({ length: 36 }, (_, i) => attempt({ source: source(300 + i), capSource: source(300 + i), minute: (i % 4) * DAY })), null);
    const mastered = decide(C, tallyOf(rowsOf(progress)), attempt({ source: source(999), capSource: source(999) }), 0);
    assert.equal(mastered.reason, 'mastered');
});

test('no clock HOLDS the attempt (not a zero): no row, no credit, still pending; the clock set earns it at its place', () => {
    const list = { [AT(1)]: attempt(), [AT(2)]: attempt({ minute: 600 }) };
    const none = { schema: 2, choices: {}, attempts: list, credits: {} };
    // The attempt that carries its own minute (a training session\'s) settles without a clock; the other waits.
    const plan = planSettlement(C, none, null);
    assert.deepEqual(plan.map(({ id, award, minute }) => [id, award, minute]), [[AT(2), 1, 600]]);
    for (const { id, ...credit } of plan) none.credits[id] = credit;
    assert.deepEqual(pendingOf(none).map(({ id }) => id), [AT(1)], 'the held attempt is still pending: nothing was written for it');
    assert.equal(Object.hasOwn(none.credits, AT(1)), false);
    assert.deepEqual(planSettlement(C, none, null), [], 'and it stays held while there is no clock');
    assert.deepEqual(planSettlement(C, none, 700).map(({ id, award, minute, day }) => [id, award, minute, day]), [[AT(1), 1, 700, 0]]);
    assert.deepEqual(awards(play([attempt()], 600)), [1]);
});

test('settling credits every waiting attempt, one after the other, once', () => {
    const progress = { schema: 2, choices: {}, attempts: { [AT(1)]: attempt(), [AT(2)]: attempt(), [AT(3)]: attempt() }, credits: {} };
    assert.deepEqual(pendingOf(progress).map(({ id }) => id), [AT(1), AT(2), AT(3)]);
    const plan = planSettlement(C, progress, 600);
    assert.deepEqual(plan.map(({ id, award }) => [id, award]), [[AT(1), 1], [AT(2), 1], [AT(3), 0]]);
    for (const { id, ...credit } of plan) progress.credits[id] = credit;
    assert.deepEqual(pendingOf(progress), []);
    assert.deepEqual(planSettlement(C, progress, 600), [], 'a second settlement has nothing to do');
});

test('the order of a settlement is by attempt id: it does not depend on how the records are listed', () => {
    const one = { [AT(1)]: attempt(), [AT(2)]: attempt(), [AT(3)]: attempt() };
    const reversed = Object.fromEntries(Object.entries(one).reverse());
    const run = attempts => planSettlement(C, { attempts, credits: {} }, 600).map(({ id, award }) => [id, award]);
    assert.deepEqual(run(one), run(reversed));
});

test('note counts a credit and not a zero', () => {
    const tally = tallyOf([]);
    note(tally, attempt(), { award: 0, reason: 'skill-day', day: 2, reply: SR(1) });
    assert.equal(usesOf(tally, ACTOR, ref('s00-base')), 0);
    note(tally, attempt(), { award: 1, reason: null, day: 2, reply: SR(1) });
    assert.equal(usesOf(tally, ACTOR, ref('s00-base')), 1);
});
