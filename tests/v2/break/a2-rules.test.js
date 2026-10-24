// The rules behind the a2 break findings (beta candidate), each tested with this repo alone (RPG Battle
// on the vendored Story Block testkit, or its pure functions), so CI proves them without the four
// checkouts side by side; the breaker tests themselves (a2-*.test.js) run them on the whole suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';
import { bareStarts, rankAt, rankLadder, readerLadderBands } from '../../../src/terms.js';
import { DEFAULT_RULES, makeRules } from '../../../src/rules.js';
import { canCarry, carryBonuses } from '../../../src/v2/items/carry.js';
import { sellEach, storyStack } from '../../../src/v2/trade/core.js';
import { heldToTiers, reliableLoot, spreadStunners, tierRoom } from '../../../src/v2/combat/setup.js';
import { questSized, QUEST_MAX_FOES } from '../../../src/v2/combat/quest.js';
import { MAX_ENCOUNTER_FOES, readEncounter } from '../../../src/v2/combat/encounter.js';
import { packBestiary } from '../../../src/v2/combat/index.js';
import { DEFAULT_BESTIARY } from '../../../src/enemies.js';

const quiet = t => t.mock.method(console, 'warn', () => {});
const circles = n => Array.from({ length: n }, (_, i) => ({ rank: `Circle ${i + 1}` }));

// ---------- B-a2-1 / B-a2-8: the rank ladder ----------

test('a reader\'s ladder renames and re-bands: twelve one-level ranks pay at a level what the built-in ladder pays there', () => {
    const plain = rankLadder(DEFAULT_RULES);
    const bands = readerLadderBands({ 'party.ranks': circles(12), 'party.levelsPerRank': 1 }, { cap: 99 });
    assert.deepEqual(bands.lines.map(line => line.rank).slice(0, 3), ['Circle 1: 1', 'Circle 2: 2', 'Circle 3: 3']);
    const ranks = bands.lines.map(line => ({ id: line.rank.split(' ')[1].split(':')[0], title: line.rank.split(':')[0], levels: null }));
    const starts = bands.lines.map(line => Number(line.rank.split(': ')[1]));
    const reader = rankLadder(makeRules({ terms: { ranks: ranks.map((rank, i) => ({ ...rank, levels: [starts[i], i + 1 < starts.length ? starts[i + 1] - 1 : 99] })) } }));
    for (const level of [1, 5, 6, 12, 40, 99]) {
        assert.deepEqual(rankAt(level, reader).reward.map(n => n <= rankAt(level, plain).reward[1]), [true, true], `level ${level}`);
    }
    assert.deepEqual(rankAt(12, reader).reward, rankAt(12, plain).reward, 'level 12 pays E either way');
    // Tiers of one level re-band too: never by their place.
    const tiers = rankLadder(makeRules({ terms: { tiers: { size: 1 } } }));
    assert.deepEqual(rankAt(12, tiers).reward, rankAt(12, plain).reward);
    // A reward the reader's ranks carry only ever lowers it.
    const own = rankLadder(makeRules({ terms: { ranks: [{ id: 'A', levels: [1, 50], reward: [1, 2] }, { id: 'B', levels: [51, 99], reward: [1, 999999999] }] } }));
    assert.deepEqual(own.map(rank => rank.reward), [[1, 2], [1, rankAt(51, plain).reward[1]]]);
});

test('a bare ladder (no Levels per rank) keeps every rank: spread to the cap, by the tiers only when they hold them all', () => {
    const twelve = bareStarts(12, 99);
    assert.equal(twelve.length, 12);
    assert.ok(twelve.every((start, i) => i === 0 || start > twelve[i - 1]) && twelve.at(-1) <= 99);
    assert.deepEqual(bareStarts(9, 99, 10), [1, 11, 21, 31, 41, 51, 61, 71, 81], 'tiers of 10 hold nine ranks');
    assert.equal(new Set(bareStarts(12, 99, 10)).size, 12, 'tiers of 10 cannot hold twelve: spread evenly, none left out');
    const ladder = rankLadder(makeRules({ terms: { ranks: circles(12).map(row => ({ id: row.rank.split(' ')[1], title: row.rank })) } }));
    assert.equal(ladder.length, 12);
    assert.equal(ladder.at(-1).levels[1], 99);
});

