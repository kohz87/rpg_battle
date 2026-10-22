// terms2 (live test, 2026-10-22): the ranking terms together in RPG Battle's Terms (the Rank ladder moved
// here from Story Block, a new Levels per rank, a read-only preview), the same bands for a foe's rank, the
// party's rank and the fight's tier on the fight card ("Weir Rat ×8 · Soul Class I · weak"), and items
// that carry by the reader's list, by name, for things the story gave too. RPG Battle runs here without
// Story Director (WAVE rule 11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModule } from '../../src/v2/module.js';
import { ladderPreview, migrateRankLadder, readerLadderLines } from '../../src/terms.js';
import { foesCard, tierLevel } from '../../src/v2/combat/encounter.js';
import { rpgHost } from './integration/helpers/host.js';

const SOUL = ['Soul Class I', 'Soul Class II', 'Soul Class III', 'Soul Class IV', 'Soul Class V', 'Soul Class VI', 'Soul Class VII', 'Soul Class VIII', 'Soul Class IX'];
const rows = list => list.map(rank => ({ rank }));
const quiet = t => t.mock.method(console, 'warn', () => {});

test('Terms holds every ranking term: XP word, Level word, Rank ladder (lines), Levels per rank', () => {
    const { schema, defaults } = createModule({ settings: () => ({}) }).settings;
    const terms = Object.entries(schema).filter(([, field]) => field.group === 'Terms').map(([key]) => key);
    assert.deepEqual(terms, ['party.xpName', 'party.levelName', 'party.ranks', 'party.levelsPerRank']);
    assert.equal(schema['party.ranks'].type, 'list');
    assert.equal(schema['party.ranks'].form, 'lines');
    assert.deepEqual(Object.keys(schema['party.ranks'].of), ['rank']);
    assert.equal(schema['party.levelsPerRank'].type, 'int');
    assert.deepEqual(defaults['party.ranks'], []);
    assert.equal(defaults['party.levelsPerRank'], 0);
    assert.doesNotMatch(schema['party.levelName'].help, /Story Block/, 'the ladder is no longer elsewhere');
});

test('ranks.reader hands the lines and Levels per rank to Story Block; none without lines', () => {
    assert.equal(readerLadderLines({}), null);
    assert.equal(readerLadderLines({ 'party.ranks': [{ rank: '  ' }] }), null);
    assert.deepEqual(readerLadderLines({ 'party.ranks': rows(['A', 'B: 11']), 'party.levelsPerRank': 10 }), { lines: rows(['A', 'B: 11']), perRank: 10 });
    assert.deepEqual(readerLadderLines({ 'party.ranks': rows(['A']), 'party.levelsPerRank': -3 }).perRank, 0);
    const module = createModule({ settings: () => ({ 'party.ranks': rows(SOUL), 'party.levelsPerRank': 10 }) });
    assert.deepEqual(module.hooks['ranks.reader'](), { lines: rows(SOUL), perRank: 10 });
});

test('a ladder stored in Story Block\'s Terms (SB #121) moves to RPG Battle once; RPG Battle\'s own wins', () => {
    const old = { modules: { 'story-block': { currency: 'mark', ranks: rows(SOUL) } } };
    assert.equal(migrateRankLadder(old), true);
    assert.deepEqual(old.modules['rpg-battle']['party.ranks'], rows(SOUL));
    assert.equal('ranks' in old.modules['story-block'], false);
    assert.equal(old.modules['story-block'].currency, 'mark');
    assert.equal(migrateRankLadder(old), false, 'once');
    const both = { modules: { 'story-block': { ranks: rows(['F', 'E']) }, 'rpg-battle': { 'party.ranks': rows(['X']) } } };
    migrateRankLadder(both);
    assert.deepEqual(both.modules['rpg-battle']['party.ranks'], rows(['X']));
    assert.equal(migrateRankLadder({}), false);
    assert.equal(migrateRankLadder(null), false);
});

test('the preview lists each rank with its levels, the shared words once', () => {
    const ladder = SOUL.map((title, index) => ({ id: title.split(' ').at(-1), title, levels: [index * 10 + 1, index * 10 + 10] }));
    assert.equal(ladderPreview(ladder.slice(0, 3)), 'Soul Class I: Lv 1–10 · II: 11–20 · III: 21–30');
    assert.equal(ladderPreview(ladder), 'Soul Class I: Lv 1–10 · II: 11–20 · III: 21–30 · IV: 31–40 · V: 41–50 · … · IX: 81–90');
    assert.equal(ladderPreview([{ id: 'F', title: 'F-rank', levels: [1, 5] }, { id: 'E', title: 'E-rank', levels: [6, 12] }]), 'F-rank: Lv 1–5 · E-rank: 6–12');
    assert.equal(ladderPreview([]), '');
});

