// The live test's three decisions (MODULES §F105–F107), RPG Battle's side: the reader's XP and level
// words and Story Block's Rank ladder in every screen, note and static line; items that add carry
// capacity; and a place's prices from its settlement type and surroundings (pack, lorebook, scene),
// with the money scale on the built-in prices. RPG Battle runs here without Story Director (WAVE rule 11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModule } from '../../src/v2/module.js';
import { STATIC, staticText } from '../../src/v2/party/context.js';
import { foldReaderTerms, levelText, parseLevelLabel, powerOptions, rankLadder, rankNamed, readerRanks, withTerms } from '../../src/terms.js';
import { makeRules } from '../../src/rules.js';
import { canCarry, carryBonuses, carryView } from '../../src/v2/items/carry.js';
import { carryText } from '../../src/v2/screens/view.js';
import { ENV_CAP, categoryOf, goodsFactor, marketAt, marketWhy } from '../../src/v2/trade/markets.js';
import { makeWorld, stockOf } from '../../src/v2/trade/core.js';
import { part as tradePart } from '../../src/v2/trade/index.js';
import { baseState, createHost as tradeHost, def, stack } from './trade/helpers/fake-ctx.js';
import { LYRA, PC, makeState } from './items/helpers/state.js';
import { rpgHost } from './integration/helpers/host.js';

const SOUL = ['Soul Class I', 'Soul Class II', 'Soul Class III', 'Soul Class IV', 'Soul Class V', 'Soul Class VI', 'Soul Class VII', 'Soul Class VIII', 'Soul Class IX'];
const LETTERS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
const rows = list => list.map(rank => ({ rank }));
const quiet = t => t.mock.method(console, 'warn', () => {});

// ---------- the words ----------

test('the XP and Level words are Character settings in their own group, Terms, without the part\'s title', () => {
    const { schema, defaults } = createModule({ settings: () => ({}) }).settings;
    assert.equal(schema['party.xpName'].group, 'Terms');
    assert.equal(schema['party.levelName'].group, 'Terms');
    assert.match(schema['party.xpName'].label, /^XP word/);
    assert.match(schema['party.startPoints'].label, /^Character: /, 'a field with no group keeps its part\'s title');
    assert.equal(defaults['party.xpName'], '');
    assert.equal(defaults['party.levelName'], '');
});

test('the reader\'s words are folded into the terms, over a pack\'s; blank leaves the pack\'s', () => {
    assert.deepEqual(foldReaderTerms({ 'party.xpName': 'Soul Growth', 'party.levelName': '' }).terms, { xpName: 'Soul Growth' });
    assert.deepEqual(foldReaderTerms({ 'party.xpName': '  ' }), { 'party.xpName': '  ' }, 'nothing set: as it was');
    assert.equal(foldReaderTerms({ 'party.levelName': 'Rank: | x' }).terms.levelName, 'Rank x', 'what separates fields in a block is cleaned out');
    const pack = (name, args) => (name === 'packs.content' && args.kind === 'terms' ? [{ pack: 'p', levelName: 'Circle', xpName: 'Power' }] : []);
    const merged = withTerms(foldReaderTerms({ 'party.xpName': 'Soul Growth' }), pack);
    assert.deepEqual([merged.terms.levelName, merged.terms.xpName], ['Circle', 'Soul Growth']);
});

test('the static line names the world\'s words; byte-identical reply to reply, and as before with the plain words', () => {
    assert.equal(staticText(null), STATIC);
    const plain = createModule({ settings: () => ({}), query: () => [] });
    assert.ok(plain.context.static().startsWith(STATIC));
    let words = { 'party.xpName': 'Soul Growth', 'party.levelName': 'Soul Class' };
    const named = createModule({ settings: () => words, query: () => [] });
    const once = named.context.static();
    assert.match(once, /^Party numbers \(HP, MP, SP, Soul Growth, Soul Class\) are set by code/);
    assert.equal(named.context.static(), once, 'the same settings, the same bytes');
    words = { 'party.xpName': 'Power' };
    assert.match(named.context.static(), /\(HP, MP, SP, Power, levels\)/, 'a changed setting changes it');
    // A pack's words reach the static line through the host's query too.
    const pack = createModule({ settings: () => ({}), query: (name, args) => (name === 'packs.content' && args.kind === 'terms' ? [{ pack: 'p', xpName: 'Soul Growth' }] : []) });
    assert.match(pack.context.static(), /\(HP, MP, SP, Soul Growth, levels\)/);
});

