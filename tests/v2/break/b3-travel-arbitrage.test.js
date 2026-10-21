// B-b3-14: what a trader sells is bought back elsewhere for more than it cost: a fence in a hamlet
// sells gear at 0.85 × 0.8 × worth, a smith in a capital pays 0.5 × 1.3 × 1.25 × worth. Places are
// free text and every place name is its own shop with fresh stock, so one `~ place` line apart the
// party buys low and sells high without end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coin, market } from './helpers/econ.js';

test('a piece bought from a trader never sells for more than was paid for it', async () => {
    const host = await market();
    try {
        await host.send('We walk to the hamlet.', host.reply('Shorn Hamlet.', ['~ place Shorn Hamlet | kind: settlement']));
        const stock = host.q('trade.stock', { kind: 'fence' });
        const gear = stock.items.find(item => item.def.kind === 'equipment');
        assert.ok(gear, 'the fence has gear');
        const before = coin(host);
        assert.equal((await host.cmd('trade.buy', { shop: stock.shop, def: gear.def.id, qty: 1 })).ok, true);
        await host.send('On to the capital.', host.reply('Highmark Capital.', ['~ place Highmark Capital | kind: settlement']));
        const piece = host.q('inventory.items', {}).find(item => item.def === gear.def.id);
        assert.equal((await host.cmd('trade.sell', { stack: piece.stack, qty: 1, kind: 'smith' })).ok, true);
        assert.ok(coin(host) <= before, `bought for ${gear.price}, sold for ${coin(host) - before + gear.price}: +${coin(host) - before}`);
    } finally { host.close(); }
});
