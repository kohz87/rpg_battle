// Per-companion toggles (MODULES §F29 stat points auto ↔ manual, §F49 fight control auto ↔
// player) and the party size (§F48): party.addCompanion, party.edit, growth, acceptOffer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byName, capture, pcOf, run, withPc } from './helpers/fake-ctx.js';

function rejects(out, code, pattern) {
    assert.equal(out.ok, false, 'rejected');
    assert.equal(out.code, code, out.message);
    if (pattern) assert.match(out.message, pattern);
}

function add(state, name, extra = {}, options = {}) {
    const out = run(state, 'party.addCompanion', { name, role: 'ranger', level: 1, ...extra }, options);
    assert.ok(out.ok, out.message);
    return out.state;
}

test('a new companion fights on auto and spends points by build unless told otherwise', () => {
    const state = add(withPc(), 'Lyra');
    assert.equal(byName(state, 'Lyra').control, 'auto');
    assert.equal(byName(state, 'Lyra').growth, 'auto');
    const told = add(withPc(), 'Kael', { control: 'player', growth: 'manual' });
    assert.equal(byName(told, 'Kael').control, 'player');
    assert.equal(byName(told, 'Kael').growth, 'manual');
    rejects(run(withPc(), 'party.addCompanion', { name: 'Mira', growth: 'sometimes' }), 'INVALID');
    rejects(run(withPc(), 'party.addCompanion', { name: 'Mira', control: 'nobody' }), 'INVALID');
});

test('growth manual: a level-up\'s points wait for the reader; auto: spent by build', () => {
    let state = add(add(withPc(), 'Lyra'), 'Kael', { growth: 'manual' });
    state = run(state, 'party.grantXp', { xp: 100 }).state;
    assert.equal(byName(state, 'Lyra').level, 2);
    assert.equal(byName(state, 'Lyra').points, 0, 'auto: spent');
    assert.equal(byName(state, 'Kael').level, 2);
    assert.ok(byName(state, 'Kael').points > 0, 'manual: kept');
    // Fight control is a separate toggle: a companion the reader leads still spends by build.
    let led = add(withPc(), 'Bram', { control: 'player' });
    led = run(led, 'party.grantXp', { xp: 100 }).state;
    assert.equal(byName(led, 'Bram').points, 0);
});

test('party.edit growth: auto ↔ manual; to auto spends what is waiting now; your character is refused', () => {
    let state = add(withPc(), 'Kael', { growth: 'manual' });
    state = run(state, 'party.grantXp', { xp: 100 }).state;
    const kael = byName(state, 'Kael');
    const waiting = kael.points;
    assert.ok(waiting > 0);
    const auto = run(state, 'party.edit', { actor: kael.id, growth: 'auto' });
    assert.ok(auto.ok, auto.message);
    assert.equal(byName(auto.state, 'Kael').growth, 'auto');
    assert.equal(byName(auto.state, 'Kael').points, 0);
    assert.deepEqual([auto.result.data.growth, auto.result.data.spent], ['auto', waiting]);
    assert.match(auto.result.summary, new RegExp(`spent by build \\(${waiting} spent now\\)`));
    // With the setting off, nothing is spent even on auto.
    const off = run(state, 'party.edit', { actor: kael.id, growth: 'auto' }, { settings: { autoSpend: false } });
    assert.equal(byName(off.state, 'Kael').points, waiting);
    const back = run(auto.state, 'party.edit', { actor: kael.id, growth: 'manual' });
    assert.ok(back.ok);
    assert.match(back.result.summary, /yours to spend/);
    rejects(run(auto.state, 'party.edit', { actor: kael.id, growth: 'auto' }), 'REFUSED', /Nothing to change/);
    rejects(run(state, 'party.edit', { actor: kael.id, growth: 'later' }), 'INVALID');
    rejects(run(state, 'party.edit', { actor: pcOf(state).id, growth: 'auto' }), 'REFUSED');
});

test('party.edit control: player ↔ auto for a companion, the summary says which', () => {
    const state = add(withPc(), 'Lyra');
    const lyra = byName(state, 'Lyra');
    const led = run(state, 'party.edit', { actor: lyra.id, control: 'player' });
    assert.ok(led.ok, led.message);
    assert.equal(byName(led.state, 'Lyra').control, 'player');
    assert.equal(byName(led.state, 'Lyra').growth, 'auto', 'the other toggle is untouched');
    assert.match(led.result.summary, /takes your orders in fights/);
    assert.match(run(led.state, 'party.edit', { actor: lyra.id, control: 'auto' }).result.summary, /fights on their own/);
});

test('a record from before the growth toggle keeps v1\'s meaning (led by the reader: manual)', () => {
    let state = add(withPc(), 'Bram', { control: 'player' });
    delete state.domains.party.actors[byName(state, 'Bram').id].growth;
    state = run(state, 'party.grantXp', { xp: 100 }).state;
    assert.ok(byName(state, 'Bram').points > 0);
    const broken = structuredClone(state);
    broken.domains.party.actors[byName(state, 'Bram').id].growth = 'sometimes';
    assert.ok(run(broken, 'party.edit', { actor: byName(state, 'Bram').id, role: 'tank' }).ok === false);
});

test('party size: you + 3 companions by default; the setting changes it; acceptOffer is refused when full', () => {
    let state = withPc();
    for (const name of ['Lyra', 'Kael', 'Mira']) state = add(state, name);
    const before = JSON.stringify(state);
    rejects(run(state, 'party.addCompanion', { name: 'Bram' }), 'REFUSED', /The party is full: 3 companions beside you at most/);
    assert.equal(JSON.stringify(state), before);
    assert.ok(run(state, 'party.addCompanion', { name: 'Bram' }, { settings: { maxCompanions: 4 } }).ok);
    rejects(run(withPc(), 'party.addCompanion', { name: 'Bram' }, { settings: { maxCompanions: 0 } }), 'REFUSED', /switched off/);
    const one = add(withPc(), 'Lyra', {}, { settings: { maxCompanions: 1 } });
    rejects(run(one, 'party.addCompanion', { name: 'Kael' }, { settings: { maxCompanions: 1 } }), 'REFUSED', /1 companion beside you/);
    // A join offer waits; accepting it is refused while the party is full, and it stays.
    const offered = capture(state, '+ join Bram — the smith | level: 2 | role: tank');
    assert.ok(offered.ok, offered.message);
    const offer = offered.state.domains.party.offers.find(entry => entry.kind === 'join');
    rejects(run(offered.state, 'party.acceptOffer', { offer: offer.id }), 'REFUSED', /full/);
    assert.ok(run(offered.state, 'party.acceptOffer', { offer: offer.id }, { settings: { maxCompanions: 4 } }).ok);
});
