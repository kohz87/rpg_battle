// matchOffer's steps (GENERATIVE_OFFERS_SPEC §4, §5.1) one at a time on Bluewatch 1.6.0 and on pins derived from it that carry what Story Block 2.5.0 lets a
// pack write (explicit count bounds, foe aliases, offer words): they stand in for Bluewatch 1.7.0, which was skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boundsOf, matchOffer, offerKey, readLine, targetOf } from '../../../src/v2/quests/offer-match.js';
import { templates } from '../../../src/v2/quests/seams.js';
import { COPPER, CROWNS, derivedPin, env, lineOf, PIN } from './helpers/offer-env.js';

const offer = (text, options) => matchOffer(env(options), lineOf(text));
const slug = ref => String(ref).split('/')[1];
const HUNT = '+ quest Rats | type: cull | goal: Kill 40 rats in the cellar';

// Bluewatch 1.6.0 with the 1.7.0 additions of the spec (§12.3): bounds on the open hunts and deliveries, aliases on a few creatures.
const explicit = derivedPin(resolved => {
    const limits = { F: [8, 6], E: [8, 6], D: [6, 4], C: [4, 4] };
    for (const quest of Object.values(resolved.quests)) {
        if (quest.open !== true) continue;
        const [hunt, delivery] = limits[quest.rank];
        const objective = quest.objectives[0];
        if (objective.kind === 'kill') Object.assign(objective, { countMin: 1, countMax: hunt });
        if (objective.kind === 'collect') Object.assign(objective, { countMin: 1, countMax: delivery });
    }
    Object.assign(resolved.foes['pack.ersveil-bluewatch/cellar-rat-swarm'], { aliases: ['rats', 'cellar rats', 'rat swarm'] });
    Object.assign(resolved.foes['pack.ersveil-bluewatch/starved-crag-wolf'], { aliases: ['crag wolf'] });
    Object.assign(resolved.foes['pack.ersveil-bluewatch/roadside-bandit'], { aliases: ['bandit', 'bandits', 'highwayman'] });
});

test('count bounds without any in the pack come from the closed quests: kill 8, collect 4 on Bluewatch 1.6.0 (decision Q1)', () => {
    const all = templates(PIN);
    const hunt = all.find(quest => quest.slug === 'open-hunt-f');
    const delivery = all.find(quest => quest.slug === 'open-delivery-f');
    assert.deepEqual(boundsOf(all, hunt), { min: 1, max: 8, own: 1 });
    assert.deepEqual(boundsOf(all, delivery), { min: 1, max: 4, own: 1 });
    assert.equal(offer(HUNT).settled.count, 8);
    assert.equal(offer('+ quest Tails | goal: Collect 40 rat tails').settled.count, 4);
});

test('explicit bounds win: a pin with countMin and countMax holds the count to them (kill 6 at rank D, delivery 6 at F)', () => {
    const all = templates(explicit);
    const bounds = slugName => boundsOf(all, all.find(quest => quest.slug === slugName));
    assert.deepEqual([bounds('open-hunt-f'), bounds('open-hunt-d'), bounds('open-delivery-f'), bounds('open-delivery-c')].map(b => [b.min, b.max]), [[1, 8], [1, 6], [1, 6], [1, 4]]);
    assert.equal(offer('+ quest Tails | goal: Collect 40 rat tails', { pin: explicit }).settled.count, 6, 'delivery F: 6 here, 4 on the implicit pin');
    assert.equal(offer('+ quest Tails | goal: Collect 6 rat tails', { pin: explicit }).band, 'within');
    assert.equal(offer('+ quest Tails | goal: Collect 6 rat tails').band, 'moderate', 'the same line on the 1.6.0 pin is capped at 4');
    const big = derivedPin(resolved => { resolved.quests['pack.ersveil-bluewatch/open-hunt-f'].objectives[0].countMax = 3; resolved.quests['pack.ersveil-bluewatch/open-hunt-f'].objectives[0].count = 2; });
    assert.deepEqual([offer(HUNT, { pin: big }).settled.count, offer('+ quest Rats | goal: Kill rats', { pin: big }).settled.count], [3, 2], 'no count written: the template\'s own');
    const raised = derivedPin(resolved => { Object.assign(resolved.quests['pack.ersveil-bluewatch/open-hunt-f'].objectives[0], { countMin: 3, count: 3 }); });
    const low = offer('+ quest Rats | goal: Kill 1 rats in the cellar', { pin: raised });
    assert.deepEqual([low.settled.count, low.band], [3, 'moderate']);
});

