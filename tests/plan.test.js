// Plans (src/plan.js, 0.5): fights in stages, the party carried from one to the next, and one
// result for the whole plan with what the cleared stages gave.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRules } from '../src/rules.js';
import { DEFAULT_SKILLS, resolveSkills } from '../src/skills.js';
import { act, startFight, summarize } from '../src/combat.js';
import { carryParty, cleanPlan, newPlan, nextStage, planResult, stageDone, stageId } from '../src/plan.js';

const EXACT = makeRules({
    attack: { hitMin: 100, hitMax: 100, varianceLow: 1, varianceHigh: 1, critBase: 0, critPerDex: 0, critPerLuk: 0 },
    initiative: { die: 1 },
});

const skills = names => resolveSkills(names, DEFAULT_SKILLS, 3).map(skill => ({ ...skill, cooldownLeft: 0 }));

function hero(over = {}) {
    return {
        id: 'pc', memberId: 'pc', name: 'Ren', side: 'party', controller: 'player',
        level: 3, rank: null, role: null, boss: false,
        stats: { STR: 10, VIT: 8, AGI: 8, DEX: 8, INT: 8, LUK: 5, CHA: 8 },
        hp: { cur: 100, max: 100 }, mp: { cur: 50, max: 50 },
        patk: 20, matk: 16, pdef: 8, mdef: 8, crit: 0,
        skills: skills(['Power Strike']),
        items: [], conditions: [], morale: 0, talks: false, fleesBelow: 0, xp: 0, loot: null, gone: null,
        ...over,
    };
}

function foe(id, over = {}) {
    return {
        id, name: 'Guard', side: 'enemy', controller: 'auto',
        level: 1, rank: 'F', role: 'brute', boss: false,
        stats: { STR: 5, VIT: 5, AGI: 4, DEX: 5, INT: 5, LUK: 5, CHA: 5 },
        hp: { cur: 30, max: 30 }, mp: { cur: 0, max: 0 },
        patk: 10, matk: 5, pdef: 0, mdef: 0, crit: 0,
        skills: [], items: [], conditions: [], morale: 9, talks: false, fleesBelow: 0,
        xp: 20, loot: 'goblin', gone: null, memberId: null,
        ...over,
    };
}

/** A fight played out: the player's own action each turn (Power Strike while it is ready, else attack). */
function playOut(fight) {
    let f = fight;
    for (let step = 0; f.status === 'active' && step < 200; step++) {
        const actor = f.combatants.find(c => c.id === f.order[f.turn]);
        const target = f.combatants.find(c => c.side === 'enemy' && !c.gone && c.hp.cur > 0)?.id;
        const strike = actor?.skills.find(skill => skill.name === 'Power Strike' && !skill.cooldownLeft && skill.mp <= actor.mp.cur);
        f = act(f, strike ? { type: 'skill', skill: strike.name, target } : { type: 'attack', target }, EXACT);
    }
    return f;
}

const STAGES = [
    { place: 'the gate', text: '2 guard (weak)', rows: [{ name: 'Guard', count: 2, stage: 1 }] },
    { place: 'the yard', text: '3 guard (even)', rows: [{ name: 'Guard', count: 3, stage: 2 }] },
    { place: 'the tower', text: 'guard captain (boss, strong)', rows: [{ name: 'Guard Captain', count: 1, boss: true, stage: 3 }] },
];

const plan = (over = {}) => ({ ...newPlan({ id: 'plan-1', stakes: 'normal', stages: STAGES, fresh: [], origin: { index: 2, date: 'd', swipe: 0 } }), ...over });

/** A stage's Result, as combat.summarize gives it. */
function stageResult(outcome, over = {}) {
    return {
        outcome, rounds: 3, seconds: 18, stakes: 'normal',
        party: [
            { memberId: 'pc', name: 'Ren', level: 4, hp: { cur: 40, max: 62 }, mp: { cur: 10, max: 30 }, down: outcome === 'defeat', conditions: [] },
            { memberId: 'lyra', name: 'Lyra', level: 4, hp: { cur: 0, max: 44 }, mp: { cur: 5, max: 38 }, down: true, conditions: [] },
        ],
        enemies: [{ id: 'e1', name: 'Guard', gone: 'down', xp: 20, level: 3, rank: 'E' }],
        defeated: ['Guard'], fled: [], parleyed: [],
        xp: { pc: 20, lyra: 20 },
        loot: outcome === 'victory' ? { items: [{ name: 'Iron Key', qty: 1, rarity: 'common', kind: 'material' }], money: 10 } : { items: [], money: 0 },
        keyMoments: [`${outcome} moment`],
        uses: { pc: { 'Power Strike': 2 } }, itemsUsed: { pc: { 'Minor Potion': 1 } },
        ...over,
    };
}

