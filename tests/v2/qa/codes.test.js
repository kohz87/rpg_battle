// QA: rejection codes (MODULES §F4: REFUSED for a rule refusal — full HP, wrong place, slot
// limit, not ready — and INVALID for a malformed payload), and every rejection leaves the state
// byte-identical (SPEC §3.2: any throw rejects the whole command).
import assert from 'node:assert/strict';
import { bytes, stacksOf, storyCoin, storyItem, withHero, each, equipsOnInt } from './helpers/harness.js';
import { DIRECTOR_PEER } from '../integration/helpers/peer.js';

const stackOf = (h, defId) => stacksOf(h, defId)[0]?.stack;

/** Runs a command that must be rejected; checks the state did not move by a byte. */
function rejected(h, type, payload) {
    const before = bytes(h.state());
    const r = h.command(type, payload);
    assert.equal(r.ok, false, `${type} ${JSON.stringify(payload)} was accepted`);
    assert.equal(bytes(h.state()), before, `${type}: the state changed on a rejection`);
    return r;
}

each('item.use at full HP with nothing to cure: REFUSED, nothing spent', () => {
    const { h } = withHero();
    const pot = storyItem(h, 'Minor Healing Draught', 1);
    assert.equal(rejected(h, 'item.use', { stack: stackOf(h, pot) }).code, 'REFUSED');
});

each('item.equip of a piece with a generic old slot (a worn hood): REFUSED with the choice until the reader names a slot', equipsOnInt, () => {
    const { h } = withHero();
    const boots = storyItem(h, 'Leather Boots', 1, 'AGI +1, slot: feet');
    const hood = storyItem(h, 'Hood', 1, 'worn, DEF +1');
    assert.equal(h.command('item.equip', { stack: stackOf(h, boots) }).ok, true);
    const before = bytes(h.state());
    const refused = rejected(h, 'item.equip', { stack: stackOf(h, hood) });
    assert.equal(refused.code, 'REFUSED');
    assert.match(refused.message, /Choose where to wear it: Head, Body, Legs or Feet/);
    assert.equal(bytes(h.state()), before);
    assert.equal(h.command('item.equip', { stack: stackOf(h, hood), targetSlot: 'head' }).ok, true);
});

each('item.equip of an off-hand beside a two-handed weapon: REFUSED', equipsOnInt, () => {
    const { h } = withHero();
    const great = storyItem(h, 'Greatsword', 1, 'ATK +5, two-handed');
    const shield = storyItem(h, 'Wooden Shield', 1, 'DEF +2');
    assert.equal(h.command('item.equip', { stack: stackOf(h, great) }).ok, true);
    assert.equal(rejected(h, 'item.equip', { stack: stackOf(h, shield) }).code, 'REFUSED');
});

each('trade where there is no market (wrong place): REFUSED', () => {
    const { h } = withHero({ place: { name: 'The Deep Wood', kind: 'wild' } });
    const pelt = storyItem(h, 'Wolf Pelt', 1);
    assert.equal(rejected(h, 'trade.sell', { stack: stackOf(h, pelt), qty: 1 }).code, 'REFUSED');
});

each('craft.collect before the piece is ready: REFUSED', () => {
    // A story clock (Story Director's query) so a commission has a ready time.
    let minutes = 600;
    const { h } = withHero({ modules: [{ ...DIRECTOR_PEER, queries: { 'director.time': () => ({ minutes }) } }] });
    storyCoin(h, 3000);
    const pelt = storyItem(h, 'Wolf Pelt', 3);
    const order = h.command('craft.commission', { piece: 'Pelt Cloak', materials: [{ stack: stackOf(h, pelt), qty: 3 }], crafter: 'the tanner' });
    assert.equal(order.ok, true, order.message);
    assert.ok(order.receipt.data.ready > minutes, 'it has a ready time');
    const r = rejected(h, 'craft.collect', { order: order.receipt.data.order });
    minutes = order.receipt.data.ready;
    assert.equal(h.command('craft.collect', { order: order.receipt.data.order }).ok, true, 'collected once ready');
    assert.equal(r.code, 'REFUSED');
});

