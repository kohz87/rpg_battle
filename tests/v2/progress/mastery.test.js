// progress/mastery.js: uses → mastery with the pinned steps; the 5/5 cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { capUses, isMastered, masteredAt, masteryOf, maxMastery, nextAt } from '../../../src/v2/progress/mastery.js';
import { RULES_V2_CONSTANTS, RULES_V2_PROGRESSION } from '../../vendor/story-block/src/v2/packs/rules-v2.js';

const at = RULES_V2_CONSTANTS.masteryAt;

test('uses 0 / 1 / 5 / 12 / 22 / 35 are mastery 0 / 1 / 2 / 3 / 4 / 5 (cumulative steps 1, 5, 12, 22, 35)', () => {
    assert.deepEqual(at, [1, 5, 12, 22, 35]);
    const table = [[0, 0], [1, 1], [4, 1], [5, 2], [11, 2], [12, 3], [21, 3], [22, 4], [34, 4], [35, 5], [36, 5], [9999, 5]];
    for (const [uses, mastery] of table) assert.equal(masteryOf(uses, at), mastery, `${uses} uses`);
});

test('the top is the cap: 5/5 at 35 uses, nothing above, and it agrees with the checker\'s progression', () => {
    assert.equal(maxMastery(at), RULES_V2_PROGRESSION.maxMastery);
    assert.equal(maxMastery(at), 5);
    assert.equal(masteredAt(at), 35);
    assert.equal(isMastered(34, at), false);
    assert.equal(isMastered(35, at), true);
    assert.equal(capUses(60, at), 35);
    assert.equal(capUses(-3, at), 0);
    assert.equal(capUses(12.9, at), 12);
});

test('nextAt: the uses of the next step, null at the top', () => {
    assert.deepEqual([0, 1, 4, 5, 12, 22, 34, 35].map(uses => nextAt(uses, at)), [1, 5, 5, 12, 22, 35, 35, null]);
});

test('odd input reads as no uses', () => {
    assert.equal(masteryOf(NaN, at), 0);
    assert.equal(masteryOf(undefined, at), 0);
    assert.equal(masteryOf(5, undefined), 0);
    assert.equal(maxMastery(undefined), 0);
    assert.equal(nextAt(3, []), null);
});
