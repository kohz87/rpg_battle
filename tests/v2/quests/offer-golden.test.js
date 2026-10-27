// GENERATIVE_OFFERS_SPEC §11.2 and §11.3 as pure tests on Bluewatch 1.6.0: the user's two lines to the letter (the card note, the settled terms the
// narrator reads next) and the requested cases G3 to G17, each as a row of the table. The end-to-end run on the real host is offer-real.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOffer } from '../../../src/v2/quests/offer-match.js';
import { matchTrainer } from '../../../src/v2/training/offer.js';
import { farLineOf, settledTerms } from '../../../src/v2/quests/offer-bands.js';
import { COPPER, CROWNS, derivedPin, env, lineOf } from './helpers/offer-env.js';

const G1 = '+ quest Granary Vermin | giver: Hollis | type: cull | goal: Kill 6 culvert rats in the south levee granary and collect tails | reward: 12 crowns | difficulty: easy';
const G2 = '+ quest Scrub Pack | giver: Hollis | type: hunt | goal: Slay the alpha of the scrub wolf pack north of the ditch | reward: 30 crowns | difficulty: normal';
const offer = (text, options) => matchOffer(env(options), lineOf(text));
const slug = ref => String(ref).split('/')[1];

test('G1 on the pack\'s own money: open-hunt-f, kill 6 Culvert Rats (a named kind of Cellar Rat Swarm), 5 silver, 50 XP, 7 days, moderate', () => {
    const r = offer(G1);
    assert.equal(r.kind, 'offer');
    assert.equal(r.band, 'moderate');
    assert.equal(slug(r.settled.template), 'open-hunt-f');
    assert.deepEqual(r.settled.foe, { ref: 'pack.ersveil-bluewatch/cellar-rat-swarm~culvert-rats', base: 'pack.ersveil-bluewatch/cellar-rat-swarm', name: 'Culvert Rats', how: 'variant' });
    assert.deepEqual(r.binding, { template: r.settled.template, text: 'Kill 6 culvert rats in the south levee granary and collect tails', foe: 'pack.ersveil-bluewatch/cellar-rat-swarm' });
    assert.deepEqual([r.settled.count, r.settled.coin, r.settled.coinBy, r.settled.xp, r.settled.durationMinutes], [6, 50, 'formula', 50, 10080]);
    assert.deepEqual([r.settled.giver, slug(r.settled.turnInPlace), r.settled.rank, r.settled.area, r.settled.waived], ['Hollis', 'bluewatch-village', 'F', { tier: 0, from: 'place' }, []]);
    assert.equal(r.settled.text, 'Kill 6 culvert rats in the south levee granary and collect tails', 'the goal is kept whole');
    assert.equal(r.notes.join('; '), 'reward "12 crowns" is not this chat\'s money; set to 5 silver; Culvert Rats is a named kind of Cellar Rat Swarm; deadline set to 7 days');
    const terms = settledTerms(r, 'Granary Vermin', COPPER);
    assert.equal(terms, 'Posted job: Granary Vermin (from Hollis): kill 6 Culvert Rats within 7 days; pays 5 silver and 50 XP, turned in at Bluewatch Village. Fight them as ! encounter 6 Culvert Rats | like: cellar-rat-swarm | tier: weak. These are the terms from now on; nobody in the scene has to restate them.');
    assert.equal([...terms].length, 287);
});

test('G1 on the reader\'s crowns: 12 crowns is the chat\'s money, raised to the floor, 50 crowns', () => {
    const r = offer(G1, { currency: CROWNS });
    assert.equal(r.band, 'moderate');
    assert.deepEqual([r.settled.coin, r.settled.coinBy, r.settled.count], [50, 'said', 6]);
    assert.equal(r.notes.join('; '), 'reward set to 50 crowns (rank F range); Culvert Rats is a named kind of Cellar Rat Swarm; deadline set to 7 days');
    assert.match(settledTerms(r, 'Granary Vermin', CROWNS), /pays 50 crowns and 50 XP/);
});

