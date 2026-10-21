// The combat part (src/v2/combat, MODULES §B3) on a fake command bus: offers from encounter
// lines, a fight played from start to end, flee, loss, dismiss, the foes beaten for quests, and
// the fight rebuilt from the State alone (rollback).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actor, baseDomains, createWorld, genericProblems, it, line } from './helpers/fake-ctx.js';
import { part, STATIC_TEXT, foesBeaten, validateCombat } from '../../../src/v2/combat/index.js';
import { beatenFoes } from '../../../src/v2/combat/view.js';
import { packSetup, unpackSetup, bestiaryList } from '../../../src/v2/combat/stored.js';

const hero = (over = {}) => actor(1, {
    level: 6,
    hp: { cur: 220, max: 220 }, mp: { cur: 60, max: 60 }, sp: { cur: 60, max: 60 },
    stats: { STR: 16, VIT: 14, AGI: 14, DEX: 14, INT: 8, LUK: 8, CHA: 8 },
    ...over,
});

const POTION = 'story/minor-healing-draught';
const SWORD = 'story/iron-sword';
function armed(actors = [hero()]) {
    const defs = {
        [POTION]: { id: POTION, name: 'Minor Healing Draught', kind: 'consumable', rarity: 'common', value: 5, stack: true, slot: null, stats: {}, effect: { heal: 20 }, tags: [], note: '' },
        [SWORD]: { id: SWORD, name: 'Iron Sword', kind: 'equipment', rarity: 'common', value: 20, stack: false, slot: 'weapon', stats: { ATK: 4 }, effect: {}, tags: [], note: '' },
    };
    const stacks = {
        [it(1)]: { id: it(1), def: POTION, qty: 2, owner: 'party', equipped: null, note: '', from: '' },
        [it(2)]: { id: it(2), def: SWORD, qty: 1, owner: actors[0].id, equipped: 'weapon', note: '', from: '' },
    };
    return baseDomains({ actors, defs, stacks });
}

/** A world with one offer captured; returns [world, offerId]. */
function offered(name = '3 Cellar Rats', labels = { tier: 'weak' }, opts = {}) {
    const world = createWorld({ domains: armed(opts.actors), ...opts });
    const r = world.capture(line('!', 'encounter', name, 'boiling out of the bins', labels));
    assert.equal(r.ok, true, r.message);
    return [world, world.state.domains.combat.offers.at(-1).id];
}

/** Plays attacks on the first foe until the fight is over; returns the actions sent. */
function fightOut(world, max = 200) {
    const sent = [];
    for (let n = 0; n < max; n++) {
        const view = world.query('combat.session');
        if (view.status !== 'active') return sent;
        const action = { type: 'attack', target: view.actions.targets.enemies[0] };
        const r = world.run('combat.act', { action });
        assert.equal(r.ok, true, r.message);
        sent.push(action);
    }
    throw new Error('The fight did not end.');
}

