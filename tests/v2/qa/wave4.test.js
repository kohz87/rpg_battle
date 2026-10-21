// QA through Story Block's real bus: the wave-4 items and trade rules end to end — a story's use
// (MODULES §F96), the carry limit (§F39), a market shortage (§F36). Nothing is saved on a refusal.
import assert from 'node:assert/strict';
import { bytes, each, stacksOf, storyCoin, storyItem, withHero } from './helpers/harness.js';

const stackOf = (h, defId) => stacksOf(h, defId)[0]?.stack;

function hurt(h) {
    const r = h.capture({ op: '~', kind: 'wound', name: 'Ren', text: 'a fall', labels: { harm: 'wound' } });
    assert.equal(r.ok, true, r.message);
}

each('! use heals by the item\'s numbers through item.use\'s own path; the receipt is narrated', () => {
    const { h, pc } = withHero();
    const pot = storyItem(h, 'Minor Healing Draught', 2);
    hurt(h);
    const before = h.state().domains.party.actors[pc].hp.cur;
    const r = h.capture({ op: '!', kind: 'use', name: 'Minor Healing Draught', labels: {} });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.receipt.narrate, true);
    assert.equal(r.receipt.data.refused, false);
    assert.equal(h.state().domains.party.actors[pc].hp.cur, before + r.receipt.data.hp);
    assert.equal(stacksOf(h, pot)[0].qty, 1);
});

each('! use at full HP uses nothing and tells the story; the state is byte-identical but for the receipt\'s rev', () => {
    const { h } = withHero();
    const pot = storyItem(h, 'Minor Healing Draught', 1);
    const before = structuredClone(h.state().domains);
    const r = h.capture({ op: '!', kind: 'use', name: 'Minor Healing Draught', labels: {} });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.receipt.summary, 'Ren is at full HP; the Minor Healing Draught stays in the bag.');
    assert.equal(bytes(h.state().domains), bytes(before));
    assert.equal(stacksOf(h, pot)[0].qty, 1);
});

/** A fight started against a weak bandit; the hero holding draughts. */
function inFight(h) {
    assert.equal(h.capture({ op: '!', kind: 'encounter', name: 'Bandit', text: 'on the road', labels: { tier: 'weak' } }).ok, true);
    const started = h.command('combat.start', { offer: h.query('combat.offers').at(-1).id });
    assert.equal(started.ok, true, started.message);
}

each('! use during a fight is the fight\'s item action (combat.act), which takes the dose out at use', () => {
    const { h, pc } = withHero();
    const pot = storyItem(h, 'Minor Healing Draught', 2);
    inFight(h);
    const view = h.query('combat.session');
    assert.equal(view.actions.actor, view.combatants.find(c => c.name === 'Ren').id, 'Ren\'s turn');
    const actions = h.state().domains.combat.session.actions.length;
    const r = h.capture({ op: '!', kind: 'use', name: 'Minor Healing Draught', labels: { on: 'Ren' } });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.receipt.data.fight, true);
    assert.match(r.receipt.summary, /^Ren uses the Minor Healing Draught in the fight on Ren: /);
    const session = h.state().domains.combat.session;
    assert.equal(session.actions.length, actions + 1);
    assert.deepEqual(session.actions.at(-1).type, 'item');
    assert.equal(stacksOf(h, pot)[0].qty, 1, 'one dose taken out at use');
    assert.deepEqual(h.calls.filter(call => call.top === 'capture.use').map(call => call.type).filter(type => type === 'party.heal'), [], 'never party.heal during a fight');
    void pc;
});

each('! use during a fight with no fight action to take is a Problem and keeps the thing', () => {
    const { h } = withHero();
    const pot = storyItem(h, 'Minor Healing Draught', 2);
    storyItem(h, 'Rope', 1);
    inFight(h);
    const before = bytes(h.state());
    for (const [labels, name, message] of [
        [{ by: 'Lyra' }, 'Minor Healing Draught', /^It is Ren's turn in the fight, not Lyra's: the Minor Healing Draught stays in the bag\.$/],
        [{ qty: '2' }, 'Minor Healing Draught', /one dose is used per turn/],
        [{}, 'Rope', /^Ren has no Rope to use in the fight: it stays in the bag\.$/],
        [{ on: 'Mira' }, 'Minor Healing Draught', /cannot reach Mira in the fight now/],
    ]) {
        const r = h.capture({ op: '!', kind: 'use', name, labels });
        assert.equal(r.ok, false, name);
        assert.equal(r.code, 'REFUSED');
        assert.match(r.message, message);
        assert.equal(bytes(h.state()), before, 'nothing saved');
    }
    assert.equal(stacksOf(h, pot)[0].qty, 2);
});

each('carry limit: item.give to a companion who cannot carry it is refused; trade.buy too heavy pays nothing', () => {
    const { h } = withHero({ settings: { 'items.carrySize': 10 } });
    const joined = h.command('party.addCompanion', { name: 'Lyra', role: 'archer' });
    assert.equal(joined.ok, true, joined.message);
    const axe = storyItem(h, 'Great Axe', 1, 'two-handed, ATK +5');
    const before = bytes(h.state());
    const give = h.command('item.give', { stack: stackOf(h, axe), to: joined.receipt.data.actor });
    assert.equal(give.code, 'REFUSED', give.message);
    assert.match(give.message, /^Lyra cannot carry that:/);
    assert.equal(bytes(h.state()), before);
    storyCoin(h, 100000);
    const stock = h.query('trade.stock', { kind: 'general' });
    const supply = stock.items.find(item => item.def.kind !== 'equipment');
    const paid = bytes(h.state());
    const buy = h.command('trade.buy', { shop: stock.shop, def: supply.def.id, qty: 60 });
    assert.equal(buy.code, 'REFUSED', buy.message);
    assert.match(buy.message, /^The party cannot carry that:/);
    assert.equal(bytes(h.state()), paid, 'nothing paid');
});

each('! market Bluewatch raises the prices at Bluewatch Village; ~ market lifts it', () => {
    const { h } = withHero();
    const plain = h.query('trade.stock', { kind: 'general' }).items.map(item => item.price);
    const r = h.capture({ op: '!', kind: 'market', name: 'Bluewatch', text: 'blockade on the river', labels: { until: 'the bridge is cleared' } });
    assert.equal(r.ok, true, r.message);
    const dear = h.query('trade.stock', { kind: 'general' }).items.map(item => item.price);
    assert.ok(dear.every((price, index) => price >= plain[index]) && dear.some((price, index) => price > plain[index]));
    assert.equal(h.capture({ op: '~', kind: 'market', name: 'Bluewatch', text: 'supplies back', labels: {} }).ok, true);
    assert.deepEqual(h.query('trade.stock', { kind: 'general' }).items.map(item => item.price), plain);
    assert.equal(h.capture({ op: '~', kind: 'market', name: 'Bluewatch', text: 'again', labels: {} }).code, 'REFUSED');
});
