// Open trainers, the first slice (RB open trainers §3, §5.1, §7): a pack's trainer templates are kept apart from its fixed trainers in the
// pinned index, `trainerOf` finds a trainer by a pack ref or by the `tn_` id of a recorded offer, and the `training` domain's validator
// knows what an offer is. Nothing here offers a trainer yet; fixed trainers behave as they did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexOf } from '../../../src/v2/rules/graph.js';
import { isTrainerOfferId, isTrainerRef } from '../../../src/v2/rules/ids.js';
import { trainerOf, nameKey, offersOf } from '../../../src/v2/training/trainers.js';
import { MAX_OFFERS, initialTraining, offerProblem, trainingForPin, trainingProblems } from '../../../src/v2/training/domain.js';
import { realWorld } from '../progress/helpers/world.js';
import { drillsTemplate, openTrainerPack, openTrainersPin, pinFor, ref, trainersPin } from '../progress/helpers/fixture.js';

const ix = () => indexOf(openTrainersPin());
const offer = (over = {}) => ({
    id: 'tn_00000001', template: ref('drills'), name: 'Old Reka', text: 'blade drills', skills: [ref('s00'), ref('s01')], fee: 23, minutes: 60,
    eventTemplates: [], rank: 'F', place: ref('haven'), where: 'Haven', npc: null, by: 'story', ...over,
});
const slice = (...offers) => ({ ...initialTraining(), offers: Object.fromEntries(offers.map(entry => [entry.id, entry])) });

test('the index keeps templates apart: trainer() and trainers are the fixed ones, trainerTemplate() the templates', () => {
    const index = ix();
    assert.deepEqual(index.trainers.map(entry => entry.id), [ref('mentor'), ref('stormy')]);
    assert.equal(index.trainer(ref('drills')), null, 'a template is not someone you can train with');
    assert.equal(index.trainer(ref('mentor')).name, 'Old Brann');
    assert.deepEqual(index.trainerTemplates.map(entry => entry.id), [ref('drills')]);
    assert.equal(index.trainerTemplate(ref('drills')).open, true);
    assert.deepEqual(index.trainerTemplate(ref('drills')).fee, { coinMin: 10, coinMax: 40 });
    assert.equal(index.trainerTemplate(ref('mentor')), null, 'a fixed trainer is not a template');
});

test('a pack without templates has the same fixed trainers and no template', () => {
    const index = indexOf(trainersPin());
    assert.deepEqual(index.trainers.map(entry => entry.id), [ref('mentor'), ref('stormy')]);
    assert.deepEqual(index.trainerTemplates, []);
});

test('templates keep the pack\'s order, whatever sits between them', () => {
    const pin = pinFor('three-templates', openTrainerPack([drillsTemplate(), drillsTemplate({ slug: 'second', name: 'Second' }), drillsTemplate({ slug: 'third', name: 'Third' })]));
    assert.deepEqual(indexOf(pin).trainerTemplates.map(entry => entry.slug), ['drills', 'second', 'third']);
});

test('trainerOf: a pack ref gives the fixed trainer, a tn_ id the recorded offer as a trainer, a template or a stranger nothing', () => {
    const index = ix();
    const training = slice(offer());
    assert.equal(trainerOf(index, training, ref('mentor')).fee, 20);
    const open = trainerOf(index, training, 'tn_00000001');
    assert.deepEqual(open, { id: 'tn_00000001', name: 'Old Reka', place: ref('haven'), skills: [ref('s00'), ref('s01')], fee: 23, minutes: 60,
        eventTemplates: [], open: true, template: ref('drills'), where: 'Haven' });
    assert.equal(trainerOf(index, training, ref('drills')), null, 'asking for a template is NOT_FOUND');
    assert.equal(trainerOf(index, training, 'tn_00000002'), null, 'an offer that is not held');
    assert.equal(trainerOf(index, initialTraining(), 'tn_00000001'), null, 'a slice with no offers');
    assert.equal(trainerOf(index, undefined, 'tn_00000001'), null, 'no slice at all');
    assert.equal(trainerOf(index, training, 'tn___proto__'), null);
    assert.equal(trainerOf(index, training, 'constructor'), null);
    assert.equal(trainerOf(index, training, null), null);
});

