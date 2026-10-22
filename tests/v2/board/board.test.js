// The battle board widget (src/v2/board/widget.js, MODULES §F9) on a live fight: a session built with
// v1's startFight through combat.start and rebuilt with v1's replay for every view, drawn in the fake
// DOM. Its buttons send the combat part's own payloads, and the commands run on the fake bus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardOf, buttons, byAct, byText, enemyCards, labels, liveFight, mount } from './helpers.js';
import { actor } from '../combat/helpers/fake-ctx.js';
import { battleBoard, part, WIDGET_NAME, boardView } from '../../../src/v2/board/index.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

const viewOf = world => world.query('combat.session');
// What the board sent, without the fight id and log length it stamps every action with (checked once below).
const plain = sent => sent.map(([type, { session: _session, logLength: _length, board: _board, ...rest }]) => [type, rest]);

test('the part: the widget under its namespaced name, the board query, the Fight screen', () => {
    assert.equal(WIDGET_NAME, 'rpg-battle.battle-board');
    assert.equal(part.widgets['rpg-battle.battle-board'], battleBoard);
    assert.equal(typeof part.queries['combat.board'], 'function');
    assert.deepEqual(part.screens.map(screen => screen.id), ['rpg-battle/fight']);
    assert.deepEqual(Object.keys(part.domains), [], 'the board owns no state');
    assert.deepEqual(Object.keys(part.commands), [], 'and no command');
    assert.equal(battleBoard.primary, 'combatants');
    assert.deepEqual(Object.keys(battleBoard).sort(), ['primary', 'props', 'render', 'validate']);
    assert.deepEqual(battleBoard.validate({ combatants: [], round: '3', logLines: 6 }), []);
    assert.deepEqual(battleBoard.validate({ combatants: 'x', round: 'soon' }), ['The "combatants" setting should be a list.', 'The "round" setting should be a number.']);
    assert.deepEqual(battleBoard.validate({ value: { combatants: [] } }), [], 'a bound view is unfolded first');
});

test('renders a live combat.session view: both sides, meters, turn order, actions, log', () => {
    const world = liveFight();
    const session = viewOf(world);
    const { el, doc, root } = mount(world, { view: viewOf });
    const board = root();
    assert.equal(board.getAttribute('data-status'), 'active');
    assert.equal(board.getAttribute('aria-label'), 'Battle');
    assert.ok(doc.head.querySelector('style[data-rpg-bb]'), 'the stylesheet is added once');
    assert.ok(doc.head.querySelector('style[data-rpg-bb]').textContent.includes(':where(.rpg-bb-sides)'));

    // Enemies and party, each card with its name and meters.
    assert.deepEqual(enemyCards(el).map(card => card.querySelector('.rpg-bb-name').textContent), ['Cellar Rat A', 'Cellar Rat B', 'Cellar Rat C']);
    const ren = el.querySelector('.rpg-bb-card[data-side="party"]');
    assert.equal(ren.querySelector('.rpg-bb-name').textContent, 'Ren');
    assert.equal(ren.getAttribute('aria-current'), 'true', 'the acting member is marked');
    assert.ok(ren.classList.contains('rpg-bb-turn'));
    const meters = ren.querySelectorAll('.rpg-bb-meter');
    assert.deepEqual(meters.map(m => m.getAttribute('data-pool')), ['hp', 'mp', 'sp']);
    const pc = session.combatants.find(c => c.id === 'ac_00000001');
    assert.equal(meters[0].getAttribute('aria-valuetext'), `${pc.hp.cur} of ${pc.hp.max}`);
    assert.equal(meters[0].querySelector('.rpg-bb-meter-track').style.getPropertyValue('--rpg-bb-ratio'), String(Math.round((pc.hp.cur / pc.hp.max) * 10000) / 10000));
    assert.equal(enemyCards(el)[0].querySelectorAll('.rpg-bb-meter').length, 1, 'foes show HP only');
    // No ss.portrait lent: initials.
    assert.deepEqual(el.querySelectorAll('.rpg-bb-initials').map(node => node.textContent), ['CA', 'CB', 'CC', 'R']);
    // The session view's conditions are labels; they show as badges without a counter.
    assert.deepEqual(ren.querySelectorAll('.rpg-bb-cond').map(node => node.textContent), pc.conditions);

    // Turn order: the session's order, the current turn marked.
    const order = el.querySelectorAll('.rpg-bb-order-item');
    assert.equal(order.length, session.order.length);
    assert.equal(el.querySelector('.rpg-bb-order-item.rpg-bb-current').textContent, 'Ren');

    // The acting member's actions.
    assert.equal(el.querySelector('.rpg-bb-actor').textContent, 'Ren’s turn');
    assert.deepEqual(labels(el.querySelector('.rpg-bb-grid')), ['Attack', 'Skill', 'Item', 'Defend', 'Parley', `Flee ${Math.round(session.actions.fleeChance)}%`, 'Auto']);
    assert.equal(byAct(el, 'parley').disabled, true, 'rats do not talk');

    // The log: its last lines, round-tagged.
    const lines = el.querySelectorAll('.rpg-bb-log-line');
    assert.deepEqual(lines.map(li => li.querySelector('.rpg-bb-log-text').textContent), session.log.slice(-8).map(entry => entry.text));
    assert.match(lines[0].querySelector('.rpg-bb-log-round').textContent, /^R\d+$/);
});

