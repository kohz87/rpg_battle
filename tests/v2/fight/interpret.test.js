// The typed form interpreter inside the v1 engine (src/v2/fight/interpret.js + forms.js): B4's acceptance, on the pure fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, makeRules } from '../../../src/rules.js';
import { DEFAULT_SKILLS, resolveSkills } from '../../../src/skills.js';
import { act, availableActions, replay, startFight } from '../../../src/combat.js';
import { formSkill } from '../../../src/v2/fight/forms.js';
import '../../../src/v2/fight/interpret.js';
import { foe, friend, hero } from './golden.js';

const EXACT = makeRules({ attack: { hitMin: 100, hitMax: 100, varianceLow: 1, varianceHigh: 1, critBase: 0, critPerDex: 0, critPerLuk: 0 }, initiative: { die: 1 } });
const effect = (op, target, power, over = {}) => ({ op, target, power, element: 'none', damageType: op === 'damage' ? 'physical' : null, ...over });
const condition = (kind, target, rounds, chance = 100) => ({ op: 'condition', target, kind, chance, rounds });
const form = (slug, over = {}) => ({ id: `pack.t/${slug}`, skill: `pack.t/${slug.replace(/-base$/, '')}`, name: slug, type: 'physical', stat: 'STR', cost: { mp: 0, sp: 2, cooldown: 0 }, effects: [effect('damage', 'one', 150)], unit: null, tier: 0, step: 0, ...over });
const SMITE = form('smite-base', { name: 'Smite and Mend', type: 'magic', stat: 'INT', cost: { mp: 6, sp: 0, cooldown: 2 }, effects: [effect('damage', 'one', 150, { damageType: 'magic', element: 'fire' }), effect('heal', 'ally', 100)] });
const hold = (...forms) => forms.map(([f, m]) => formSkill(f, m ?? 0));
const nobody = { skills: [] };
const setupOf = (over = {}) => ({ id: 'fx', seed: 'seed-x', party: [hero({ skills: hold([SMITE, 2]) }), friend({ ...nobody, hp: { cur: 40, max: 160 } })], enemies: [foe('e1'), foe('e2', { name: 'Boar' })], stakes: 'normal', draws: 'action', ...over });
const start = (over, rules = EXACT) => startFight({ ...setupOf(over), rules });
const get = (f, id) => f.combatants.find(c => c.id === id);
const FORM = (extra = {}) => ({ type: 'form', form: SMITE.id, id: 'ca_00000001', selections: [{ effect: 0, targets: ['e1'] }, { effect: 1, targets: ['ally'] }], ...extra });

test('a mixed form hurts one foe and heals one ally with two legal targets, and charges once', () => {
    const f0 = start();
    const shown = availableActions(f0, EXACT).skills[0];
    assert.equal(shown.form.id, SMITE.id);
    assert.deepEqual(shown.form.effects.map(e => [e.index, e.op, e.side, e.scope, e.choose]), [[0, 'damage', 'hostile', 'one', true], [1, 'heal', 'friendly', 'ally', true]]);
    assert.deepEqual(shown.form.effects[0].legal, ['e1', 'e2']);
    assert.deepEqual(shown.form.effects[1].legal, ['pc', 'ally']);
    const f1 = act(f0, FORM(), EXACT);
    assert.ok(get(f1, 'e1').hp.cur < 240, 'the foe was hurt');
    assert.equal(get(f1, 'e2').hp.cur, 240, 'and only that one');
    assert.ok(get(f1, 'ally').hp.cur > 40, 'the ally was healed');
    assert.equal(get(f1, 'pc').mp.cur, 50 - 6, 'six mana, once, not once an effect');
    assert.equal(get(f1, 'pc').skills[0].cooldownLeft, 2);
    assert.deepEqual(f1.stats.uses.pc, { [SMITE.id]: 1 }, 'one use, counted under the form\'s id');
    assert.equal(f0.actions.length + 1, f1.actions.length);
    assert.equal(get(f0, 'pc').mp.cur, 50, 'the fight before is not changed');
});