// ---------- the rank ladder ----------

const readerQuery = list => (name, args) => (name === 'packs.content' && args.kind === 'ranks' ? list : []);
const asReader = titles => titles.map(title => ({ id: title.split(' ').at(-1), title, pack: null, reader: true }));

test('Story Block\'s Rank ladder is the terms\' ranks: spread by the tiers, else evenly to the cap; levels shown by it', () => {
    assert.equal(readerRanks(readerQuery([{ id: 'F', pack: 'guild' }])), null, 'a pack\'s ladder is not the reader\'s');
    const soul = withTerms({ terms: { tiers: { size: 10 } } }, readerQuery(asReader(SOUL)));
    const ladder = rankLadder(makeRules({ terms: soul.terms }));
    assert.deepEqual(ladder.slice(0, 3).map(rank => [rank.id, rank.title, rank.levels]), [['I', 'Soul Class I', [1, 10]], ['II', 'Soul Class II', [11, 20]], ['III', 'Soul Class III', [21, 30]]]);
    assert.deepEqual(ladder.at(-1).levels, [81, 99], 'the last reaches the cap');
    const rules = makeRules({ terms: soul.terms });
    assert.equal(levelText(24, rules), 'Soul Class III (Lv 24)');
    assert.equal(parseLevelLabel('Soul Class III (Lv 24)', rules), 24);
    assert.equal(parseLevelLabel('Soul Class II', rules), 11);
    assert.equal(rankNamed('IX', ladder).title, 'Soul Class IX');
    assert.deepEqual(powerOptions(rules).slice(0, 2), [{ level: 1, label: 'Soul Class I' }, { level: 11, label: 'Soul Class II' }]);
    // F to SSS with no tiers: nine bands over levels 1–99, SSS the top.
    const letters = makeRules({ terms: withTerms({}, readerQuery(LETTERS.map(id => ({ id, title: id, pack: null, reader: true })))).terms });
    const nine = rankLadder(letters);
    assert.deepEqual(nine.map(rank => rank.id), LETTERS);
    assert.deepEqual([nine[0].levels, nine[8].levels], [[1, 11], [89, 99]]);
    assert.equal(levelText(95, letters), 'SSS (Lv 95)');
    // The rewards: the pack's at a place when Story Block kept them, else by place times the money scale.
    const kept = rankLadder(makeRules({ terms: { ranks: [{ id: 'I', title: 'Soul Class I', reward: [50, 400] }, { id: 'II', title: 'Soul Class II' }] } }), { scale: 8 });
    assert.deepEqual(kept[0].reward, [50, 400]);
    assert.deepEqual(kept[1].reward, [400, 1840], 'by place (50–230) × 8');
});

test('on the host (no Story Director): party.ranks, the Party screen and the tail use the reader\'s ladder and words', async t => {
    quiet(t);
    const host = await rpgHost({ settings: { modules: { 'story-block': { ranks: rows(SOUL) }, 'rpg-battle': { 'party.xpName': 'Soul Growth', 'party.levelName': 'Soul Class' } } } });
    t.after(() => host.close());
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    const ladder = host.q('party.ranks');
    assert.deepEqual(ladder.map(rank => rank.title), SOUL);
    assert.deepEqual(ladder[0].levels, [1, 11], 'nine ranks over levels 1–99 (no tiers)');
    assert.deepEqual(host.q('party.terms'), { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: null });
    const view = { state: host.head(), settings: id => host.sdk.settings(id), query: (name, args) => host.q(name, args) };
    const tail = host.module.context.tail(view).lines.join('\n');
    assert.match(tail, /Party: Wessel \(you\): Soul Class I/);
    assert.match(host.module.context.static(), /\(HP, MP, SP, Soul Growth, Soul Class\)/);
    const cards = host.q('rpg-battle.cards', {});
    const me = (Array.isArray(cards) ? cards : cards?.cards ?? []).find(card => card.name === 'Wessel');
    assert.ok(me, JSON.stringify(cards).slice(0, 200));
    assert.match(me.line, /^Soul Class I · /);
    assert.equal(me.xpName, 'Soul Growth');
    // A foe line may name a rank of the reader's ladder.
    await host.send('Wolves!', host.reply('Two wolves.', ['! encounter 2 Wolf — snarling | rank: Soul Class I | stakes: normal']));
    const offer = host.q('combat.offers')[0];
    assert.ok(offer, JSON.stringify(host.turn.problems().map(problem => problem.message)));
    assert.match(JSON.stringify(offer), /"rank":"I"/);
});