test('on the host (no Story Director): the ladder Story Block answers is banded exactly as party.ranks, all twelve ranks', async t => {
    quiet(t);
    const host = await rpgHost({ settings: { modules: { 'rpg-battle': { 'party.ranks': circles(12) } } } });
    t.after(() => host.close());
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    const rb = host.q('party.ranks');
    const sb = host.q('packs.content', { kind: 'ranks' });
    assert.equal(rb.length, 12);
    assert.deepEqual(sb.map(rank => rank.levels[0]), rb.map(rank => rank.levels[0]), 'the same first levels');
});

test('on the host: twelve one-level ranks give a level-12 character no more coin a reply than the plain ladder', async t => {
    quiet(t);
    const CALLER = { id: 'a2-caller', name: 'a2 caller', version: '0.0.0', commands: { 'a2.call': (ctx, { type, payload } = {}) => ctx.call(type, payload ?? {}) } };
    const withCaller = async rb => {
        const host = await rpgHost({ settings: { modules: { 'rpg-battle': rb } }, modules: [CALLER] });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
            assert.equal((await host.cmd('a2.call', { type: 'party.grantXp', payload: { amount: 1100 } })).ok, true);
            const level = host.q('party.pc').level;
            return { level, budget: host.q('inventory.storyBudget').budget, top: rankAt(level, host.q('party.ranks')).reward[1] };
        } finally { host.close(); }
    };
    const plain = await withCaller({});
    const twelve = await withCaller({ 'party.ranks': circles(12), 'party.levelsPerRank': 1 });
    assert.equal(twelve.level, plain.level);
    assert.ok(twelve.top <= plain.top, `rank reward top ${twelve.top} vs ${plain.top}`);
    assert.ok(twelve.budget <= plain.budget, `budget ${twelve.budget} vs ${plain.budget}`);
});

// ---------- B-a2-2: the story's own goods, whatever their def ----------

test('a stack a story line gave is the story\'s own (Story Block marks it), and sells at most at worth × the sell rate', async t => {
    quiet(t);
    const host = await rpgHost();
    t.after(() => host.close());
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    await host.send('Loot.', host.reply('A chest.', ['+ item Silver Ring | qty: 2']));
    const ring = host.q('inventory.items', {}).find(item => item.name === 'Silver Ring');
    assert.equal(ring.story, true, 'marked story: true');
    assert.equal((await host.cmd('inventory.split', { stack: ring.stack, qty: 1 })).ok, true);
    assert.ok(host.q('inventory.items', {}).filter(item => item.name === 'Silver Ring').every(item => item.story === true), 'a part split off stays the story\'s');
    // A pack def the story named: the def is a pack's, the stack is the story's.
    const def = { id: 'pack.x/scale', name: 'Drake Scale', kind: 'material', value: 300 };
    assert.equal(storyStack({ story: true }, def), true);
    assert.equal(storyStack({}, def), false);
    const world = { rules: DEFAULT_RULES, prices: { sell: 4 }, local: null, plevel: 1 };
    const capped = sellEach(def, 'crafter', world, { story: true });
    assert.ok(capped <= Math.floor(300 * DEFAULT_RULES.trade.sellRate), `story's own: ${capped}`);
    assert.ok(sellEach(def, 'crafter', world) > capped, 'the same def bought or looted keeps the place\'s prices');
});

// ---------- B-a2-3 / B-a2-10: things that carry, once per kind and owner ----------

