// rx-combat (RB #89 craft, F80): the reply's dice go by place among its checks AND crafts. A craft
// placed before a check takes Roll 1, and the check then takes Roll 1 too (checks/commands.js
// applyCheck counts only earlier checks as used; craft.rollsUsed is not asked). The model sees both
// rolls in the tail before it writes, so with a high Roll 1 and a low Roll 2 it writes the craft
// first and both get the high die: the "better die" pick B-b4-2 closed, back through crafting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { craftHost } from '../craft/helpers.js';
import { seeded } from '../integration/helpers/host.js';

test('rx-combat: a check after a craft in the same reply takes Roll 2, not the craft\'s Roll 1', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(9, async () => {
        const host = await craftHost({ goods: ['+ item River Fish | qty: 3'] });
        try {
            await host.send('I cook, then I look around.', host.reply('Ren cooks and looks.', ['! craft Grilled Fish', '? check Perception — spot the thief | dc: normal']));
            const receipts = host.st.ctx.chat.at(-1).extra.storySuite.receipts;
            const craft = receipts.find(r => r.type === 'capture.craft');
            const check = receipts.find(r => r.type === 'capture.check');
            assert.ok(craft && check, 'both lines were read');
            assert.match(craft.summary, /d20/);
            assert.ok(craft.data.check);
            assert.match(check.summary, /d20/);
            assert.notEqual(craft.data.check, check.data.v2.result.check);
            assert.equal(Object.keys(host.head().domains.checks.log).length, 2);
            assert.deepEqual(host.turn.problems(), []);
        } finally {
            host.close();
        }
    });
});
