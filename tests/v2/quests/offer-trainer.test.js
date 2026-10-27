// matchTrainer (GENERATIVE_OFFERS_SPEC §5.6) on Bluewatch 1.6.0's four open trainer templates: like: wins, else the most shared folded words,
// ties to the rank nearest at or below the character's; teaches: entries the template lacks are dropped; the fee is read with the money parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTrainer } from '../../../src/v2/training/offer.js';
import { COPPER, CROWNS, env, lineOf } from './helpers/offer-env.js';

const teach = (text, options) => matchTrainer(env(options), lineOf(text));
const slug = template => String(template).split('/')[1];

test('the four templates are matched by their words, in the narrator\'s own', () => {
    for (const [text, want] of [
        ['+ trainer A — blade drills', 'open-blade-drills'], ['+ trainer A — fencing and rapier work', 'open-blade-drills'], ['+ trainer A — duelling', 'open-blade-drills'],
        ['+ trainer A — spear and shield drills', 'open-spear-and-shield'], ['+ trainer A — halberd work', 'open-spear-and-shield'], ['+ trainer A — street tricks, knife and stealth', 'open-street-craft'],
        ['+ trainer A — hedge magic', 'open-hedge-lessons'], ['+ trainer A — spells and mana', 'open-hedge-lessons'], ['+ trainer A | teaches: spark dart', 'open-hedge-lessons'],
    ]) assert.equal(slug(teach(text).binding?.template), want, text);
    for (const text of ['+ trainer A — fishing', '+ trainer A', '+ trainer A — archery', '+ trainer A — baking and brewing']) assert.equal(teach(text).kind, 'none', text);
});

test('like: wins when it names a template; an unknown like: is noted and ignored; the text after a dash inside like: is the text', () => {
    assert.equal(slug(teach('+ trainer A — hedge magic | like: open-blade-drills').binding.template), 'open-blade-drills');
    assert.equal(slug(teach('+ trainer A — hedge magic | like: blade-drills').binding.template), 'open-hedge-lessons');
    assert.deepEqual(teach('+ trainer A — hedge magic | like: blade-drills').notes, ['like: blade-drills is not a template']);
    assert.equal(slug(teach('+ trainer A | like: open-spear-and-shield').binding.template), 'open-spear-and-shield', 'a like: needs no words');
    assert.equal(slug(teach('+ trainer Old Reka | like: swordplay — blade drills').binding.template), 'open-blade-drills');
});

test('ties go to the template whose rank is nearest at or below the character\'s, then to the pack\'s order', () => {
    // Both F templates share "drill" (and nothing else) with this text; the pack lists the blade one first.
    assert.equal(slug(teach('+ trainer A — drills').binding.template), 'open-blade-drills');
    // "magic and street": hedge lessons (E) and street craft (F) share one word each. At level 3 (rank F) the F one is at or below; at level 14 (E) the E one is nearest.
    assert.equal(slug(teach('+ trainer A — magic and street tricks', { level: 3 }).binding.template), 'open-street-craft');
    assert.equal(slug(teach('+ trainer A — magic and street tricks', { level: 14 }).binding.template), 'open-hedge-lessons');
});

test('teaches: entries the template lacks are dropped and noted; none left means the whole list', () => {
    const some = teach('+ trainer A — blade drills | teaches: swift thrust, fishing');
    assert.deepEqual(some.binding.skills, ['pack.ersveil-bluewatch/swift-thrust']);
    assert.deepEqual(some.notes, ['fishing is not taught by Blade drills']);
    const none = teach('+ trainer A — blade drills | teaches: fishing, baking');
    assert.equal(none.binding.skills, null);
    assert.equal(none.notes.length, 2);
    assert.equal(teach('+ trainer A — blade drills').binding.skills, null);
    assert.equal(teach('+ trainer Fen | teaches: cane-draw, gutter feint').binding.skills.length, 2);
    assert.equal(teach('+ trainer A — blade drills | teaches: swift-thrust, pack.ersveil-bluewatch/parrying-turn').binding.skills.length, 2, 'by slug, by ref or by name');
});

test('fee: inside the range stands, outside it is held, above 3 times the top is far, unreadable is rolled', () => {
    const fee = (written, options) => teach(`+ trainer A — blade drills | fee: ${written}`, options);
    assert.deepEqual([fee('60 copper').band, fee('60 copper').fee], ['within', { value: 60, by: 'said' }]);
    assert.deepEqual([fee('40 copper').band, fee('90 copper').band], ['within', 'within']);
    assert.deepEqual([fee('1 copper').band, fee('1 copper').fee.value], ['moderate', 40]);
    assert.deepEqual([fee('2 gold').band, fee('2 gold').fee.value], ['moderate', 90]);
    assert.deepEqual([fee('270 copper').kind, fee('271 copper').kind], ['offer', 'far']);
    assert.deepEqual([fee('a dozen copper').fee.value, fee('half a dozen silver').fee.value], [40, 60]);
    const foreign = fee('12 crowns');
    assert.deepEqual([foreign.band, foreign.fee, foreign.notes], ['moderate', null, ['fee "12 crowns" is not this chat\'s money; the fee is rolled instead']]);
    assert.equal(fee('12 crowns', { currency: CROWNS }).fee.value, 40, 'the reader\'s own money: 12 crowns is below the floor of 40');
    assert.equal(fee('a fine horse').notes[0], 'fee "a fine horse" has no amount code can read; the fee is rolled instead');
    assert.deepEqual(fee('mood').notes.length, 1);
});

test('names, flattening and labels that are not used', () => {
    assert.equal(teach('+ trainer <> — blade drills').kind, 'refuse');
    const r = teach('+ trainer Old Reka — blade <b>drills</b> | mood: grim');
    assert.deepEqual([r.binding.name, r.binding.text, r.notes], ['Old Reka', 'blade b drills /b', ['mood was not used']]);
    assert.equal(teach(`+ trainer ${'N'.repeat(100)} — blade drills`).binding.name.length, 80);
    assert.equal(r.band, 'within');
    assert.deepEqual(r.said, { name: 'Old Reka', text: 'blade b drills /b' });
    assert.deepEqual(teach('+ trainer A — blade drills', { currency: COPPER }).fee, null);
});
