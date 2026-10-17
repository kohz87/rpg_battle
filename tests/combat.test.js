// The fight state machine (src/combat.js). Most tests use EXACT rules (every attack hits, no
// variance, no criticals, a fixed initiative die) so damage can be checked to the point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, makeRules, mitigate, xpFactor } from '../src/rules.js';
import { makeRng } from '../src/rng.js';
import { DEFAULT_SKILLS, resolveSkills } from '../src/skills.js';
import { MONSTER_SKILLS, projectEnemy } from '../src/enemies.js';
import { act, availableActions, replay, startFight, summarize } from '../src/combat.js';

const EXACT = makeRules({
    attack: { hitMin: 100, hitMax: 100, varianceLow: 1, varianceHigh: 1, critBase: 0, critPerDex: 0, critPerLuk: 0 },
    initiative: { die: 1 },
});
const tweak = overrides => makeRules({ ...structuredClone(overrides), attack: { ...EXACT.attack, ...(overrides.attack ?? {}) }, initiative: { die: 1 } });

const skills = (names, library = DEFAULT_SKILLS) => resolveSkills(names, library, 3).map(s => ({ ...s, cooldownLeft: 0 }));

function hero(over = {}) {
    return {
        id: 'pc', memberId: 'pc', name: 'Ren', side: 'party', controller: 'player',
        level: 3, rank: null, role: null, boss: false,
        stats: { STR: 10, VIT: 8, AGI: 8, DEX: 8, INT: 8, LUK: 5, CHA: 8 },
        hp: { cur: 100, max: 100 }, mp: { cur: 50, max: 50 },
        patk: 20, matk: 16, pdef: 8, mdef: 8, crit: 0,
        skills: skills(['Power Strike', 'Poison Dart', 'Firebolt', 'Ward']),
        items: [], conditions: [], morale: 0, talks: false, fleesBelow: 0, xp: 0, loot: null, gone: null,
        ...over,
    };
}

function dummy(id = 'e1', over = {}) {
    return {
        id, name: 'Dummy', side: 'enemy', controller: 'auto',
        level: 1, rank: 'F', role: 'brute', boss: false,
        stats: { STR: 5, VIT: 5, AGI: 4, DEX: 5, INT: 5, LUK: 5, CHA: 5 },
        hp: { cur: 200, max: 200 }, mp: { cur: 0, max: 0 },
        patk: 10, matk: 5, pdef: 0, mdef: 0, crit: 0,
        skills: [], items: [], conditions: [], morale: 3, talks: true, fleesBelow: 0,
        xp: 20, loot: 'goblin', gone: null, memberId: null,
        ...over,
    };
}

const setup = (over = {}) => ({ id: 'f1', seed: 'seed-1', party: [hero()], enemies: [dummy()], stakes: 'normal', ...over });
const start = (over = {}, rules = EXACT) => startFight({ ...setup(over), rules });
const get = (f, id) => f.combatants.find(c => c.id === id);
const texts = f => f.log.map(e => e.text);
const hitOnHero = mitigate(10, 8); // the dummy's basic attack against Ren, before rounding

test('a fight starts waiting on the first player-controlled combatant', () => {
    const f = start();
    assert.equal(f.status, 'active');
    assert.equal(f.round, 1);
    assert.deepEqual(f.order, ['pc', 'e1']);
    assert.equal(f.stakes, 'normal');
    assert.equal(typeof f.rngState, 'number');
    assert.deepEqual(f.actions, []);
    assert.equal(f.setup.rules, undefined);
    const a = availableActions(f, EXACT);
    assert.equal(a.actor.id, 'pc');
    assert.deepEqual(a.targets, { enemies: ['e1'], allies: ['pc'] });
    assert.deepEqual(a.skills.map(s => s.name), ['Power Strike', 'Poison Dart', 'Firebolt', 'Ward']);
    assert.ok(a.skills.every(s => s.usable && s.reason === null));
    assert.equal(a.skills.find(s => s.name === 'Ward').target, 'ally');
    assert.equal(a.canParley, true);
    assert.equal(a.canFlee, true);
    assert.ok(a.fleeChance > 0);
});

