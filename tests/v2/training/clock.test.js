// training/clock.js and credits.js: the training clock math (contract fixture C06).
import test from 'node:test';
import assert from 'node:assert/strict';
import { completionCredits, dayOf, dayStart, midnightsBetween, minuteOfDay, readClock, trainingWindow } from '../../../src/v2/training/index.js';
import { rowsOf, tallyOf, planSettlement } from '../../../src/v2/progress/credit.js';
import { RULES_V2_CONSTANTS } from '../../vendor/story-block/src/v2/packs/rules-v2.js';
import { ACTOR, ref } from '../progress/helpers/fixture.js';

const C = RULES_V2_CONSTANTS;
const D = C.clockMinutesPerDay;

test('day = floor(minutes / 1440), the minute of the day is what is left, below zero too', () => {
    assert.equal(dayOf(0, D), 0);
    assert.equal(dayOf(1439, D), 0);
    assert.equal(dayOf(1440, D), 1);
    assert.equal(dayOf(14400, D), 10);
    assert.equal(dayOf(-1, D), -1);
    assert.equal(dayOf(-1440, D), -1);
    assert.equal(dayOf(-1441, D), -2);
    assert.equal(minuteOfDay(7170, D), 1410);
    assert.equal(minuteOfDay(-1, D), 1439);
    assert.equal(dayStart(5, D), 7200);
});

test('C06: day 4 minute 1410 + 60 is day 5 minute 30, crossing one midnight, completed on day 5', () => {
    const start = 4 * D + 1410;
    const window = trainingWindow(start, C);
    assert.deepEqual(window, {
        start: 7170, end: 7230,
        startDay: 4, startMinuteOfDay: 1410, endDay: 5, endMinuteOfDay: 30,
        midnights: [7200], crossesMidnight: true, completionDay: 5,
    });
});

test('a session that stays inside a day, one that ends exactly at midnight, one that starts at it', () => {
    assert.deepEqual(trainingWindow(5 * D + 100, C).midnights, []);
    assert.equal(trainingWindow(5 * D + 100, C).completionDay, 5);
    const exact = trainingWindow(5 * D - 60, C);
    assert.deepEqual(exact.midnights, [5 * D], 'ending at minute 0 of the next day crosses that midnight');
    assert.equal(exact.completionDay, 5);
    assert.equal(exact.endMinuteOfDay, 0);
    const from = trainingWindow(5 * D, C);
    assert.deepEqual(from.midnights, [], 'a start at midnight crosses none');
    assert.equal(from.crossesMidnight, false);
    assert.equal(trainingWindow(5 * D - 61, C).completionDay, 4);
});

test('midnights between two minutes: after the start, up to and including the end', () => {
    assert.deepEqual(midnightsBetween(10, 20, D), []);
    assert.deepEqual(midnightsBetween(1400, 1440, D), [1440]);
    assert.deepEqual(midnightsBetween(1440, 1440, D), []);
    assert.deepEqual(midnightsBetween(0, 3 * D, D), [D, 2 * D, 3 * D]);
    assert.deepEqual(midnightsBetween(-10, 10, D), [0]);
});

test('no clock, no window; a clock is read through director.time and never from a wall clock', () => {
    assert.equal(trainingWindow(null, C), null);
    assert.equal(trainingWindow(undefined, C), null);
    assert.equal(trainingWindow(1.5, C), null);
    assert.equal(readClock(undefined), null);
    assert.equal(readClock(() => ({ minutes: null, text: '' })), null);
    assert.equal(readClock(() => ({ minutes: 7170, text: 'Day 5' })), 7170);
    assert.equal(readClock((name, args) => (name === 'director.time' && !Object.keys(args).length ? { minutes: 42 } : null)), 42);
    assert.equal(readClock(() => { throw new Error('no such query'); }), null);
    assert.equal(readClock(() => 'soon'), null);
    assert.equal(readClock(() => 7), 7);
});

const SR = '00000001';
const capSource = { sid: `sr_${SR}`, swipeKey: `sw_${SR}`, evidence: `ev_${SR}` };
const completion = { actor: ACTOR, skill: ref('s00'), form: ref('s00-base'), capSource };

