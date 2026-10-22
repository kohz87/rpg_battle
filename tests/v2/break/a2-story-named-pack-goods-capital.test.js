// Breaker a2 (v2 break pass 2): RB #106 holds the story's own goods (`story/…` defs) to worth × the sell
// rate, so one reply's goods (held to twice its money budget by worth) never sell for more than its money
// budget. But a story line that names a PACK item (`+ item River Drake Scale`) gets the pack's def
// (`pack.…`), counted in the same goods budget by worth, and a pack def keeps every place and buyer factor
// (trade/core.js sellEach: storyMade is by def id). At a capital (sell 1.1) to a crafter (materials 1.3)
// the reply's goods sell for 574 copper against a 400 budget (with a lorebook `market:` line's own
// `sell 4` and env tags it would be several times more). Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
// Needs the four Story Suite checkouts side by side (helpers/suite.js); skipped otherwise (CI checks out
// this repo alone; the rule is also tested on its own in tests/v2/break/a2-rules.test.js).
let suite = null;
try { suite = await import('./helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;
const { started } = suite?.error ? {} : suite;

test('a2-pack-goods: pack goods a story line gave sell for no more than that reply\'s money budget, even at a capital', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await started({ seed: 3 });
    t.after(() => host.close());
    const budget = host.q('inventory.storyBudget').budget;
    await host.send('Loot.', host.reply('A drake hoard.', ['+ item River Drake Scale | qty: 2', '+ item Small Monster Core | qty: 4']));
    const given = host.items().filter(item => /River Drake Scale|Small Monster Core/.test(item.name));
    assert.equal(given.reduce((sum, item) => sum + item.qty, 0), 6, 'the story gave them (inside the goods budget by worth)');
    await host.send('On to the capital.', host.reply('Highcrown.', ['~ place Highcrown | kind: capital']));
    assert.equal(host.q('trade.market').type, 'capital');
    const before = host.wallet();
    for (const item of given) {
        const sold = await host.cmd('trade.sell', { stack: item.stack, qty: item.qty, kind: 'crafter' });
        assert.equal(sold.ok, true, sold.message);
    }
    const got = host.wallet() - before;
    assert.ok(got <= budget, `one reply's story-given goods sold for ${got}; the reply's money budget is ${budget}`);
});