test('the board query: the session view plus costs, cooldowns, condition turns and talkers', () => {
    const world = liveFight();
    const session = viewOf(world);
    const board = boardOf(world);
    for (const key of Object.keys(session)) if (!['combatants', 'actions'].includes(key)) assert.deepEqual(board[key], session[key], key);
    assert.equal(board.turns, 'timeline');
    assert.equal(board.turnIndex, 0);
    assert.equal(board.result, null);
    const strike = board.actions.skills.find(skill => skill.name === 'Power Strike');
    assert.deepEqual(strike, { name: 'Power Strike', usable: true, reason: null, target: 'one', type: 'physical', cost: 4, pool: 'sp', cooldown: 1, cooldownLeft: 0, mastery: 1 });
    for (const c of board.combatants) {
        assert.ok(c.conditions.every(cond => typeof cond.name === 'string' && typeof cond.label === 'string' && (cond.turns === null || Number.isInteger(cond.turns))));
        if (c.side === 'enemy') assert.equal(c.talks, false);
    }
    assert.equal(boardView({ domains: { combat: { session: null } } }), null, 'no fight, no board');
    // The query is a pure function of the State: the same state gives the same view.
    assert.deepEqual(boardOf(world), board);
});

test('condition badges carry their turns; ss.portrait is used when the host lends it', () => {
    const world = liveFight();
    const view = boardOf(world);
    view.combatants[0].conditions = [{ name: 'poison', label: 'poisoned', turns: 3 }, { name: 'guard', label: 'on guard', turns: 1 }];
    const drawn = [];
    const destroyed = [];
    const portrait = {
        render(slot, props) {
            drawn.push(props);
            slot.textContent = `[${props.name}]`;
            return { update: next => drawn.push({ updated: next.name }), destroy: () => destroyed.push(props.name) };
        },
    };
    const { el, handle } = mount(null, { extraApi: { widgets: { 'ss.portrait': portrait } } });
    handle.update({ value: view, portraits: { ac_00000001: 'https://img.example/ren.png' } });
    const conds = el.querySelectorAll('.rpg-bb-card[data-side="party"] .rpg-bb-cond');
    assert.deepEqual(conds.map(node => [node.getAttribute('data-kind'), node.textContent, node.getAttribute('aria-label'), node.classList.contains('rpg-bb-helpful')]), [
        ['poison', 'poisoned3', 'poisoned: 3 turns left', false],
        ['guard', 'on guard1', 'on guard: 1 turn left', true],
    ]);
    assert.deepEqual(drawn.map(props => props.name), ['Cellar Rat A', 'Cellar Rat B', 'Cellar Rat C', 'Ren']);
    assert.equal(drawn[3].src, 'https://img.example/ren.png');
    assert.equal(drawn[0].tone, 'bad');
    assert.equal(el.querySelectorAll('.rpg-bb-initials').length, 0);
    // A redraw updates the same portraits; one that leaves the fight is destroyed.
    handle.update({ value: { ...view, combatants: view.combatants.filter(c => c.name !== 'Cellar Rat C') } });
    assert.deepEqual(drawn.slice(4).map(entry => entry.updated), ['Cellar Rat A', 'Cellar Rat B', 'Ren']);
    assert.deepEqual(destroyed, ['Cellar Rat C']);
    handle.destroy();
    assert.deepEqual(destroyed.sort(), ['Cellar Rat A', 'Cellar Rat B', 'Cellar Rat C', 'Ren']);
});