test('on the host: Levels per rank bands the ladder, the preview shows it, foes, party and the fight card share the bands', async t => {
    quiet(t);
    const host = await rpgHost({ settings: { modules: { 'rpg-battle': { 'party.ranks': rows(SOUL), 'party.levelsPerRank': 10, 'party.levelName': 'Soul Class' } } } });
    t.after(() => host.close());
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    const ladder = host.q('party.ranks');
    assert.deepEqual(ladder.slice(0, 3).map(rank => [rank.title, rank.levels]), [['Soul Class I', [1, 10]], ['Soul Class II', [11, 20]], ['Soul Class III', [21, 30]]]);
    assert.deepEqual(host.q('packs.content', { kind: 'ranks' }).slice(0, 2).map(rank => rank.levels), [[1, 10], [11, 20]], 'Story Block answers with the same bands');
    assert.match(host.module.settings.schema['party.levelsPerRank'].help, /Now: Soul Class I: Lv 1–10 · II: 11–20 · III: 21–30/);
    // A tier foe's rank is read at its tier's level; the card names the rank and the tier.
    await host.send('Rats!', host.reply('Rats pour out.', ['! encounter 8 Weir Rat — from the culvert | tier: weak']));
    const offer = host.q('combat.offers').at(-1);
    assert.ok(offer, JSON.stringify(host.turn.problems().map(problem => problem.message)));
    assert.equal(offer.card, 'Weir Rat ×8 · Soul Class I · weak');
    // A written rank past a deadly fight for a level-1 character is held to the highest that fits, on the same bands.
    await host.send('More!', host.reply('A bigger one.', ['! encounter Culvert Leech — rising | rank: Soul Class II']));
    const ranked = host.q('combat.offers').at(-1);
    assert.equal(ranked.foes[0].said, 'II');
    assert.equal(ranked.card, `Culvert Leech · Soul Class I · ${ranked.foes[0].tier}`);
    assert.ok(ranked.foes[0].level >= 1 && ranked.foes[0].level <= 10, `level ${ranked.foes[0].level} in Soul Class I's band`);
    // The party's rank is read on the same ladder: a level-15 character is Soul Class II, and so is an even foe for them.
    const even = foesCard([{ name: 'Wolf', count: 2, tier: 'even' }], { ladder, pcLevel: 15 });
    assert.equal(even, 'Wolf ×2 · Soul Class II · even');
    assert.equal(tierLevel('even', 15), 15);
    assert.equal(foesCard([{ name: 'Rat King', count: 1, tier: 'strong', boss: true }], { ladder, pcLevel: 1 }).startsWith('Rat King (boss) · Soul Class I'), true);
    assert.equal(foesCard([{ name: 'Wolf', count: 1, tier: 'weak' }], { ladder: null }), 'Wolf · weak', 'no ladder: name and tier');
});

test('alone, no ladder set: the built-in ranks, a card with them; nothing from Story Block\'s old setting', async t => {
    quiet(t);
    const host = await rpgHost({ settings: { modules: { 'story-block': { ranks: rows(SOUL) } } } });
    t.after(() => host.close());
    assert.deepEqual(host.q('party.ranks').map(rank => rank.id), ['F', 'E', 'D', 'C', 'B', 'A', 'S']);
    assert.equal(host.module.hooks['ranks.reader'](), null);
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    await host.send('Rats!', host.reply('Rats.', ['! encounter 3 Rat — squeaking | tier: weak']));
    assert.equal(host.q('combat.offers').at(-1).card, 'Rat ×3 · F-rank · weak');
});

test('carry by name: the reader\'s list counts for a thing the story gave; the story alone sets no capacity', async t => {
    quiet(t);
    const host = await rpgHost({ settings: { modules: { 'rpg-battle': { 'items.carryItems': [{ item: 'Saddlebags', carry: 60 }] } } } });
    t.after(() => host.close());
    assert.match(host.module.settings.schema['items.carryItems'].help, /by name/);
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    const before = host.q('items.carry').capacity;
    await host.send('The ostler.', host.reply('He hands over saddlebags and a magic sack.', ['+ item Saddlebags | note: worn leather', '+ item Endless Sack | note: carry +500']));
    const items = host.q('inventory.items', {});
    assert.ok(items.find(item => item.name === 'Saddlebags').def.startsWith('story/'), 'a story-made thing');
    assert.equal(host.q('items.carry').capacity, before + 60, 'Saddlebags: 60 by the list; the sack\'s "+500" is only words');
    await host.send('Lose them.', host.reply('They fall in the river.', ['- item Saddlebags']));
    assert.equal(host.q('items.carry').capacity, before);
});