test('foe aliases: the story\'s other names for a creature match it exactly', () => {
    const plain = offer('+ quest Wanted | goal: Kill a highwayman on the road');
    assert.equal(plain.settled.foe.how, 'variant', 'without the alias it is a named kind');
    const aliased = offer('+ quest Wanted | goal: Kill a highwayman on the road', { pin: explicit });
    assert.deepEqual([aliased.settled.foe.name, aliased.settled.foe.how], ['Roadside Bandit', 'exact']);
    const crag = offer('+ quest Wolf | goal: Kill a crag wolf', { pin: explicit });
    assert.deepEqual([crag.settled.foe.name, crag.settled.foe.how], ['Starved Crag Wolf', 'exact']);
    assert.equal(offer('+ quest Rats | goal: Kill 3 rat swarm', { pin: explicit }).settled.foe.name, 'Cellar Rat Swarm');
});

test('offer words of the pack are read before the built-in table', () => {
    const words = { hunt: ['jagd'], gather: ['sammeln'], easy: ['leicht'], hard: ['schwer'] };
    const pin = derivedPin(resolved => { resolved.manifest.offerWords = words; });
    const a = offer('+ quest Wölfe | type: jagd | goal: Kill 3 fen wolves | difficulty: schwer', { pin });
    assert.equal(slug(a.settled.template), 'open-hunt-f');
    const b = offer('+ quest Moos | type: sammeln | goal: Bring 2 bluecap moss', { pin });
    assert.equal(slug(b.settled.template), 'open-delivery-f');
    const c = offer('+ quest Rätsel | type: jagd | goal: Wer hat es getan', { pin });
    assert.equal(slug(c.settled.template), 'open-story-task-f', 'the pack\'s type word decides the kind; with no phrase and no foe in the goal the story judges it');
    const plain = offer('+ quest Wölfe | type: jagd | goal: Kill 3 fen wolves');
    assert.equal(slug(plain.settled.template), 'open-hunt-f', 'the goal verb still reads without the pack words');
});

test('the target phrase and count: skipped words, stop words, the 8-word limit, -ing clauses', () => {
    const read = text => targetOf(text);
    assert.deepEqual(read(' 6 culvert rats in the south levee granary and collect tails'), { phrase: 'culvert rats', count: 6 });
    assert.deepEqual(read(' the alpha of the scrub wolf pack north of the ditch'), { phrase: 'alpha of the scrub wolf pack', count: null });
    assert.deepEqual(read(' at least 3 wolves from East Bluff'), { phrase: 'wolves', count: 3 });
    assert.deepEqual(read(' a handful of rats'), { phrase: 'rats', count: 5 });
    assert.deepEqual(read(' all the goblin raiders stealing chickens'), { phrase: 'goblin raiders', count: null });
    assert.deepEqual(read(' the Hollow King'), { phrase: 'Hollow King', count: null });
    assert.deepEqual(read(' some wolves beneath the bridge'), { phrase: 'wolves', count: null });
    assert.deepEqual(read(' the sea drake off the coast'), { phrase: 'sea drake', count: null });
    assert.equal(read(' one two three four five six seven eight nine ten eleven').phrase.split(' ').length <= 8, true);
    assert.deepEqual(read(' twelve boars, then rest'), { phrase: 'boars', count: 12 });
    assert.deepEqual(read(''), { phrase: '', count: null });
});

