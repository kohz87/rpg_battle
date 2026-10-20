// The fight state machine (src/combat.js). Most tests use EXACT rules (every attack hits, no
// variance, no criticals, a fixed initiative die) so damage can be checked to the point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, makeRules, mitigate, xpToNext } from '../src/rules.js';
import { makeRng } from '../src/rng.js';
import { DEFAULT_SKILLS, resolveSkills } from '../src/skills.js';
import { MONSTER_SKILLS, projectEnemy } from '../src/enemies.js';
import { act, availableActions, foeXpWorth, replay, startFight, summarize } from '../src/combat.js';

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
    // A tenth of level 3's 100, a level-1 foe two levels below (the even band, ×1), half for a parley.
    assert.equal(result.xp.pc, Math.round(xpToNext(3) * 0.1 * 0.5));
    assert.equal(result.xp.pc, 5);
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
    const expected = defeated.reduce((sum, e) => sum + foeXpWorth(e, 3, DEFAULT_RULES), 0);
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

// ---------------------------------------------------------------------------
// Fight XP (0.5.2): a share of each member's next level, by the level gap, boss, parley, rate

test('foeXpWorth: a tenth of the member\'s next level for an even foe, by the level-gap band (0.5.3)', () => {
    const foe = (level, extra = {}) => ({ level, xp: 999, ...extra });
    // Level 1 needs 100 XP (every level does, 0.5.2).
    assert.equal(xpToNext(1), 100);
    assert.equal(foeXpWorth(foe(1), 1), 10, 'even');
    assert.equal(foeXpWorth(foe(1, { xpLevel: -3 }), 1), 5, 'weak at level 1: its level before it was held at 1');
    assert.equal(foeXpWorth(foe(1, { xpLevel: -7 }), 1), 3, 'trivial: 2.5, rounded');
    assert.equal(foeXpWorth(foe(5), 1), 20, 'strong');
    assert.equal(foeXpWorth(foe(9), 1), 40, 'deadly');
    assert.equal(foeXpWorth(foe(30), 1), 40, 'never above ×4');
    assert.equal(foeXpWorth(foe(1, { boss: true }), 1), 30, 'a boss ×3');
    assert.equal(foeXpWorth(foe(1), 1, DEFAULT_RULES, { parleyed: true }), 5, 'a parley half');
    assert.equal(foeXpWorth(foe(1), 1, makeRules({ xpRate: 2 })), 20, 'XP rate ×2');
    assert.equal(foeXpWorth(foe(1), 1, makeRules({ xpRate: 0.5 })), 5, 'XP rate ×0.5');
    // (0.5.2) Every level needs 100, so the same at level 5.
    assert.equal(xpToNext(5), 100);
    assert.equal(foeXpWorth(foe(5), 5), 10);
    assert.equal(foeXpWorth(foe(1), 5), 5, 'weak: 4 levels below');
    assert.equal(foeXpWorth(foe(-9), 5), 3, '14 levels below: trivial, ×¼');
    // Bands, not a curve: +4 to +7 is strong, +8 and up deadly, −3 to +3 even, −4 to −7 weak.
    assert.deepEqual([3, 4, 7, 8, 12].map(gap => foeXpWorth(foe(5 + gap), 5)), [10, 20, 20, 40, 40]);
    assert.deepEqual([-3, -4, -7, -8].map(gap => foeXpWorth(foe(5 + gap), 5)), [10, 5, 5, 3]);
    // A curve set in the rules still counts: a tenth of that level's need.
    const curve = makeRules({ character: { xpExponent: 1.5 } });
    assert.equal(xpToNext(5, curve), 1120);
    assert.equal(foeXpWorth(foe(5), 5, curve), 112);
    assert.equal(foeXpWorth(foe(1), 5, curve), 56);
    assert.equal(foeXpWorth(foe(-9), 5, curve), 28, 'trivial: ×¼ of 112');
    assert.equal(foeXpWorth(foe(1, { xpLevel: -50 }), 1, makeRules({ xpRate: 0.25 })), 1, 'at least 1 while anything is left');
    assert.equal(foeXpWorth(foe(1), 1, makeRules({ xp: { even: 0 } })), 0);
});