test('an attack deals mitigated damage, then the enemy answers', () => {
    const f = act(start(), { type: 'attack', target: 'e1' }, EXACT);
    assert.equal(get(f, 'e1').hp.cur, 180);
    assert.equal(get(f, 'pc').hp.cur, 100 - Math.round(hitOnHero));
    assert.ok(texts(f).includes('Ren hits the Dummy for 20.'));
    assert.ok(texts(f).includes(`The Dummy hits Ren for ${Math.round(hitOnHero)}.`));
    assert.equal(f.round, 2);
    assert.equal(availableActions(f, EXACT).actor.id, 'pc');
    assert.deepEqual(f.actions, [{ type: 'attack', target: 'e1' }]);
    assert.equal(f.stats.damageTaken.e1, 20);
});

test('act returns a new fight and never mutates its argument', () => {
    const f = start();
    const before = JSON.stringify(f);
    const next = act(f, { type: 'skill', skill: 'Power Strike', target: 'e1' }, EXACT);
    assert.equal(JSON.stringify(f), before);
    assert.notEqual(next, f);
    assert.notEqual(next.combatants, f.combatants);
});

test('invalid actions throw', () => {
    const f = start({ party: [hero({ mp: { cur: 3, max: 50 } })], enemies: [dummy('e1'), dummy('e2', { hp: { cur: 0, max: 200 } })] });
    assert.throws(() => act(f, { type: 'skill', skill: 'Meteor', target: 'e1' }, EXACT), /no skill/);
    assert.throws(() => act(f, { type: 'skill', skill: 'Power Strike', target: 'e1' }, EXACT), /mp/);
    assert.throws(() => act(f, { type: 'attack', target: 'e2' }, EXACT), /Invalid target/);
    assert.throws(() => act(f, { type: 'attack', target: 'nobody' }, EXACT), /Invalid target/);
    assert.throws(() => act(f, { type: 'attack', target: 'e1', actor: 'e1' }, EXACT), /turn/);
    assert.throws(() => act(f, { type: 'item', item: 'Healing Draught' }, EXACT), /no usable/);
    assert.throws(() => act(f, { type: 'dance' }, EXACT), /Unknown action/);
    assert.equal(get(f, 'e2').gone, 'down');
    const over = act(start({ enemies: [dummy('e1', { hp: { cur: 5, max: 200 } })] }), { type: 'attack', target: 'e1' }, EXACT);
    assert.equal(over.status, 'victory');
    assert.throws(() => act(over, { type: 'attack', target: 'e1' }, EXACT), /over/);
    assert.equal(availableActions(over, EXACT).actor, null);
});

test('a lone enemy is targeted by default; an ally action defaults to self', () => {
    const f = act(start(), { type: 'attack' }, EXACT);
    assert.equal(get(f, 'e1').hp.cur, 180);
    const two = start({ enemies: [dummy('e1'), dummy('e2')] });
    assert.throws(() => act(two, { type: 'attack' }, EXACT), /Invalid target/);
    const warded = act(start(), { type: 'skill', skill: 'Ward' }, EXACT);
    assert.ok(texts(warded).some(t => t.startsWith('Ren uses Ward: shielded') || t.startsWith('Ren casts Ward: shielded')));
});

test('skills cost MP and go on cooldown for the given number of turns', () => {
    let f = act(start(), { type: 'skill', skill: 'Power Strike', target: 'e1' }, EXACT);
    const strike = DEFAULT_SKILLS.find(s => s.name === 'Power Strike');
    assert.equal(get(f, 'pc').mp.cur, 50 - strike.mp);
    assert.equal(get(f, 'e1').hp.cur, 200 - Math.round(20 * strike.power));
    const blocked = availableActions(f, EXACT).skills.find(s => s.name === 'Power Strike');
    assert.deepEqual([blocked.usable, blocked.reason], [false, 'cooldown']);
    assert.throws(() => act(f, { type: 'skill', skill: 'Power Strike', target: 'e1' }, EXACT), /cooldown/);
    f = act(f, { type: 'attack', target: 'e1' }, EXACT);
    assert.equal(availableActions(f, EXACT).skills.find(s => s.name === 'Power Strike').usable, true);
    assert.equal(f.stats.uses.pc['Power Strike'], 1);
    const poor = start({ party: [hero({ mp: { cur: 2, max: 50 } })] });
    assert.equal(availableActions(poor, EXACT).skills.find(s => s.name === 'Power Strike').reason, 'mp');
});

