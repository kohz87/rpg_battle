// Light checks of the seeded generator: same seed, same numbers, and a saved state resumes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSeed, makeRng } from '../src/rng.js';

test('the same seed gives the same sequence; another seed does not', () => {
    const a = makeRng('fight-1');
    const b = makeRng('fight-1');
    const c = makeRng('fight-2');
    const seqA = Array.from({ length: 10 }, () => a.next());
    assert.deepEqual(seqA, Array.from({ length: 10 }, () => b.next()));
    assert.notDeepEqual(seqA, Array.from({ length: 10 }, () => c.next()));
    assert.equal(hashSeed('x'), hashSeed('x'));
});

test('a saved state resumes the sequence exactly', () => {
    const rng = makeRng(42);
    rng.next();
    rng.int(1, 6);
    const resumed = makeRng(rng.state());
    assert.deepEqual([rng.next(), rng.next()], [resumed.next(), resumed.next()]);
});

test('helpers stay in range', () => {
    const rng = makeRng('range');
    for (let i = 0; i < 500; i++) {
        const n = rng.int(1, 6);
        assert.ok(n >= 1 && n <= 6 && Number.isInteger(n));
        const x = rng.between(0.9, 1.1);
        assert.ok(x >= 0.9 && x < 1.1);
        assert.ok(['a', 'b'].includes(rng.pick(['a', 'b'])));
    }
    assert.equal(rng.chance(0), false);
    assert.equal(rng.chance(100), true);
});
