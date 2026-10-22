// Wave C balance rules (power.js, setup.js): a creature's power is deterministic and kept; a tier
// foe's HP and damage take its powerScale within the clamps; a tier's level is the character's plus
// the offset plus LEVEL_SHIFT, lone foes included; a boss keeps its tier's level, at least the
// character's, never made smaller; rows without a tier keep v1's power.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, suggestRank } from '../../../src/rules.js';
import { DEFAULT_BESTIARY, findCreature } from '../../../src/enemies.js';
import { resolveThreats } from '../../../src/story.js';
import { REFERENCE_POWER, SCALE_MAX, SCALE_MIN, creaturePower, powerScale } from '../../../src/v2/combat/power.js';
import { BAND_LEVELS, HEADCOUNTS, LEVEL_SHIFT, buildSetup, fightNumbers, levelShift, normalizedFoe, offerRows, tierPower, tierXpLevel } from '../../../src/v2/combat/setup.js';
import { foeXpWorth } from '../../../src/combat.js';

const wolf = findCreature(DEFAULT_BESTIARY, 'Wolf');

test('a creature\'s power is deterministic: the same entry, a copy of it, or one with another look give one number', () => {
    const first = creaturePower(wolf);
    assert.ok(first > 0);
    assert.equal(creaturePower(wolf), first);
    assert.equal(creaturePower(structuredClone(wolf)), first);
    assert.equal(creaturePower({ ...structuredClone(wolf), look: 'grey and thin', aliases: [] }), first);
    // A creature that differs in what it fights with is another creature.
    assert.notEqual(creaturePower({ ...wolf, mods: { hp: 2, attack: 1, defence: 1, agi: 1 } }), first);
    assert.equal(creaturePower(null), null);
    assert.equal(powerScale(null), 1);
});

test('two creatures of one name that fight differently each have their own power (made up per chat, a pack\'s)', () => {
    const base = { name: 'Gloom Stalker', generated: true, template: 'beast', level: 5, role: 'brute', mods: { hp: 1, attack: 1, defence: 1, agi: 1 }, talks: false, morale: 3, fleesBelow: 0.25 };
    const slam = { ...base, moves: [{ name: 'Crushing Slam', type: 'physical', stat: 'STR', target: 'all', effect: ['stun', 'bleed'], cooldown: 3 }], skills: [{ name: 'Crushing Slam', type: 'physical', stat: 'STR', target: 'all', effect: ['stun', 'bleed'], cooldown: 3 }] };
    const whimper = { ...base, role: 'skirmisher', moves: [{ name: 'Whimper', type: 'buff', stat: 'VIT', target: 'self', effect: ['shield'], cooldown: 4 }], skills: [{ name: 'Whimper', type: 'buff', stat: 'VIT', target: 'self', effect: ['shield'], cooldown: 4 }] };
    const first = [creaturePower(slam), creaturePower(whimper)];
    assert.notEqual(first[0], first[1]);
    assert.deepEqual([creaturePower(whimper), creaturePower(slam)], [first[1], first[0]], 'whichever is measured first');
});

test('REFERENCE_POWER is the shipped bestiary\'s median power', () => {
    const powers = DEFAULT_BESTIARY.map(entry => creaturePower(entry)).sort((a, b) => a - b);
    const median = (powers[powers.length / 2 - 1] + powers[powers.length / 2]) / 2;
    assert.ok(Math.abs(median - REFERENCE_POWER) < 0.051, `median ${median}, REFERENCE_POWER ${REFERENCE_POWER}`);
});

test('powerScale is √(reference / power) within SCALE_MIN–SCALE_MAX', () => {
    const feeble = { ...wolf, name: 'Feeble Wolf', aliases: [], mods: { hp: 0.05, attack: 0.05, defence: 1, agi: 1 } };
    const mighty = { ...wolf, name: 'Mighty Wolf', aliases: [], mods: { hp: 20, attack: 20, defence: 1, agi: 1 } };
    assert.equal(powerScale(feeble), SCALE_MAX);
    assert.equal(powerScale(mighty), SCALE_MIN);
    for (const entry of DEFAULT_BESTIARY) {
        const scale = powerScale(entry);
        assert.ok(scale >= SCALE_MIN && scale <= SCALE_MAX, `${entry.name} ${scale}`);
        const free = Math.sqrt(REFERENCE_POWER / creaturePower(entry));
        if (free > SCALE_MIN && free < SCALE_MAX) assert.ok(Math.abs(scale - free) < 0.001, entry.name);
    }
});

