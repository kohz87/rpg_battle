// A job's difficulty sets the tier of the fight its terms tell (RPG Battle 2.3.0): easy `| tier: weak`, hard `| tier: strong`, normal none. The tier is worked out
// once at capture and kept in the settled binding, so a Re-read, a reload and a rebuild tell the same line. Pure first, then the real host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOffer } from '../../../src/v2/quests/offer-match.js';
import { encounterLine, settledTerms, termsLine } from '../../../src/v2/quests/offer-bands.js';
import { FIGHT_TIER } from '../../../src/v2/quests/offer-rules.js';
import { readEncounter } from '../../../src/v2/combat/encounter.js';
import { offersOf, settledProblem } from '../../../src/v2/rules/offers.js';
import { seeded } from '../integration/helpers/host.js';
import { COPPER, derivedPin, env, lineOf } from './helpers/offer-env.js';
import { accept, bluewatch, lastTail } from './helpers/bluewatch.js';

const hunt = (difficulty, options) => matchOffer(env(options), lineOf(`+ quest Rats | type: cull | goal: Kill 3 culvert rats in the granary${difficulty === null ? '' : ` | difficulty: ${difficulty}`}`));
const toldLine = result => /! encounter (.*?)\. These/.exec(settledTerms(result, 'Rats', COPPER))?.[1];

test('easy writes the fight at tier weak, hard at tier strong, normal and no difficulty write none', () => {
    assert.deepEqual(FIGHT_TIER, { easy: 'weak', hard: 'strong', nightmare: 'strong' });
    const told = word => toldLine(hunt(word));
    assert.equal(told('easy'), '3 Culvert Rats | like: cellar-rat-swarm | tier: weak');
    assert.equal(told('hard'), '3 Culvert Rats | like: cellar-rat-swarm | tier: strong');
    assert.equal(told('normal'), '3 Culvert Rats | like: cellar-rat-swarm');
    assert.equal(told(null), '3 Culvert Rats | like: cellar-rat-swarm');
    assert.deepEqual(['easy', 'normal', 'hard', null].map(word => hunt(word).settled.fightTier), ['weak', undefined, 'strong', undefined]);
});

test('the words that mean a difficulty count (simple, tough, nightmare); a difficulty that names a rank writes no tier', () => {
    assert.equal(hunt('simple').settled.fightTier, 'weak');
    assert.equal(hunt('tough').settled.fightTier, 'strong');
    assert.equal(hunt('nightmare').settled.fightTier, 'strong', 'nightmare reads as hard: a job is a fight the party is meant to win');
    assert.equal(hunt('D-rank').settled.fightTier, undefined, 'a rank is not a difficulty word');
    assert.equal(hunt('something odd').settled.fightTier, undefined);
});

test('a pack\'s own difficulty words set it too; a job that is no fight, or has no foe, tells no tier', () => {
    const words = derivedPin(resolved => { resolved.manifest = { ...resolved.manifest, offerWords: { easy: ['stroll'], hard: ['gauntlet'] } }; });
    assert.equal(hunt('stroll', { pin: words }).settled.fightTier, 'weak');
    assert.equal(hunt('gauntlet', { pin: words }).settled.fightTier, 'strong');
    const story = matchOffer(env(), lineOf('+ quest Old Debts | goal: Settle the matter with the river guild | difficulty: hard'));
    assert.deepEqual([story.settled.foe, story.settled.fightTier], [undefined, undefined]);
    const gather = matchOffer(env(), lineOf('+ quest Tails | type: gather | goal: Collect 3 rat tails | difficulty: easy'));
    assert.equal(gather.settled.fightTier, undefined);
});

test('the settled record accepts only weak or strong, and only beside a foe', () => {
    const ok = hunt('easy').settled;
    assert.equal(settledProblem(ok), '');
    assert.match(settledProblem({ ...ok, fightTier: 'deadly' }), /fight tier/);
    const { foe, ...bare } = ok;
    assert.match(settledProblem({ ...bare, fightTier: 'weak' }), /fight tier/);
});

test('the told line is one the encounter reader takes: tier and like together, the foe and count unchanged', () => {
    for (const tier of ['weak', 'strong']) {
        const line = encounterLine({ name: 'Culvert Rats', how: 'variant', base: 'pack.x/cellar-rat-swarm' }, 6, tier);
        assert.equal(line, `! encounter 6 Culvert Rats | like: cellar-rat-swarm | tier: ${tier}`);
        const read = readEncounter(lineOf(line), { bestiary: [], literal: true, leadingCount: true });
        assert.equal(read.ok, true, read.message);
        assert.deepEqual(read.foes.map(foe => [foe.name, foe.count, foe.tier]), [['Culvert Rats', 6, tier]]);
    }
    assert.equal(encounterLine({ name: 'Fen Wolf', how: 'exact', base: 'pack.x/fen-wolf' }, 1, 'strong'), '! encounter Fen Wolf | tier: strong');
    assert.equal(encounterLine({ name: 'Fen Wolf', how: 'exact', base: 'pack.x/fen-wolf' }, 4), '! encounter 4 Fen Wolf', 'no tier given, none written');
});

test('the terms keep the fight line whole, tier included, however long the free text is', () => {
    const long = 'x'.repeat(400);
    const line = termsLine({ name: long, giver: long, objective: `kill 6 ${long}`, deadline: '7 days', coin: 50, xp: 50, where: long, fight: { count: 6, line: encounterLine({ name: 'Culvert Rats', how: 'variant', base: 'pack.x/cellar-rat-swarm' }, 6, 'strong') } }, COPPER);
    assert.ok([...line].length <= 320);
    assert.ok(line.includes('Fight them as ! encounter 6 Culvert Rats | like: cellar-rat-swarm | tier: strong.'));
});

test('on the real host an easy job is told at tier weak and a hard one at tier strong, kept in the record, and a Re-read, a reload and a rebuild tell the same', async t => {
    await seeded(8210, async () => {
        const h = await bluewatch(t, { pack: undefined });
        await h.say('Offer.', ['+ quest Granary Vermin | giver: Hollis | type: cull | goal: Kill 3 culvert rats in the granary | difficulty: easy']);
        assert.deepEqual(h.turn.problems(), []);
        const offered = h.ctx.chat.length - 1;
        const record = Object.values(offersOf(h.head().domains.rules)).find(row => row.name === 'Granary Vermin');
        assert.equal(record.settled.fightTier, 'weak');
        await h.say('Hollis waits.');
        assert.match(lastTail(h), /Fight them as ! encounter 3 Culvert Rats \| like: cellar-rat-swarm \| tier: weak\./);
        assert.equal((await h.turn.reread(offered)).ok, true);
        assert.equal(Object.values(offersOf(h.head().domains.rules)).find(row => row.name === 'Granary Vermin').settled.fightTier, 'weak', 'a Re-read keeps the tier');
        const live = JSON.stringify(h.head());
        h.store.rebuild();
        assert.equal(JSON.stringify(h.head()), live);
        await h.st.loadChat(structuredClone(h.ctx.chat));
        assert.equal(JSON.stringify(h.head()), live, 'a reload tells the same');
        await accept(h, 'Granary Vermin');
        await h.say('More.', ['+ quest Ditch Wolves | giver: Hollis | type: hunt | goal: Kill 2 starved crag wolves | difficulty: hard']);
        assert.equal(Object.values(offersOf(h.head().domains.rules)).find(row => row.name === 'Ditch Wolves').settled.fightTier, 'strong');
    });
});