test('the lines are read as the spec says: fallbacks, flattening, cuts, unused labels', () => {
    const labels = Object.assign(Object.create(null), { type: 'cull', text: 'Kill <b>rats</b>', deadline: 'in 2 days', rank: 'E', foe: 'rat', mystery: 'x' });
    const read = readLine({ name: `  ${'N'.repeat(100)}  `, text: 'after the dash', labels });
    assert.equal([...read.name].length, 80);
    assert.deepEqual([read.goal, read.due, read.difficulty, read.target, read.unused], ['Kill b rats /b', 'in 2 days', 'E', 'rat', ['mystery']]);
    assert.equal(read.goal.includes('<'), false);
    assert.equal(readLine({ name: 'Smugglers', text: 'find out who', labels: {} }).goal, 'find out who');
    assert.equal(readLine({ name: 'The Missing Boy', text: '', labels: {} }).goal, 'The Missing Boy');
    assert.equal(readLine({ name: 'x', text: '', labels: { goal: 'G'.repeat(300) } }).goal.length, 240);
    assert.equal(offerKey('The Granary Vermin!'), offerKey("granary  vermin"));
    assert.notEqual(offerKey('Granary Vermin II'), offerKey('Granary Vermin'));
    const r = offer('+ quest Rats | goal: Kill 3 rats | mood: grim | colour: red');
    assert.deepEqual(r.notes.filter(note => /was not used/.test(note)), ['mood was not used', 'colour was not used']);
    assert.equal(r.band, 'within', 'a label that is not used is never a refusal or a move');
});

test('deadlines: written, clamped, missing, unreadable, and no story clock', () => {
    const minutes = (text, options) => offer(`+ quest Rats | goal: Kill 3 rats | ${text}`, options).settled.durationMinutes;
    assert.equal(minutes('due: in 2 days'), 2880);
    assert.equal(minutes('due: tomorrow'), 1440);
    assert.equal(minutes('due: in 10 minutes'), 60, 'at least an hour');
    assert.equal(minutes('due: in 400 days'), 43200, 'at most 30 days when the template has none');
    assert.equal(minutes('due: before the harvest'), 10080);
    assert.equal(minutes('mood: x'), 10080);
    const moved = offer('+ quest Rats | goal: Kill 3 rats | due: in 400 days');
    assert.deepEqual([moved.band, moved.notes.includes('deadline set to 30 days')], ['moderate', true]);
    const unreadable = offer('+ quest Rats | goal: Kill 3 rats | due: before the harvest');
    assert.deepEqual([unreadable.band, unreadable.notes.includes('deadline set to 7 days')], ['within', true]);
    const timed = derivedPin(resolved => { resolved.quests['pack.ersveil-bluewatch/open-hunt-f'].durationMinutes = 2880; });
    assert.equal(minutes('due: in 5 days', { pin: timed }), 2880, 'a template\'s own deadline is the longest');
    assert.equal(minutes('mood: x', { pin: timed }), 2880, 'and the default');
    const clockless = offer('+ quest Rats | goal: Kill 3 rats | due: in 2 days', { clock: false });
    assert.deepEqual([clockless.settled.durationMinutes, clockless.notes.includes('no story clock, so no deadline')], [null, true]);
});

