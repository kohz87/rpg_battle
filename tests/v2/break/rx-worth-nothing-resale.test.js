// Breaker lead (items/condition.js resaleOf): a piece's resale was held to "at least 1", and a thing
// code made worth 0 (a botched craft, one made of key items: `craft/…`, value 0) fell back to v1's
// guessed worth by name once its resale cap (`trade.paid`) was gone (pruned past MAX_PAID, an older
// chat): it reached a buyer and sold for coins made from nothing. Now a worth-0 thing sells for 0 to
// every buyer; key items stay unsellable; a piece that is worth something still fetches at least 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, planSell, sellEach, worthNothing } from '../../../src/v2/trade/core.js';
import { resaleOf } from '../../../src/v2/items/condition.js';
import { baseState } from '../trade/helpers/fake-ctx.js';

const BOTCHED = { id: 'craft/iron-sword-botched', name: 'Botched Iron Sword', kind: 'equipment', rarity: 'common', value: 0, stack: false, slot: 'weapon', stats: { ATK: -1 }, effect: {}, tags: ['junk'], note: '' };
const JUNK = { id: 'craft/salve-botched', name: 'Botched Salve', kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: ['junk'], note: '' };

function worldWith({ paid = {}, events = {} } = {}) {
    const state = baseState();
    const inv = state.domains.inventory;
    inv.defs[BOTCHED.id] = BOTCHED;
    inv.defs[JUNK.id] = JUNK;
    inv.stacks.it_0000000a = { id: 'it_0000000a', def: BOTCHED.id, qty: 1, owner: 'party', equipped: null };
    inv.stacks.it_0000000b = { id: 'it_0000000b', def: JUNK.id, qty: 3, owner: 'party', equipped: null };
    return makeWorld({ scene: state.domains.scene, inventory: inv, party: state.domains.party, trade: { ...state.domains.trade, paid }, gear: { events }, features: { wear: true, refine: true } });
}

test('resaleOf: a buyer paying nothing gives nothing; a piece worth something still fetches at least 1', () => {
    const worn = { cond: 20, low: 20, ever: 20, paid: 0, refine: 0 };
    assert.equal(resaleOf(0, worn), 0);
    assert.equal(resaleOf(-3, worn), 0);
    assert.equal(resaleOf(2, { cond: 5, low: 5, ever: 5, paid: 0, refine: 0 }), 1);
});

test('a thing code made worth nothing sells for 0 to every buyer, worn or not, with no resale cap left', () => {
    assert.equal(worthNothing(BOTCHED), true);
    assert.equal(worthNothing({ ...BOTCHED, id: 'story/iron-sword' }), false, 'the story\'s own things are priced by the item.define hook');
    // Worn, so its resale goes through resaleOf; no `trade.paid` cap (pruned, or an older chat).
    const world = worldWith({ events: { 'it_0000000a#3': { stack: 'it_0000000a', wear: 40 } } });
    for (const buyer of ['general', 'smith', 'fence']) assert.equal(sellEach(BOTCHED, buyer, world), 0, buyer);
    for (const [stack, qty] of [['it_0000000a', 1], ['it_0000000b', 3]]) {
        for (const kind of ['general', 'smith', 'fence']) {
            const plan = planSell(world, { stack, qty, kind });
            assert.ok(!plan.ok || plan.total === 0, `${stack} to ${kind}: ${plan.total}`);
        }
    }
});

test('key items stay unsellable, and an ordinary thing still sells', () => {
    const world = worldWith();
    const rope = planSell(world, { stack: 'it_00000005', qty: 1, kind: 'general' });
    assert.equal(rope.ok, true, rope.message);
    assert.ok(rope.total > 0);
    world.inventory.stacks.it_00000005.key = true;
    const key = planSell(world, { stack: 'it_00000005', qty: 1, kind: 'general' });
    assert.equal(key.ok, false);
    assert.match(key.message, /key item/);
});