test('G2: a named kind of the Starved Crag Wolf (the Crag Wolf Matriarch cannot scale into a tier 0 area), kill 1, 5 silver; 50 crowns on the reader\'s money', () => {
    const r = offer(G2);
    assert.equal(r.band, 'moderate');
    assert.deepEqual([r.settled.foe.name, slug(r.settled.foe.base), slug(r.settled.foe.ref), r.settled.count, r.settled.coin, r.settled.xp], ['Alpha of the Scrub Wolf Pack', 'starved-crag-wolf', 'starved-crag-wolf~alpha-of-the-scrub-wolf-pack', 1, 50, 50]);
    assert.ok(r.notes.includes('count set to 1'));
    const terms = settledTerms(r, 'Scrub Pack', COPPER);
    assert.equal(terms, 'Posted job: Scrub Pack (from Hollis): kill 1 Alpha of the Scrub Wolf Pack within 7 days; pays 5 silver and 50 XP, turned in at Bluewatch Village. Fight it as ! encounter Alpha of the Scrub Wolf Pack | like: starved-crag-wolf. These are the terms from now on; nobody in the scene has to restate them.');
    assert.equal([...terms].length, 299);
    const crowns = offer(G2, { currency: CROWNS });
    assert.deepEqual([crowns.band, crowns.settled.coin], ['moderate', 50]);
    assert.match(settledTerms(crowns, 'Scrub Pack', CROWNS), /pays 50 crowns/);
});

test('G3 to G8: the requested hunts', () => {
    const rows = [
        ['G3', '+ quest Granary Vermin | type: cull | goal: Kill rats in the granary | reward: a dozen crowns', {}, ['moderate', 'open-hunt-f', 'F', 1, 50, 'Cellar Rat Swarm']],
        ['G4', '+ quest Rat Trouble | goal: kill a handful of rats in the cellar', {}, ['within', 'open-hunt-f', 'F', 5, 50, 'Cellar Rat Swarm']],
        ['G5', '+ quest Cellar Clearing | goal: Kill the rats in the cellar | difficulty: hard', {}, ['within', 'open-hunt-f', 'F', 1, 50, 'Cellar Rat Swarm']],
        ['G5b', '+ quest Cellar Clearing | goal: Kill the rats in the cellar | difficulty: hard', { level: 14 }, ['within', 'open-hunt-f', 'F', 1, 50, 'Cellar Rat Swarm']],
        ['G6', '+ quest Matriarch | type: hunt | goal: Slay the Crag Wolf Matriarch | difficulty: easy', {}, ['within', 'open-story-task-f', 'F', undefined, 50, undefined]],
        ['G7', '+ quest Bear Problem | type: hunt | goal: Slay the frost bear | difficulty: easy', {}, ['within', 'open-hunt-e', 'E', 1, 1044, 'Frost Bear']],
        ['G8', '+ quest Drake Hunt | goal: Kill the sea drake off the coast | reward: 300 copper', {}, ['moderate', 'open-hunt-c', 'C', 1, 12000, 'Sea Drake']],
    ];
    for (const [id, text, options, [band, template, rank, count, coin, foe]] of rows) {
        const r = offer(text, options);
        assert.equal(r.kind, 'offer', id);
        assert.deepEqual([r.band, slug(r.settled.template), r.settled.rank, r.settled.count, r.settled.coin, r.settled.foe?.name], [band, template, rank, count, coin, foe], id);
    }
    const g5b = offer(rows[3][1], { level: 14 });
    assert.ok(g5b.notes.includes('difficulty hard set aside: Cellar Rat Swarm is a rank F foe'));
    assert.equal(offer(rows[2][1]).notes.some(note => /set aside/.test(note)), false, 'hard is held to the party\'s own rank F: nothing was set aside');
    const g6 = offer(rows[4][1]);
    assert.ok(g6.notes.some(note => /Crag Wolf Matriarch cannot be fought under these rules/.test(note)), 'tier 1 but level 5: rank F, over the interim stat budget');
    const g7 = offer(rows[5][1]);
    assert.deepEqual([g7.settled.xp, g7.settled.waived, g7.settled.area], [1044, ['level'], { tier: 1, from: 'foe' }]);
    assert.ok(g7.notes.includes('well above your rank (rank E job; you are rank F)'));
    const g8 = offer(rows[6][1]);
    assert.deepEqual([g8.settled.xp, g8.settled.area, g8.settled.waived, g8.settled.coinBy], [33333, { tier: 4, from: 'foe' }, ['level'], 'said']);
});