test('a fight from offer to end: started, played, settled through the owners', () => {
    const [world, offer] = offered();
    const started = world.run('combat.start', { offer });
    assert.equal(started.ok, true, started.message);
    assert.equal(started.receipt.narrate, false);
    const combat = world.state.domains.combat;
    assert.deepEqual(combat.offers, [], 'the offer fought is gone');
    assert.deepEqual(Object.keys(combat.session).sort(), ['actions', 'id', 'setup', 'status'], 'the session stores only id, setup, actions, status');
    assert.match(combat.session.id, /^fi_[0-9a-z]{8}$/);
    assert.equal(combat.session.status, 'active');
    // The party came from party.actors with its gear and the party's consumables.
    const ren = combat.session.setup.party[0];
    assert.equal(ren.id, 'ac_00000001');
    assert.equal(ren.hp.max, 220);
    assert.deepEqual(ren.items.map(i => [i.name, i.qty, i.stack]), [['Minor Healing Draught', 2, it(1)]]);
    const view = world.query('combat.session');
    assert.equal(view.combatants.filter(c => c.side === 'enemy').length, 3);
    assert.deepEqual(view.combatants.filter(c => c.side === 'enemy').map(c => c.name), ['Cellar Rat A', 'Cellar Rat B', 'Cellar Rat C']);
    assert.equal(view.turn.actor, 'ac_00000001');

    fightOut(world);
    assert.equal(world.state.domains.combat.session.status, 'won');
    const ended = world.run('combat.end');
    assert.equal(ended.ok, true, ended.message);
    assert.equal(ended.receipt.narrate, true);
    assert.match(ended.receipt.summary, /^Victory in \d+ rounds?/);
    assert.match(ended.receipt.summary, /Foes defeated: Cellar Rat ×3\./);
    assert.ok(!ended.receipt.summary.includes('\n'), 'one line for [Happened]');
    const after = world.state.domains.combat;
    assert.equal(after.session, null);
    assert.equal(after.last.summary, ended.receipt.summary);
    assert.ok(after.last.moments.length > 0);
    assert.deepEqual(after.beaten, [{ rev: ended.receipt.rev, foes: [{ name: 'Cellar Rat', count: 3 }], won: true }]);
    assert.deepEqual(ended.receipt.data.foes, [{ name: 'Cellar Rat', count: 3 }]);
    const types = ended.calls.map(c => c.type);
    assert.equal(types[0], 'party.applyResult');
    assert.ok(types.includes('party.grantXp'));
    const apply = ended.calls[0].payload;
    assert.equal(apply.outcome, 'victory');
    assert.equal(apply.actors[0].id, 'ac_00000001');
    assert.equal(world.state.domains.party.actors.ac_00000001.hp.cur, apply.actors[0].hp.cur);
    assert.ok(world.state.domains.party.actors.ac_00000001.xp > 0);
    for (const grant of ended.calls.filter(c => c.type === 'inventory.grant')) {
        // MODULES §F5 { def, qty, owner } (no note: loot of one kind stacks); the hook prices it.
        assert.deepEqual(Object.keys(grant.payload).sort(), ['def', 'owner', 'qty']);
        assert.equal(grant.payload.owner, 'party');
        assert.equal(grant.payload.def.value, undefined);
        assert.match(grant.payload.def.id, /^story\/[a-z0-9-]+$/);
        assert.ok(['material', 'consumable', 'equipment', 'goods'].includes(grant.payload.def.kind));
    }
    for (const stack of Object.values(world.state.domains.inventory.stacks).filter(s => s.from === ended.receipt.id)) assert.equal(stack.owner, 'party');
    for (const pay of ended.calls.filter(c => c.type === 'wallet.receive')) {
        assert.deepEqual(Object.keys(pay.payload).sort(), ['amount', 'note', 'owner']);
        assert.ok(Number.isInteger(pay.payload.amount) && pay.payload.amount > 0);
    }
    assert.deepEqual(ended.calls.filter(c => c.type === 'party.grantXp').map(c => Object.keys(c.payload).sort()), [['actor', 'amount']]);
    // Every committed state keeps Story Block's generic rules (qty whole, ids well-formed).
    for (const state of world.history) assert.deepEqual(genericProblems(state.domains), []);
});

test('the same seed plays the same fight: same log, same result', () => {
    const play = () => {
        const [world, offer] = offered('2 bandits and a bandit captain (boss)', { tier: 'even' }, { seed: 77 });
        world.run('combat.start', { offer });
        const seed = world.state.domains.combat.session.setup.seed;
        fightOut(world);
        const log = world.query('combat.session').log.map(e => e.text);
        const end = world.run('combat.end');
        return { seed, log, summary: end.receipt.summary, calls: end.calls, state: world.state.domains };
    };
    const a = play();
    const b = play();
    assert.deepEqual(a.log, b.log);
    assert.equal(a.summary, b.summary);
    assert.deepEqual(a.calls, b.calls);
    assert.deepEqual(a.state, b.state);
    const [other, offer] = offered('2 bandits and a bandit captain (boss)', { tier: 'even' }, { seed: 78 });
    other.run('combat.start', { offer });
    assert.notEqual(other.state.domains.combat.session.setup.seed, a.seed, 'the seed comes from the receipt\'s dice');
});