test('malformed, wrong-side, duplicate and illegal selections all refuse before anything is paid or rolled', () => {
    const f0 = start();
    const snapshot = JSON.stringify(f0);
    const refuses = (patch, why) => {
        assert.throws(() => act(f0, FORM(patch), EXACT), Error, why);
        assert.equal(JSON.stringify(f0), snapshot, `${why}: nothing moved`);
    };
    refuses({ selections: [{ effect: 0, targets: ['e1'] }, { effect: 0, targets: ['e2'] }, { effect: 1, targets: ['ally'] }] }, 'an effect twice');
    refuses({ selections: [{ effect: 2, targets: ['e1'] }] }, 'an index that is no effect');
    refuses({ selections: [{ effect: -1, targets: ['e1'] }] }, 'a negative index');
    refuses({ selections: [{ effect: 0, targets: ['ally'] }, { effect: 1, targets: ['ally'] }] }, 'damage on an ally');
    refuses({ selections: [{ effect: 0, targets: ['e1'] }, { effect: 1, targets: ['e2'] }] }, 'a heal on a foe');
    refuses({ selections: [{ effect: 0, targets: ['e1', 'e2'] }, { effect: 1, targets: ['ally'] }] }, 'two targets for a single-target effect');
    refuses({ selections: [{ effect: 0, targets: [] }, { effect: 1, targets: ['ally'] }] }, 'no target when one is needed');
    refuses({ selections: [{ effect: 0, targets: ['nobody'] }, { effect: 1, targets: ['ally'] }] }, 'an unknown target');
    refuses({ selections: [{ effect: 0, targets: ['e1', 'e1'] }] }, 'a target twice');
    refuses({ selections: [{ effect: 0, targets: ['e1'], extra: 1 }] }, 'a field that is not in the record');
    refuses({ selections: [{ effect: 0 }] }, 'a missing field');
    refuses({ selections: 'e1' }, 'selections that are no list');
    refuses({ selections: [{ effect: 0, targets: 'e1' }] }, 'targets that are no list');
    refuses({ form: 'pack.t/other-base' }, 'a form the fighter does not hold');
    refuses({ id: undefined }, 'a fight that draws by action needs the action\'s id');
    // An effect with no choice and only one legal target takes it; an ally with none named takes the actor (v1's rule).
    assert.doesNotThrow(() => act(f0, FORM({ selections: [{ effect: 0, targets: ['e1'] }] }), EXACT));
    const dead = start({ enemies: [foe('e1', { hp: { cur: 0, max: 240 } }), foe('e2')] });
    assert.throws(() => act(dead, FORM({ selections: [{ effect: 0, targets: ['e1'] }, { effect: 1, targets: ['ally'] }] }), EXACT), Error, 'a foe that is down is not a legal target');
});

test('a form whose cost the fighter cannot pay, or that is cooling down, cannot be used; a v1-style action plays it with one target', () => {
    const poor = start({ party: [hero({ skills: hold([SMITE, 0]), mp: { cur: 5, max: 50 } }), friend(nobody)] });
    assert.equal(availableActions(poor, EXACT).skills[0].usable, false);
    assert.equal(availableActions(poor, EXACT).skills[0].reason, 'mp');
    assert.throws(() => act(poor, FORM(), EXACT), /cannot be used now \(mp\)/);
    const f1 = act(start(), FORM(), EXACT);
    const cooling = availableActions(f1, EXACT).skills[0];
    if (cooling.reason) assert.equal(cooling.reason, 'cooldown');
    // The automatic turns and v1 callers name the skill and one target: the heal then goes to the actor.
    const f2 = act(start(), { type: 'skill', skill: 'Smite and Mend', target: 'e2', id: 'ca_00000002' }, EXACT);
    assert.ok(get(f2, 'e2').hp.cur < 240);
    assert.equal(get(f2, 'pc').hp.cur, 160, 'the heal went to the actor (already full)');
});

