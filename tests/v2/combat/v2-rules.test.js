// Wave C build fix: three fight rules RPG Battle v2's setups ask for, so the five presets meet a
// fight's danger alike at every level (v1 fights, and v2 fights stored before them, play as before):
// - hitRule 'relative': DEX against AGI as a share of the two (combat.js relativeDex);
// - spellRule 'roll': a spell rolls to hit too, INT against AGI;
// - the speed offset grows with the character's level (setup: the setting plus the level).
// And the rebalanced presets: fighter and healer a point of AGI more, the caster a point of INT less,
// and every preset a skill that meets a group (the caster's Fireball, the skirmisher's and archer's Volley).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, hitChance, makeRules } from '../../../src/rules.js';
import { PRESETS } from '../../../src/skills.js';
import { RELATIVE_BASE, previewStrike, relativeDex, startFight } from '../../../src/combat.js';
import { buildSetup, fightNumbers } from '../../../src/v2/combat/setup.js';

const stats = (over = {}) => ({ STR: 10, VIT: 8, AGI: 8, DEX: 8, INT: 8, LUK: 5, CHA: 5, ...over });
const fighter = (over = {}) => ({ id: 'pc', memberId: 'pc', name: 'Ren', side: 'party', controller: 'auto', level: 60, stats: stats(), hp: { cur: 5000, max: 5000 }, mp: { cur: 0, max: 0 }, patk: 100, matk: 10, pdef: 10, mdef: 10, crit: 0, skills: [], items: [], conditions: [], ...over });
const foe = (over = {}) => ({ id: 'e1', name: 'Wolf', side: 'enemy', controller: 'auto', level: 99, rank: 'SSS', role: 'skirmisher', stats: stats({ AGI: 90, DEX: 84 }), hp: { cur: 100000, max: 100000 }, mp: { cur: 0, max: 0 }, patk: 1, matk: 1, pdef: 0, mdef: 0, crit: 0, skills: [], items: [], conditions: [], morale: 9, talks: false, fleesBelow: 0, xp: 0, loot: 'beast', gone: null, ...over });

test('relativeDex: the difference counts as a share of the two; at the start stats, as before', () => {
    assert.equal(relativeDex(7, 6, true), 7, 'a mean of RELATIVE_BASE or less: the points as they are');
    assert.equal(relativeDex(7, 6, false), 7);
    // 60 DEX against 90 AGI: a mean of 75, so 30 points short count as 4.
    assert.ok(Math.abs(relativeDex(60, 90, true) - (90 - 30 * RELATIVE_BASE / 75)) < 1e-9);
    assert.equal(hitChance(relativeDex(60, 90, true), 90), 63);
    assert.equal(hitChance(relativeDex(60, 90, false), 90), DEFAULT_RULES.attack.hitMin, 'v1: a 5 % roll');
    const target = foe();
    assert.equal(previewStrike(fighter({ stats: stats({ DEX: 60 }) }), target, null, makeRules(), { relative: true }).hit, 63);
    assert.equal(previewStrike(fighter({ stats: stats({ DEX: 60 }) }), target, null, makeRules()).hit, 5);
});

function swings(over, hero = fighter({ stats: stats({ DEX: 60, AGI: 29 }) })) {
    const f = startFight({ id: 'f1', seed: 'rel', party: [hero], enemies: [foe()], turns: 'timeline', speedOffset: 10, rules: makeRules({ combat: { maxRounds: 30 } }), ...over });
    const mine = f.log.filter(entry => entry.actor === 'pc' && /hits|misses|casts/.test(entry.text));
    return { hits: mine.filter(entry => !/misses/.test(entry.text)).length, all: mine.length };
}

test('with the relative rule a level-60 fighter lands most blows on a swift foe; without it, almost none (v1)', () => {
    const v2 = swings({ hitRule: 'relative' });
    const v1 = swings({});
    assert.ok(v2.hits / v2.all > 0.45, `${v2.hits}/${v2.all}`);
    assert.ok(v1.hits / v1.all < 0.15, `${v1.hits}/${v1.all}`);
});

test('with the spell rule a spell can miss (INT against AGI); without it a spell always lands (v1)', () => {
    const bolt = { name: 'Bolt', type: 'magic', stat: 'INT', power: 1.5, mp: 0, cooldown: 0, target: 'one', effect: null, mastery: 1, cooldownLeft: 0 };
    const mage = fighter({ stats: stats({ INT: 30, AGI: 29 }), matk: 60, skills: [bolt] });
    const v2 = swings({ hitRule: 'relative', spellRule: 'roll' }, mage);
    const v1 = swings({}, mage);
    assert.ok(v2.hits < v2.all, `${v2.hits}/${v2.all}`);
    assert.equal(v1.hits, v1.all);
});

test('every v2 setup asks for both rules, and its speed offset is the setting plus the character\'s level', () => {
    const party = [fighter({ level: 20 })];
    const { setup } = buildSetup({ id: 'fi_00000001', seed: 7, offer: { foes: [{ name: 'Wolf', count: 1, tier: 'even' }] }, party, numbers: fightNumbers({}) });
    assert.equal(setup.hitRule, 'relative');
    assert.equal(setup.spellRule, 'roll');
    assert.equal(setup.speedOffset, 10 + 20);
    const own = buildSetup({ id: 'fi_00000001', seed: 7, offer: { foes: [{ name: 'Wolf', count: 1, tier: 'even' }] }, party, numbers: fightNumbers({ speedOffset: 25 }) }).setup;
    assert.equal(own.speedOffset, 25 + 20);
});

test('the rebalanced presets: recognisable (their lead stat), each with a way to meet a group', () => {
    const by = Object.fromEntries(PRESETS.map(preset => [preset.id, preset]));
    assert.deepEqual(by.fighter.points, { STR: 4, VIT: 2, AGI: 2, DEX: 2 });
    assert.deepEqual(by.skirmisher.points, { STR: 2, VIT: 2, AGI: 2, DEX: 4 });
    assert.deepEqual(by.caster.points, { VIT: 3, AGI: 1, DEX: 2, INT: 4 });
    assert.deepEqual(by.healer.points, { VIT: 3, AGI: 2, INT: 4, CHA: 1 });
    for (const preset of PRESETS) assert.equal(Object.values(preset.points).reduce((a, b) => a + b, 0), DEFAULT_RULES.character.startPoints, preset.id);
    assert.deepEqual(PRESETS.map(preset => preset.skills), [
        ['Power Strike', 'Sweep', 'Second Wind'],
        ['Quick Stab', 'Poison Dart', 'Volley'],
        ['Firebolt', 'Fireball', 'Ward'],
        ['Mend', 'Firebolt', 'Rally'],
        ['Aimed Shot', 'Volley', 'Second Wind'],
    ]);
});