each('craft.collect before ready leaves no claim behind (the order can still be collected later)', () => {
    let minutes = 600;
    const { h } = withHero({ modules: [{ ...DIRECTOR_PEER, queries: { 'director.time': () => ({ minutes }) } }] });
    storyCoin(h, 3000);
    const pelt = storyItem(h, 'Wolf Pelt', 3);
    const order = h.command('craft.commission', { piece: 'Pelt Cloak', materials: [{ stack: stackOf(h, pelt), qty: 3 }], crafter: 'the tanner' });
    rejected(h, 'craft.collect', { order: order.receipt.data.order });
    assert.equal(h.state().meta.claims[`order:${order.receipt.data.order}:collected`], undefined);
    minutes = order.receipt.data.ready;
    assert.equal(h.command('craft.collect', { order: order.receipt.data.order }).ok, true);
});

each('malformed payloads are rejected (INVALID / NOT_FOUND), never thrown, and change nothing', () => {
    const { h, pc } = withHero();
    const pot = storyItem(h, 'Minor Healing Draught', 2);
    storyCoin(h, 100);
    const stock = h.query('trade.stock', { kind: 'general' });
    const cases = [
        ['item.use', { stack: 42 }], ['item.use', { stack: stackOf(h, pot), target: 'ac_zzzzzzzz' }], ['item.use', null],
        ['item.give', { stack: stackOf(h, pot), to: pc, qty: 1.5 }], ['item.give', { stack: stackOf(h, pot), to: 'party' }],
        ['item.equip', { stack: stackOf(h, pot) }], ['item.unequip', { stack: stackOf(h, pot) }],
        ['trade.sell', { stack: stackOf(h, pot), qty: 0 }], ['trade.sell', { stack: stackOf(h, pot), qty: 2.5 }], ['trade.sell', { stack: stackOf(h, pot), qty: 99 }],
        ['trade.sell', { stack: stackOf(h, pot), qty: -1 }], ['trade.sell', { stack: stackOf(h, pot), qty: Number.NaN }],
        ['trade.buy', { shop: stock.shop, def: stock.items[0].def.id, qty: 0 }], ['trade.buy', { shop: stock.shop, def: 'trade/nothing', qty: 1 }],
        ['trade.buy', { shop: 'elsewhere|general', def: stock.items[0].def.id, qty: 1 }], ['trade.buy', { shop: stock.shop, def: stock.items[0].def.id, qty: 1e9 }],
        ['craft.commission', { piece: '', materials: [], crafter: 'smith' }], ['craft.commission', { piece: 'Blade', materials: [{ stack: stackOf(h, pot), qty: 1 }], crafter: 'baker' }],
        ['craft.collect', { order: 'or_nope0000' }],
        ['party.spend', { points: { STR: 1.5 } }], ['party.spend', { points: { XYZ: 1 } }], ['party.spend', { points: { STR: -2 } }],
        ['party.rest', { kind: 'nap' }], ['party.grantXp', { amount: 2.5 }], ['party.grantXp', { amount: -10 }], ['party.grantXp', {}],
        ['party.heal', { actor: pc, hp: 0.5 }], ['party.addCompanion', { name: '' }], ['party.addCompanion', { name: 'Lyra', level: 0.5 }],
        ['check.resolve', { skill: 'stealth', dc: 'impossible-ish' }], ['check.resolve', { skill: 'stealth', dc: 99 }],
        ['combat.start', { offer: 'en_nothing0' }], ['combat.act', { action: { type: 'attack' } }], ['combat.end', {}], ['combat.dismiss', { offer: 'x' }],
    ];
    for (const [type, payload] of cases) {
        const r = rejected(h, type, payload);
        assert.ok(['INVALID', 'NOT_FOUND', 'NOT_ENOUGH', 'REFUSED', ...(type === 'check.resolve' ? ['UNKNOWN_COMMAND'] : [])].includes(r.code), `${type} ${JSON.stringify(payload)} → ${r.code}: ${r.message}`);
        assert.equal(typeof r.message, 'string');
        assert.ok(r.message.length > 0 && !/undefined|\[object/.test(r.message), `${type}: a plain message (${r.message})`);
    }
});
