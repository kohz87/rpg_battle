// B-b3-12: capItem caps a piece's stats to its rarity's budget, but returns the UNCAPPED cost, and
// itemWorth prices gear by that cost. A story line `+ item Godblade | note: legendary sword ATK
// +9999` is worth 699,930 and sells for ~386,000 at level 1 (the cap rule exists and is not used
// for the price).
import test from 'node:test';
import assert from 'node:assert/strict';
import { capItem } from '../../../src/items.js';
import { itemWorth } from '../../../src/trade.js';
import { DEFAULT_RULES } from '../../../src/rules.js';
import { market } from './helpers/econ.js';

test('itemWorth prices a piece by its capped stats', () => {
    const blade = { name: 'Godblade', slot: 'weapon', rarity: 'legendary', stats: { ATK: 9999 } };
    const capped = capItem(blade, 1, DEFAULT_RULES);
    assert.equal(capped.capped, true);
    assert.equal(itemWorth(blade, { level: 1 }), itemWorth({ ...blade, stats: capped.stats }, { level: 1 }));
});

test('a story item with inflated stats in its note does not sell for a fortune', async () => {
    const host = await market();
    try {
        await host.send('A blade!', host.reply('It hums.', ['+ item Godblade | note: legendary sword ATK +9999']));
        const blade = host.q('inventory.items', {}).find(item => item.name === 'Godblade');
        const fair = host.q('inventory.items', {}).find(item => item.name === 'Godblade');
        const quote = host.q('trade.quote', { type: 'sell', stack: blade.stack, qty: 1, kind: 'smith' });
        assert.equal(quote.ok, true, quote.message);
        // The same piece with the stats a legendary weapon may have at level 1.
        const cap = capItem({ name: 'Godblade', slot: 'weapon', rarity: 'legendary', stats: { ATK: 9999 } }, 1, DEFAULT_RULES);
        const bound = Math.round(itemWorth({ name: 'Godblade', slot: 'weapon', rarity: 'legendary', stats: cap.stats }, { level: 1 }) * 0.5 * 1.3 * 1.25) + 1;
        assert.ok(quote.total <= bound, `Godblade (${JSON.stringify(fair && host.head().domains.inventory.defs[fair.def].stats)}) sells for ${quote.total}; capped it is worth at most ${bound}`);
    } finally { host.close(); }
});
