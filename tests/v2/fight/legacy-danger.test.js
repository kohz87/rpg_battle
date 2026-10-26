import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { legacyDangerTrace } from './legacy-danger-trace.js';

test('unpinned capture, offer, start, Auto and settlement match main 81cb400 byte for byte (15 fights)', t => {
    t.mock.method(console, 'warn', () => {});
    const expected = JSON.parse(readFileSync(new URL('./fixtures/legacy-danger.json', import.meta.url)));
    const actual = legacyDangerTrace().map(({ tier, seed, snapshots }) => ({ tier, seed, hashes: snapshots.map(bytes => createHash('sha256').update(bytes).digest('hex')) }));
    assert.deepEqual(actual, expected);
});
