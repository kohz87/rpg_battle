// v1 parity: for the same inputs, the party part's commands give the numbers v1's pure rules give
// (sheet.newSheet / spendPoints / applyResult, party.newCompanion, growth awards and auto-spend,
// recovery.rest, story.applyWounds). The actor record is read back as a v1 Sheet to compare.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byName, capture, makeState, pcOf, run, withPc } from './helpers/fake-ctx.js';
import { DEFAULT_RULES, makeRules, maxHp } from '../../../src/rules.js';
import { companionStats, companionWeights } from '../../../src/v2/party/formula.js';
import { applyResult, learnSkill, newSheet, spendPoints } from '../../../src/sheet.js';
import { guessFocus } from '../../../src/builds.js';
import { awardParty, awardShare, gainXp, settleCompanions } from '../../../src/growth.js';
import { rest } from '../../../src/recovery.js';
import { applyWounds, parseWounds } from '../../../src/story.js';
import { rulesFrom, toSheet } from '../../../src/v2/party/sheets.js';

const numbers = sheet => ({
    name: sheet.name, level: sheet.level, xp: sheet.xp, points: sheet.points,
    hp: sheet.hp, mp: sheet.mp, sp: sheet.sp, stats: sheet.stats,
    skills: sheet.skills.map(skill => ({ name: skill.name, mastery: skill.mastery, aside: Boolean(skill.aside) })),
    uses: Object.fromEntries(Object.entries(sheet.uses ?? {}).filter(([, n]) => n > 0)),
});

const SPREADS = [
    { STR: 4, VIT: 3, AGI: 1, DEX: 2 },
    { VIT: 3, AGI: 1, DEX: 1, INT: 5 },
    { LUK: 10 },
    { CHA: 2, VIT: 2, INT: 2, STR: 2, DEX: 2 },
];

test('the default settings are v1\'s default rules', () => {
    const rules = rulesFrom({});
    assert.deepEqual(rules.character, DEFAULT_RULES.character);
    assert.equal(rules.xpRate, DEFAULT_RULES.xpRate);
});

test('create: same sheet as v1 newSheet, default and tuned rules', () => {
    for (const settings of [{}, { startPoints: 14 }]) {
        const rules = rulesFrom(settings);
        for (const spread of SPREADS) {
            const points = { ...spread };
            if (settings.startPoints) points.STR = (points.STR ?? 0) + 4;
            const out = run(makeState(), 'party.create', { name: 'Ren', points, skills: ['Power Strike'] }, { settings });
            assert.ok(out.ok, out.message);
            assert.deepEqual(numbers(toSheet(pcOf(out.state))), numbers(newSheet({ name: 'Ren', stats: points, skills: ['Power Strike'] }, rules)));
        }
    }
});

test('spend: same as v1 spendPoints', () => {
    const levelled = run(withPc(), 'party.grantXp', { xp: 300 }).state;
    for (const allocation of [{ STR: 1 }, { VIT: 4, INT: 3 }, { AGI: 12 }, { DEX: 2, LUK: 2, CHA: 2 }]) {
        const out = run(levelled, 'party.spend', { points: allocation });
        assert.ok(out.ok, out.message);
        assert.deepEqual(numbers(toSheet(pcOf(out.state))), numbers(spendPoints(toSheet(pcOf(levelled)), allocation, DEFAULT_RULES)));
    }
});

test('XP: same levels, points and pools as v1 gainXp, at default and tuned growth', () => {
    for (const settings of [{}, { pointsPerLevel: 6, xpBase: 50 }, { maxLevel: 3 }]) {
        const rules = rulesFrom(settings);
        const start = withPc(undefined, { settings });
        for (const xp of [5, 99, 100, 250, 1234]) {
            const out = run(start, 'party.grantXp', { xp }, { settings });
            if (!out.ok) {
                assert.equal(rules.character.maxLevel, 3);
                continue;
            }
            assert.deepEqual(numbers(toSheet(pcOf(out.state))), numbers(gainXp(toSheet(pcOf(start)), xp, rules).sheet));
        }
    }
});