test('a consumable used in the fight comes out of its stack at use, not at the end', () => {
    const [world, offer] = offered('Giant Rat', { tier: 'weak' }, { actors: [hero({ hp: { cur: 100, max: 220 } })] });
    world.run('combat.start', { offer });
    const r = world.run('combat.act', { action: { type: 'item', item: 'Minor Healing Draught' } });
    assert.equal(r.ok, true, r.message);
    assert.match(r.receipt.summary, /Minor Healing Draught/);
    assert.deepEqual(r.calls.filter(c => c.type === 'inventory.consume').map(c => c.payload), [{ stack: it(1), qty: 1 }]);
    assert.deepEqual(r.receipt.data.used, [{ stack: it(1), qty: 1 }]);
    assert.equal(world.state.domains.inventory.stacks[it(1)].qty, 1);
    fightOut(world);
    const end = world.run('combat.end');
    assert.equal(end.ok, true, end.message);
    assert.deepEqual(end.calls.filter(c => c.type === 'inventory.consume'), []);
    assert.equal(world.state.domains.inventory.stacks[it(1)].qty, 1);
});

test('flee: the party gets away; nothing is looted and nobody is counted beaten', () => {
    let fled = null;
    for (let seed = 1; seed < 60 && !fled; seed++) {
        const [world, offer] = offered('3 wolves', { tier: 'strong' }, { seed: seed * 7 });
        world.run('combat.start', { offer });
        for (let n = 0; n < 10 && world.state.domains.combat.session.status === 'active'; n++) {
            const r = world.run('combat.flee');
            assert.equal(r.ok, true, r.message);
        }
        if (world.state.domains.combat.session.status === 'fled') fled = world;
    }
    assert.ok(fled, 'some seed lets the party escape');
    const end = fled.run('combat.end');
    assert.equal(end.ok, true, end.message);
    assert.match(end.receipt.summary, /^Escaped after/);
    assert.equal(end.calls.some(c => c.type === 'inventory.grant' || c.type === 'wallet.receive'), false);
    assert.equal(fled.state.domains.combat.last.outcome, 'fled');
    assert.deepEqual(fled.state.domains.combat.beaten.filter(entry => entry.won), []);
});

test('a lost fight is settled as a defeat, without loot', () => {
    const weak = actor(1, { level: 1, hp: { cur: 12, max: 40 } });
    const [world, offer] = offered('Ogre', { tier: 'deadly', stakes: 'death' }, { actors: [weak] });
    assert.equal(world.run('combat.start', { offer }).ok, true);
    // The ogre may finish it before Ren's first turn: the session starts over, then.
    if (world.state.domains.combat.session.status === 'active') {
        const r = world.run('combat.act', { action: { type: 'auto' } });
        assert.equal(r.ok, true, r.message);
    }
    assert.equal(world.state.domains.combat.session.status, 'lost');
    assert.match(world.run('combat.act', { action: { type: 'defend' } }).message, /over/);
    const end = world.run('combat.end');
    assert.equal(end.ok, true, end.message);
    assert.match(end.receipt.summary, /Defeated: Ren is killed/);
    assert.equal(end.calls[0].payload.outcome, 'defeat');
    assert.equal(end.calls[0].payload.stakes, 'death');
    assert.equal(end.calls[0].payload.actors[0].down, true);
    assert.equal(end.calls.some(c => c.type === 'inventory.grant'), false);
    assert.equal(world.state.domains.party.actors.ac_00000001.hp.cur, 0);
});

test('beaten counts the foes killed, never the ones that fled or were talked down', () => {
    const result = { enemies: [
        { name: 'Wolf A', questName: 'Wolf', gone: 'down' },
        { name: 'Wolf B', questName: 'Wolf', gone: 'fled' },
        { name: 'Wolf C', questName: 'Wolf', gone: 'down' },
        { name: 'Bandit', questName: 'Bandit', gone: 'parleyed' },
        { name: 'Bandit Captain', questName: 'Bandit Captain', gone: null },
    ] };
    assert.deepEqual(beatenFoes(result), [{ name: 'Wolf', count: 2 }]);
});

