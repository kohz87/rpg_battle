// A rank's experience range (Story Block 2.5.0: `xp: [lowest, highest]` beside `reward`): RPG Battle carries it where it rebuilds rank
// records, and never reads a rank's coin range for XP. XP is the formula on the template's xpMin and xpMax, whatever the ranks pay in coin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RANKS, ladderFrom, ranksOf } from '../../../src/v2/quests/ranks.js';
import { makeRules } from '../../../src/rules.js';
import { rankLadder, packRanks } from '../../../src/terms.js';
import { ranks as partyRanks } from '../../../src/v2/party/queries.js';
import { gradingGuide } from '../../../src/v2/quests/offer-block.js';
import { matchOffer } from '../../../src/v2/quests/offer-match.js';
import { COPPER, derivedPin, env, LADDER, lineOf, PIN } from './helpers/offer-env.js';

const asking = answers => (name, args) => {
    const key = name === 'packs.content' ? `packs.content:${args?.kind}` : name;
    if (!(key in answers)) throw new Error(`no query ${name}`);
    return structuredClone(answers[key]);
};
const PACK_RANKS = [
    { pack: 'p', id: 'F', title: 'Novice', levels: [1, 10], reward: [50, 400], xp: [100, 300] },
    { pack: 'p', id: 'E', title: 'Journeyman', levels: [11, 20], reward: [400, 2000], xp: [300, 900] },
    { pack: 'p', id: 'D', title: 'Proven', levels: [21, 30], reward: [2000, 9000] },
];

test('ladderFrom keeps a rank\'s xp range as written, and leaves it out where the rank has none or a bad one', () => {
    const ladder = ladderFrom([...PACK_RANKS, { pack: 'p', id: 'C', title: 'Veteran', xp: [900, 100] }, { pack: 'p', id: 'B', xp: [1.5, 3] }]);
    assert.deepEqual(ladder.map(rank => rank.xp ?? null), [[100, 300], [300, 900], null, null, null]);
    assert.deepEqual(ladder[0], { id: 'F', title: 'Novice', levels: [1, 10], reward: [50, 400], xp: [100, 300] });
    assert.ok(!('xp' in ladderFrom([{ id: 'F' }])[0]), 'a rank with no xp keeps its old shape');
    assert.deepEqual(ladderFrom(PACK_RANKS, { withRewards: false })[0].xp, [100, 300], 'the rewards by place do not touch xp');
});

test('quest.ranks answers the pack\'s xp, alone, past the money scale, and on the reader\'s ladder', () => {
    const own = ranksOf(asking({ 'packs.content:ranks': PACK_RANKS, 'inventory.economy': { scale: 8 } }));
    assert.deepEqual(own.map(rank => [rank.reward, rank.xp ?? null]), [[[50, 400], [100, 300]], [[400, 2000], [300, 900]], [[2000, 9000], null]], 'xp is never scaled by the money scale');
    const reader = PACK_RANKS.map(({ pack, ...rank }) => ({ ...rank, pack: null, reader: true }));
    const alone = ranksOf(asking({ 'packs.content:ranks': reader, 'inventory.economy': { scale: 8 } }));
    assert.deepEqual(alone.map(rank => rank.xp ?? null), [[100, 300], [300, 900], null]);
    const banded = ranksOf(asking({ 'packs.content:ranks': reader, 'party.ranks': partyOf(reader) }));
    assert.deepEqual(banded.map(rank => rank.xp ?? null), [[100, 300], [300, 900], null], 'RPG Battle\'s banding of the same ranks keeps them');
    assert.deepEqual(ranksOf(asking({ 'packs.content:ranks': [] })).map(rank => rank.xp ?? null), DEFAULT_RANKS.map(() => null));
});

// What RPG Battle's own `party.ranks` answers for the reader's ranks over the pack's: the same reward by level, and the xp by level.
function partyOf(reader) {
    const query = (name, args) => (name === 'packs.content' && args?.kind === 'ranks' ? PACK_RANKS : []);
    return rankLadder(makeRules({ terms: { ranks: reader.map(({ id, title, levels }) => ({ id, title, levels })) } }), { base: PACK_RANKS, pack: packRanks(query) });
}

test('party.ranks keeps the pack\'s xp, pays it by level on the reader\'s ladder, and leaves it out with none', () => {
    const query = (name, args) => (name === 'packs.content' && args?.kind === 'ranks' ? PACK_RANKS : []);
    const tools = { query, settings: {} };
    const pack = partyRanks({ domains: {} }, {}, tools);
    assert.deepEqual(pack.map(rank => rank.xp ?? null), [[100, 300], [300, 900], null]);
    assert.deepEqual(pack.map(rank => rank.reward), [[50, 400], [400, 2000], [2000, 9000]]);
    const renamed = rankLadder(makeRules({ terms: { ranks: [{ id: 'I', levels: [1, 5] }, { id: 'II', levels: [6, 15] }, { id: 'III', levels: [16, 30] }] } }), { base: PACK_RANKS });
    assert.deepEqual(renamed.map(rank => rank.xp ?? null), [[100, 300], [100, 300], [300, 900]], 'by the level each starts at');
    assert.deepEqual(renamed.map(rank => rank.reward), [[50, 400], [50, 400], [400, 2000]]);
    const lowered = rankLadder(makeRules({ terms: { ranks: [{ id: 'I', levels: [1, 5], xp: [10, 20] }] } }), { base: PACK_RANKS });
    assert.deepEqual(lowered[0].xp, [10, 20], 'a rank\'s own xp only lowers it');
    const plain = rankLadder(makeRules({ terms: { ranks: [{ id: 'I' }] } }), { base: PACK_RANKS.map(({ xp, ...rank }) => rank) });
    assert.ok(!('xp' in plain[0]));
    assert.ok(rankLadder(makeRules({})).every(rank => !('xp' in rank)), 'the built-in ladder has none');
});

test('XP is the formula on the template\'s xpMin and xpMax: a rank\'s coin range or xp range moves nothing', () => {
    const tuned = derivedPin(resolved => {
        const reward = resolved.quests['pack.ersveil-bluewatch/open-hunt-f'].reward;
        Object.assign(reward, { xpMin: 30, xpMax: 90 });
    });
    const line = lineOf('+ quest Rats | goal: Kill 3 rats | reward: 1 silver mark');
    const at = (ladder, tier) => matchOffer({ ...env({ pin: tuned, tier }), ladder }, line).settled;
    const base = at(LADDER, 0);
    assert.equal(base.xp, 30, 'the template\'s own xpMin at the place\'s tier 0, not the rank\'s coin 50');
    assert.equal(at(LADDER, 2).xp, 30 + Math.floor((90 - 30) * 2 / 9));
    const odd = LADDER.map(rank => ({ ...rank, reward: [1, 2], xp: [5000, 6000] }));
    const moved = at(odd, 0);
    assert.deepEqual([moved.xp, at(odd, 2).xp], [30, 43], 'a rank with a tiny coin range and a huge xp range leaves the template\'s xp alone');
    assert.equal(moved.coin, base.coin, 'and its coin');
});

test('the grading guide names coin ranges from the templates and says nothing of a rank\'s xp, so a pack\'s xp ranges leave the block as it was', () => {
    const plain = gradingGuide({ pin: PIN, ladder: LADDER, currency: COPPER });
    const withXp = gradingGuide({ pin: PIN, ladder: LADDER.map(rank => ({ ...rank, xp: [5000, 6000] })), currency: COPPER });
    assert.deepEqual(withXp, plain);
    assert.ok(plain.length > 0);
});