test('id shapes: a trainer ref is a pack ref or tn_ plus eight base36 characters', () => {
    assert.equal(isTrainerOfferId('tn_0a1b2c3d'), true);
    for (const bad of ['tn_0A1b2c3d', 'tn_0a1b2c3', 'tn_0a1b2c3de', 'tr_0a1b2c3d', 'th_0a1b2c3d', 'tn-0a1b2c3d', '', null, 5]) assert.equal(isTrainerOfferId(bad), false, String(bad));
    assert.equal(isTrainerRef(ref('mentor')), true);
    assert.equal(isTrainerRef('tn_0a1b2c3d'), true);
    assert.equal(isTrainerRef('mentor'), false);
});

test('nameKey folds case, spaces and width; offersOf sorts by where, name, id', () => {
    assert.equal(nameKey('  Old   Reka '), 'old reka');
    assert.equal(nameKey('ＯＬＤ Reka'), 'old reka');
    assert.equal(nameKey('Old Reka'), 'old reka');
    const list = offersOf(slice(offer({ id: 'tn_00000003', name: 'Bran', where: 'Mill' }), offer({ id: 'tn_00000002', name: 'Zed', where: 'Haven' }), offer({ id: 'tn_00000001', name: 'Alda', where: 'Haven' })));
    assert.deepEqual(list.map(entry => entry.id), ['tn_00000001', 'tn_00000002', 'tn_00000003']);
    assert.deepEqual(offersOf(initialTraining()), []);
});

test('the training validator: no offers key, an empty map or whole offers are fine', () => {
    assert.deepEqual(trainingProblems(initialTraining()), []);
    assert.equal(Object.hasOwn(initialTraining(), 'offers'), false, 'the slice has no offers key until the first offer');
    assert.deepEqual(trainingProblems({ ...initialTraining(), offers: {} }), []);
    assert.deepEqual(trainingProblems(slice(offer(), offer({ id: 'tn_00000002', name: 'Bran', by: 'reader', npc: 'np_00000001', place: 'pl_0a1b2c3d' }))), []);
});

const broken = [
    ['an id that is not tn_', { id: 'tr_00000001' }],
    ['no template', { template: 'drills' }],
    ['an empty name', { name: '' }],
    ['a name over 80 characters', { name: 'x'.repeat(81) }],
    ['a name with markup', { name: 'Reka <b>' }],
    ['a name with a control character', { name: 'Reka\n' }],
    ['a name with spaces around it', { name: ' Reka' }],
    ['a text over 240 characters', { text: 'x'.repeat(241) }],
    ['a text that is not text', { text: 5 }],
    ['no skills', { skills: [] }],
    ['31 skills', { skills: Array.from({ length: 31 }, (_, n) => ref(`s${n}`)) }],
    ['a skill twice', { skills: [ref('s00'), ref('s00')] }],
    ['a skill that is not a ref', { skills: ['s00'] }],
    ['a fee of 0', { fee: 0 }],
    ['a fee over a million', { fee: 1000001 }],
    ['a fee that is not whole', { fee: 2.5 }],
    ['minutes other than 60', { minutes: 30 }],
    ['nine event templates', { eventTemplates: Array.from({ length: 9 }, (_, n) => ref(`e${n}`)) }],
    ['no rank', { rank: '' }],
    ['a rank over 20 characters', { rank: 'x'.repeat(21) }],
    ['no place', { place: undefined }],
    ['a place that is not an id', { place: 'Haven' }],
    ['a place name over 80 characters', { where: 'x'.repeat(81) }],
    ['an NPC that is not a record id', { npc: 'Reka' }],
    ['an author other than story or reader', { by: 'system' }],
];
for (const [what, over] of broken) {
    test(`the training validator refuses an offer with ${what}`, () => {
        const problems = trainingProblems(slice(offer(over)));
        assert.equal(problems.length, 1, JSON.stringify(problems));
        assert.match(problems[0], /^training: offer t[nr]_00000001 /);
        assert.notEqual(offerProblem('tn_00000001', offer(over)), null);
    });
}

