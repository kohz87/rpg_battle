// F104: the money scale comes from the pack. Story Block's `inventory.economy` → { scale } multiplies
// RPG Battle's own default money (a foe's coin, rules.moneyByRank): whole, at least 1. The scale is
// read when the fight starts and kept in its setup, so the fight's end pays the same however the
// packs change in between; without the query (an older host) it is 1 and nothing changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withHero, winFight } from '../qa/helpers/harness.js';
import { moneyScale, scaledMoney } from '../../../src/v2/combat/setup.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

/** A won fight against bandits, using Story Block's real economy query and reader setting. */
function lootWith(scale, seed = 3) {
    const { h } = withHero({ host: 'int', seed, coreSettings: { economyScale: scale ?? '0' } });
    const { end, status } = winFight(h, '3 Bandit', { tier: 'trivial' });
    assert.equal(status, 'won');
    assert.equal(end.ok, true, end.message);
    return { money: end.receipt.data.loot.money, h };
}

const plain = lootWith(null).money;

test('Story Block defaults to scale 1 when no reader or pack scale is set', () => {
    assert.ok(plain > 0, 'bandits drop coin');
    assert.equal(lootWith(1).money, plain);
});

test('scale 0.1: the foes\' coin is a tenth, whole, at least 1', () => {
    assert.equal(lootWith(0.1).money, Math.max(1, Math.round(plain * 0.1)));
});

test('scale 10: the foes\' coin is ten times as much', () => {
    assert.equal(lootWith(10).money, plain * 10);
});

test('the scale is kept in the fight\'s setup when it starts (moneyScale), not read again at its end', () => {
    const coreSettings = { economyScale: 10 };
    const { h } = withHero({ host: 'int', seed: 3, coreSettings });
    h.capture({ op: '!', kind: 'encounter', name: '3 Bandit', text: '', labels: { tier: 'trivial' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers').at(-1).id }).ok, true);
    assert.equal(sessionOf(h.state().domains.combat).setup.moneyScale, 10);
    coreSettings.economyScale = 0.1;
    assert.equal(h.query('inventory.economy').scale, 0.1, 'the live setting changed');
    while (h.query('combat.session').status === 'active') h.command('combat.act', { action: { type: 'auto' } });
    assert.equal(h.command('combat.end').receipt.data.loot.money, plain * 10);
});

test('moneyScale reads { scale } (a positive number) and falls back to 1; scaledMoney rounds, at least 1', () => {
    const ctx = answer => ({ query: () => answer });
    assert.equal(moneyScale(ctx({ scale: 0.1 })), 0.1);
    assert.equal(moneyScale(ctx({ scale: 10 })), 10);
    for (const answer of [undefined, null, {}, { scale: 0 }, { scale: -2 }, { scale: 'lots' }]) assert.equal(moneyScale(ctx(answer)), 1, JSON.stringify(answer));
    assert.equal(moneyScale({ query: () => { throw new Error('no such query'); } }), 1);
    assert.equal(scaledMoney(7, 0.1), 1);
    assert.equal(scaledMoney(26, 0.1), 3);
    assert.equal(scaledMoney(7, 10), 70);
    assert.equal(scaledMoney(0, 10), 0, 'no coin stays none');
    assert.equal(scaledMoney(7), 7);
});