test('action buttons send combat.act with the combat part\'s payloads', () => {
    const plays = [
        ['defend', { type: 'defend' }],
        ['flee', { type: 'flee' }],
        ['auto', { type: 'auto' }],
    ];
    for (const [kind, action] of plays) {
        const world = liveFight();
        const { el, sent } = mount(world);
        const shown = viewOf(world);
        byAct(el, kind).click();
        assert.deepEqual(plain(sent), [['combat.act', { action }]], kind);
        assert.deepEqual([sent[0][1].session, sent[0][1].board, sent[0][1].logLength], [shown.id, shown.board, shown.logLength], 'the action names the fight and the moment it was chosen for');
        assert.equal(world.receipts.at(-1).type, 'combat.act', `${kind} was played`);
        assert.deepEqual(sessionOf(world.state.domains.combat).actions.at(-1), action);
    }

    // Attack with three foes: pick one; the card is the button.
    const world = liveFight();
    const { el, sent } = mount(world);
    byAct(el, 'attack').click();
    assert.equal(sent.length, 0, 'aiming sends nothing yet');
    assert.equal(el.querySelector('.rpg-bb-picking-text').textContent, 'Attack: tap an enemy.');
    const target = enemyCards(el)[1];
    assert.equal(target.getAttribute('role'), 'button');
    assert.equal(target.getAttribute('aria-label'), 'Target Cellar Rat B');
    target.querySelector('.rpg-bb-name').click();
    assert.deepEqual(plain(sent), [['combat.act', { action: { type: 'attack', target: 'fo_00000002' } }]]);

    // A skill aimed at one enemy, from the Skill list (cost and cooldown shown); Enter picks the target.
    const w2 = liveFight();
    const m2 = mount(w2);
    byAct(m2.el, 'skill').click();
    assert.equal(byAct(m2.el, 'skill').getAttribute('aria-expanded'), 'true');
    const entry = m2.el.querySelector('.rpg-bb-menu-skill .rpg-bb-entry');
    assert.equal(entry.querySelector('.rpg-bb-entry-name').textContent, 'Power Strike');
    assert.equal(entry.querySelector('.rpg-bb-entry-meta').textContent, '4 SP · cooldown 1 · one enemy');
    entry.click();
    const third = enemyCards(m2.el)[2];
    third.dispatch('keydown', { key: 'Enter' });
    assert.deepEqual(plain(m2.sent), [['combat.act', { action: { type: 'skill', skill: 'Power Strike', target: 'fo_00000003' } }]]);
    assert.equal(w2.receipts.at(-1).type, 'combat.act');

    // An item for an ally: only Ren can take it, so it goes at once.
    const w3 = liveFight();
    const m3 = mount(w3);
    byAct(m3.el, 'item').click();
    const potion = m3.el.querySelector('.rpg-bb-menu-item .rpg-bb-entry');
    assert.equal(potion.querySelector('.rpg-bb-entry-meta').textContent, '×2 · one ally');
    potion.click();
    assert.deepEqual(plain(m3.sent), [['combat.act', { action: { type: 'item', item: 'Minor Healing Draught', target: 'ac_00000001' } }]]);
});

test('parley aims at the foes that talk, and a single target goes at once', () => {
    const world = liveFight('2 Bandits', { tier: 'even' });
    const view = boardOf(world);
    assert.ok(view.combatants.filter(c => c.side === 'enemy').every(c => c.talks === true));
    const { el, sent } = mount(world);
    const parley = byAct(el, 'parley');
    assert.equal(view.actions.canParley, true);
    assert.equal(parley.disabled, false);
    assert.equal(parley.textContent, `Parley ${Math.round(view.actions.parleyChance)}%`);
    parley.click();
    assert.equal(el.querySelector('.rpg-bb-picking-text').textContent, 'Parley: tap an enemy.');
    assert.equal(el.querySelectorAll('.rpg-bb-preview').length, 0, 'talking shows no damage');
    enemyCards(el)[1].click();
    assert.deepEqual(plain(sent), [['combat.act', { action: { type: 'parley', target: 'fo_00000002' } }]]);
    assert.equal(world.receipts.at(-1).type, 'combat.act');
    // One foe: Attack sends straight away (v1).
    const lone = liveFight('Giant Rat', { tier: 'weak' });
    const m = mount(lone);
    byAct(m.el, 'attack').click();
    assert.equal(m.sent.length, 1);
    assert.equal(m.sent[0][1].action.type, 'attack');
    assert.match(m.sent[0][1].action.target, /^fo_\d{8}$/);
});