test('the training validator refuses offers that are not a map, an offer under another id, two of one name, and more than 100', () => {
    assert.match(trainingProblems({ ...initialTraining(), offers: [] })[0], /offers are not an object/);
    assert.match(trainingProblems({ ...initialTraining(), offers: { tn_00000002: offer() } })[0], /tn_00000002 is not whole/);
    const twins = slice(offer(), offer({ id: 'tn_00000002', name: 'OLD   reka' }));
    assert.match(trainingProblems(twins).join(), /tn_00000002 has the name of another open trainer/);
    const many = slice(...Array.from({ length: MAX_OFFERS + 1 }, (_, n) => offer({ id: `tn_${String(n).padStart(8, '0')}`, name: `Teacher ${n}` })));
    assert.match(trainingProblems(many)[0], /more than 100 open trainers/);
    const full = slice(...Array.from({ length: MAX_OFFERS }, (_, n) => offer({ id: `tn_${String(n).padStart(8, '0')}`, name: `Teacher ${n}` })));
    assert.deepEqual(trainingProblems(full), []);
});

test('a session may name an offer as its trainer, and still not a stranger', () => {
    const session = { id: 'tr_00000001', actor: 'ac_00000001', skill: ref('s00'), form: ref('s00-base'), trainer: 'tn_00000001', status: 'requested', fee: null, startMinute: null, endMinute: null, event: null, reason: null };
    assert.deepEqual(trainingProblems({ ...slice(offer()), sessions: { tr_00000001: session } }), []);
    assert.match(trainingProblems({ ...initialTraining(), sessions: { tr_00000001: { ...session, trainer: 'mentor' } } })[0], /names no actor, skill, form, trainer and status/);
});

test('a chat pinned to a pack with templates: the Progress offers list the fixed trainers only, and asking a template to train is NOT_FOUND', async t => {
    const w = await realWorld(t, { given: openTrainersPin(), sd: true });
    const offers = w.q('rules.training', { actor: w.pc }).offers;
    assert.deepEqual(offers.map(item => [item.trainer, item.skill]), [[ref('mentor'), ref('s00')], [ref('mentor'), ref('s01')], [ref('stormy'), ref('s02')]]);
    assert.ok(offers.every(item => item.trainer !== ref('drills')), 'a template is not a trainer');
    const item = offers[0];
    const refused = w.ui('skill.train', { ...item.payload, trainer: ref('drills') });
    assert.equal(refused.code, 'NOT_FOUND');
    assert.match(refused.message, /not a trainer of this world/);
    const offerId = w.ui('skill.train', { ...item.payload, trainer: 'tn_00000001' });
    assert.equal(offerId.code, 'NOT_FOUND', 'no offer is held yet');
    assert.deepEqual(w.slice('training'), { ...initialTraining(), offers: {} }, 'nothing was written but the empty map the pin started with');
});

test('a chat pinned to a pack with templates trains with a fixed trainer exactly as before', async t => {
    const w = await realWorld(t, { given: openTrainersPin(), sd: true });
    await w.say('Haven.', ['~ time 7170', '~ here pack.fixture/haven']);
    assert.equal(w.host.bus.command('test.coin', { amount: 100 }, { cause: 'ui' }).ok, true);
    const item = w.q('rules.training', { actor: w.pc }).offers[0];
    assert.equal(w.ui('skill.train', item.payload).ok, true);
    await w.say('The lesson.', ['~ here pack.fixture/haven']);
    assert.equal(w.q('rules.training', { actor: w.pc }).session.status, 'completed');
    assert.deepEqual(w.slice('training').offers, {}, 'no offer was written');
    assert.deepEqual(w.problems(), []);
});

test('a pin starts with the training slice it always had, unless the ruleset has a template: then it also holds an empty map of offers', () => {
    assert.deepEqual(trainingForPin(trainersPin().resolved), initialTraining());
    assert.equal(Object.hasOwn(trainingForPin(trainersPin().resolved), 'offers'), false);
    assert.deepEqual(trainingForPin(openTrainersPin().resolved), { schema: 2, sessions: {}, offers: {} });
    assert.deepEqual(trainingForPin(undefined), initialTraining());
    assert.deepEqual(trainingProblems(trainingForPin(openTrainersPin().resolved)), []);
});