// ---------- carry capacity ----------

const MULE = { id: 'pack.e/pack-mule', name: 'Pack Mule', kind: 'goods', rarity: 'common', value: 800, stack: false, slot: null, stats: {}, effect: {}, tags: [], note: '', carry: 80 };
const CART = { ...MULE, id: 'pack.e/cart', name: 'Cart', carry: 200 };
const RING = { ...MULE, id: 'pack.e/spatial-ring', name: 'Spatial Ring', kind: 'equipment', slot: 'accessory', carry: 100 };
const BAG = { ...MULE, id: 'story/bag-of-holding', name: 'Bag of Holding', carry: 500 };

function stocked(extra) {
    const state = makeState();
    const inv = state.domains.inventory;
    for (const item of [MULE, CART, RING, BAG]) inv.defs[item.id] = item;
    Object.assign(inv.stacks, extra);
    return state.domains;
}

test('things that carry: a member\'s own to them, the bag\'s to the party, gear only worn, never a story-made def', () => {
    const before = carryView(makeState().domains.inventory, makeState().domains.party, {});
    const { inventory, party } = stocked({
        it_mule0001: { id: 'it_mule0001', def: MULE.id, qty: 1, owner: PC, equipped: null, note: '', from: '' },
        it_cart0001: { id: 'it_cart0001', def: CART.id, qty: 1, owner: 'party', equipped: null, note: '', from: '' },
        it_ring0001: { id: 'it_ring0001', def: RING.id, qty: 1, owner: LYRA, equipped: null, note: '', from: '' },
        it_bag00001: { id: 'it_bag00001', def: BAG.id, qty: 1, owner: LYRA, equipped: null, note: '', from: '' },
    });
    const view = carryView(inventory, party, {});
    const ren = view.people.find(person => person.id === PC);
    const lyra = view.people.find(person => person.id === LYRA);
    assert.equal(ren.bonus, 80);
    assert.equal(ren.capacity, before.people[0].capacity + 80);
    assert.equal(lyra.bonus, 0, 'a ring in the bag adds nothing until worn; a story-made bag never does');
    assert.equal(view.bagBonus, 200);
    assert.equal(view.capacity, before.capacity + 280);
    assert.deepEqual(view.bonuses.map(entry => [entry.stack, entry.carry, entry.counts]), [['it_cart0001', 200, true], ['it_mule0001', 80, true], ['it_ring0001', 100, false]]);
    inventory.stacks.it_ring0001.equipped = 'accessory-1';
    assert.equal(carryView(inventory, party, {}).people.find(person => person.id === LYRA).bonus, 100, 'worn, the ring counts');
    // The reader's own list, by name (a story-made thing named in it counts: the reader said so).
    const named = carryBonuses(inventory, { carryItems: [{ item: 'bag of holding', carry: 50 }] });
    assert.equal(named.bonus[LYRA], 150);
    assert.match(carryText(view).text, /^Carrying \d+ of \d+ \(\+200 carry\) · Ren \d+\/\d+ \(\+80 carry\)/);
});

