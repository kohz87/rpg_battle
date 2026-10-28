// A pack's own mastery for each promotion (Story Block 2.5.0 `promotionMastery`, carried in the pin's constants): 10, 20 and 30 want that many of the five steps
// of every skill. A pin made before it has no such constant and wants 5/5, as it always did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { progressView, evaluateClass, standing, masteryNeeded } from '../../../src/v2/progress/offers.js';
import { ACTOR, basic, golden, promo, ref, slice } from './helpers/states.js';

const normal = golden();
const withMastery = (list) => ({ ...normal, constants: Object.fromEntries(Object.entries({ ...normal.constants, promotionMastery: list }).filter(([, value]) => value !== undefined)) });
const OLD = { ...normal, constants: Object.fromEntries(Object.entries(normal.constants).filter(([key]) => key !== 'promotionMastery')) };
const uses = { 's00-base': 12, 's01-base': 12, 's02-base': 12 };
const request = { milestone: 10, class: ref('c1'), expectedClass: ref('c0') };

test('the pack\'s default is 5, 5, 5; a pin made before the constant has none and wants the top', () => {
    assert.deepEqual(normal.constants.promotionMastery ?? [5, 5, 5], [5, 5, 5]);
    assert.equal(OLD.constants.promotionMastery, undefined);
    assert.deepEqual([10, 20, 30, 40].map(m => masteryNeeded(OLD, m)), [5, 5, 5, 5]);
    assert.deepEqual([10, 20, 30, 40].map(m => masteryNeeded(withMastery([3, 4, 5]), m)), [3, 4, 5, 5], 'a path step always wants the top');
    assert.deepEqual([10, 20, 30].map(m => masteryNeeded(withMastery([0, 9, 2.5]), m)), [5, 5, 5], 'a value out of range is the top');
});

test('a promotion that wants 3: three skills at 3/5 (12 uses) are enough, two are not, and the checklist says what is needed', () => {
    const ix = withMastery([3, 4, 5]);
    const progress = slice({ choices: [basic(ACTOR, 'c0')], uses });
    assert.deepEqual(standing(ix, progress, ACTOR).skills.map(view => view.mastery), [3, 3, 3]);
    const out = progressView(ix, progress, ACTOR, 10);
    assert.deepEqual(out.checklist.map(item => [item.mastery, item.needed]), [[3, 3], [3, 3], [3, 3]]);
    assert.deepEqual(out.promotions, [{ milestone: 10, eligible: true, choices: [ref('c1')], why: [] }]);
    assert.equal(evaluateClass(ix, standing(ix, progress, ACTOR), request, 10).ok, true);
    // One skill short of 3 blocks it, with the number it needs.
    const short = slice({ choices: [basic(ACTOR, 'c0')], uses: { ...uses, 's02-base': 5 } });
    const blocked = progressView(ix, short, ACTOR, 10);
    assert.deepEqual(blocked.promotions[0].why, ['s02 is 2 / 3.']);
    const refused = evaluateClass(ix, standing(ix, short, ACTOR), request, 10);
    assert.deepEqual([refused.ok, refused.code, refused.why], [false, 'REFUSED', 'Every skill must be 3 / 5: s02 is 2 / 3.']);
});

test('the same three skills on a pin without the constant (or with the default) are blocked at 3/5, exactly as before', () => {
    const progress = slice({ choices: [basic(ACTOR, 'c0')], uses });
    for (const ix of [OLD, normal, withMastery([5, 5, 5])]) {
        const out = progressView(ix, progress, ACTOR, 10);
        assert.deepEqual(out.checklist.map(item => item.needed), [5, 5, 5]);
        assert.equal(out.promotions[0].eligible, false);
        assert.deepEqual(out.promotions[0].why, ['s00 is 3 / 5.', 's01 is 3 / 5.', 's02 is 3 / 5.']);
        assert.equal(evaluateClass(ix, standing(ix, progress, ACTOR), request, 10).why, 'Every skill must be 5 / 5: s00 is 3 / 5. s01 is 3 / 5. s02 is 3 / 5.');
    }
});

test('the checklist wants the mastery of the open milestone: 20 after the promotion at 10, and the top for a path', () => {
    const ix = withMastery([3, 4, 5]);
    const taken = slice({ choices: [basic(ACTOR, 'c0'), promo(ACTOR, 10, 'c0', 'c1')], uses: { 's10-base': 22, 's11-base': 22, 's12-base': 22 } });
    const out = progressView(ix, taken, ACTOR, 20);
    assert.deepEqual(out.checklist.map(item => [item.mastery, item.needed]), [[4, 4], [4, 4], [4, 4]]);
    assert.equal(out.promotions[0].eligible, true);
});

test('on the real host: a pack that writes promotionMastery pins it, and the progress page asks that much; one that does not asks 5', async t => {
    const { seeded } = await import('../integration/helpers/host.js');
    const { PACK, bluewatch } = await import('../quests/helpers/bluewatch.js');
    await seeded(9301, async () => {
        const pack = structuredClone(PACK);
        pack.content.rules[0].promotionMastery = [2, 3, 4];
        const h = await bluewatch(t, { pack: JSON.stringify(pack) });
        assert.deepEqual(h.head().domains.rules.pin.resolved.constants.promotionMastery, [2, 3, 4]);
        assert.deepEqual(h.q('rules.progress', { actor: h.q('party.pc').id }).checklist.map(item => item.needed), [2, 2, 2]);
        const plain = await bluewatch(t);
        assert.deepEqual(plain.head().domains.rules.pin.resolved.constants.promotionMastery, [5, 5, 5]);
        assert.deepEqual(plain.q('rules.progress', { actor: plain.q('party.pc').id }).checklist.map(item => item.needed), [5, 5, 5]);
    });
});
