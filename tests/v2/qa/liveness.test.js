// QA: a finished fight can always be settled. combat.end makes several calls in one transaction
// (party.applyResult, inventory.consume, party.grantXp, inventory.grant, wallet.receive); if any
// callee refuses, the whole end is refused, and since the session stays over-but-unsettled,
// combat.start refuses every new fight too ("Finish the last fight first."). Each test was a way
// to get there with ordinary commands (QA #75; the found-by-fuzz ones came from fuzz.test.js):
// now no one leaves and your character is not remade while a fight has the party, a member who
// is gone anyway is skipped, XP at the level cap is nothing, and draughts leave at use.
import assert from 'node:assert/strict';
import { bytes, fightOut, patch, sent, stacksOf, storyItem, winFight, withHero, each } from './helpers/harness.js';

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

each('a won fight with a companion at the level cap settles', () => {
    // A level cap of 3: a companion joins two levels above your level-1 character at most (B-b3-16).
    const { h } = withHero({ seed: 4, settings: { 'party.maxLevel': 3 } });
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer', level: 99 }, { cause: 'system' });
    assert.equal(lyra.ok, true);
    assert.equal(lyra.receipt.data.level, 3, 'at the level cap');
    const { end, status } = winFight(h, 'Bandit');
    assert.equal(status, 'won');
    assert.equal(end.ok, true, `${end.code}: ${end.message}`);
    assert.equal(h.state().domains.party.actors[lyra.receipt.data.actor].xp, 0, 'nothing given at the cap');
    assert.equal(h.state().domains.combat.session, null);
});