test('a thing that carries makes room for itself; losing it lowers the capacity and nothing is dropped', () => {
    const { inventory, party } = stocked({});
    const full = { name: 'Stone', kind: 'goods', weight: 88 };
    assert.equal(canCarry(inventory, party, { owner: 'party', add: [{ def: full, qty: 1 }] }).ok, false);
    const mule = canCarry(inventory, party, { owner: PC, add: [{ def: MULE, qty: 1 }] });
    assert.equal(mule.ok, true);
    assert.equal(mule.capacity, carryView(inventory, party, {}).people[0].capacity + 80);
    inventory.stacks.it_mule0001 = { id: 'it_mule0001', def: MULE.id, qty: 1, owner: PC, equipped: null, note: '', from: '' };
    inventory.stacks.it_load0001 = { id: 'it_load0001', def: 'story/load', qty: 1, owner: PC, equipped: null, note: '', from: '' };
    inventory.defs['story/load'] = { ...BAG, id: 'story/load', name: 'Sacks', weight: 100, carry: undefined };
    assert.ok(carryView(inventory, party, {}).people[0].load <= carryView(inventory, party, {}).people[0].capacity);
    delete inventory.stacks.it_mule0001;
    const after = carryView(inventory, party, {});
    assert.ok(after.people[0].load > after.people[0].capacity, 'over the limit now: encumbered');
    assert.ok(inventory.stacks.it_load0001, 'nothing is dropped');
});

test('on the host: a pack item\'s carry comes with it, the Inventory row says +80 carry, the story cannot add any', async t => {
    quiet(t);
    const host = await rpgHost();
    t.after(() => host.close());
    const pack = { id: 'e', version: '1.0.0', requires: { storyBlock: '^2' }, content: { items: [{ name: 'Pack Mule', kind: 'goods', value: 800, stack: false, carry: 80 }] } };
    assert.equal((await host.packs.packs.install(JSON.stringify(pack))).ok, true);
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    const before = host.q('items.carry').capacity;
    await host.send('Buy a mule.', host.reply('A mule.', ['+ item Pack Mule', '+ item Bag of Holding | note: carry +500, endless room']));
    const items = host.q('inventory.items', {});
    assert.equal(items.find(item => item.name === 'Pack Mule').carry, 80);
    assert.equal('carry' in items.find(item => item.name === 'Bag of Holding'), false);
    assert.equal(host.q('items.carry').capacity, before + 80);
});

// ---------- prices by place ----------

test('settlement types: a capital dearer with more stock, a village cheaper with less; unknown is the usual', () => {
    const at = kind => marketAt({ name: 'Somewhere', kind });
    assert.deepEqual([at('capital').buy, at('village').buy, at('town').buy, at('settlement').buy], [1.2, 0.9, 1, 1]);
    assert.ok(at('capital').stock[1] > at('village').stock[1]);
    assert.equal(at('settlement').type, null);
    assert.equal(marketWhy(at('settlement')), 'Usual prices (no market type known here)');
    assert.equal(at('fortress city').type, 'city', 'a few kind words mean a type');
    const world = kind => makeWorld({ scene: { place: { name: 'Somewhere', kind }, present: [] }, inventory: {}, trade: {}, party: { pc: null, actors: {} } });
    const count = kind => stockOf(world(kind), 'general').items.length;
    assert.ok(count('capital') >= 8 && count('village') <= 6, `${count('capital')} at a capital, ${count('village')} at a village`);
});

test('environment tags move one category, held to ±30%; the screen says why', () => {
    const coast = marketAt({ name: 'Saltcliff', kind: 'town', tags: ['coastal', 'river', 'port'] });
    assert.equal(goodsFactor({ name: 'River Trout', kind: 'goods' }, coast), 1 - ENV_CAP, 'fish cheaper, but never more than 30%');
    assert.equal(goodsFactor({ name: 'Iron Ore', kind: 'material' }, coast), 0.95, 'the port\'s 5% on everything');
    const mine = marketAt({ name: 'Greyvein', kind: 'camp', tags: ['mining', 'frontier'] });
    assert.ok(goodsFactor({ name: 'Iron Ore', kind: 'material' }, mine) < 1);
    assert.ok(goodsFactor({ name: 'Coarse Bread', kind: 'goods' }, mine) > 1);
    assert.equal(marketWhy(marketAt({ name: 'Saltcliff', kind: 'town', tags: ['coastal'] })), 'Town · coastal: fish −20%, salt −10%');
    assert.equal(categoryOf({ name: 'Spear', kind: 'equipment', slot: 'weapon' }), 'metal');
    assert.equal(categoryOf({ name: 'Healing Draught', kind: 'consumable' }), 'herbs');
    assert.equal(categoryOf({ name: 'Lantern', kind: 'goods' }), null);
});

