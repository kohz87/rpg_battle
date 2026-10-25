// rules/graph.js: the class and form graph read from the pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexOf, initialRules, pinOf, pinRules } from '../../../src/v2/rules/index.js';
import { RULES_V2_PROGRESSION } from '../../vendor/story-block/src/v2/packs/rules-v2.js';
import { fixturePin, ref } from '../progress/helpers/fixture.js';

const ix = () => {
    const slice = initialRules();
    assert.equal(pinRules(slice, fixturePin()), '');
    return indexOf(pinOf({ domains: { rules: slice } }));
};

test('no pin, no index', () => {
    assert.equal(indexOf(null), null);
    assert.equal(indexOf({}), null);
});

test('classes: the direct children one tier up, the three skills of a class, the advanced tier', () => {
    const g = ix();
    assert.equal(g.maxTier, Math.max(...RULES_V2_PROGRESSION.tiers));
    assert.deepEqual(g.childrenOf(ref('c0')).map(child => child.id), [ref('c1')]);
    assert.deepEqual(g.childrenOf(ref('c2')).map(child => child.id), [ref('c3')]);
    assert.deepEqual(g.childrenOf(ref('c3')), [], 'nothing follows the advanced class');
    assert.deepEqual(g.class(ref('c1')).skills, [ref('s10'), ref('s11'), ref('s12')]);
    assert.equal(g.class(ref('nope')), null);
    assert.equal(g.tierOfPromotion(10), 1);
    assert.equal(g.tierOfPromotion(30), 3);
    assert.equal(g.tierOfPromotion(40), null);
    assert.equal(g.tierOfPromotion(15), null);
});

test('forms: a skill\'s base form, and the three options of a form ordered [g, a, b] (contract §3)', () => {
    const g = ix();
    assert.equal(g.baseForm(ref('s30')), ref('s30-base'));
    assert.equal(g.baseForm(ref('s00')), ref('s00-base'));
    assert.equal(g.baseForm(ref('nope')), null);
    assert.deepEqual(g.optionsOf(ref('s30-base')), ['g', 'a', 'b'].map(c => ref(`s30-base-${c}`)));
    assert.deepEqual(g.optionsOf(ref('s30-base-a')), ['g', 'a', 'b'].map(c => ref(`s30-base-a-${c}`)));
    assert.deepEqual(g.optionsOf(ref('s30-base-a-g')), [], 'a step-2 form has no children: there is no third step');
    assert.deepEqual(g.optionsOf(ref('s00-base')), [], 'earlier tiers have no pathway nodes');
    assert.equal(g.form(ref('s30-base-a-g')).origin, 'generated');
    assert.equal(g.form(ref('s30-base-a')).origin, 'written');
    assert.equal(g.form(ref('s30-base-a')).fromForm, ref('s30-base'));
});

test('the 24 written and 12 generated forms below an advanced class are all reachable from the three base forms', () => {
    const g = ix();
    const reach = form => [form, ...g.optionsOf(form).flatMap(reach)];
    const all = ['s30', 's31', 's32'].flatMap(skill => reach(ref(`${skill}-base`)));
    // 3 skills × (1 base + 3 step-1 + 9 step-2) forms.
    assert.equal(all.length, 39);
    assert.equal(new Set(all).size, 39);
    const below = all.filter(form => g.form(form).step > 0);
    assert.equal(below.filter(form => g.form(form).origin === 'written').length, 24);
    assert.equal(below.filter(form => g.form(form).origin === 'generated').length, 12);
});
