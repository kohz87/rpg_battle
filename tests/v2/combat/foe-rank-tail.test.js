// A foe's written rank in the fight instructions (Story Block beta.1 known issue): a fight with a
// foe of `rank: D` says the rank on its tail line, so the story can call it a D-rank foe; a fight
// with no rank says nothing about ranks. Tail only: the static text stays byte-identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { actor, baseDomains, createWorld, line } from './helpers/fake-ctx.js';
import { part, STATIC_TEXT, validateCombat } from '../../../src/v2/combat/index.js';
import { foeRanks, rankedFoeNames } from '../../../src/v2/combat/view.js';
import { rpgHost } from '../integration/helpers/host.js';
import { DEFAULT_TAIL_BUDGET, estimateTokens } from '../../vendor/story-block/src/v2/prompt.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

// The static text (sha256): a fight line never changes it. Changed once on purpose since ranks were told
// (fix-encounter: "write its encounter line in <Changes>").
const STATIC_SHA = 'e681abf5c067e66316e6093155447c08a3a479b68f4c4acc645e86a645c910d1';
const sha = text => createHash('sha256').update(text).digest('hex');

const hero = () => actor(1, { level: 6, hp: { cur: 220, max: 220 }, stats: { STR: 16, VIT: 14, AGI: 14, DEX: 14, INT: 8, LUK: 8, CHA: 8 } });
const LADDER = [
    { id: 'Copper', title: 'Copper', levels: [1, 5], reward: [10, 50] },
    { id: 'Silver', title: 'Silver', levels: [6, 12], reward: [50, 150] },
    { id: 'Gold', title: 'Gold', levels: [13, 20], reward: [150, 400] },
];
const withLadder = (ladder = LADDER) => ({ 'party.ranks': () => ladder, 'party.pc': () => ({ level: 6 }) });

function fightWith(name, labels, extraQueries = {}) {
    const world = createWorld({ domains: baseDomains({ actors: [hero()] }), extraQueries });
    const read = world.capture(line('!', 'encounter', name, 'on the road', labels));
    const tail = () => part.context.tail({ state: world.state, query: (q, args) => world.query(q, args) });
    return { world, read, tail };
}

test('a foe of a written rank: the fight\'s tail line says its rank; the session keeps it', () => {
    const { world, read, tail } = fightWith('3 Bandit', { rank: 'Silver' }, withLadder());
    assert.equal(read.ok, true, read.message);
    const offer = Object.values(world.state.domains.combat.offers).at(-1);
    assert.match(tail().optional[0], /Bandit ×3 \(rank Silver\)/, 'the offer said it already');
    assert.equal(world.run('combat.start', { offer: offer.id }).ok, true);
    const session = sessionOf(world.state.domains.combat);
    assert.deepEqual(session.ranks, [{ name: 'Bandit', rank: 'Silver' }]);
    assert.deepEqual(validateCombat(world.state.domains.combat), []);
    assert.match(tail().lines[0], /^\[Fight\] Under way: Ren against Bandit ×3 \(rank Silver\)\. The reader is playing it/);
    assert.equal(part.context.static(), STATIC_TEXT);
    assert.equal(sha(STATIC_TEXT), STATIC_SHA, 'the static text is byte-identical');
});

test('a foe without a rank: the line is as before, and the session has no ranks key', () => {
    const { world, tail } = fightWith('3 Bandit', { tier: 'even' }, withLadder());
    world.run('combat.start', { offer: Object.values(world.state.domains.combat.offers).at(-1).id });
    assert.equal(Object.hasOwn(sessionOf(world.state.domains.combat), 'ranks'), false);
    assert.match(tail().lines[0], /^\[Fight\] Under way: Ren against Bandit ×3\. The reader/);
    assert.doesNotMatch(tail().lines[0], /rank/);
});

test('combat alone (no party.ranks, no ladder): a written rank is not read, and nothing about ranks is said', () => {
    const { world, read, tail } = fightWith('3 Bandit', { rank: 'Silver' });
    assert.equal(read.ok, false, 'no ladder to read the rank on');
    assert.match(read.message, /not a rank here/);
    assert.deepEqual(tail(), { lines: [], optional: [] });
    assert.deepEqual(world.state.domains.combat.offers, {});
});