test('a stage leaves the party as it ended: HP, MP, cooldowns, conditions and items carry over; nobody heals', () => {
    const potion = { name: 'Minor Potion', qty: 2, effect: { heal: 20 } };
    const party = [
        hero({ hp: { cur: 80, max: 100 }, conditions: [{ name: 'poison', rounds: 9, power: 2 }], items: [potion] }),
        // Lyra went into the plan down: she stays down.
        hero({ id: 'lyra', memberId: 'lyra', name: 'Lyra', controller: 'auto', hp: { cur: 0, max: 60 } }),
    ];
    const first = playOut(startFight({ id: stageId('plan-1', 0), seed: 's1', party, enemies: [foe('e1'), foe('e2')], stakes: 'normal', rules: EXACT }));
    assert.equal(first.status, 'victory');
    const end = first.combatants.find(c => c.id === 'pc');
    const carried = carryParty(first);
    const ren = carried.find(c => c.id === 'pc');
    assert.deepEqual(ren.hp, end.hp, 'HP as the stage left it');
    assert.ok(ren.hp.cur < 80, 'hurt, and not healed');
    assert.deepEqual(ren.mp, end.mp);
    assert.ok(ren.mp.cur < 50, 'MP spent stays spent');
    assert.deepEqual(ren.skills.map(skill => skill.cooldownLeft), end.skills.map(skill => skill.cooldownLeft), 'cooldowns carry over');
    assert.deepEqual(ren.conditions, end.conditions, 'conditions carry over');
    assert.ok(ren.conditions.some(condition => condition.name === 'poison'));
    assert.equal(carried.find(c => c.id === 'lyra').gone, 'down');
    assert.notEqual(ren, end, 'a copy');
    // The next stage is a fight of its own: new foes, round count from the start, the party as carried.
    const second = startFight({ id: stageId('plan-1', 1), seed: 's2', party: carried, enemies: [foe('e1', { name: 'Yard Guard' })], stakes: 'normal', rules: EXACT });
    assert.equal(second.round, 1);
    assert.deepEqual(second.setup.party.find(c => c.id === 'pc').hp, end.hp);
    assert.equal(second.combatants.find(c => c.id === 'lyra').gone, 'down', 'the fallen stay down');
    assert.deepEqual(second.combatants.filter(c => c.side === 'enemy').map(c => c.name), ['Yard Guard']);
});

test('a plan steps through its stages: between after a stage won, Go on to the next, ended by the last', () => {
    const start = plan();
    assert.equal(start.at, 0);
    assert.equal(start.status, 'fighting');
    assert.equal(stageId(start.id, 0), 'plan-1-1');
    const fight = { id: 'plan-1-1', combatants: [{ ...hero(), side: 'party', hp: { cur: 33, max: 100 } }] };
    const one = stageDone(start, fight, stageResult('victory'));
    assert.equal(one.ended, null);
    assert.equal(one.plan.status, 'between');
    assert.deepEqual(one.plan.carry.map(c => c.hp.cur), [33]);
    assert.deepEqual(one.plan.done.map(entry => [entry.fightId, entry.place]), [['plan-1-1', 'the gate']]);
    const two = nextStage(one.plan);
    assert.equal(two.at, 1);
    assert.equal(two.status, 'fighting');
    assert.throws(() => nextStage(two), /no next stage/);
    const last = stageDone(stageDone(two, { id: 'plan-1-2', combatants: [] }, stageResult('victory')).plan, { id: 'x', combatants: [] }, stageResult('victory'));
    assert.equal(last.ended, null, 'the third stage is still to come');
    const finished = stageDone(nextStage(last.plan), { id: 'plan-1-3', combatants: [] }, stageResult('victory'));
    assert.equal(finished.ended, 'victory');
    // A stage lost or fled ends the plan there.
    assert.equal(stageDone(two, { id: 'plan-1-2', combatants: [] }, stageResult('defeat')).ended, 'defeat');
    assert.equal(stageDone(two, { id: 'plan-1-2', combatants: [] }, stageResult('fled')).ended, 'fled');
});

