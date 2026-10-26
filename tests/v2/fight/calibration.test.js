// prepareAuto (src/combat.js) is what offer calibration plays its private samples with: the fight startFight then Auto plays,
// at a fraction of the cost. It may differ from that in nothing a result can show.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFight, actInPlace, prepareAuto } from '../../../src/combat.js';
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