const bag = (...stacks) => ({
    defs: { 'pack.x/backpack': { id: 'pack.x/backpack', name: 'Backpack', kind: 'goods', carry: 20, weight: 2 }, 'pack.x/bread': { id: 'pack.x/bread', name: 'Bread', kind: 'goods', weight: 2 } },
    stacks: Object.fromEntries(stacks.map(([id, def, qty, owner = 'party']) => [id, { id, def, qty, owner, equipped: null }])),
});
const party = { order: ['ac_a'], actors: { ac_a: { name: 'Ren', stats: { STR: 5 } } } };

test('a carry bonus counts once per kind and owner: split or merged, three Backpacks carry the same', () => {
    const one = carryBonuses(bag(['it_1', 'pack.x/backpack', 3])).bonus.party;
    const three = carryBonuses(bag(['it_1', 'pack.x/backpack', 1], ['it_2', 'pack.x/backpack', 1], ['it_3', 'pack.x/backpack', 1]));
    assert.equal(one, 20);
    assert.equal(three.bonus.party, 20);
    assert.deepEqual(three.bonuses.map(entry => entry.counts), [true, false, false], 'the others are listed as not counting');
    // Another owner's Backpack is theirs: it adds to them.
    assert.equal(carryBonuses(bag(['it_1', 'pack.x/backpack', 1], ['it_2', 'pack.x/backpack', 1, 'ac_a'])).bonus.ac_a, 20);
});

test('a second bag of the same kind brings no room: refused when it leaves the party over its limit', () => {
    const over = bag(['it_1', 'pack.x/backpack', 1], ['it_2', 'pack.x/bread', 30]);
    const def = over.defs['pack.x/backpack'];
    const second = canCarry(over, party, { owner: 'party', add: [{ def, qty: 1 }] });
    assert.equal(second.ok, false, second.message);
    // The first one of its kind still carries itself.
    const none = bag(['it_2', 'pack.x/bread', 30]);
    const first = canCarry(none, party, { owner: 'party', add: [{ def, qty: 1 }] });
    assert.equal(first.capacity, canCarry(none, party, { owner: 'party', add: [] }).capacity + 20, 'the first adds its own room');
    assert.equal(second.capacity, canCarry(over, party, { owner: 'party', add: [] }).capacity, 'the second adds none');
});

// ---------- B-a2-4: every foe written is fought, any cap told ----------

test('every row is read, a boss past the sixth row too; counts past nine kept in rows of nine; past MAX_ENCOUNTER_FOES the cut is said', () => {
    const line = name => ({ op: '!', kind: 'encounter', name, labels: { tier: 'weak' } });
    const seven = readEncounter(line('Rat, Wolf, Bat, Spider, Goblin, Slime, Rat King (boss)'), { bestiary: DEFAULT_BESTIARY });
    assert.equal(seven.foes.length, 7);
    assert.ok(seven.foes.every(foe => foe.tier === 'strong'), 'a boss fight is held to strong');
    const twelve = readEncounter(line('12 Cellar Rat'), { bestiary: DEFAULT_BESTIARY });
    assert.deepEqual(twelve.foes.map(foe => foe.count), [9, 3]);
    assert.equal(twelve.cut, undefined);
    const many = readEncounter(line('9 Rat, 9 Rat, 9 Rat, 9 Rat, 9 Rat, 9 Rat, 9 Rat, Rat King (boss)'), { bestiary: DEFAULT_BESTIARY });
    assert.equal(many.foes.reduce((sum, foe) => sum + foe.count, 0), MAX_ENCOUNTER_FOES);
    assert.ok(many.foes.some(foe => foe.boss), 'the boss keeps its place');
    assert.deepEqual(many.cut, [{ name: 'Rat', count: 10 }]);
});

// ---------- B-a2-5: stunner waves within the field ----------

test('stunners moved out of a wave come in waves of their own, each within the field and the stunner cap', () => {
    const ogre = wave => ({ name: 'Ogre', threat: 'trivial', skills: [{ effect: { stun: 1 } }], ...(wave ? { wave } : {}) });
    const foes = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2].map(ogre);
    const out = spreadStunners(foes, 1, 4);
    const sizes = {};
    for (const foe of out) sizes[foe.wave ?? 0] = (sizes[foe.wave ?? 0] ?? 0) + 1;
    assert.equal(out.length, 12);
    assert.ok(Object.values(sizes).every(n => n <= 2), JSON.stringify(sizes));
});

