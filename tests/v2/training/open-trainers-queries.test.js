// What the screens read about open trainers (RB open trainers §10.1): the Progress offers, the templates, the trainers and their names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realWorld } from '../progress/helpers/world.js';
import { drillsTemplate, openTrainerPack, openTrainersPin, pinFor, ref, trainersPin } from '../progress/helpers/fixture.js';
import { HAVEN, MILL, START, offers, ready } from './helpers/open.js';

test('training.openTemplates: the pack\'s templates in its order, with the fee range and the skills by name', async t => {
    const pack = openTrainerPack([drillsTemplate(), drillsTemplate({ slug: 'lore', name: 'Lore', skills: ['s02', 's10'], fee: { coinMin: 50, coinMax: 50 } })]);
    const w = await realWorld(t, { given: pinFor('two-templates', pack), sd: true });
    assert.deepEqual(w.q('training.openTemplates', {}), [
        { id: ref('drills'), name: 'Drills', rank: 'F', fee: { coinMin: 10, coinMax: 40 }, skills: [{ id: ref('s00'), name: 's00' }, { id: ref('s01'), name: 's01' }] },
        { id: ref('lore'), name: 'Lore', rank: 'F', fee: { coinMin: 50, coinMax: 50 }, skills: [{ id: ref('s02'), name: 's02' }, { id: ref('s10'), name: 's10' }] },
    ]);
    assert.equal(w.q('training.openTemplates', { extra: 1 }).length, 0, 'it takes no arguments');
    const plain = await realWorld(t, { given: trainersPin(), sd: true });
    assert.deepEqual(plain.q('training.openTemplates', {}), [], 'a pack without templates has none');
});

test('training.trainers: the pack\'s fixed trainers, then the story\'s, sorted by where, name and id', async t => {
    const w = await ready(t, { present: ['Zed', 'Alda', 'Mia'] });
    assert.deepEqual(w.q('training.trainers', {}), {
        fixed: [
            { id: ref('mentor'), name: 'Old Brann', place: HAVEN, fee: 20, skills: [ref('s00'), ref('s01')] },
            { id: ref('stormy'), name: 'Gale', place: HAVEN, fee: 5, skills: [ref('s02')] },
        ],
        story: [],
    });
    await w.say('Haven.', ['+ trainer Zed | like: drills', '+ trainer Alda | like: drills | teaches: s01']);
    await w.say('Mill.', [`~ here ${MILL}`, '+ trainer Mia | like: drills']);
    const answer = w.q('training.trainers', {});
    assert.deepEqual(answer.story.map(offer => [offer.name, offer.place]), [['Alda', HAVEN], ['Zed', HAVEN], ['Mia', MILL]]);
    assert.deepEqual(answer.story.map(offer => offer.id), Object.values(offers(w)).sort((a, b) => (a.where < b.where ? -1 : a.where > b.where ? 1 : a.name < b.name ? -1 : 1)).map(offer => offer.id));
    answer.story[0].name = 'changed';
    assert.equal(w.q('training.trainers', {}).story[0].name, 'Alda', 'a copy: the state is not reachable through the answer');
    assert.equal(w.q('training.trainers', { x: 1 }), null);
});

test('rules.names names a trainer offer by its name, and still nothing it does not hold', async t => {
    const w = await ready(t);
    await w.say('Offer.', ['+ trainer Old Reka | like: drills']);
    const id = Object.keys(offers(w))[0];
    assert.deepEqual(w.q('rules.names', { refs: [id, ref('s00'), 'tn_00000000', ref('mentor')] }), { [id]: 'Old Reka', [ref('s00')]: 's00' });
});

test('rules.training: the pack\'s trainers first as before, then one row for each open trainer and held skill it teaches', async t => {
    const w = await ready(t, { present: ['Zed', 'Alda'] });
    await w.say('Haven.', ['+ trainer Zed | like: drills | teaches: s01', '+ trainer Alda | like: drills']);
    await w.say('Mill.', [`~ here ${MILL}`, '+ present Mia', '+ trainer Mia | like: drills | teaches: s00']);
    const rows = w.q('rules.training', { actor: w.pc }).offers;
    const [alda, zed, mia] = ['Alda', 'Zed', 'Mia'].map(name => Object.values(offers(w)).find(offer => offer.name === name));
    assert.deepEqual(rows.map(row => [row.name, row.skill.split('/')[1], row.open, row.where]), [
        ['Old Brann', 's00', false, null], ['Old Brann', 's01', false, null], ['Gale', 's02', false, null],
        ['Alda', 's00', true, HAVEN], ['Alda', 's01', true, HAVEN], ['Zed', 's01', true, HAVEN], ['Mia', 's00', true, MILL],
    ]);
    const row = rows.find(item => item.name === 'Zed');
    assert.deepEqual(Object.keys(row).sort(), ['blocked', 'fee', 'form', 'minutes', 'name', 'open', 'payload', 'session', 'skill', 'trainer', 'where']);
    assert.equal(row.trainer, zed.id);
    assert.equal(row.fee, zed.fee);
    assert.equal(row.minutes, 60);
    assert.deepEqual(row.payload, { actor: w.pc, skill: ref('s01'), form: ref('s01-base'), trainer: zed.id, session: row.session });
    assert.match(row.session, /^tr_[0-9a-z]{8}$/);
    assert.equal(rows.find(item => item.name === 'Alda' && item.skill === ref('s00')).trainer, alda.id);
    assert.equal(rows.find(item => item.name === 'Mia').trainer, mia.id);
    // The party is at the Mill: Haven's trainers are not here, the Mill's is; no clock to pay with yet.
    assert.deepEqual(rows.filter(item => item.name === 'Zed')[0].blocked, [`Zed is not here.`, `It costs ${zed.fee} gold.`]);
    assert.deepEqual(rows.find(item => item.name === 'Mia').blocked, [`It costs ${mia.fee} gold.`]);
    assert.equal(new Set(rows.map(item => item.session)).size, rows.length, 'a session id for each row');
    assert.deepEqual(w.q('rules.training', { actor: w.pc }).offers, rows, 'asking again names the same sessions: a query assigns nothing');
});

test('rules.training: a pack with templates but no offer shows what it showed before, plus the two fields', async t => {
    const w = await realWorld(t, { given: openTrainersPin(), sd: true });
    const rows = w.q('rules.training', { actor: w.pc }).offers;
    assert.deepEqual(rows.map(row => [row.trainer, row.skill, row.open, row.where]), [[ref('mentor'), ref('s00'), false, null], [ref('mentor'), ref('s01'), false, null], [ref('stormy'), ref('s02'), false, null]]);
    assert.equal(rows.some(row => row.trainer === ref('drills')), false);
    await w.say('Haven.', [`~ time ${START}`, `~ here ${HAVEN}`]);
    assert.deepEqual(w.slice('training'), { schema: 2, sessions: {}, offers: {} }, 'a pin with templates starts with an empty map of offers');
});