/** Day 5's credits so far: `n` credits of the actor on day 5, spread over five skills (the reply caps do not bind: one reply each). */
function dayFive(n) {
    const progress = { schema: 2, choices: {}, credits: {}, attempts: {} };
    const others = ['s01', 's02', 's10', 's11', 's12'];
    for (let i = 0; i < n; i += 1) {
        const id = `at_${String(i + 1).padStart(8, '0')}`;
        const mine = others[i % others.length];
        progress.attempts[id] = { actor: ACTOR, skill: ref(mine), form: ref(`${mine}-base`), kind: 'narrative', source: { ...capSource, sid: `sr_${String(500 + i).padStart(8, '0')}` }, capSource: { ...capSource, sid: `sr_${String(500 + i).padStart(8, '0')}` }, cost: null, session: null, minute: 5 * D + 10 };
    }
    for (const { id, ...credit } of planSettlement(C, progress, null)) progress.credits[id] = credit;
    return progress;
}

test('C06: a session ending on day 5 spends day 5\'s room: two completion credits, and the second is held when day 5 has one left', () => {
    const window = trainingWindow(4 * D + 1410, C);
    const plain = completionCredits({ constants: C, tally: tallyOf([]), attempt: completion, window });
    assert.deepEqual(plain.map(({ award, reason, minute, day }) => [award, reason, minute, day]), [[1, null, 7230, 5], [1, null, 7230, 5]]);
    // Thirty credits make a full day. 29 spent: the first completion credit lands, the second finds the cap.
    const before = dayFive(29);
    assert.equal(Object.values(before.credits).filter(credit => credit.award === 1).length, 29);
    const almost = completionCredits({ constants: C, tally: tallyOf(rowsOf(before)), attempt: completion, window });
    assert.deepEqual(almost.map(({ award, reason }) => [award, reason]), [[1, null], [0, 'actor-day']]);
    const full = completionCredits({ constants: C, tally: tallyOf(rowsOf(dayFive(30))), attempt: completion, window });
    assert.deepEqual(full.map(({ award, reason }) => [award, reason]), [[0, 'actor-day'], [0, 'actor-day']]);
});

test('C06: day 4\'s credits do not count against day 5, and a session that stays on day 4 counts against day 4', () => {
    const day4 = dayFive(30);
    for (const credit of Object.values(day4.credits)) credit.day = 4;
    const across = completionCredits({ constants: C, tally: tallyOf(rowsOf(day4)), attempt: completion, window: trainingWindow(4 * D + 1410, C) });
    assert.deepEqual(across.map(({ award }) => award), [1, 1], 'ends on day 5: day 4 being full does not matter');
    const inside = completionCredits({ constants: C, tally: tallyOf(rowsOf(day4)), attempt: completion, window: trainingWindow(4 * D + 100, C) });
    assert.deepEqual(inside.map(({ award, reason }) => [award, reason]), [[0, 'actor-day'], [0, 'actor-day']], 'ends on day 4: day 4 is full');
});

test('the skill\'s own day cap holds a training credit as well, and a mastered form earns none', () => {
    const progress = { schema: 2, choices: {}, credits: {}, attempts: {} };
    for (let i = 0; i < 9; i += 1) {
        const id = `at_${String(i + 1).padStart(8, '0')}`;
        progress.attempts[id] = { actor: ACTOR, skill: ref('s00'), form: ref('s00-base'), kind: 'narrative', source: { ...capSource, sid: `sr_${String(700 + i).padStart(8, '0')}` }, capSource: { ...capSource, sid: `sr_${String(700 + i).padStart(8, '0')}` }, cost: null, session: null, minute: 5 * D };
    }
    for (const { id, ...credit } of planSettlement(C, progress, null)) progress.credits[id] = credit;
    const out = completionCredits({ constants: C, tally: tallyOf(rowsOf(progress)), attempt: completion, window: trainingWindow(4 * D + 1410, C) });
    assert.deepEqual(out.map(({ award, reason }) => [award, reason]), [[1, null], [0, 'skill-day']]);
});

test('completionCredits does not change the tally it is given', () => {
    const tally = tallyOf(rowsOf(dayFive(3)));
    const before = JSON.stringify([...tally.actorDay]);
    completionCredits({ constants: C, tally, attempt: completion, window: trainingWindow(4 * D + 1410, C) });
    assert.equal(JSON.stringify([...tally.actorDay]), before);
});
