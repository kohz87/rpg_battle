// Key items (user decision, 2026-10-22): the one notable item a reply's story gives outside its goods
// budget lands in Story Block as a stack of its own marked `key: true`. It is used, worn and given as
// any other, but it has no cash value: trade.sell refuses it, and a commission counts it as worth 0,
// so story text never turns into money past one reply's goods. Bought items keep their trade.paid cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coin, market, show } from '../break/helpers/econ.js';

const plain = value => JSON.parse(JSON.stringify(value));
const items = host => host.q('inventory.items', {});
// 16 potions of 125 spend a level-1 reply's goods budget (2000), so the next `+ item` line of the reply
// is its notable one: a key item.
const FILL = '+ item Superior Healing Potion | qty: 16';

async function opened(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await market();
    t.after(() => host.close());
    return host;
}

test('a key item is given and usable, and no trader buys it', async t => {
    const host = await opened(t);
    await host.send('The old man?', host.reply('Shelves, and the old man hands you a draught.', [FILL, '+ item Old Man\'s Draught | note: heals']));
    const gift = items(host).find(item => item.name === 'Old Man\'s Draught');
    assert.equal(gift?.key, true, JSON.stringify(gift));
    assert.equal(gift.qty, 1);
    const before = coin(host);
    for (const kind of ['general', 'apothecary', 'smith', 'crafter', 'fence']) {
        const quote = host.q('trade.quote', { type: 'sell', stack: gift.stack, qty: 1, kind });
        assert.equal(quote.ok, false, kind);
        const sold = await host.cmd('trade.sell', { stack: gift.stack, qty: 1, kind });
        assert.equal(sold.ok, false, kind);
        assert.equal(sold.message, 'Old Man\'s Draught is a key item; it can\'t be sold.');
    }
    assert.equal(coin(host), before, 'nothing paid');
    // Usable: the story uses it like any other.
    const [potions] = items(host).filter(item => item.name === 'Superior Healing Potion');
    assert.equal((await host.cmd('trade.sell', { stack: potions.stack, qty: 1 })).ok, true, 'ordinary story goods still sell');
    await host.send('Drink.', host.reply('Wessel drinks the old man\'s draught.', ['- item Old Man\'s Draught | used: yes']));
    assert.equal(items(host).some(item => item.name === 'Old Man\'s Draught'), false, JSON.stringify(host.turn.problems()));
});

test('a key item stays apart from a bought stack of the same item; the bought ones sell up to what was paid', async t => {
    const host = await opened(t);
    const stock = host.q('trade.stock', { kind: 'general' });
    const line = stock.items.find(item => item.def.stack !== false && item.def.kind !== 'equipment');
    assert.ok(line, JSON.stringify(stock.items.map(item => item.def.name)));
    const buy = await host.cmd('trade.buy', { shop: stock.shop, def: line.def.id, qty: 2 });
    assert.equal(buy.ok, true, show(buy));
    await host.send('A gift.', host.reply('Shelves, and one more for the road.', [FILL, `+ item ${line.def.name}`]));
    const same = items(host).filter(item => item.def === line.def.id).map(item => [item.qty, item.key === true]).sort();
    assert.deepEqual(same, [[1, true], [2, false]], 'the key item never joins the bought stack, nor they it');
    const bought = items(host).find(item => item.def === line.def.id && !item.key);
    const sold = await host.cmd('trade.sell', { stack: bought.stack, qty: 2 });
    assert.equal(sold.ok, true, show(sold));
    assert.ok(sold.receipt.data.each <= line.price, `sold for ${sold.receipt.data.each} each; paid ${line.price}`);
    const key = items(host).find(item => item.def === line.def.id && item.key);
    assert.equal((await host.cmd('trade.sell', { stack: key.stack, qty: 1 })).ok, false);
});

test('a key item made into a commission pays nothing back: fee in, at most the fee out', async t => {
    const host = await opened(t);
    await host.send('Tails.', host.reply('Shelves, and a rat tail as a keepsake.', [FILL, '+ item Rat Tail']));
    const tail = items(host).find(item => item.name === 'Rat Tail');
    assert.equal(tail?.key, true, JSON.stringify(tail));
    const before = coin(host);
    const order = await host.cmd('craft.commission', { piece: 'Tail Charm', materials: [{ stack: tail.stack, qty: 1 }], crafter: 'the smith' });
    assert.equal(order.ok, true, show(order));
    assert.equal((await host.cmd('craft.collect', { order: order.receipt.data.order })).ok, true);
    const piece = items(host).find(item => item.name === 'Tail Charm');
    for (const kind of ['smith', 'general', 'crafter', 'fence']) {
        const quote = host.q('trade.quote', { type: 'sell', stack: piece.stack, qty: 1, kind });
        if (quote.ok) assert.ok(quote.total <= order.receipt.data.fee, `${kind} pays ${quote.total}; the fee was ${order.receipt.data.fee}`);
    }
    assert.equal((await host.cmd('trade.sell', { stack: piece.stack, qty: 1, kind: 'smith' })).ok, true);
    assert.ok(coin(host) - before <= 0, `gift → commission → sale gained ${coin(host) - before}`);
});

test('deleting a reply before the key item\'s keeps it a key item; a rebuild equals live', async t => {
    const host = await opened(t);
    await host.send('A.', host.reply('Rope.', ['+ item Rope']));
    const a = host.store.headIndex();
    await host.send('B.', host.reply('A gift.', [FILL, '+ item Old Man\'s Draught']));
    await host.send('C.', host.reply('A lantern.', ['+ item Lantern']));
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    assert.deepEqual(host.store.problems(), []);
    const gift = items(host).find(item => item.name === 'Old Man\'s Draught');
    assert.equal(gift?.key, true);
    assert.equal((await host.cmd('trade.sell', { stack: gift.stack, qty: 1 })).ok, false);
    const live = plain(host.head());
    host.store.rebuild();
    assert.deepEqual(plain(host.head()), live, 'a cold rebuild says the same');
});
