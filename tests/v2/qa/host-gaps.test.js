// QA: RPG Battle on each host's bus exactly as vendored (no shim). What a handler's ctx carries:
//   * ctx.rev (MODULES §F2): Story Block `v2` (host 'sb') does not give it; RPG Battle's
//     module.js works it out itself (the `rpg-battle.rev` query), so offers, `beaten` and
//     bestiary rows get the right rev on both hosts.
//   * ctx.caller (read by Story Block's own inventory.grant to tell a sub-command from a button):
//     not given on 'sb', so every grant made inside a ui command is refused there. Story Block's
//     `v2-int` (host 'int', the runtime RPG Battle's integration vendors) gives it.
// The todos are on 'sb' only and go away when Story Block's v2 takes in v2-int's bus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytes, createHarness, each, fightOut, patch } from './helpers/harness.js';

const sbOnly = reason => host => (host === 'sb' ? { todo: reason } : {});

function rawHero(host, seed = 1) {
    const h = createHarness({ host, shim: false, seed });
    assert.equal(h.command('party.create', { name: 'Ren', preset: 'fighter' }).ok, true);
    assert.equal(h.command('scene.place', { name: 'Bluewatch Village', kind: 'settlement' }).ok, true);
    assert.equal(h.capture({ op: '+', kind: 'coin', name: '500', labels: {} }).ok, true);
    return h;
}

function probe(host) {
    const h = createHarness({ host, shim: false });
    let seen = null;
    h.registry.register({ id: 'qa-probe', commands: { 'qa.probe': ctx => { seen = { rev: ctx.rev, caller: ctx.caller }; return { summary: '' }; } } });
    assert.equal(h.command('qa.probe', {}).ok, true);
    return seen;
}

test('[sb] Story Block v2\'s bus gives handlers no ctx.rev and no ctx.caller', () => {
    assert.deepEqual(probe('sb'), { rev: undefined, caller: undefined });
});

test('[int] Story Block v2-int\'s bus gives ctx.rev (head rev + 1) and ctx.caller (null at the top)', () => {
    assert.deepEqual(probe('int'), { rev: 1, caller: null });
});

each('without a host ctx.rev, module.js still gives the parts the receipt\'s rev (offers, beaten, join offers)', host => {
    const h = rawHero(host, 4);
    const offer = h.capture({ op: '!', kind: 'encounter', name: 'Cellar Rat', text: '', labels: { tier: 'weak' } });
    assert.equal(offer.ok, true, `${offer.code}: ${offer.message}`);
    assert.equal(h.state().domains.combat.offers[0].rev, offer.receipt.rev);
    const join = h.capture({ op: '+', kind: 'join', name: 'Lyra', text: 'the archer', labels: { level: '2', role: 'ranger' } });
    assert.equal(join.ok, true, join.message);
    assert.equal(h.state().domains.party.offers[0].rev, join.receipt.rev);
    assert.equal(h.command('combat.start', { offer: h.state().domains.combat.offers[0].id }).ok, true);
    fightOut(h);
    const end = h.command('combat.end');
    if (end.ok) assert.equal(h.state().domains.combat.last.rev, end.receipt.rev);
});

each('trade.buy (a click) gets the bought thing through inventory.grant', sbOnly('inventory.grant refuses unless ctx.caller || cause is story/system; the sb bus never sets ctx.caller, so trade.buy → REFUSED "Items cannot be handed out from a button"'), host => {
    const h = rawHero(host);
    const stock = h.query('trade.stock', { kind: 'general' });
    const before = bytes(h.state());
    const r = h.command('trade.buy', { shop: stock.shop, def: stock.items[0].def.id, qty: 1 });
    assert.equal(r.ok, true, `${r.code}: ${r.message}`);
    assert.notEqual(bytes(h.state()), before);
});

each('craft.collect (a click) hands the finished piece over', sbOnly('same as trade.buy: craft.collect → inventory.grant → REFUSED'), host => {
    const h = rawHero(host);
    assert.equal(h.capture({ op: '+', kind: 'item', name: 'Wolf Pelt', labels: { qty: '3' } }).ok, true);
    const pelt = h.query('inventory.items').find(row => row.name === 'Wolf Pelt').stack;
    const order = h.command('craft.commission', { piece: 'Pelt Cloak', materials: [{ stack: pelt, qty: 3 }], crafter: 'the tanner' });
    assert.equal(order.ok, true, order.message);
    const r = h.command('craft.collect', { order: order.receipt.data.order });
    assert.equal(r.ok, true, `${r.code}: ${r.message}`);
});

each('a won fight\'s loot reaches the inventory (combat.end is a click)', sbOnly('combat.end → inventory.grant → REFUSED'), host => {
    const h = rawHero(host, 4);
    patch(h, s => { s.domains.combat.offers.push({ id: 'en_00000001', foes: [{ name: 'Bandit', count: 1, tier: 'weak' }], stakes: 'normal', place: '', rev: 1 }); });
    assert.equal(h.command('combat.start', { offer: 'en_00000001' }).ok, true);
    fightOut(h);
    const end = h.command('combat.end');
    assert.equal(end.ok, true, `${end.code}: ${end.message}`);
    assert.ok(end.receipt.data.loot.items.length > 0);
});