test('G9: 50 gold is far out; the narrator is told once, and it is no offer', () => {
    const r = offer('+ quest Boar Hunt | goal: Hunt 3 wild boars | reward: 50 gold');
    assert.deepEqual([r.kind, r.why, r.written, r.max, r.rank], ['far', 'reward', 5000, 400, 'F']);
    assert.equal(farLineOf(r, COPPER), 'Earlier, Boar Hunt was mentioned as a job, but it isn\'t one that can be offered here (50 gold is far above what a rank F job pays: 4 gold at most). Let it stay as talk or a rumour; if a job is wanted, offer it for 4 gold or less.');
    assert.equal(offer('+ quest Boar Hunt | goal: Hunt 3 wild boars | reward: 1200 copper').kind, 'offer', '3 times the top is still moderate');
    assert.equal(offer('+ quest Boar Hunt | goal: Hunt 3 wild boars | reward: 1201 copper').kind, 'far');
});

test('G10 to G14: teachers', () => {
    const teach = text => matchTrainer(env(), lineOf(text));
    assert.deepEqual(['G10', 'G11'].map((id, i) => teach(['+ trainer Old Reka — blade drills', '+ trainer Old Reka — swordplay'][i]).binding.template), ['pack.ersveil-bluewatch/open-blade-drills', 'pack.ersveil-bluewatch/open-blade-drills']);
    assert.equal(teach('+ trainer Old Reka — blade drills').fee, null, 'no fee written: the recorded die rolls it');
    assert.equal(teach('+ trainer Old Pell — fishing and net mending').kind, 'none');
    const far = teach('+ trainer Old Reka — blade drills | fee: 5 gold');
    assert.deepEqual([far.kind, far.why, far.written, far.max], ['far', 'fee', 500, 90]);
    assert.equal(farLineOf(far, COPPER), 'Earlier, Old Reka was mentioned as a job, but it isn\'t one that can be offered here (a fee of 5 gold is far above Blade drills: 9 silver at most). Let it stay as talk or a rumour; if a job is wanted, offer the lessons for 9 silver or less.');
    const low = teach('+ trainer Old Reka — blade drills | fee: 10 copper');
    assert.deepEqual([low.band, low.fee, low.notes], ['moderate', { value: 40, by: 'said' }, ['fee set to 4 silver']]);
});

test('G16 and G17: the same offer key is a quiet no-op; a finished job is far out', () => {
    const second = offer('+ quest The Granary Vermin | type: cull | goal: kill 6 rats', { threads: [{ key: 'Granary Vermin', state: 'offered' }] });
    assert.deepEqual([second.kind, second.message], ['noop', 'Granary Vermin is already posted.']);
    const done = offer(G1, { threads: [{ key: 'Granary Vermin', state: 'done' }] });
    assert.deepEqual([done.kind, done.why], ['far', 'already']);
    assert.equal(farLineOf(done, COPPER), 'Earlier, Granary Vermin was mentioned as a job, but it isn\'t one that can be offered here (Granary Vermin is already done). Let it stay as talk or a rumour; if a job is wanted, offer a new job under a new name.');
    for (const key of ['Granary Vermin II', 'Granary Vermin Returns']) {
        assert.equal(offer(G1, { threads: [{ key, state: 'active' }] }).kind, 'offer', `${key} is another job`);
    }
});

test('a far-out decision on record makes a bare acceptance of that name a quiet no-op; a line with offer labels is a new offer', () => {
    const declined = ['boar hunt'];
    assert.equal(offer('+ quest Boar Hunt', { declined }).kind, 'noop');
    assert.equal(offer('+ quest The Boar Hunt — hunt', { declined }).kind, 'noop', 'the article is not part of the key');
    assert.equal(offer('+ quest Boar Hunt | goal: Hunt 3 wild boars | reward: 300 copper', { declined }).kind, 'offer');
});

test('true refusals: an empty name; a pin with no open template of a usable kind', () => {
    const empty = offer('+ quest <> | goal: x');
    assert.deepEqual([empty.kind, empty.code], ['refuse', 'INVALID']);
    const closed = derivedPin(resolved => { for (const quest of Object.values(resolved.quests)) delete quest.open; });
    const none = offer(G1, { pin: closed });
    assert.deepEqual([none.kind, none.code, none.message], ['refuse', 'RULES_MISMATCH', 'This world has no open job template for that.']);
    const storyOnly = derivedPin(resolved => { for (const [id, quest] of Object.entries(resolved.quests)) if (quest.open && quest.objectives[0].kind !== 'story') delete resolved.quests[id]; });
    const story = offer(G1, { pin: storyOnly });
    assert.equal(story.kind, 'offer', 'a pin with only story templates keeps the goal for the story to judge');
    assert.deepEqual([slug(story.settled.template), story.settled.foe], ['open-story-task-f', undefined]);
});
