// Every topic and difficulty is still evaluated, now by SD's die and RB's modifier projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withPc } from '../party/helpers/fake-ctx.js';
import { rollCheck } from '../party/helpers/check.js';
import { outcomeOf } from '../../vendor/story-director/src/v2/checks/words.js';
import { TOPIC_NAMES } from '../../../src/v2/rules/modifiers.js';

for (const skill of TOPIC_NAMES) test(`checks flip: ${skill}, all difficulties and seeded dice agree with the rule`, () => {
    const state = withPc();
    const dice = new Set();
    for (let seed = 1; seed <= 40; seed += 1) for (const dc of [5, 10, 15, 20, 25, 30, 40]) {
        const one = rollCheck(state, { skill, dc }, { seed });
        assert.equal(one.ok, true, one.message);
        const result = one.result.data;
        dice.add(result.die);
        assert.equal(result.total, result.die + result.mod);
        assert.equal(result.outcome, outcomeOf(result.die, result.mod, dc));
        assert.deepEqual(one, rollCheck(state, { skill, dc }, { seed }));
    }
    assert.ok(dice.size > 8);
});