test('defend halves the damage taken until the next turn and gives back MP', () => {
    const base = start({ party: [hero({ mp: { cur: 10, max: 50 } })] });
    const attacked = act(base, { type: 'attack', target: 'e1' }, EXACT);
    const defended = act(base, { type: 'defend' }, EXACT);
    assert.equal(get(attacked, 'pc').hp.cur, 100 - Math.round(hitOnHero));
    assert.equal(get(defended, 'pc').hp.cur, 100 - Math.round(hitOnHero * EXACT.attack.defendTaken));
    assert.equal(get(defended, 'pc').mp.cur, 10 + Math.round(50 * EXACT.attack.defendMpBack));
    assert.ok(!get(defended, 'pc').conditions.some(c => c.name === 'guard'), 'guard ends at the start of the next turn');
    assert.equal(defended.log.find(e => e.kind === 'defend').text, 'Ren defends (+3 MP).');
});

test('physical attacks can miss; spells never do', () => {
    const blind = tweak({ attack: { hitMin: 0, hitMax: 0 } });
    const f = act(start({}, blind), { type: 'attack', target: 'e1' }, blind);
    assert.equal(get(f, 'e1').hp.cur, 200);
    assert.ok(texts(f).includes('Ren misses the Dummy.'));
    const g = act(start({}, blind), { type: 'skill', skill: 'Firebolt', target: 'e1' }, blind);
    assert.ok(get(g, 'e1').hp.cur < 200);
});

test('a critical deals ×1.5 and is a key moment', () => {
    const lucky = tweak({ attack: { critMultiplier: 1.5 } });
    const f = act(start({ party: [hero({ crit: 100 })] }, lucky), { type: 'attack', target: 'e1' }, lucky);
    assert.equal(get(f, 'e1').hp.cur, 170);
    const entry = f.log.find(e => e.kind === 'crit');
    assert.equal(entry.text, 'Critical! Ren hits the Dummy for 30.');
    assert.equal(entry.important, true);
});

test('poison ticks at the start of the affected actor\'s turn and wears off', () => {
    let f = act(start(), { type: 'skill', skill: 'Poison Dart', target: 'e1' }, EXACT);
    const dart = Math.round((20 + (8 - 10) * 2) * 0.8);
    const tick = Math.round((20 + (8 - 10) * 2) * EXACT.combat.dot.poison);
    const log = texts(f);
    const tickAt = log.indexOf(`Poison deals ${tick} to the Dummy.`);
    assert.ok(tickAt > log.indexOf('Ren uses Poison Dart on the Dummy for 13.'));
    assert.ok(tickAt < log.findIndex(t => t.startsWith('The Dummy hits Ren')));
    assert.equal(get(f, 'e1').hp.cur, 200 - dart - tick);
    for (let i = 0; i < 3; i++) f = act(f, { type: 'defend' }, EXACT);
    assert.equal(texts(f).filter(t => t.startsWith('Poison deals')).length, 3);
    assert.ok(!get(f, 'e1').conditions.some(c => c.name === 'poison'));
});

test('stun skips a turn', () => {
    const f = act(start({ party: [hero({ skills: skills(['Shield Bash']) })] }), { type: 'skill', skill: 'Shield Bash', target: 'e1' }, EXACT);
    assert.ok(texts(f).includes('The Dummy is stunned and loses the turn.'));
    assert.equal(get(f, 'pc').hp.cur, 100);
    const next = act(f, { type: 'defend' }, EXACT);
    assert.ok(get(next, 'pc').hp.cur < 100);
});

test('slow moves the target to the end of the next rounds', () => {
    const fast = dummy('e1', { stats: { ...dummy().stats, AGI: 20 } });
    let f = start({ party: [hero({ skills: skills(['Frost Shard']) })], enemies: [fast] });
    assert.deepEqual(f.order, ['e1', 'pc']);
    f = act(f, { type: 'skill', skill: 'Frost Shard', target: 'e1' }, EXACT);
    assert.deepEqual(f.order, ['pc', 'e1']);
});

