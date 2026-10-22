// party/pools.js: how a member's numbers are kept (counts) and read (fitted).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTY_COUNTERS, filledBy, fitActor, fitParty, fitPool, fitState, storedPool } from '../../../src/v2/party/pools.js';
import { part } from '../../../src/v2/party/index.js';
import { withPc, pcOf } from './helpers/fake-ctx.js';

test('fitPool: from `lost` when kept, else `cur` as written; held to 0…max', () => {
    assert.deepEqual(fitPool({ cur: 40, max: 98, lost: 30 }), { cur: 68, max: 98 });
    assert.deepEqual(fitPool({ cur: 102, max: 98 }), { cur: 98, max: 98 }, 'an older chat\'s cur above a max that went down');
    assert.deepEqual(fitPool({ cur: 10, max: 98, lost: -20 }), { cur: 98, max: 98 }, 'a heal counted past full');
    assert.deepEqual(fitPool({ cur: 10, max: 98, lost: 140 }), { cur: 0, max: 98 }, 'a blow counted past empty');
    assert.deepEqual(fitPool({ cur: 5, max: -3 }), { cur: 0, max: 0 });
});

test('storedPool: below full keeps `lost`; full (or filled by a rest) keeps none', () => {
    assert.deepEqual(storedPool({ cur: 68, max: 98 }), { cur: 68, max: 98, lost: 30 });
    assert.deepEqual(storedPool({ cur: 98, max: 98 }), { cur: 98, max: 98 });
    assert.deepEqual(storedPool({ cur: 12, max: 98 }, { full: true }), { cur: 98, max: 98 });
    assert.deepEqual(storedPool({ cur: 120, max: 98 }), { cur: 98, max: 98 });
    assert.deepEqual(filledBy('long'), ['hp', 'mp', 'sp']);
    assert.deepEqual(filledBy('short'), ['sp']);
});

test('fitActor / fitParty / fitState: the same object when it fits; floors for level, XP, points, stats', () => {
    const party = withPc().domains.party;
    assert.equal(fitParty(party), party);
    const state = { domains: { party } };
    assert.equal(fitState(state), state);
    const actor = { ...pcOf(withPc()), level: 0, xp: -30, points: -2, stats: { ...pcOf(withPc()).stats, STR: -1 }, hp: { cur: 4, max: 50, lost: 10 } };
    const fitted = fitActor(actor);
    assert.notEqual(fitted, actor);
    assert.deepEqual([fitted.level, fitted.xp, fitted.points, fitted.stats.STR, fitted.hp], [1, 0, 0, 0, { cur: 40, max: 50 }]);
    assert.equal(actor.level, 0, 'the record itself is not changed');
});

test('the party domain counts lost, max, level, XP, points and stats; the id pattern comes first', () => {
    assert.deepEqual(part.domains.party.counters, [...PARTY_COUNTERS]);
    assert.equal(PARTY_COUNTERS[0], 'actors/*/id');
    // The validator takes counts a replay moved (it never skips a block for them).
    const party = structuredClone(withPc().domains.party);
    Object.assign(party.actors[party.pc], { level: 0, xp: -5, points: -1 });
    party.actors[party.pc].hp = { cur: 120, max: 98, lost: -22 };
    assert.deepEqual(part.domains.party.validate(party), []);
});