test('target preview: aiming shows each foe what the strike would do; Cancel and Escape back out', () => {
    const world = liveFight();
    const view = boardOf(world);
    const { el, root, sent } = mount(world);
    assert.equal(el.querySelectorAll('.rpg-bb-preview').length, 0, 'no preview before aiming');
    byAct(el, 'attack').click();
    const previews = enemyCards(el).map(card => card.querySelector('.rpg-bb-preview').querySelectorAll('.rpg-bb-preview-part').map(part => part.textContent));
    const expected = view.actions.targets.enemies.map(id => {
        const p = view.actions.previews.attack[id];
        const tidy = n => String(Math.round(n * 10) / 10);
        return [`Hit ${tidy(p.hit)}%`, `${p.low === p.high ? p.low : `${p.low}–${p.high}`} dmg`, `Crit ${tidy(p.crit)}%`];
    });
    assert.deepEqual(previews, expected);
    assert.ok(root().classList.contains('rpg-bb-picking'));
    byText(el, 'Cancel').click();
    assert.equal(el.querySelectorAll('.rpg-bb-preview').length, 0);
    assert.equal(el.querySelectorAll('.rpg-bb-pickable').length, 0);

    // The skill's own numbers while aiming it.
    byAct(el, 'skill').click();
    el.querySelector('.rpg-bb-entry').click();
    const first = view.actions.targets.enemies[0];
    const p = view.actions.previews.skills['Power Strike'][first];
    assert.equal(enemyCards(el)[0].querySelector('[data-part="damage"]').textContent, `${p.low === p.high ? p.low : `${p.low}–${p.high}`} dmg`);
    root().dispatch('keydown', { key: 'Escape' });
    assert.equal(el.querySelectorAll('.rpg-bb-preview').length, 0, 'Escape leaves aiming');
    assert.equal(sent.length, 0);
});

test('a refused skill shows why; disabled buttons send nothing', () => {
    const world = liveFight();
    const view = boardOf(world);
    view.actions.skills = [{ ...view.actions.skills[0], usable: false, reason: 'cooldown', cooldownLeft: 2 }, { name: 'Fireball', usable: false, reason: 'mp', target: 'all', type: 'magic', cost: 12, pool: 'mp' }];
    view.actions.items = [];
    const { el, handle, sent } = mount(null);
    handle.update({ value: view });
    assert.equal(byAct(el, 'item').disabled, true);
    byAct(el, 'item').click();
    byAct(el, 'skill').click();
    const entries = el.querySelectorAll('.rpg-bb-entry');
    assert.deepEqual(entries.map(node => node.querySelector('.rpg-bb-entry-reason').textContent), ['Cooldown: 2 rounds', 'Not enough MP']);
    assert.equal(entries[1].querySelector('.rpg-bb-entry-meta').textContent, '12 MP · all enemies');
    entries.forEach(node => node.click());
    assert.deepEqual(sent, []);
});