test('weaken cuts the attack, shield absorbs, regen heals', () => {
    const weakened = act(start({ party: [hero({ skills: skills(['Intimidate']) })] }), { type: 'skill', skill: 'Intimidate' }, EXACT);
    assert.equal(get(weakened, 'pc').hp.cur, 100 - Math.round(mitigate(10 * EXACT.combat.weaken, 8)));

    const shielded = act(start(), { type: 'skill', skill: 'Ward', target: 'pc' }, EXACT);
    assert.equal(get(shielded, 'pc').hp.cur, 100);
    assert.ok(texts(shielded).includes('The Dummy hits Ren, but the shield absorbs it.'));
    const shield = get(shielded, 'pc').conditions.find(c => c.name === 'shield');
    assert.equal(shield.power, 16 - Math.round(hitOnHero));

    const rallied = act(start({ party: [hero({ hp: { cur: 50, max: 100 }, skills: skills(['Rally']) })] }), { type: 'skill', skill: 'Rally' }, EXACT);
    const regen = Math.round(16 * EXACT.combat.regen);
    assert.ok(texts(rallied).includes(`Ren regenerates ${regen} HP.`));
    assert.equal(get(rallied, 'pc').hp.cur, 50 - Math.round(hitOnHero) + regen);
});

test('a condition carried in from the sheet ticks for a share of max HP', () => {
    const f = start({ party: [hero({ conditions: [{ name: 'poison', rounds: 2 }] })] });
    const tick = Math.round(100 * EXACT.combat.dotMaxHpShare);
    assert.equal(get(f, 'pc').hp.cur, 100 - tick);
    assert.ok(texts(f).includes(`Poison deals ${tick} to Ren.`));
});

test('a stunned player loses the turn without being asked', () => {
    const f = start({ party: [hero({ conditions: [{ name: 'stun', rounds: 1, power: 0 }] })] });
    assert.equal(f.round, 2);
    assert.ok(texts(f).includes('Ren is stunned and loses the turn.'));
    assert.equal(availableActions(f, EXACT).actor.id, 'pc');
});

test('items heal, restore MP, cure and hurt, and are counted', () => {
    const items = [
        { name: 'Healing Draught', qty: 1, effect: { heal: 30 } },
        { name: 'Mana Tonic', qty: 1, effect: { mp: 20 } },
        { name: 'Antidote', qty: 1, effect: { cure: ['poison'] } },
        { name: 'Ember Flask', qty: 1, effect: { damage: { amount: 25, element: 'fire', target: 'all' } } },
        { name: 'Pebble', qty: 3, effect: null },
    ];
    const base = start({ party: [hero({ hp: { cur: 40, max: 100 }, mp: { cur: 5, max: 50 }, items })], enemies: [dummy('e1'), dummy('e2')] });
    assert.deepEqual(availableActions(base, EXACT).items.map(i => [i.name, i.target]), [['Healing Draught', 'ally'], ['Mana Tonic', 'ally'], ['Antidote', 'ally'], ['Ember Flask', 'all']]);
    let f = act(base, { type: 'item', item: 'Healing Draught', target: 'pc' }, EXACT);
    assert.ok(texts(f).includes('Ren uses Healing Draught: +30 HP.'));
    assert.equal(get(f, 'pc').items[0].qty, 0);
    assert.equal(f.stats.itemsUsed.pc['Healing Draught'], 1);
    assert.throws(() => act(f, { type: 'item', item: 'Healing Draught' }, EXACT), /no usable/);
    f = act(f, { type: 'item', item: 'Mana Tonic' }, EXACT);
    assert.equal(get(f, 'pc').mp.cur, 25);
    f = act(f, { type: 'item', item: 'Ember Flask' }, EXACT);
    assert.equal(get(f, 'e1').hp.cur, 175);
    assert.equal(get(f, 'e2').hp.cur, 175);
    const poisoned = start({ party: [hero({ items, conditions: [{ name: 'poison', rounds: 5, power: 2 }] })] });
    const cured = act(poisoned, { type: 'item', item: 'Antidote' }, EXACT);
    assert.ok(!get(cured, 'pc').conditions.some(c => c.name === 'poison'));
    assert.deepEqual(summarize(cured, EXACT).itemsUsed, { pc: { Antidote: 1 } });
});

test('the party flees as a whole, or wastes the turn trying', () => {
    const sure = tweak({ flee: { min: 100, max: 100 } });
    const fled = act(start({}, sure), { type: 'flee' }, sure);
    assert.equal(fled.status, 'fled');
    assert.ok(fled.log.some(e => e.kind === 'flee' && e.important && e.text === 'Ren escapes!'));
    const result = summarize(fled, sure);
    assert.equal(result.outcome, 'fled');
    assert.deepEqual(result.loot, { items: [], money: 0 });
    const never = tweak({ flee: { min: 0, max: 0 } });
    const stuck = act(start({}, never), { type: 'flee' }, never);
    assert.equal(stuck.status, 'active');
    assert.ok(texts(stuck).includes('Ren tries to flee, but the way is blocked.'));
});

