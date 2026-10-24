// A pinned ruleset's level and XP numbers win over the reader's settings, in the real party and the creation wizard (contract §5;
// review item 3: 900 XP gave party level 10 while the pin said level 1). A chat with no pin keeps the reader's numbers exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realWorld } from './helpers/world.js';
import { pinWith } from './helpers/fixture.js';

const level = (w, id = w.pc) => w.q('party.actor', { id });

test('900 XP under a pin that charges 1000 a level is level 1 with 900 toward the next; the unpinned chat is level 10', async t => {
    const loose = await realWorld(t, { pin: false });
    assert.equal((await loose.internal('party.grantXp', { amount: 900, claim: 'years' })).ok, true);
    assert.equal(level(loose).level, 10, 'the reader\'s xpBase (100) without a pin');
    const w = await realWorld(t, { given: pinWith({ xpPerLevel: 1000 }) });
    assert.equal((await w.internal('party.grantXp', { amount: 900, claim: 'years' })).ok, true);
    assert.deepEqual([level(w).level, level(w).xp], [1, 900]);
    assert.equal(w.progress().level, 1, 'rules.progress and the party agree');
    assert.equal((await w.internal('party.grantXp', { amount: 200, claim: 'more' })).ok, true);
    assert.deepEqual([level(w).level, level(w).xp], [2, 100]);
    assert.equal(w.progress().level, 2);
    assert.deepEqual(w.problems(), []);
});

// The checker fixes startPoints (10), pointsPerLevel (4), statCap and levelCap; only xpPerLevel is the pack's. The reader's settings
// are what a pin overrides: a reader who set other numbers does not change a pinned chat.
const reader = { 'party.pointsPerLevel': 9, 'party.xpBase': 50, 'party.maxLevel': 5, 'party.statCap': 40 };
const points = { ...reader, 'party.startPoints': 20 };

test('the reader\'s own Character numbers do not touch a pinned chat (points, XP cost, level cap)', async t => {
    const loose = await realWorld(t, { pin: false, reader });
    assert.equal((await loose.internal('party.grantXp', { amount: 1000, claim: 'many' })).ok, true);
    assert.equal(level(loose).level, 5, 'the reader\'s cap of 5 without a pin');
    const w = await realWorld(t, { reader });
    const before = level(w).points;
    assert.equal((await w.internal('party.grantXp', { amount: 1000, claim: 'many' })).ok, true);
    assert.equal(level(w).level, 11, 'the pin\'s 100 a level and its cap of 99, not the reader\'s 50 and 5');
    assert.equal(level(w).points - before, 10 * 4, 'four a level, as pinned, not nine');
    assert.deepEqual(w.problems(), []);
});

test('the creation wizard\'s budget is the pin\'s starting points and stat cap, not the reader\'s', async t => {
    const w = await realWorld(t, { reader: points, character: false });
    const content = w.q('creation.content', {});
    assert.equal(content.rules.startPoints, 10);
    assert.equal(content.rules.statCap, w.head().domains.rules.pin.resolved.constants.statCap);
    const loose = await realWorld(t, { pin: false, reader: points, character: false });
    assert.equal(loose.q('creation.content', {}).rules.startPoints, 20, 'without a pin the reader\'s number');
});
