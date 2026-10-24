// The Crafting feature (MODULES §F100) on the real host: on by default; turned off, the craft and
// recipe lines do nothing, the grammar leaves the fixed prompt, the queries answer null, no tail line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { craftHost, qtyOf } from './helpers.js';

// The vendored host has reader feature switches from Story Block's Features PR (#96) on.
const hostHasFeatures = (() => {
    try { return readFileSync(new URL('../../vendor/story-block/testkit/host.js', import.meta.url), 'utf8').includes('features: runtime.features'); } catch { return false; }
})();

test('the Crafting feature off: no grammar, no crafting, no recipes learned, queries null; on again, it all comes back', { skip: hostHasFeatures ? false : 'the vendored Story Block has no feature switches yet' }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await craftHost({ settings: { features: { 'rpg-battle.crafting': false } }, goods: ['+ item River Fish | qty: 2'] });
    try {
        await host.send('I cook a fish at the inn.', host.reply('Fish.', ['! craft Grilled Fish | roll: 1', '+ recipe Iron Sword | from: Hollis']));
        assert.equal(qtyOf(host, 'River Fish'), 2, 'nothing was cooked');
        assert.deepEqual(host.head().domains.craft.known, {});
        assert.equal(host.q('craft.view'), null);
        assert.ok(!host.statics().at(-1).includes('! craft'), 'the grammar is not in the fixed part');
        assert.ok(!host.tails().at(-1).includes('[Crafting]'));
        host.features.set('rpg-battle.crafting', true);
        await host.send('I cook a fish.', host.reply('Fish.', ['! craft Grilled Fish | roll: 1']));
        assert.equal(qtyOf(host, 'River Fish'), 1);
        assert.ok(host.statics().at(-1).includes('! craft'));
        assert.ok(host.q('craft.view').people.length);
    } finally { host.close(); }
});