test('combat.foesBeaten: the fights settled after sinceRev', () => {
    const state = { meta: { rev: 9 }, domains: { combat: { offers: [], session: null, last: null, beaten: [
        { rev: 3, foes: [{ name: 'Wolf', count: 2 }], won: true },
        { rev: 6, foes: [{ name: 'Wolf', count: 1 }, { name: 'Bandit', count: 2 }], won: false },
        { rev: 8, foes: [{ name: 'Bandit', count: 1 }], won: true },
    ] } } };
    assert.deepEqual(foesBeaten(state, { sinceRev: 3 }), [state.domains.combat.beaten[1], state.domains.combat.beaten[2]]);
    assert.equal(foesBeaten(state).length, 3);
    assert.deepEqual(foesBeaten(state, { sinceRev: 8 }), []);
    assert.equal(part.queries['combat.foesBeaten'], foesBeaten);
});

test('dismiss: the offer goes; a second dismiss or a start of it is refused and keeps nothing', () => {
    const [world, offer] = offered();
    const r = world.run('combat.dismiss', { offer });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.receipt.narrate, false);
    assert.deepEqual(world.state.domains.combat.offers, []);
    const before = world.state;
    assert.equal(world.run('combat.dismiss', { offer }).code, 'NOT_FOUND');
    assert.equal(world.run('combat.start', { offer }).code, 'NOT_FOUND');
    assert.equal(world.state, before, 'nothing saved on a rejection');
});

test('every rejection keeps nothing', () => {
    const [world, offer] = offered();
    const initial = world.state;
    assert.equal(world.run('combat.act', { action: { type: 'attack' } }).code, 'NOT_FOUND');
    assert.equal(world.run('combat.flee').code, 'NOT_FOUND');
    assert.equal(world.run('combat.end').code, 'NOT_FOUND');
    assert.equal(world.state, initial);

    // Nobody to fight with.
    const lonely = createWorld({ domains: baseDomains({ actors: [] }) });
    lonely.capture(line('!', 'encounter', 'Wolf'));
    const r = lonely.run('combat.start', { offer: lonely.state.domains.combat.offers[0].id });
    assert.equal(r.code, 'REFUSED');
    assert.match(r.message, /Make your character first/);
    const down = createWorld({ domains: baseDomains({ actors: [actor(1, { hp: { cur: 0, max: 80 } })] }) });
    down.capture(line('!', 'encounter', 'Wolf'));
    assert.match(down.run('combat.start', { offer: down.state.domains.combat.offers[0].id }).message, /Nobody in the party is standing/);

    world.capture(line('!', 'encounter', 'Wolf'));
    const second = world.state.domains.combat.offers[1].id;
    assert.equal(world.run('combat.start', { offer }).ok, true);
    const active = world.state;
    assert.match(world.run('combat.start', { offer: second }).message, /already under way/);
    assert.equal(world.run('combat.act', { action: { type: 'dance' } }).code, 'INVALID');
    assert.equal(world.run('combat.act', { action: { type: 'attack', target: 7 } }).code, 'INVALID');
    assert.equal(world.run('combat.act', { action: { type: 'attack', target: 'fo_99999999' } }).code, 'REFUSED');
    assert.equal(world.run('combat.act', { action: { type: 'skill', skill: 'Meteor' } }).code, 'REFUSED');
    assert.equal(world.run('combat.start', { offer: second }).code, 'REFUSED');
    assert.match(world.run('combat.end').message, /not over yet/);
    assert.equal(world.state, active);

    fightOut(world);
    // Settled already on this line of history (the claim holds): refused.
    const claimed = world.state.meta.claims;
    assert.deepEqual(claimed, {});
    const id = world.state.domains.combat.session.id;
    const withClaim = { ...world.state, meta: { ...world.state.meta, claims: { [`combat:${id}:end`]: true } } };
    assert.equal(world.run('combat.end', {}, { on: withClaim }).code, 'CLAIMED');
    assert.match(world.run('combat.act', { action: { type: 'defend' } }).message, /over/);
});

