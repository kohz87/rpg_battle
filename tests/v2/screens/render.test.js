// The default screens drawn with Story Block's template renderer (SPEC §13.2) against fixture states,
// the way the mounts draw them (helpers/render.js): no warnings, the right text and widget props, and
// every button sending the command payload its command expects. Needs Story Block's template renderer
// (helpers/runtime.js: STORY_BLOCK_DIR, ../story_block, or tests/vendor/story-block once it carries
// src/v2/view/template/); skipped with the reason otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hudScreen, itemsScreen, partyScreen, statusCardScreen, tradeScreen } from '../../../src/v2/screens/index.js';
import { renderer, rendererMissing, widgets as standard } from './helpers/runtime.js';
import { LYRA, PC, emptyState, makeState } from './helpers/state.js';

const skip = renderer ? false : rendererMissing;
const helpers = renderer ? await import('./helpers/render.js') : null;
const { all, click, draw, propsOf, text } = helpers ?? {};

const buttons = (root, command) => all(root, 'button').filter(button => button.getAttribute('data-command') === command);
const widgetsIn = (root, name) => all(root, 'ss-widget').filter(el => el.getAttribute('name') === name);
const cardOf = (root, name) => all(root, 'article.actor').find(card => text(card.querySelector('.name')).startsWith(name));

// Story Block's own prop checks for each widget drawn (types, and the required props once bound).
function checkProps(drawn) {
    if (!standard) return;
    for (const { name, props } of drawn.widgets) {
        const widget = standard.standardWidgets[name];
        let unfolded = standard.unfoldValue({ ...props }, widget.props, widget.primary);
        // ss.meter reads a bound pool's `cur` as its value (meter.js).
        if (name === 'ss.meter' && unfolded.value === undefined && unfolded.cur !== undefined) unfolded = { ...unfolded, value: unfolded.cur };
        assert.deepEqual(widget.validate(props), [], `${name} props: ${JSON.stringify(props)}`);
        assert.deepEqual(standard.propProblems(widget.props, unfolded), [], `${name} props: ${JSON.stringify(props)}`);
    }
}

test('party: a card per member with portrait, pools, EXP, badges, skills and stats', { skip }, () => {
    const drawn = draw(partyScreen, makeState());
    assert.deepEqual(drawn.warnings, []);
    assert.deepEqual(drawn.problems, []);
    const cardsShown = all(drawn.el, 'article.actor');
    assert.equal(cardsShown.length, 2);
    const ren = cardOf(drawn.el, 'Ren');
    const lyra = cardOf(drawn.el, 'Lyra');
    assert.ok(ren.classList.contains('you'));
    assert.ok(ren.classList.contains('can-spend'));
    assert.ok(!lyra.classList.contains('can-spend'));
    assert.equal(text(ren.querySelector('.line')), 'Lv 3 · Sellsword · You');
    assert.equal(text(ren.querySelector('.points')), '3');

    assert.deepEqual(propsOf(widgetsIn(ren, 'ss.portrait')[0]), { src: 'https://example.org/ren.png', name: 'Ren', frame: 'circle', size: 'md', tone: 'accent' });
    const meters = widgetsIn(ren, 'ss.meter').map(el => [el.className, propsOf(el)]);
    assert.deepEqual(meters.map(([cls, props]) => [cls, props.label, props.value]), [
        ['pool hp', 'HP', { cur: 57, max: 82 }], ['pool mp', 'MP', { cur: 30, max: 40 }], ['pool sp', 'SP', { cur: 20, max: 24 }], ['pool xp', 'EXP', { cur: 40, max: 100 }],
    ]);
    assert.equal(meters[3][1].text, '40 / 100');
    const badges = widgetsIn(ren, 'ss.badge').map(el => propsOf(el).value);
    assert.deepEqual(badges.map(badge => [badge.label, badge.counter, badge.unit]), [['Poisoned', 3, 'turns left'], ['Bleeding', null, '']]);
    assert.equal(widgetsIn(lyra, 'ss.badge').length, 0);
    assert.equal(lyra.querySelector('.badges'), null);

    const tree = propsOf(widgetsIn(ren, 'ss.skill-tree')[0]);
    assert.deepEqual(tree.value.tiers.map(tier => tier.title), ['Tier 1', 'Tier 2', 'Taught by the story']);
    assert.equal(tree.label, 'Skills of Ren');
    assert.equal(widgetsIn(lyra, 'ss.skill-tree').length, 0);
    assert.equal(text(lyra.querySelector('.skills .none')), 'No skills yet.');
    assert.match(text(ren.querySelector('.skills h4')), /4 \/ 6 in use/);

    const radar = propsOf(widgetsIn(ren, 'ss.radar')[0]);
    assert.equal(radar.value.length, 7);
    assert.deepEqual(radar.value[0], { label: 'STR', value: 9, max: 10 });
    assert.deepEqual(all(ren, '.stat').map(text), ['STR 9+2', 'VIT 7+1', 'AGI 6', 'DEX 6', 'INT 5', 'LUK 5', 'CHA 4-1']);
    checkProps(drawn);
});