test('the area: the place\'s tier, else the rank\'s; a foe above it moves it to the foe\'s own', () => {
    const tier = (text, options) => offer(text, options).settled.area;
    assert.deepEqual(tier('+ quest Rats | goal: Kill 3 rats', { tier: 0 }), { tier: 0, from: 'place' });
    assert.deepEqual(tier('+ quest Rats | goal: Kill 3 rats', { tier: null }), { tier: 0, from: 'rank' });
    assert.deepEqual(tier('+ quest Rats | goal: Kill 3 rats', { tier: 2 }), { tier: 2, from: 'place' });
    assert.deepEqual(tier('+ quest Rats | goal: Kill 3 rats', { tier: 2 }), { tier: 2, from: 'place' });
    assert.deepEqual(tier('+ quest Bear | goal: Kill the frost bear', { tier: null }), { tier: 1, from: 'foe' });
    const here = offer('+ quest Rats | goal: Kill 3 rats', { tier: 2 });
    assert.deepEqual([here.settled.coin, here.settled.xp], [50 + Math.floor((400 - 50) * 2 / 9), 50 + Math.floor((400 - 50) * 2 / 9)]);
    const story = offer('+ quest Old Debts | goal: Settle the matter with the river guild | difficulty: normal', { level: 25, tier: null });
    assert.deepEqual([story.settled.rank, story.settled.area], ['D', { tier: 2, from: 'rank' }]);
});

test('requirements: a template whose requirement fails is skipped for the next; level is waived only for a foe above the party\'s rank', () => {
    const gated = derivedPin(resolved => { resolved.quests['pack.ersveil-bluewatch/open-hunt-f'].requirements = [{ kind: 'level', min: 5 }]; });
    const low = offer('+ quest Rats | goal: Kill 3 rats', { pin: gated });
    assert.equal(slug(low.settled.template), 'open-story-task-f', 'no hunt fits level 3: the rank\'s story template, the goal kept for the story');
    assert.ok(low.notes.some(note => /no foe for/.test(note)));
    const able = offer('+ quest Rats | goal: Kill 3 rats', { pin: gated, level: 6 });
    assert.equal(slug(able.settled.template), 'open-hunt-f');
    const classed = derivedPin(resolved => { resolved.quests['pack.ersveil-bluewatch/open-hunt-f'].requirements = [{ kind: 'flag', key: 'x', value: true }]; });
    assert.equal(slug(offer('+ quest Bear | goal: Kill the frost bear', { pin: classed }).settled.template), 'open-hunt-e', 'a lower hunt is not tried before the foe\'s own rank');
    const above = offer('+ quest Bear | goal: Kill the frost bear');
    assert.deepEqual(above.settled.waived, ['level']);
    const flagged = derivedPin(resolved => { resolved.quests['pack.ersveil-bluewatch/open-hunt-e'].requirements = [{ kind: 'level', min: 11 }, { kind: 'flag', key: 'x', value: true }]; });
    const stuck = offer('+ quest Bear | goal: Kill the frost bear', { pin: flagged });
    assert.deepEqual([stuck.settled.waived, slug(stuck.settled.template)], [[], 'open-hunt-f'], 'only level is waived: another requirement sends it down a rank');
});

test('coin: each is multiplied by the count; amounts in words; none and unreadable rewards; the top and 3 times the top', () => {
    const coin = (reward, options) => offer(`+ quest Rats | goal: Kill 5 rats | reward: ${reward}`, options);
    assert.equal(coin('1 silver each').settled.coin, 50);
    assert.equal(coin('2 silver each').settled.coin, 100);
    assert.equal(coin('a hundred copper').settled.coin, 100);
    assert.equal(coin('half a dozen silver').settled.coin, 60);
    assert.deepEqual([coin('400 copper').band, coin('400 copper').settled.coin], ['within', 400]);
    assert.deepEqual([coin('401 copper').band, coin('401 copper').settled.coin], ['moderate', 400]);
    assert.deepEqual([coin('none').band, coin('nothing').settled.coin], ['moderate', 50]);
    const unreadable = coin('a fine horse');
    assert.deepEqual([unreadable.band, unreadable.settled.coin, unreadable.settled.coinBy], ['moderate', 50, 'formula']);
    assert.ok(unreadable.notes.some(note => /^reward "a fine horse" has no amount code can read; set to 5 silver$/.test(note)));
    assert.equal(coin('1201 copper').kind, 'far');
    assert.deepEqual(coin('13 crowns', { currency: CROWNS }).settled.coin, 50);
    assert.deepEqual(coin('13 crowns', { currency: COPPER }).band, 'moderate');
    assert.deepEqual([coin('10 gold and 5 silver').band, coin('10 gold and 5 silver').settled.coin], ['moderate', 400], 'two coins add up: 1,050 copper');
    assert.equal(coin('12 gold and 5 silver').kind, 'far');
    const goal = offer('+ quest Rats | goal: Kill 5 rats, the clerk pays 90 copper');
    assert.equal(goal.settled.coin, 90, 'a reward in the goal text is read when no reward: is written');
});