test('where the market comes from: the lorebook\'s line, then the pack, then the map\'s kind, then the scene; v1\'s guess only when asked', () => {
    const markets = {
        types: [{ type: 'lock-town', buy: 1.05, sell: 0.95, stock: [4, 6], pack: 'e' }, { type: 'village', buy: 0.8, pack: 'e' }],
        tags: [{ tag: 'toll', prices: { all: 1.05 }, pack: 'e' }],
        places: [
            { place: 'Saltcliff', aliases: ['the Cliff'], type: 'city', tags: ['coastal'], buy: 1.3, from: 'lorebook' },
            { place: 'Saltcliff', aliases: [], type: 'town', tags: [], from: 'pack', pack: 'e' },
            { place: 'Lockswell', aliases: [], type: 'lock-town', tags: ['river', 'toll'], from: 'pack', pack: 'e' },
        ],
    };
    const places = [{ name: 'Dunmere', kind: 'village' }, { name: 'Lockswell', kind: 'lock town' }];
    const lore = marketAt({ name: 'The Cliff', kind: 'town' }, { markets, places });
    assert.deepEqual([lore.type, lore.from, lore.buy, lore.tags], ['city', 'lorebook', 1.3, ['coastal']], 'the place\'s own buy factor');
    const lock = marketAt({ name: 'Lockswell', kind: 'settlement' }, { markets, places });
    assert.deepEqual([lock.type, lock.from, lock.buy, lock.factors.all], ['lock-town', 'pack', 1.05, 1.05]);
    const map = marketAt({ name: 'Dunmere', kind: 'settlement' }, { markets, places });
    assert.deepEqual([map.type, map.from, map.buy], ['village', 'map', 0.8], 'the pack\'s own village factor');
    assert.equal(marketAt({ name: 'Nowhere', kind: 'capital' }, { markets, places }).from, 'scene');
    // The reader's guessPrices: v1's words only where nothing names the place's market.
    const at = (name, settings) => makeWorld({ scene: { place: { name, kind: 'settlement' }, present: [] }, inventory: {}, trade: {}, party: { actors: {} }, settings });
    assert.equal(at('Royal Harbour', {}).prices.buy, 1);
    assert.ok(at('Royal Harbour', { guessPrices: true }).prices.buy > 1);
    assert.match(at('Royal Harbour', { guessPrices: true }).why, /guessed from the place's name/);
});

test('the money scale multiplies the built-in prices, never a pack\'s own; the story only names the place', () => {
    const state = baseState({ place: { name: 'Saltcliff', kind: 'town' } });
    state.domains.inventory.defs['pack.e/rations'] = def('pack.e/rations', 'Trail Rations', { value: 12 });
    state.domains.inventory.stacks.it_00000009 = stack('it_00000009', 'pack.e/rations', 1);
    const priced = scale => {
        const withScale = { ...tradePart, queries: { ...tradePart.queries, 'inventory.economy': () => ({ scale }) } };
        const host = tradeHost(withScale, { state: structuredClone(state) });
        const rope = host.query('trade.stock', { kind: 'general' }).items.find(item => item.def.name === 'Rope');
        return { rope: rope?.price, ration: host.query('trade.quote', { type: 'sell', stack: 'it_00000009', qty: 1 }).each, market: host.query('trade.market') };
    };
    const one = priced(1);
    const eight = priced(8);
    assert.ok(one.rope && eight.rope >= one.rope * 7, `${one.rope} → ${eight.rope}`);
    assert.equal(eight.ration, one.ration, 'a pack\'s own value is as written');
    assert.equal(eight.market.scale, 8);
    assert.equal(eight.market.type, 'town');
    assert.equal(eight.market.from, 'scene');
});
