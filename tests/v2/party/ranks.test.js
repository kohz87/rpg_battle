// The rank ladder (MODULES §F86, §F91): `party.ranks` from the reader's ranks, a pack's ranks,
// uniform tiers or the built-in F to S; a foe line's absolute `rank: D` (combat/encounter.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, makeRules } from '../../../src/rules.js';
import { DEFAULT_RANK_BANDS, MAX_RANKS, moneyScale, packRanks, rankAt, rankLadder, rankNamed, rankReward } from '../../../src/terms.js';
import { ranks } from '../../../src/v2/party/queries.js';
import { rankContext, rankFoe, rankLevel, readEncounter } from '../../../src/v2/combat/encounter.js';
import { makeState } from './helpers/fake-ctx.js';

const ERSVEIL = [
    { pack: 'ersveil', id: 'F', title: 'Registered', levels: [1, 10], reward: [50, 400] },
    { pack: 'ersveil', id: 'E', title: 'Journeyman', levels: [11, 20] },
    { pack: 'ersveil', id: 'D', title: 'Proven', levels: [21, 30] },
    { pack: 'ersveil', id: 'C', title: 'Veteran', levels: [26, 40] },
    { pack: 'other', id: 'Z', title: 'Other pack' },
];
const withTerms = terms => makeRules({ terms });

test('the built-in ladder is F to S on Story Director\'s bands, the last reaching the level cap', () => {
    const ladder = rankLadder(DEFAULT_RULES);
    assert.deepEqual(ladder.map(rank => rank.id), ['F', 'E', 'D', 'C', 'B', 'A', 'S']);
    assert.deepEqual(ladder[0], { id: 'F', title: 'F-rank', levels: [1, 5], reward: [10, 50] });
    assert.deepEqual(ladder.at(-1).levels, [51, DEFAULT_RULES.character.maxLevel]);
    // A lower cap: bands held to it, ranks past it left out.
    const low = rankLadder(makeRules({ character: { maxLevel: 25 } }));
    assert.deepEqual(low.map(rank => [rank.id, rank.levels]), [['F', [1, 5]], ['E', [6, 12]], ['D', [13, 20]], ['C', [21, 25]]]);
    assert.equal(DEFAULT_RANK_BANDS.length, 7);
});

test('uniform tiers make one rank per tier, titled in the terms', () => {
    const ladder = rankLadder(withTerms({ levelName: 'Soul Class', tiers: { size: 10, numerals: 'roman' }, cap: 35 }));
    assert.deepEqual(ladder.map(({ reward, ...rank }) => rank), [
        { id: 'I', title: 'Soul Class I', levels: [1, 10] },
        { id: 'II', title: 'Soul Class II', levels: [11, 20] },
        { id: 'III', title: 'Soul Class III', levels: [21, 30] },
        { id: 'IV', title: 'Soul Class IV', levels: [31, 35] },
    ]);
    // Tiers re-band the levels: each pays what the built-in ladder pays at its first level (B-a2-1), never
    // by its place: I (1) F, II (11) E, III (21) C, IV (31) B.
    assert.deepEqual(ladder.map(rank => rank.reward), [0, 1, 3, 4].map(index => rankReward(index)));
    const arabic = rankLadder(withTerms({ tiers: { size: 1 } }));
    assert.equal(arabic.length, MAX_RANKS, 'a ladder of tiers of one level stops at MAX_RANKS');
});

test('a named list with uneven bands: the reader\'s own first, else the first pack\'s', () => {
    const own = rankLadder(withTerms({ ranks: [{ id: 'Bronze', levels: [1, 3] }, { id: 'Silver', title: 'Silver Badge', levels: [4, 12] }, { id: 'Gold' }] }));
    assert.deepEqual(own.map(({ reward, ...rank }) => rank), [
        { id: 'Bronze', title: 'Bronze', levels: [1, 3] },
        { id: 'Silver', title: 'Silver Badge', levels: [4, 12] },
        // No levels: the built-in band at its place.
        { id: 'Gold', title: 'Gold', levels: [13, 20] },
    ]);
    const query = (name, args) => (name === 'packs.content' && args.kind === 'ranks' ? ERSVEIL : []);
    const pack = packRanks(query);
    assert.deepEqual(pack.map(rank => rank.id), ['F', 'E', 'D', 'C'], 'one pack\'s ranks only');
    const ladder = rankLadder(withTerms({ tiers: { size: 10 } }), { pack });
    assert.deepEqual(ladder.map(rank => [rank.id, rank.title, rank.levels]), [['F', 'Registered', [1, 10]], ['E', 'Journeyman', [11, 20]], ['D', 'Proven', [21, 30]], ['C', 'Veteran', [26, 40]]]);
    // Bad records are left out; a host without packs, or a failing one, is no pack.
    assert.equal(packRanks(() => { throw new Error('no packs'); }), null);
    assert.equal(packRanks(() => [{ pack: 'x', id: 'bad id!' }]), null);
    assert.deepEqual(rankLadder(withTerms({ ranks: [{ id: 'A' }, { id: 'a' }, { id: '' }, 'x'] })).map(rank => rank.id), ['A']);
});

