// F104: the money scale comes from the pack. Story Block's `inventory.economy` → { scale } multiplies
// RPG Battle's own default money (a foe's coin, rules.moneyByRank): whole, at least 1. The scale is
// read when the fight starts and kept in its setup, so the fight's end pays the same however the
// packs change in between; without the query (an older host) it is 1 and nothing changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withHero, winFight } from '../qa/helpers/harness.js';
import { moneyScale, scaledMoney } from '../../../src/v2/combat/setup.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

/** A won fight against bandits (they carry coin), with a pack scale (null: no inventory.economy query). */
function lootWith(scale, seed = 3) {
    const { h } = withHero({ seed });
    if (scale !== null) {
        h.registry.register({ id: 'economy-test', name: 'Economy test', version: '1.0.0', queries: { 'inventory.economy': () => ({ scale }) } });
    }
    const { end, status } = winFight(h, '3 Bandit', { tier: 'trivial' });
    assert.equal(status, 'won');
    assert.equal(end.ok, true, end.message);
    return { money: end.receipt.data.loot.money, h };
}

const plain = lootWith(null).money;

test('without inventory.economy the loot coin is as before (scale 1)', () => {
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
    const { h } = withHero({ seed: 3 });
    let scale = 10;
    h.registry.register({ id: 'economy-test', name: 'Economy test', version: '1.0.0', queries: { 'inventory.economy': () => ({ scale }) } });
    h.capture({ op: '!', kind: 'encounter', name: '3 Bandit', text: '', labels: { tier: 'trivial' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers').at(-1).id }).ok, true);
    assert.equal(sessionOf(h.state().domains.combat).setup.moneyScale, 10);
    scale = 0.1;
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
