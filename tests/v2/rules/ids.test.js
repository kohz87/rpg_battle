// rules/ids.js: the contract's id patterns, held to the vendored Story Block copy they are copied from.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ids from '../../../src/v2/rules/ids.js';
import { DEF_ID, RECORD_ID, ACTOR_ID, HASH, EPOCH_FALLBACK, epochOf, idFromHash, isActorId, isDefId, isHash, isRecordId } from '../../../src/v2/rules/ids.js';
import { DEF_ID as SB_DEF_ID, RECORD_ID as SB_RECORD_ID } from '../../vendor/story-block/src/v2/check.js';
import { idFromHash as sbIdFromHash } from '../../vendor/story-block/src/v2/replay.js';

test('the record and definition id patterns are Story Block\'s', () => {
    assert.equal(ids.RECORD_ID.source, SB_RECORD_ID.source);
    assert.equal(ids.DEF_ID.source, SB_DEF_ID.source);
});

test('actor, hash and id checks', () => {
    assert.equal(isActorId('ac_00000001'), true);
    assert.equal(isActorId('ac_0000001'), false);
    assert.equal(isActorId('pc_00000001'), false);
    assert.equal(isRecordId('ep_00000001'), true);
    assert.equal(isRecordId('pack.fixture/c0'), false);
    assert.equal(isDefId('pack.fixture/c0'), true);
    assert.equal(isDefId('ac_00000001'), false);
    assert.equal(isHash('a'.repeat(64)), true);
    assert.equal(isHash('A'.repeat(64)), false);
    assert.equal(isHash('a'.repeat(63)), false);
});

test('idFromHash is Story Block\'s derivation from a hash, and the epoch is one record id until the savepoint epoch exists', () => {
    for (const hex of ['0'.repeat(64), 'f'.repeat(64), 'abcdef0123456789'.repeat(4), '00000000ff' + '1'.repeat(54)]) {
        assert.equal(idFromHash('at', hex), sbIdFromHash('at', hex));
        assert.match(idFromHash('at', hex), RECORD_ID);
    }
    assert.equal(epochOf(), EPOCH_FALLBACK);
    assert.match(EPOCH_FALLBACK, RECORD_ID);
    assert.ok(ACTOR_ID && DEF_ID && HASH);
});
