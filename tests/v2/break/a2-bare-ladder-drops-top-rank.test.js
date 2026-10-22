// Breaker a2 (v2 break pass 2): a reader's ladder with no levels (Levels per rank 0: "spread to the level
// cap") is banded by RPG Battle as ceil(cap / ranks) levels a rank (terms.js rankLadder → settle `band`).
// With 12 ranks and cap 99 that is 9 a rank, so rank 12 would start at 100 > cap and is dropped
// (settle: `if (levels[0] > cap && out.length) break`): RPG Battle's party.ranks has 11 ranks. Story
// Director then cannot use RPG Battle's banding (readerLadder needs the same length) and bands the same
// lines its own way (DEFAULT_LEVELS 1-5, 6-12, … 51-60, ranks 8-12 with no levels): the party's rank, a
// foe's `rank:` and a quest's rank disagree past level 60, and the reader's top rank exists in one module
// only. Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
// Needs the four Story Suite checkouts side by side (helpers/suite.js); skipped otherwise (CI checks out
// this repo alone; the rule is also tested on its own in tests/v2/break/a2-rules.test.js).
let suite = null;
try { suite = await import('./helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;
const { suiteHost } = suite?.error ? {} : suite;

test('a2-ladder-bare: every rank of a 12-line ladder (Levels per rank 0) is on RPG Battle\'s ladder, banded as Story Director bands it', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const lines = Array.from({ length: 12 }, (_, i) => ({ rank: `Circle ${i + 1}` }));
    const host = await suiteHost({ pack: false, settings: { modules: { 'rpg-battle': { 'party.ranks': lines } } } });
    t.after(() => host.close());
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    await host.send('In.', host.reply('Town.', ['~ place Bluewatch Village | kind: settlement']));
    const rb = host.q('party.ranks');
    const sd = host.q('quest.ranks');
    assert.equal(rb.length, 12, `RPG Battle's ladder: ${rb.map(rank => `${rank.id} ${rank.levels.join('-')}`).join(', ')}`);
    assert.deepEqual(sd.map(rank => rank.levels), rb.map(rank => rank.levels), 'Story Director\'s quest ranks band the ladder as RPG Battle does');
});