test('the result: outcome, XP, loot, then Finish runs combat.end', () => {
    const world = liveFight();
    const { el, sent } = mount(world);
    for (let n = 0; n < 200 && sessionOf(world.state.domains.combat).status === 'active'; n++) {
        const attack = byAct(el, 'attack');
        assert.ok(attack, 'an Attack button while the fight is on');
        attack.click();
        const pickable = el.querySelector('.rpg-bb-pickable');
        if (pickable) pickable.click();
    }
    assert.equal(sessionOf(world.state.domains.combat).status, 'won');
    assert.ok(sent.every(([type, payload]) => type === 'combat.act' && payload.action.type === 'attack'));
    const view = boardOf(world);
    const result = el.querySelector('.rpg-bb-result');
    assert.equal(result.getAttribute('data-outcome'), 'won');
    assert.equal(result.querySelector('.rpg-bb-outcome').textContent, 'Victory');
    assert.equal(el.querySelector('.rpg-bb-actions'), null, 'no actions once it is over');
    assert.ok(view.result.xp.length >= 1);
    assert.deepEqual(result.querySelectorAll('.rpg-bb-gains dt').map(node => node.textContent), view.result.xp.filter(row => row.amount > 0).map(row => row.name));
    assert.deepEqual(result.querySelectorAll('.rpg-bb-gains dd').map(node => node.textContent), view.result.xp.filter(row => row.amount > 0).map(row => `+${row.amount} XP`));
    const loot = result.querySelectorAll('.rpg-bb-loot-name').map(node => node.textContent);
    const expected = [...(view.result.loot.money > 0 ? [`${view.result.loot.money} gold`] : []), ...view.result.loot.items.map(item => item.name)];
    assert.deepEqual(loot, expected);
    assert.ok(result.querySelector('.rpg-bb-defeated').textContent.startsWith('Defeated: '));

    // Finish settles the fight; what it applies is what the panel showed.
    const fightId = sessionOf(world.state.domains.combat).id;
    byText(el, 'Finish').click();
    assert.deepEqual(sent.at(-1), ['combat.end', { session: fightId }]);
    const ended = world.receipts.at(-1);
    assert.equal(ended.type, 'combat.end');
    assert.deepEqual(ended.data.loot.items.map(item => item.name), view.result.loot.items.map(item => item.name));
    assert.equal(ended.data.loot.money, view.result.loot.money);
    assert.deepEqual(Object.values(ended.data.xp), view.result.xp.map(row => row.amount));
    assert.equal(sessionOf(world.state.domains.combat), null);
    assert.equal(el.querySelector('.rpg-bb-empty').textContent, 'No fight under way.');
});

test('a lost fight and a fled one show their own title; the session view alone still gives a result', () => {
    const weak = actor(1, { level: 1, hp: { cur: 6, max: 6 }, stats: { STR: 3, VIT: 3, AGI: 3, DEX: 3, INT: 3, LUK: 3, CHA: 3 } });
    const world = liveFight('2 Cave Bears', { tier: 'deadly' }, { actors: [weak] });
    for (let n = 0; n < 200 && sessionOf(world.state.domains.combat).status === 'active'; n++) {
        const view = viewOf(world);
        assert.equal(world.run('combat.act', { action: { type: 'defend' } }).ok, true);
        if (!view) break;
    }
    assert.equal(sessionOf(world.state.domains.combat).status, 'lost');
    const { el } = mount(world, { view: viewOf });
    assert.equal(el.querySelector('.rpg-bb-outcome').textContent, 'Defeated');
    assert.ok(byText(el, 'Finish'));
    assert.equal(el.querySelectorAll('.rpg-bb-gains').length, 0, 'no XP rows from the bare session view');

    const { el: fled, handle } = mount(null);
    handle.update({ value: { ...boardOf(liveFight()), status: 'fled', result: { rounds: 2, xp: [], loot: { money: 0, items: [] } } } });
    assert.equal(fled.querySelector('.rpg-bb-outcome').textContent, 'Escaped');
    assert.equal(fled.querySelector('.rpg-bb-result .rpg-bb-hint').textContent, '2 rounds');
});