each('a companion cannot leave in the middle of a fight; the fight settles, then they can', () => {
    const { h } = withHero({ seed: 4 });
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer', level: 1 }, { cause: 'system' }).receipt.data.actor;
    h.capture({ op: '!', kind: 'encounter', name: '3 Wolves', text: '', labels: { tier: 'strong' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers').at(-1).id }).ok, true);
    assert.equal(h.state().domains.combat.session.status, 'active');
    const before = bytes(h.state());
    const left = h.command('party.removeCompanion', { actor: lyra });
    assert.equal(left.code, 'REFUSED');
    assert.match(left.message, /fight is under way/);
    assert.equal(bytes(h.state()), before);
    fightOut(h);
    const unsettled = h.command('party.removeCompanion', { actor: lyra });
    assert.equal(unsettled.code, 'REFUSED', 'not before the fight is settled either');
    assert.equal(h.command('combat.end').ok, true);
    assert.equal(h.command('party.removeCompanion', { actor: lyra }).ok, true);
});

each('a leave offer accepted during a fight is refused and stays waiting', () => {
    const { h } = withHero({ seed: 4 });
    h.command('party.addCompanion', { name: 'Lyra', role: 'archer', level: 1 }, { cause: 'system' });
    startBandit(h);
    const offered = h.capture({ op: '-', kind: 'join', name: 'Lyra', text: 'goes home', labels: {} });
    assert.equal(offered.ok, true, offered.message);
    const offer = h.state().domains.party.offers.find(entry => entry.kind === 'leave');
    const accepted = h.command('party.acceptOffer', { offer: offer.id });
    assert.equal(accepted.code, 'REFUSED');
    assert.ok(h.state().domains.party.offers.some(entry => entry.id === offer.id));
});

each('your character cannot be remade in the middle of a fight; the fight settles', () => {
    const { h } = withHero({ seed: 4 });
    startBandit(h);
    const remade = h.command('party.create', { name: 'Astra', preset: 'fighter', replace: true });
    assert.equal(remade.code, 'REFUSED');
    fightOut(h);
    endsAndAllowsANewFight(h);
});

each('combat.end settles even when a member the fight names is no longer in the party (skipped)', () => {
    const { h, pc } = withHero({ seed: 4 });
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer', level: 1 }, { cause: 'system' }).receipt.data.actor;
    startBandit(h);
    fightOut(h);
    // However it came about (a state from before the refusals), the fight names someone gone.
    patch(h, state => {
        delete state.domains.party.actors[lyra];
        state.domains.party.order = state.domains.party.order.filter(id => id !== lyra);
    });
    const end = h.command('combat.end');
    assert.equal(end.ok, true, `${end.code}: ${end.message}`);
    assert.deepEqual(sent(h, 'combat.end', 'party.grantXp').map(payload => payload.actor).filter(id => id === lyra), []);
    assert.ok(sent(h, 'combat.end', 'party.applyResult')[0].actors.every(entry => entry.id === pc));
});

each('combat.end settles even when your character was replaced by hand (nobody of the fight is left)', () => {
    const { h, pc } = withHero({ seed: 4 });
    startBandit(h);
    fightOut(h);
    patch(h, state => {
        const party = state.domains.party;
        const old = party.actors[pc];
        delete party.actors[pc];
        party.actors.ac_newpc000 = { ...old, id: 'ac_newpc000', name: 'Astra' };
        party.pc = 'ac_newpc000';
        party.order = ['ac_newpc000'];
    });
    const end = h.command('combat.end');
    assert.equal(end.ok, true, `${end.code}: ${end.message}`);
    assert.deepEqual(sent(h, 'combat.end', 'party.applyResult'), []);
    assert.deepEqual(sent(h, 'combat.end', 'party.grantXp'), []);
});

each('a fight whose draughts were handed to a companion meanwhile still settles, and the drunk one is not taken twice', () => {
    const { h, pc } = withHero({ seed: 3 });
    const pot = storyItem(h, 'Minor Healing Draught', 3);
    h.capture({ op: '!', kind: 'encounter', name: '2 Cellar Rats', text: '', labels: { tier: 'weak' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers')[0].id }).ok, true);
    assert.equal(h.command('combat.act', { action: { type: 'defend' } }).ok, true);
    const drink = h.command('combat.act', { action: { type: 'item', item: 'Minor Healing Draught', target: pc } });
    assert.equal(drink.ok, true, drink.message);
    // A companion joins mid-fight and is handed the rest one by one: the second merges the bag's stack away.
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer' }, { cause: 'system' }).receipt.data.actor;
    const bag = () => stacksOf(h, pot).find(row => row.owner === 'party')?.stack;
    assert.equal(h.command('item.give', { stack: bag(), to: lyra, qty: 1 }).ok, true);
    assert.equal(h.command('item.give', { stack: bag(), to: lyra, qty: 1 }).ok, true);
    fightOut(h);
    const end = h.command('combat.end');
    assert.equal(end.ok, true, `${end.code}: ${end.message}`);
    const dropped = (end.receipt.data.loot?.items ?? []).find(item => item.name === 'Minor Healing Draught')?.qty ?? 0;
    assert.equal(stacksOf(h, pot).reduce((sum, row) => sum + row.qty, 0), 2 + dropped, 'three, one drunk (plus any dropped)');
});

each('party.edit control (MODULES §F49): a companion led by the reader waits for orders in the next fight; on auto acts alone', () => {
    const { h } = withHero({ seed: 4 });
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer', level: 1 }, { cause: 'system' }).receipt.data.actor;
    assert.equal(h.command('party.edit', { actor: lyra, control: 'player' }).ok, true);
    h.capture({ op: '!', kind: 'encounter', name: '3 Bandits', text: '', labels: { tier: 'even' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers').at(-1).id }).ok, true);
    const controllers = () => Object.fromEntries(h.state().domains.combat.session.setup.party.map(c => [c.memberId, c.controller]));
    assert.equal(controllers()[lyra], 'player');
    // While the fight runs the toggle changes the next fight, never this one (its setup is kept).
    assert.equal(h.command('party.edit', { actor: lyra, control: 'auto' }).ok, true);
    assert.equal(controllers()[lyra], 'player');
    fightOut(h);
    assert.equal(h.command('combat.end').ok, true);
    h.capture({ op: '!', kind: 'encounter', name: '3 Bandits', text: '', labels: { tier: 'even' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers').at(-1).id }).ok, true);
    assert.equal(controllers()[lyra], 'auto');
});
