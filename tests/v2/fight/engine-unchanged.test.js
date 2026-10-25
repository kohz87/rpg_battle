// The existing fight engine (src/combat.js) plays exactly as it did before track B touched it: twenty scripted fights (four rule
// variants, five seeds, variance and crits on) give the traces recorded from the untouched engine, byte for byte, and replay
// reproduces each one. New behaviour switches on only for a fight whose setup says so (tests/v2/fight/*.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VARIANTS, trace } from './golden.js';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));

for (const [name, over] of Object.entries(VARIANTS)) {
    test(`the v1 engine, ${name} rules: five seeds give the recorded traces`, () => {
        for (const seed of ['alpha', 'beta', 'gamma', 'delta', 'eps']) {
            const got = trace(seed, over);
            assert.deepEqual(got, golden[`${name}/${seed}`], `${name}/${seed}`);
            assert.equal(got.replayed, true);
        }
    });
}