test('summarize: fight XP at the XP rate, each member against their own level, no splitting', () => {
    let f = startFight({ ...realSetup('rate'), rules: DEFAULT_RULES });
    f = act(f, { type: 'auto' }, DEFAULT_RULES);
    assert.equal(f.status, 'victory');
    const defeated = f.combatants.filter(c => c.side === 'enemy' && c.gone === 'down');
    const at = rules => defeated.reduce((sum, e) => sum + foeXpWorth(e, 3, rules), 0);
    const base = summarize(f, DEFAULT_RULES).xp.pc;
    assert.equal(base, at(DEFAULT_RULES));
    const double = makeRules({ xpRate: 2 });
    const half = makeRules({ xpRate: 0.5 });
    assert.equal(summarize(f, double).xp.pc, at(double));
    assert.ok(Math.abs(summarize(f, double).xp.pc - 2 * base) <= defeated.length, 'about twice');
    assert.equal(summarize(f, half).xp.astra, at(half));
    assert.ok(Math.abs(summarize(f, half).xp.pc - base / 2) <= defeated.length, 'about half');
    // The rank table's XP plays no part any more.
    const richer = { ...f, combatants: f.combatants.map(c => (c.side === 'enemy' ? { ...c, xp: c.xp * 100 } : c)) };
    assert.equal(summarize(richer, DEFAULT_RULES).xp.pc, base);
    // A member at another level is counted against their own.
    const higher = { ...f, combatants: f.combatants.map(c => (c.memberId === 'astra' ? { ...c, level: 9 } : c)) };
    assert.equal(summarize(higher, DEFAULT_RULES).xp.astra, defeated.reduce((sum, e) => sum + foeXpWorth(e, 9), 0));
    assert.equal(summarize(higher, DEFAULT_RULES).xp.pc, base);
});

// ---- the turn timeline (0.5.14) -------------------------------------------------------------

test('timeline: a fighter twice as fast acts twice as often, with no limit on turns in a row (0.5.14)', () => {
    // Ren AGI 30 + 10 = speed 40; the dummy AGI 10 + 10 = speed 20.
    let f = start({ turns: 'timeline', party: [hero({ stats: { ...hero().stats, AGI: 30 } })], enemies: [dummy('e1', { stats: { ...dummy().stats, AGI: 10 } })] });
    assert.equal(f.turns, 'timeline');
    assert.equal(f.order[0], 'pc');
    const turns = [];
    for (let i = 0; i < 12 && f.status === 'active'; i++) {
        const before = f.log.length;
        f = act(f, { type: 'defend' }, EXACT);
        turns.push('pc', ...f.log.slice(before).filter(e => e.actor === 'e1' && /hits|misses|uses|casts/.test(e.text)).map(() => 'e1'));
    }
    const pc = turns.filter(id => id === 'pc').length;
    const foe = turns.filter(id => id === 'e1').length;
    assert.ok(pc >= foe * 2 - 1 && pc <= foe * 2 + 1, `${pc} turns to ${foe}`);
    // Faster still: four times the speed, four turns in a row.
    let g = start({ turns: 'timeline', party: [hero({ stats: { ...hero().stats, AGI: 70 } })], enemies: [dummy('e1', { stats: { ...dummy().stats, AGI: 10 } })] });
    const run = g.order.indexOf('e1');
    assert.ok(run >= 3, `${run} turns before the foe's`);
});

test('timeline: the strip shows the turns ahead, the current fighter first; slowed halves speed (0.5.14)', () => {
    const f = start({ turns: 'timeline', speedOffset: 0, party: [hero({ stats: { ...hero().stats, AGI: 20 } })], enemies: [dummy('e1', { stats: { ...dummy().stats, AGI: 10 } })] });
    assert.equal(f.order.length, 8);
    assert.equal(f.order[0], 'pc');
    const tally = order => order.reduce((acc, id) => ({ ...acc, [id]: (acc[id] ?? 0) + 1 }), {});
    // Twice the speed: two turns to each of the foe's, whatever the opening jitter.
    const twice = tally(f.order.slice(0, 6));
    assert.deepEqual([twice.pc, twice.e1], [4, 2]);
    // Slowed: the same speed as the foe.
    const slowed = start({ turns: 'timeline', speedOffset: 0, party: [hero({ stats: { ...hero().stats, AGI: 20 }, conditions: [{ name: 'slow', rounds: 9, power: 0 }] })], enemies: [dummy('e1', { stats: { ...dummy().stats, AGI: 10 } })] });
    const counts = tally(slowed.order);
    assert.equal(counts.pc, counts.e1);
});

test('timeline: replays exactly, rounds still pass for waves, and a fight without the flag keeps rounds (0.5.14)', () => {
    const real = { ...realSetup('timeline'), turns: 'timeline' };
    let f = startFight({ ...real, rules: DEFAULT_RULES });
    for (let i = 0; i < 40 && f.status === 'active'; i++) {
        const a = availableActions(f, DEFAULT_RULES);
        f = act(f, { type: 'attack', target: a.targets.enemies[0] }, DEFAULT_RULES);
    }
    assert.notEqual(f.status, 'active');
    assert.deepEqual(replay({ setup: real, actions: f.actions }, DEFAULT_RULES).log, f.log);
    assert.ok(f.log.some(e => /Reinforcements arrive/.test(e.text)), 'the wave joined');
    assert.ok(f.round >= 1);
    assert.equal(startFight({ ...realSetup('timeline'), rules: DEFAULT_RULES }).turns, 'rounds');
});

