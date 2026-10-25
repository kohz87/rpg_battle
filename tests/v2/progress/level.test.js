// progress/level.js: level and XP from the pinned constants, and the retained adapter to the party's rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelFromEarned, partyRules, pointsAt, xpToNext, xpToReach } from '../../../src/v2/progress/level.js';
import { DEFAULT_RULES, makeRules, xpToNext as partyXpToNext } from '../../../src/rules.js';
import { maxLevel } from '../../../src/terms.js';
import { applyResult } from '../../../src/sheet.js';
import { RULES_V2_CONSTANTS } from '../../vendor/story-block/src/v2/packs/rules-v2.js';

const C = RULES_V2_CONSTANTS;
const WITH = xpPerLevel => ({ ...C, xpPerLevel });

test('every level costs xpPerLevel; level 1 to 99; XP stops at the cap', () => {
    assert.equal(xpToNext(1, C), 100);
    assert.equal(xpToNext(98, C), 100);
    assert.equal(xpToNext(99, C), null);
    assert.equal(xpToReach(1, C), 0);
    assert.equal(xpToReach(10, C), 900);
    assert.equal(xpToReach(99, C), 9800);
    assert.deepEqual(levelFromEarned(0, C), { level: 1, xp: 0, xpToNext: 100, capped: false });
    assert.deepEqual(levelFromEarned(99, C), { level: 1, xp: 99, xpToNext: 100, capped: false });
    assert.deepEqual(levelFromEarned(100, C), { level: 2, xp: 0, xpToNext: 100, capped: false });
    assert.deepEqual(levelFromEarned(950, C), { level: 10, xp: 50, xpToNext: 100, capped: false });
    assert.deepEqual(levelFromEarned(9800, C), { level: 99, xp: 0, xpToNext: null, capped: true });
    assert.deepEqual(levelFromEarned(10 ** 9, C), { level: 99, xp: 0, xpToNext: null, capped: true });
    assert.deepEqual(levelFromEarned(-5, C), { level: 1, xp: 0, xpToNext: 100, capped: false });
});

test('the pack\'s xpPerLevel moves the whole curve (1010 and 10)', () => {
    assert.deepEqual(levelFromEarned(1010 * 9 + 5, WITH(1010)), { level: 10, xp: 5, xpToNext: 1010, capped: false });
    assert.equal(xpToReach(99, WITH(1010)), 98 * 1010);
    assert.deepEqual(levelFromEarned(25, WITH(10)), { level: 3, xp: 5, xpToNext: 10, capped: false });
});

test('points: 10 at the start, 4 a level, to the cap', () => {
    assert.equal(pointsAt(1, C), 10);
    assert.equal(pointsAt(10, C), 10 + 36);
    assert.equal(pointsAt(99, C), 10 + 98 * 4);
    assert.equal(pointsAt(150, C), pointsAt(99, C));
    assert.equal(pointsAt(0, C), 10);
});

test('the retained adapter: the party\'s xpToNext costs exactly xpPerLevel at every level, whatever the pack chose', () => {
    for (const xp of [10, 20, 100, 1010, 5000, 10000]) {
        const rules = makeRules(partyRules(WITH(xp)));
        assert.equal(rules.character.xpBase, xp);
        assert.equal(rules.character.xpExponent, 0);
        assert.equal(maxLevel(rules), 99);
        for (const level of [1, 2, 10, 50, 98]) assert.equal(partyXpToNext(level, rules), xp, `xpPerLevel ${xp} at level ${level}`);
    }
});

test('the approved defaults are the party\'s defaults already, so a default pack changes nothing there', () => {
    const rules = makeRules(partyRules(C));
    assert.deepEqual(rules.character, DEFAULT_RULES.character);
    assert.equal(partyXpToNext(7, rules), partyXpToNext(7, DEFAULT_RULES));
});

test('the same level the party\'s sheet reaches from the same XP (applyResult), with the pack\'s curve', () => {
    for (const xp of [100, 1010, 30]) {
        const rules = makeRules(partyRules(WITH(xp)));
        for (const earned of [0, 1, xp - 1, xp, xp * 3 + 7, xp * 98, xp * 200]) {
            const sheet = { level: 1, xp: 0, points: 0, hp: { cur: 10, max: 10 }, mp: { cur: 0, max: 0 }, sp: { cur: 0, max: 0 }, stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [], uses: {}, conditions: [] };
            const out = applyResult(sheet, 'm', { xp: { m: earned } }, rules).sheet;
            const mine = levelFromEarned(earned, WITH(xp));
            assert.equal(mine.level, out.level, `xpPerLevel ${xp}, ${earned} XP`);
            assert.equal(mine.xp, out.xp);
            assert.equal(sheet.points + pointsAt(mine.level, C) - C.startPoints, out.points);
        }
    }
});
