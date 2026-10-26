// Offer calibration (src/v2/fight/danger.js) plays its private samples with the lean player (lean.test.js) and, for what that does not
// take, with prepareAuto (src/combat.js): the fight startFight then Auto plays, at a fraction of the cost, differing from it in nothing a
// result can show. This file holds prepareAuto to that, and the whole search to the one main shipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFight, actInPlace, prepareAuto } from '../../../src/combat.js';
import { DEFAULT_RULES, makeRules } from '../../../src/rules.js';
import { formSkill } from '../../../src/v2/fight/forms.js';
import '../../../src/v2/fight/interpret.js';
import { hashSeed } from '../../../src/rng.js';
import { leanAuto } from '../../../src/v2/fight/lean.js';
import { calibrate, autoOutcome, scaled, scaledHp } from '../../../src/v2/fight/danger.js';
import { hero, friend, foe } from './golden.js';
import { form as formOf, damage as damageOf, condition as conditionOf } from './helpers/forms.js';

const form = (name, effects, over = {}) => ({ id: `pack.t/${name}-base`, skill: `pack.t/${name}`, name, type: 'physical', stat: 'STR', cost: { mp: 0, sp: 1, cooldown: 1 }, effects, unit: null, ...over });
const damage = { op: 'damage', target: 'one', power: 150, element: 'none', damageType: 'physical' };
const wolf = form('wolf', [damage]);
const call = formSkill(form('call', [damage], { unit: { kind: 'summon', class: 'pack.t/wolf', statShare: 50, poolShare: 25, rounds: 2 } }), 0,
    { class: () => ({ name: 'Wolf', skills: ['pack.t/wolf'] }), baseForm: () => wolf.id, form: () => wolf });
const mixed = formSkill(form('mixed', [damage, { op: 'heal', target: 'ally', power: 80 },
    { op: 'condition', target: 'one', kind: 'stun', rounds: 2, chance: 70 },
    { op: 'stat', target: 'self', stat: 'STR', amount: 3, rounds: 2 }]), 2);

// Everything a result or a later action reads. The turn strip ahead (`order`) is for a screen, and a trial keeps only the turn in front.
const comparable = f => ({ ...f, order: undefined, turn: undefined, setup: undefined });
const played = (setup, seed, rules) => {
    const fight = startFight({ ...setup, seed, rules });
    if (fight.status === 'active') actInPlace(fight, { type: 'auto', id: 'ca_00000001' }, rules);
    return fight;
};

for (const turns of ['rounds', 'timeline']) for (const draws of [undefined, 'action']) {
    test(`a trial is Auto: ${turns}, ${draws ?? 'continuous'} draws, forms, waves, summons, conditions, gear and items`, () => {
        const setup = { id: 'fi_00000001', turns, draws, stunRule: 'daze', hitRule: 'relative', spellRule: 'roll',
            party: [hero({ skills: [call, mixed], onHit: ['fire', 'poison', 'ice'], conditions: [{ name: 'poison', rounds: 2, power: 3 }],
                items: [{ name: 'Potion', qty: 2, effect: { heal: 80 } }] }), friend({ hp: { cur: 30, max: 160 } })],
            enemies: [foe('e1'), foe('e2', { stats: { STR: 8, VIT: 8, AGI: 30, DEX: 30, INT: 8, LUK: 8, CHA: 8 } })],
            waves: [{ round: 2, enemies: [foe('e1')] }, { round: 5, enemies: [foe('e4')] }] };
        const before = JSON.stringify(setup);
        const trial = prepareAuto(setup, DEFAULT_RULES);
        for (let seed = 0; seed < 48; seed++) {
            const normal = played(setup, seed, DEFAULT_RULES);
            assert.deepEqual(comparable(trial(seed)), comparable(normal), `seed ${seed}`);
            assert.deepEqual(comparable(trial(seed)), comparable(normal), `seed ${seed} again: a trial leaves nothing behind for the next`);
        }
        assert.equal(JSON.stringify(setup), before, 'trials leave their input untouched');
    });
}

test('a trial keeps opening defeats, all-auto openings, empty fields and the round cap', () => {
    for (const party of [[hero({ hp: { cur: 1, max: 160 }, controller: 'auto' })], [hero({ hp: { cur: 0, max: 160 } })], [hero()]]) {
        for (const enemies of [[], [foe('e1', { patk: 1000 })], [foe('e1', { hp: { cur: 100000, max: 100000 } })]]) {
            const setup = { party, enemies, turns: 'timeline', draws: 'action' };
            const rules = makeRules({ combat: { maxRounds: 2 } });
            assert.deepEqual(comparable(prepareAuto(setup, rules)('opening')), comparable(played(setup, 'opening', rules)));
        }
    }
});

test('a trial that cannot settle throws what Auto throws', () => {
    const setup = { party: [hero({ hp: { cur: 1e9, max: 1e9 } })], enemies: [foe('e1', { hp: { cur: 1e9, max: 1e9 }, patk: 0 })], turns: 'timeline', draws: 'action' };
    const rules = makeRules({ combat: { maxRounds: 1e9 } });
    const error = run => { try { run(); } catch (e) { return e.message; } return null; };
    const message = error(() => played(setup, 'slow', rules));
    assert.equal(message, 'Fight did not settle.');
    assert.equal(error(() => prepareAuto(setup, rules)('slow')), message);
});