test('all stages won: victory, every stage\'s XP, loot and uses added up; HP as the last stage left it', () => {
    const done = STAGES.map((stage, index) => ({ fightId: `plan-1-${index + 1}`, place: stage.place, result: stageResult('victory', { rounds: index + 2, seconds: (index + 2) * 6, party: [{ memberId: 'pc', name: 'Ren', level: 4, hp: { cur: 50 - index * 10, max: 62 }, mp: { cur: 9, max: 30 }, down: false, conditions: [] }] }) }));
    const result = planResult(plan({ done, at: 2 }), 'victory');
    assert.equal(result.outcome, 'victory');
    assert.equal(result.plan, true);
    assert.equal(result.rounds, 9);
    assert.equal(result.seconds, 54);
    assert.deepEqual(result.xp, { pc: 60, lyra: 60 });
    assert.deepEqual(result.loot, { items: [{ name: 'Iron Key', qty: 3, rarity: 'common', kind: 'material' }], money: 30 });
    assert.deepEqual(result.uses, { pc: { 'Power Strike': 6 } });
    assert.deepEqual(result.itemsUsed, { pc: { 'Minor Potion': 3 } });
    assert.equal(result.party[0].hp.cur, 30, 'the end state');
    assert.deepEqual(result.stages.map(stage => [stage.number, stage.place, stage.outcome, stage.rounds]), [[1, 'the gate', 'victory', 2], [2, 'the yard', 'victory', 3], [3, 'the tower', 'victory', 4]]);
    assert.deepEqual(result.notReached, []);
    assert.equal(result.withdrew, false);
    assert.deepEqual(result.keyMoments, ['victory moment', 'victory moment', 'victory moment']);
});

test('defeat at stage 2: stage 1\'s XP and loot are kept, stage 2 gives what a lost fight gives, stage 3 never happens', () => {
    const done = [
        { fightId: 'plan-1-1', place: 'the gate', result: stageResult('victory') },
        { fightId: 'plan-1-2', place: 'the yard', result: stageResult('defeat', { xp: { pc: 7, lyra: 7 } }) },
    ];
    const result = planResult(plan({ done, at: 1 }), 'defeat');
    assert.equal(result.outcome, 'defeat');
    assert.deepEqual(result.xp, { pc: 27, lyra: 27 }, 'XP for the foes beaten in both stages, as after a lost fight');
    assert.deepEqual(result.loot, { items: [{ name: 'Iron Key', qty: 1, rarity: 'common', kind: 'material' }], money: 10 }, 'loot of the cleared stage only');
    assert.equal(result.party[0].down, true);
    assert.deepEqual(result.stages.map(stage => stage.outcome), ['victory', 'defeat', null]);
    assert.deepEqual(result.notReached, ['the tower']);
});

test('fled at stage 2 ends the plan there, fled; Fall back after stage 1 ends it, withdrew', () => {
    const fled = planResult(plan({ done: [{ place: 'the gate', result: stageResult('victory') }, { place: 'the yard', result: stageResult('fled', { rounds: 2 }) }] }), 'fled');
    assert.equal(fled.outcome, 'fled');
    assert.deepEqual(fled.stages.map(stage => [stage.outcome, stage.rounds]), [['victory', 3], ['fled', 2], [null, 0]]);
    assert.equal(fled.loot.money, 10);
    const back = planResult(plan({ done: [{ place: 'the gate', result: stageResult('victory') }], status: 'between' }), 'withdrew');
    assert.equal(back.outcome, 'withdrew');
    assert.equal(back.withdrew, true);
    assert.deepEqual(back.notReached, ['the yard', 'the tower']);
    assert.deepEqual(back.xp, { pc: 20, lyra: 20 });
    assert.equal(back.loot.money, 10, 'what the cleared stage gave is kept');
    assert.equal(back.party[0].hp.cur, 40, 'as stage 1 left them');
});

test('death stakes are the whole plan\'s: a stage lost is a defeat to the death; the fallen are in the end state', () => {
    const deadly = plan({ stakes: 'death' });
    assert.equal(newPlan({ id: 'x', stakes: 'nonsense', stages: STAGES }).stakes, 'normal');
    const result = planResult({ ...deadly, done: [{ place: 'the gate', result: stageResult('victory') }, { place: 'the yard', result: stageResult('defeat') }] }, 'defeat');
    assert.equal(result.stakes, 'death');
    assert.equal(result.outcome, 'defeat');
    assert.deepEqual(result.party.filter(member => member.down).map(member => member.memberId), ['pc', 'lyra']);
});

test('a stored plan is read only when it is one', () => {
    assert.equal(cleanPlan(null), null);
    assert.equal(cleanPlan({ id: 'p', stages: [STAGES[0]], status: 'fighting', at: 0 }), null, 'one stage is no plan');
    assert.equal(cleanPlan({ ...plan(), status: 'odd' }), null);
    assert.equal(cleanPlan({ ...plan(), at: 5 }), null);
    assert.deepEqual(cleanPlan({ ...plan(), done: 'x' }).done, []);
    assert.equal(newPlan({ id: 'p', stages: [...STAGES, { place: 'nowhere', rows: [] }] }).stages.length, 3, 'a stage without foes is left out');
});
