// QA: conservation. No item or coin is made or lost except by an explicit grant or payment with
// a cause (a receipt): a sale swaps goods for exactly the quoted money, a purchase money for
// exactly the quoted goods, using a dose takes one, giving and wearing move nothing in or out,
// a fight's loot is exactly what its receipt lists, a draught drunk in a fight leaves the
// inventory when it is drunk. Known leaks are `todo`.
import assert from 'node:assert/strict';
import { bytes, fightOut, holdings, stacksOf, storyCoin, storyItem, winFight, withHero, each } from './helpers/harness.js';

const stackOf = (h, defId) => stacksOf(h, defId)[0]?.stack;

function delta(before, after) {
    const goods = {};
    for (const def of new Set([...Object.keys(before.goods), ...Object.keys(after.goods)])) {
        const d = (after.goods[def] ?? 0) - (before.goods[def] ?? 0);
        if (d) goods[def] = d;
    }
    return { goods, money: after.money - before.money };
}

each('trade.sell: goods −qty, money +the quoted total, nothing else', () => {
    const { h } = withHero();
    const pelt = storyItem(h, 'Wolf Pelt', 5);
    storyCoin(h, 10);
    const quote = h.query('trade.quote', { type: 'sell', stack: stackOf(h, pelt), qty: 3 });
    assert.equal(quote.ok, true, quote.message);
    assert.equal(quote.total, quote.each * 3);
    const before = holdings(h.state());
    const r = h.command('trade.sell', { stack: stackOf(h, pelt), qty: 3 });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(delta(before, holdings(h.state())), { goods: { [pelt]: -3 }, money: quote.total });
    assert.equal(r.receipt.data.total, quote.total);
});

each('trade.buy: money −the quoted total, goods +qty, nothing else', () => {
    const { h } = withHero();
    storyCoin(h, 1000);
    const stock = h.query('trade.stock', { kind: 'apothecary' });
    const item = stock.items.find(entry => entry.def.kind !== 'equipment');
    const quote = h.query('trade.quote', { type: 'buy', shop: stock.shop, def: item.def.id, qty: 3 });
    assert.equal(quote.ok, true, quote.message);
    const before = holdings(h.state());
    const r = h.command('trade.buy', { shop: stock.shop, def: item.def.id, qty: 3 });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(delta(before, holdings(h.state())), { goods: { [item.def.id]: 3 }, money: -quote.total });
});

