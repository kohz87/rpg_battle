// RB #104 (layered place prices): a place's sell factor may be above 1 (a city, a capital, a "dear"
// place), so one reply's story goods, held to that reply's goods budget by worth (Story Block: twice
// the reply's money budget), sold at a capital paid more than the money one reply may give
// (worth × sell rate × factors > budget). Now a buyer pays at most worth × the sell rate for the
// story's own things (trade/core.js storyMade); a pack's goods keep the place's factors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';
import { makeWorld, sellEach } from '../../../src/v2/trade/core.js';

const BUDGET = 40;
const BUYERS = ['general', 'smith', 'fence', 'apothecary', 'tailor', 'armourer', 'jeweller'];

test('one reply\'s story goods sold at a dear capital, to the best buyer for each, pay no more than that reply\'s money budget', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await rpgHost({ settings: { modules: { 'story-block': { storyCoinPerReply: BUDGET }, 'rpg-battle': { 'trade.placePrices': [{ place: 'Highmark', level: 'dear' }] } } } });
    try {
        assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
        await host.send('We set out.', host.reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement']));
        await host.send('Loot.', host.reply('A chest.', [
            '+ item Silver Ring | note: accessory LUK +1', '+ item Iron Dagger | note: weapon ATK +3',
            '+ item Wolf Pelt | qty: 3', '+ item Chain Coif | note: armour DEF +2', '+ item Healing Herb | qty: 2',
            '+ item Bronze Torc | note: accessory DEF +1', '+ item Hunting Knife | note: weapon ATK +2', '+ item Fox Fur | qty: 4',
        ]));
        const tally = Object.values(host.head().domains.inventory.perReply ?? {}).at(-1);
        assert.ok(tally?.worth > BUDGET, `the reply gave goods worth ${tally?.worth}: more than the money budget, within the goods budget`);
        await host.send('To the capital.', host.reply('Highmark.', ['~ place Highmark | kind: capital']));
        const market = host.q('trade.market');
        assert.ok(market.sell > 1, `the capital pays more than 1× (${market.sell})`);
        let total = 0;
        for (const row of host.q('inventory.items').filter(item => String(item.def).startsWith('story/'))) {
            const def = host.head().domains.inventory.defs[row.def];
            let best = 0;
            let kind = null;
            for (const buyer of BUYERS) {
                const quote = host.q('trade.quote', { type: 'sell', stack: row.stack, qty: row.qty, kind: buyer });
                if (quote?.ok && quote.total > best) { best = quote.total; kind = buyer; }
            }
            assert.ok(best / row.qty <= Math.max(1, Math.floor(def.value * 0.5)), `${row.name}: ${best / row.qty} each against worth ${def.value}`);
            if (kind) {
                const sold = await host.cmd('trade.sell', { stack: row.stack, qty: row.qty, kind });
                assert.equal(sold.ok, true, sold.message);
                total += sold.data?.total ?? best;
            }
        }
        assert.ok(total > 0);
        assert.ok(total <= BUDGET, `sold for ${total}: more than the ${BUDGET} one reply may give`);
    } finally { host.close(); }
});

test('a pack\'s goods keep the place\'s sell factors; the story\'s own are held to worth × the sell rate', () => {
    const inventory = { defs: {}, stacks: {}, wallets: {} };
    const at = kind => makeWorld({ scene: { place: { name: 'Highmark', kind } }, inventory, party: null, trade: {} });
    const pack = { id: 'ersveil/silver-bar', name: 'Silver Bar', kind: 'material', rarity: 'uncommon', value: 100, tags: [] };
    const story = { ...pack, id: 'story/silver-bar' };
    assert.ok(sellEach(pack, 'general', at('capital')) > sellEach(pack, 'general', at('town')), 'a capital pays more for a pack\'s goods');
    assert.equal(sellEach(story, 'general', at('capital')), sellEach(story, 'general', at('town')), 'not for the story\'s own');
    for (const buyer of BUYERS) assert.ok(sellEach(story, buyer, at('capital')) <= 50, buyer);
});
