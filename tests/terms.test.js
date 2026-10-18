// Display terms (src/terms.js): labels, tiers, progress, reading a level back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, makeRules, xpToNext } from '../src/rules.js';
import {
    isCustom, levelLabel, levelTag, levelText, maxLevel, numeral, parseLevelLabel, parseRoman, powerOptions, progress,
    progressLabel, termsOf, tierOf, tierStart, xpFromProgress, xpGainText, xpLabel,
} from '../src/terms.js';

const R = DEFAULT_RULES;
const SOUL = makeRules({ terms: { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' }, cap: 100 } });
const POWER = makeRules({ terms: { levelName: 'Soul Power', xpName: 'Power Growth' } });

test('the plain terms: Level and XP, cap 99, nothing custom', () => {
    assert.deepEqual(termsOf(R), { levelName: 'Level', xpName: 'XP', tiers: null, cap: 99, custom: false });
    assert.equal(levelLabel(4, R), 'Level 4');
    assert.equal(levelText(4, R), 'Level 4');
    assert.equal(levelTag(4, R), 'Lv 4');
    assert.equal(xpLabel(R), 'XP');
    assert.equal(maxLevel(R), 99);
    assert.equal(isCustom(R), false);
    assert.equal(isCustom(makeRules({ terms: { cap: 99 } })), false, 'the default cap written out is still plain');
});

test('terms are cleaned: separators out, empty back to the default, tiers checked', () => {
    const t = termsOf(makeRules({ terms: { levelName: '  Rank | x: ', xpName: '', tiers: { size: 0, numerals: 'greek' }, cap: 'nonsense' } }));
    assert.equal(t.levelName, 'Rank x');
    assert.equal(t.xpName, 'XP');
    assert.deepEqual(t.tiers, { size: 10, numerals: 'roman' });
    assert.equal(t.cap, 99);
    assert.equal(t.custom, true);
    assert.equal(termsOf(makeRules({ terms: { tiers: { size: 5, enabled: false } } })).tiers, null);
    assert.equal(maxLevel(makeRules({ terms: { cap: 40 } })), 40);
});

test('numerals and tiers', () => {
    assert.deepEqual([1, 4, 9, 14, 40, 90, 2024].map(n => numeral(n)), ['I', 'IV', 'IX', 'XIV', 'XL', 'XC', 'MMXXIV']);
    assert.equal(numeral(3, 'arabic'), '3');
    assert.deepEqual(['III', 'iv', 'XC', 'IIII', 'boss', ''].map(parseRoman), [3, 4, 90, null, null, null]);
    assert.deepEqual([1, 10, 11, 24, 100].map(level => tierOf(level, SOUL)), [1, 1, 2, 3, 10]);
    assert.deepEqual([1, 2, 3, 11].map(tier => tierStart(tier, SOUL)), [1, 11, 21, 100], 'never above the cap');
});

test('labels with tiers and with names of their own', () => {
    assert.equal(levelLabel(24, SOUL), 'Soul Class III');
    assert.equal(levelText(24, SOUL), 'Soul Class III (Lv 24)');
    assert.equal(levelTag(24, SOUL), 'Soul Class III');
    assert.equal(xpLabel(SOUL), 'Soul Growth');
    assert.equal(levelLabel(4, POWER), 'Soul Power 4');
    assert.equal(levelText(4, POWER), 'Soul Power 4');
    assert.equal(levelTag(4, POWER), 'Soul Power 4');
    const arabic = makeRules({ terms: { levelName: 'Circle', tiers: { size: 5, numerals: 'arabic' } } });
    assert.equal(levelLabel(12, arabic), 'Circle 3');
});

test('progress: XP to the next level, with tiers too (0.5.2), MAX at the cap', () => {
    assert.deepEqual(progress({ level: 4, xp: 310 }, R), { cur: 310, max: xpToNext(4, R), text: `310/${xpToNext(4, R)}`, capped: false });
    assert.equal(progressLabel({ level: 4, xp: 310 }, POWER), `Power Growth 310/${xpToNext(4, R)}`);
    // With tiers the bar beside "Soul Class I (Lv 1)" is the way to level 2, not through the tier.
    assert.deepEqual(progress({ level: 1, xp: 30 }, SOUL), { cur: 30, max: 100, text: '30/100', capped: false });
    assert.equal(progressLabel({ level: 1, xp: 30 }, SOUL), 'Soul Growth 30/100');
    assert.equal(progress({ level: 5, xp: 100 }, SOUL).text, `100/${xpToNext(5, R)}`);
    assert.equal(progress({ level: 10, xp: xpToNext(10, R) - 1 }, SOUL).text, `${xpToNext(10, R) - 1}/${xpToNext(10, R)}`);
    assert.equal(progress({ level: 3, xp: 12.6 }, SOUL).text, `13/${xpToNext(3, R)}`, 'whole numbers only');
    assert.deepEqual(progress({ level: 100, xp: 0 }, SOUL), { cur: 100, max: 100, text: 'MAX', capped: true });
    assert.equal(progress({ level: 99, xp: 5 }, R).text, 'MAX');
    assert.equal(progressLabel({ level: 100 }, SOUL), 'Soul Growth MAX');
});

// What 0.3–0.5.1 wrote with tiers on: the share through the tier, floored to hundredths.
function oldTierShare(level, xp, rules) {
    const size = rules.terms.tiers.size;
    const first = Math.floor((level - 1) / size) * size + 1;
    const target = Math.min(first + size, rules.terms.cap);
    let before = 0;
    let span = 0;
    for (let lv = first; lv < target; lv++) {
        if (lv < level) before += xpToNext(lv, rules);
        span += xpToNext(lv, rules);
    }
    return `${(Math.min(9999, Math.floor((10000 * (before + xp)) / span)) / 100).toFixed(2)}/100`;
}

test('the new progress text reads back exactly, and never has decimals', () => {
    for (const rules of [R, SOUL, POWER]) {
        for (let level = 1; level < 99; level += 3) {
            for (const xp of [0, 1, 17, 250, xpToNext(level, rules) - 1].filter(value => value < xpToNext(level, rules))) {
                const shown = progress({ level, xp }, rules).text;
                assert.doesNotMatch(shown, /\./, `level ${level} xp ${xp}: ${shown}`);
                assert.equal(xpFromProgress(shown, level, rules), xp, `level ${level} xp ${xp}`);
            }
        }
    }
    assert.equal(xpFromProgress('310/800', 4, R), 310);
    assert.equal(xpFromProgress('30/100', 1, SOUL), 30, 'a whole number with tiers is plain XP');
    assert.equal(xpFromProgress('MAX', 4, SOUL), 0);
});

test('an older block\'s tier share (with decimals) still reads back to the XP it stood for', () => {
    // Stable as before: the XP read back gives the same old share again, and no more than was there.
    for (let level = 1; level < 100; level += 3) {
        for (const xp of [0, 1, 17, 250, xpToNext(level, R) - 1].filter(value => value < xpToNext(level, R))) {
            const shown = oldTierShare(level, xp, SOUL);
            const back = xpFromProgress(shown, level, SOUL);
            assert.ok(back <= xp && back >= 0, `level ${level} xp ${xp}: ${back}`);
            assert.equal(oldTierShare(level, back, SOUL), shown, `level ${level} xp ${xp}`);
        }
    }
    // "Soul Growth: 0.21/100" at Soul Class I (Lv 1): 0.21 % of the tier's XP, rounded up.
    let span = 0;
    for (let level = 1; level <= 10; level++) span += xpToNext(level, R);
    assert.equal(xpFromProgress('0.21/100', 1, SOUL), Math.ceil((21 * span) / 10000));
    assert.equal(xpFromProgress('0.21/100', 1, SOUL), 30);
    // Written back in the new form, it then reads as the same XP.
    assert.equal(progress({ level: 1, xp: 30 }, SOUL).text, '30/100');
    assert.equal(xpFromProgress('30/100', 1, SOUL), 30);
    // With tiers off a share is that share of the level, as before.
    assert.equal(xpFromProgress('50.00/100', 4, POWER), xpToNext(4, R) / 2);
});

test('XP gains: plain numbers, with tiers too (0.5.2)', () => {
    assert.equal(xpGainText(38, 4, R), '+38');
    assert.equal(xpGainText(38, 4, POWER), '+38');
    assert.equal(xpGainText(30, 1, SOUL), '+30', 'never a share of the tier');
    assert.equal(xpGainText(38.4), '+38');
    assert.equal(xpGainText(-3), '+0');
});

test('parseLevelLabel reads plain levels, the terms, tiers and the exact level', () => {
    assert.equal(parseLevelLabel('Level 25', R), 25);
    assert.equal(parseLevelLabel('25', R), 25);
    assert.equal(parseLevelLabel('Lv 7', R), 7);
    assert.equal(parseLevelLabel('III', R), null, 'no tiers, no numerals');
    assert.equal(parseLevelLabel('Soul Class III', SOUL), 21);
    assert.equal(parseLevelLabel('soul class iii', SOUL), 21);
    assert.equal(parseLevelLabel('III', SOUL), 21);
    assert.equal(parseLevelLabel('Soul Class III (Lv 24)', SOUL), 24);
    assert.equal(parseLevelLabel('III (Lv 24)', SOUL), 24);
    assert.equal(parseLevelLabel('Level 25', SOUL), 25);
    assert.equal(parseLevelLabel('7', SOUL), 7, 'plain numbers are levels');
    assert.equal(parseLevelLabel('Soul Power 4', POWER), 4);
    assert.equal(parseLevelLabel('Soul Class 3', makeRules({ terms: { levelName: 'Soul Class', tiers: { size: 10, numerals: 'arabic' } } })), 21);
    assert.equal(parseLevelLabel('Level 400', R), 99, 'capped');
    assert.equal(parseLevelLabel('II', SOUL, { strict: true }), null, 'strict: the name must be written');
    assert.equal(parseLevelLabel('boss', SOUL), null);
    assert.equal(parseLevelLabel('', SOUL), null);
});

test('powerOptions: the tiers up to the cap, or every level', () => {
    assert.deepEqual(powerOptions(SOUL).map(option => [option.level, option.label]).slice(0, 3), [[1, 'Soul Class I'], [11, 'Soul Class II'], [21, 'Soul Class III']]);
    assert.equal(powerOptions(SOUL).length, 10);
    assert.equal(powerOptions(SOUL).at(-1).label, 'Soul Class X');
    assert.equal(powerOptions(makeRules({ terms: { levelName: 'Soul Class', tiers: { size: 10 }, cap: 95 } })).at(-1).label, 'Soul Class X', 'the cap shown as a tier');
    const levels = powerOptions(makeRules({ terms: { levelName: 'Rank', cap: 20 } }));
    assert.equal(levels.length, 20);
    assert.deepEqual(levels[3], { level: 4, label: 'Rank 4' });
});
