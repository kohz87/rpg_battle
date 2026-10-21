// QA: a finished fight can always be settled. combat.end makes several calls in one transaction
// (party.applyResult, inventory.consume, party.grantXp, inventory.grant, wallet.receive); if any
// callee refuses, the whole end is refused, and since the session stays over-but-unsettled,
// combat.start refuses every new fight too ("Finish the last fight first."). Each todo is a way
// to get there with ordinary commands; the found-by-fuzz ones came from fuzz.test.js.
import assert from 'node:assert/strict';
import { fightOut, stacksOf, storyItem, winFight, withHero, each } from './helpers/harness.js';

function startBandit(h) {
    h.capture({ op: '!', kind: 'encounter', name: 'Bandit', text: '', labels: { tier: 'weak' } });
    const start = h.command('combat.start', { offer: h.query('combat.offers').at(-1).id });
    assert.equal(start.ok, true, start.message);
}

function endsAndAllowsANewFight(h) {
    const end = h.command('combat.end');
    assert.equal(end.ok, true, `combat.end: ${end.code} ${end.message}`);
    h.capture({ op: '!', kind: 'encounter', name: 'Cellar Rat', text: '', labels: { tier: 'weak' } });
    const next = h.command('combat.start', { offer: h.query('combat.offers').at(-1).id });
    assert.equal(next.ok, true, `next fight: ${next.message}`);
}

each('a plain won fight settles and the next one can start (the baseline)', () => {
    const { h } = withHero({ seed: 4 });
    startBandit(h);
    fightOut(h);
    endsAndAllowsANewFight(h);
});

each('a won fight with a companion at the level cap settles', { todo: 'found by fuzz (seed 124): combat.end sends party.grantXp { actor, amount: 3 } for a companion at level 99; grantXp counts 0 for a capped member and refuses "There is no XP to give" (REFUSED), so combat.end is refused for good' }, () => {
    const { h } = withHero({ seed: 4 });
    assert.equal(h.command('party.addCompanion', { name: 'Lyra', role: 'archer', level: 99 }).ok, true);
    const { end, status } = winFight(h, 'Bandit');
    assert.equal(status, 'won');
    assert.equal(end.ok, true, `${end.code}: ${end.message}`);
});

each('a fight a companion left in the middle of still settles', { todo: 'party.removeCompanion is allowed during a fight; combat.end then calls party.grantXp for the gone actor → NOT_FOUND "That person is not in the party." for good' }, () => {
    const { h } = withHero({ seed: 4 });
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer', level: 1 }).receipt.data.actor;
    startBandit(h);
    assert.equal(h.command('party.removeCompanion', { actor: lyra }).ok, true);
    fightOut(h);
    endsAndAllowsANewFight(h);
});

each('a fight during which your character was remade still settles', { todo: 'party.create { replace: true } is allowed during a fight; combat.end\'s party.applyResult then names only the old id → NOT_FOUND "That fight result names nobody in the party." for good' }, () => {
    const { h } = withHero({ seed: 4 });
    startBandit(h);
    assert.equal(h.command('party.create', { name: 'Astra', preset: 'fighter', replace: true }).ok, true);
    fightOut(h);
    endsAndAllowsANewFight(h);
});

each('a fight whose drunk draught was handed to a companion meanwhile still settles', { todo: 'combat.end consumes from the stack id the setup recorded; item.give that merges the stack into the companion\'s own draughts deletes that id → NOT_FOUND "That item is no longer in the inventory." for good (selling it is the same, see conservation.test.js)' }, () => {
    const { h, pc } = withHero({ seed: 3 });
    const pot = storyItem(h, 'Minor Healing Draught', 2);
    h.capture({ op: '!', kind: 'encounter', name: '2 Cellar Rats', text: '', labels: { tier: 'weak' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers')[0].id }).ok, true);
    assert.equal(h.command('combat.act', { action: { type: 'defend' } }).ok, true);
    const drink = h.command('combat.act', { action: { type: 'item', item: 'Minor Healing Draught', target: pc } });
    assert.equal(drink.ok, true, drink.message);
    // A companion joins mid-fight and is handed the draughts one by one: the second merges the bag's stack away.
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer' }).receipt.data.actor;
    const bag = () => stacksOf(h, pot).find(row => row.owner === 'party')?.stack;
    assert.equal(h.command('item.give', { stack: bag(), to: lyra, qty: 1 }).ok, true);
    assert.equal(h.command('item.give', { stack: bag(), to: lyra, qty: 1 }).ok, true);
    fightOut(h);
    const end = h.command('combat.end');
    assert.equal(end.ok, true, `${end.code}: ${end.message}`);
});
