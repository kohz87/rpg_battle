// The lean player (src/v2/fight/lean.js) plays the fight Auto plays, for calibration. It is held to the engine fight for fight: the
// outcome, the clock, the round, every combatant's HP and standing, and the state the generator ends in (which counts every draw).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFight, actInPlace } from '../../../src/combat.js';
import { DEFAULT_RULES, makeRules } from '../../../src/rules.js';
import { hashSeed, makeRng } from '../../../src/rng.js';
import { formSkill } from '../../../src/v2/fight/forms.js';
import { leanAuto } from '../../../src/v2/fight/lean.js';
import '../../../src/v2/fight/interpret.js';
import { hero, foe } from './golden.js';

import { form, damage, condition } from './helpers/forms.js';

/** What the engine's fight holds at the end: the lean player must say the same. A run past the engine's step cap is null. */
function engine(setup, seed, rules) {
    try {
        const fight = startFight({ ...setup, seed, rules });
        if (fight.status === 'active') actInPlace(fight, { type: 'auto', id: 'ca_00000001' }, rules);
        return fight;
    } catch (error) {
        if (error.message !== 'Fight did not settle.') throw error;
        return null;
    }
}
const members = setup => [...setup.party, ...setup.enemies, ...(setup.waves ?? []).flatMap(wave => wave.enemies)];

/** Seeds played both ways; every field the lean player reports must be the engine's. */
function agree(setup, rules, seeds, label) {
    const play = leanAuto(setup, rules);
    assert.ok(play, `${label}: the lean player takes this setup`);
    const ids = members(setup).map(c => c.id);
    let bails = 0;
    for (let n = 0; n < seeds; n++) {
        const seed = `${label}:${n}`;
        const fight = engine(setup, seed, rules);
        const out = {};
        const answer = play(hashSeed(seed), hashSeed(`${seed}|ca_00000001`), out);
        // A fight the engine cannot settle is one the lean player leaves to it (which then counts it as no win).
        if (!fight) { assert.equal(answer, -1, `${label} seed ${n}: an unsettled fight is left to the engine`); continue; }
        if (answer < 0) { bails++; continue; }
        const where = `${label} seed ${n}`;
        assert.equal(answer, fight.status === 'victory' ? 1 : 0, `${where}: outcome`);
        assert.equal(out.status === 1 ? 'victory' : out.status === 2 ? 'defeat' : out.status === 3 ? 'fled' : 'active', fight.status, `${where}: status`);
        assert.equal(out.round, fight.round, `${where}: round`);
        assert.equal(out.time, fight.time, `${where}: time`);
        assert.equal(out.state, fight.rngState, `${where}: draws`);
        for (const c of fight.combatants) {
            const at = ids.indexOf(c.id);
            assert.ok(at >= 0, `${where}: ${c.id} is a known fighter`);
            assert.equal(out.hp[at], c.hp.cur, `${where}: HP of ${c.id}`);
            assert.equal(Boolean(out.alive[at]), !c.gone && c.hp.cur > 0, `${where}: standing of ${c.id}`);
        }
    }
    return bails;
}

