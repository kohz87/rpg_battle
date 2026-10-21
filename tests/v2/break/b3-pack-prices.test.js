// B-b3-17: a pack's item values are the pack's rules (Ersveil: a Minor Healing Draught is worth
// 2000 marks, a Rat Tail 1), but trade prices ignore def.value and reprice every def with v1's
// itemWorth: the draught sells for ~13 marks (0.6 % of its value), the tail for 2 (twice its
// value). The pack's shops and their prices are not used either (routed to RB-B; still open at HEAD).
import test from 'node:test';
import assert from 'node:assert/strict';
import { market } from './helpers/econ.js';

const PACK = JSON.stringify({
    id: 'b3-prices', version: '1.0.0', name: 'B3 prices', requires: { storyBlock: '^2' }, currency: { name: 'mark', short: 'mk' },
    content: { items: [
        { name: 'Minor Healing Draught', kind: 'consumable', value: 2000, effect: { heal: 20 } },
        { name: 'Rat Tail', kind: 'material', value: 1 },
    ] },
});

test('a pack item sells for a share of the pack\'s own value, never above it', async () => {
    const host = await market();
    try {
        assert.equal((await host.packs.packs.install(PACK)).ok, true);
        await host.send('Loot.', host.reply('We pick it up.', ['+ item Minor Healing Draught', '+ item Rat Tail']));
        for (const name of ['Minor Healing Draught', 'Rat Tail']) {
            const item = host.q('inventory.items', {}).find(entry => entry.name === name);
            assert.ok(item.def.startsWith('pack.'), `${name} is the pack's def`);
            const quote = host.q('trade.quote', { type: 'sell', stack: item.stack, qty: 1, kind: 'apothecary' });
            assert.ok(quote.total <= item.value && quote.total >= item.value * 0.25, `${name}: valued ${item.value}, sells for ${quote.total}`);
        }
    } finally { host.close(); }
});