test('update keeps the reader\'s place: open list, aiming, log scroll, focus', () => {
    const world = liveFight();
    const { el, handle, root } = mount(world);
    const log = el.querySelector('.rpg-bb-log');
    const board = root();
    log.scrollTop = 37;
    byAct(el, 'attack').click();
    const cancel = byText(el, 'Cancel');
    cancel.focus();
    // The same fight again (a redraw from the host): nothing the reader did is lost.
    handle.update({ value: boardOf(world) });
    assert.equal(root(), board, 'the same root');
    assert.equal(el.querySelector('.rpg-bb-log'), log, 'the same log element');
    assert.equal(log.scrollTop, 37, 'scrolled up, it stays put');
    assert.equal(el.querySelectorAll('.rpg-bb-pickable').length, 3, 'still aiming');
    assert.equal(el.ownerDocument.activeElement.textContent, 'Cancel', 'focus is back on the same control');
    assert.notEqual(el.ownerDocument.activeElement, cancel, '(a new node)');

    // The skill list stays open over a redraw too.
    byText(el, 'Cancel').click();
    byAct(el, 'skill').click();
    handle.update({ value: boardOf(world) });
    assert.ok(el.querySelector('.rpg-bb-menu-skill'));

    // Once the fight moves on, the aim and the list are dropped; the scroll is kept.
    assert.equal(world.run('combat.act', { action: { type: 'defend' } }).ok, true);
    handle.update({ value: boardOf(world) });
    assert.equal(el.querySelector('.rpg-bb-menu'), null);
    assert.equal(el.querySelectorAll('.rpg-bb-pickable').length, 0);
    assert.equal(log.scrollTop, 37);

    // At the bottom, the log follows new lines (the fake log grows 40px a line).
    Object.defineProperty(log, 'scrollHeight', { get: () => 40 * log.childNodes.length, configurable: true });
    log.clientHeight = 100;
    log.scrollTop = log.scrollHeight - log.clientHeight;
    world.run('combat.act', { action: { type: 'defend' } });
    handle.update({ value: boardOf(world), logLines: 12 });
    assert.ok(log.childNodes.length > 8);
    assert.equal(log.scrollTop, log.scrollHeight);
});

