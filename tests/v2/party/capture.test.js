// The party part's change-line kinds: wound, join, skill, check, rest. Each runs as a story
// command against a fake ctx; a rejection leaves the state as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byName, capture, makeState, pcOf, run, withPc } from './helpers/fake-ctx.js';
import { part } from '../../../src/v2/party/index.js';

const rejects = (out, code, pattern) => {
    assert.equal(out.ok, false, 'expected a rejection');
    assert.equal(out.code, code, out.message);
    if (pattern) assert.match(out.message, pattern);
};

function party() {
    let state = withPc();
    state = run(state, 'party.addCompanion', { name: 'Astra Vell', role: 'healer', level: 2 }).state;
    return state;
}

test('wound: harm takes a share of max HP, by first name too', () => {
    const state = party();
    const astra = byName(state, 'Astra Vell');
    const out = capture(state, '~ wound Astra — fell into the weir | harm: wound', { carrier: 3 });
    assert.ok(out.ok, out.message);
    const lost = Math.round(astra.hp.max * 0.3);
    assert.equal(out.state.domains.party.actors[astra.id].hp.cur, astra.hp.max - lost);
    assert.equal(out.result.summary, `Astra Vell: wound (−${lost} HP), fell into the weir.`);
    assert.equal(out.result.narrate, false);
    assert.equal(out.result.data.hp, -lost);
});

test('wound: heal, add and cure conditions, "you" is your character', () => {
    const state = party();
    const hurt = capture(state, '~ wound you — a fall | harm: severe', { carrier: 1 }).state;
    const healed = capture(hurt, '~ wound Ren — a poultice | heal: scratch', { carrier: 2 });
    assert.ok(healed.ok, healed.message);
    assert.ok(pcOf(healed.state).hp.cur > pcOf(hurt).hp.cur);
    const poisoned = capture(state, '~ wound Astra — poisoned: a snake bite', { carrier: 1 });
    assert.ok(poisoned.ok, poisoned.message);
    const astra = byName(poisoned.state, 'Astra Vell');
    assert.deepEqual(astra.conditions, [{ kind: 'poisoned', stacks: 1 }]);
    const cured = capture(poisoned.state, '~ wound Astra — cure poison', { carrier: 1 });
    assert.ok(cured.ok, cured.message);
    assert.deepEqual(byName(cured.state, 'Astra Vell').conditions, []);
    assert.equal(cured.result.summary, 'Astra Vell: cured poison.');
    const labelled = capture(state, '~ wound Astra — a curse | condition: cursed', { carrier: 1 });
    assert.deepEqual(byName(labelled.state, 'Astra Vell').conditions, [{ kind: 'cursed', stacks: 1 }]);
});

test('wound: one blow or heal per person per reply; a new reply (or a swipe) may hit again', () => {
    const state = party();
    const first = capture(state, '~ wound Ren — a bolt | harm: wound', { carrier: 5 });
    assert.ok(first.ok);
    rejects(capture(first.state, '~ wound Ren — another bolt | harm: severe', { carrier: 5 }), 'CLAIMED', /already hurt or healed in this reply/);
    // Conditions may come alongside the blow.
    assert.ok(capture(first.state, '~ wound Ren — poisoned: the bolt was coated', { carrier: 5 }).ok);
    // Someone else in the same reply, or the same person in the next one.
    assert.ok(capture(first.state, '~ wound Astra — a bolt | harm: scratch', { carrier: 5 }).ok);
    assert.ok(capture(first.state, '~ wound Ren — a bolt | harm: scratch', { carrier: 6 }).ok);
    // A swipe of reply 5 starts from the state before it: its claims are not there.
    assert.ok(capture(state, '~ wound Ren — a different blow | harm: severe', { carrier: 5 }).ok);
});

