// The screens part's view queries (src/v2/screens/view.js) against fixture states in the v2 parts'
// shapes, with `tools.query` over the real party, items and trade queries (MODULES §F3).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BANDS, actorCard, cards, carry, conditionBadge, conditionStatus, conditionView, crafting, effectBadge, heroOf, heroes, hud, itemDetail, skillTiers, trade, tryQuery } from '../../../src/v2/screens/index.js';
import { validateChecks } from '../../../src/v2/checks/shared.js';
import { LYRA, PC, QUERIES, emptyState, makeState, toolsFor } from './helpers/state.js';

const ask = (fn, state, args = {}) => fn(state, args, toolsFor(state));

// The tools with stand-ins for other parts' queries (RB-party2's party.toSpend / party.effects,
// RB-gear's items.condition, RB-craft's craft.view) laid over the real ones.
function withQueries(state, extra) {
    const base = toolsFor(state);
    const tools = {
        query(name, args) {
            if (Object.hasOwn(extra, name)) return extra[name](args ?? {}, tools);
            return base.query(name, args);
        },
    };
    return tools;
}

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

test('cards: conditions are status badges (ss.status) with an icon, a tone and the turns left', () => {
    const [ren] = ask(cards, makeState());
    assert.deepEqual(ren.statuses, [
        { id: 'poisoned-0', kind: 'poisoned', label: 'Poisoned', icon: 'fa-skull-crossbones', tone: 'bad', left: 3, unit: 'turns' },
        { id: 'bleeding-1', kind: 'bleeding', label: 'Bleeding', icon: 'fa-droplet', tone: 'bad', left: null, unit: 'turns' },
    ]);
    assert.deepEqual(conditionStatus({ kind: 'shielded', stacks: 2 }), { id: 'shielded-0', kind: 'shielded', label: 'Shielded', icon: 'fa-shield-halved', tone: 'good', left: 2, unit: 'turns' });
    assert.deepEqual(conditionStatus({ kind: 'bleeding', stacks: 1, at: 0, rounds: 0 }, 0, null).unit, 'turns');
    assert.deepEqual(conditionBadge({ kind: 'shielded', stacks: 2 }), { id: 'shielded-0', kind: 'shielded', label: 'Shielded', showLabel: true, icon: 'fa-shield-halved', tone: 'good', counter: 2, unit: 'turns left' });
    assert.equal(conditionBadge({ kind: 'homesick' }).tone, 'neutral');
    assert.equal(conditionBadge({}).label, 'Unwell');
});

test('cards: skills are tiles (ss.tiers) grouped by tier, those in use first, story-taught last', () => {
    const [ren, lyra] = ask(cards, makeState());
    assert.deepEqual(ren.tiers.tiers.map(tier => tier.title), ['Tier 1', 'Tier 2', 'Taught by the story']);
    assert.deepEqual(ren.tiers.tiers[0].tiles.map(tile => [tile.label, tile.state]), [['Power Strike', 'ready'], ['Quick Stab', 'ready'], ['Firebolt', 'none']]);
    // The count is the level; the hint says the uses toward the next one.
    assert.equal(ren.tiers.tiers[0].tiles[0].count, 'Lv 2');
    assert.equal(ren.tiers.tiers[0].tiles[0].icon, 'fa-hand-fist');
    assert.match(ren.tiers.tiers[0].tiles[0].hint, /^Lv 2 · \d+\/\d+ uses to Lv 3$/);
    assert.equal(ren.tiers.tiers[2].tiles[0].label, 'Shadow Cut');
    assert.equal(ren.activeCount, 4);
    assert.equal(ren.activeCap, 6);
    assert.equal(ren.skills.find(skill => skill.name === 'Firebolt').cost, '5 MP');
    assert.equal(ren.skills.find(skill => skill.name === 'Power Strike').cost, '4 SP');
    assert.deepEqual(lyra.tiers, { tiers: [] });
    assert.deepEqual(skillTiers([]), { tiers: [] });
});

test('skills as tiles stay within ss.tiers\' limits: 12 tiers of 24 tiles', () => {
    const skill = (name, tier) => ({ name, level: 1, progress: '', active: true, tier, icon: 'fa-star', type: '' });
    const many = Array.from({ length: 30 }, (_, i) => skill(`S${i}`, 1));
    const tiers = Array.from({ length: 14 }, (_, i) => skill(`T${i}`, i + 1));
    assert.equal(skillTiers(many).tiers[0].tiles.length, 24);
    assert.equal(skillTiers(tiers).tiers.length, 12);
    assert.equal(skillTiers(tiers).tiers[0].tiles[0].hint, 'Lv 1');
});