test('party: steppers fill the draft and Spend sends party.spend { actor, points }', { skip }, async () => {
    const drawn = draw(partyScreen, makeState());
    const ren = cardOf(drawn.el, 'Ren');
    const lyra = cardOf(drawn.el, 'Lyra');
    assert.equal(lyra.querySelector('.spend'), null);
    const steppers = widgetsIn(ren, 'ss.stepper');
    assert.deepEqual(steppers.map(el => propsOf(el).name), ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'].map(stat => `spend.ac_ren00001_l3_p3.${stat}`));
    assert.deepEqual(propsOf(steppers[0]), { name: 'spend.ac_ren00001_l3_p3.STR', label: 'STR 9', value: null, min: 0, max: 3, tone: 'accent' });

    // Spend before choosing sends no points; party.spend refuses that with "Choose where the points go."
    await click(buttons(ren, 'party.spend')[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'party.spend', payload: { actor: PC, points: null } });

    const api = drawn.widgets.find(entry => entry.name === 'ss.stepper').api;
    api.onDraft('spend.ac_ren00001_l3_p3.STR', 2);
    api.onDraft('spend.ac_ren00001_l3_p3.AGI', 1);
    assert.equal(propsOf(widgetsIn(ren, 'ss.stepper')[0]).value, 2, 'the stepper shows the draft again');
    await click(buttons(ren, 'party.spend')[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'party.spend', payload: { actor: PC, points: { STR: 2, AGI: 1 } } });
    assert.deepEqual(drawn.warnings, []);

    // After the spend the head has 0 points: the steppers are gone; with points again they start at 0.
    const after = makeState();
    Object.assign(after.domains.party.actors[PC], { points: 0, stats: { ...after.domains.party.actors[PC].stats, STR: 11, AGI: 7 } });
    drawn.rerender(after);
    assert.equal(cardOf(drawn.el, 'Ren').querySelector('.spend'), null);
    after.domains.party.actors[PC].points = 2;
    drawn.rerender(after);
    assert.deepEqual(widgetsIn(cardOf(drawn.el, 'Ren'), 'ss.stepper').map(el => propsOf(el).value), [null, null, null, null, null, null, null]);
});

test('party: Use and Set aside send party.setSkillActive for that skill', { skip }, async () => {
    const drawn = draw(partyScreen, makeState());
    const ren = cardOf(drawn.el, 'Ren');
    const rows = all(ren, 'li.skill');
    assert.deepEqual(rows.map(row => text(row.querySelector('.nm'))), ['Power Strike', 'Quick Stab', 'Firebolt', 'Rending Strike', 'Shadow Cut']);
    const firebolt = rows[2];
    assert.ok(firebolt.classList.contains('aside'));
    assert.equal(text(firebolt.querySelector('button')), 'Use');
    await click(firebolt.querySelector('button'));
    assert.deepEqual(drawn.commands.pop(), { type: 'party.setSkillActive', payload: { actor: PC, name: 'Firebolt', active: true } });
    await click(rows[0].querySelector('button'));
    assert.deepEqual(drawn.commands.pop(), { type: 'party.setSkillActive', payload: { actor: PC, name: 'Power Strike', active: false } });
});

test('party: the offers waiting for the reader, each with Accept and Dismiss', { skip }, async () => {
    const state = makeState();
    state.domains.party.offers = [
        { id: 'of_aaaaaaaa', kind: 'join', name: 'Kael', role: 'scout', level: 2, focus: [], skills: [], npc: null, text: '', rev: 1 },
        { id: 'of_bbbbbbbb', kind: 'leave', actor: LYRA, text: 'parts ways at the ford', rev: 2 },
    ];
    const drawn = draw(partyScreen, state);
    assert.deepEqual(drawn.warnings, []);
    const rows = all(drawn.el, 'li.offer');
    assert.deepEqual(rows.map(row => text(row.querySelector('.nm'))), ['Kael asks to join (scout).', 'Lyra means to leave the party: parts ways at the ford.']);
    assert.ok(rows[1].classList.contains('leave'));
    await click(buttons(rows[1], 'party.acceptOffer')[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'party.acceptOffer', payload: { offer: 'of_bbbbbbbb' } });
    await click(buttons(rows[0], 'party.dismissOffer')[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'party.dismissOffer', payload: { offer: 'of_aaaaaaaa' } });
    // None waiting: no section.
    assert.equal(all(draw(partyScreen, makeState()).el, 'section.offers').length, 0);
});

test('party: before creation it says so', { skip }, () => {
    const drawn = draw(partyScreen, emptyState());
    assert.deepEqual(drawn.warnings, []);
    assert.equal(all(drawn.el, 'article.actor').length, 0);
    assert.match(text(drawn.el.querySelector('.empty')), /No character yet/);
});

test('party: low HP and a fallen member are marked; a second render changes nothing', { skip }, () => {
    const state = makeState();
    state.domains.party.actors[PC].hp = { cur: 10, max: 82 };
    state.domains.party.actors[LYRA].hp = { cur: 0, max: 60 };
    const drawn = draw(partyScreen, state);
    assert.ok(cardOf(drawn.el, 'Ren').classList.contains('low'));
    assert.ok(cardOf(drawn.el, 'Lyra').classList.contains('down'));
    const before = drawn.widgets.length;
    drawn.rerender(state);
    assert.equal(drawn.widgets.length, before, 'no widget is drawn again when its props did not change');
});

test('items: no Use button (MODULES §F96); who a dose would help; Equip / Take off, Give with their payloads', { skip }, async () => {
    const drawn = draw(itemsScreen, makeState());
    assert.deepEqual(drawn.warnings, []);
    const rows = all(drawn.el, 'li.item');
    assert.deepEqual(rows.map(row => text(row.querySelector('.nm'))), ['Mana Tonic', 'Minor Healing Draught×2', 'Antidote', 'Iron Dagger', 'Steel Blade', 'Odd <b>Name</b>', 'Rope', 'Wolf Pelt×3']);
    // Text from the story stays text.
    assert.equal(all(drawn.el, 'b').filter(node => text(node) === 'Name').length, 0);
    assert.equal(all(drawn.el, 'button').filter(button => button.getAttribute('data-command') === 'item.use').length, 0, 'using is the story\'s');

    const draught = rows[1];
    assert.equal(text(draught.querySelector('.sub')), '+20 HP · shared');
    assert.deepEqual(all(draught, '.chip.who').map(text), ['Ren'], 'Lyra would not gain from a dose now');

    const dagger = rows[3];
    assert.ok(dagger.classList.contains('worn'));
    assert.deepEqual(buttons(dagger, 'item.equip'), []);
    await click(buttons(dagger, 'item.unequip')[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'item.unequip', payload: { stack: 'it_dagger01' } });
    const blade = rows[4];
    assert.ok(blade.classList.contains('r-uncommon'));
    assert.deepEqual(buttons(blade, 'item.unequip'), []);
    await click(buttons(blade, 'item.equip')[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'item.equip', payload: { stack: 'it_blade001' } });

    const antidote = rows[2];
    const give = buttons(antidote, 'item.give');
    assert.deepEqual(give.map(text), ['Ren']);
    await click(give[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'item.give', payload: { stack: 'it_antidot1', to: PC } });
    await click(buttons(rows[6], 'item.give')[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'item.give', payload: { stack: 'it_rope0001', to: LYRA } });
    assert.deepEqual(drawn.commands, []);
});

test('items: an empty bag says so', { skip }, () => {
    const drawn = draw(itemsScreen, emptyState());
    assert.deepEqual(drawn.warnings, []);
    assert.match(text(drawn.el.querySelector('.empty')), /carries nothing/);
    assert.equal(all(drawn.el, 'li.item').length, 0);
});

test('trade: the market line, then Sell / Buy / On order rows with short prices and their payloads', { skip }, async () => {
    const drawn = draw(tradeScreen, makeState());
    assert.deepEqual(drawn.warnings, []);
    assert.equal(text(drawn.el.querySelector('.market .place')), 'Bluewatch Village');
    assert.equal(text(drawn.el.querySelector('.market .line')), 'Market · village prices');
    assert.equal(text(drawn.el.querySelector('.purse')), '140 g');
    assert.equal(drawn.el.querySelector('.purse').getAttribute('title'), '140 gold in the purse');

    const sells = buttons(drawn.el, 'trade.sell');
    const draught = sells.filter(button => button.closest('li') && text(button.closest('li').querySelector('.nm')).startsWith('Minor Healing Draught'));
    assert.deepEqual(draught.map(text), ['4 g', 'All']);
    assert.equal(draught[0].getAttribute('title'), 'Sell one Minor Healing Draught for 4 gold');
    await click(draught[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'trade.sell', payload: { stack: 'it_draught1', qty: 1 } });
    await click(draught[1]);
    assert.deepEqual(drawn.commands.pop(), { type: 'trade.sell', payload: { stack: 'it_draught1', qty: 2 } });

    const traders = all(drawn.el, 'details.trader');
    assert.equal(traders.length, 6);
    assert.equal(traders[0].getAttribute('open'), '');
    assert.equal(traders[1].getAttribute('open'), null);
    const buy = buttons(traders[0], 'trade.buy')[0];
    assert.match(text(buy), /^\d+ g$/);
    await click(buy);
    const bought = drawn.commands.pop();
    assert.equal(bought.type, 'trade.buy');
    assert.equal(bought.payload.shop, 'bluewatch village|general');
    assert.match(bought.payload.def, /^trade\//);
    assert.equal(bought.payload.qty, 1);
    assert.equal(bought.payload.def, drawn.q.trade.traders[0].items[0].def);

    const orders = all(drawn.el, 'li.tline').filter(row => row.classList.contains('due') || /not ready/.test(text(row)));
    assert.deepEqual(orders.map(row => text(row.querySelector('.nm'))), ['Skull Ring', 'Pelt Cloak']);
    assert.equal(buttons(orders[1], 'craft.collect').length, 0);
    await click(buttons(orders[0], 'craft.collect')[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'craft.collect', payload: { order: 'or_aaaaaaaa' } });
    checkProps(drawn);
});

test('trade: the commission form turns the draft into craft.commission { piece, materials, crafter }', { skip }, async () => {
    const drawn = draw(tradeScreen, makeState());
    const form = drawn.el.querySelector('.commission .form');
    const [crafter, material] = all(form, 'select');
    assert.deepEqual(all(crafter, 'option').map(option => [option.getAttribute('value'), text(option)]), [['', 'Who makes it…'], ['apothecary', 'Apothecary'], ['smith', 'Smith'], ['crafter', 'Bone-carver']]);
    assert.deepEqual(all(material, 'option').map(option => option.getAttribute('value')), ['', 'it_odd00001', 'it_pelt0001']);

    // Nothing picked yet: the command is sent with no materials and refuses with "Pick what it is made from."
    await click(buttons(form, 'craft.commission')[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'craft.commission', payload: { piece: '', materials: [], crafter: '' } });

    const piece = form.querySelector('input');
    piece.value = 'Pelt Cloak';
    piece.dispatch('input');
    crafter.value = 'crafter';
    crafter.dispatch('change');
    material.value = 'it_pelt0001';
    material.dispatch('change');
    const send = buttons(drawn.el.querySelector('.commission .form'), 'craft.commission');
    assert.equal(send.length, 1);
    await click(send[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'craft.commission', payload: { piece: 'Pelt Cloak', materials: [{ stack: 'it_pelt0001', qty: 1 }], crafter: 'crafter' } });
    assert.deepEqual(drawn.view.draft(), { commission: { piece: 'Pelt Cloak', crafter: 'crafter', material: 'it_pelt0001' } });
    assert.deepEqual(drawn.warnings, []);
});

test('trade: away from a market only the line and the orders show, with nothing to collect', { skip }, () => {
    const state = makeState();
    state.domains.scene = { place: { name: 'The Old Road', kind: 'wilds', region: '' }, present: [] };
    const drawn = draw(tradeScreen, state);
    assert.deepEqual(drawn.warnings, []);
    assert.ok(drawn.el.querySelector('.market').classList.contains('closed'));
    assert.match(text(drawn.el.querySelector('.market .line')), /^No market here/);
    assert.deepEqual([buttons(drawn.el, 'trade.sell'), buttons(drawn.el, 'trade.buy'), buttons(drawn.el, 'craft.collect')], [[], [], []]);
    assert.equal(drawn.el.querySelector('.commission'), null);
    assert.match(text(drawn.el), /Skull Ring .*ready: collect at a market/);
});

test('hud: your HP and MP and condition badges; no checks wait (MODULES §F80)', { skip }, () => {
    const drawn = draw(hudScreen, makeState());
    assert.deepEqual(drawn.warnings, []);
    const strip = drawn.el.querySelector('.rb-hud');
    assert.equal(text(strip.querySelector('.nm')), 'Ren');
    assert.equal(text(strip.querySelector('.lv')), 'Lv 3 · 3 pts');
    assert.deepEqual(widgetsIn(strip, 'ss.meter').map(el => [propsOf(el).label, propsOf(el).value]), [['HP', { cur: 57, max: 82 }], ['MP', { cur: 30, max: 40 }]]);
    assert.deepEqual(widgetsIn(strip, 'ss.badge').map(el => propsOf(el).value.icon), ['fa-skull-crossbones', 'fa-droplet']);
    assert.deepEqual(widgetsIn(strip, 'ss.portrait').map(el => propsOf(el).size), ['sm']);
    assert.equal(strip.querySelector('.checks'), null);
    assert.equal(drawn.el.querySelector('.none-yet'), null);
    checkProps(drawn);
});

test('hud: before creation, one line saying what to do', { skip }, () => {
    const drawn = draw(hudScreen, emptyState());
    assert.deepEqual(drawn.warnings, []);
    assert.equal(all(drawn.el, 'ss-widget').length, 0);
    assert.match(text(drawn.el), /Create your character to begin the story\./);
});

test('status card: HP and MP of each member from that reply, and what this reply changed', { skip }, () => {
    const changes = ['/domains/party/actors/ac_ren00001/hp/cur', '/domains/party/actors/ac_ren00001/conditions/0', '/domains/inventory/stacks/it_tonic001/qty', '/domains/inventory/wallets/party/coin'];
    const drawn = draw(statusCardScreen, makeState(), { changes });
    assert.deepEqual(drawn.warnings, []);
    const members = all(drawn.el, '.member');
    assert.deepEqual(members.map(member => text(member.querySelector('.nm'))), ['Ren', 'Lyra']);
    const [ren, lyra] = members;
    assert.ok(ren.classList.contains('moved'));
    assert.ok(ren.classList.contains('you'));
    assert.ok(!lyra.classList.contains('moved'));
    const [hp, mp] = widgetsIn(ren, 'ss.meter');
    assert.deepEqual(propsOf(hp).value, { cur: 57, max: 82 });
    assert.ok(hp.classList.contains('hit'));
    assert.ok(!mp.classList.contains('hit'));
    assert.ok(!widgetsIn(lyra, 'ss.meter')[0].classList.contains('hit'));
    const conditions = all(ren, '.cond');
    assert.deepEqual(conditions.map(text), ['poisoned3', 'bleeding']);
    assert.deepEqual(conditions.map(node => node.classList.contains('new')), [true, false]);
    assert.deepEqual(all(drawn.el, '.changes .chg').map(text), ['Items', 'Coin']);
    assert.equal(drawn.el.querySelector('.calm'), null);
    checkProps(drawn);
});

test('status card: level-ups and skills are named; "only what changed" hides the rest', { skip }, () => {
    const changes = ['/domains/party/actors/ac_lyra0001/level', '/domains/party/actors/ac_lyra0001/xp', '/domains/party/actors/ac_lyra0001/skills/0'];
    const drawn = draw(statusCardScreen, makeState(), { changes, settings: { 'screens.cardOnlyChanged': true } });
    assert.deepEqual(drawn.warnings, []);
    const members = all(drawn.el, '.member');
    assert.deepEqual(members.map(member => text(member.querySelector('.nm'))), ['Lyra']);
    assert.deepEqual(all(members[0], '.chg').map(text), ['Lv 2', 'Skills']);
    assert.ok(drawn.el.querySelector('.rb-status').classList.contains('quiet'));
    assert.equal(drawn.el.querySelector('.changes'), null);
});

test('status card: the reply\'s checks with code\'s result and the mismatch flag; only on that reply', { skip }, () => {
    const drawn = draw(statusCardScreen, makeState(), { changes: ['/domains/checks/log/ck_aaaaaaaa'], settings: { cardOnlyChanged: true } });
    assert.deepEqual(drawn.warnings, []);
    assert.equal(all(drawn.el, '.member').length, 0);
    const [check] = all(drawn.el, '.checks .check');
    assert.equal(text(check.querySelector('.who')), 'Ren');
    assert.equal(text(check.querySelector('.txt')), 'stealth (slipping past the guard): Roll 1 = 12 + 0 = 12 against 20 (hard)');
    assert.equal(text(check.querySelector('.out')), 'fail');
    assert.ok(!check.classList.contains('pass'));
    assert.ok(check.classList.contains('off'));
    assert.equal(text(check.querySelector('.flag')), 'narrated as success, the dice say fail');
    assert.equal(drawn.el.querySelector('.calm'), null);
    // Another reply (that did not write these checks) does not show them.
    drawn.rerender(makeState(), ['/domains/party/actors/ac_lyra0001/mp']);
    assert.equal(all(drawn.el, '.checks .check').length, 0);
});

test('status card: the level and XP words are the chat\'s terms (party.terms)', { skip }, () => {
    const plain = draw(statusCardScreen, makeState(), { changes: ['/domains/party/actors/ac_ren00001/level'] });
    assert.match(text(plain.el.querySelector('.chg.up')), /^Lv\s*3$/);
    const terms = draw(statusCardScreen, makeState(), { changes: ['/domains/party/actors/ac_ren00001/level'], settings: { terms: { levelName: 'Soul Class', xpName: 'Soul Growth' } } });
    assert.match(text(terms.el.querySelector('.chg.up')), /^Soul Class\s*3$/);
    const xp = draw(statusCardScreen, makeState(), { changes: ['/domains/party/actors/ac_ren00001/xp'], settings: { terms: { levelName: 'Soul Class', xpName: 'Soul Growth' } } });
    assert.match(text(xp.el.querySelector('.tags .chg')), /^Soul Growth$/);
});

test('status card: a reply that changed nothing for the party says so; an older reply keeps its own marks', { skip }, () => {
    const drawn = draw(statusCardScreen, makeState(), { changes: ['/domains/scene/place'] });
    assert.deepEqual(drawn.warnings, []);
    assert.equal(all(drawn.el, '.member.moved').length, 0);
    assert.match(text(drawn.el.querySelector('.calm')), /Nothing changed for the party/);
    // The same screen for another reply, whose ops touched Lyra's MP.
    drawn.rerender(makeState(), ['/domains/party/actors/ac_lyra0001/mp']);
    assert.deepEqual(all(drawn.el, '.member.moved').map(member => text(member.querySelector('.nm'))), ['Lyra']);
    assert.equal(drawn.el.querySelector('.calm'), null);
});

test('status card: before creation', { skip }, () => {
    const drawn = draw(statusCardScreen, emptyState());
    assert.deepEqual(drawn.warnings, []);
    assert.equal(all(drawn.el, '.member').length, 0);
    assert.equal(text(drawn.el.querySelector('.none')), 'No character yet.');
});

test('every screen draws with Story Block\'s real standard widgets, none missing or failing', { skip: skip || (standard ? false : 'Story Block\'s widgets (src/v2/view/widgets/) were not found') }, () => {
    const changes = ['/domains/party/actors/ac_ren00001/hp/cur'];
    for (const screen of [partyScreen, itemsScreen, tradeScreen, hudScreen, statusCardScreen]) {
        const drawn = draw(screen, makeState(), { real: true, changes });
        assert.deepEqual(drawn.warnings, [], screen.id);
        assert.equal(drawn.el.querySelectorAll('.ss-widget-missing').length, 0, screen.id);
        const hosts = drawn.el.querySelectorAll('ss-widget');
        for (const host of hosts) assert.ok(host.querySelector('.ss-w'), `${screen.id}: ${host.getAttribute('name')} drew`);
    }
    const party = draw(partyScreen, makeState(), { real: true });
    const ren = party.el.querySelectorAll('article.actor')[0];
    assert.equal(ren.querySelector('.pool.hp .ss-w-meter').getAttribute('aria-valuetext'), '57 / 82');
    assert.deepEqual(ren.querySelectorAll('.ss-w-tree-skill').map(node => node.getAttribute('data-state')), ['active', 'active', 'learned', 'active', 'active']);
    assert.equal(ren.querySelectorAll('.ss-w-stepper').length, 7);
    assert.equal(ren.querySelectorAll('.ss-w-badge').length, 2);
});
