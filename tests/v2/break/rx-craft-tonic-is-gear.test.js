// rx-combat (RB #89 craft): every story-taught recipe whose item no pack or inventory defines is made
// as equipment. make.js baseOutput: `gear = GEAR_CRAFTS.includes(craft) || Boolean(itemSlot(name))`,
// but v1 itemSlot falls back to slotFromStats({}) = 'accessory' for ANY name, so it is always truthy.
// A "Healing Tonic" cooked from herbs comes out as an accessory with a free main stat (LUK +2, worn
// in fights), and no story-taught potion, food or bomb is ever a consumable the fight can use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { craftHost, replyWhen } from '../craft/helpers.js';
import { seeded } from '../integration/helpers/host.js';

test('rx-combat: a story-taught Healing Tonic is a consumable that heals, not an accessory', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(11, async () => {
        const host = await craftHost({ goods: ['+ item Healing Herb | qty: 8'] });
        try {
            await host.send('Teach me.', host.reply('The hermit teaches Ren.', ['+ recipe Healing Tonic | from: the hermit | makes: Healing Tonic | with: Healing Herb x2 | craft: cooking']));
            await host.send('We camp.', host.reply('Camp.', ['~ place Old Camp | kind: camp']));
            await replyWhen(host, 'I brew a tonic.', die => die >= 12, () => ['! craft Healing Tonic']);
            const row = host.q('inventory.items', {}).find(item => /Healing Tonic/.test(item.name));
            assert.ok(row, 'a tonic was made');
            assert.notEqual(row.kind, 'equipment', `the tonic was made as ${row.kind} (${row.slot}): ${row.note}`);
            assert.equal(row.kind, 'consumable');
        } finally {
            host.close();
        }
    });
});