test('encounter capture: offers from the line, threat words never a creature', () => {
    const world = createWorld();
    const r = world.capture(line('!', 'encounter', '6 Cellar Rat Swarm', 'boiling out of the bins', { tier: 'even', stakes: 'normal' }));
    assert.equal(r.ok, true, r.message);
    assert.equal(r.receipt.cause, 'story');
    const [offer] = world.state.domains.combat.offers;
    assert.match(offer.id, /^en_[0-9a-z]{8}$/);
    assert.deepEqual({ ...offer, id: '' }, { id: '', foes: [{ name: 'Cellar Rat Swarm', count: 6, tier: 'even' }], stakes: 'normal', place: 'Bluewatch Village', rev: r.receipt.rev, note: 'boiling out of the bins' });

    // Several groups, a boss, a threat word on the foe itself, stakes and a place.
    world.capture(line('!', 'encounter', '3 weak wolves, wolf matriarch (boss)', '', { tier: 'strong', stakes: 'to the death', place: 'the den' }));
    const pack = world.state.domains.combat.offers[1];
    assert.deepEqual(pack.foes, [{ name: 'Wolf', count: 3, tier: 'weak' }, { name: 'Wolf Matriarch', count: 1, tier: 'strong', boss: true }]);
    assert.equal(pack.stakes, 'death');
    assert.equal(pack.place, 'the den');
    // No tier: an even fight. "a swarm of rats" is one swarm.
    world.capture(line('!', 'encounter', 'a swarm of rats'));
    assert.deepEqual(world.state.domains.combat.offers[2].foes, [{ name: 'Rat Swarm', count: 1, tier: 'even' }]);
    // Humanoid words: people, a leader.
    world.capture(line('!', 'encounter', '2 dockside enforcers and the guard captain', '', { tier: 'even' }));
    assert.deepEqual(world.state.domains.combat.offers[3].foes.map(f => [f.name, f.count]), [['Dockside Enforcer', 2], ['Guard Captain', 1]]);

    const before = world.state;
    for (const [name, labels, pattern] of [
        ['Even', {}, /not who is in it/],
        ['deadly', { tier: 'deadly' }, /not who is in it/],
        ['to the death', {}, /not who is in it/],
        ['2 rats, even', { tier: 'banana' }, /not a tier/],
        ['Wolf', { stakes: 'tea' }, /not a stake/],
        ['', {}, /names no foe/],
    ]) {
        const out = world.capture(line('!', 'encounter', name, '', labels));
        assert.equal(out.ok, false, name);
        assert.equal(out.code, 'INVALID');
        assert.match(out.message, pattern);
    }
    assert.match(world.capture(line('-', 'encounter', 'Wolf')).message, /written with "!"/);
    assert.equal(world.state, before, 'a refused line keeps nothing');
    // A threat word written apart from the name is the foe's tier, not a foe called Even.
    world.capture(line('!', 'encounter', '2 cellar rats, even'));
    assert.deepEqual(world.state.domains.combat.offers.at(-1).foes, [{ name: 'Cellar Rat', count: 2, tier: 'even' }]);
});

test('offers are capped, oldest first out', () => {
    const world = createWorld();
    for (let n = 0; n < 12; n++) assert.equal(world.capture(line('!', 'encounter', `${(n % 9) + 1} wolves`)).ok, true);
    const offers = world.state.domains.combat.offers;
    assert.equal(offers.length, 10);
    assert.equal(offers[0].foes[0].count, 3);
});