test('an enemy below its flee threshold tries once to run', () => {
    const sure = tweak({ flee: { min: 100, max: 100 } });
    const scared = dummy('e1', { hp: { cur: 100, max: 200 }, fleesBelow: 0.6 });
    const f = act(start({ enemies: [scared] }, sure), { type: 'attack', target: 'e1' }, sure);
    assert.equal(get(f, 'e1').gone, 'fled');
    assert.equal(f.status, 'victory');
    const result = summarize(f, sure);
    assert.deepEqual(result.fled, ['Dummy']);
    assert.equal(result.xp.pc, 0);
    const never = tweak({ flee: { min: 0, max: 0 } });
    let g = act(start({ enemies: [scared] }, never), { type: 'defend' }, never);
    g = act(g, { type: 'defend' }, never);
    assert.equal(texts(g).filter(t => t.includes('tries to flee')).length, 1);
});

test('parley: success withdraws the enemy for half XP and no loot; failure angers it', () => {
    const sure = tweak({ parley: { min: 100, max: 100 } });
    const f = act(start({}, sure), { type: 'parley', target: 'e1' }, sure);
    assert.equal(get(f, 'e1').gone, 'parleyed');
    assert.equal(f.status, 'victory');
    const result = summarize(f, sure);
    assert.deepEqual(result.parleyed, ['Dummy']);
    assert.equal(result.xp.pc, Math.round(20 * xpFactor(3, 1, sure) * sure.parley.xpFactor));
    assert.deepEqual(result.loot, { items: [], money: 0 });
    assert.ok(result.keyMoments.some(m => m.includes('talks the Dummy down')));
    const never = tweak({ parley: { min: 0, max: 0 } });
    const angry = act(start({}, never), { type: 'parley', target: 'e1' }, never);
    assert.equal(get(angry, 'e1').morale, 4);
    assert.ok(texts(angry).includes('The Dummy will not listen to Ren.'));
});

test('beasts cannot be parleyed, nor bosses above half HP', () => {
    const beast = start({ enemies: [dummy('e1', { talks: false })] });
    assert.equal(availableActions(beast, EXACT).canParley, false);
    assert.throws(() => act(beast, { type: 'parley', target: 'e1' }, EXACT), /Invalid target/);
    const boss = start({ enemies: [dummy('e1', { boss: true })] });
    assert.equal(availableActions(boss, EXACT).canParley, false);
    assert.equal(availableActions(boss, EXACT).parleyChance, null);
    const hurtBoss = start({ enemies: [dummy('e1', { boss: true, hp: { cur: 90, max: 200 } })] });
    const a = availableActions(hurtBoss, EXACT);
    assert.equal(a.canParley, true);
    assert.equal(a.parleyChance, 30 + (8 - 3) * 5 + 20);
});

test('auto hands the rest of the fight to the AI and runs it to the end', () => {
    const f = act(start({ enemies: [dummy('e1', { hp: { cur: 60, max: 60 } })] }), { type: 'auto' }, EXACT);
    assert.notEqual(f.status, 'active');
    assert.equal(get(f, 'pc').controller, 'auto');
    assert.deepEqual(f.actions, [{ type: 'auto' }]);
    assert.equal(f.status, 'victory');
});

test('ties in initiative go to the party', () => {
    const twin = dummy('e1', { stats: { ...hero().stats } });
    assert.deepEqual(start({ enemies: [twin] }).order, ['pc', 'e1']);
});

test('defeat: a party member at 0 HP is down, and the fight is lost', () => {
    const f = act(start({ party: [hero({ hp: { cur: 5, max: 100 } })] }), { type: 'attack', target: 'e1' }, EXACT);
    assert.equal(f.status, 'defeat');
    assert.equal(get(f, 'pc').gone, 'down');
    const down = f.log.find(e => e.kind === 'down');
    assert.deepEqual([down.text, down.important], ['Ren is down.', true]);
    const result = summarize(f, EXACT);
    assert.equal(result.outcome, 'defeat');
    assert.equal(result.party[0].down, true);
    assert.deepEqual(result.loot, { items: [], money: 0 });
    assert.ok(result.keyMoments.includes('Ren is down.'));
});