test('awards: same as v1 awardParty, companions settled the same', () => {
    let state = withPc();
    state = run(state, 'party.addCompanion', { name: 'Lyra', role: 'healer', level: 4 }).state;
    state = run(state, 'party.addCompanion', { name: 'Bram', role: 'warrior', level: 2, control: 'player', growth: 'manual' }).state;
    const pc = toSheet(pcOf(state));
    const members = ['Lyra', 'Bram'].map(name => {
        const actor = byName(state, name);
        // v1's 'command' is a companion whose points are spent by hand (MODULES §F29: growth manual).
        return { id: actor.id, name, control: actor.growth === 'manual' ? 'command' : 'auto', sheet: toSheet(actor) };
    });
    for (const kind of ['minor', 'major', 'milestone']) {
        for (const xpRate of [1, 3]) {
            const rules = makeRules({ xpRate });
            const out = run(state, 'party.grantXp', { kind }, { settings: { xpRate } });
            assert.ok(out.ok, out.message);
            const v1 = awardParty({ pc, members }, awardShare({ kind }, rules), { autoSpend: true, rules });
            assert.deepEqual(numbers(toSheet(pcOf(out.state))), numbers(v1.pc));
            for (const member of v1.members) assert.deepEqual(numbers(toSheet(out.state.domains.party.actors[member.id])), numbers(member.sheet), `${member.name} ${kind}`);
        }
    }
});

test('a fight result: same as v1 applyResult then settleCompanions', () => {
    let state = withPc({ name: 'Ren', preset: 'fighter' });
    state = run(state, 'party.addCompanion', { name: 'Lyra', role: 'archer', level: 3, skills: ['Aimed Shot', 'Poison Dart'] }).state;
    const ids = state.domains.party.order;
    const result = {
        outcome: 'victory',
        party: ids.map(id => ({ memberId: id, hp: { cur: 7, max: state.domains.party.actors[id].hp.max }, mp: { cur: 2, max: state.domains.party.actors[id].mp.max }, sp: { cur: 5, max: state.domains.party.actors[id].sp.max }, conditions: [{ name: 'bleed', rounds: 1 }] })),
        xp: { [ids[0]]: 140, [ids[1]]: 330 },
        uses: { [ids[0]]: { 'Power Strike': 9, Sweep: 40 }, [ids[1]]: { 'Aimed Shot': 3 } },
    };
    const out = run(state, 'party.applyResult', { result });
    assert.ok(out.ok, out.message);
    const v1pc = applyResult(toSheet(pcOf(state)), ids[0], result, DEFAULT_RULES).sheet;
    const v1lyra = applyResult(toSheet(state.domains.party.actors[ids[1]]), ids[1], result, DEFAULT_RULES).sheet;
    const [settled] = settleCompanions([{ id: ids[1], control: 'auto', sheet: v1lyra }], { autoSpend: true, rules: DEFAULT_RULES });
    assert.deepEqual(numbers(toSheet(pcOf(out.state))), numbers(v1pc));
    assert.deepEqual(numbers(toSheet(out.state.domains.party.actors[ids[1]])), numbers(settled.sheet));
    assert.deepEqual(pcOf(out.state).conditions, [{ kind: 'bleeding', stacks: 1 }]);
});