// --- the shipped kinds of form, as the pack writes them ---------------------------------------------------------------------------------
const FORMS = {
    spear: () => form('Brace Spear', 'physical', 'STR', [damage(110)], { sp: 1 }),
    // A v1 cost on a form (the engine only checks it): blocked while the pool holds less.
    paid: () => ({ ...form('Paid Thrust', 'physical', 'STR', [damage(120)], { sp: 1 }), mp: 12 }),
    shiv: () => form('Hidden Shiv', 'physical', 'DEX', [damage(100)], { sp: 2 }),
    bash: () => form('Shield Bash', 'physical', 'STR', [damage(60), condition('daze', 2, 50, 'one')], { sp: 2, cooldown: 1 }),
    surelyDaze: () => form('Cheap Shot', 'physical', 'DEX', [damage(120), condition('daze', 3, 100, 'one')], { sp: 1, cooldown: 2 }),
    ember: () => form('Sacred Ember', 'magic', 'INT', [damage(110, 'magic')], { mp: 2 }),
    dart: () => form('Spark Dart', 'magic', 'INT', [damage(140, 'magic')], { mp: 3, cooldown: 1 }),
    guard: () => form('Slum Instinct', 'buff', 'LUK', [condition('guard', 2, 100, 'self')], { mp: 2, cooldown: 1 }),
    brace: () => form('Parrying Turn', 'physical', 'AGI', [condition('guard', 3, 75, 'self')], { sp: 1, cooldown: 1 }),
    regen: () => form('Prayer of Light', 'buff', 'CHA', [condition('regen', 3, 75, 'self')], { mp: 2, cooldown: 1 }),
    surelyRegen: () => form('Second Wind', 'buff', 'CHA', [condition('regen', 4, 100, 'self')], { mp: 2, cooldown: 2, mastery: 2 }),
    ward: () => form('Mana Shield', 'buff', 'INT', [{ op: 'shield', target: 'self', power: 100 }], { mp: 2, cooldown: 1 }),
    mend: () => form('Cauterize', 'heal', 'INT', [{ op: 'heal', target: 'self', power: 100 }], { mp: 2, cooldown: 1 }),
    mendAlso: () => form('Bind Wounds', 'heal', 'INT', [{ op: 'heal', target: 'self', power: 100 }], { mp: 1, cooldown: 2 }),
    strikeAndMend: () => form('Lifetap', 'physical', 'STR', [damage(130), { op: 'heal', target: 'self', power: 40 }], { sp: 2, cooldown: 1 }),
    strikeAndGuard: () => form('Riposte', 'physical', 'DEX', [damage(120), condition('guard', 2, 100, 'self')], { sp: 2, cooldown: 2 }),
    // Never cast by Auto (a buff that names no condition, a stance that is worth no more than nothing), and never played.
    grit: () => form('Watchman\'s Grit', 'buff', 'VIT', [{ op: 'stat', target: 'self', stat: 'VIT', amount: 2, rounds: 2 }], { mp: 2, cooldown: 1 }),
    footwork: () => form('River-skiff Footwork', 'physical', 'AGI', [{ op: 'stat', target: 'self', stat: 'AGI', amount: 2, rounds: 2 }], { sp: 1 }),
};
const names = Object.keys(FORMS);

const pick = (rng, list) => list[rng.int(0, list.length - 1)];
const stats = (rng, lo, hi) => Object.fromEntries(['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'].map(name => [name, rng.int(lo, hi)]));

/** A stamina pool (some heroes and foes have none), small enough that skills run it dry. */
const staminaOf = (rng, lowest, highest, odds) => (rng.chance(odds) ? (max => ({ sp: { cur: rng.int(0, max), max } }))(rng.int(lowest, highest)) : { sp: undefined });