test('wound rejections', () => {
    const state = party();
    rejects(capture(state, '~ wound Kael — a fall | harm: wound'), 'NOT_FOUND', /Kael is not in the party/);
    rejects(capture(state, '~ wound Ren — a fall | harm: catastrophic'), 'INVALID', /scratch, wound, severe or grievous/);
    rejects(capture(state, '~ wound Ren — went for a long and pleasant walk'), 'INVALID', /nothing RPG Battle can use/);
    rejects(capture(state, '~ wound Ren — rested | heal: wound'), 'REFUSED', /changes nothing/);
    rejects(capture(state, '~ wound Ren — cure poison'), 'REFUSED', /changes nothing/);
    rejects(capture(makeState(), '~ wound you — a fall | harm: wound'), 'NOT_FOUND');
    const twins = run(state, 'party.addCompanion', { name: 'Astra Moss' }).state;
    rejects(capture(twins, '~ wound Astra — a fall | harm: wound'), 'INVALID', /more than one person/);
    assert.ok(capture(twins, '~ wound Astra Moss — a fall | harm: wound').ok);
});

test('join: an offer, not a member; accepted by the reader', () => {
    const state = withPc();
    const out = capture(state, '+ join Lyra — the archer from the mill | level: 3 | role: ranger', { rev: 17 });
    assert.ok(out.ok, out.message);
    assert.equal(byName(out.state, 'Lyra'), undefined);
    const [offer] = out.state.domains.party.offers;
    assert.match(offer.id, /^of_[a-z0-9]{8}$/);
    assert.deepEqual({ ...offer, id: 'x' }, { id: 'x', kind: 'join', name: 'Lyra', role: 'ranger', level: 3, focus: ['DEX', 'AGI'], skills: [], npc: null, text: 'the archer from the mill', rev: 17 });
    assert.equal(out.result.summary, 'Lyra offers to join the party.');
    const plain = capture(state, '+ join Bram — a mercenary');
    assert.equal(plain.state.domains.party.offers[0].role, 'mercenary');
    assert.equal(plain.state.domains.party.offers[0].level, null);
    const accepted = run(out.state, 'party.acceptOffer', { offer: offer.id });
    assert.equal(byName(accepted.state, 'Lyra').level, 3);
});

test('join rejections', () => {
    const state = withPc();
    const offered = capture(state, '+ join Lyra — an archer').state;
    rejects(capture(offered, '+ join Lyra — an archer'), 'REFUSED', /already waiting/);
    rejects(capture(state, '+ join Ren — himself'), 'REFUSED', /already in the party/);
    // `- join` is a companion leaving (MODULES §F26): someone not in the party cannot.
    rejects(capture(state, '- join Lyra — went home'), 'NOT_FOUND');
    rejects(capture(state, '~ join Lyra — an archer'), 'INVALID');
    rejects(capture(state, '+ join you — me'), 'INVALID');
    rejects(capture(state, '+ join Lyra — an archer | level: high'), 'INVALID', /not a level/);
});

test('skill: an offer to learn, with a template for a skill the library lacks', () => {
    const state = withPc();
    const out = capture(state, '+ skill Ren — Shadow Cut: a blurring slash | taught by: Kael | type: physical | stat: AGI');
    assert.ok(out.ok, out.message);
    const [offer] = out.state.domains.party.offers;
    assert.equal(offer.kind, 'skill');
    assert.equal(offer.actor, out.state.domains.party.pc);
    assert.equal(offer.skill, 'Shadow Cut');
    assert.equal(offer.taughtBy, 'Kael');
    assert.deepEqual(offer.template, { type: 'physical', stat: 'AGI', target: 'one', element: 'none' });
    assert.equal(out.result.summary, 'Ren could learn Shadow Cut from Kael.');
    assert.deepEqual(pcOf(out.state).skills, []);
    // Without hints the words decide (v1 guessSkill): "shadow" is magic.
    assert.equal(capture(state, '+ skill Ren — Shadow Cut').state.domains.party.offers[0].template.type, 'magic');
    const library = capture(state, '+ skill Ren — mend');
    assert.equal(library.state.domains.party.offers[0].skill, 'Mend');
    assert.equal(library.state.domains.party.offers[0].template, null);
});