test('heroOf: the bars and status badges within ss.hero\'s limits, the EXP bar under the Terms\' word', () => {
    const hero = heroOf({
        name: 'Ren', portrait: '/thumbnail?type=avatar&file=ren.png', line: 'Lv 3 · Sellsword · You',
        pools: { hp: { cur: 5, max: 9 }, mp: { cur: 0, max: 0 }, sp: { cur: 2, max: 4 } },
        xp: { cur: 40, max: 100 }, xpName: 'Soul Growth', xpText: '40 / 100',
        statuses: Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, label: `S${i}` })),
    });
    assert.deepEqual(hero.bars.map(bar => [bar.kind, bar.label]), [['hp', 'HP'], ['sp', 'SP'], ['exp', 'Soul Growth']]);
    assert.equal(hero.bars[2].text, '40 / 100');
    assert.equal(hero.statuses.length, 12);
    assert.equal(hero.portrait, '/thumbnail?type=avatar&file=ren.png');
    // heroes(): one per member, at this reply's pools; a worn-off condition left out.
    const state = makeState();
    const pools = { [PC]: { hp: { cur: 1, max: 82 }, mp: { cur: 30, max: 40 }, sp: { cur: 20, max: 24 }, lapsed: ['poisoned'] } };
    const out = heroes(state, {}, { query: (name) => (name === 'party.pools' ? pools : null) });
    assert.equal(out[PC].bars[0].value, 1);
    assert.deepEqual(out[PC].statuses.map(status => status.label), ['Bleeding']);
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
    assert.deepEqual(Object.keys(view).sort(), ['pc', 'ready', 'toSpend']);
    assert.deepEqual(ask(hud, emptyState()), { ready: false, pc: null, toSpend: { on: false, total: 0, text: '0 to spend', title: '' } });
});

test('settings: the party part\'s keys as the module keeps them (party.xpBase) or bare', () => {
    const state = makeState();
    assert.deepEqual(ask(cards, state, { settings: { 'party.xpBase': 300 } })[0].xp, { cur: 40, max: 300 });
    assert.deepEqual(cards(state, {}, { ...toolsFor(state), settings: { xpBase: 200 } })[0].xp, { cur: 40, max: 200 });
    assert.equal(ask(cards, state, { settings: { 'party.activeSkills': 4 } })[0].activeCap, 4);
});

test('cards: companion switches (control, growth), and only a companion has them', () => {
    const state = makeState();
    let [ren, lyra] = ask(cards, state);
    assert.deepEqual([ren.companion, ren.control, ren.growth], [false, 'player', 'manual']);
    assert.deepEqual([lyra.companion, lyra.control, lyra.growth], [true, 'auto', 'auto']);
    // party.edit's own default: a companion you lead spends by hand unless set (party/sheets.js growthOf).
    state.domains.party.actors[LYRA].control = 'player';
    [, lyra] = ask(cards, state);
    assert.deepEqual([lyra.control, lyra.growth], ['player', 'manual']);
    state.domains.party.actors[LYRA].growth = 'auto';
    [, lyra] = ask(cards, state);
    assert.equal(lyra.growth, 'auto');
});

test('cards: what each member wears, with condition bands and refinement from items.condition', () => {
    const state = makeState();
    const conditions = {
        it_dagger01: { stack: 'it_dagger01', band: 'worn', cur: 52, max: 100, refine: 2, name: 'Iron Dagger +2', factor: 0.85 },
    };
    const tools = withQueries(state, { 'items.condition': ({ stack }) => conditions[stack] ?? null });
    const [ren, lyra] = cards(state, {}, tools);
    assert.deepEqual(ren.gear.map(piece => [piece.name, piece.slotLabel, piece.stats, piece.counted]), [['Iron Dagger', 'Weapon', 'ATK +3', true]]);
    assert.deepEqual(ren.gear[0].condition, { band: 'worn', label: 'Worn', tone: 'warn', icon: 'fa-shield-halved', cur: 52, max: 100, meter: true, text: 'Worn · 52/100' });
    assert.deepEqual(ren.gear[0].refine, { level: 2, label: '+2', text: 'Refined +2' });
    assert.deepEqual(lyra.gear, []);
    // With wear and refinement off (items.condition is null): the pieces, no condition or refinement.
    const [plain] = cards(state, {}, withQueries(state, { 'items.condition': () => null }));
    assert.deepEqual([plain.gear[0].condition, plain.gear[0].refine], [null, null]);
    // Only refinement on (wear off): RB-gear's { band: null, refine } shape.
    assert.deepEqual(conditionView({ band: null, cur: null, max: null, refine: 1 }), { condition: null, refine: { level: 1, label: '+1', text: 'Refined +1' } });
    // Every band reads; an unknown band or a non-object is nothing.
    assert.deepEqual(Object.keys(BANDS), ['good', 'worn', 'tattered', 'broken']);
    assert.equal(conditionView({ band: 'broken', cur: 0, max: 100 }).condition.tone, 'bad');
    assert.equal(conditionView({ band: 'shiny' }).condition, null);
    assert.deepEqual(conditionView('worn'), { condition: null, refine: null });
    // A band without numbers has no meter.
    assert.deepEqual(conditionView({ band: 'good' }).condition, { band: 'good', label: 'Good', tone: 'good', icon: 'fa-shield-halved', cur: 0, max: 0, meter: false, text: 'Good' });
});

