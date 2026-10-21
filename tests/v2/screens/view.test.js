// The screens part's view queries (src/v2/screens/view.js) against fixture states in the v2 parts'
// shapes, with `tools.query` over the real party, items and trade queries (MODULES §F3).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { actorCard, cards, conditionBadge, hud, items, skillTree, trade } from '../../../src/v2/screens/index.js';
import { validateChecks } from '../../../src/v2/checks/shared.js';
import { LYRA, PC, QUERIES, emptyState, makeState, toolsFor } from './helpers/state.js';

const ask = (fn, state, args = {}) => fn(state, args, toolsFor(state));

test('cards: one per member, your character first, with pools, EXP to the next level and the class line', () => {
    const state = makeState();
    state.domains.party.order = [LYRA, PC];   // the display order may put a companion first: you still lead
    const [ren, lyra] = ask(cards, state);
    assert.equal(ren.id, PC);
    assert.equal(lyra.id, LYRA);
    assert.equal(ren.you, true);
    assert.equal(lyra.you, false);
    assert.equal(ren.line, 'Lv 3 · Sellsword · You');
    assert.equal(lyra.line, 'Lv 2 · Ranger · Companion');
    assert.deepEqual(ren.hp, { cur: 57, max: 82 });
    assert.deepEqual(ren.mp, { cur: 30, max: 40 });
    assert.deepEqual(ren.sp, { cur: 20, max: 24 });
    assert.deepEqual(ren.xp, { cur: 40, max: 100 });   // v1 xpToNext: 100 a level by default
    assert.equal(ren.xpText, '40 / 100');
    assert.equal(ren.portrait, 'https://example.org/ren.png');
    assert.equal(lyra.portrait, '');
});

test('cards: EXP follows the reader\'s settings, and the top level shows a full bar', () => {
    const state = makeState();
    const [ren] = ask(cards, state, { settings: { xpBase: 250 } });
    assert.deepEqual(ren.xp, { cur: 40, max: 250 });
    state.domains.party.actors[PC].level = 99;
    const [top] = ask(cards, state);
    assert.deepEqual(top.xp, { cur: 1, max: 1 });
    assert.equal(top.xpText, 'Top level');
    const [capped] = ask(cards, makeState(), { settings: { maxLevel: 3 } });
    assert.equal(capped.xpText, 'Top level');
});

test('cards: condition badges carry an icon, a tone and the turns left', () => {
    const [ren] = ask(cards, makeState());
    assert.deepEqual(ren.badges, [
        { id: 'poisoned-0', kind: 'poisoned', label: 'Poisoned', icon: 'fa-skull-crossbones', tone: 'bad', counter: 3, unit: 'turns left' },
        { id: 'bleeding-1', kind: 'bleeding', label: 'Bleeding', icon: 'fa-droplet', tone: 'bad', counter: null, unit: '' },
    ]);
    assert.deepEqual(conditionBadge({ kind: 'shielded', stacks: 2 }), { id: 'shielded-0', kind: 'shielded', label: 'Shielded', icon: 'fa-shield-halved', tone: 'good', counter: 2, unit: 'turns left' });
    assert.equal(conditionBadge({ kind: 'homesick' }).tone, 'neutral');
    assert.equal(conditionBadge({}).label, 'Unwell');
});

test('cards: skills grouped by tier for the skill tree, those in use first, story-taught last', () => {
    const [ren, lyra] = ask(cards, makeState());
    assert.deepEqual(ren.tree.tiers.map(tier => tier.title), ['Tier 1', 'Tier 2', 'Taught by the story']);
    assert.deepEqual(ren.tree.tiers[0].skills.map(skill => [skill.name, skill.active]), [['Power Strike', true], ['Quick Stab', true], ['Firebolt', false]]);
    assert.deepEqual(ren.tree.tiers[0].skills[0], { id: 'Power Strike', name: 'Power Strike', icon: 'fa-hand-fist', level: 2, max: 5, active: true });
    assert.equal(ren.tree.tiers[2].skills[0].name, 'Shadow Cut');
    assert.equal(ren.activeCount, 4);
    assert.equal(ren.activeCap, 6);
    assert.equal(ren.skills.find(skill => skill.name === 'Firebolt').cost, '5 MP');
    assert.equal(ren.skills.find(skill => skill.name === 'Power Strike').cost, '4 SP');
    assert.deepEqual(lyra.tree, { tiers: [] });
    assert.deepEqual(skillTree([]), { tiers: [] });
});