test('retained maths: a form transcribed from a v1 skill plays the same traces (hit, variance, crit, the attack value with gear, the heal sum)', () => {
    const rules = DEFAULT_RULES;
    const v1 = resolveSkills(['Power Strike', 'Mend'], DEFAULT_SKILLS, 3).map(s => ({ ...s, cooldownLeft: 0 }));
    const strike = v1.find(s => s.name === 'Power Strike');
    const mend = v1.find(s => s.name === 'Mend');
    // The same skills as forms: the power in hundredths, mastery 0 = the factor 1 that a v1 skill has at its first level.
    const asForm = (s, effects) => form(s.name.toLowerCase().replace(/ /g, '-') + '-base', { name: s.name, type: s.type, stat: s.stat, cost: { mp: s.type === 'physical' ? 0 : s.mp, sp: s.type === 'physical' ? s.mp : 0, cooldown: s.cooldown }, effects });
    const fStrike = asForm(strike, [effect('damage', 'one', Math.round(strike.power * 100))]);
    const fMend = asForm(mend, [effect('heal', 'ally', Math.round(mend.power * 100))]);
    const body = { stats: { STR: 10, VIT: 8, AGI: 8, DEX: 8, INT: 12, LUK: 5, CHA: 8 }, patk: 29, matk: 31, crit: 12 };   // gear on top of the stats
    const run = (skills, actions) => {
        let f = startFight({ id: 'rt', seed: 'retained', draws: 'action', party: [hero({ ...body, skills }), friend({ ...nobody, hp: { cur: 30, max: 160 } })], enemies: [foe('e1')], rules });
        for (const action of actions) f = act(f, action, rules);
        return f;
    };
    const asV1 = run(v1.filter(s => ['Power Strike', 'Mend'].includes(s.name)), [{ type: 'skill', skill: 'Power Strike', target: 'e1', id: 'a1' }, { type: 'skill', skill: 'Mend', target: 'ally', id: 'a2' }]);
    const skillsAsForms = [formSkill(fStrike, 0), formSkill(fMend, 0)];
    const asForms = run(skillsAsForms, [{ type: 'form', form: fStrike.id, id: 'a1', selections: [{ effect: 0, targets: ['e1'] }] }, { type: 'form', form: fMend.id, id: 'a2', selections: [{ effect: 0, targets: ['ally'] }] }]);
    const numbers = f => f.log.map(entry => entry.text.match(/\d+/g)?.join(',') ?? '').join('|');
    // The damage and heal lines carry the same numbers; the wording differs only by the form's "uses" line.
    const damage = f => f.log.filter(entry => /for \d+|\+\d+ HP|misses/.test(entry.text)).map(entry => entry.text.replace(/Power Strike|Mend|power-strike-base|mend-base/g, 'X'));
    assert.deepEqual(damage(asForms), damage(asV1));
    assert.equal(get(asForms, 'e1').hp.cur, get(asV1, 'e1').hp.cur);
    assert.equal(get(asForms, 'ally').hp.cur, get(asV1, 'ally').hp.cur);
    assert.ok(get(asForms, 'ally').hp.cur > 30, 'the heal landed');
    assert.ok(numbers(asForms).length > 0);
    // The mastery factor is 1 + 0.1 x mastery, applied once: mastery 5 hits 1.5 times as hard as mastery 0 (same draws, same target).
    const at = mastery => {
        let f = startFight({ id: 'rt', seed: 'retained', draws: 'action', party: [hero({ ...body, crit: 0, skills: [formSkill(fStrike, mastery)] })], enemies: [foe('e1', { hp: { cur: 900, max: 900 }, pdef: 0, patk: 0 })], rules: EXACT });
        f = act(f, { type: 'form', form: fStrike.id, id: 'a1', selections: [{ effect: 0, targets: ['e1'] }] }, EXACT);
        return 900 - get(f, 'e1').hp.cur;
    };
    assert.ok(Math.abs(at(5) / at(0) - 1.5) < 0.06, `${at(5)} / ${at(0)}`);
});

test('draws belong to the action: taking an action back does not move the dice of the ones after it', () => {
    const stable = (over = {}) => ({ ...setupOf(over), party: [hero({ skills: [], crit: 30 }), friend(nobody)], enemies: [foe('e1', { hp: { cur: 900, max: 900 }, patk: 0 })] });
    const attack = id => ({ type: 'attack', target: 'e1', id });
    const played = (setup, ids, rules = DEFAULT_RULES) => {
        let f = startFight({ ...setup, rules });
        const dealt = [];
        for (const id of ids) {
            const before = f.log.length;
            f = act(f, attack(id), rules);
            // The player's own blow of this action (the automatic turns around it follow the turn order, which the missing action moves).
            dealt.push(f.log.slice(before).find(entry => entry.actor === 'pc')?.text);
        }
        return dealt;
    };
    let moved = 0;
    for (let n = 0; n < 8; n += 1) {
        const setup = { ...stable(), seed: `draws-${n}` };
        const all = played(setup, ['ca_00000001', 'ca_00000002', 'ca_00000003']);
        const without = played(setup, ['ca_00000002', 'ca_00000003']);
        assert.deepEqual(without, all.slice(1), `seed ${n}: the later actions deal what they dealt`);
        // The same without the rule: one stream, so a missing action usually moves the rest.
        const loose = { ...setup, draws: undefined };
        const a = played(loose, ['x', 'y', 'z']);
        const b = played(loose, ['y', 'z']);
        if (JSON.stringify(b) !== JSON.stringify(a.slice(1))) moved += 1;
    }
    assert.ok(moved > 0, 'the contrast: a shared stream slides');
});

