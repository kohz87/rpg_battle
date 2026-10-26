import test from 'node:test';
import assert from 'node:assert/strict';
import { startFight, actInPlace, prepareAuto } from '../../../src/combat.js';
import { makeRng, makeRngCache } from '../../../src/rng.js';
import { DEFAULT_RULES, makeRules } from '../../../src/rules.js';
import { formSkill } from '../../../src/v2/fight/forms.js';
import '../../../src/v2/fight/interpret.js';
import { hero, friend, foe } from './golden.js';

const form = (name, effects, over = {}) => ({ id: `pack.t/${name}-base`, skill: `pack.t/${name}`, name, type: 'physical', stat: 'STR', cost: { mp: 0, sp: 1, cooldown: 1 }, effects, unit: null, ...over });
const damage = { op: 'damage', target: 'one', power: 150, element: 'none', damageType: 'physical' };
const wolf = form('wolf', [damage]);
const call = formSkill(form('call', [damage], { unit: { kind: 'summon', class: 'pack.t/wolf', statShare: 50, poolShare: 25, rounds: 2 } }), 0,
    { class: () => ({ name: 'Wolf', skills: ['pack.t/wolf'] }), baseForm: () => wolf.id, form: () => wolf });
const mixed = formSkill(form('mixed', [damage, { op: 'heal', target: 'ally', power: 80 },
    { op: 'condition', target: 'one', kind: 'stun', rounds: 2, chance: 70 },
    { op: 'stat', target: 'self', stat: 'STR', amount: 3, rounds: 2 }]), 2);
const comparable = f => ({ status: f.status, combatants: f.combatants, rngState: f.rngState,
    actions: f.actions, round: f.round, time: f.time, marks: f.marks, logLength: f.log.length });

for (const turns of ['rounds', 'timeline']) for (const draws of [undefined, 'action']) {
    test(`calibration is Auto: ${turns}, ${draws ?? 'continuous'} draws, forms, waves, summons, conditions, gear and items`, () => {
        const setup = { id: 'fi_00000001', turns, draws, stunRule: 'daze', hitRule: 'relative', spellRule: 'roll',
            party: [hero({ skills: [call, mixed], onHit: ['fire', 'poison', 'ice'], conditions: [{ name: 'poison', rounds: 2, power: 3 }],
                items: [{ name: 'Potion', qty: 2, effect: { heal: 80 } }] }), friend({ hp: { cur: 30, max: 160 } })],
            enemies: [foe('e1'), foe('e2', { stats: { STR: 8, VIT: 8, AGI: 30, DEX: 30, INT: 8, LUK: 8, CHA: 8 } })],
            waves: [{ round: 2, enemies: [foe('e1')] }, { round: 5, enemies: [foe('e4')] }] };
        const before = JSON.stringify(setup);
        const trial = prepareAuto(setup, DEFAULT_RULES, { rng: makeRngCache() });
        for (let seed = 0; seed < 48; seed++) {
            const normal = startFight({ ...setup, seed, rules: DEFAULT_RULES });
            if (normal.status === 'active') actInPlace(normal, { type: 'auto', id: 'ca_00000001' });
            const quick = trial(seed);
            assert.deepEqual(comparable(quick), comparable(normal), `seed ${seed}`);
            assert.deepEqual(comparable(trial(seed)), comparable(normal), 'repeat trial has no shared mutable state');
        }
        assert.equal(JSON.stringify(setup), before, 'trials leave their input untouched');
    });
}

test('calibration retains opening defeats, all-auto openings, empty fields and round caps', () => {
    for (const party of [[hero({ hp: { cur: 1, max: 160 }, controller: 'auto' })], [hero({ hp: { cur: 0, max: 160 } })], [hero()]]) {
        for (const enemies of [[], [foe('e1', { patk: 1000 })], [foe('e1', { hp: { cur: 100000, max: 100000 } })]]) {
            const setup = { party, enemies, turns: 'timeline', draws: 'action' };
            const rules = makeRules({ combat: { maxRounds: 2 } });
            const normal = startFight({ ...setup, seed: 'opening', rules });
            if (normal.status === 'active') actInPlace(normal, { type: 'auto', id: 'ca_00000001' }, rules);
            assert.deepEqual(comparable(prepareAuto(setup, rules)('opening')), comparable(normal));
        }
    }
});

test('solo calibration keeps fleeing, waves, DOTs and item use identical to Auto', () => {
    const setup = { id: 'fi_00000001', turns: 'timeline', draws: 'action', stunRule: 'daze', hitRule: 'relative', spellRule: 'roll',
        party: [hero({ hp: { cur: 80, max: 160 }, items: [{ name: 'Potion', qty: 2, effect: { heal: 80 } }],
            conditions: [{ name: 'poison', rounds: 2, power: 3 }] })],
        enemies: [foe('e1'), foe('e2')], waves: [{ round: 2, enemies: [foe('e1')] }, { round: 5, enemies: [foe('e4')] }] };
    const trial = prepareAuto(setup, DEFAULT_RULES, { rng: makeRngCache() });
    for (let seed = 0; seed < 64; seed++) {
        const normal = startFight({ ...setup, seed });
        if (normal.status === 'active') actInPlace(normal, { type: 'auto', id: 'ca_00000001' });
        assert.deepEqual(comparable(trial(seed)), comparable(normal), `seed ${seed}`);
    }
});

test('cached random readers match fresh streams, including interleaving, state resumes and uncached tails', () => {
    const cached = makeRngCache();
    for (let repeat = 0; repeat < 3; repeat++) for (const seed of [0, 123, 'calibration:🐀', null]) {
        const expected = makeRng(seed), actual = cached(seed);
        const interleaved = cached(seed), reference = makeRng(seed);
        for (let n = 0; n < 5000; n++) {
            assert.equal(actual.next(), expected.next());
            assert.equal(actual.int(-4.2, 17.8), expected.int(-4.2, 17.8));
            assert.equal(actual.chance(37), expected.chance(37));
            assert.equal(actual.between(0.8, 1.2), expected.between(0.8, 1.2));
            assert.equal(actual.pick(['a', 'b', 'c']), expected.pick(['a', 'b', 'c']));
            if (n % 7 === 0) assert.equal(interleaved.next(), reference.next());
        }
        assert.equal(actual.state(), expected.state());
        const resumed = cached(actual.state()), fresh = makeRng(expected.state());
        for (let n = 0; n < 100; n++) assert.equal(resumed.next(), fresh.next());
    }
});
