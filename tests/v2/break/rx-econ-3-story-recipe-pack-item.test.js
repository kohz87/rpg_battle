// rx-economy RX-E-3 (RB #89 crafting): a recipe the story teaches may name any item the packs or the
// inventory define as what it makes, from any materials. `+ recipe Quick Blade | makes: Iron Sword |
// with: River Fish | craft: smithing` (the pack prices the Iron Sword at 900, ATK 5; a River Fish is
// worth 1) is learned at DC 10 (the sword's rarity, common), and one fair roll makes an Iron Sword with
// the pack's stats (a masterwork: ATK 8 and +1 refinement) out of a fish. The story's own `+ item`
// lines are held to the reply's goods worth budget; the recipe path never meets it. (Ersveil: a
// Masterwork Cane-Blade, ATK 6, from one Burlap Sack worth 2.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { PACK, craftHost, qtyOf } from '../craft/helpers.js';

const EXTRA = { ...PACK, content: { ...PACK.content, items: [...PACK.content.items] } };

test('a story-taught recipe cannot make a 900-worth pack sword out of one fish', async () => {
    const host = await craftHost({ pack: EXTRA, goods: ['+ item River Fish | qty: 3'] });
    try {
        await host.send('Hollis shows me a trick.', host.reply('He shows you.', ['+ recipe Quick Blade | makes: Iron Sword | with: River Fish | craft: smithing | from: Hollis']));
        assert.ok(host.turn.problems().some(problem => /worth/.test(problem.message)), 'the recipe itself is refused');
        await host.send('I forge it.', host.reply('I try.', ['! craft Quick Blade | with: River Fish | roll: 1']));
        assert.equal(host.q('craft.log').length, 0);
        assert.equal(qtyOf(host, 'River Fish'), 3);
        const inv = host.head().domains.inventory;
        const swords = Object.values(inv.stacks).filter(stack => /Iron Sword/.test(inv.defs[stack.def]?.name ?? '') && (inv.defs[stack.def]?.stats?.ATK ?? 0) >= 5);
        assert.deepEqual(swords.map(stack => `${inv.defs[stack.def].name} ATK ${inv.defs[stack.def].stats.ATK} (worth ${inv.defs[stack.def].value})`), [],
            'a pack Iron Sword (900, ATK 5) was made from a River Fish worth 1');
    } finally { host.close(); }
});
