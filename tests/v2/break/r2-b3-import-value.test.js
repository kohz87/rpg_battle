// r2 B-b3-r2-4: the character file's caps count things (MAX_THINGS 300) and coin (purseCap: 250 at
// level 1), not worth: a level-1 file with 200 "Epic Sword" (ATK 999, held to epic's budget) brings
// 200 separate defs (story/epic-sword-2 … -200) that sell for about 44,000 marks, ~177 × the purse
// the same file may carry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';
import { purseCap } from '../../../src/v2/party/portable.js';
import { show } from './helpers/econ.js';

const FILE = {
    rpgBattleCharacter: 1, name: 'Trader', role: '', level: 1, xp: 0, points: 0,
    stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [], custom: [],
    items: Array.from({ length: 200 }, () => ({ def: { name: 'Epic Sword', kind: 'equipment', rarity: 'epic', slot: 'weapon', stats: { ATK: 999 } }, qty: 1 })),
    purse: 0,
};

test('what a character file brings is worth no more than a few purses of its level', async () => {
    const host = await rpgHost();
    try {
        const r = await host.cmd('creation.import', { character: structuredClone(FILE) });
        assert.equal(r.ok, true, show(r));
        await host.send('To market.', host.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement']));
        let worth = 0;
        for (const item of host.q('inventory.items', {}).filter(entry => entry.name === 'Epic Sword')) {
            const quote = host.q('trade.quote', { type: 'sell', stack: item.stack, qty: 1, kind: 'smith' });
            if (quote.ok) worth += quote.total;
        }
        assert.ok(worth <= 10 * purseCap(1), `the file's swords sell for ${worth}; the purse cap at level 1 is ${purseCap(1)}`);
    } finally { host.close(); }
});
