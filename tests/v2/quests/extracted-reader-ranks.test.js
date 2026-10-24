// The reader's rank ladder (live test, MODULES §F105): Story Block's Rank ladder setting answers the
// packs' ranks (records with `reader: true`), and quest ranks follow it: alone (no RPG Battle, WAVE rule
// 11, where there is no reader's ladder since terms2), with RPG Battle's banding of the same ranks, with the pack's rewards Story Block kept at a place,
// and the money scale on rewards set by place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RANKS, ranksOf, rewardByPlace } from '../../../src/v2/quests/ranks.js';

const SOUL = ['Soul Class I', 'Soul Class II', 'Soul Class III', 'Soul Class IV', 'Soul Class V', 'Soul Class VI', 'Soul Class VII', 'Soul Class VIII', 'Soul Class IX'];
const LETTERS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
const reader = titles => titles.map(title => ({ id: title.split(' ').at(-1), title, pack: null, reader: true }));
const asking = answers => (name, args) => {
    const key = name === 'packs.content' ? `packs.content:${args?.kind}` : name;
    if (!(key in answers)) throw new Error(`no query ${name}`);
    return structuredClone(answers[key]);
};

test('the reader\'s ladder is the quest ladder: its titles and ids, rewards by place (× the money scale)', () => {
    const ladder = ranksOf(asking({ 'packs.content:ranks': reader(SOUL) }));
    assert.deepEqual(ladder.map(rank => [rank.id, rank.title]), SOUL.map(title => [title.split(' ').at(-1), title]));
    assert.deepEqual(ladder[0].reward, rewardByPlace(0));
    assert.deepEqual(ladder[8].reward, rewardByPlace(8));
    assert.deepEqual(ladder[0].levels, DEFAULT_RANKS[0].levels, 'no levels of its own: the built-in band at its place');
    assert.equal(ladder[8].levels, null, 'past the built-in bands: none (the lowest rank when no level is known)');
    const scaled = ranksOf(asking({ 'packs.content:ranks': reader(LETTERS), 'inventory.economy': { scale: 8 } }));
    assert.deepEqual(scaled.map(rank => rank.id), LETTERS);
    assert.deepEqual(scaled[0].reward, rewardByPlace(0).map(n => n * 8));
});

test('a pack\'s rewards Story Block kept at a place stay as written; RPG Battle\'s banding of the same ranks wins', () => {
    const kept = reader(['Copper', 'Silver']).map((rank, index) => (index === 0 ? { ...rank, levels: [1, 10], reward: [50, 400] } : rank));
    const ladder = ranksOf(asking({ 'packs.content:ranks': kept, 'inventory.economy': { scale: 8 } }));
    assert.deepEqual(ladder[0], { id: 'Copper', title: 'Copper', levels: [1, 10], reward: [50, 400] });
    assert.deepEqual(ladder[1].reward, rewardByPlace(1).map(n => n * 8));
    const party = SOUL.slice(0, 3).map((title, index) => ({ id: title.split(' ').at(-1), title, levels: [index * 10 + 1, index * 10 + 10], reward: [index + 1, index + 2] }));
    const banded = ranksOf(asking({ 'packs.content:ranks': reader(SOUL.slice(0, 3)), 'party.ranks': party }));
    assert.deepEqual(banded.map(rank => rank.levels), [[1, 10], [11, 20], [21, 30]]);
    assert.deepEqual(banded[2].reward, [3, 4], 'RPG Battle\'s rewards for the same ranks');
    // Another ladder from RPG Battle (its own F to S) does not replace the reader's.
    const other = ranksOf(asking({ 'packs.content:ranks': reader(SOUL.slice(0, 3)), 'party.ranks': DEFAULT_RANKS }));
    assert.deepEqual(other.map(rank => rank.title), SOUL.slice(0, 3));
    // A pack's own ladder (no reader records) reads as before.
    assert.deepEqual(ranksOf(asking({ 'packs.content:ranks': [{ id: 'F', title: 'Registered', reward: [50, 400], pack: 'e' }] })).map(rank => rank.title), ['Registered']);
});
