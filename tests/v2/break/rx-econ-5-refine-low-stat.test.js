// rx-economy RX-E-5 (RB #88 gear): refinement is "+8% on its stats a level", but f094352 makes each
// level give at least +1 on a stat. On a one-point piece +3 is DEF 1 → DEF 4 (+300%), so the cheapest
// armour beats the dearest: Ersveil's Patched Oilcloth Coat (60 marks, DEF 1) refined three times for
// 53 marks and 9 Iron Filings is DEF 4, over the Gambeson (600 marks, DEF 3). The fees are a share of
// the piece's worth, so the cheaper the piece the cheaper each point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';

test('three refinements on a DEF 1 coat give about +24%, not +300%', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await rpgHost({});
    try {
        assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
        await host.send('We set out.', host.reply('Bluewatch Town.', ['~ place Bluewatch Town | kind: settlement', '+ coin 900', '+ item Oilcloth Coat | note: armour DEF +1', '+ item Iron Ore | qty: 9']));
        const stack = host.q('inventory.items', {}).find(item => item.name === 'Oilcloth Coat').stack;
        assert.equal((await host.cmd('item.equip', { stack })).ok, true);
        for (let n = 1; n <= 3; n += 1) {
            for (let tries = 0; tries < 30 && (host.q('items.condition', { stack })?.refine ?? 0) < n; tries += 1) {
                await host.send('To the smith.', host.reply('The smith works.', [`! refine Oilcloth Coat | at: smith | with: Iron Ore x${n}`]));
                if ((host.q('items.condition', { stack })?.refine ?? 0) < n) await host.send('Iron.', host.reply('More ore.', [`+ item Iron Ore | qty: ${n}`]));
            }
        }
        const pc = host.q('party.pc');
        const gear = host.q('items.gear', { actor: pc.id });
        const row = gear.counted.find(entry => entry.stack === stack);
        assert.equal(row?.refine, 3, 'the coat reached +3');
        assert.ok(row.stats.DEF <= 2, `a DEF 1 coat refined to +3 gives DEF ${row.stats.DEF} (8% a level is +0.24)`);
    } finally { host.close(); }
});
