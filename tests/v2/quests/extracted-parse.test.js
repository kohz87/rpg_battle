// Quests part: target and reward parsing, whole-word name matching, per-unit pay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countOf, money, nameMatches, nounFor, parseReward, parseTarget, payFor, settleReward, singular } from '../../../src/v2/quests/parse.js';

test('targets from the target label or the goal text', () => {
    const table = [
        [{ goal: 'Clear at least 3 wolves from East Bluff' }, { noun: 'wolves', count: 3, kind: 'foes' }],
        [{ goal: 'Kill three wolves for 1 silver each' }, { noun: 'wolves', count: 3, kind: 'foes' }],
        [{ goal: 'Head north and slay twenty Cellar Rats.' }, { noun: 'Cellar Rats', count: 20, kind: 'foes' }],
        [{ goal: 'Bring back twelve moonleaf to Fenna' }, { noun: 'moonleaf', count: 12, kind: 'items' }],
        [{ goal: 'Collect 5 wolf tails' }, { noun: 'wolf tails', count: 5, kind: 'items' }],
        [{ target: 'at least 3 wolves' }, { noun: 'wolves', count: 3, kind: null }],
        [{ target: '3 wolves', goal: 'bring 9 pelts' }, { noun: 'wolves', count: 3, kind: null }],
        [{ target: 'deliver 2 Potions of Healing' }, { noun: 'Potions of Healing', count: 2, kind: 'items' }],
        [{ target: 'defeat 1 bandit captain' }, { noun: 'bandit captain', count: 1, kind: 'foes' }],
        [{ desc: 'The miller wants you to hunt down 4 boars.' }, { noun: 'boars', count: 4, kind: 'foes' }],
    ];
    for (const [fields, want] of table) assert.deepEqual(parseTarget(fields), want, JSON.stringify(fields));
    assert.deepEqual(parseTarget({}, 'Kill 2 trolls under the bridge'), { noun: 'trolls', count: 2, kind: 'foes' });
});

test('non-targets give none', () => {
    for (const fields of [
        { goal: 'Find out who poisoned the well' }, { goal: 'Escort the merchant to Bluewatch' }, { goal: 'Deal with the wolves' },
        { goal: '3 wolves' }, { goal: 'kill 3 wolves and 2 bears' }, { goal: 'kill 0 wolves' }, { goal: 'kill twenty-one wolves' },
        { target: 'something vague' }, { target: 'the wolves, all of them', goal: 'kill 3 wolves' }, {},
    ]) assert.equal(parseTarget(fields), null, JSON.stringify(fields));
});

test('rewards: one currency, so only the number counts; fixed, per unit, not money, none', () => {
    const table = [
        ['8 silver', { amount: 8, each: false, per: '' }],
        ['1 silver each wolf', { amount: 1, each: true, per: 'wolf' }],
        ['2 copper per tail', { amount: 2, each: true, per: 'tail' }],
        ['1 silver each', { amount: 1, each: true, per: '' }],
        ['3 crowns apiece', { amount: 3, each: true, per: '' }],
        ['five gold coins', { amount: 5, each: false, per: '' }],
        ['12 sp', { amount: 12, each: false, per: '' }],
        ['10 silver and a horse', { amount: 10, each: false, per: '' }],
        ['30', { amount: 30, each: false, per: '' }],
        ['2 each', { amount: 2, each: true, per: '' }],
        ['1 per wolf', { amount: 1, each: true, per: 'wolf' }],
        ['3 wolf pelts', { amount: null, each: false, per: '' }],
        ['a favour from the guild', { amount: null, each: false, per: '' }],
        ['none', { amount: 0, each: false, per: '' }],
    ];
    for (const [reward, want] of table) {
        const got = parseReward({ reward });
        assert.deepEqual({ amount: got.amount, each: got.each, per: got.per }, want, reward);
        assert.equal(got.unit, '', reward);
        assert.ok(got.text, reward);
    }
    // The chat's own currency name is money too.
    assert.equal(parseReward({ reward: '40 Gil' }, '', { currency: { name: 'Gil', short: 'G' } }).amount, 40);
    assert.equal(parseReward({ goal: 'Kill 3 wolves for 12 denarii' }, '', { currency: { name: 'denarii' } }).amount, 12);
    assert.deepEqual(parseReward({ goal: 'Kill 3 wolves for 1 silver each' }).amount, 1);
    // A bare number counts only in the reward label, never in the goal text.
    assert.equal(parseReward({ goal: 'Kill 3 wolves' }), null);
    assert.equal(parseReward({}), null);
});

test('a per-unit reward must name the target; a loose word after "each" is only a hint', () => {
    const wolves = { noun: 'wolves', count: 3, kind: 'foes' };
    const tails = { noun: 'wolf tails', count: 5, kind: 'items' };
    assert.deepEqual(settleReward(parseReward({ reward: '1 silver each wolf' }), wolves), { amount: 1, each: true, unit: '', text: '1 silver each wolf' });
    assert.equal(settleReward(parseReward({ reward: '2 copper per tail' }), tails).amount, 2);
    assert.deepEqual(settleReward(parseReward({ reward: '1 silver per rat' }), wolves), { amount: null, each: false, unit: '', text: '1 silver per rat' });
    assert.equal(settleReward(parseReward({ reward: '1 silver each, paid on return' }), wolves).each, true);
    assert.equal(settleReward(parseReward({ reward: '1 silver each' }), null).amount, null);
    assert.equal(settleReward(null, wolves), null);
});

test('whole-word singular/plural matching of names', () => {
    assert.equal(nameMatches('wolves', 'Wolf'), true);
    assert.equal(nameMatches('wolves', 'Grey Wolf'), true);
    assert.equal(nameMatches('wolf', 'Wolves'), true);
    assert.equal(nameMatches('wolves', 'Wolfhound Handler'), false);
    assert.equal(nameMatches('wolves', 'Werewolf'), false);
    assert.equal(nameMatches('cellar rats', 'Cellar Rat Swarm'), true);
    assert.equal(nameMatches('cellar rats', 'Rat'), false);
    assert.equal(nameMatches('thieves', 'Guild Thief'), true);
    assert.equal(nameMatches('wolf tails', 'Wolf Tail'), true);
    assert.equal(singular('Wolves'), 'wolf');
    assert.equal(countOf('twelve'), 12);
    assert.equal(countOf('twentyone'), null);
});

test('per-unit pay is computed by code', () => {
    assert.equal(payFor({ amount: 1, each: true }, 8), 8);
    assert.equal(payFor({ amount: 8, each: false }, 3), 8);
    assert.equal(payFor({ amount: null, each: false }, 3), null);
    assert.equal(payFor(null, 3), null);
    assert.equal(money(8, { name: 'gold' }), '8 gold');
    assert.equal(money(3, 'Gil'), '3 Gil');
    assert.equal(money(3), '3 gold');
    assert.equal(nounFor({ noun: 'wolves', count: 3 }, 1), 'wolf');
    assert.equal(nounFor({ noun: 'wolf', count: 1 }, 8), 'wolves');
    assert.equal(nounFor({ noun: 'moonleaf', count: 5 }, 5), 'moonleaf');
});

test('money uses the currency plural for any amount but one', () => {
    const mark = { name: 'mark', plural: 'marks' };
    assert.equal(money(50, mark), '50 marks');
    assert.equal(money(1, mark), '1 mark');
    assert.equal(money(50, { name: 'gold' }), '50 gold');
    assert.equal(money(50, 'mark'), '50 mark');
});