test('cards and hud: active effects from party.effects as badges; none without it', () => {
    const state = makeState();
    const effects = { [PC]: [{ id: 'ef_1', name: 'blessed', tone: 'good', left: '2 h', source: 'a shrine' }, { id: 'ef_2', name: 'Setback', tone: 'bad', left: '', source: '' }] };
    const tools = withQueries(state, { 'party.effects': ({ actor }) => effects[actor] ?? [] });
    const [ren, lyra] = cards(state, {}, tools);
    assert.deepEqual(ren.effects, [
        { id: 'ef_1', kind: 'effect', label: 'Blessed, 2 h left, from a shrine', text: 'Blessed · 2 h', showLabel: true, icon: 'fa-heart-circle-plus', tone: 'good', counter: null, unit: '' },
        { id: 'ef_2', kind: 'effect', label: 'Setback', text: 'Setback', showLabel: true, icon: 'fa-arrow-trend-down', tone: 'bad', counter: null, unit: '' },
    ]);
    assert.deepEqual(lyra.effects, []);
    assert.equal(hud(state, {}, tools).pc.effects.length, 2);
    assert.deepEqual(ask(cards, state)[0].effects, []);
    assert.equal(effectBadge({ name: 'x', tone: '<b>' }).tone, 'neutral');
});

test('hud: the points-to-spend badge from party.toSpend, else your own points', () => {
    const state = makeState();
    const tools = withQueries(state, { 'party.toSpend': () => ({ total: 5, people: [{ id: PC, name: 'Ren', points: 3 }, { id: LYRA, name: 'Lyra', points: 2 }] }) });
    assert.deepEqual(hud(state, {}, tools).toSpend, { on: true, total: 5, text: '5 to spend', title: 'Stat points to spend: Ren 3, Lyra 2' });
    // Nobody has points: no badge.
    const none = withQueries(state, { 'party.toSpend': () => ({ total: 0, people: [] }) });
    assert.equal(hud(state, {}, none).toSpend.on, false);
    // Without the query: your character's points.
    assert.deepEqual(ask(hud, state).toSpend, { on: true, total: 3, text: '3 to spend', title: 'Stat points to spend: Ren 3' });
    state.domains.party.actors[PC].points = 0;
    assert.equal(ask(hud, state).toSpend.on, false);
});

test('itemDetail: gear slot, stats, wearer, condition and refinement; a draught and whom it helps; nothing for the rest', () => {
    const state = makeState();
    const tools = withQueries(state, { 'items.condition': ({ stack }) => (stack === 'it_dagger01' ? { band: 'tattered', cur: 20, max: 100, refine: 1 } : null) });
    const dagger = itemDetail(state, { stack: 'it_dagger01' }, tools);
    assert.equal(dagger.kind, 'equipment');
    assert.deepEqual([dagger.slotLabel, dagger.stats, dagger.wearer], ['Weapon', 'ATK +3', 'Ren']);
    assert.equal(dagger.condition.band, 'tattered');
    assert.equal(dagger.refine.label, '+1');
    assert.deepEqual(dagger.lines, ['Weapon · ATK +3', 'Worn by Ren', 'Tattered · 20/100 · Refined +1']);
    // A blade in the bag: no wearer, and nothing about its condition with wear and refinement off.
    const blade = itemDetail(state, { stack: 'it_blade001' }, withQueries(state, { 'items.condition': () => null }));
    assert.deepEqual([blade.wearer, blade.condition, blade.refine, blade.lines], ['', null, null, ['Weapon · ATK +6, DEX +1']]);
    // Ren is hurt, Lyra is not: the draught would help Ren only.
    const draught = itemDetail(state, { stack: 'it_draught1' }, toolsFor(state));
    assert.deepEqual([draught.kind, draught.effect, draught.helps, draught.lines], ['consumable', '+20 HP', ['Ren'], ['+20 HP · would help Ren']]);
    state.domains.party.actors[PC].hp.cur = 82;
    state.domains.party.actors[PC].conditions = [];
    assert.deepEqual(itemDetail(state, { stack: 'it_draught1' }, null).lines, ['+20 HP · nobody needs it now']);
    // Plain goods, a gone stack, a strange id: null (the widget draws nothing).
    assert.equal(itemDetail(state, { stack: 'it_rope0001' }), null);
    assert.equal(itemDetail(state, { stack: 'it_nothere' }), null);
    assert.equal(itemDetail(state, { stack: '__proto__' }), null);
    assert.equal(itemDetail(state, {}), null);
});

