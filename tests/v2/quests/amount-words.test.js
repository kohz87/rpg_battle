// RB generative offers §3.2: the `amountWords` option of countOf and parseReward reads an amount phrase as its digits; every other
// caller keeps today's behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { amountDigits, countOf, parseReward, parseTarget } from '../../../src/v2/quests/parse.js';

const COPPER = { name: 'copper', plural: 'copper', short: 'c', coins: [{ name: 'copper', plural: 'copper', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }] };
const CROWNS = { name: 'crown', plural: 'crowns' };

test('the amount phrases and their digits', () => {
    const table = [['half a dozen', 6], ['a dozen', 12], ['dozen', 12], ['a score of', 20], ['a hundred', 100], ['a couple of', 2], ['a pair of', 2], ['a few', 3], ['a handful of', 5], ['several', 4]];
    for (const [phrase, value] of table) {
        assert.equal(amountDigits(phrase), String(value), phrase);
        assert.equal(amountDigits(phrase.toUpperCase()), String(value), `${phrase} in capitals`);
        assert.equal(countOf(phrase, { amountWords: true }), value, `countOf ${phrase}`);
    }
    assert.equal(amountDigits('Kill a handful of rats and half a dozen bats'), 'Kill 5 rats and 6 bats');
    assert.equal(amountDigits('seven'), 'seven', 'the number words are the parser\'s own');
    assert.equal(amountDigits('a fewer rats, severally'), 'a fewer rats, severally', 'whole words only');
});

test('countOf and parseReward keep today\'s behaviour without the option', () => {
    for (const phrase of ['a dozen', 'half a dozen', 'a handful of', 'several']) assert.equal(countOf(phrase), null, phrase);
    assert.equal(countOf('seven'), 7);
    assert.equal(countOf('7', { amountWords: true }), 7);
    assert.equal(parseReward({ reward: 'a dozen crowns' }, '', { currency: CROWNS }).amount, null);
    assert.equal(parseReward({ reward: 'a dozen copper' }, '', { currency: COPPER }).amount, null);
});

test('parseReward with amountWords reads the phrase in the label, the goal and the summary', () => {
    const read = (fields, currency, summary = '') => parseReward(fields, summary, { currency, amountWords: true });
    assert.equal(read({ reward: 'a dozen crowns' }, CROWNS).amount, 12);
    assert.equal(read({ reward: 'a dozen copper' }, COPPER).amount, 12);
    assert.equal(read({ reward: 'half a dozen silver' }, COPPER).amount, 60);
    assert.equal(read({ reward: 'a handful of gold' }, COPPER).amount, 500);
    assert.equal(read({ reward: 'a hundred copper each' }, COPPER).each, true);
    assert.equal(read({ goal: 'Kill the rats for a couple of silver' }, COPPER).amount, 20);
    assert.equal(read({}, COPPER, 'pays a score of copper').amount, 20);
    assert.equal(read({ reward: 'none' }, COPPER).amount, 0);
    assert.equal(read({ reward: 'a dozen crowns' }, COPPER).amount, null, 'a foreign coin is still not money here');
    assert.match(read({ reward: 'a dozen crowns' }, COPPER).problem, /crowns/);
});

test('amountWords does not change what parseTarget reads', () => {
    assert.equal(parseTarget({ goal: 'Kill a handful of rats' }), null);
    assert.deepEqual(parseTarget({ goal: 'Kill 5 rats' }), { noun: 'rats', count: 5, kind: 'foes' });
});