test('a party member at 20% HP or less is a near-death moment', () => {
    const f = act(start({ party: [hero({ hp: { cur: 25, max: 100 } })] }), { type: 'attack', target: 'e1' }, EXACT);
    const entry = f.log.find(e => e.text.startsWith('Ren is badly hurt'));
    assert.equal(entry.text, `Ren is badly hurt (${25 - Math.round(hitOnHero)}/100 HP).`);
    assert.equal(entry.important, true);
});

test('waves join at the start of their round, or early when the field is empty', () => {
    let f = start({ waves: [{ round: 2, enemies: [dummy('e2', { name: 'Wolf' })] }] });
    assert.ok(!get(f, 'e2'));
    f = act(f, { type: 'attack', target: 'e1' }, EXACT);
    assert.equal(f.round, 2);
    assert.ok(get(f, 'e2'));
    assert.ok(f.log.some(e => e.text === 'Reinforcements arrive: the Wolf.' && e.round === 2));
    const early = act(start({ enemies: [dummy('e1', { hp: { cur: 10, max: 200 } })], waves: [{ round: 5, enemies: [dummy('e2')] }] }), { type: 'attack', target: 'e1' }, EXACT);
    assert.equal(early.status, 'active');
    assert.equal(early.round, 2);
    assert.equal(get(early, 'e2').gone, null);
});

test('an auto companion heals a hurt ally; an enemy support heals its side', () => {
    const astra = hero({ id: 'astra', memberId: 'astra', name: 'Astra', controller: 'auto', stats: { ...hero().stats, AGI: 1 }, skills: skills(['Mend', 'Firebolt']) });
    const f = act(start({ party: [hero({ hp: { cur: 30, max: 100 } }), astra] }), { type: 'defend' }, EXACT);
    assert.ok(texts(f).some(t => t.startsWith('Astra casts Mend on Ren: +')));
    assert.ok(get(f, 'pc').hp.cur > 30);

    const priest = dummy('e1', { name: 'Priest', role: 'support', mp: { cur: 30, max: 30 }, matk: 10, skills: skills(['Dark Mending'], MONSTER_SKILLS) });
    const hurt = dummy('e2', { name: 'Brute', hp: { cur: 50, max: 200 } });
    const g = act(start({ enemies: [priest, hurt] }), { type: 'defend' }, EXACT);
    assert.ok(texts(g).some(t => t.startsWith('The Priest casts Dark Mending on the Brute: +')));
});

test('an enemy caster casts its spell when it has the MP', () => {
    const caster = dummy('e1', { name: 'Shaman', mp: { cur: 10, max: 10 }, matk: 12, skills: skills(['Spark'], MONSTER_SKILLS) });
    const f = act(start({ enemies: [caster] }), { type: 'defend' }, EXACT);
    assert.ok(texts(f).some(t => t.startsWith('The Shaman casts Spark on Ren for ')));
    assert.equal(get(f, 'e1').mp.cur, 7);
});

// A realistic fight with the shipped rules: real variance, misses, crits and AI.
function realSetup(seed) {
    const rng = makeRng(`${seed}:setup`);
    const enemies = ['Goblin 1', 'Goblin 2', 'Goblin Shaman'].map((name, i) => projectEnemy({ name }, { rng, id: `e${i + 1}`, library: DEFAULT_SKILLS }));
    const astra = hero({ id: 'astra', memberId: 'astra', name: 'Astra', controller: 'command', skills: skills(['Mend', 'Firebolt', 'Ward']) });
    const items = [{ name: 'Healing Draught', qty: 2, effect: { heal: 30 } }];
    return { id: seed, seed, party: [hero({ items }), astra], enemies, stakes: 'normal', waves: [{ round: 3, enemies: [projectEnemy({ name: 'Wolf' }, { rng, id: 'e4' })] }] };
}

function playScripted(seed, count = 50) {
    let f = startFight({ ...realSetup(seed), rules: DEFAULT_RULES });
    for (let i = 0; i < count && f.status === 'active'; i++) {
        const a = availableActions(f, DEFAULT_RULES);
        const target = a.targets.enemies[0];
        const usable = a.skills.filter(s => s.usable);
        let action;
        if (i % 7 === 3) action = { type: 'defend' };
        else if (i % 9 === 4 && a.items.length) action = { type: 'item', item: a.items[0].name, target: a.actor.id };
        else if (usable.length) {
            const s = usable[i % usable.length];
            action = { type: 'skill', skill: s.name, target: s.target === 'one' ? target : a.actor.id };
        } else action = { type: 'attack', target };
        f = act(f, action, DEFAULT_RULES);
    }
    return f;
}