test('the fight is rebuilt from the State alone: an older state gives the older fight', () => {
    const [world, offer] = offered('2 bandits', { tier: 'even' }, { seed: 5 });
    world.run('combat.start', { offer });
    const afterStart = world.state;
    const viewAtStart = world.query('combat.session');
    const target = viewAtStart.actions.targets.enemies[0];
    const first = world.run('combat.act', { action: { type: 'attack', target } });
    const afterOne = world.state;
    const viewAfterOne = world.query('combat.session');
    world.run('combat.act', { action: { type: 'defend' } });

    // Swiped back to after the start, or to after the first action: those fights, exactly.
    assert.deepEqual(world.query('combat.session', undefined, afterStart), viewAtStart);
    assert.deepEqual(world.query('combat.session', undefined, afterOne), viewAfterOne);
    // The same action on the same state, played again, is the same receipt and the same state.
    const again = world.run('combat.act', { action: { type: 'attack', target } }, { on: afterStart, seed: first.receipt.seed });
    assert.equal(again.receipt.summary, first.receipt.summary);
    assert.deepEqual(again.state.domains, afterOne.domains);
    // The session is plain JSON: stored, read back and rebuilt, nothing else needed.
    const copy = JSON.parse(JSON.stringify(afterOne));
    assert.deepEqual(world.query('combat.session', undefined, copy), viewAfterOne);
});

test('names nobody wrote up are made once and kept in the bestiary', () => {
    const [world, offer] = offered('3 Bog Wights', { tier: 'even' });
    world.run('combat.start', { offer });
    const creatures = world.state.domains.bestiary.creatures;
    assert.deepEqual(Object.keys(creatures), ['bog-wight']);
    const stored = creatures['bog-wight'];
    assert.equal(stored.name, 'Bog Wight');
    assert.equal(stored.rev, world.state.meta.rev);
    // Loot ranges are stored under `range` (a `qty` is a whole number in v2 state) and read back as v1 wrote them.
    assert.ok(stored.loot.every(row => !('qty' in row) && Array.isArray(row.range)));
    assert.ok(bestiaryList(world.state.domains.bestiary)[0].loot.every(row => Array.isArray(row.qty)));
    assert.equal(world.query('combat.session').combatants.filter(c => c.fresh).length, 3);
    // The next fight with them finds them there and makes nothing new.
    fightOut(world);
    world.run('combat.end');
    world.capture(line('!', 'encounter', 'Bog Wight'));
    const next = world.run('combat.start', { offer: world.state.domains.combat.offers[0].id });
    assert.deepEqual(next.receipt.data.made, []);
    assert.equal(world.query('combat.session').combatants.filter(c => c.fresh).length, 0);
});

test('a setup packs and unpacks to exactly what v1 built', () => {
    const [world, offer] = offered('2 Bog Wights', { tier: 'even' });
    world.run('combat.start', { offer });
    const stored = world.state.domains.combat.session.setup;
    assert.deepEqual(packSetup(unpackSetup(stored)), JSON.parse(JSON.stringify(stored)));
    assert.ok(unpackSetup(stored).enemies.every(e => !Array.isArray(e.loot) || e.loot.every(row => Array.isArray(row.qty))));
});

test('validators hold the shapes', () => {
    const ok = part.domains.combat.initial();
    assert.deepEqual(validateCombat(ok), []);
    assert.ok(validateCombat({ ...ok, offers: [{ id: 'x', foes: [], stakes: 'maybe', place: '', rev: -1 }] }).length >= 4);
    assert.ok(validateCombat({ ...ok, session: { id: 'fi_00000001', setup: {}, actions: [{ type: 'dance' }], status: 'sleeping' } }).length >= 3);
    assert.ok(validateCombat({ ...ok, beaten: [{ rev: 1, foes: [{ name: 'Wolf', count: 0 }], won: true }] }).length === 1);
    assert.ok(validateCombat({ ...ok, last: { summary: 3 } }).length === 1);
    assert.deepEqual(part.domains.bestiary.validate({ creatures: {} }), []);
    assert.equal(part.domains.bestiary.validate({ creatures: { wolf: { name: 'Bog Wight', level: 2 } } }).length, 1);
    assert.equal(part.domains.bestiary.validate({ creatures: [] }).length, 1);
});

