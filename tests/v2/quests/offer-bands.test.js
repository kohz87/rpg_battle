// Bands, notes and the two lines told back (GENERATIVE_OFFERS_SPEC §6, §8, §9.2): pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAR, NOTE, bandOf, cut, encounterLine, farLine, hold, keepNotes, termsLine } from '../../../src/v2/quests/offer-bands.js';
import { COPPER, CROWNS } from './helpers/offer-env.js';

test('FAR is 3, one constant; hold raises, cuts and calls far', () => {
    assert.equal(FAR, 3);
    assert.deepEqual(hold(120, 50, 400), { value: 120, moved: false, far: false });
    assert.deepEqual(hold(12, 50, 400), { value: 50, moved: true, far: false });
    assert.deepEqual(hold(0, 50, 400), { value: 50, moved: true, far: false });
    assert.deepEqual(hold(1000, 50, 400), { value: 400, moved: true, far: false });
    assert.deepEqual(hold(1200, 50, 400), { value: 400, moved: true, far: false }, 'exactly 3 times the top is moderate');
    assert.equal(hold(1201, 50, 400).far, true);
    assert.deepEqual([bandOf({}), bandOf({ moved: true }), bandOf({ moved: true, far: true })], ['within', 'moderate', 'far']);
});

test('the notes read as the spec words them', () => {
    assert.deepEqual([NOTE.countSet(5), NOTE.countCapped(8), NOTE.rewardSet(50, 'F', COPPER), NOTE.rewardSet(50, 'F', CROWNS), NOTE.deadlineSet(10080), NOTE.noClock()],
        ['count set to 5', 'count capped at 8', 'reward set to 5 silver (rank F range)', 'reward set to 50 crowns (rank F range)', 'deadline set to 7 days', 'no story clock, so no deadline']);
    assert.equal(NOTE.rewardForeign('12 crowns', 50, COPPER), 'reward "12 crowns" is not this chat\'s money; set to 5 silver');
    assert.equal(NOTE.rewardUnreadable('a horse', 50, COPPER), 'reward "a horse" has no amount code can read; set to 5 silver');
    assert.equal(NOTE.variant('Culvert Rats', 'Cellar Rat Swarm'), 'Culvert Rats is a named kind of Cellar Rat Swarm');
    assert.equal(NOTE.noFoe('ghosts'), 'no foe for "ghosts"; the story judges the goal');
    assert.equal(NOTE.noItem('moon'), 'no pack item for "moon"; the story judges the goal');
    assert.equal(NOTE.setAside('difficulty hard', 'Cellar Rat Swarm', 'F'), 'difficulty hard set aside: Cellar Rat Swarm is a rank F foe');
    assert.equal(NOTE.aboveRank('E', 'F'), 'well above your rank (rank E job; you are rank F)');
    assert.equal(NOTE.likeUnknown('x'), 'like: x is not a template');
    assert.equal(NOTE.unused('mood'), 'mood was not used');
    assert.equal(NOTE.feeSet(40, COPPER), 'fee set to 4 silver');
    assert.equal(NOTE.skillDropped('Fishing', 'Blade drills'), 'Fishing is not taught by Blade drills');
});

test('notes are kept flat, once each, 6 at most, 160 characters each', () => {
    const kept = keepNotes(['a', 'a', 'b <b> c', 'x'.repeat(200), 'd', 'e', 'f', 'g', '']);
    assert.deepEqual(kept.slice(0, 2), ['a', 'b b c']);
    assert.equal(kept.length, 6);
    assert.equal([...kept[2]].length, 160);
    assert.equal(cut('abc', 2), 'ab');
});

test('the settled-terms line keeps its terms whole and shortens the objective to 320 code points', () => {
    const base = { name: 'Job', giver: null, objective: 'story goal', deadline: '7 days', coin: 120, xp: 50, where: '' };
    assert.equal(termsLine(base, COPPER), 'Posted job: Job: story goal within 7 days; pays 1 gold 2 silver and 50 XP, turned in at a settlement. These are the terms from now on; nobody in the scene has to restate them.');
    assert.equal(termsLine({ ...base, deadline: null, giver: 'Hollis', where: 'Bluewatch Village', fight: { count: 1, line: '! encounter Fen Wolf' } }, COPPER),
        'Posted job: Job (from Hollis): story goal; pays 1 gold 2 silver and 50 XP, turned in at Bluewatch Village. Fight it as ! encounter Fen Wolf. These are the terms from now on; nobody in the scene has to restate them.');
    const long = termsLine({ ...base, objective: 'w '.repeat(400) }, COPPER);
    assert.equal([...long].length <= 320, true);
    assert.match(long, /… within 7 days; pays 1 gold 2 silver and 50 XP, turned in at a settlement\. These are the terms from now on; nobody in the scene has to restate them\.$/);
});

test('the encounter line: a pack foe by its name, a named kind with its base after like:, a count when above one', () => {
    assert.equal(encounterLine({ name: 'Fen Wolf', how: 'exact', base: 'pack.x/fen-wolf' }, 4), '! encounter 4 Fen Wolf');
    assert.equal(encounterLine({ name: 'Fen Wolf', how: 'exact', base: 'pack.x/fen-wolf' }, 1), '! encounter Fen Wolf');
    assert.equal(encounterLine({ name: 'Culvert Rats', how: 'variant', base: 'pack.x/cellar-rat-swarm' }, 6), '! encounter 6 Culvert Rats | like: cellar-rat-swarm');
});

test('the far-out line is cut to 300 code points and never says more than the one reason', () => {
    const line = farLine({ name: 'N'.repeat(400), reason: 'r', suggestion: 's' });
    assert.equal([...line].length, 300);
    assert.equal(farLine({ name: 'Job', reason: 'it was offered and finished at once', suggestion: 'it as an open job, and close it when it is done' }),
        'Earlier, Job was mentioned as a job, but it isn\'t one that can be offered here (it was offered and finished at once). Let it stay as talk or a rumour; if a job is wanted, offer it as an open job, and close it when it is done.');
});