test('a pin with no ladder row for a template\'s rank, a level the ladder does not hold, and no PC level', () => {
    assert.equal(offer('+ quest Rats | goal: Kill 3 rats', { level: null }).settled.rank, 'F');
    assert.equal(offer('+ quest Old Debts | goal: Settle the matter with the river guild', { level: 99 }).settled.rank, 'C', 'above every templated row: the highest');
    assert.equal(offer('+ quest Old Debts | goal: Settle the matter with the river guild', { level: 15 }).settled.rank, 'E');
    assert.equal(offer('+ quest Old Debts | goal: Settle the matter with the river guild | rank: S', { level: 15 }).settled.rank, 'E', 'a written rank is held to the party\'s');
    assert.equal(offer('+ quest Old Debts | goal: Settle the matter with the river guild | rank: Veteran', { level: 15 }).settled.rank, 'E');
    assert.equal(offer('+ quest Old Debts | goal: Settle the matter with the river guild | difficulty: easy', { level: 15 }).settled.rank, 'F', 'easy is one rank below');
});

test('a far or done line is no offer even when written with labels', () => {
    for (const text of ['+ quest A | goal: Kill 3 rats | status: done', '+ quest A | goal: Kill 3 rats | met: yes', '+ quest A | goal: Kill 3 rats | status: finished', '+ quest A — done']) {
        assert.deepEqual([text, offer(text).kind, offer(text).why], [text, 'far', 'done']);
    }
    assert.equal(offer('+ quest A | goal: Kill 3 rats | met: no').kind, 'offer');
});

test('a visit template: the caller resolves the place; a place it cannot find leaves a story goal; a pack without one never reads explore as a visit', () => {
    const visits = derivedPin(resolved => { resolved.quests['pack.ersveil-bluewatch/open-delivery-f'].objectives = [{ id: 'ob_00000001', kind: 'visit' }]; });
    const places = { 'auvoth': { id: 'pack.ersveil-bluewatch/auvoth', name: 'Auvoth' }, 'pack.ersveil-bluewatch/auvoth': { id: 'pack.ersveil-bluewatch/auvoth', name: 'Auvoth' } };
    const read = (text, options = {}) => matchOffer({ ...env({ pin: visits, ...options }), placeOf: asked => places[String(asked).toLowerCase()] ?? null }, lineOf(text));
    const found = read('+ quest Message | type: explore | goal: Scout Auvoth for the guild | reward: 70 copper');
    assert.deepEqual([slug(found.settled.template), found.settled.place, found.binding.place, found.settled.count], ['open-delivery-f', { id: 'pack.ersveil-bluewatch/auvoth', name: 'Auvoth' }, 'pack.ersveil-bluewatch/auvoth', undefined]);
    assert.deepEqual([found.settled.coin, found.placeRecord.name], [70, 'Auvoth']);
    assert.equal(slug(read('+ quest Message | place: pack.ersveil-bluewatch/auvoth').settled.template), 'open-delivery-f', 'a place: label, or a canonical id');
    const lost = read('+ quest Message | type: explore | goal: Scout Nowhere for the guild');
    assert.equal(slug(lost.settled.template), 'open-story-task-f');
    assert.ok(lost.notes.includes('no place for "Nowhere"; the story judges the goal'));
    const plain = offer('+ quest Message | type: explore | goal: Scout Auvoth for the guild');
    assert.equal(slug(plain.settled.template), 'open-story-task-f', 'Bluewatch has no visit template: explore becomes a story task');
});