test('a companion: v1 newCompanion\'s skills, pools by v1 rules, stats by the F91 formula', () => {
    for (const [name, role, level, focus, skills] of [['Lyra', 'healer', 6, ['INT', 'VIT', 'CHA'], ['Mend', 'Ward']], ['Bram', 'tank', 1, [], ['Shield Bash']], ['Ilse', 'mage', 12, ['INT'], ['Firebolt', 'Fireball']]]) {
        const state = withPc();
        state.domains.party.actors[state.domains.party.pc].level = level;
        const out = run(state, 'party.addCompanion', { name, role, level, focus, skills });
        assert.ok(out.ok, out.message);
        const made = byName(out.state, name);
        const stats = companionStats({ level, weights: companionWeights({ role, focus: focus.length ? focus : guessFocus(role) }), rules: DEFAULT_RULES });
        assert.deepEqual(made.stats, stats);
        assert.equal(Object.values(made.stats).reduce((a, b) => a + b, 0), 7 * 5 + 10 + 4 * (level - 1), 'what your character has at that level');
        assert.deepEqual(made.hp, { cur: maxHp(stats, level, DEFAULT_RULES), max: maxHp(stats, level, DEFAULT_RULES) });
        assert.deepEqual(made.skills.map(skill => skill.name), skills);
    }
});

test('rest: same as v1 recovery.rest', () => {
    const base = withPc();
    const pc = base.domains.party.pc;
    const state = structuredClone(base);
    Object.assign(state.domains.party.actors[pc], { hp: { cur: 3, max: 98 }, mp: { cur: 1, max: 40 }, sp: { cur: 0, max: 31 }, conditions: [{ kind: 'burn', stacks: 2 }, { kind: 'cursed', stacks: 1 }] });
    for (const kind of ['short', 'long']) {
        const out = run(state, 'party.rest', { kind });
        assert.deepEqual(numbers(toSheet(pcOf(out.state))), numbers(rest(toSheet(pcOf(state)), kind, { gear: [], rules: DEFAULT_RULES })));
    }
});

test('wounds: same HP and conditions as v1 applyWounds', () => {
    const base = withPc();
    const cases = [
        ['~ wound Ren — fell into the weir | harm: scratch', 'Ren — scratch: fell into the weir'],
        ['~ wound Ren — fell into the weir | harm: wound', 'Ren — wound: fell into the weir'],
        ['~ wound Ren — a crossbow bolt | harm: severe', 'Ren — severe: a crossbow bolt'],
        ['~ wound Ren — the bridge gave way | harm: grievous', 'Ren — grievous: the bridge gave way'],
        ['~ wound Ren — the bridge gave way | harm: grave', 'Ren — grievous: the bridge gave way'],
        ['~ wound Ren — poisoned: a bite', 'Ren — poisoned: a bite'],
    ];
    for (const [line, v1line] of cases) {
        const out = capture(base, line, { carrier: 4 });
        assert.ok(out.ok, `${line}: ${out.message}`);
        const v1 = applyWounds({ pc: toSheet(pcOf(base)) }, parseWounds(v1line), DEFAULT_RULES);
        assert.deepEqual(numbers(toSheet(pcOf(out.state))), numbers(v1.pc), line);
        assert.deepEqual(toSheet(pcOf(out.state)).conditions, v1.pc.conditions, line);
    }
    const hurt = capture(base, '~ wound Ren — fell | harm: grievous', { carrier: 1 }).state;
    const healed = capture(hurt, '~ wound Ren — a poultice | heal: wound', { carrier: 2 });
    const v1 = applyWounds({ pc: toSheet(pcOf(hurt)) }, parseWounds('Ren — heal wound: a poultice'), DEFAULT_RULES);
    assert.deepEqual(pcOf(healed.state).hp, v1.pc.hp);
});

test('learning a skill at the cap sets aside as v1 learnSkill does', () => {
    let state = withPc();
    for (const name of ['Power Strike', 'Quick Stab', 'Shield Bash', 'Sweep', 'Aimed Shot', 'Poison Dart']) state = run(state, 'party.learnSkill', { name }).state;
    const out = run(state, 'party.learnSkill', { name: 'Mend', setAside: 'Quick Stab' });
    assert.deepEqual(numbers(toSheet(pcOf(out.state))), numbers(learnSkill(toSheet(pcOf(state)), 'Mend', { rules: DEFAULT_RULES, setAside: 'Quick Stab' })));
});