/** A random fight of the kind the lean player plays: one hero, any foes and waves. */
function randomSetup(rng) {
    const heroSkills = names.filter(() => rng.chance(40)).map(name => FORMS[name]());
    const maxHp = rng.int(40, 200);
    const player = hero({
        id: 'pc', memberId: 'pc', controller: rng.chance(85) ? 'player' : 'auto', level: rng.int(1, 8), stats: stats(rng, 4, 20),
        hp: { cur: rng.chance(70) ? maxHp : rng.int(1, maxHp), max: maxHp }, mp: { cur: rng.int(0, 40), max: 40 }, ...staminaOf(rng, 3, 40, 90),
        patk: rng.int(6, 40), matk: rng.int(4, 30), pdef: rng.int(0, 25), mdef: rng.int(0, 25), crit: rng.int(0, 35), skills: heroSkills,
    });
    const foeOf = id => {
        const hp = rng.int(15, 90);
        const own = rng.chance(30) ? [FORMS[pick(rng, ['shiv', 'spear', 'bash', 'ember', 'guard', 'ward', 'mend', 'strikeAndGuard'])]()] : [];
        const rat = foe(id, {
            name: `Rat ${id}`, stats: stats(rng, 3, 18), hp: { cur: hp, max: hp }, mp: { cur: 20, max: 20 }, ...staminaOf(rng, 2, 30, 80),
            patk: rng.int(3, 30), matk: rng.int(2, 20), pdef: rng.int(0, 20), mdef: rng.int(0, 20), crit: rng.int(0, 30), skills: own,
            fleesBelow: rng.chance(60) ? 0.25 : 0, boss: rng.chance(10),
        });
        return rat;
    };
    const enemies = Array.from({ length: rng.int(1, 6) }, (_, n) => foeOf(`e${n}`));
    const waves = Array.from({ length: rng.int(0, 2) }, (_, w) => ({ round: rng.chance(50) ? rng.int(1, 6) : 1000000, enemies: Array.from({ length: rng.int(1, 3) }, (_, n) => foeOf(`w${w}${n}`)) }));
    return { id: 'fi_00000001', turns: 'timeline', draws: rng.chance(80) ? 'action' : undefined, stunRule: 'daze', hitRule: rng.chance(75) ? 'relative' : undefined,
        spellRule: rng.chance(75) ? 'roll' : undefined, speedOffset: rng.chance(70) ? rng.int(0, 14) : undefined, party: [player], enemies, waves,
        // Half the fights are Auto's with practice (a form not yet played is played once).
        ...(rng.chance(50) ? { autoRule: 'practice' } : {}) };
}

/** A hero with no skills who acts a hundred thousand times for each turn of the foe's, against a foe who is never felled: the engine's step cap. */
const runaway = setup => ({ ...setup, party: [{ ...setup.party[0], skills: [], stats: { ...setup.party[0].stats, AGI: 100000 } }], enemies: [{ ...setup.enemies[0], hp: { cur: 1e9, max: 1e9 } }], waves: [] });
/** Someone's turn is already set (a fight carried over): the engine keeps it, where the lean player would start everyone afresh. */
const withNext = (setup, rng) => {
    const all = members(setup);
    return { ...setup, party: setup.party.map(c => (c === all[0] ? { ...c, next: rng.int(0, 3000) } : c)), enemies: setup.enemies.map((c, i) => (i === 0 ? { ...c, next: rng.int(0, 3000) } : c)) };
};

test('the lean player and the engine play the same fight: random heroes, foes, waves and forms', () => {
    const rng = makeRng('lean-fuzz');
    let fights = 0, bails = 0;
    for (let n = 0; n < 160; n++) {
        let setup = randomSetup(rng);
        const rules = makeRules({ turns: { mode: 'timeline' } });
        // Now and then, the inputs a random hero never makes: a run of turns the engine gives up on, a turn already set for someone.
        if (n % 40 === 7) setup = runaway(setup);
        const preset = n % 40 === 19;
        if (preset) setup = withNext(setup, rng);
        const play = leanAuto(setup, rules);
        if (preset) { assert.equal(play, null, `fuzz${n}: a turn already set is left to the engine`); continue; }
        if (!play) continue;
        const seeds = n % 40 === 7 ? 2 : 8;
        bails += agree(setup, rules, seeds, `fuzz${n}`);
        fights += seeds;
    }
    assert.ok(fights > 800, `${fights} fights compared`);
    assert.ok(bails < fights / 4, `${bails} of ${fights} fights left to the engine`);
});

