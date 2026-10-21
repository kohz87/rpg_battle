// R2-b7-combos-1 (RPG Battle side): RPG Battle now depends on host features from the Story Block
// fix round (ctx.carrier.sid for its claims and dice keys, internal command objects), but its
// definition declares no `requires.storyBlock`. On the round-1 host (Story Block a1cf5b1, also
// "2.0.0-alpha.1") it registers without a word and its own suite fails 2 tests there
// (B-b2-timeline-10 claims, F80 dice). Drop into rpg_battle/tests/v2/break/.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createModule } from '../../../src/v2/module.js';

// Blocked (todo): the vendored testkit's Story Block is 2.0.0-alpha.1 and enforces requires, so
// `>=2.0.0-alpha.2` refuses RPG Battle in its own suite. Lands with the testkit synced from
// Story Block's 2.0.0-alpha.2 (SB-r2fix).
test('RPG Battle says which Story Block it needs', { todo: 'waits for Story Block 2.0.0-alpha.2 in the vendored testkit' }, () => {
    const def = createModule();
    assert.equal(typeof def.requires?.storyBlock, 'string', 'no requires.storyBlock in the definition');
});
