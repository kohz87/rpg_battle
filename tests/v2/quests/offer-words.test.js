// The word tables of GENERATIVE_OFFERS_SPEC §3.2: types, verbs in any tense, difficulties, durations, title case, trainer subjects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { difficultyFromLabel, durationText, firstVerb, minutesOf, subjectWords, titleCase, typeFromLabel, TYPES } from '../../../src/v2/quests/offer-words.js';

test('the type table: first word of type: found in a row; bounty counts as a hunt; side, main and contract name none', () => {
    const table = { hunt: 'hunt', slay: 'hunt', bounty: 'hunt', beast: 'hunt', cull: 'cull', clear: 'cull', vermin: 'cull', pests: 'cull', gather: 'gather', fetch: 'gather',
        delivery: 'deliver', courier: 'deliver', bring: 'deliver', scout: 'explore', journey: 'explore', escort: 'escort', guard: 'escort', errand: 'task', favour: 'task', story: 'task' };
    for (const [word, type] of Object.entries(table)) assert.equal(typeFromLabel(word), type, word);
    assert.equal(typeFromLabel('Bounty Hunt, urgent'), 'hunt');
    assert.equal(typeFromLabel('urgent errand'), 'task');
    for (const word of ['side', 'main', 'contract', '']) assert.equal(typeFromLabel(word), null, word);
    assert.deepEqual(Object.entries(TYPES).map(([name, row]) => [name, row.kind]), [['hunt', 'kill'], ['cull', 'kill'], ['gather', 'collect'], ['deliver', 'collect'], ['explore', 'visit'], ['escort', 'story'], ['task', 'story']]);
});

test('pack words are checked before the built-in table, in any language', () => {
    const words = { hunt: ['jagd'], cull: ['säubern'], easy: ['leicht'], hard: ['schwer'] };
    assert.equal(typeFromLabel('jagd', words), 'hunt');
    assert.equal(typeFromLabel('säubern', words), 'cull');
    assert.equal(typeFromLabel('gather jagd', words), 'gather', 'the first word that is in any row decides');
    assert.equal(typeFromLabel('jagd gather', words), 'hunt');
    assert.equal(typeFromLabel('hunt', { cull: ['hunt'] }), 'cull', 'a pack list is read before the built-in table');
    assert.equal(difficultyFromLabel('leicht', words), 'easy');
    assert.equal(difficultyFromLabel('schwer', words), 'hard');
    assert.equal(firstVerb('jagd die wölfe', { words })?.type, 'hunt', 'a pack word is a goal verb too, as written');
    assert.equal(firstVerb('Die Wölfe jagd', { words })?.type, 'hunt');
    assert.equal(firstVerb('der jagdhund', { words }), null, 'a whole word only');
});

test('goal verbs in any tense, the longest phrase first, the earliest verb wins', () => {
    const type = text => firstVerb(text)?.type ?? null;
    for (const [text, want] of [['Kill 6 rats', 'hunt'], ['He killed the wolves', 'hunt'], ['killing rats', 'hunt'], ['Slays the beast', 'hunt'], ['Hunt down the thief', 'hunt'], ['take down the boss', 'hunt'],
        ['Drive off the bandits', 'cull'], ['Clear the cellar', 'cull'], ['wiped out the nest', 'cull'], ['Exterminating pests', 'cull'], ['Find the ledger', 'gather'], ['Fetch water', 'gather'],
        ['Bring back the cart', 'deliver'], ['Brought them home', 'deliver'], ['Bring down the beast', 'hunt'], ['find out who did it', 'task'], ['Find out', 'task'], ['Help Marrit', 'task'],
        ['Settle the matter', 'task'], ['Escort the miller', 'escort'], ['Rescue the boy', 'escort'], ['Reach the pass', 'explore'], ['travel to Auvoth', 'explore']]) {
        assert.equal(type(text), want, text);
    }
    assert.equal(type('The Missing Boy'), null);
    assert.equal(type('Hear the miller out'), null);
    const verb = firstVerb('Kill 6 culvert rats in the south levee granary and collect tails');
    assert.deepEqual([verb.type, 'Kill 6 culvert rats in the south levee granary and collect tails'.slice(verb.start, verb.end)], ['hunt', 'Kill']);
    assert.equal(firstVerb('Find the ledger and kill the clerk', { kind: 'kill' }).type, 'hunt', 'only the verbs of a kind when it is asked for');
    assert.equal(firstVerb('Find the ledger and kill the clerk', { kind: 'collect' }).type, 'gather');
});

test('difficulty words, the first found', () => {
    for (const [word, want] of [['easy', 'easy'], ['trivial', 'easy'], ['Low', 'easy'], ['medium', 'normal'], ['routine', 'normal'], ['tough', 'hard'], ['risky', 'hard'], ['deadly', 'nightmare'], ['brutal', 'nightmare']]) {
        assert.equal(difficultyFromLabel(word), want, word);
    }
    assert.equal(difficultyFromLabel('rather difficult and deadly'), 'hard');
    assert.equal(difficultyFromLabel('whenever'), null);
});

test('deadlines: in N minutes, hours, days, weeks; a day; tomorrow; half a day; digits or words', () => {
    for (const [text, minutes] of [['in 3 days', 4320], ['in two days', 2880], ['2 days', 2880], ['a day', 1440], ['in a week', 10080], ['in 2 weeks', 20160], ['tomorrow', 1440], ['half a day', 720],
        ['in 90 minutes', 90], ['in 10 hours', 600], ['in an hour', 60], ['within 5 days', 7200], ['In 3 Days.', 4320]]) {
        assert.equal(minutesOf(text), minutes, text);
    }
    for (const text of ['before the harvest', 'Goldwane 13', 'soon', '', 'in 0 days', 'in many days']) assert.equal(minutesOf(text), null, text);
    assert.deepEqual([10080, 2880, 600, 90, 1440, 60].map(durationText), ['7 days', '2 days', '10 hours', '90 minutes', '1 day', '1 hour']);
});

test('title case keeps the small words low, but the first; cut to size', () => {
    assert.equal(titleCase('culvert rats'), 'Culvert Rats');
    assert.equal(titleCase('alpha of the scrub wolf pack'), 'Alpha of the Scrub Wolf Pack');
    assert.equal(titleCase('THE hollow KING'), 'The Hollow King');
    assert.equal([...titleCase('wolf '.repeat(40), 80)].length, 80);
});

test('trainer subjects fold to a family head; noise and plurals go', () => {
    const words = text => [...subjectWords(text)].sort();
    assert.deepEqual(words('swordplay'), ['blade']);
    assert.deepEqual(words('Fencing and rapier drills'), ['blade', 'drill']);
    assert.deepEqual(words('teaches spear and shield work'), ['shield', 'spear']);
    assert.deepEqual(words('hedge magic, sparks and wards'), ['magic', 'spark']);
    assert.deepEqual(words('stealth, a dagger and gutter tricks'), ['street', 'trick']);
    assert.deepEqual(words('archery and marksmanship'), ['bow', 'marksmanship']);
    assert.deepEqual(words('prayer, faith'), ['flame']);
    assert.deepEqual(words('Hedge-magic lessons'), ['lesson', 'magic']);
    assert.deepEqual(words('unarmed brawling'), ['fist']);
});