test('previewStrike and availableActions.previews: hit, damage range and crit by the strike\'s own sums (0.5.15)', async () => {
    const { previewStrike } = await import('../src/combat.js');
    const rules = DEFAULT_RULES;
    const ren = hero({ crit: 12 });
    const foe = dummy('e1', { pdef: 8, mdef: 2 });
    const plain = previewStrike(ren, foe, null, rules);
    const expected = mitigate(ren.patk, 8);
    assert.equal(plain.hit, 75 + (ren.stats.DEX - foe.stats.AGI) * 3);
    assert.equal(plain.low, Math.round(expected * 0.9));
    assert.equal(plain.high, Math.round(expected * 1.1));
    assert.equal(plain.crit, 12);
    // Spells never miss and meet magic defence; guard halves; heals preview nothing.
    const firebolt = ren.skills.find(s => s.name === 'Firebolt');
    assert.equal(previewStrike(ren, foe, firebolt, rules).hit, 100);
    const guarded = previewStrike(ren, { ...foe, conditions: [{ name: 'guard', rounds: 1, power: 0 }] }, null, rules);
    assert.ok(guarded.high <= Math.round(plain.high / 2) + 1);
    assert.equal(previewStrike(ren, foe, ren.skills.find(s => s.name === 'Ward'), rules), null);
    // The fight offers them per target while aiming.
    const f = start({ party: [ren], enemies: [foe, dummy('e2')] }, rules);
    const a = availableActions(f, rules);
    assert.deepEqual(Object.keys(a.previews.attack).sort(), ['e1', 'e2']);
    assert.ok(a.previews.skills['Power Strike'].e1.high > a.previews.attack.e1.high, 'a stronger skill shows more damage');
    assert.equal(a.previews.skills.Ward, undefined);
});

test('stamina (0.5.29): a physical skill costs SP, the rest MP; breath comes back each turn, more on defend', () => {
    const strike = DEFAULT_SKILLS.find(s => s.name === 'Power Strike');
    const fire = DEFAULT_SKILLS.find(s => s.name === 'Firebolt');
    const breath = Math.max(1, Math.round(40 * EXACT.combat.spPerTurn));
    const fresh = start({ party: [hero({ sp: { cur: 40, max: 40 } })] });
    let f = act(fresh, { type: 'skill', skill: 'Power Strike', target: 'e1' }, EXACT);
    assert.equal(get(f, 'pc').mp.cur, 50, 'no MP for a physical skill');
    assert.equal(get(f, 'pc').sp.cur, 40 - strike.mp + breath, 'its cost in stamina, a breath back at the next turn');
    f = act(f, { type: 'skill', skill: 'Firebolt', target: 'e1' }, EXACT);
    assert.equal(get(f, 'pc').mp.cur, 50 - fire.mp, 'magic still costs MP');
    // Out of breath: the physical skill waits, magic does not.
    const winded = start({ party: [hero({ sp: { cur: 0, max: 40 } })] });
    const list = availableActions(winded, EXACT).skills;
    assert.equal(list.find(s => s.name === 'Power Strike').reason, 'sp');
    assert.equal(list.find(s => s.name === 'Firebolt').usable, true);
    // Defending catches one's breath.
    const low = start({ party: [hero({ sp: { cur: 10, max: 40 } })] });
    const before = get(low, 'pc').sp.cur;
    const defended = act(low, { type: 'defend' }, EXACT);
    const back = Math.round(40 * EXACT.attack.defendSpBack);
    assert.equal(get(defended, 'pc').sp.cur, before + back + breath);
    assert.equal(defended.log.find(e => e.kind === 'defend').text, `Ren defends (+${back} SP).`);
    // A combatant without stamina (a monster, an older fight) pays from MP as before.
    const old = act(start(), { type: 'skill', skill: 'Power Strike', target: 'e1' }, EXACT);
    assert.equal(get(old, 'pc').mp.cur, 50 - strike.mp);
});

test('gear elements work in a fight: fire burns on a hit, holy bites the undead harder (0.5.33)', () => {
    const always = tweak({ combat: { ...EXACT.combat, gearEffects: { ...EXACT.combat.gearEffects, chance: 100 } } });
    const burnt = act(start({ party: [hero({ onHit: ['fire'] })] }, always), { type: 'attack', target: 'e1' }, always);
    const burn = get(burnt, 'e1').conditions.find(cond => cond.name === 'burn');
    assert.ok(burn, 'burning');
    assert.equal(burn.power, Math.max(1, Math.round(20 * EXACT.combat.dot.burn)));
    assert.ok(texts(burnt).some(text => /burning \(\d rounds?\), from Ren's fire gear\./.test(text)));
    // No element, no roll: the same fight as before.
    const plain = act(start(), { type: 'attack', target: 'e1' }, EXACT);
    assert.equal(get(plain, 'e1').conditions.length, 0);
    const holy = act(start({ party: [hero({ onHit: ['holy'] })], enemies: [dummy('e1', { name: 'Skeleton', loot: 'undead' })] }), { type: 'attack', target: 'e1' }, EXACT);
    assert.equal(get(holy, 'e1').hp.cur, 200 - Math.round(20 * EXACT.combat.gearEffects.holy));
    const living = act(start({ party: [hero({ onHit: ['holy'] })] }), { type: 'attack', target: 'e1' }, EXACT);
    assert.equal(get(living, 'e1').hp.cur, 180);
});