test('a tier foe takes its scale on HP and attack; a boss is never scaled down; a foe with no tier is untouched', () => {
    const mighty = { ...wolf, name: 'Mighty Wolf', aliases: [], mods: { hp: 20, attack: 20, defence: 1, agi: 1 } };
    const feeble = { ...wolf, name: 'Feeble Wolf', aliases: [], mods: { hp: 0.05, attack: 0.05, defence: 1, agi: 1 } };
    const enemy = { hp: { cur: 100, max: 100 }, patk: 50, matk: 20, pdef: 9 };
    assert.deepEqual(normalizedFoe(enemy, { threat: 'even' }, mighty), { hp: { cur: 60, max: 60 }, patk: 30, matk: 12, pdef: 9 });
    assert.deepEqual(normalizedFoe(enemy, { threat: 'even', boss: true }, mighty), enemy, 'a boss is not made smaller');
    assert.deepEqual(normalizedFoe(enemy, { threat: 'even', boss: true }, feeble), { hp: { cur: 160, max: 160 }, patk: 80, matk: 32, pdef: 9 }, 'but a feeble boss is raised');
    assert.equal(normalizedFoe(enemy, { name: 'Wolf' }, mighty), enemy, 'no tier: v1\'s power');
    assert.deepEqual(normalizedFoe(enemy, { threat: 'even', levelScale: 0.5 }, { ...wolf, mods: undefined, name: 'Plain' }).hp.max, Math.round(100 * 0.5 * powerScale({ ...wolf, mods: undefined, name: 'Plain' })));
});

test('a tier\'s level: offset plus LEVEL_SHIFT, lone foes on the same table (no exception)', () => {
    const offsets = DEFAULT_RULES.threat.offsets;
    for (const tier of Object.keys(LEVEL_SHIFT)) {
        assert.equal(LEVEL_SHIFT[tier].length, BAND_LEVELS.length, tier);
        for (const row of LEVEL_SHIFT[tier]) assert.equal(row.length, HEADCOUNTS.length, tier);
        for (const [band, level] of BAND_LEVELS.entries()) {
            HEADCOUNTS.forEach((count, index) => assert.equal(levelShift(tier, level, count), LEVEL_SHIFT[tier][band][index], `${tier} L${level} ×${count}`));
            const raw = level + offsets[tier] * DEFAULT_RULES.threat.step + LEVEL_SHIFT[tier][band][0];
            if (raw >= 1) assert.equal(tierPower(tier, level, 1).level, Math.min(99, Math.ceil(raw - 1e-9)), `lone ${tier} at ${level}`);
        }
        // Past the last band as at it, and the headcount held to MAX_HEADCOUNT.
        assert.equal(levelShift(tier, 99, 1), LEVEL_SHIFT[tier].at(-1)[0]);
        assert.equal(levelShift(tier, 10, 30), levelShift(tier, 10, 9));
    }
    // Between bands and headcounts, along a straight line.
    const mid = levelShift('even', 7.5, 1);
    const [a, b] = [LEVEL_SHIFT.even[1][0], LEVEL_SHIFT.even[2][0]];
    assert.ok(Math.abs(mid - (a + b) / 2) < 0.011);
    assert.equal(levelShift('nonsense', 10, 1), 0);
    assert.equal(tierPower('nonsense', 10, 1), null);
});

test('below level 1 a tier foe is smaller by v1\'s rule; a fraction of a level, or levels past the cap, by levelScale', () => {
    const low = tierPower('trivial', 1, 9);
    assert.equal(low.level, 1);
    assert.ok(low.scale < 1 && low.scale >= 0.15);
    assert.ok(low.xpLevel < 1);
    const shifts = { even: LEVEL_SHIFT.even.map(row => row.map(() => 0.5)) };
    const half = tierPower('even', 10, 1, { shifts });
    assert.equal(half.level, 11);
    assert.ok(half.levelScale > 0.9 && half.levelScale < 1, JSON.stringify(half));
    const over = tierPower('even', 60, 1, { shifts: { even: LEVEL_SHIFT.even.map(row => row.map(() => 80)) } });
    assert.equal(over.level, 99, 'held at the cap');
    assert.ok(over.levelScale > 1, JSON.stringify(over));
    const further = tierPower('even', 60, 1, { shifts: { even: LEVEL_SHIFT.even.map(row => row.map(() => 120)) } });
    assert.ok(further.levelScale > over.levelScale, 'more levels past the cap, a stronger foe');
});

