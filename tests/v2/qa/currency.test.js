// QA: one currency (MODULES §F1, §F20). A chat has one currency with one name (Story Block's
// setting; here "crowns"); amounts are whole numbers of it (v1's copper-based numbers as they
// are: 1 crown = the old copper). Every receipt summary that names money must say "<n> crowns"
// with n the wallet's change, never v1's copper/silver/gold tiers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { each, holdings, stacksOf, storyCoin, storyItem, winFight, withHero } from './helpers/harness.js';

// A number followed by a tier word ("8 copper"); an item called "Silver Ring" is not money.
const TIER_WORDS = /\d\s*(?:copper|silver|gold)\b/i;
const crowns = () => withHero({ seed: 4, coreSettings: { currency: 'crowns' } });

/** Every money-moving receipt in a short story: coins found, a fight's loot, a sale, a purchase, a commission. */
function story() {
    const { h } = crowns();
    storyCoin(h, 3000);
    const steps = [];
    const step = (label, fn) => {
        const before = holdings(h.state()).money;
        const r = fn();
        assert.equal(r.ok, true, `${label}: ${r.message}`);
        steps.push({ label, summary: r.receipt.summary, change: holdings(h.state()).money - before });
    };
    step('fight', () => winFight(h, 'Bandit').end);
    const pelt = storyItem(h, 'Wolf Pelt', 4);
    step('sell', () => h.command('trade.sell', { stack: stacksOf(h, pelt)[0].stack, qty: 1 }));
    const stock = h.query('trade.stock', { kind: 'apothecary' });
    step('buy', () => h.command('trade.buy', { shop: stock.shop, def: stock.items.find(i => i.def.kind !== 'equipment').def.id, qty: 1 }));
    step('commission', () => h.command('craft.commission', { piece: 'Pelt Cloak', materials: [{ stack: stacksOf(h, pelt)[0].stack, qty: 3 }], crafter: 'the tanner' }));
    return { h, steps };
}

each('Story Block\'s own money lines use the one currency: coins found, paid, received', () => {
    const { h } = crowns();
    const found = storyCoin(h, 30);
    assert.match(found.receipt.summary, /30 crowns/);
    // (wallet.pay is Story Block's internal command: since Story Block #76 a click is refused.)
    const paid = h.command('wallet.pay', { owner: 'party', amount: 12, note: 'the ferry' }, { cause: 'system' });
    assert.equal(paid.ok, true, paid.message);
    assert.match(paid.receipt.summary, /12 crowns/);
    assert.doesNotMatch(paid.receipt.summary, TIER_WORDS);
    const currency = h.query('inventory.currency');
    assert.deepEqual([currency.name, currency.short], ['crowns', 'c']);
});

each('wallets stay one whole number per owner under `coin` through trades and loot', () => {
    const { h } = story();
    for (const [owner, wallet] of Object.entries(h.state().domains.inventory.wallets)) {
        assert.deepEqual(Object.keys(wallet), ['coin'], owner);
        assert.ok(Number.isInteger(wallet.coin) && wallet.coin >= 0, owner);
    }
});

for (const label of ['fight', 'sell', 'buy', 'commission']) {
    each(`${label}: the receipt summary names the one currency and the wallet's own number`, () => {
        const { steps } = story();
        const { summary, change } = steps.find(entry => entry.label === label);
        assert.doesNotMatch(summary, TIER_WORDS, summary);
        assert.match(summary, new RegExp(`\\b${Math.abs(change)} crowns?\\b`), summary);
    });
}

test('one of the currency reads "1 crown", not "1 crowns"', { todo: 'v1 formatMoney (one currency) and Story Block\'s formatAmount both write `${n} ${name}`: "sold Wolf Pelt … for 1 crowns", "receives 1 crowns"' }, () => {
    const { h } = crowns();
    const one = storyCoin(h, 1);
    assert.doesNotMatch(one.receipt.summary, /\b1 crowns\b/, one.receipt.summary);
    const pelt = storyItem(h, 'Wolf Pelt', 1);
    const sold = h.command('trade.sell', { stack: stacksOf(h, pelt)[0].stack, qty: 1 });
    assert.doesNotMatch(sold.receipt.summary, /\b1 crowns\b/, sold.receipt.summary);
});

each('no part answers a `currency` hook with v1 tiers (F1: the one currency is Story Block\'s)', () => {
    const { h } = crowns();
    for (const hook of h.registry.hooks('currency')) {
        const answer = hook();
        assert.deepEqual(answer?.tiers ?? [], [], JSON.stringify(answer));
    }
});

each('an item the story names after the one currency is money worth 1 each; tier coins are not money', () => {
    const { h } = crowns();
    const coins = h.capture({ op: '+', kind: 'item', name: 'Crowns', labels: { qty: '5' } });
    assert.equal(coins.ok, true, coins.message);
    // Story Block since da54eaf takes a thing named for the currency into the wallet itself; before,
    // it was a money def (RPG Battle's item.define hook) worth 1 each.
    if (coins.receipt.data.def) {
        const def = h.state().domains.inventory.defs[coins.receipt.data.def];
        assert.deepEqual([def.kind, def.value], ['money', 1]);
    } else {
        assert.equal(coins.receipt.data.amount, 5);
        assert.equal(h.state().domains.inventory.wallets.party.coin, 5);
    }
    const silver = h.capture({ op: '+', kind: 'item', name: 'Silver Coins', labels: { qty: '2' } });
    assert.equal(silver.ok, true, silver.message);
    assert.notEqual(h.state().domains.inventory.defs[silver.receipt.data.def].kind, 'money', 'no tier coins in a one-currency chat');
});