test('carry: the carry line for the Party screen (items.carry)', () => {
    const view = ask(carry, makeState());
    assert.equal(view.on, true);
    assert.match(view.text, /^Carrying \d+ of \d+ · Ren \d+\/\d+ · Lyra \d+\/\d+$/);
    assert.deepEqual(carry(makeState(), {}, null), { on: false, text: '', over: false });
});

test('crafting: recipes per character, materials had and missing, chances in order; off without craft.view', () => {
    const state = makeState();
    const view = {
        people: [
            {
                id: PC, name: 'Ren', recipes: [
                    { id: 'rc_1', name: 'Healing Draught', craft: 'alchemy', station: { name: 'an alchemy bench', here: false }, dc: 12, ready: false, why: 'Needs an alchemy bench.',
                        materials: [{ name: 'Moonleaf', need: 2, have: 3 }, { name: 'Clean Water', need: 1, have: 0 }], chances: { fail: 35, normal: 45, fine: 15, masterwork: 5 } },
                    { id: 'rc_2', name: 'Torch', craft: 'basic', ready: true, materials: [{ name: 'Stick', need: 1, have: 4 }], chances: { fail: 0, normal: 80, fine: 20, masterwork: 0 } },
                ],
            },
            { id: LYRA, name: 'Lyra', recipes: [] },
        ],
    };
    const out = crafting(state, {}, withQueries(state, { 'craft.view': () => view }));
    assert.deepEqual([out.on, out.empty], [true, false]);
    assert.deepEqual(out.people.map(person => [person.name, person.count]), [['Ren', 2], ['Lyra', 0]]);
    const [draught, torch] = out.people[0].recipes;
    assert.deepEqual([draught.craft, draught.station, draught.stationOk, draught.ready, draught.why, draught.dc, draught.missing], ['Alchemy', 'Needs an alchemy bench', false, false, 'Needs an alchemy bench.', 12, 1]);
    assert.deepEqual(draught.materials.map(entry => [entry.name, entry.ok, entry.text]), [['Moonleaf', true, '3/2'], ['Clean Water', false, '0/1']]);
    assert.deepEqual(draught.chances.map(entry => [entry.key, entry.pct, entry.tone]), [['fail', 35, 'bad'], ['normal', 45, 'neutral'], ['fine', 15, 'good'], ['masterwork', 5, 'accent']]);
    // A 0% outcome is left out of the bar; no station is fine anywhere.
    assert.deepEqual(torch.chances.map(entry => entry.key), ['normal', 'fine']);
    assert.deepEqual([torch.station, torch.stationOk, torch.dc], ['', true, null]);
    // Nobody knows a recipe: empty; no craft part (or the feature off): not on.
    assert.equal(crafting(state, {}, withQueries(state, { 'craft.view': () => ({ people: [{ id: PC, name: 'Ren', recipes: [] }] }) })).empty, true);
    assert.deepEqual(ask(crafting, state), { on: false, empty: true, people: [] });
    // Odd numbers are held to whole percents.
    const odd = crafting(state, {}, withQueries(state, { 'craft.view': () => ({ people: [{ name: 'Ren', recipes: [{ name: 'X', chances: { fail: 250, normal: -4 } }] }] }) }));
    assert.deepEqual(odd.people[0].recipes[0].chances.map(entry => entry.pct), [100]);
});

test('tryQuery: a missing, throwing or null query is undefined, so its section is left out', () => {
    const tools = { query(name) { if (name === 'boom') throw new Error('no'); return name === 'nil' ? null : { name }; } };
    assert.deepEqual(tryQuery(tools, 'x'), { name: 'x' });
    assert.equal(tryQuery(tools, 'boom'), undefined);
    assert.equal(tryQuery(tools, 'nil'), undefined);
    assert.equal(tryQuery(null, 'x'), undefined);
});

test('trade: at a market — the line, the purse, sell prices from trade.quote, stock per trader, materials, orders', () => {
    const view = ask(trade, makeState());
    assert.equal(view.open, true);
    assert.equal(view.place, 'Bluewatch Village');
    assert.equal(view.line, 'Market · Village: prices −10%, pays −15%');
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
    for (const fn of [cards, hud, carry, trade]) {
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
    assert.equal(itemDetail(bare, { stack: 'it_x' }), null);
    assert.equal(crafting(bare, {}, null).on, false);
    assert.equal(trade(bare, {}, null).open, false);
});