test('while a command is out the board waits; a refusal gives the buttons back', async () => {
    const world = liveFight();
    let answer;
    const { el, handle } = mount(world);
    const sent = [];
    const api = { command: (type, payload) => { sent.push([type, payload]); return new Promise(resolve => { answer = resolve; }); } };
    el.replaceChildren();
    const board = battleBoard.render(el, { value: boardOf(world) }, api);
    handle.destroy();
    byAct(el, 'defend').click();
    byAct(el, 'defend').click();
    assert.equal(sent.length, 1, 'one action per answer');
    assert.equal(byAct(el, 'attack').disabled, true);
    answer({ ok: false, code: 'REFUSED', message: 'No.' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(byAct(el, 'attack').disabled, false);
    board.destroy();
});

test('without api.command the board is read-only; empty and bad props show an empty board', () => {
    const world = liveFight();
    const doc = mount(null).doc;
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const handle = battleBoard.render(el, { value: boardOf(world) }, {});
    assert.equal(el.querySelector('.rpg-bb-actions'), null);
    assert.equal(buttons(el).length, 0);
    assert.equal(el.querySelectorAll('.rpg-bb-card').length, 4);
    handle.update({ value: null });
    assert.equal(el.querySelector('.rpg-bb-empty').textContent, 'No fight under way.');
    assert.equal(el.querySelectorAll('.rpg-bb-card').length, 0);
    handle.update({ combatants: 'nope', round: {}, log: 7 });
    assert.equal(el.querySelector('.rpg-bb-empty').textContent, 'No fight under way.');
    // The whole view as `session`, the props beside it winning.
    handle.update({ session: boardOf(world), label: 'Cellar fight' });
    assert.equal(el.querySelector('.rpg-bb').getAttribute('aria-label'), 'Cellar fight');
    assert.equal(el.querySelectorAll('.rpg-bb-card').length, 4);
    handle.update({ value: boardOf(world), logLines: '2' });
    assert.equal(el.querySelectorAll('.rpg-bb-log-line').length, 2);
});

test('destroy removes the root and its listeners; later calls do nothing', () => {
    const world = liveFight();
    const { el, handle, root, sent } = mount(world);
    const board = root();
    const attack = byAct(el, 'attack');
    assert.equal(board.listeners.length, 2, 'one click and one keydown listener, on the root');
    assert.ok(el.querySelectorAll('*').every(node => node === board || node.listeners.length === 0), 'nothing else listens');
    handle.destroy();
    assert.equal(board.listeners.length, 0);
    assert.equal(el.querySelector('.rpg-bb'), null);
    attack.click();
    handle.update({ value: boardOf(world) });
    handle.destroy();
    assert.deepEqual(sent, []);
    assert.equal(el.childNodes.length, 0);
});

test('a name from the story is text, never markup or a class', () => {
    const world = liveFight();
    const view = boardOf(world);
    view.combatants[1].name = '<img src=x onerror=alert(1)>';
    view.combatants[1].conditions = [{ name: '"><b>x</b>', label: '<b>x</b>', turns: 2 }];
    view.log = [{ round: 1, text: '<script>alert(1)</script>', kind: 'hit" onclick="x', important: true }];
    const { el, handle } = mount(null);
    handle.update({ value: view });
    const card = enemyCards(el)[0];
    assert.equal(card.querySelector('.rpg-bb-name').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(card.querySelectorAll('img').length, 0);
    assert.equal(card.querySelector('.rpg-bb-cond').getAttribute('data-kind'), 'b-x-b');
    assert.equal(el.querySelector('.rpg-bb-log-line').getAttribute('data-kind'), 'hit-onclick-x');
    assert.ok(el.querySelectorAll('*').every(node => Object.keys(node.attributes).every(name => !/^on/i.test(name))));
});

test('no innerHTML or other markup parsing anywhere in the board', () => {
    const dir = new URL('../../../src/v2/board/', import.meta.url);
    const files = readdirSync(dir).filter(name => name.endsWith('.js'));
    assert.ok(files.length >= 5);
    for (const name of files) {
        const text = readFileSync(join(dir.pathname, name), 'utf8');
        for (const banned of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /DOMParser/, /createContextualFragment/, /\beval\(/, /new Function/, /setAttribute\(\s*['"]on/, /Math\.random/, /Date\.now/]) {
            assert.ok(!banned.test(text), `${name} uses ${banned}`);
        }
    }
});

test('the chat\'s terms (party.terms, MODULES §F25): level tags and XP rows use its words; plain Lv and XP without', () => {
    const world = liveFight();
    const terms = { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: null };
    // The board query carries party.terms when the tools have it.
    const tools = { query: name => (name === 'party.terms' ? terms : name === 'inventory.currency' ? { name: 'gold', short: 'g' } : null) };
    assert.deepEqual(boardView(world.state, {}, tools).terms, terms);
    assert.equal(boardOf(world).terms, null, 'no party part answering: no terms, plain words');
    const tagsOf = el => el.querySelectorAll('.rpg-bb-tag').map(node => node.textContent);
    const plain = mount(world);
    assert.ok(tagsOf(plain.el).includes('Lv 6'));
    const named = mount(world, { view: w => ({ ...boardOf(w), terms }) });
    assert.ok(tagsOf(named.el).includes('Soul Class 6'));
    assert.ok(!tagsOf(named.el).includes('Lv 6'));
    // Tiers: the tier title stands for the level.
    const tiered = mount(world, { view: w => ({ ...boardOf(w), terms: { ...terms, tiers: { size: 5, numerals: 'roman' } } }) });
    assert.ok(tagsOf(tiered.el).includes('Soul Class II'));
    // The result's XP rows.
    for (let n = 0; n < 200 && sessionOf(world.state.domains.combat).status === 'active'; n++) {
        byAct(named.el, 'attack').click();
        named.el.querySelector('.rpg-bb-pickable')?.click();
    }
    const won = mount(world, { view: w => ({ ...boardOf(w), terms }) });
    const rows = won.el.querySelectorAll('.rpg-bb-gains dd').map(node => node.textContent);
    assert.ok(rows.length >= 1);
    assert.ok(rows.every(text => /^\+\d+ Soul Growth$/.test(text)), rows.join(', '));
});

test('the board names a condition as the session view does, a daze included (stun rule: a second stun dazes)', async () => {
    const { CONDITION_LABELS } = await import('../../../src/v2/board/index.js');
    assert.equal(CONDITION_LABELS.daze, 'dazed');
    // The same words as the combat session view (src/v2/combat/view.js LABELS), key for key.
    const source = readFileSync(join(import.meta.dirname, '../../../src/v2/combat/view.js'), 'utf8');
    const literal = source.match(/const LABELS = (\{[^}]*\});/)[1];
    const session = Object.fromEntries([...literal.matchAll(/(\w+): '([^']*)'/g)].map(([, key, word]) => [key, word]));
    assert.deepEqual({ ...CONDITION_LABELS }, Object.fromEntries(Object.keys(CONDITION_LABELS).map(key => [key, session[key]])));
    assert.deepEqual(Object.keys(session).sort(), Object.keys(CONDITION_LABELS).sort());
});