test('party.ranks reads the pack through the query tools; Story Director gets { id, title, levels, reward }', () => {
    const state = makeState();
    const tools = { query: (name, args) => (name === 'packs.content' && args.kind === 'ranks' ? ERSVEIL : null), settings: {} };
    const out = ranks(state, {}, tools);
    assert.deepEqual(out[0], { id: 'F', title: 'Registered', levels: [1, 10], reward: [50, 400] });
    assert.deepEqual(out[1].reward, rankReward(1), 'a pack rank without a reward: by place');
    assert.deepEqual(ranks(state, {}, null).map(rank => rank.id), ['F', 'E', 'D', 'C', 'B', 'A', 'S']);
    assert.deepEqual(ranks(state, { settings: { terms: { tiers: { size: 20 } } } }, null).slice(0, 2).map(rank => rank.levels), [[1, 20], [21, 40]]);
});

test('a rank is named by id or title, ignoring case and the word "rank"', () => {
    const ladder = rankLadder(withTerms({ levelName: 'Soul Class', tiers: { size: 10 } }));
    assert.equal(rankNamed('II', ladder).id, 'II');
    assert.equal(rankNamed('soul class iii', ladder).id, 'III');
    const plain = rankLadder(DEFAULT_RULES);
    assert.equal(rankNamed('d-rank', plain).id, 'D');
    assert.equal(rankNamed('Rank C', plain).id, 'C');
    assert.equal(rankNamed('Q', plain), null);
    assert.equal(rankAt(14, plain).id, 'D');
    assert.equal(rankAt(1, plain).id, 'F');
});

test('rank: D picks a level inside D\'s band, nearest your character\'s, never past deadly', () => {
    const ladder = rankLadder(DEFAULT_RULES);
    const d = ladder.find(rank => rank.id === 'D');
    assert.equal(rankLevel(d, 15), 15, 'inside the band: your level');
    assert.equal(rankLevel(d, 30), 20, 'above it: the top of the band');
    // Level 8: D starts at 13, within deadly's 8 levels: the foe is 13, strong.
    assert.deepEqual(rankFoe('D', { ranks: ladder, pcLevel: 8 }), { ok: true, rank: 'D', level: 13, tier: 'strong' });
    assert.deepEqual(rankFoe('d rank', { ranks: ladder, pcLevel: 16 }), { ok: true, rank: 'D', level: 16, tier: 'even' });
    // S-rank against a level-1 character: held to the highest rank a deadly foe reaches (E starts at 6 ≤ 9).
    assert.deepEqual(rankFoe('S', { ranks: ladder, pcLevel: 1 }), { ok: true, rank: 'E', level: 6, tier: 'strong', said: 'S' });
    assert.equal(rankFoe('Q', { ranks: ladder }).ok, false);
    assert.match(rankFoe('Q', { ranks: ladder }).message, /not a rank: write one of F, E, D/);
    assert.equal(rankFoe('D', { ranks: null }).ok, false);
});

test('an encounter line with rank: carries rank, level and a tier; without, the tier as before', () => {
    const ladder = rankLadder(DEFAULT_RULES);
    const line = { op: '!', kind: 'encounter', name: '3 Wolf', text: 'circling', labels: { rank: 'D' } };
    const read = readEncounter(line, { bestiary: [], ranks: ladder, pcLevel: 14 });
    assert.equal(read.ok, true, read.message);
    assert.deepEqual(read.foes, [{ name: 'Wolf', count: 3, tier: 'even', rank: 'D', level: 14 }]);
    const tierOnly = readEncounter({ ...line, labels: { tier: 'weak' } }, { bestiary: [], ranks: ladder, pcLevel: 14 });
    assert.deepEqual(tierOnly.foes, [{ name: 'Wolf', count: 3, tier: 'weak' }]);
    const bad = readEncounter({ ...line, labels: { rank: 'Z' } }, { bestiary: [], ranks: ladder, pcLevel: 14 });
    assert.equal(bad.ok, false);
    // rankContext asks party.ranks and party.pc, and is none without them.
    const ctx = { query: name => { if (name === 'party.ranks') return ladder; if (name === 'party.pc') return { level: 7 }; throw new Error('no'); } };
    assert.deepEqual(rankContext(ctx), { ranks: ladder, pcLevel: 7 });
    assert.deepEqual(rankContext({ query: () => { throw new Error('none'); } }), { ranks: null, pcLevel: 1 });
});

test('F104: built-in and tier rewards follow the pack\'s money scale; a pack\'s own ladder is left as written', () => {
    assert.deepEqual(rankReward(0), [10, 50]);
    assert.deepEqual(rankReward(1), [50, 230]);
    assert.deepEqual(rankReward(0, 40), [400, 2000]);
    assert.deepEqual(rankReward(0, 0.01), [1, 1], 'whole units, at least 1');
    const state = makeState();
    const economy = scale => ({ query: (name, args) => (name === 'inventory.economy' ? { scale } : name === 'packs.content' && args?.kind === 'ranks' ? [] : null), settings: {} });
    assert.equal(moneyScale(economy(40).query), 40);
    assert.equal(moneyScale(economy(-2).query), 1);
    assert.equal(moneyScale(economy('x').query), 1);
    assert.equal(moneyScale(() => { throw new Error('none'); }), 1);
    assert.equal(moneyScale(null), 1);
    assert.deepEqual(ranks(state, {}, economy(40))[0].reward, [400, 2000]);
    assert.deepEqual(ranks(state, { settings: { terms: { tiers: { size: 10 } } } }, economy(2))[1].reward, [100, 460]);
    const packed = { query: (name, args) => (name === 'inventory.economy' ? { scale: 40 } : name === 'packs.content' && args?.kind === 'ranks' ? ERSVEIL : null), settings: {} };
    assert.deepEqual(ranks(state, {}, packed)[0].reward, [50, 400], 'the pack\'s ladder unchanged');
});
