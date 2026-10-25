// The recipe modifier, the actual SD result and RB's quality decision must agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModule as director } from '../../../../Story_director/src/v2/module.js';
import { craftHost, PACK, qtyOf } from './helpers.js';
import { qualityOf, statsModifier } from '../../../src/v2/craft/rules.js';

test('craft: the real SD roll uses RB recipe stats, tools, rank, station and material quality; rollback includes its die', async () => {
    const pack = structuredClone(PACK);
    pack.content.recipes[0].stat = 'STR+DEX';
    const host = await craftHost({ pack, modules: [director()], goods: ['+ item Iron Ore | qty: 3', '+ item Ember Salt', '+ item Smith Tools'] });
    try {
        await host.send('Learn.', host.reply('Hollis teaches.', ['+ recipe Iron Sword | from: Hollis']));
        const pc = host.q('party.pc');
        const expected = host.q('rules.modifier', { actor: pc.id, stat: 'STR', skill: 'craft smithing', craft: { recipe: 'pack.crafty/iron-sword' } });
        assert.equal(expected.parts[0].amount, statsModifier(pc, ['STR', 'DEX']));
        assert.ok(expected.parts.some(part => part.source === 'item' && part.amount === 1));
        assert.equal(expected.amount, expected.parts.reduce((sum, part) => sum + part.amount, 0));
        await host.send('Forge.', host.reply('Mara works.', ['! craft Iron Sword | by: Ren | roll: 20']));
        const made = host.q('craft.log').at(-1);
        assert.ok(made, JSON.stringify(host.turn.problems()));
        const rolled = host.head().domains.checks.log[made.check];
        assert.equal(rolled.die, made.die);
        assert.equal(rolled.mod, expected.amount);
        assert.equal(made.total, rolled.total);
        assert.equal(made.dc, rolled.dc);
        assert.equal(made.quality, qualityOf(rolled.die, rolled.total, rolled.dc));
        assert.equal(Object.keys(host.head().domains.checks.log).length, 1);
        assert.deepEqual(host.turn.problems(), []);
        const before = structuredClone(host.head());
        await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
        host.store.rebuild();
        assert.deepEqual(host.head(), before);
        assert.deepEqual(host.store.problems(), []);
        await host.swipe('No crafting.');
        assert.equal(host.q('craft.log').length, 0);
        assert.equal(Object.keys(host.head().domains.checks.log).length, 0);
        assert.equal(qtyOf(host, 'Iron Ore'), 3);
    } finally { host.close(); }
});
