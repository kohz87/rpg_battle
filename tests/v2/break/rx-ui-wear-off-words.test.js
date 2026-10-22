// rx-ui (beta rolling break, F100 wording): with the gear wear feature off, RPG Battle's refusals say
// "Gear wear is turned off in this chat". A feature is the reader's choice for every chat (SPEC §6
// Features), switched in Settings → Features; "in this chat" sends the reader looking for a per-chat switch
// that does not exist. Story Block's own refusal says "… is turned off in the Features settings."
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';

test('gear wear off: the refusals name the Features settings, not "this chat"', async () => {
    const host = await rpgHost();
    try {
        assert.equal((await host.cmd('creation.finish', { name: 'Ren', race: 'rpg-battle/elf', points: { STR: 5, DEX: 5, VIT: 0, AGI: 0, INT: 0, LUK: 0, CHA: 0 } })).ok, true);
        await host.st.generate('normal', { reply: host.reply('In town.', ['~ place Bluewatch Town | kind: settlement', '+ item Chain Shirt | note: armour DEF +3', '+ item Repair Kit']) });
        const items = host.q('inventory.items', {});
        const shirt = items.find(item => item.name === 'Chain Shirt').stack;
        const kit = items.find(item => item.name === 'Repair Kit').stack;
        assert.equal((await host.cmd('item.equip', { stack: shirt })).ok, true);
        host.features.set('rpg-battle.wear', false);
        const used = await host.cmd('item.use', { stack: kit });
        const quote = host.q('trade.quote', { type: 'repair', stack: shirt });
        for (const message of [used.message, quote.message]) {
            assert.ok(!/in this chat/.test(message), message);
            assert.match(message, /Features/);
        }
    } finally {
        host.close();
    }
});
