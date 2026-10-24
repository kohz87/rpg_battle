// rx-economy RX-E-4 (RB #89 crafting): a recipe that makes more than one (`qty: 2`) gives every unit
// the worth of all its materials (make.js outputDef: value = inputWorth, never divided by qty), so a
// craft doubles (×qty) the worth of what went in. Ersveil's Leech-salt Pouch (2 Coarse Salt + 1 Burlap
// Sack, worth 8) makes 2 pouches worth 8 each. The resale cap (trade.paid = fetch / qty) holds a sale,
// but every other reader of def.value (Story Block's story goods budget for a later `+ item` of that
// def, RB's character-file worth, the inventory's worth shown) sees twice what was made, and the cap
// is pruned past 500 trade.paid rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PACK, craftHost, replyWhen } from '../craft/helpers.js';

const PAIR = { ...PACK, content: { ...PACK.content, recipes: [...PACK.content.recipes, { name: 'Fish Pair', makes: 'grilled-fish', qty: 2, materials: [{ item: 'iron-ore', qty: 2 }], craft: 'cooking', known: true, dc: 5 }] } };

test('two things made from materials worth 8 are worth 8 in all, not 8 each', async () => {
    const host = await craftHost({ pack: PAIR, goods: ['+ item Iron Ore | qty: 2'] });
    try {
        await replyWhen(host, 'I cook.', die => die >= 10 && die < 20, () => ['! craft Fish Pair | with: Iron Ore x2 | roll: 1']);
        const inv = host.head().domains.inventory;
        const made = Object.values(inv.stacks).filter(stack => String(stack.def).startsWith('craft/'));
        assert.ok(made.length, 'something was made');
        const worth = made.reduce((sum, stack) => sum + (inv.defs[stack.def]?.value ?? 0) * stack.qty, 0);
        assert.ok(worth <= 8, `2 Iron Ore (worth 8) made things worth ${worth}`);
    } finally { host.close(); }
});