// ---------- B-a2-6: pack creatures, and the sure drop is the counted item ----------

test('a pack\'s creatures are looked up with their loot and aliases; a quest\'s sure drop is its own item, never a looser one', () => {
    const drake = { name: 'River Drake', aliases: ['Bank Drake'], template: 'drake', level: 12, loot: [{ name: 'River Drake Scale', chance: 60, qty: [1, 2], kind: 'material' }] };
    const ctx = { query: (name, args) => (name === 'packs.content' && args.kind === 'creatures' ? [drake, { nope: true }] : null) };
    const [entry] = packBestiary(ctx);
    assert.equal(entry.name, 'River Drake');
    assert.deepEqual(entry.aliases, ['Bank Drake']);
    assert.deepEqual(entry.loot.map(row => row.name), ['River Drake Scale']);
    assert.deepEqual(packBestiary({ query: () => { throw new Error('no packs'); } }), []);
    const loot = reliableLoot([{ name: 'Drake Scale', chance: 50, qty: [1, 1] }], 'River Drake Scale');
    assert.deepEqual(loot.map(row => [row.name, row.chance]), [['River Drake Scale', 100], ['Drake Scale', 50]]);
    assert.equal(reliableLoot([{ name: 'River Drake Scale', chance: 50, qty: [1, 2] }], 'river drake scale')[0].chance, 100);
});

// ---------- B-a2-7: quest sizing per fight ----------

test('quest sizing is per fight: at most what is missing, at most QUEST_MAX_FOES in all, never past the tier\'s room', () => {
    const rows = ['Cellar Rat', 'Sewer Rat', 'Giant Rat', 'Plague Rat', 'Bog Rat', 'Dire Rat'].map(name => ({ name, count: 1, tier: 'trivial' }));
    const total = foes => foes.reduce((sum, foe) => sum + foe.count, 0);
    const target = need => [{ id: 'th_rats', noun: 'Rat', kind: 'foes', need, left: need }];
    assert.ok(total(questSized(rows, target(30), DEFAULT_BESTIARY).foes) <= 30);
    assert.equal(total(questSized(rows, target(1000), DEFAULT_BESTIARY).foes), QUEST_MAX_FOES);
    assert.equal(total(questSized(rows, target(1000), DEFAULT_BESTIARY, { room: () => 4 }).foes), 10, 'the tier\'s room holds it');
});

// ---------- B-a2-9: the tier measures the whole encounter ----------

test('a tier holds only so many foes in waves for the party; past it the last written stay out (bosses never)', () => {
    const room = tierRoom('trivial', { pcLevel: 1, members: 1, cap: 4 });
    assert.ok(room >= QUEST_MAX_FOES && room < 54, `room ${room}`);
    assert.equal(tierRoom('trivial', { pcLevel: 20, members: 1, cap: 4 }), 54, 'a higher level holds them all');
    const foes = [{ name: 'Rat King', count: 1, tier: 'trivial', boss: true }, ...Array.from({ length: 6 }, () => ({ name: 'Cellar Rat', count: 9, tier: 'trivial' }))];
    const held = heldToTiers(foes, { pcLevel: 1, members: 1 });
    assert.equal(held.foes.reduce((sum, foe) => sum + foe.count, 0), room);
    assert.ok(held.foes.some(foe => foe.boss));
    assert.deepEqual(held.cut, [{ name: 'Cellar Rat', count: 55 - room }]);
    assert.deepEqual(heldToTiers([{ name: 'Wolf', count: 9, tier: 'trivial', rank: 'D', level: 14 }], { pcLevel: 1 }).cut, [], 'a ranked foe is not made smaller: never held');
});