test('a commanded companion waits for the player too', () => {
    const f = startFight({ ...realSetup('command'), rules: DEFAULT_RULES });
    assert.equal(f.combatants.find(c => c.id === 'astra').controller, 'player');
    const actors = new Set();
    let g = f;
    for (let i = 0; i < 6 && g.status === 'active'; i++) {
        const a = availableActions(g, DEFAULT_RULES);
        actors.add(a.actor.id);
        g = act(g, { type: 'defend' }, DEFAULT_RULES);
    }
    assert.ok(actors.has('pc') && actors.has('astra'));
});

test('replay reproduces the identical fight, roll for roll', () => {
    for (const seed of ['r1', 'r2', 'r3']) {
        const f = playScripted(seed);
        assert.ok(f.actions.length > 2);
        const again = replay({ setup: f.setup, actions: f.actions }, DEFAULT_RULES);
        assert.deepEqual(again, f);
        // Resuming midway gives the same as replaying everything.
        const half = Math.floor(f.actions.length / 2);
        let g = replay({ setup: f.setup, actions: f.actions.slice(0, half) }, DEFAULT_RULES);
        for (const action of f.actions.slice(half)) g = act(g, action, DEFAULT_RULES);
        assert.deepEqual(g, f);
        assert.deepEqual(summarize(again, DEFAULT_RULES), summarize(f, DEFAULT_RULES));
    }
});

test('the seed decides: same seed same fight, another seed another', () => {
    assert.deepEqual(playScripted('same').log, playScripted('same').log);
    assert.notDeepEqual(playScripted('one').log, playScripted('two').log);
});

test('summarize: outcome, time, party, XP per member, loot and key moments', () => {
    let f = startFight({ ...realSetup('sum'), rules: DEFAULT_RULES });
    f = act(f, { type: 'auto' }, DEFAULT_RULES);
    assert.equal(f.status, 'victory');
    const r = summarize(f, DEFAULT_RULES);
    assert.equal(r.outcome, 'victory');
    assert.equal(r.rounds, f.round);
    assert.equal(r.seconds, f.round * DEFAULT_RULES.secondsPerRound);
    assert.equal(r.stakes, 'normal');
    assert.deepEqual(r.party.map(p => p.memberId), ['pc', 'astra']);
    for (const p of r.party) assert.ok(p.hp.max === 100 && Array.isArray(p.conditions) && typeof p.down === 'boolean');
    assert.equal(r.enemies.length, 4);
    assert.deepEqual(Object.keys(r.enemies[0]).sort(), ['gone', 'id', 'level', 'name', 'rank', 'xp']);
    const defeated = f.combatants.filter(c => c.side === 'enemy' && c.gone === 'down');
    assert.deepEqual(r.defeated, defeated.map(c => c.name));
    const expected = Math.round(defeated.reduce((sum, e) => sum + e.xp * xpFactor(3, e.level), 0));
    assert.equal(r.xp.pc, expected);
    assert.equal(r.xp.astra, expected, 'every member gets the full amount');
    assert.ok(r.loot.money > 0);
    assert.deepEqual(summarize(f, DEFAULT_RULES).loot, r.loot, 'loot is seeded from the fight');
    assert.ok(r.keyMoments.length > 0 && r.keyMoments.length <= 6);
    const important = new Set(f.log.filter(e => e.important).map(e => e.text));
    for (const moment of r.keyMoments) assert.ok(important.has(moment), moment);
    assert.ok(r.uses.astra && Object.values(r.uses.astra).every(n => n > 0));
});

test('log lines are short and readable', () => {
    const f = playScripted('readable');
    for (const entry of f.log) {
        assert.match(entry.text, /^[A-Z].*[.!]$/, entry.text);
        assert.ok(entry.text.length <= 90, entry.text);
        assert.ok(['hit', 'miss', 'crit', 'skill', 'heal', 'condition', 'down', 'flee', 'parley', 'item', 'defend', 'info'].includes(entry.kind));
        assert.equal(typeof entry.round, 'number');
    }
});