test('skill rejections', () => {
    const state = withPc({ name: 'Ren', preset: 'fighter' });
    rejects(capture(state, '+ skill Ren — Sweep'), 'REFUSED', /already knows/);
    rejects(capture(state, '+ skill Kael — Sweep'), 'NOT_FOUND');
    rejects(capture(state, '- skill Ren — Sweep'), 'INVALID');
    rejects(capture(state, '+ skill Ren'), 'INVALID', /skill's name/);
    const offered = capture(state, '+ skill Ren — Mend').state;
    rejects(capture(offered, '+ skill Ren — mend'), 'REFUSED', /already offered/);
});

test('check: resolved at once with the receipt seed', () => {
    const state = party();
    const out = capture(state, '? check stealth — slipping past the guard | dc: hard', { seed: 9 });
    assert.ok(out.ok, out.message);
    assert.equal(out.result.data.stat, 'DEX');
    assert.equal(out.result.data.dc, 20);
    assert.equal(out.result.narrate, true);
    assert.deepEqual(capture(state, '? check stealth — slipping past the guard | dc: hard', { seed: 9 }).result, out.result);
    const theirs = capture(state, '? check persuade — talking the guard down | dc: 12 | who: Astra', { seed: 9 });
    assert.equal(theirs.result.data.actor, byName(state, 'Astra Vell').id);
    assert.equal(theirs.result.data.stat, 'CHA');
    rejects(capture(state, '? check stealth — x | dc: legendary'), 'INVALID');
    rejects(capture(state, '? check stealth — x | who: Kael'), 'NOT_FOUND');
});

test('rest: a short or long rest for the whole party', () => {
    const base = party();
    const state = structuredClone(base);
    pcOf(state).hp.cur = 1;
    const out = capture(state, '! rest long — a night at the inn');
    assert.ok(out.ok, out.message);
    assert.equal(pcOf(out.state).hp.cur, pcOf(state).hp.max);
    assert.match(out.result.summary, /^The party takes a long rest \(a night at the inn\): Ren HP \+/);
    assert.ok(capture(state, '! rest short — a breather by the road').ok);
    rejects(capture(state, '! rest forever — the end'), 'INVALID');
});

test('the kinds\' grammar and the static text are fixed: byte-identical whatever the state', () => {
    const grammar = Object.values(part.kinds).map(kind => kind.grammar).join('\n');
    const staticText = part.context.static();
    for (const state of [makeState(), party()]) {
        assert.equal(Object.values(part.kinds).map(kind => kind.grammar).join('\n'), grammar);
        assert.equal(part.context.static({ state }), staticText);
    }
    for (const kind of Object.values(part.kinds)) {
        assert.ok(!kind.grammar.includes('\n'), 'one line each');
        assert.doesNotMatch(kind.grammar, /\d/, 'no numbers');
        assert.doesNotMatch(kind.grammar, /\b(?:Ren|Lyra|Astra|Kael)\b/, 'no names a chat has');
    }
    assert.doesNotMatch(staticText, /\d/);
});

test('grantXp takes the payload MODULES §F5 names', () => {
    const state = party();
    const pc = state.domains.party.pc;
    const one = run(state, 'party.grantXp', { actor: pc, amount: 30 });
    assert.ok(one.ok, one.message);
    assert.equal(pcOf(one.state).xp, 30);
    assert.equal(byName(one.state, 'Astra Vell').xp, 0);
    const quest = run(state, 'party.grantXp', { quest: 'q_ab12cd34', difficulty: 'nightmare' });
    assert.ok(quest.ok, quest.message);
    assert.equal(pcOf(quest.state).xp, 25);
    rejects(run(quest.state, 'party.grantXp', { quest: 'q_ab12cd34', difficulty: 'nightmare' }), 'CLAIMED');
});

test('the same commands from the same state with the same seeds give the same state', () => {
    const play = () => {
        let state = makeState();
        const steps = [
            ['party.create', { name: 'Ren', preset: 'skirmisher' }],
            ['party.addCompanion', { name: 'Lyra', role: 'archer', level: 3 }],
            ['party.grantXp', { kind: 'milestone' }],
        ];
        steps.forEach(([type, payload], index) => { state = run(state, type, payload, { seed: 100 + index }).state; });
        state = capture(state, '~ wound Lyra — an arrow | harm: wound', { seed: 7, carrier: 2 }).state;
        state = capture(state, '+ join Bram — a smith', { seed: 8 }).state;
        return state;
    };
    assert.deepEqual(play(), play());
    assert.deepEqual(part.domains.party.validate(play().domains.party), []);
});