test('rank words: flattened, cut by code points; foes of one rank say it once; mixed ranks each their own', () => {
    assert.deepEqual(foeRanks([{ name: 'Wolf', rank: 'Sil<b>ver\n|x' }, { name: 'Wolf', rank: 'Gold' }, { name: 'Rat' }]), [{ name: 'Wolf', rank: 'Sil b ver x' }]);
    const long = foeRanks([{ name: 'Wight', rank: '𝔊𝔬𝔩𝔡'.repeat(10) }])[0].rank;
    assert.equal([...long].length, 16, 'cut at 16 code points');
    assert.ok(!/[\uD800-\uDBFF]$/.test(long), 'never half a character');
    const setup = { enemies: [{ name: 'Bandit A', questName: 'Bandit' }, { name: 'Bandit B', questName: 'Bandit' }, { name: 'Wolf', questName: 'Wolf' }] };
    assert.equal(rankedFoeNames({ setup, ranks: [{ name: 'Bandit', rank: 'D' }, { name: 'Wolf', rank: 'D' }] }), 'Bandit ×2, Wolf (all rank D)');
    assert.equal(rankedFoeNames({ setup, ranks: [{ name: 'Bandit', rank: 'D' }, { name: 'Wolf', rank: 'C' }] }), 'Bandit ×2 (rank D), Wolf (rank C)');
    assert.equal(rankedFoeNames({ setup, ranks: [{ name: 'Wolf', rank: 'C' }] }), 'Bandit ×2, Wolf (rank C)');
    assert.equal(rankedFoeNames({ setup }), 'Bandit ×2, Wolf');
    assert.ok(validateCombat({ offers: {}, session: { id: 'fi_00000001', setup: { party: [], enemies: [] }, actions: [], status: 'active', ranks: 'D' }, beaten: {}, last: [] }).some(e => /ranks/.test(e)));
});

test('six ranked foes with long names and a long rank: the line stays inside the combat budget', () => {
    const ladder = [{ id: 'Adamantine Vanguard Ascendant', title: 'Adamantine', levels: [1, 20], reward: [10, 50] }];
    const names = ['Ashen', 'Briar', 'Cinder', 'Dusk', 'Ember', 'Frost'].map(word => `${word} Hollow-Crowned Revenant of the Sunken Marches`.slice(0, 48));
    const { world, read, tail } = fightWith(names.join(', '), { rank: 'Adamantine Vanguard Ascendant' }, withLadder(ladder));
    assert.equal(read.ok, true, read.message);
    world.run('combat.start', { offer: Object.values(world.state.domains.combat.offers).at(-1).id });
    const [under] = tail().lines;
    assert.match(under, /\(all rank Adamantine Vangu\)\./);
    assert.ok(estimateTokens(under) <= part.context.budget, `${estimateTokens(under)} tokens`);
});

test('on the real host (Story Block + RPG Battle, no Story Director): the tail names the rank, the static part never changes', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await rpgHost();
    t.after(() => host.close());
    assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await host.send('We take the road.', host.reply('Bandits block the way.', ['! encounter 3 Bandit — blades out | rank: E']));
    const offer = host.q('combat.offers').at(-1);
    assert.equal(offer.foes[0].rank, 'E', JSON.stringify(offer));
    assert.equal((await host.cmd('combat.start', { offer: offer.id })).ok, true);
    await host.send('I raise my sword.', 'Steel rings.');
    const tail = host.tails().at(-1);
    assert.match(tail, /\[Fight\] Under way: Ren against Bandit ×3 \(rank E\)\./);
    assert.ok(estimateTokens(tail) <= DEFAULT_TAIL_BUDGET);
    const statics = host.statics();
    assert.ok(statics.length >= 2);
    assert.ok(statics.every(text => text === statics[0]), 'the static part is byte-identical reply to reply');
    assert.ok(statics[0].includes(STATIC_TEXT));
});