test('context: the static text never changes; the tail says what is under way or offered', () => {
    assert.equal(part.context.static(), STATIC_TEXT);
    assert.equal(part.context.static(), part.context.static());
    assert.match(STATIC_TEXT, /stop at the first blow/);
    assert.doesNotMatch(STATIC_TEXT, /\d/);
    assert.match(part.kinds.encounter.grammar, /^! encounter .+ \| tier: trivial\|weak\|even\|strong\|deadly \| stakes: normal\|death$/);
    const [world, offer] = offered();
    const tail = state => part.context.tail({ state, query: (name, args) => world.query(name, args, state) });
    assert.deepEqual(tail(world.state).lines, []);
    assert.match(tail(world.state).optional[0], /^\[Fight offered\] Cellar Rat ×3 \(weak\) — boiling out of the bins\./);
    world.run('combat.start', { offer });
    assert.match(tail(world.state).lines[0], /^\[Fight\] Under way: Ren against Cellar Rat ×3\./);
    fightOut(world);
    world.run('combat.end');
    assert.deepEqual(tail(world.state), { lines: [], optional: [] }, 'the result is told once, by its receipt');
});

test('settings: a new fight takes the turn system and hit numbers; a running one keeps its own', () => {
    const [world, offer] = offered('Wolf', { tier: 'even' }, { settings: { turnOrder: 'rounds', hitBase: 90, hitPerPoint: 1, speedOffset: 4 } });
    world.run('combat.start', { offer });
    const setup = world.state.domains.combat.session.setup;
    assert.equal(setup.turns, 'rounds');
    assert.deepEqual(setup.hit, { base: 90, perPoint: 1 });
    assert.equal(setup.speedOffset, 4);
});

test('loot a pack defines for the base creature is granted by that name (the pack\'s def), never as a new "Starved …" item', () => {
    const pack = { 'crag wolf pelt': { id: 'pack.ersveil/crag-wolf-pelt', name: 'Crag Wolf Pelt', kind: 'material' }, 'crag wolf fang': { id: 'pack.ersveil/crag-wolf-fang', name: 'Crag Wolf Fang', kind: 'material' } };
    const extraQueries = {
        'packs.item': (_state, { name } = {}) => pack[String(name).toLowerCase()] ?? null,
        'inventory.find': () => ({ status: 'none', defs: [], stacks: [] }),
    };
    // Story Block grants a pack item by name with the pack's def (item.resolve).
    const extraCommands = {
        'inventory.grant'(ctx, { def, name, qty, owner }) {
            const inv = ctx.draft('inventory');
            const made = name ? { ...pack[name.toLowerCase()], rarity: 'common', value: 7, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' } : def;
            inv.defs[made.id] ??= structuredClone(made);
            const stack = it(100 + Object.keys(inv.stacks).length);
            inv.stacks[stack] = { id: stack, def: made.id, qty, owner, equipped: null, note: '', from: ctx.receiptId };
            return { summary: '' };
        },
    };
    let seen = 0;
    for (let seed = 1; seed <= 30 && !seen; seed++) {
        const [world, offer] = offered('Starved Crag Wolf', { tier: 'trivial' }, { seed, extraQueries, extraCommands });
        assert.equal(world.run('combat.start', { offer }).ok, true);
        fightOut(world);
        const end = world.run('combat.end');
        assert.equal(end.ok, true, end.message);
        const grants = end.calls.filter(c => c.type === 'inventory.grant').map(c => c.payload);
        for (const grant of grants) assert.doesNotMatch(grant.name ?? grant.def?.name ?? '', /Starved/);
        const parts = grants.filter(grant => grant.name);
        if (!parts.length) continue;
        assert.ok(parts.every(grant => /^Crag Wolf (?:Pelt|Fang)$/.test(grant.name)));
        assert.ok(end.receipt.data.loot.items.every(item => !/Starved/.test(item.name)));
        assert.match(end.receipt.summary, /Loot: .*crag wolf (?:pelt|fang)/i);
        seen += 1;
    }
    assert.ok(seen, 'some seed drops a part');
});
