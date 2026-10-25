// B-a1-16 (a1, story-suite break pass 2): quest rewards in coins (SD ad7d396, MODULES §F108). parseReward
// reads the first "<n> <coin word>" only and prices any coin word it does not know at 1 (quests/parse.js
// coinWorth: "1 otherwise"). In a copper/silver/gold world: "1 gold 5 silver" → 100 (the 5 silver is
// dropped), "1 gold and 5 silver" → 100, "3 gp" → 3 copper, "2 platinum" → 2 copper, "5 crowns" → 5
// copper. Story Block's own money reader (money.js parseAmount) refuses all of these with a Problem
// ("not a coin here", "write it in one coin"), so the same words are money of one size in a coin line and
// another in a quest's reward, and the reader is never told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReward } from '../../../src/v2/quests/parse.js';

const currency = {
    name: 'copper', plural: 'copper',
    coins: [{ name: 'copper', plural: 'copper', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }],
};

for (const [reward, right] of [['1 gold 5 silver', 150], ['1 gold and 5 silver', 150], ['3 gp', null], ['2 platinum', null], ['5 crowns', null]]) {
    test(`reward "${reward}" is read whole or not read as money (never a smaller amount)`, () => {
        assert.equal(parseReward({ reward: '3 silver' }, '', { currency }).amount, 30, 'setup: one known coin converts');
        const amount = parseReward({ reward }, '', { currency }).amount;
        assert.ok(amount === right || amount === null, `"${reward}" read as ${amount} copper`);
    });
}