test('cards: stats with check modifiers, radar axes on a shared scale, and room to spend', () => {
    const [ren, lyra] = ask(cards, makeState());
    assert.deepEqual(ren.stats.map(stat => [stat.key, stat.value, stat.mod, stat.room]), [
        ['STR', 9, '+2', 3], ['VIT', 7, '+1', 3], ['AGI', 6, '', 3], ['DEX', 6, '', 3], ['INT', 5, '', 3], ['LUK', 5, '', 3], ['CHA', 4, '-1', 3],
    ]);
    assert.deepEqual(ren.statAxes[0], { label: 'STR', value: 9, max: 10 });
    assert.ok(ren.statAxes.every(axis => axis.max === 10));
    assert.equal(ren.spend, true);
    assert.equal(lyra.spend, false);
    assert.ok(lyra.stats.every(stat => stat.room === 0));
    // The stat cap limits the room: a stat at the cap has none.
    const [capped] = ask(cards, makeState(), { settings: { statCap: 10 } });
    assert.deepEqual(capped.stats.slice(0, 2).map(stat => stat.room), [1, 3]);
});

test('cards: the spending draft key changes with the level and the points', () => {
    const state = makeState();
    const before = ask(cards, state)[0].spendKey;
    assert.equal(before, 'ac_ren00001_l3_p3');
    assert.match(before, /^\w+$/);
    state.domains.party.actors[PC].points = 1;
    assert.notEqual(ask(cards, state)[0].spendKey, before);
});

test('cards: low and down flags', () => {
    const state = makeState();
    state.domains.party.actors[PC].hp = { cur: 20, max: 82 };
    state.domains.party.actors[LYRA].hp = { cur: 0, max: 60 };
    const [ren, lyra] = ask(cards, state);
    assert.equal(ren.low, true);
    assert.equal(ren.down, false);
    assert.equal(lyra.low, false);
    assert.equal(lyra.down, true);
});

test('cards: a companion NSD knows gets its portrait through party.actors (MODULES §F11)', () => {
    const state = makeState();
    state.domains.party.actors[LYRA].npc = 'Lyra';
    const base = toolsFor(state);
    const tools = {
        query(name, args) {
            if (name === 'npc.portrait') return args?.name === 'Lyra' ? 'https://example.org/lyra.png' : null;
            // party.actors asks npc.portrait through the tools it is given: these.
            return name === 'party.actors' ? QUERIES[name](state, args, tools) : base.query(name, args);
        },
    };
    const [ren, lyra] = cards(state, {}, tools);
    assert.equal(lyra.portrait, 'https://example.org/lyra.png');
    assert.equal(ren.portrait, 'https://example.org/ren.png');
    // Without NSD (or any tools) a companion has no picture and ss.portrait draws initials.
    assert.equal(cards(state, {}, null)[1].portrait, '');
    assert.equal(actorCard(state.domains.party.actors[LYRA], state.domains.party, { portrait: 'https://example.org/x.png' }).portrait, 'https://example.org/x.png');
});

test('hud: your character; checks no longer wait for a roll (MODULES §F80)', () => {
    const state = makeState();
    assert.deepEqual(validateChecks(state.domains.checks), [], 'the fixture is a valid checks slice');
    const view = ask(hud, state);
    assert.equal(view.ready, true);
    assert.equal(view.pc.id, PC);
    assert.deepEqual(Object.keys(view).sort(), ['pc', 'ready']);
    assert.deepEqual(ask(hud, emptyState()), { ready: false, pc: null });
});

test('settings: the party part\'s keys as the module keeps them (party.xpBase) or bare', () => {
    const state = makeState();
    assert.deepEqual(ask(cards, state, { settings: { 'party.xpBase': 300 } })[0].xp, { cur: 40, max: 300 });
    assert.deepEqual(cards(state, {}, { ...toolsFor(state), settings: { xpBase: 200 } })[0].xp, { cur: 40, max: 200 });
    assert.equal(ask(cards, state, { settings: { 'party.activeSkills': 4 } })[0].activeCap, 4);
});

test('items: consumables with who a dose helps, equipment on or off, the rest, and who each can go to', () => {
    const view = ask(items, makeState());
    assert.equal(view.empty, false);
    assert.deepEqual(view.people, [{ id: PC, name: 'Ren' }, { id: LYRA, name: 'Lyra' }]);
    assert.deepEqual(view.consumables.map(row => [row.name, row.qty, row.holder, row.effect]), [
        ['Mana Tonic', 1, 'shared', '+20 MP'], ['Minor Healing Draught', 2, 'shared', '+20 HP'], ['Antidote', 1, 'Lyra', 'cures poison'],
    ]);
    const draught = view.consumables[1];
    // Ren is hurt; Lyra is at full HP and MP, so a dose would do nothing (item.use refuses).
    assert.deepEqual(draught.targets.map(target => [target.id, target.helps]), [[PC, true], [LYRA, false]]);
    assert.equal(draught.targets[1].title, 'Lyra would not gain anything now');
    // The antidote cures Ren's poison even though Lyra carries it.
    assert.deepEqual(view.consumables[2].targets.map(target => target.helps), [true, false]);
    // A shared thing goes to anyone but you (it is yours already); Lyra's to anyone but her.
    assert.deepEqual(draught.give, [{ id: LYRA, name: 'Lyra' }]);
    assert.deepEqual(view.consumables[2].give, [{ id: PC, name: 'Ren' }]);
    assert.deepEqual(view.equipment.map(row => [row.name, row.slotLabel, row.stats, row.equipped, row.wearerLine]), [
        ['Iron Dagger', 'Weapon', 'ATK +3', true, 'worn by Ren'], ['Steel Blade', 'Weapon', 'ATK +6, DEX +1', false, 'for Ren'],
    ]);
    assert.equal(view.equipment[1].rarity, 'uncommon');
    assert.deepEqual(view.other.map(row => row.name), ['Odd <b>Name</b>', 'Rope', 'Wolf Pelt']);
    // An empty stack is not listed.
    assert.ok(![...view.consumables, ...view.equipment, ...view.other].some(row => row.stack === 'it_empty001'));
});