// --- the whole search --------------------------------------------------------------------------------------------------------------------
// calibrate (danger.js) is the search main shipped, with the lean player and early stops in place of an engine fight for every sample:
// it must choose the very candidate that search chooses.
function engineSearch(setup, target) {
    let best = null;
    const measured = new Map();
    const search = (make, low, high, steps) => {
        for (let step = 0; step < steps; step += 1) {
            const middle = (low + high) / 2;
            const candidate = make(2 ** middle);
            const key = JSON.stringify([...candidate.enemies, ...candidate.waves.flatMap(wave => wave.enemies)].map(enemy => [enemy.hp.max, enemy.patk, enemy.matk]));
            if (!measured.has(key)) {
                let wins = 0;
                for (let seed = 0; seed < 256; seed += 1) if (autoOutcome(candidate, `pinned-danger:sample:${seed}`) === 'victory') wins += 1;
                measured.set(key, wins / 256);
            }
            const rate = measured.get(key);
            const distance = Math.abs(rate - target);
            if (!best || distance < best.distance) best = { candidate, distance, rate };
            if (best.distance <= 0.5 / 256) break;
            if (rate > target) low = middle; else high = middle;
        }
    };
    search(factor => scaled(setup, factor), -7, 7, 12);
    const coarse = best.candidate;
    if (best.distance > 0.5 / 256) search(factor => scaledHp(coarse, factor), -2, 2, 10);
    return best.candidate;
}

const rat = (id, over = {}) => foe(id, { pack: 'pack.t/rat', name: `Rat ${id}`, hp: { cur: 36, max: 36 }, patk: 9, matk: 3, pdef: 3, mdef: 2, crit: 8, fleesBelow: 0.25,
    stats: { STR: 5, VIT: 5, AGI: 8, DEX: 6, INT: 3, LUK: 6, CHA: 3 }, skills: [], ...over });
const pinned = (party, enemies, waves = []) => ({ id: 'fi_00000001', turns: 'timeline', draws: 'action', stunRule: 'daze', hitRule: 'relative', spellRule: 'roll', speedOffset: 11, party, enemies, waves });
const spear = () => formOf('Brace Spear', 'physical', 'STR', [damageOf(110)], { sp: 1 });
const bash = () => formOf('Shield Bash', 'physical', 'STR', [damageOf(60), conditionOf('daze', 2, 50, 'one')], { sp: 2, cooldown: 1 });
const mend = () => formOf('Cauterize', 'heal', 'INT', [{ op: 'heal', target: 'self', power: 100 }], { mp: 2, cooldown: 1 });
const stance = () => formOf('Stance', 'buff', 'VIT', [conditionOf('guard', 2, 100, 'self'), { op: 'stat', target: 'self', stat: 'VIT', amount: 2, rounds: 2 }], { mp: 1, cooldown: 1 });
const fighter = (skills, over = {}) => hero({ id: 'pc', memberId: 'pc', hp: { cur: 90, max: 90 }, patk: 18, pdef: 7, crit: 11.5, skills, ...over });

// A turn already set for someone is the engine's to keep: the lean player refuses the setup, and the search is still the engine's.
test('calibrate chooses what the engine\'s search chooses: a hero whose turn is set a long way off', () => {
    const setup = pinned([{ ...fighter([spear(), mend()]), next: 1000 }], [rat('r1'), rat('r2', { next: 40 }), rat('r3')]);
    assert.equal(leanAuto(setup, DEFAULT_RULES), null);
    assert.deepEqual(calibrate(setup, 0.625), engineSearch(setup, 0.625));
});

// A run past the engine's step cap is no win, in the engine and so in the search (a whole search of them would take minutes, so one seed).
test('a fight the engine cannot settle is no win for the lean player either', () => {
    const endless = pinned([fighter([], { stats: { STR: 10, VIT: 8, AGI: 100000, DEX: 8, INT: 8, LUK: 5, CHA: 8 } })], [rat('r1', { hp: { cur: 1e9, max: 1e9 } })]);
    assert.equal(autoOutcome(endless, 'endless'), 'unsettled');
    assert.equal(leanAuto(endless, DEFAULT_RULES)(hashSeed('endless'), hashSeed('endless|ca_00000001')), -1);
    assert.throws(() => prepareAuto(endless, DEFAULT_RULES)('endless'), /did not settle/);
});

for (const [label, party, target] of [
    ['one hero, the lean player throughout', [fighter([spear(), bash(), mend()])], 0.625],
    ['one hero, a harder target', [fighter([spear(), bash()])], 0.35],
    ['one hero whose stance the lean player leaves to the engine', [fighter([stance(), spear()])], 0.625],
    ['two in the party, all of it left to the engine', [fighter([spear()]), fighter([bash()], { id: 'ally', memberId: 'ally', controller: 'auto' })], 0.625],
]) {
    test(`calibrate chooses what the engine's search chooses: ${label}`, () => {
        const setup = pinned(party, [rat('r1'), rat('r2'), rat('r3'), rat('r4', { hp: { cur: 44, max: 44 } })], [{ round: 1000000, enemies: [rat('r5'), rat('r6')] }]);
        const chosen = calibrate(setup, target);
        const expected = engineSearch(setup, target);
        const stats = candidate => [...candidate.enemies, ...candidate.waves.flatMap(wave => wave.enemies)].map(enemy => [enemy.hp.max, enemy.patk, enemy.matk]);
        assert.deepEqual(stats(chosen), stats(expected));
        assert.deepEqual(chosen, expected);
    });
}