test('the lean player plays each kind of form, for a hero wounded and fresh', () => {
    for (const kind of names) {
        for (const wounded of [false, true]) {
            const player = hero({ id: 'pc', memberId: 'pc', hp: { cur: wounded ? 25 : 160, max: 160 }, skills: [FORMS[kind](), kind === 'spear' ? FORMS.shiv() : FORMS.spear()] });
            const enemies = [foe('e1', { hp: { cur: 60, max: 60 }, patk: 14 }), foe('e2', { hp: { cur: 45, max: 45 }, patk: 11 }), foe('e3', { hp: { cur: 70, max: 70 }, patk: 16, fleesBelow: 0.4 })];
            const setup = { id: 'fi_00000001', turns: 'timeline', draws: 'action', stunRule: 'daze', hitRule: 'relative', spellRule: 'roll', speedOffset: 11, party: [player], enemies,
                waves: [{ round: 3, enemies: [foe('w1', { hp: { cur: 30, max: 30 } })] }, { round: 1000000, enemies: [foe('w2', { hp: { cur: 30, max: 30 } }), foe('w3', { hp: { cur: 30, max: 30 } })] }] };
            const bails = agree(setup, DEFAULT_RULES, 24, `${kind}${wounded ? '-wounded' : ''}`);
            assert.equal(bails, 0, `${kind}: nothing left to the engine`);
        }
    }
});

test('with practice, the lean player plays each kind of form the engine practises, and leaves to the engine the stat buffs it does not model', () => {
    for (const kind of names) {
        for (const wounded of [false, true]) {
            const player = hero({ id: 'pc', memberId: 'pc', hp: { cur: wounded ? 25 : 160, max: 160 }, skills: [FORMS[kind](), kind === 'spear' ? FORMS.shiv() : FORMS.spear()] });
            const enemies = [foe('e1', { hp: { cur: 60, max: 60 }, patk: 14 }), foe('e2', { hp: { cur: 45, max: 45 }, patk: 11 })];
            const setup = { id: 'fi_00000001', turns: 'timeline', draws: 'action', stunRule: 'daze', hitRule: 'relative', spellRule: 'roll', speedOffset: 11, autoRule: 'practice', party: [player], enemies };
            const bails = agree(setup, DEFAULT_RULES, 24, `practice-${kind}${wounded ? '-wounded' : ''}`);
            if (kind !== 'grit' && kind !== 'footwork') assert.equal(bails, 0, `${kind}: nothing left to the engine`);
        }
    }
});

test('a fight on continuous draws, the pack rules off, and an empty or won field', () => {
    const base = { id: 'fi_00000001', turns: 'timeline', party: [hero({ id: 'pc', memberId: 'pc', skills: [FORMS.spear(), FORMS.mend()] })], enemies: [foe('e1', { hp: { cur: 50, max: 50 } })] };
    agree(base, DEFAULT_RULES, 16, 'continuous');
    agree({ ...base, enemies: [] }, DEFAULT_RULES, 4, 'empty');
    agree({ ...base, enemies: [foe('e1', { hp: { cur: 0, max: 50 } })] }, DEFAULT_RULES, 4, 'down');
    agree({ ...base, party: [hero({ id: 'pc', memberId: 'pc', hp: { cur: 0, max: 100 }, skills: [FORMS.spear()] })] }, DEFAULT_RULES, 4, 'fallen');
    agree({ ...base, enemies: [foe('e1', { hp: { cur: 1e7, max: 1e7 }, patk: 1 })] }, makeRules({ combat: { maxRounds: 6 } }), 4, 'broken-off');
    agree({ ...base, enemies: [], waves: [{ round: 4, enemies: [foe('w1', { hp: { cur: 40, max: 40 } })] }] }, DEFAULT_RULES, 8, 'wave-only');
});

