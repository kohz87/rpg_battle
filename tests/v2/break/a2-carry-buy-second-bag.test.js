// Breaker a2 (v2 break pass 2): canCarry (items/carry.js:151-178) counts a thing that carries as bringing its
// own room ("a mule carries itself") even when it joins a stack that already carries — and a stack adds its
// bonus once whatever its count (carryBonuses). So with one Backpack in the bag and the party already over its
// limit (the story's gains are kept, encumbered), buying a second Backpack is allowed (+20 assumed) and leaves
// the party further over (82 / 76). The reader's own buys are meant to be refused past the limit.
// Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
// Needs the four Story Suite checkouts side by side (helpers/suite.js); skipped otherwise (CI checks out
// this repo alone; the rule is also tested on its own in tests/v2/break/a2-rules.test.js).
let suite = null;
try { suite = await import('./helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;
const { started } = suite?.error ? {} : suite;

test('a2-carry-buy: a second bag bought into the same stack is refused when it leaves the party over its limit', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await started({ seed: 16 });
    t.after(() => host.close());
    await host.send('Gold.', host.reply('Pay.', ['+ coin 400', '+ item Backpack']));
    const carry = () => host.q('items.carry', {});
    for (let n = 0; n < 30 && carry().load <= carry().capacity; n += 1) await host.send('More.', host.reply('Bread.', ['+ item Coarse Bread | qty: 10']));
    assert.ok(carry().load > carry().capacity, 'the party is over its limit (the story\'s gains are kept)');
    const stock = host.q('trade.stock', { kind: 'watch-stores' });
    const bag = stock.items.find(item => item.def.name === 'Backpack');
    assert.ok(bag, 'the Watch Stores sell Backpacks');
    const bought = await host.cmd('trade.buy', { shop: stock.shop, def: bag.def.id, qty: 1 });
    const after = carry();
    assert.ok(!bought.ok || after.load <= after.capacity, `bought: ${bought.ok}; now ${after.load} carried of ${after.capacity}`);
});