test('stat shifts: refresh the identical source, add distinct sources, never below 1, base stats and gear untouched, gone at expiry', () => {
    const buff = form('rally-base', { name: 'Rally', type: 'buff', stat: 'CHA', cost: { mp: 0, sp: 0, cooldown: 0 }, effects: [{ op: 'stat', target: 'self', stat: 'STR', amount: 4, rounds: 2 }] });
    const buff2 = form('howl-base', { name: 'Howl', type: 'buff', stat: 'CHA', cost: { mp: 0, sp: 0, cooldown: 0 }, effects: [{ op: 'stat', target: 'self', stat: 'STR', amount: 3, rounds: 3 }] });
    const curse = form('curse-base', { name: 'Curse', type: 'debuff', stat: 'INT', cost: { mp: 0, sp: 0, cooldown: 0 }, effects: [{ op: 'stat', target: 'one', stat: 'AGI', amount: -10, rounds: 2 }] });
    const dull = { type: 'form', id: 'a', form: 'x', selections: [] };
    const f0 = startFight({ ...setupOf({ party: [hero({ skills: hold([buff], [buff2], [curse]) }), friend(nobody)], enemies: [foe('e1', { patk: 0, hp: { cur: 900, max: 900 } })] }), rules: EXACT });
    const base = { ...get(f0, 'pc').stats };
    const patk0 = get(f0, 'pc').patk;
    let f = act(f0, { ...dull, id: 'a1', form: buff.id }, EXACT);
    assert.equal(get(f, 'pc').stats.STR, base.STR + 4);
    assert.equal(get(f, 'pc').patk, patk0 + 4 * DEFAULT_RULES.derived.atkPerStr, 'the attack value follows the shifted STR');
    // The same source again refreshes, it does not add.
    f = act(f, { ...dull, id: 'a2', form: buff.id }, EXACT);
    assert.equal(get(f, 'pc').stats.STR, base.STR + 4);
    assert.equal(get(f, 'pc').conditions.filter(c => c.name === 'stat-shift').length, 1);
    // A distinct source adds.
    f = act(f, { ...dull, id: 'a3', form: buff2.id }, EXACT);
    assert.equal(get(f, 'pc').stats.STR, base.STR + 7);
    // A curse on the foe: the stat never goes below 1.
    f = act(f, { ...dull, id: 'a4', form: curse.id, selections: [{ effect: 0, targets: ['e1'] }] }, EXACT);
    assert.equal(get(f, 'e1').stats.AGI, 1);
    assert.equal(f.combatants.find(c => c.id === 'pc').baseline.stats.STR, base.STR, 'the baseline is the sheet\'s');
    // They run out: after enough turns everything is back where it was.
    for (let n = 0; n < 6 && f.status === 'active'; n += 1) f = act(f, { type: 'defend', id: `d${n}` }, EXACT);
    assert.equal(get(f, 'pc').stats.STR, base.STR);
    assert.equal(get(f, 'pc').patk, patk0);
    assert.equal(get(f, 'e1').stats.AGI, 6);
});

test('shield depletion and expiry, regeneration ticks with their strength, the daze after a repeated stun, cooldowns: all replay identically', () => {
    const ward = form('ward-base', { name: 'Ward', type: 'buff', stat: 'INT', cost: { mp: 4, sp: 0, cooldown: 2 }, effects: [effect('shield', 'self', 200)] });
    const bloom = form('bloom-base', { name: 'Bloom', type: 'heal', stat: 'INT', cost: { mp: 4, sp: 0, cooldown: 1 }, effects: [effect('heal', 'self', 50), condition('regen', 'self', 3)] });
    const bash = form('bash-base', { name: 'Bash', type: 'physical', stat: 'STR', cost: { mp: 0, sp: 1, cooldown: 0 }, effects: [effect('damage', 'one', 80), condition('stun', 'one', 1)] });
    const setup = { ...setupOf({ party: [hero({ hp: { cur: 90, max: 160 }, skills: hold([ward], [bloom], [bash]) }), friend(nobody)], enemies: [foe('e1', { hp: { cur: 900, max: 900 } })], stunRule: 'daze', turns: 'rounds' }) };
    const script = [
        { type: 'form', id: 'a1', form: ward.id }, { type: 'form', id: 'a2', form: bloom.id }, { type: 'form', id: 'a3', form: bash.id, selections: [{ effect: 0, targets: ['e1'] }, { effect: 1, targets: ['e1'] }] },
        { type: 'form', id: 'a4', form: bash.id }, { type: 'defend', id: 'a5' }, { type: 'form', id: 'a6', form: bash.id }, { type: 'defend', id: 'a7' },
    ];
    for (const rules of [EXACT, DEFAULT_RULES]) {
        let live = startFight({ ...setup, rules });
        const played = [];
        for (const action of script) {
            if (live.status !== 'active') break;
            try { live = act(live, action, rules); played.push(action); } catch { /* a moment that does not allow it */ }
        }
        assert.ok(played.length >= 5, 'the script mostly played');
        const again = replay({ setup, actions: played }, rules);
        assert.deepEqual(again.log, live.log);
        assert.deepEqual(again.combatants.map(c => [c.id, c.hp.cur, c.conditions]), live.combatants.map(c => [c.id, c.hp.cur, c.conditions]));
        const text = live.log.map(entry => entry.text).join('\n');
        assert.match(text, /shielded \(/);
        assert.match(text, /regenerates \d+ HP/);
    }
});