test('a boss keeps its tier\'s lone level, whole, at least 1 and full size, whatever comes with it', () => {
    for (const tier of Object.keys(LEVEL_SHIFT)) {
        for (const level of [1, 5, 20]) {
            const boss = tierPower(tier, level, 9, { boss: true });
            const lone = tierPower(tier, level, 1);
            assert.equal(boss.level, Math.max(1, Math.round(level + DEFAULT_RULES.threat.offsets[tier] * DEFAULT_RULES.threat.step + levelShift(tier, level, 1))), `${tier} boss at ${level}`);
            assert.ok(Math.abs(boss.level - lone.level) <= 1, 'the tier\'s lone level');
            assert.equal(boss.scale, undefined, 'never shrunk below level 1');
            assert.equal(boss.levelScale, undefined);
            assert.deepEqual(tierPower(tier, level, 1, { boss: true }), boss, 'the headcount does not move a boss');
        }
    }
    const rows = offerRows({ foes: [{ name: 'Ogre', count: 1, tier: 'weak', boss: true }, { name: 'Wolf', count: 3, tier: 'weak' }] }, { pcLevel: 5, bestiary: DEFAULT_BESTIARY });
    assert.equal(rows[0].level, tierPower('weak', 5, 1, { boss: true }).level);
    const party = [{ id: 'pc', memberId: 'pc', name: 'Ren', side: 'party', level: 5, hp: { cur: 50, max: 50 }, mp: { cur: 0, max: 0 }, stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [], items: [], conditions: [] }];
    const { setup } = buildSetup({ id: 'fi_00000001', seed: 3, offer: { foes: [{ name: 'Wolf', count: 1, tier: 'trivial', boss: true }] }, party, numbers: fightNumbers({}) });
    assert.equal(setup.enemies[0].scale, undefined, 'never shrunk below level 1');
});

test('v1 parity where intended: a row with no tier keeps v1\'s level, rank and numbers; resolveThreats is v1\'s', () => {
    const [row] = offerRows({ foes: [{ name: 'Wolf', count: 2 }] }, { pcLevel: 4, bestiary: DEFAULT_BESTIARY });
    assert.deepEqual([row.level, row.rank, row.scale, row.levelScale], [null, null, undefined, undefined]);
    const [made] = offerRows({ foes: [{ name: 'Bog Wight', count: 1 }] }, { pcLevel: 4, bestiary: DEFAULT_BESTIARY });
    assert.equal(made.rank, suggestRank(4));
    // v1's story.resolveThreats is unchanged (v1 runs from main; the v2 tiers are setup.tierPower's).
    assert.deepEqual(resolveThreats([{ name: 'Wolf', count: 1, threat: 'strong' }], 3), [{ name: 'Wolf', count: 1, threat: 'strong', level: 7 }]);
    assert.deepEqual(resolveThreats([{ name: 'Wolf', count: 1, threat: 'weak' }], 1), [{ name: 'Wolf', count: 1, threat: 'weak', level: 1, scale: 0.6, xpLevel: -3 }]);
});

test('a tier foe\'s XP counts from its tier, not from the level the budget gave it', () => {
    const party = level => [{ id: 'pc', memberId: 'pc', name: 'Ren', side: 'party', level, hp: { cur: 500, max: 500 }, mp: { cur: 0, max: 0 }, stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [], items: [], conditions: [] }];
    for (const [tier, factor] of [['trivial', 0.25], ['weak', 0.5], ['even', 1], ['strong', 2], ['deadly', 4]]) {
        for (const level of [1, 20, 60]) {
            const { setup } = buildSetup({ id: 'fi_00000001', seed: 9, offer: { foes: [{ name: 'Wolf', count: 1, tier }] }, party: party(level), numbers: fightNumbers({}) });
            const [foe] = setup.enemies;
            assert.equal(foe.xpLevel, tierXpLevel(tier, level));
            const even = foeXpWorth({ level, xpLevel: level }, level);
            assert.equal(foeXpWorth(foe, level), Math.max(1, Math.round(even * factor)), `${tier} at ${level}: level ${foe.level}`);
        }
    }
});
