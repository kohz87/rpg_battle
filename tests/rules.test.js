// Light checks of the formulas in src/rules.js against the numbers in docs/DESIGN.md §5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_RULES, RANKS, STATS, checkModifier, checkModifiers, derive, fleeChance, hitChance, makeRules,
    maxHp, maxMp, mitigate, parleyChance, rarityBudget, suggestRank, xpFactor, xpToNext,
    XP_RATE, clampXpRate, scaleXp, threatStep,
} from '../src/rules.js';

test('makeRules merges objects deeply and replaces arrays', () => {
    const rules = makeRules({ attack: { hitBase: 80 }, masteryUses: [0, 1] });
    assert.equal(rules.attack.hitBase, 80);
    assert.equal(rules.attack.hitMin, DEFAULT_RULES.attack.hitMin);
    assert.deepEqual(rules.masteryUses, [0, 1]);
    assert.equal(makeRules(), DEFAULT_RULES);
});

test('HP, MP and derived combat numbers follow §5.1', () => {
    const stats = { STR: 9, VIT: 7, AGI: 8, DEX: 8, INT: 4, LUK: 5, CHA: 6 };
    assert.equal(maxHp(stats, 4), 30 + 7 * 8 + 4 * 4);
    assert.equal(maxMp(stats, 4), 10 + 4 * 4 + 4 * 2);
    assert.equal(maxHp(stats, 4, DEFAULT_RULES, 10), 30 + 56 + 16 + 10);
    const d = derive(stats, { ATK: 6, DEF: 4 });
    assert.equal(d.patk, 9 * 2 + 6);
    assert.equal(d.pdef, 7 + 4);
    assert.equal(d.matk, 8);
    assert.equal(d.crit, 3 + 8 * 0.5 + 5);
});

test('checks, XP curve and ranks', () => {
    assert.equal(checkModifier(9), 2);
    assert.equal(checkModifier(4), -1);
    assert.equal(checkModifier(1), -2);
    assert.equal(checkModifier(60), 10);
    assert.deepEqual(Object.keys(checkModifiers({})), STATS);
    // (0.5.2) Every level needs 100 by default; a curve can still be set.
    assert.deepEqual([1, 4, 30, 98].map(level => xpToNext(level)), [100, 100, 100, 100]);
    assert.equal(xpToNext(4, makeRules({ character: { xpExponent: 1.5 } })), 800);
    assert.equal(xpToNext(4, makeRules({ character: { xpBase: 50 } })), 50);
    assert.equal(suggestRank(1), 'F');
    assert.equal(suggestRank(5), 'E');
    assert.equal(suggestRank(10), 'C');
    assert.equal(suggestRank(99), 'SSS');
    for (const rank of RANKS) assert.ok(DEFAULT_RULES.ranks[rank], rank);
});

test('ranks grow monotonically', () => {
    for (let i = 1; i < RANKS.length; i++) {
        const [a, b] = [DEFAULT_RULES.ranks[RANKS[i - 1]], DEFAULT_RULES.ranks[RANKS[i]]];
        for (const key of ['level', 'hp', 'attack', 'defence', 'xp']) assert.ok(b[key] > a[key], `${RANKS[i]}.${key}`);
    }
});

test('hit, mitigation, flee and parley are bounded', () => {
    assert.equal(hitChance(8, 8), 75);
    assert.equal(hitChance(100, 0), 95);
    assert.equal(hitChance(0, 100), 5);
    assert.equal(mitigate(0, 10), 0);
    assert.equal(mitigate(10, 10), 5);
    assert.equal(mitigate(1, 1000), 1);
    assert.equal(fleeChance(8, 8), 50);
    assert.equal(fleeChance(8, 8, { boss: true }), 20);
    assert.equal(fleeChance(100, 0), 90);
    assert.equal(parleyChance(6, 4, 1), 40);
    assert.equal(parleyChance(6, 4, 0.4), 60);
    assert.equal(parleyChance(0, 30, 1), 5);
});

test('XP factor and rarity budgets', () => {
    // (0.5.2) ×2 per threat step (4 levels) above, ½ per step below, within 0.1–4.
    assert.equal(xpFactor(5, 5), 1);
    assert.equal(xpFactor(1, 5), 2);
    assert.equal(xpFactor(1, 9), 4);
    assert.equal(xpFactor(5, 1), 0.5);
    assert.equal(xpFactor(1, -7), 0.25, 'a level below 1 (a threat word\'s, before it was held at 1) counts');
    assert.equal(xpFactor(1, 30), 4);
    assert.equal(xpFactor(30, 1), 0.1);
    assert.equal(xpFactor(1, 3, makeRules({ threat: { step: 2 } })), 2, 'the step is rules.threat.step');
    assert.equal(rarityBudget('common', 4), 4);
    assert.equal(rarityBudget('legendary', 5), 22);
    assert.equal(rarityBudget('nonsense', 4), 4);
});

test('the XP rate (0.5.2): 1 by default, 0.25 to 5 on steps of 0.05; scaleXp rounds, never below 1 from 1', () => {
    assert.equal(DEFAULT_RULES.xpRate, 1);
    assert.deepEqual({ ...XP_RATE }, { min: 0.25, max: 5, step: 0.05, default: 1 });
    assert.deepEqual([undefined, null, '', 'fast', 0, 0.1, 0.25, 1.23, 2, 5, 9, -3].map(clampXpRate), [1, 1, 1, 1, 0.25, 0.25, 0.25, 1.25, 2, 5, 5, 0.25]);
    assert.equal(scaleXp(30, makeRules({ xpRate: 2 })), 60);
    assert.equal(scaleXp(30, makeRules({ xpRate: 0.5 })), 15);
    assert.equal(scaleXp(1, makeRules({ xpRate: 0.25 })), 1, 'at least 1 when the base was at least 1');
    assert.equal(scaleXp(0, makeRules({ xpRate: 5 })), 0);
    assert.equal(scaleXp(30, makeRules({ xpRate: 50 })), 150, 'clamped to 5');
    assert.equal(scaleXp(30), 30);
});

test('threatStep: rules.threat.step, or one tier with tier titles on', () => {
    assert.equal(threatStep(DEFAULT_RULES), 4);
    assert.equal(threatStep(makeRules({ threat: { step: 2 } })), 2);
    assert.equal(threatStep(makeRules({ terms: { tiers: { size: 10 } } })), 10);
    assert.equal(threatStep(makeRules({ terms: { tiers: { size: 10, enabled: false } } })), 4);
    const tiers = makeRules({ terms: { tiers: { size: 10 } } });
    assert.equal(xpFactor(1, 11, tiers), 2, 'with tiers a tier up is ×2');
});
