// B4-13: while a fight is under way a story `! use <item>` line becomes the fight's item action
// (items/commands.js fightUse → combat.act). Nothing limits how many: one reply with five
// `! use Minor Healing Draught` lines plays five of the reader's turns (and every foe turn
// between them) and empties the bag. The story may not narrate blows (combat STATIC_TEXT), yet
// its change lines can play the fight; at most one fight action should come from one reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, seeded, started } from './helpers.js';

test('B4-13: one reply\'s story use lines play at most one fight turn', async () => {
    await seeded(21, async () => {
        const host = await started();
        try {
            await host.send('I search the cart.', host.reply('Five vials.', ['+ item Minor Healing Draught | qty: 5 | note: heal 20']));
            const { start } = await offerAndStart(host, '! encounter 3 Wolf | tier: even');
            assert.equal(start.ok, true, start.message);
            assert.equal((await host.cmd('combat.act', { action: { type: 'defend' } })).ok, true);
            const before = host.head().domains.combat.session.actions.length;
            await host.send('I drink.', host.reply('You gulp them down one after another.', Array(5).fill('! use Minor Healing Draught')));
            const after = host.head().domains.combat.session?.actions.length ?? before;
            assert.ok(after - before <= 1, `one reply played ${after - before} fight turns`);
        } finally {
            host.close();
        }
    });
});
