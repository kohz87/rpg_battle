// B-b3-13: a commission's fee is 0.3 × the piece's worth (× place buy price); the smith then buys the
// piece back at 0.5 × 1.3 × worth (× place sell price): every commission more than doubles its
// fee on resale. Three Rat Tails (sold raw: 6) → fee 16 → the piece sells for 33; at level 51 the
// fee is 178 and the piece sells for 365 (worth follows the PC's level). An endless coin source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coin, market, show } from './helpers/econ.js';

test('commissioning a piece and selling it back never pays more than the materials would have', async () => {
    const host = await market();
    try {
        await host.send('Tails.', host.reply('A bag of tails.', ['+ item Rat Tail | qty: 3']));
        const tails = host.q('inventory.items', {}).find(item => item.name === 'Rat Tail');
        const raw = host.q('trade.quote', { type: 'sell', stack: tails.stack, qty: 3, kind: 'crafter' }).total;
        const before = coin(host);
        const order = await host.cmd('craft.commission', { piece: 'Tail Charm', materials: [{ stack: tails.stack, qty: 3 }], crafter: 'the smith' });
        assert.equal(order.ok, true, show(order));
        assert.equal((await host.cmd('craft.collect', { order: order.receipt.data.order })).ok, true);
        const piece = host.q('inventory.items', {}).find(item => item.name === 'Tail Charm');
        assert.equal((await host.cmd('trade.sell', { stack: piece.stack, qty: 1, kind: 'smith' })).ok, true);
        const gained = coin(host) - before;
        assert.ok(gained <= raw, `commission + resale gained ${gained}; selling the tails raw pays ${raw}`);
    } finally { host.close(); }
});