test('a turn the lean player does not play is left to the engine, a setup it does not take is refused', () => {
    // Auto casts this stance (it names a condition the hero lacks) and the form raises a stat: not played here.
    const stance = formSkill({ id: 'pack.t/stance-base', skill: 'pack.t/stance', name: 'Stance', type: 'buff', stat: 'VIT', tier: 0, cost: { mp: 1, sp: 0, cooldown: 1 },
        effects: [{ op: 'condition', target: 'self', kind: 'guard', rounds: 2, chance: 100 }, { op: 'stat', target: 'self', stat: 'VIT', amount: 2, rounds: 2 }], unit: null });
    const setup = { id: 'fi_00000001', turns: 'timeline', draws: 'action', party: [hero({ id: 'pc', memberId: 'pc', skills: [stance] })], enemies: [foe('e1', { hp: { cur: 40, max: 40 } })] };
    const play = leanAuto(setup, DEFAULT_RULES);
    assert.equal(play(hashSeed('a'), hashSeed('a|ca_00000001')), -1);
    const refused = changes => assert.equal(leanAuto({ ...setup, ...changes }, DEFAULT_RULES), null, JSON.stringify(Object.keys(changes)));
    refused({ turns: 'rounds' });
    refused({ party: [setup.party[0], hero({ id: 'ally', memberId: 'ally', controller: 'auto' })] });
    refused({ party: [hero({ id: 'pc', memberId: 'pc', items: [{ name: 'Potion', qty: 1, effect: { heal: 50 } }] })] });
    refused({ party: [hero({ id: 'pc', memberId: 'pc', onHit: ['fire'] })] });
    refused({ party: [hero({ id: 'pc', memberId: 'pc', conditions: [{ name: 'poison', rounds: 2, power: 3 }] })] });
    refused({ party: [hero({ id: 'pc', memberId: 'pc', skills: [formSkill({ id: 'p/c', skill: 'p/c', name: 'Call', type: 'physical', stat: 'STR', tier: 0, cost: { mp: 0, sp: 1, cooldown: 1 }, effects: [damage(100)], unit: { kind: 'summon', class: 'pack.t/wolf', statShare: 50, poolShare: 25, rounds: 2 } }, 0, { class: () => null })] })] });
    refused({ party: [hero({ id: 'pc', memberId: 'pc', skills: [form('Sweep', 'physical', 'STR', [{ op: 'damage', target: 'all', power: 100, element: 'none', damageType: 'physical' }], { sp: 1 })] })] });
    refused({ party: [hero({ id: 'pc', memberId: 'pc', skills: [form('Venom', 'physical', 'DEX', [damage(100), condition('poison', 3, 100, 'one')], { sp: 1 })] })] });
    refused({ party: [hero({ id: 'pc', memberId: 'pc', skills: [{ name: 'Old Strike', type: 'physical', stat: 'STR', power: 1.2, mastery: 1, target: 'one', mp: 0, cooldown: 0, cooldownLeft: 0, effect: null }] })] });
    refused({ party: [hero({ id: 'pc', memberId: 'pc', skills: [FORMS.spear(), FORMS.spear()] })] });
    assert.equal(leanAuto(setup, makeRules({ combat: { maxRounds: 1e6 } })), null);
});

test('a run of turns past the engine\'s step cap is left to the engine, and a turn already set is not overwritten', () => {
    const base = { id: 'fi_00000001', turns: 'timeline', draws: 'action', party: [hero({ id: 'pc', memberId: 'pc', skills: [] })], enemies: [foe('e1', { hp: { cur: 40, max: 40 } })] };
    // Skill-free, quick beyond measure, against a foe who cannot fall: the engine stops at its cap of steps and calls the fight unsettled.
    const endless = runaway(base);
    const seed = 'endless';
    assert.equal(engine(endless, seed, DEFAULT_RULES), null);
    assert.equal(leanAuto(endless, DEFAULT_RULES)(hashSeed(seed), hashSeed(`${seed}|ca_00000001`)), -1);
    // A hero whose turn is set a long way off against a one-HP foe: the foe strikes first, as the engine plays it.
    const late = { ...base, party: [{ ...base.party[0], next: 1000 }], enemies: [foe('e1', { hp: { cur: 1, max: 1 } })] };
    assert.equal(engine(late, 'late', DEFAULT_RULES).status, 'defeat');
    assert.equal(leanAuto(late, DEFAULT_RULES), null);
    assert.equal(leanAuto({ ...base, enemies: [foe('e1', { next: 5 })] }, DEFAULT_RULES), null, 'the same for a foe');
    assert.equal(leanAuto({ ...base, waves: [{ round: 2, enemies: [foe('w1', { next: 5 })] }] }, DEFAULT_RULES), null, 'and for a wave');
});
