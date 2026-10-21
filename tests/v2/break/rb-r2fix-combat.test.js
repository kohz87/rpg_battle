// RB re-break round 2 fixes (b4-combat): B4r2-3, each tier is a budget of its own and a boss keeps
// its tier's level. (B4r2-1, -2 and -6 have the break tests b4r2-opening-draught, b4r2-stale-loglength
// and b4r2-return-cue.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerRows } from '../../../src/v2/combat/setup.js';
import { DEFAULT_BESTIARY } from '../../../src/enemies.js';

const levelOf = (foes, name) => offerRows({ foes }, { pcLevel: 1, bestiary: DEFAULT_BESTIARY }).find(row => row.name === name);

test('B4r2-3: a boss keeps its tier\'s level whatever foes come with it', () => {
    const alone = levelOf([{ name: 'Ancient Dragon', count: 1, boss: true, tier: 'deadly' }], 'Ancient Dragon');
    const withWolves = levelOf([{ name: 'Ancient Dragon', count: 1, boss: true, tier: 'deadly' }, { name: 'Wolf', count: 3, tier: 'deadly' }], 'Ancient Dragon');
    assert.deepEqual([withWolves.level, withWolves.scale], [alone.level, alone.scale]);
});

test('B4r2-3: a row moves by its own tier\'s headcount, not the whole offer\'s', () => {
    const alone = levelOf([{ name: 'Ogre', count: 1, tier: 'deadly' }], 'Ogre');
    const withRats = levelOf([{ name: 'Ogre', count: 1, tier: 'deadly' }, { name: 'Giant Rat', count: 5, tier: 'trivial' }], 'Ogre');
    assert.deepEqual([withRats.level, withRats.scale], [alone.level, alone.scale]);
    // Two deadly Ogres are still a group of two, beside the rats or not.
    const two = levelOf([{ name: 'Ogre', count: 2, tier: 'deadly' }], 'Ogre');
    const twoWithRats = levelOf([{ name: 'Ogre', count: 2, tier: 'deadly' }, { name: 'Giant Rat', count: 2, tier: 'trivial' }], 'Ogre');
    assert.deepEqual([twoWithRats.level, twoWithRats.scale], [two.level, two.scale]);
});