test('items: nothing carried', () => {
    const view = ask(items, emptyState());
    assert.equal(view.empty, true);
    assert.deepEqual([view.consumables, view.equipment, view.other], [[], [], []]);
});

test('trade: at a market — the line, the purse, sell prices from trade.quote, stock per trader, materials, orders', () => {
    const view = ask(trade, makeState());
    assert.equal(view.open, true);
    assert.equal(view.place, 'Bluewatch Village');
    assert.equal(view.line, 'Market · village prices');
    assert.equal(view.purse, '140 g');
    assert.equal(view.purseTitle, '140 gold in the purse');
    const draught = view.sell.find(row => row.stack === 'it_draught1');
    assert.deepEqual(draught, { stack: 'it_draught1', name: 'Minor Healing Draught', qty: 2, note: '', each: 4, price: '4 g', title: 'Sell one Minor Healing Draught for 4 gold' });
    // Worn gear stays.
    assert.ok(!view.sell.some(row => row.stack === 'it_dagger01'));
    assert.deepEqual(view.traders.map(trader => [trader.kind, trader.first]), [['general', true], ['apothecary', false], ['smith', false], ['crafter', false], ['fence', false], ['guild', false]]);
    const general = view.traders[0];
    assert.equal(general.shop, 'bluewatch village|general');
    assert.ok(general.items.length > 0);
    for (const row of general.items) {
        assert.match(row.def, /^trade\//);
        assert.equal(row.price, `${row.cost} g`);
    }
    assert.deepEqual(view.crafters.map(crafter => crafter.kind), ['apothecary', 'smith', 'crafter']);
    assert.deepEqual(view.materials.map(material => material.stack), ['it_odd00001', 'it_pelt0001']);
    assert.equal(view.materials[1].name, 'Wolf Pelt (3)');
    assert.deepEqual(view.orders.map(order => [order.id, order.due, order.collect, order.status]), [
        ['or_aaaaaaaa', true, true, 'ready'], ['or_bbbbbbbb', false, false, 'not ready yet'],
    ]);
});

test('trade: away from a market only the orders show, and nothing can be collected', () => {
    const state = makeState();
    state.domains.scene = { place: { name: 'The Old Road', kind: 'wilds', region: '' }, present: [] };
    const view = ask(trade, state);
    assert.equal(view.open, false);
    assert.match(view.line, /^No market here/);
    assert.deepEqual([view.sell, view.traders, view.materials], [[], [], []]);
    assert.deepEqual(view.orders.map(order => [order.collect, order.status]), [[false, 'ready: collect at a market'], [false, 'not ready yet']]);
});

test('trade: without the trade queries the page says so instead of failing', () => {
    const view = trade(makeState(), {}, null);
    assert.equal(view.available, false);
    assert.equal(view.open, false);
    assert.equal(view.line, 'Trade is not set up in this chat.');
    assert.equal(view.purse, '140 g');
});

test('the queries are pure: plain copies, the same answer twice, the state untouched', () => {
    const state = makeState();
    const before = JSON.stringify(state);
    for (const fn of [cards, hud, items, trade]) {
        const first = ask(fn, state);
        assert.deepEqual(ask(fn, state), first, fn.name);
        assert.deepEqual(JSON.parse(JSON.stringify(first)), first, `${fn.name} is plain JSON`);
    }
    const [ren] = ask(cards, state);
    ren.hp.cur = 0;
    ren.stats[0].value = 99;
    assert.equal(JSON.stringify(state), before);
    assert.equal(ask(cards, state)[0].hp.cur, 57);
});

test('the queries cope with a chat without RPG Battle\'s state yet', () => {
    const bare = { v: 2, meta: { rev: 0 }, domains: {} };
    assert.deepEqual(cards(bare, {}, null), []);
    assert.equal(hud(bare, {}, null).ready, false);
    assert.equal(items(bare).empty, true);
    assert.equal(trade(bare, {}, null).open, false);
});