each('trade.buy without the money: NOT_ENOUGH and the state byte-identical', () => {
    const { h } = withHero();
    storyCoin(h, 1);
    const stock = h.query('trade.stock', { kind: 'smith' });
    const dear = stock.items.find(entry => entry.price > 1);
    const before = bytes(h.state());
    const r = h.command('trade.buy', { shop: stock.shop, def: dear.def.id, qty: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NOT_ENOUGH');
    assert.equal(bytes(h.state()), before);
});

each('craft.commission takes the materials and the fee; craft.collect gives exactly one piece', () => {
    const { h } = withHero();
    storyCoin(h, 3000);
    const pelt = storyItem(h, 'Wolf Pelt', 4);
    const payload = { piece: 'Pelt Cloak', materials: [{ stack: stackOf(h, pelt), qty: 3 }], crafter: 'the tanner' };
    const quote = h.query('trade.quote', { type: 'commission', ...payload });
    assert.equal(quote.ok, true, quote.message);
    const before = holdings(h.state());
    const order = h.command('craft.commission', payload);
    assert.equal(order.ok, true, order.message);
    assert.deepEqual(delta(before, holdings(h.state())), { goods: { [pelt]: -3 }, money: -quote.fee });
    const mid = holdings(h.state());
    const got = h.command('craft.collect', { order: order.receipt.data.order });
    assert.equal(got.ok, true, got.message);
    const d = delta(mid, holdings(h.state()));
    assert.equal(d.money, 0);
    assert.deepEqual(Object.values(d.goods), [1]);
    const again = h.command('craft.collect', { order: order.receipt.data.order });
    assert.equal(again.ok, false, 'collected once only');
});

each('item.use takes exactly one dose; item.give, item.equip, item.unequip move nothing in or out', () => {
    const { h, pc } = withHero();
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer' }).receipt.data.actor;
    const pot = storyItem(h, 'Minor Healing Draught', 3);
    const sword = storyItem(h, 'Iron Sword', 1, 'ATK +2');
    h.capture({ op: '~', kind: 'wound', name: 'Ren', text: 'a fall', labels: { harm: 'wound' } });
    let before = holdings(h.state());
    assert.equal(h.command('item.use', { stack: stackOf(h, pot), target: pc }).ok, true);
    assert.deepEqual(delta(before, holdings(h.state())), { goods: { [pot]: -1 }, money: 0 });
    before = holdings(h.state());
    for (const [type, payload] of [
        ['item.give', { stack: stackOf(h, pot), to: lyra, qty: 1 }],
        ['item.equip', { stack: stackOf(h, sword) }],
        ['item.give', { stack: stackOf(h, sword), to: lyra }],
        ['item.equip', { stack: stackOf(h, sword) }],
        ['item.unequip', { stack: stackOf(h, sword) }],
    ]) {
        const r = h.command(type, payload);
        assert.equal(r.ok, true, `${type}: ${r.message}`);
        assert.deepEqual(delta(before, holdings(h.state())), { goods: {}, money: 0 }, type);
    }
});

each('combat.end (won): the inventory gains exactly the loot its receipt lists, from that receipt', () => {
    for (const seed of [4, 6, 7]) {
        const { h } = withHero({ seed });
        const before = holdings(h.state());
        const { end } = winFight(h, 'Bandit');
        assert.equal(end.ok, true, end.message);
        assert.equal(end.receipt.data.outcome, 'won');
        const d = delta(before, holdings(h.state()));
        assert.equal(d.money, end.receipt.data.loot.money, `seed ${seed} money`);
        const names = Object.fromEntries(Object.entries(d.goods).map(([def, n]) => [h.state().domains.inventory.defs[def].name, n]));
        assert.deepEqual(names, Object.fromEntries(end.receipt.data.loot.items.map(item => [item.name, item.qty])), `seed ${seed} goods`);
        for (const stack of Object.values(h.state().domains.inventory.stacks)) assert.equal(stack.from, end.receipt.id);
    }
});

each('combat.end (lost or fled): nothing gained', () => {
    const { h } = withHero({ seed: 1 });
    const before = holdings(h.state());
    h.capture({ op: '!', kind: 'encounter', name: '3 Cellar Rats', text: '', labels: { tier: 'weak' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers')[0].id }).ok, true);
    fightOut(h);
    const end = h.command('combat.end');
    assert.equal(end.ok, true, end.message);
    assert.notEqual(end.receipt.data.outcome, 'won');
    assert.deepEqual(delta(before, holdings(h.state())), { goods: {}, money: 0 });
});

// ---------- fixed leaks (QA #75) ----------

/** A fight in which Ren drinks the party's only draught, then the draught's stack is sold. */
function drinkThenSell() {
    const { h, pc } = withHero({ seed: 3 });
    const pot = storyItem(h, 'Minor Healing Draught', 1);
    h.capture({ op: '!', kind: 'encounter', name: '2 Cellar Rats', text: '', labels: { tier: 'weak' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers')[0].id }).ok, true);
    assert.equal(h.command('combat.act', { action: { type: 'defend' } }).ok, true);
    assert.equal(h.command('combat.act', { action: { type: 'item', item: 'Minor Healing Draught', target: pc } }).ok, true);
    const sold = h.command('trade.sell', { stack: stackOf(h, pot), qty: 1 });
    return { h, pot, sold };
}

each('a draught drunk in a running fight cannot also be sold before the fight ends', () => {
    const { h, pot, sold } = drinkThenSell();
    assert.equal(sold.ok, false, 'the draught left the inventory when it was drunk');
    assert.deepEqual(stacksOf(h, pot), []);
});

each('a fight whose drunk draught was sold meanwhile can still be settled', () => {
    const { h } = drinkThenSell();
    fightOut(h);
    const end = h.command('combat.end');
    assert.equal(end.ok, true, `${end.code}: ${end.message}`);
});

each('a draught sold after the fight began cannot then be drunk in it (and the fight still settles)', () => {
    const { h, pc } = withHero({ seed: 3 });
    const pot = storyItem(h, 'Minor Healing Draught', 1);
    storyCoin(h, 10);
    h.capture({ op: '!', kind: 'encounter', name: '2 Cellar Rats', text: '', labels: { tier: 'weak' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers')[0].id }).ok, true);
    const sold = h.command('trade.sell', { stack: stackOf(h, pot), qty: 1 });
    assert.equal(sold.ok, true, sold.message);
    const before = bytes(h.state());
    const drink = h.command('combat.act', { action: { type: 'item', item: 'Minor Healing Draught', target: pc } });
    assert.equal(drink.ok, false);
    assert.equal(drink.code, 'REFUSED');
    assert.match(drink.message, /no Minor Healing Draught left/);
    assert.equal(bytes(h.state()), before, 'nothing saved');
    fightOut(h);
    assert.equal(h.command('combat.end').ok, true);
});

each('a companion who leaves does not take the party\'s things into nowhere', () => {
    const { h } = withHero();
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer' }).receipt.data.actor;
    const pot = storyItem(h, 'Minor Healing Draught', 2);
    assert.equal(h.command('item.give', { stack: stackOf(h, pot), to: lyra, qty: 2 }).ok, true);
    assert.equal(h.command('wallet.receive', { owner: lyra, amount: 25 }, { cause: 'story' }).ok, true);
    const before = holdings(h.state());
    const left = h.command('party.removeCompanion', { actor: lyra });
    assert.equal(left.ok, true, left.message);
    assert.deepEqual(left.receipt.data.handed, { stacks: 1, coin: 25 });
    const party = h.state().domains.party;
    const inv = h.state().domains.inventory;
    const orphans = Object.values(inv.stacks).filter(stack => stack.owner !== 'party' && !party.actors[stack.owner]);
    assert.deepEqual(orphans.map(stack => [stack.def, stack.qty, stack.owner]), []);
    assert.equal(inv.wallets[lyra]?.coin ?? 0, 0, 'no coin left with Lyra');
    assert.deepEqual(holdings(h.state()), before, 'nothing made or lost');
    assert.equal(stacksOf(h, pot).find(row => row.owner === 'party')?.qty, 2);
});

each('remaking your character (party.create replace) keeps what the old one carried within reach', () => {
    const { h, pc } = withHero();
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer' }).receipt.data.actor;
    const sword = storyItem(h, 'Iron Sword', 1, 'ATK +2');
    assert.equal(h.command('item.give', { stack: stackOf(h, sword), to: lyra }).ok, true);
    assert.equal(h.command('item.give', { stack: stackOf(h, sword), to: pc }).ok, true);
    assert.equal(h.command('wallet.receive', { owner: pc, amount: 40 }, { cause: 'story' }).ok, true);
    const before = holdings(h.state());
    assert.equal(h.command('party.create', { name: 'Astra', preset: 'fighter', replace: true }).ok, true);
    const party = h.state().domains.party;
    const inv = h.state().domains.inventory;
    const orphans = Object.values(inv.stacks).filter(stack => stack.owner !== 'party' && !party.actors[stack.owner]);
    assert.deepEqual(orphans.map(stack => stack.def), []);
    assert.equal(inv.wallets[pc]?.coin ?? 0, 0, 'the old character\'s purse went to the bag');
    assert.deepEqual(holdings(h.state()), before);
    assert.equal(stacksOf(h, sword)[0].owner, 'party');
});

each('a click cannot mint money any more than it can mint items', { todo: 'Story Block refuses inventory.grant from a ui command (REFUSED) but wallet.receive has no such rule: sdk.command("wallet.receive", { owner: "party", amount: 100000 }) from any button commits "The party receives 100000 gold"' }, () => {
    const { h } = withHero();
    const item = h.command('inventory.grant', { name: 'Excalibur', qty: 1, owner: 'party' });
    assert.equal(item.code, 'REFUSED', 'items: refused from a click');
    const before = bytes(h.state());
    const money = h.command('wallet.receive', { owner: 'party', amount: 100000 });
    assert.equal(money.ok, false, 'money: the same rule');
    assert.equal(bytes(h.state()), before);
});
