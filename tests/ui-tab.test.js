// The Battle tab against the fake DOM: every mode of the contract table (create, idle,
// spend, learn, setup, fight, result), the handlers each one calls and with what, and the
// transient state (drafts, the action being aimed) that must survive a redraw.
//
// View fixtures are built by hand from docs/ARCHITECTURE.md's shapes rather than imported
// from combat/sheet/skills, so these tests pin the tab to the contract, not to whatever
// those modules happen to return today.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from './ui-fake-dom.js';
import { DEFAULT_RULES, STATS, maxHp, xpToNext } from '../src/rules.js';

const doc = installFakeDom();
const { renderBattleTab } = await import('../src/ui/tab.js');

const rules = DEFAULT_RULES;

// ---------------------------------------------------------------------------
// Fixtures

function skill(name, over = {}) {
    return {
        name, tier: 1, type: 'physical', stat: 'STR', power: 1.2, mp: 4, cooldown: 0,
        target: 'one', effect: null, requires: null, description: `${name} description`, ...over,
    };
}

const LIBRARY = [
    skill('Power Strike', { mp: 5, cooldown: 1 }),
    skill('Quick Jab', { mp: 2 }),
    skill('Spark', { type: 'magic', stat: 'INT', mp: 4 }),
    skill('Mend', { type: 'heal', stat: 'INT', mp: 6, target: 'ally' }),
    skill('Guard Up', { type: 'buff', stat: 'VIT', mp: 3, target: 'self' }),
];

const TIER2 = [
    skill('Fireball', { tier: 2, type: 'magic', stat: 'INT', mp: 12, target: 'all', requires: { INT: 8 } }),
    skill('Rending Strike', { tier: 2, mp: 6, cooldown: 2, requires: { STR: 7 } }),
];

const PRESETS = [
    { id: 'fighter', name: 'Fighter', points: { STR: 4, VIT: 3, AGI: 1, DEX: 2 }, skills: ['Power Strike', 'Quick Jab', 'Guard Up'] },
    { id: 'caster', name: 'Caster', points: { INT: 6, VIT: 2, DEX: 2 }, skills: ['Spark', 'Mend', 'Not In Library'] },
];

function stats(over = {}) {
    return { STR: 9, VIT: 7, AGI: 8, DEX: 8, INT: 4, LUK: 5, CHA: 6, ...over };
}

function sheet(over = {}) {
    return {
        name: 'Ren', level: 4, xp: 310, points: 2,
        hp: { cur: 58, max: 62 }, mp: { cur: 21, max: 30 },
        stats: stats(),
        skills: [{ name: 'Rending Strike', mastery: 2 }, { name: 'Quick Jab', mastery: 1 }],
        conditions: [],
        uses: {},
        ...over,
    };
}

function unit(id, side, over = {}) {
    return {
        id, name: id, side, controller: side === 'party' ? 'player' : 'auto',
        level: 3, rank: side === 'enemy' ? 'E' : null, role: side === 'enemy' ? 'brute' : null, boss: false,
        stats: stats(), hp: { cur: 40, max: 50 }, mp: { cur: 10, max: 20 },
        patk: 18, matk: 8, pdef: 7, mdef: 6, crit: 12,
        skills: [], items: [], conditions: [],
        morale: side === 'enemy' ? 4 : 0, talks: false, fleesBelow: side === 'enemy' ? 0.25 : 0,
        xp: 35, loot: null, gone: null, memberId: side === 'party' ? id : null,
        ...over,
    };
}

function fightView(over = {}, actionsOver = {}) {
    const ren = unit('pc', 'party', {
        name: 'Ren',
        skills: [
            { ...skill('Power Strike', { mp: 5, cooldown: 1 }), mastery: 2, cooldownLeft: 0 },
            { ...skill('Mend', { type: 'heal', mp: 6, target: 'one' }), mastery: 1, cooldownLeft: 0 },
            { ...skill('Whirl', { mp: 8, target: 'all' }), mastery: 1, cooldownLeft: 0 },
            { ...skill('Rending Strike', { mp: 6, cooldown: 2 }), mastery: 1, cooldownLeft: 2 },
        ],
        items: [
            { name: 'Healing Draught', qty: 2, effect: { heal: 30 } },
            { name: 'Ember Flask', qty: 1, effect: { damage: { amount: 25, element: 'fire', target: 'all' } } },
        ],
    });
    const astra = unit('astra', 'party', { name: 'Astra', controller: 'auto', conditions: [{ name: 'regen', rounds: 2, power: 3 }] });
    const goblin = unit('e1', 'enemy', { name: 'Goblin', conditions: [{ name: 'poison', rounds: 2, power: 3 }] });
    const shaman = unit('e2', 'enemy', { name: 'Goblin Shaman', role: 'caster', talks: true });
    const wolf = unit('e3', 'enemy', { name: 'Wolf', gone: 'fled', hp: { cur: 10, max: 40 } });
    const log = Array.from({ length: 11 }, (_, i) => ({ round: 1 + Math.floor(i / 4), actor: 'pc', text: `line ${i + 1}`, kind: i === 10 ? 'crit' : 'hit', important: i === 10 }));
    const fight = {
        id: 'f1', seed: 7, stakes: 'normal', round: 3, status: 'active',
        order: ['pc', 'e1', 'astra', 'e2', 'e3'], turn: 0,
        combatants: [ren, astra, goblin, shaman, wolf],
        log, actions: [], rngState: 1, setup: {}, stats: {},
        ...over,
    };
    const actions = {
        actor: fight.combatants.find(entry => entry.id === 'pc'),
        targets: { enemies: ['e1', 'e2'], allies: ['pc', 'astra'] },
        skills: [
            { name: 'Power Strike', usable: true, reason: null, target: 'one' },
            { name: 'Mend', usable: true, reason: null, target: 'one' },
            { name: 'Whirl', usable: true, reason: null, target: 'all' },
            { name: 'Rending Strike', usable: false, reason: 'cooldown', target: 'one' },
        ],
        items: [{ name: 'Healing Draught', qty: 2, target: 'one' }, { name: 'Ember Flask', qty: 1, target: 'all' }],
        canParley: true, parleyChance: 45,
        canFlee: true, fleeChance: 62,
        ...actionsOver,
    };
    return { mode: 'fight', fight, actions };
}

function result(over = {}) {
    return {
        outcome: 'victory', rounds: 4, seconds: 24, stakes: 'normal',
        party: [
            { memberId: 'pc', name: 'Ren', hp: { cur: 34, max: 62 }, mp: { cur: 12, max: 30 }, down: false, conditions: [] },
            { memberId: 'astra', name: 'Astra', hp: { cur: 0, max: 44 }, mp: { cur: 20, max: 38 }, down: true, conditions: [{ name: 'poison', rounds: 3 }] },
        ],
        enemies: [], defeated: ['Goblin'], fled: [], parleyed: [],
        xp: { pc: 38, astra: 38 },
        loot: { items: [{ name: 'Bone Fetish', qty: 1, rarity: 'uncommon', kind: 'material' }, { name: 'Goblin Ear', qty: 3, rarity: 'common', kind: 'material' }], money: 14 },
        keyMoments: ['Ren crit the second goblin.', 'One goblin fled toward the weir.'],
        uses: {}, itemsUsed: {},
        ...over,
    };
}

// ---------------------------------------------------------------------------
// Helpers

function render(view, handlers = {}) {
    const pane = doc.createElement('div');
    doc.body.appendChild(pane);
    renderBattleTab(pane, view, handlers);
    return pane;
}

// The tab redraws itself for local state; always query the pane's current root.
const root = pane => pane.firstElementChild;
const $ = (pane, selector) => root(pane).querySelector(selector);
const $$ = (pane, selector) => root(pane).querySelectorAll(selector);
const buttonByText = (pane, label) => $$(pane, 'button').find(node => node.textContent.trim() === label) ?? null;
const buttonStarting = (pane, label) => $$(pane, 'button').find(node => node.textContent.trim().startsWith(label)) ?? null;
const stepRow = (pane, stat) => $$(pane, '.rpg-battle-stepper').find(row => row.dataset.stat === stat);
const plus = (pane, stat) => stepRow(pane, stat).querySelector('.rpg-battle-step.is-plus');
const minus = (pane, stat) => stepRow(pane, stat).querySelector('.rpg-battle-step.is-minus');
const valueOf = (pane, stat) => stepRow(pane, stat).querySelector('.rpg-battle-stepper-value').textContent;
const factValue = (pane, label) => {
    const terms = $$(pane, '.rpg-battle-preview dt');
    const term = terms.find(node => node.textContent === label);
    return term?.nextElementSibling?.textContent ?? null;
};
const card = (pane, id) => $$(pane, '.rpg-battle-card').find(node => node.dataset.combatantId === id);

function recorder() {
    const calls = [];
    const handlers = new Proxy({}, {
        get: (_, name) => (...args) => { calls.push({ name, args }); },
        has: () => true,
    });
    return { calls, handlers, last: name => calls.filter(call => call.name === name).at(-1) ?? null };
}

// A different mode in between drops every draft, so tests start clean: one of each tab's
// (the Party tab's idle, the Battle tab's offer), since a mode drops only its own tab's drafts.
const reset = () => {
    render({ mode: 'offer', encounter: null });
    return render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules });
};

// ---------------------------------------------------------------------------
// create

test('create: seven steppers at the start value, a points budget, and minus/plus limits', () => {
    reset();
    const pane = render({ mode: 'create', presets: PRESETS, library: LIBRARY, rules });
    assert.equal($$(pane, '.rpg-battle-stepper').length, STATS.length);
    for (const stat of STATS) {
        assert.equal(valueOf(pane, stat), String(rules.character.startStat));
        assert.equal(minus(pane, stat).disabled, true, `${stat} cannot go below the start`);
    }
    assert.match($(pane, '.rpg-battle-remaining').textContent, /^10 of 10 points left/);
    for (let i = 0; i < 10; i += 1) plus(pane, 'STR').click();
    assert.equal(valueOf(pane, 'STR'), '15');
    assert.match($(pane, '.rpg-battle-remaining').textContent, /^0 of 10/);
    assert.equal(plus(pane, 'VIT').disabled, true, 'over budget is impossible');
    plus(pane, 'VIT').click();
    assert.equal(valueOf(pane, 'VIT'), '5');
    minus(pane, 'STR').click();
    assert.equal(valueOf(pane, 'STR'), '14');
    assert.equal(plus(pane, 'VIT').disabled, false);
    assert.equal($(pane, '.rpg-battle-create').disabled, true);
});

test('create: no stray "null" text when no import is waiting', () => {
    reset();
    const pane = render({ mode: 'create', presets: [], library: [], persona: 'Ren', rules });
    assert.ok(!/null/.test(root(pane).textContent), 'append() writes a null as text');
});

test('create: stats only, the points by hand; onCreate gets the name and the stats', () => {
    reset();
    const { handlers, last } = recorder();
    const pane = render({ mode: 'create', rules }, handlers);
    assert.equal($$(pane, '.rpg-battle-preset').length, 0, 'no class presets since 0.4');
    assert.equal($$(pane, '.rpg-battle-skill-pick').length, 0, 'no starter skills: they come from the story');
    assert.match($(pane, '.rpg-battle-section.is-create-intro').textContent, /Skills come from the story/);
    for (let i = 0; i < 4; i += 1) plus(pane, 'STR').click();
    for (let i = 0; i < 3; i += 1) plus(pane, 'VIT').click();
    plus(pane, 'AGI').click();
    plus(pane, 'DEX').click();
    plus(pane, 'DEX').click();
    assert.match($(pane, '.rpg-battle-remaining').textContent, /^0 of 10/);
    // Live preview from rules: VIT 8 at level 1.
    assert.equal(factValue(pane, 'Max HP'), String(maxHp({ VIT: 8 }, 1, rules)));
    assert.equal(factValue(pane, 'Attack'), '18');
    assert.equal($(pane, '.rpg-battle-create').disabled, true, 'no name yet');
    const name = $(pane, '.rpg-battle-name-input');
    name.value = '  Ren  ';
    name.dispatch('input');
    assert.equal($(pane, '.rpg-battle-create-hint').textContent, 'Ready.');
    assert.equal($(pane, '.rpg-battle-create').disabled, false);
    $(pane, '.rpg-battle-create').click();
    assert.deepEqual(last('onCreate').args[0], { name: 'Ren', stats: { STR: 9, VIT: 8, AGI: 6, DEX: 7, INT: 5, LUK: 5, CHA: 5 } });
    // A party file can be imported from here too.
    assert.ok($(pane, '.rpg-battle-party-import'));
});

test('create: the name starts as the persona\'s, with a hint, and follows a persona switch until typed over', () => {
    reset();
    const view = persona => ({ mode: 'create', presets: PRESETS, library: LIBRARY, persona, rules });
    let pane = render(view('  Ren  '));
    const name = () => $(pane, '.rpg-battle-name-input');
    const hint = () => $(pane, '.rpg-battle-name-hint');
    assert.equal(name().value, 'Ren', 'trimmed');
    assert.equal(hint().hidden, false);
    assert.equal(hint().textContent, 'From your persona; change it if your character goes by another name.');
    assert.doesNotMatch($(pane, '.rpg-battle-create-hint').textContent, /a name/, 'the name is already there');
    // The reader switched persona before typing anything: the name follows.
    pane = render(view('Astra'));
    assert.equal(name().value, 'Astra');
    assert.equal(hint().hidden, false);
    pane = render(view('User'));
    assert.equal(name().value, 'User', 'the default persona is still the persona\'s name');
    // Typed over: theirs from then on, through redraws and persona switches.
    name().value = 'Kael';
    name().dispatch('input');
    assert.equal(hint().hidden, true);
    pane = render(view('Mira'));
    assert.equal(name().value, 'Kael');
    assert.equal(hint().hidden, true);
    name().value = '';
    name().dispatch('input');
    pane = render(view('Mira'));
    assert.equal(name().value, '', 'cleared by hand stays cleared');
});

test('create: no persona leaves the name empty and the hint hidden', () => {
    for (const persona of [undefined, '', '   ']) {
        reset();
        const pane = render({ mode: 'create', presets: PRESETS, library: LIBRARY, persona, rules });
        assert.equal($(pane, '.rpg-battle-name-input').value, '', String(persona));
        assert.equal($(pane, '.rpg-battle-name-hint').hidden, true);
        assert.match($(pane, '.rpg-battle-create-hint').textContent, /a name/);
    }
    // A persona arriving later still fills an untouched name.
    const pane = render({ mode: 'create', presets: PRESETS, library: LIBRARY, persona: 'Ren', rules });
    assert.equal($(pane, '.rpg-battle-name-input').value, 'Ren');
});

test('create: the draft survives a redraw and is dropped on leaving; another tab drawing in between keeps it', () => {
    reset();
    const view = { mode: 'create', rules };
    const pane = render(view);
    for (let i = 0; i < 6; i += 1) plus(pane, 'INT').click();
    assert.match($(pane, '.rpg-battle-create-hint').textContent, /a name, 4 more points/);
    // The glue redraws on chat events: the half-made character is still there.
    renderBattleTab(pane, view, {});
    assert.equal(valueOf(pane, 'INT'), '11');
    // The Battle tab drawing meanwhile does not touch the Party tab's draft.
    render({ mode: 'offer', encounter: { text: '2 wolf', rows: [] } });
    renderBattleTab(pane, view, {});
    assert.equal(valueOf(pane, 'INT'), '11');
    // Leaving the mode drops the draft.
    renderBattleTab(pane, { mode: 'idle', sheet: sheet(), rules }, {});
    renderBattleTab(pane, view, {});
    assert.equal(valueOf(pane, 'INT'), '5');
});

test('idle: the party as cards, yours first and open; header, bars, stats with checks, skills and the main buttons', () => {
    const { handlers, calls } = recorder();
    const party = [{ id: 'astra', name: 'Astra', role: 'companion', control: 'auto', sheet: sheet({ name: 'Astra', level: 3, hp: { cur: 30, max: 44 } }), gear: [] },
        { id: 'merrit', name: 'Merrit', role: 'hireling', control: 'command', sheet: sheet({ name: 'Merrit', level: 2 }), gear: [] }];
    const resolved = [{ ...skill('Rending Strike', { mp: 6, cooldown: 2 }), mastery: 2 }, { ...skill('Quick Jab', { mp: 2 }), mastery: 1 }];
    const checks = { STR: 2, VIT: 1, AGI: 1, DEX: 1, INT: -1, LUK: 0, CHA: 0 };
    const pane = render({ mode: 'idle', chatId: 'c1', sheet: sheet({ conditions: [{ name: 'poison', rounds: 2 }] }), checks, skills: resolved, party, rules, pending: null }, handlers);

    const cards = $$(pane, '.rpg-battle-member-card');
    assert.deepEqual(cards.map(node => [node.dataset.memberId, node.open]), [['pc', true], ['astra', false], ['merrit', false]], 'yours open, companions folded');
    const you = cards[0];
    assert.equal(you.querySelector('.rpg-battle-head-name').textContent, 'Ren');
    assert.equal(you.querySelector('.rpg-battle-level').textContent, 'Level 4');
    // Folded: name, level, HP and MP, State; the XP bar and the rest are inside.
    const summary = you.querySelector('.rpg-battle-member-summary');
    assert.deepEqual(summary.querySelectorAll('[role="progressbar"]').map(node => [node.getAttribute('aria-valuenow'), node.getAttribute('aria-valuemax')]), [['58', '62'], ['21', '30']]);
    assert.equal(summary.querySelector('.rpg-battle-state').textContent, 'unhurt · poisoned');
    const body = you.querySelector('.rpg-battle-member-body');
    assert.equal(body.querySelector('[role="progressbar"]').getAttribute('aria-valuemax'), String(xpToNext(4, rules)));
    assert.equal(summary.querySelector('[role="progressbar"] .rpg-battle-bar-fill').style.width, '94%');
    assert.deepEqual(texts(you, '.rpg-battle-chip'), ['poison 2']);

    const stat = name => you.querySelectorAll('.rpg-battle-stat').find(node => node.dataset.stat === name);
    assert.equal(stat('STR').querySelector('.rpg-battle-stat-value').textContent, '9');
    assert.equal(stat('STR').querySelector('.rpg-battle-stat-check').textContent, '+2');
    assert.equal(stat('INT').querySelector('.rpg-battle-stat-check').textContent, '-1');
    assert.equal(cards[1].querySelector('.rpg-battle-stat-check'), null, 'checks are for your own rolls');

    assert.equal(you.querySelector('.rpg-battle-points-text').textContent, '2 unspent points');
    assert.deepEqual(texts(you, '.rpg-battle-skill .rpg-battle-record-name'), ['Rending Strike', 'Quick Jab']);
    assert.match(you.querySelector('.rpg-battle-skill .rpg-battle-record-meta').textContent, /physical · 6 MP · cooldown 2/);
    assert.equal(you.querySelector('.rpg-battle-skill .rpg-battle-tag').textContent, 'Lv 2');
    assert.equal(you.querySelector('.rpg-battle-skill-count').textContent, '2/6');

    assert.deepEqual(texts(root(pane), '.rpg-battle-member .rpg-battle-member-name'), ['Astra', 'Merrit']);
    assert.deepEqual(texts(root(pane), '.rpg-battle-member .rpg-battle-control'), ['Acts on its own', 'You command']);
    assert.equal($(pane, '.rpg-battle-member [role="progressbar"]').getAttribute('aria-valuenow'), '30');

    assert.equal($(pane, '.rpg-battle-notice'), null, 'no pending notice');
    // Fights, skills, companions and rests come from the story: no buttons for them here.
    for (const gone of ['.rpg-battle-start', '.rpg-battle-learn', '.rpg-battle-learn-member', '.rpg-battle-add-companion', '.rpg-battle-rest-short', '.rpg-battle-rest-long', '.rpg-battle-encounter-fight']) assert.equal($(pane, gone), null, gone);
    you.querySelector('.rpg-battle-spend').click();
    $(pane, '.rpg-battle-items').click();
    assert.deepEqual(calls.map(call => [call.name, ...call.args]), [['onSpend', 'pc'], ['onItems']]);
});

test('idle: which cards are open survives redraws, per chat', () => {
    reset();
    const party = [{ id: 'astra', name: 'Astra', role: 'healer', control: 'auto', sheet: sheet({ name: 'Astra' }), gear: [] }];
    const view = chatId => ({ mode: 'idle', chatId, sheet: sheet(), skills: [], party, rules });
    let pane = render(view('c2'));
    const card = id => $$(pane, '.rpg-battle-member-card').find(node => node.dataset.memberId === id);
    card('astra').open = true;
    card('astra').dispatch('toggle');
    card('pc').open = false;
    card('pc').dispatch('toggle');
    pane = render(view('c2'));
    assert.deepEqual([card('pc').open, card('astra').open], [false, true]);
    pane = render(view('c3'));
    assert.deepEqual([card('pc').open, card('astra').open], [true, false], 'another chat starts as usual');
});

test('idle: the State words sit quietly under the HP and MP bars', () => {
    let pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules });
    const state = $(pane, '.rpg-battle-member-card.is-you .rpg-battle-state');
    assert.equal(state.textContent, 'unhurt');
    assert.equal(state.tagName.toLowerCase(), 'p');
    assert.match(state.className, /rpg-battle-hint/);
    const kids = $(pane, '.rpg-battle-member-card.is-you .rpg-battle-member-summary').children;
    const index = kids.indexOf(state);
    assert.equal(kids[index - 1].getAttribute('aria-label'), 'MP', 'right under the MP bar');
    pane = render({ mode: 'idle', sheet: sheet({ hp: { cur: 15, max: 62 }, mp: { cur: 3, max: 30 }, conditions: [{ name: 'poison', rounds: 2 }] }), skills: [], party: [], rules });
    assert.equal($(pane, '.rpg-battle-state').textContent, 'badly hurt (bleeding, slow to move) · drained of magic · poisoned');
    pane = render({ mode: 'idle', sheet: sheet({ hp: { cur: 0, max: 62 } }), skills: [], party: [], rules });
    assert.equal($(pane, '.rpg-battle-state').textContent, 'down (unconscious or unable to fight)');
});

test('idle: the recovered note, Use item, a companion\'s control and two-click Remove', () => {
    const { handlers, calls } = recorder();
    const party = [{ id: 'astra', name: 'Astra', role: 'companion', control: 'auto', sheet: sheet({ name: 'Astra', level: 3 }), gear: [] }];
    let pane = render({ mode: 'idle', sheet: sheet({ name: 'Ren', level: 4 }), skills: [], party, rules, recovered: '8 hours passed: Ren is fully rested.' }, handlers);
    assert.match($(pane, '.rpg-battle-recovered').textContent, /fully rested/);
    $(pane, '.rpg-battle-items').click();
    $(pane, '.rpg-battle-member .rpg-battle-control').click();
    assert.deepEqual(calls.map(call => [call.name, ...call.args]), [['onItems'], ['onSetControl', 'astra', 'command']]);
    $(pane, '.rpg-battle-remove-companion').click();
    assert.match($(pane, '.rpg-battle-remove-companion').textContent, /Click again/);
    $(pane, '.rpg-battle-remove-companion').click();
    assert.deepEqual(calls.at(-1).name, 'onRemoveCompanion');
    assert.deepEqual(calls.at(-1).args, ['astra']);
});

test('items: usable consumables on you or a companion; fight-only ones disabled', () => {
    const { handlers, calls } = recorder();
    const party = [{ id: 'astra', name: 'Astra', role: 'companion', control: 'auto', sheet: sheet({ name: 'Astra' }), gear: [] }];
    const items = [
        { name: 'Healing Draught', qty: 2, effect: { heal: 30 } },
        { name: 'Ember Flask', qty: 1, effect: { damage: { amount: 25, element: 'fire', target: 'all' } } },
    ];
    const pane = render({ mode: 'items', sheet: sheet({ name: 'Ren' }), party, items, rules }, handlers);
    const rows = root(pane).querySelectorAll('.rpg-battle-use-item');
    assert.match(rows[0].textContent, /heals 30/);
    assert.ok(rows[1].querySelector('.rpg-battle-use').disabled, 'a fire flask is for fights');
    const who = $(pane, '.rpg-battle-item-target');
    who.value = 'astra';
    who.dispatch('change');
    rows[0].querySelector('.rpg-battle-use').click();
    assert.deepEqual(calls.at(-1), { name: 'onUseItem', args: [{ name: 'Healing Draught', target: 'astra' }] });
});

test('companion: from a Joins offer, name, role, level, focus (from the role), the generated skills, control and equipment go to onAddCompanion', () => {
    reset();
    const { handlers, calls } = recorder();
    const kit = { key: 'k1', status: 'ready', note: 'From the model.', skills: [
        { name: 'Frost Lance', words: 'a spear of ice', type: 'magic', stat: 'INT', target: 'one', element: 'ice' },
        { name: 'Mend', words: 'closes wounds', type: 'heal', stat: 'INT', target: 'ally', element: 'none', library: true },
    ] };
    const view = over => ({ mode: 'companion', level: 4, maxLevel: 20, rules, prefill: { name: 'Astra', role: 'court wizard', level: 6 }, kit, ...over });
    let pane = render(view(), handlers);
    assert.equal($$(pane, '.rpg-battle-companion-preset').length, 0, 'no class presets');
    assert.equal($(pane, '.rpg-battle-companion-name').value, 'Astra');
    assert.equal($(pane, '.rpg-battle-companion-level').value, '6');
    const focus = () => $$(pane, '.rpg-battle-companion-focus').map(node => node.value);
    assert.deepEqual(focus(), ['INT', 'DEX', ''], 'role words fill in the focus');
    assert.match($(pane, '.rpg-battle-companion-stats').textContent, /INT 2[0-9]/);
    assert.deepEqual(texts(root(pane), '.rpg-battle-kit-skill .rpg-battle-record-name'), ['Frost Lance', 'Mend']);
    assert.match($(pane, '.rpg-battle-kit-skill .rpg-battle-record-meta').textContent, /magic · INT · one enemy · ice/);
    // The reader changes the focus by hand; a role edited later no longer moves it.
    const first = $$(pane, '.rpg-battle-companion-focus')[0];
    first.value = 'STR';
    first.dispatch('change');
    const role = $(pane, '.rpg-battle-companion-role');
    role.value = 'healer';
    role.dispatch('input');
    assert.deepEqual(focus(), ['STR', 'DEX', '']);
    // A skill left out; Generate again asks the glue anew.
    $$(pane, '.rpg-battle-kit-remove')[1].click();
    assert.deepEqual(texts(root(pane), '.rpg-battle-kit-skill .rpg-battle-record-name'), ['Frost Lance']);
    $(pane, '.rpg-battle-kit-again').click();
    assert.deepEqual(calls.at(-1), { name: 'onGenerateKit', args: [{ name: 'Astra', role: 'healer', level: 6, focus: ['STR', 'DEX'], npcId: null, summary: '' }] });
    const control = $(pane, '.rpg-battle-companion-control');
    control.value = 'command';
    control.dispatch('change');
    const gear = $(pane, '.rpg-battle-companion-gear');
    gear.value = 'Ashwood Staff (rare) · MATK +7';
    gear.dispatch('input');
    $(pane, '.rpg-battle-companion-add').click();
    assert.deepEqual(calls.at(-1), { name: 'onAddCompanion', args: [{ name: 'Astra', role: 'healer', control: 'command', level: 6, focus: ['STR', 'DEX'], skills: [kit.skills[0]], gearLines: 'Ashwood Staff (rare) · MATK +7', npcId: null }] });
    // While the skills are being worked out, Add waits; a new kit replaces the draft's.
    pane = render(view({ kit: { key: 'k2', status: 'working', skills: [] } }), handlers);
    assert.equal($(pane, '.rpg-battle-companion-add').disabled, true);
    assert.equal($(pane, '.rpg-battle-kit-again').disabled, true);
    pane = render(view({ kit: { key: 'k3', status: 'ready', skills: [kit.skills[1]] } }), handlers);
    assert.deepEqual(texts(root(pane), '.rpg-battle-kit-skill .rpg-battle-record-name'), ['Mend']);
    assert.equal($(pane, '.rpg-battle-companion-add').disabled, false);
});

test('companion: a story\'s Joins prefills the form; NPC State Delta\'s profiles fill it in and keep the link', () => {
    reset();
    const { handlers, last } = recorder();
    const npcs = [
        { id: 'n1', name: 'Bram', present: false, role: 'blacksmith', summary: 'A smith.' },
        { id: 'n2', name: 'Lyra Vance', present: true, role: '', summary: 'A wandering cleric who mends the sick.' },
    ];
    let pane = render({ mode: 'companion', level: 4, maxLevel: 20, rules, prefill: { name: 'Lyra', role: 'healer', level: 6 }, npcs, kit: { key: 'a', status: 'ready', skills: [] } }, handlers);
    assert.ok($(pane, '.rpg-battle-prefill-hint'));
    assert.equal($(pane, '.rpg-battle-companion-name').value, 'Lyra');
    assert.equal($(pane, '.rpg-battle-companion-level').value, '6');
    assert.deepEqual($$(pane, '.rpg-battle-companion-focus').map(node => node.value), ['INT', 'VIT', 'CHA']);
    const picker = $(pane, '.rpg-battle-companion-npc');
    assert.deepEqual(picker.querySelectorAll('option').map(node => node.value), ['', 'n2', 'n1'], 'present NPCs first');
    picker.value = 'n2';
    picker.dispatch('change');
    assert.equal($(pane, '.rpg-battle-companion-name').value, 'Lyra Vance');
    assert.deepEqual($$(pane, '.rpg-battle-companion-focus').map(node => node.value), ['INT', 'VIT', 'CHA'], 'the summary\'s words when the role is empty');
    assert.deepEqual(last('onGenerateKit').args[0], { name: 'Lyra Vance', role: 'healer', level: 6, focus: ['INT', 'VIT', 'CHA'], npcId: 'n2', summary: 'A wandering cleric who mends the sick.' }, 'skills again for who they are');
    $(pane, '.rpg-battle-companion-add').click();
    assert.equal(last('onAddCompanion').args[0].npcId, 'n2');
    assert.equal(last('onAddCompanion').args[0].name, 'Lyra Vance');
    // Without NPC State Delta, no picker.
    reset();
    pane = render({ mode: 'companion', level: 1, rules, prefill: { name: 'Lyra' } });
    assert.equal($(pane, '.rpg-battle-companion-npc'), null);
    assert.match($(pane, '.rpg-battle-section.is-companion-skills').textContent, /No skills/);
});

test('idle: no Spend without points; a pending hand-off offers Return to story; model text stays text', () => {
    const { handlers, last } = recorder();
    const pane = render({
        mode: 'idle',
        sheet: sheet({ name: '<img src=x onerror=alert(1)>', points: 0 }),
        skills: [], party: [], rules,
        pending: '[Battle resolved by RPG Battle: narrate this outcome, do not change it]\nVictory in 4 rounds.',
    }, handlers);
    assert.equal($(pane, '.rpg-battle-spend'), null);
    assert.equal($(pane, '.rpg-battle-head-name').textContent, '<img src=x onerror=alert(1)>');
    assert.equal($(pane, '.rpg-battle-head-name').children.length, 0, 'no element was parsed from the name');
    assert.equal(root(pane).querySelectorAll('img').length, 0);
    assert.match($(pane, '.rpg-battle-notice .rpg-battle-handoff').textContent, /Victory in 4 rounds/);
    $(pane, '.rpg-battle-notice .rpg-battle-return').click();
    assert.ok(last('onReturn'));
    // Checks fall back to the rules when the view has none.
    const str = $$(pane, '.rpg-battle-stat').find(node => node.dataset.stat === 'STR');
    assert.equal(str.querySelector('.rpg-battle-stat-check').textContent, '+2');
});

// ---------------------------------------------------------------------------
// spend

test('spend: steppers place sheet.points, the preview shows before → after, Confirm sends the allocation', () => {
    const { handlers, last } = recorder();
    const pane = render({ mode: 'spend', sheet: sheet({ points: 3 }), rules }, handlers);
    assert.equal(valueOf(pane, 'VIT'), '7');
    assert.equal(minus(pane, 'VIT').disabled, true, 'cannot take back points already spent');
    assert.equal($(pane, '.rpg-battle-confirm').disabled, true);
    assert.equal(factValue(pane, 'Max HP'), '62');

    plus(pane, 'VIT').click();
    plus(pane, 'VIT').click();
    plus(pane, 'STR').click();
    assert.equal(plus(pane, 'INT').disabled, true, 'budget used');
    assert.equal(valueOf(pane, 'VIT'), '9');
    // The sheet's 62 already includes gear, so the preview adds only the VIT part (+16).
    assert.equal(factValue(pane, 'Max HP'), '62 → 78');
    assert.equal(factValue(pane, 'Attack'), '18 → 20');
    assert.equal(factValue(pane, 'Max MP'), '30');
    minus(pane, 'STR').click();
    plus(pane, 'INT').click();
    assert.equal(factValue(pane, 'Max MP'), '30 → 34');

    $(pane, '.rpg-battle-confirm').click();
    assert.deepEqual(last('onConfirmSpend').args[0], { STR: 0, VIT: 2, AGI: 0, DEX: 0, INT: 1, LUK: 0, CHA: 0 });
    $(pane, '.rpg-battle-back').click();
    assert.ok(last('onBack'));
});

// ---------------------------------------------------------------------------
// learn

test('learn: library skills show requirements and whether they are met; known ones cannot be relearned', () => {
    reset();
    const { handlers, last } = recorder();
    const pane = render({ mode: 'learn', sheet: sheet(), library: [...LIBRARY, ...TIER2], rules }, handlers);
    const row = name => $$(pane, '.rpg-battle-library-skill').find(node => node.dataset.skill === name);
    const fireball = row('Fireball');
    assert.deepEqual(texts(fireball, '.rpg-battle-require'), ['INT 8 (you have 4)']);
    assert.ok(fireball.querySelector('.rpg-battle-require').classList.contains('is-unmet'));
    assert.equal(fireball.querySelector('.rpg-battle-learn-library').disabled, true);

    const rending = row('Rending Strike');
    assert.ok(rending.classList.contains('is-known'));
    assert.equal(rending.querySelector('.rpg-battle-learn-library').disabled, true);
    assert.ok(rending.querySelector('.rpg-battle-require').classList.contains('is-met'));

    // The tier with something learnable starts open.
    assert.equal($(pane, '.rpg-battle-fold.is-tier-1').open, true);
    row('Spark').querySelector('.rpg-battle-learn-library').click();
    assert.deepEqual(last('onConfirmLearn').args[0], { name: 'Spark', fromLibrary: true });
});

test('learn: a new skill from a template (name, type, stat, target)', () => {
    reset();
    const { handlers, last } = recorder();
    const pane = render({ mode: 'learn', sheet: sheet(), library: LIBRARY, rules }, handlers);
    const learn = $(pane, '.rpg-battle-learn-template');
    assert.equal(learn.disabled, true);
    const name = $(pane, '.rpg-battle-template-name');
    name.value = 'Quick Jab';
    name.dispatch('input');
    assert.equal(learn.disabled, true, 'already known');
    name.value = 'Tidebreaker';
    name.dispatch('input');
    assert.equal(learn.disabled, false);

    const type = $(pane, '.rpg-battle-template-type');
    type.value = 'heal';
    type.dispatch('change');
    // A heal suggests INT and an ally until the reader picks their own.
    assert.equal($(pane, '.rpg-battle-template-stat').value, 'INT');
    assert.equal($(pane, '.rpg-battle-template-target').value, 'ally');
    const stat = $(pane, '.rpg-battle-template-stat');
    stat.value = 'CHA';
    stat.dispatch('change');
    type.value = 'magic';
    type.dispatch('change');
    assert.equal($(pane, '.rpg-battle-template-stat').value, 'CHA', 'a chosen stat is kept');

    learn.click();
    assert.deepEqual(last('onConfirmLearn').args[0], { name: 'Tidebreaker', template: { type: 'magic', stat: 'CHA', target: 'one', element: 'none' } });
    $(pane, '.rpg-battle-back').click();
    assert.ok(last('onBack'));
});

// ---------------------------------------------------------------------------
// setup

test('setup: rows with bestiary autocomplete, rank defaulting to the suggestion, add/remove, stakes, Start', () => {
    reset();
    const { handlers, last } = recorder();
    const view = { mode: 'setup', bestiary: ['Goblin', 'Goblin Shaman', 'Wolf'], suggestedRank: 'E', rules };
    const pane = render(view, handlers);
    const datalist = $(pane, 'datalist');
    assert.deepEqual(datalist.querySelectorAll('option').map(node => node.value), ['Goblin', 'Goblin Shaman', 'Wolf']);
    assert.equal($(pane, '.rpg-battle-enemy-name').getAttribute('list'), datalist.id);
    assert.equal($(pane, '.rpg-battle-enemy-rank').value, '', 'auto: the bestiary rank, or the fair one');
    assert.deepEqual($(pane, '.rpg-battle-enemy-rank').querySelectorAll('option').map(node => node.value), ['', 'F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS']);
    assert.match($(pane, '.rpg-battle-enemy-rank').querySelectorAll('option')[0].textContent, /fair: E/);
    assert.deepEqual($(pane, '.rpg-battle-enemy-count').querySelectorAll('option').map(node => node.value), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    assert.deepEqual($(pane, '.rpg-battle-enemy-role').querySelectorAll('option').map(node => node.value), ['', 'brute', 'skirmisher', 'caster', 'tank', 'support']);
    assert.equal($(pane, '.rpg-battle-begin').disabled, true, 'no named row yet');

    const name = $(pane, '.rpg-battle-enemy-name');
    name.value = 'Goblin';
    name.dispatch('input');
    const count = $(pane, '.rpg-battle-enemy-count');
    count.value = '3';
    count.dispatch('change');
    assert.equal($(pane, '.rpg-battle-begin').disabled, false);
    assert.equal($(pane, '.rpg-battle-setup-summary').textContent, '3 enemies.');

    $(pane, '.rpg-battle-add-row').click();
    $(pane, '.rpg-battle-add-row').click();
    assert.equal($$(pane, '.rpg-battle-enemy-row').length, 3);
    assert.equal($$(pane, '.rpg-battle-enemy-name')[0].value, 'Goblin', 'rows survive the redraw');
    const second = $$(pane, '.rpg-battle-enemy-row')[1];
    second.querySelector('.rpg-battle-enemy-name').value = 'Bog Wight';
    second.querySelector('.rpg-battle-enemy-name').dispatch('input');
    second.querySelector('.rpg-battle-enemy-rank').value = 'D';
    second.querySelector('.rpg-battle-enemy-rank').dispatch('change');
    second.querySelector('.rpg-battle-enemy-role').value = 'tank';
    second.querySelector('.rpg-battle-enemy-role').dispatch('change');
    second.querySelector('.rpg-battle-enemy-boss').checked = true;
    second.querySelector('.rpg-battle-enemy-boss').dispatch('change');
    // The third, empty row is dropped; remove it anyway to test removal.
    $$(pane, '.rpg-battle-remove-row')[2].click();
    assert.equal($$(pane, '.rpg-battle-enemy-row').length, 2);
    assert.equal($$(pane, '.rpg-battle-remove-row')[0].getAttribute('aria-label'), 'Remove enemy 1');

    const radios = $$(pane, '.rpg-battle-stake-input');
    assert.deepEqual(radios.map(node => [node.value, node.checked]), [['normal', true], ['death', false]]);
    assert.match(texts(root(pane), '.rpg-battle-stake-note').join(' '), /captured, robbed/);
    radios[1].checked = true;
    radios[1].dispatch('change');

    // The glue redraws mid-setup: nothing is lost.
    renderBattleTab(pane, view, handlers);
    assert.equal($$(pane, '.rpg-battle-enemy-row')[1].querySelector('.rpg-battle-enemy-boss').checked, true);
    assert.equal($$(pane, '.rpg-battle-stake-input')[1].checked, true);

    $(pane, '.rpg-battle-begin').click();
    assert.deepEqual(last('onStart').args[0], {
        rows: [
            { name: 'Goblin', count: 3, rank: null, role: null, boss: false },
            { name: 'Bog Wight', count: 1, rank: 'D', role: 'tank', boss: true },
        ],
        stakes: 'death',
    });
    $(pane, '.rpg-battle-back').click();
    assert.ok(last('onBack'));
});

test('setup: removing the last row leaves one empty row; bestiary entries may be objects', () => {
    reset();
    const pane = render({ mode: 'setup', bestiary: [{ name: 'Slime' }], suggestedRank: 'nonsense', rules });
    assert.match($(pane, '.rpg-battle-enemy-rank').querySelectorAll('option')[0].textContent, /fair: F/, 'an unknown suggestion falls back to F');
    assert.deepEqual($(pane, 'datalist').querySelectorAll('option').map(node => node.value), ['Slime']);
    $(pane, '.rpg-battle-remove-row').click();
    assert.equal($$(pane, '.rpg-battle-enemy-row').length, 1);
    assert.equal($(pane, '.rpg-battle-begin').disabled, true);
});

// ---------------------------------------------------------------------------
// fight

test('fight: enemy and party cards, gone ones greyed, the turn highlighted, the order strip and the log', () => {
    reset();
    const pane = render(fightView());
    const goblin = card(pane, 'e1');
    assert.ok(goblin.classList.contains('is-enemy'));
    assert.deepEqual(texts(goblin, '.rpg-battle-badge'), ['E · brute']);
    assert.deepEqual(texts(goblin, '.rpg-battle-chip'), ['poison 2']);
    assert.equal(goblin.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '40');
    const wolf = card(pane, 'e3');
    assert.ok(wolf.classList.contains('is-gone'));
    assert.ok(texts(wolf, '.rpg-battle-badge').includes('fled'));
    assert.equal($(pane, '.rpg-battle-section.is-enemies .rpg-battle-count').textContent, '2');

    const ren = card(pane, 'pc');
    assert.ok(ren.classList.contains('is-turn'));
    assert.equal(ren.getAttribute('aria-current'), 'true');
    assert.equal(ren.querySelectorAll('[role="progressbar"]').length, 2, 'party cards show HP and MP');
    assert.deepEqual(texts(card(pane, 'astra'), '.rpg-battle-chip'), ['regen 2']);

    assert.deepEqual(texts(root(pane), '.rpg-battle-order-item'), ['Ren', 'Goblin', 'Astra', 'Goblin Shaman', 'Wolf']);
    const current = $(pane, '.rpg-battle-order-item.is-current');
    assert.equal(current.textContent, 'Ren');
    assert.equal(current.getAttribute('aria-current'), 'step');
    assert.ok($$(pane, '.rpg-battle-order-item')[4].classList.contains('is-gone'));

    const lines = texts(root(pane), '.rpg-battle-log-text');
    assert.equal(lines.length, 8);
    assert.equal(lines.at(-1), 'line 11', 'newest at the bottom');
    assert.equal(lines[0], 'line 4');
    assert.ok($$(pane, '.rpg-battle-log-line').at(-1).classList.contains('is-important'));
    assert.equal($(pane, '.rpg-battle-actor').textContent, 'Ren’s turn');
    assert.equal($(pane, '.rpg-battle-over'), null);
});

test('fight: Attack with two targets enters target picking; tapping an enemy card sends the action', () => {
    reset();
    const { handlers, calls } = recorder();
    const view = fightView();
    const pane = render(view, handlers);
    buttonByText(pane, 'Attack').click();
    assert.equal(calls.length, 0, 'nothing sent before a target is chosen');
    assert.match($(pane, '.rpg-battle-picking-text').textContent, /Attack: tap an enemy/);
    const pickable = $$(pane, '.rpg-battle-card.is-pickable').map(node => node.dataset.combatantId);
    assert.deepEqual(pickable, ['e1', 'e2'], 'gone enemies and allies are not targets');
    assert.equal(card(pane, 'e1').getAttribute('role'), 'button');
    assert.equal(card(pane, 'e1').getAttribute('aria-label'), 'Target Goblin');

    // A redraw of the same moment keeps the picking state.
    renderBattleTab(pane, view, handlers);
    assert.ok($(pane, '.rpg-battle-picking'));
    card(pane, 'e2').click();
    assert.deepEqual(calls.at(-1), { name: 'onAction', args: [{ type: 'attack', target: 'e2' }] });
    assert.equal($(pane, '.rpg-battle-picking'), null, 'the state clears after sending');
});

test('fight: a single possible target is chosen at once; Defend and Flee send straight away', () => {
    reset();
    const { handlers, calls } = recorder();
    const pane = render(fightView({}, { targets: { enemies: ['e1'], allies: ['pc'] } }), handlers);
    buttonByText(pane, 'Attack').click();
    assert.deepEqual(calls.at(-1).args[0], { type: 'attack', target: 'e1' });
    buttonByText(pane, 'Defend').click();
    assert.deepEqual(calls.at(-1).args[0], { type: 'defend' });
    const flee = buttonByText(pane, 'Flee 62%');
    assert.ok(flee);
    flee.click();
    assert.deepEqual(calls.at(-1).args[0], { type: 'flee' });
});

test('fight: the Skill list shows MP, cooldowns and why a skill is unusable; heals aim at allies, areas need no target', () => {
    reset();
    const { handlers, calls } = recorder();
    const view = fightView();
    const pane = render(view, handlers);
    const skillButton = buttonByText(pane, 'Skill');
    assert.equal(skillButton.getAttribute('aria-expanded'), 'false');
    skillButton.click();
    assert.equal(buttonByText(pane, 'Skill').getAttribute('aria-expanded'), 'true');
    const entry = name => $$(pane, '.rpg-battle-menu-entry').find(node => node.dataset.skill === name);
    assert.match(entry('Power Strike').textContent, /5 MP · cooldown 1 · one enemy/);
    assert.match(entry('Power Strike').textContent, /Lv 2/);
    assert.equal(entry('Rending Strike').disabled, true);
    assert.equal(entry('Rending Strike').querySelector('.rpg-battle-pick-reason').textContent, 'Cooldown: 2 rounds');

    // The open list survives a redraw of the same moment.
    renderBattleTab(pane, view, handlers);
    assert.ok(entry('Mend'));
    entry('Mend').click();
    assert.match($(pane, '.rpg-battle-picking-text').textContent, /Mend: tap an ally/);
    assert.deepEqual($$(pane, '.rpg-battle-card.is-pickable').map(node => node.dataset.combatantId), ['pc', 'astra']);
    card(pane, 'astra').click();
    assert.deepEqual(calls.at(-1).args[0], { type: 'skill', target: 'astra', skill: 'Mend' });

    buttonByText(pane, 'Skill').click();
    entry('Whirl').click();
    assert.deepEqual(calls.at(-1).args[0], { type: 'skill', target: null, skill: 'Whirl' });
});

test('fight: items aim by their effect; Esc and Cancel leave the picking state', () => {
    reset();
    const { handlers, calls } = recorder();
    const pane = render(fightView(), handlers);
    buttonByText(pane, 'Item').click();
    const entry = name => $$(pane, '.rpg-battle-menu-entry').find(node => node.dataset.item === name);
    assert.match(entry('Healing Draught').textContent, /×2/);
    entry('Ember Flask').click();
    assert.deepEqual(calls.at(-1).args[0], { type: 'item', target: null, item: 'Ember Flask' });

    buttonByText(pane, 'Item').click();
    entry('Healing Draught').click();
    assert.match($(pane, '.rpg-battle-picking-text').textContent, /tap an ally/);
    root(pane).dispatch('keydown', { key: 'Escape' });
    assert.equal($(pane, '.rpg-battle-picking'), null);
    assert.equal($$(pane, '.rpg-battle-card.is-pickable').length, 0);

    buttonByText(pane, 'Attack').click();
    buttonByText(pane, 'Cancel').click();
    assert.equal($(pane, '.rpg-battle-picking'), null);
    assert.equal(calls.length, 1, 'cancelling sends nothing');
});

test('fight: Parley shows its chance, aims at enemies that talk, and is disabled when not possible', () => {
    reset();
    const { handlers, calls } = recorder();
    let pane = render(fightView(), handlers);
    const parley = buttonByText(pane, 'Parley 45%');
    assert.ok(parley);
    parley.click();
    // Only the shaman talks, so it is chosen at once.
    assert.deepEqual(calls.at(-1).args[0], { type: 'parley', target: 'e2' });

    pane = render(fightView({}, { canParley: false, parleyChance: null, canFlee: false }), handlers);
    assert.equal(buttonByText(pane, 'Parley').disabled, true);
    assert.equal(buttonStarting(pane, 'Flee').disabled, true);
});

test('fight: picking state is keyed to the moment; a new turn starts clean', () => {
    reset();
    const pane = render(fightView());
    buttonByText(pane, 'Attack').click();
    assert.ok($(pane, '.rpg-battle-picking'));
    const next = fightView({ turn: 2, actions: [{ type: 'attack', target: 'e1' }] });
    renderBattleTab(pane, next, {});
    assert.equal($(pane, '.rpg-battle-picking'), null);
    assert.ok(buttonByText(pane, 'Attack'));
});

test('fight: Auto calls onAuto; without it, an auto action', () => {
    reset();
    const { handlers, calls } = recorder();
    let pane = render(fightView(), handlers);
    buttonByText(pane, 'Auto').click();
    assert.equal(calls.at(-1).name, 'onAuto');
    const sent = [];
    pane = render(fightView(), { onAction: action => sent.push(action) });
    buttonByText(pane, 'Auto').click();
    assert.deepEqual(sent, [{ type: 'auto' }]);
});

test('fight: a finished fight shows "Fight over" and no action bar', () => {
    reset();
    const pane = render(fightView({ status: 'victory' }, { actor: null }));
    assert.equal($(pane, '.rpg-battle-over').textContent, 'Fight over: Victory.');
    assert.equal($(pane, '.rpg-battle-actionbar'), null);
    assert.equal($$(pane, '.rpg-battle-card.is-turn').length, 0);
});

// ---------------------------------------------------------------------------
// result

test('result: outcome, time, party after, gains, loot, key moments and the hand-off', () => {
    reset();
    const pane = render({ mode: 'result', result: result(), handoff: '[Battle resolved by RPG Battle: narrate this outcome, do not change it]\nVictory in 4 rounds.', levelsGained: 1, pointsGained: 4, rules });
    assert.equal($(pane, '.rpg-battle-outcome').textContent, 'Victory');
    assert.match($(pane, '.rpg-battle-section.is-outcome .rpg-battle-hint').textContent, /4 rounds · about 24 seconds/);
    assert.deepEqual(texts(root(pane), '.rpg-battle-after .rpg-battle-record-name'), ['Ren', 'Astra']);
    assert.ok($$(pane, '.rpg-battle-after')[1].classList.contains('is-down'));
    assert.equal($$(pane, '.rpg-battle-after')[0].querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '34');
    assert.deepEqual(texts(root(pane), '.rpg-battle-gains dd'), ['+38 each', '+1 level', '4 to spend']);
    assert.deepEqual(texts(root(pane), '.rpg-battle-loot-item'), ['14 copper', 'Bone Fetishuncommon', 'Goblin Ear×3']);
    assert.deepEqual(texts(root(pane), '.rpg-battle-moments li'), ['Ren crit the second goblin.', 'One goblin fled toward the weir.']);
    assert.match($(pane, '.rpg-battle-section.is-handoff .rpg-battle-handoff').textContent, /^\[Battle resolved by RPG Battle/);
});

test('result: defeat and escape titles; per-member XP; no loot section without loot', () => {
    reset();
    let pane = render({ mode: 'result', result: result({ outcome: 'defeat', xp: {}, loot: { items: [], money: 0 }, keyMoments: [] }), handoff: '' });
    assert.equal($(pane, '.rpg-battle-outcome').textContent, 'Defeated');
    assert.equal($(pane, '.rpg-battle-section.is-loot'), null);
    assert.equal($(pane, '.rpg-battle-section.is-moments'), null);
    assert.equal($(pane, '.rpg-battle-section.is-handoff'), null);
    pane = render({ mode: 'result', result: result({ outcome: 'fled', rounds: 1, seconds: 6, xp: { pc: 10, astra: 5 } }), handoff: 'Escaped after 1 round.', moneyText: '1 silver, 4 copper' });
    assert.equal($(pane, '.rpg-battle-outcome').textContent, 'Escaped');
    assert.match($(pane, '.rpg-battle-section.is-outcome .rpg-battle-hint').textContent, /1 round · about 6 seconds/);
    assert.deepEqual(texts(root(pane), '.rpg-battle-gains dt'), ['Ren XP', 'Astra XP']);
    assert.equal($(pane, '.rpg-battle-loot-item.is-money').textContent, '1 silver, 4 copper');
});

test('result: Return, Done, and Discard only on a second click', () => {
    reset();
    const { handlers, calls } = recorder();
    const view = { mode: 'result', result: result(), handoff: 'text', levelsGained: 0, pointsGained: 0 };
    const pane = render(view, handlers);
    buttonByText(pane, 'Return to story').click();
    buttonByText(pane, 'Done').click();
    assert.deepEqual(calls.map(call => call.name), ['onReturn', 'onDone']);
    buttonByText(pane, 'Discard result').click();
    assert.equal(calls.length, 2, 'the first click only arms it');
    const armed = buttonByText(pane, 'Click again to discard');
    assert.ok(armed.classList.contains('is-armed'));
    // A redraw with the same result keeps it armed.
    renderBattleTab(pane, view, handlers);
    buttonByText(pane, 'Click again to discard').click();
    assert.equal(calls.at(-1).name, 'onDiscard');
});

// ---------------------------------------------------------------------------
// robustness

test('every mode renders and its buttons can be pressed with no handlers at all', () => {
    reset();
    const views = [
        { mode: 'create', presets: PRESETS, library: LIBRARY, rules },
        { mode: 'idle', sheet: sheet(), skills: [], party: [], rules, pending: 'x' },
        { mode: 'spend', sheet: sheet(), rules },
        { mode: 'learn', sheet: sheet(), library: LIBRARY, rules },
        { mode: 'setup', bestiary: [], suggestedRank: 'E', rules },
        fightView(),
        { mode: 'result', result: result(), handoff: 'x' },
        { mode: 'nonsense' },
        { mode: 'idle' },
        { mode: 'fight' },
    ];
    for (const view of views) {
        const pane = doc.createElement('div');
        renderBattleTab(pane, view);
        assert.ok(root(pane).classList.contains('rpg-battle-tab'), view.mode);
        for (const node of $$(pane, 'button')) if (!node.disabled) node.click();
    }
});

test('the root is put in the pane with replaceChildren, replacing what was there', () => {
    reset();
    const pane = doc.createElement('div');
    pane.append(doc.createElement('span'));
    renderBattleTab(pane, { mode: 'idle', sheet: sheet(), rules });
    assert.equal(pane.children.length, 1);
    assert.equal(pane.firstElementChild.dataset.mode, 'idle');
});

// ---------------------------------------------------------------------------
// The story: wounds, fights it starts, and Story Block's own Character Sheet

test('idle: the story wounds line with Undo; no Undo once the sheets moved on; model text stays text', () => {
    reset();
    const { handlers, calls } = recorder();
    const lines = ['Ren: wound (−29 HP), fell down the ravine.', 'Astra: <b>poisoned</b>, a dart.'];
    let pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, story: { lines, canUndo: true } }, handlers);
    assert.deepEqual(texts(root(pane), '.rpg-battle-story-line'), lines);
    assert.equal(root(pane).querySelectorAll('b').length, 0, 'a cause is never parsed as markup');
    $(pane, '.rpg-battle-story-undo').click();
    assert.deepEqual(calls.map(call => call.name), ['onUndoStory']);
    pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, story: { lines, canUndo: false } }, handlers);
    assert.equal(texts(root(pane), '.rpg-battle-story-line').length, 2);
    assert.equal($(pane, '.rpg-battle-story-undo'), null);
    pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, story: null }, handlers);
    assert.equal($(pane, '.rpg-battle-story'), null);
});

test('offer: the Battle tab offers the story\'s fight: Fight? sends its rows, Not now dismisses it', () => {
    reset();
    const { handlers, calls } = recorder();
    const rows = [{ name: 'Bandit', count: 3, rank: null, role: null, boss: false }, { name: 'Bandit Captain', count: 1, rank: null, role: null, boss: true, wave: 1 }];
    const pane = render({
        mode: 'offer', rules,
        encounter: { text: '3 bandit; then: bandit captain (boss)', label: 'Planned by Story Director: Ambush at the weir.', rows },
    }, handlers);
    assert.match($(pane, '.rpg-battle-encounter-waves').textContent, /2 engagements, fought back to back/);
    assert.equal($(pane, '.rpg-battle-encounter-text').textContent, 'A fight is starting: 3 bandit; then: bandit captain (boss)');
    assert.match($(pane, '.rpg-battle-encounter-label').textContent, /Ambush at the weir/);
    assert.equal(buttonByText(pane, 'Fight?'), $(pane, '.rpg-battle-encounter-fight'));
    $(pane, '.rpg-battle-encounter-fight').click();
    $(pane, '.rpg-battle-encounter-dismiss').click();
    assert.deepEqual(calls.map(call => call.name), ['onFightEncounter', 'onDismissEncounter']);
    assert.deepEqual(calls[0].args[0], rows);
    assert.notEqual(calls[0].args[0][0], rows[0], 'the handler gets copies');
    const quiet = render({ mode: 'offer', rules, encounter: null });
    assert.equal($(quiet, '.rpg-battle-encounter-text'), null);
    assert.match($(quiet, '.rpg-battle-empty').textContent, /the story starts them/);
});

test('setup: a story fight pre-fills the rows; the reader can still edit them, and edits survive a redraw', () => {
    reset();
    const { handlers, last } = recorder();
    const prefill = [
        { name: 'Bandit', count: 3, rank: null, role: null, boss: false },
        { name: 'Bandit Captain', count: 1, rank: 'D', role: 'brute', boss: true },
        { name: 'Bog Wight', count: 12, rank: 'nonsense', role: 'wizard', boss: false },
    ];
    const view = { mode: 'setup', bestiary: ['Bandit', 'Bandit Captain'], suggestedRank: 'E', prefill, rules };
    const pane = render(view, handlers);
    assert.ok($(pane, '.rpg-battle-prefill-hint'));
    assert.deepEqual($$(pane, '.rpg-battle-enemy-name').map(node => node.value), ['Bandit', 'Bandit Captain', 'Bog Wight']);
    assert.deepEqual($$(pane, '.rpg-battle-enemy-count').map(node => node.value), ['3', '1', '9']);
    assert.deepEqual($$(pane, '.rpg-battle-enemy-rank').map(node => node.value), ['', 'D', '']);
    assert.deepEqual($$(pane, '.rpg-battle-enemy-role').map(node => node.value), ['', 'brute', '']);
    assert.deepEqual($$(pane, '.rpg-battle-enemy-boss').map(node => node.checked), [false, true, false]);
    // The Bog Wight is in neither bestiary: tagged new, made up when the fight starts.
    assert.equal($(pane, '.rpg-battle-setup-summary').textContent, '13 enemies. 1 new, made up from its name when the fight starts.');
    assert.deepEqual($$(pane, '.rpg-battle-new').map(node => node.hidden), [true, true, false]);
    assert.deepEqual($$(pane, '.rpg-battle-stake-input').map(node => node.checked), [true, false], 'normal stakes');

    // The reader changes their mind: two bandits, no wight.
    const count = $$(pane, '.rpg-battle-enemy-count')[0];
    count.value = '2';
    count.dispatch('change');
    $$(pane, '.rpg-battle-remove-row')[2].click();
    renderBattleTab(pane, view, handlers);
    assert.deepEqual($$(pane, '.rpg-battle-enemy-name').map(node => node.value), ['Bandit', 'Bandit Captain'], 'the same prefill does not undo the edits');
    $(pane, '.rpg-battle-begin').click();
    assert.deepEqual(last('onStart').args[0], {
        rows: [
            { name: 'Bandit', count: 2, rank: null, role: null, boss: false },
            { name: 'Bandit Captain', count: 1, rank: 'D', role: 'brute', boss: true },
        ],
        stakes: 'normal',
    });

    // A different offer starts over; no prefill is the usual empty row.
    renderBattleTab(pane, { ...view, prefill: [{ name: 'Wolf', count: 2 }] }, handlers);
    assert.deepEqual($$(pane, '.rpg-battle-enemy-name').map(node => node.value), ['Wolf']);
    reset();
    const plain = render({ mode: 'setup', bestiary: [], suggestedRank: 'E', prefill: null, rules });
    assert.deepEqual($$(plain, '.rpg-battle-enemy-name').map(node => node.value), ['']);
    assert.equal($(plain, '.rpg-battle-prefill-hint'), null);
});

test('idle: Story Block\'s Character Sheet notice offers to turn it off, and only when asked', () => {
    reset();
    const { handlers, calls } = recorder();
    const pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, sheetConflict: true }, handlers);
    assert.match($(pane, '.rpg-battle-notice.is-sheet-conflict').textContent, /Story Block's Character Sheet is also on: two HP values will disagree\./);
    assert.deepEqual(calls, [], 'nothing happens on its own');
    $(pane, '.rpg-battle-sheet-off').click();
    assert.deepEqual(calls.map(call => call.name), ['onDisableStorySheet']);
    const off = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, sheetConflict: false });
    assert.equal($(off, '.rpg-battle-notice.is-sheet-conflict'), null);
});

test('the story notices render and can be pressed with no handlers at all', () => {
    reset();
    for (const view of [
        { mode: 'idle', sheet: sheet(), rules, story: { lines: ['x'], canUndo: true }, encounter: { text: 'x', rows: [] }, sheetConflict: true },
        { mode: 'idle', sheet: sheet(), rules, story: { lines: 'not a list' }, encounter: { text: '' } },
        { mode: 'setup', bestiary: [], suggestedRank: 'E', prefill: 'not a list', rules },
    ]) {
        const pane = doc.createElement('div');
        renderBattleTab(pane, view);
        for (const node of $$(pane, 'button')) if (!node.disabled) node.click();
        assert.ok(root(pane));
    }
});

// ---------------------------------------------------------------------------
// Display terms and Edit companion

const SOUL = { ...rules, terms: { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' }, cap: 100 } };
const POWER = { ...rules, terms: { levelName: 'Soul Power', xpName: 'Power Growth', tiers: null, cap: null } };

test('idle: the level and XP in the reader\'s terms; party rows show the tier', () => {
    const party = [{ id: 'astra', name: 'Astra', role: 'companion', control: 'auto', sheet: sheet({ name: 'Astra', level: 12 }), gear: [] }];
    let pane = render({ mode: 'idle', sheet: sheet({ level: 24, xp: 3120 }), skills: [], party, rules: SOUL });
    assert.equal($(pane, '.rpg-battle-level').textContent, 'Soul Class III (Lv 24)');
    const xpBar = $(pane, '.rpg-battle-member-card.is-you .rpg-battle-bar.is-xp');
    assert.equal(xpBar.getAttribute('aria-label'), 'Soul Growth');
    assert.equal(xpBar.querySelector('.rpg-battle-bar-name').textContent, 'Soul Growth');
    assert.equal(xpBar.querySelector('.rpg-battle-bar-value').textContent, '26.34/100');
    assert.ok(xpBar.classList.contains('is-named'));
    assert.equal($(pane, '.rpg-battle-member .rpg-battle-member-level').textContent, 'Soul Class II');
    pane = render({ mode: 'idle', sheet: sheet({ level: 100, xp: 0 }), skills: [], party: [], rules: SOUL });
    assert.equal($(pane, '.rpg-battle-member-card.is-you .rpg-battle-bar.is-xp .rpg-battle-bar-value').textContent, 'MAX');
    pane = render({ mode: 'idle', sheet: sheet(), skills: [], party, rules: POWER });
    assert.equal($(pane, '.rpg-battle-level').textContent, 'Soul Power 4');
    assert.equal($(pane, '.rpg-battle-member .rpg-battle-member-level').textContent, 'Soul Power 12');
    assert.equal($(pane, '.rpg-battle-member-card.is-you .rpg-battle-bar.is-xp .rpg-battle-bar-value').textContent, `310/${xpToNext(4, rules)}`);
    pane = render({ mode: 'idle', sheet: sheet(), skills: [], party, rules });
    assert.equal($(pane, '.rpg-battle-member .rpg-battle-member-level').textContent, 'Lv 12', 'the plain terms as before');
});

test('idle: Edit opens a small form for a companion; Save sends name, role and control', () => {
    reset();
    const { handlers, calls } = recorder();
    const party = [
        { id: 'astra', name: 'Astra', role: 'companion', control: 'auto', sheet: sheet({ name: 'Astra' }), gear: [] },
        { id: 'merrit', name: 'Merrit', role: 'hireling', control: 'command', sheet: sheet({ name: 'Merrit' }), gear: [] },
    ];
    const view = { mode: 'idle', sheet: sheet(), skills: [], party, rules };
    const pane = render(view, handlers);
    assert.equal($(pane, '.rpg-battle-edit-form'), null);
    $$(pane, '.rpg-battle-edit-companion')[0].click();
    assert.ok($$(pane, '.rpg-battle-member')[0].querySelector('.rpg-battle-edit-form'), 'the form opens in Astra\'s row');
    assert.equal($$(pane, '.rpg-battle-edit-form').length, 1);
    assert.equal($(pane, '.rpg-battle-edit-name').value, 'Astra');
    assert.equal($(pane, '.rpg-battle-edit-role').value, 'companion');
    assert.equal($(pane, '.rpg-battle-edit-control').value, 'auto');
    assert.equal($$(pane, '.rpg-battle-control').length, 1, 'the row being edited shows the form instead of its buttons');

    const name = $(pane, '.rpg-battle-edit-name');
    name.value = '';
    name.dispatch('input');
    assert.equal($(pane, '.rpg-battle-edit-save').disabled, true, 'a name is needed');
    name.value = 'Astra the Bold';
    name.dispatch('input');
    const role = $(pane, '.rpg-battle-edit-role');
    role.value = 'mage';
    role.dispatch('input');
    const control = $(pane, '.rpg-battle-edit-control');
    control.value = 'command';
    control.dispatch('change');
    // The glue redraws mid-edit: the form and what was typed stay.
    renderBattleTab(pane, view, handlers);
    assert.equal($(pane, '.rpg-battle-edit-name').value, 'Astra the Bold');
    assert.equal($(pane, '.rpg-battle-edit-control').value, 'command');
    $(pane, '.rpg-battle-edit-save').click();
    assert.deepEqual(calls.at(-1), { name: 'onEditCompanion', args: ['astra', { name: 'Astra the Bold', role: 'mage', control: 'command' }] });
    assert.equal($(pane, '.rpg-battle-edit-form'), null, 'closed after Save');

    // Cancel closes without a call; an empty role becomes "companion".
    $$(pane, '.rpg-battle-edit-companion')[1].click();
    $(pane, '.rpg-battle-edit-cancel').click();
    assert.equal($(pane, '.rpg-battle-edit-form'), null);
    assert.equal(calls.filter(call => call.name === 'onEditCompanion').length, 1);
    $$(pane, '.rpg-battle-edit-companion')[1].click();
    const merritRole = $(pane, '.rpg-battle-edit-role');
    merritRole.value = '   ';
    merritRole.dispatch('input');
    $(pane, '.rpg-battle-edit-save').click();
    assert.deepEqual(calls.at(-1).args, ['merrit', { name: 'Merrit', role: 'companion', control: 'command' }]);
    // Leaving the idle screen drops a half-done edit.
    $$(pane, '.rpg-battle-edit-companion')[0].click();
    render({ mode: 'items', sheet: sheet(), party: [], items: [], rules });
    const back = render(view, handlers);
    assert.equal($(back, '.rpg-battle-edit-form'), null);
});

test('setup: with the reader\'s terms the power picker offers their tiers and Start sends a level', () => {
    reset();
    const { handlers, last } = recorder();
    const pane = render({ mode: 'setup', bestiary: ['Goblin'], suggestedRank: 'A', rules: SOUL }, handlers);
    const power = $(pane, '.rpg-battle-enemy-power');
    const options = power.querySelectorAll('option');
    assert.deepEqual(options.map(node => node.value), ['', '1', '11', '21', '31', '41', '51', '61', '71', '81', '91']);
    assert.equal(options[0].textContent, 'auto (fair: Soul Class III)', 'rank A is level 22');
    assert.equal(options[3].textContent, 'Soul Class III (fair)');
    assert.equal(options[10].textContent, 'Soul Class X');
    assert.equal(power.getAttribute('aria-label'), 'Enemy 1 Soul Class');
    const name = $(pane, '.rpg-battle-enemy-name');
    name.value = 'Bog Wight';
    name.dispatch('input');
    power.value = '11';
    power.dispatch('change');
    $(pane, '.rpg-battle-add-row').click();
    const second = $$(pane, '.rpg-battle-enemy-row')[1];
    second.querySelector('.rpg-battle-enemy-name').value = 'Goblin';
    second.querySelector('.rpg-battle-enemy-name').dispatch('input');
    $(pane, '.rpg-battle-begin').click();
    assert.deepEqual(last('onStart').args[0].rows, [
        { name: 'Bog Wight', count: 1, level: 11, role: null, boss: false },
        { name: 'Goblin', count: 1, level: null, role: null, boss: false },
    ]);
    // Names of their own without tiers: every level up to the cap.
    reset();
    const levels = render({ mode: 'setup', bestiary: [], suggestedRank: 'E', rules: { ...POWER, terms: { ...POWER.terms, cap: 30 } } });
    const picker = $(levels, '.rpg-battle-enemy-power').querySelectorAll('option');
    assert.equal(picker.length, 31);
    assert.equal(picker[3].textContent, 'Soul Power 3 (fair)', 'rank E is level 3');
});

test('setup: a story fight\'s level is kept with the terms and becomes a rank without them', () => {
    reset();
    const prefill = [{ name: 'Wolf', count: 3, rank: null, role: null, boss: false, level: 1 }, { name: 'Bandit Captain', count: 1, rank: null, role: null, boss: true, level: 24 }];
    const { handlers, last } = recorder();
    let pane = render({ mode: 'setup', bestiary: [], suggestedRank: 'A', prefill, rules: SOUL }, handlers);
    const pickers = $$(pane, '.rpg-battle-enemy-power');
    assert.deepEqual(pickers.map(node => node.value), ['1', '24']);
    assert.equal(pickers[1].querySelectorAll('option').at(-1).textContent, 'Soul Class III (Lv 24)', 'an exact level not among the tiers is offered as itself');
    $(pane, '.rpg-battle-begin').click();
    assert.deepEqual(last('onStart').args[0].rows.map(row => row.level), [1, 24]);
    reset();
    pane = render({ mode: 'setup', bestiary: [], suggestedRank: 'A', prefill, rules }, handlers);
    assert.deepEqual($$(pane, '.rpg-battle-enemy-rank').map(node => node.value), ['F', 'A'], 'level 24 → rank A (level 22)');
    $(pane, '.rpg-battle-begin').click();
    assert.deepEqual(last('onStart').args[0].rows.map(row => [row.rank, 'level' in row]), [['F', false], ['A', false]]);
});

test('fight: an enemy\'s power badge in the reader\'s terms', () => {
    reset();
    let pane = render({ ...fightView(), rules: SOUL });
    assert.match(card(pane, 'e1').querySelector('.rpg-battle-badge').textContent, /^Soul Class I · brute$/);
    pane = render(fightView());
    assert.match(card(pane, 'e1').querySelector('.rpg-battle-badge').textContent, /^E · brute$/);
});

test('result: gains in the reader\'s terms, with the level reached', () => {
    reset();
    let pane = render({ mode: 'result', result: result(), handoff: '', levelsGained: 1, pointsGained: 4, levelsReached: 5, rules: POWER });
    assert.deepEqual(texts(root(pane), '.rpg-battle-gains dt'), ['Power Growth', 'Soul Power', 'Points']);
    assert.deepEqual(texts(root(pane), '.rpg-battle-gains dd'), ['+38 each', '+1 level (Soul Power 5)', '4 to spend']);
    let span = 0;
    for (let level = 1; level <= 10; level++) span += xpToNext(level, rules);
    const gain = Math.round(span * 0.12);
    const party = result().party.map(member => ({ ...member, level: 4 }));
    pane = render({ mode: 'result', result: result({ party, xp: { pc: gain, astra: gain } }), handoff: '', levelsGained: 0, pointsGained: 0, rules: SOUL });
    assert.deepEqual(texts(root(pane), '.rpg-battle-gains dd'), ['+12% each']);
    pane = render({ mode: 'result', result: result({ party: [{ ...party[0] }, { ...party[1], level: 14 }], xp: { pc: gain, astra: gain } }), handoff: '', rules: SOUL });
    assert.deepEqual(texts(root(pane), '.rpg-battle-gains dt'), ['Ren Soul Growth', 'Astra Soul Growth'], 'different tiers, different shares');
});

test('companion: the level picker in the reader\'s terms, up to the cap', () => {
    reset();
    const pane = render({ mode: 'companion', presets: [{ id: 'healer', name: 'Healer', points: { INT: 4 }, skills: [] }], level: 24, maxLevel: 34, rules: { ...SOUL, terms: { ...SOUL.terms, cap: 30 } } });
    const options = $(pane, '.rpg-battle-companion-level').querySelectorAll('option');
    assert.equal(options.length, 30);
    assert.equal(options[23].textContent, 'Soul Class III (Lv 24)');
    assert.match(root(pane).textContent, /You are Soul Class III \(Lv 24\)\./);
});

// ---------------------------------------------------------------------------
// Made-up creatures

test('setup: names neither bestiary knows are tagged new as they are typed; a threat shows beside its power', () => {
    reset();
    const prefill = [
        { name: 'Marsh Wolf', count: 3, rank: null, level: 1, role: null, boss: false, threat: 'weak' },
        { name: 'Wolf', count: 1, rank: null, role: null, boss: false },
    ];
    const pane = render({ mode: 'setup', bestiary: ['Wolf'], known: ['Wolf', 'Grey Wolf'], suggestedRank: 'E', prefill, rules });
    assert.deepEqual($$(pane, '.rpg-battle-new').map(node => node.hidden), [false, true]);
    assert.deepEqual(texts(root(pane), '.rpg-battle-threat'), ['weak']);
    assert.equal($(pane, '.rpg-battle-setup-summary').textContent, '4 enemies. 1 new, made up from its name when the fight starts.');
    const name = $$(pane, '.rpg-battle-enemy-name')[0];
    name.value = 'grey wolf';
    name.dispatch('input');
    assert.equal($$(pane, '.rpg-battle-new')[0].hidden, true, 'an alias is known');
    assert.equal($(pane, '.rpg-battle-setup-summary').textContent, '4 enemies.');
});

test('setup: while foes are being prepared Start waits and the summary says so', () => {
    reset();
    const { handlers, calls } = recorder();
    const pane = render({ mode: 'setup', bestiary: [], suggestedRank: 'E', prefill: [{ name: 'Bog Wight', count: 1 }], preparing: ['Bog Wight'], rules }, handlers);
    assert.equal($(pane, '.rpg-battle-setup-summary').textContent, 'Preparing foes: Bog Wight…');
    assert.equal($(pane, '.rpg-battle-begin').disabled, true);
    $(pane, '.rpg-battle-begin').click();
    assert.equal(calls.filter(call => call.name === 'onStart').length, 0);
});

test('fight: a foe made up for this fight wears a new badge with its look as the title', () => {
    reset();
    const view = fightView();
    view.fight.combatants[2] = { ...view.fight.combatants[2], name: 'Bog Wight', generated: true, fresh: true, look: 'A drowned knight.' };
    view.fight.combatants[3] = { ...view.fight.combatants[3], generated: true };
    const pane = render(view);
    const wight = card(pane, 'e1');
    const badge = wight.querySelector('.rpg-battle-badge.is-new');
    assert.ok(badge);
    assert.equal(badge.textContent, 'new');
    assert.equal(badge.title, 'A drowned knight.');
    assert.equal(wight.querySelector('.rpg-battle-card-name').title, 'A drowned knight.');
    assert.equal(card(pane, 'e2').querySelector('.rpg-battle-badge.is-new'), null, 'met before: no tag');
});

test('idle: the Bestiary fold lists this story\'s creatures with Regenerate, Forget (asked twice), Export and Import', () => {
    reset();
    const { handlers, calls, last } = recorder();
    const bestiary = [
        { name: 'Bog Wight', power: 'Level 12 (rank C)', role: 'brute', template: 'undead', traits: ['armoured', 'slow'], look: 'A drowned knight.', flavoured: true },
        { name: 'Marsh Wolf', power: 'Level 4 (rank E)', role: 'skirmisher', template: 'beast', traits: ['swift'], look: '', flavoured: false },
    ];
    const pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, bestiary }, handlers);
    const fold = $(pane, '.rpg-battle-fold.is-bestiary');
    assert.ok(fold);
    assert.equal(fold.querySelector('.rpg-battle-count').textContent, '2');
    const rows = $$(pane, '.rpg-battle-creature');
    assert.deepEqual(rows.map(row => row.dataset.creature), ['Bog Wight', 'Marsh Wolf']);
    assert.equal(rows[0].querySelector('.rpg-battle-record-meta').textContent, 'Level 12 (rank C) · brute · armoured, slow');
    assert.equal(rows[0].querySelector('.rpg-battle-creature-look').textContent, 'A drowned knight.');
    assert.equal(rows[0].querySelector('.rpg-battle-creature-plain'), null);
    assert.ok(rows[1].querySelector('.rpg-battle-creature-plain'), 'an unflavoured one says so');
    rows[0].querySelector('.rpg-battle-creature-regenerate').click();
    assert.deepEqual(last('onRegenerateCreature').args, ['Bog Wight']);
    $$(pane, '.rpg-battle-creature-forget')[1].click();
    assert.equal(calls.filter(call => call.name === 'onForgetCreature').length, 0, 'the first click only arms it');
    const armed = $$(pane, '.rpg-battle-creature-forget')[1];
    assert.ok(armed.textContent.includes('Click again'));
    armed.click();
    assert.deepEqual(last('onForgetCreature').args, ['Marsh Wolf']);
    $(pane, '.rpg-battle-bestiary-export').click();
    assert.ok(last('onExportBestiary'));
    assert.ok($(pane, '.rpg-battle-bestiary-import'));
    assert.equal($(pane, '.rpg-battle-bestiary-file').hidden, true);
    // Empty: a hint and Import only.
    const empty = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, bestiary: [] });
    assert.equal($(empty, '.rpg-battle-bestiary-export'), null);
    assert.ok($(empty, '.rpg-battle-bestiary-import'));
    assert.match($(empty, '.rpg-battle-fold.is-bestiary .rpg-battle-hint').textContent, /made up when its fight starts/);
});

test('idle: Gear lists what the fight uses, capped stats, and what does not count', () => {
    const gear = {
        counted: [
            { name: 'Iron Sword', slot: 'weapon', stats: { ATK: 6 }, capped: false, from: null },
            { name: 'Ring of Giants', slot: 'accessory', stats: { STR: 2 }, capped: true, from: { STR: 20 } },
            { name: 'Iron Helm', slot: 'worn', stats: { DEF: 4 }, capped: false, from: null },
        ],
        unused: [{ name: 'Silver Ring', slot: 'accessory', why: 'only 2 accessories count' }],
    };
    let pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, gear });
    assert.deepEqual(texts(root(pane), '.rpg-battle-gear .rpg-battle-record-name'), ['Iron Sword', 'Ring of Giants', 'Iron Helm']);
    assert.deepEqual(texts(root(pane), '.rpg-battle-gear .rpg-battle-tag'), ['weapon', 'accessory', 'worn piece']);
    assert.ok($(pane, '.rpg-battle-member-card.is-you .rpg-battle-gear'), 'on your card');
    assert.deepEqual(texts(root(pane), '.rpg-battle-gear .rpg-battle-record-meta'), ['ATK +6', 'STR +2 · capped from STR +20', 'DEF +4']);
    assert.equal(root(pane).querySelectorAll('.rpg-battle-gear.is-capped').length, 1);
    assert.deepEqual(texts(root(pane), '.rpg-battle-gear-unused'), ['Not counted: Silver Ring (only 2 accessories count)']);
    pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, gear: { counted: [], unused: [] } });
    assert.match(texts(root(pane), '.is-gear .rpg-battle-hint')[0], /Nothing equipped/);
    assert.equal(root(pane).querySelectorAll('.rpg-battle-gear-unused').length, 0);
    pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules });
    assert.equal(root(pane).querySelectorAll('.is-gear').length, 0, 'no gear in the view: no section');
});

// ---------------------------------------------------------------------------
// 0.4: party cards, skills set aside, companions' gear, Start over, offers, party files

test('cards: skills in use and set aside; Set aside and Use send onSetSkillActive, Use waits at the cap', () => {
    reset();
    const { handlers, calls } = recorder();
    const three = { ...rules, character: { ...rules.character, activeSkills: 2 } };
    const you = sheet({ skills: [{ name: 'Quick Jab', mastery: 1 }, { name: 'Spark', mastery: 1 }, { name: 'Mend', mastery: 3, aside: true }] });
    const skills = [{ ...skill('Quick Jab'), mastery: 1 }, { ...skill('Spark', { type: 'magic' }), mastery: 1 }, { ...skill('Mend', { type: 'heal' }), mastery: 3, aside: true }];
    const party = [{ id: 'astra', name: 'Astra', role: 'healer', control: 'auto', sheet: sheet({ name: 'Astra', skills: [{ name: 'Ward', mastery: 1 }, { name: 'Rally', mastery: 1, aside: true }] }), gear: [] }];
    const pane = render({ mode: 'idle', sheet: you, skills, party, rules: three }, handlers);
    const mine = $(pane, '.rpg-battle-member-card.is-you');
    assert.deepEqual(texts(mine, '.rpg-battle-skill:not(.is-aside) .rpg-battle-record-name'), ['Quick Jab', 'Spark']);
    assert.deepEqual(texts(mine, '.rpg-battle-skill.is-aside .rpg-battle-record-name'), ['Mend']);
    assert.equal(mine.querySelector('.rpg-battle-skill-count').textContent, '2/2');
    assert.equal(mine.querySelector('.rpg-battle-skill-use').disabled, true, 'at the cap: set one aside first');
    mine.querySelectorAll('.rpg-battle-skill-aside')[1].click();
    assert.deepEqual(calls.at(-1), { name: 'onSetSkillActive', args: ['pc', 'Spark', false] });
    // A companion's names only (no resolved skills sent): still listed, Use allowed under the cap.
    const astra = $(pane, '.rpg-battle-member-card.rpg-battle-member');
    assert.deepEqual(texts(astra, '.rpg-battle-skill .rpg-battle-record-name'), ['Ward', 'Rally']);
    astra.querySelector('.rpg-battle-skill-use').click();
    assert.deepEqual(calls.at(-1), { name: 'onSetSkillActive', args: ['astra', 'Rally', true] });
});

test('cards: Spend for you and commanded companions (auto ones only with auto-spend off); Give item and Take back', () => {
    reset();
    const { handlers, calls } = recorder();
    const gearSummary = { counted: [{ name: 'Ashwood Staff', slot: 'weapon', stats: { MATK: 5 }, capped: true, from: { MATK: 7 } }], unused: [{ name: 'Second Staff', slot: 'weapon', why: 'one weapon counts' }] };
    const party = [
        { id: 'astra', name: 'Astra', role: 'healer', control: 'auto', sheet: sheet({ name: 'Astra', points: 4 }), gear: [], gearSummary },
        { id: 'merrit', name: 'Merrit', role: 'guard', control: 'command', sheet: sheet({ name: 'Merrit', points: 4 }), gear: [] },
    ];
    const giveable = [{ name: 'Iron Helm', slot: 'worn', rarity: 'common', stats: { DEF: 2 } }];
    const view = autoSpend => ({ mode: 'idle', sheet: sheet({ points: 0 }), skills: [], party, rules, giveable, autoSpend });
    let pane = render(view(true), handlers);
    const card = id => $$(pane, '.rpg-battle-member-card').find(node => node.dataset.memberId === id);
    assert.equal(card('pc').querySelector('.rpg-battle-spend'), null, 'no points, no Spend');
    assert.equal(card('astra').querySelector('.rpg-battle-spend'), null, 'auto companions spend on their own');
    assert.match(card('astra').querySelector('.rpg-battle-points-text').textContent, /spent on their next level/);
    card('merrit').querySelector('.rpg-battle-spend').click();
    assert.deepEqual(calls.at(-1), { name: 'onSpend', args: ['merrit'] });
    pane = render(view(false), handlers);
    card('astra').querySelector('.rpg-battle-spend').click();
    assert.deepEqual(calls.at(-1), { name: 'onSpend', args: ['astra'] });

    // Gear on the card, capped, with Take back; Give item lists your Inventory's equipment.
    assert.deepEqual(texts(card('astra'), '.rpg-battle-gear .rpg-battle-record-meta'), ['MATK +5 · capped from MATK +7', 'no stats · not counted: one weapon counts']);
    card('astra').querySelector('.rpg-battle-take-back').click();
    assert.deepEqual(calls.at(-1), { name: 'onTakeBack', args: ['astra', 'Ashwood Staff'] });
    card('astra').querySelector('.rpg-battle-give-open').click();
    assert.deepEqual(texts(card('astra'), '.rpg-battle-give-item .rpg-battle-record-name'), ['Iron Helm']);
    card('astra').querySelector('.rpg-battle-give-confirm').click();
    assert.deepEqual(calls.at(-1), { name: 'onGiveItem', args: ['astra', 'Iron Helm'] });
    assert.equal(card('astra').querySelector('.rpg-battle-give'), null, 'the list closes');
    assert.equal(card('merrit').querySelector('.rpg-battle-learn-member'), null, 'skills come from the story');
});

test('cards: Start over asks twice, with Keep companions; a fight lost to the death shows the game over', () => {
    reset();
    const { handlers, calls } = recorder();
    const party = [{ id: 'astra', name: 'Astra', role: 'healer', control: 'auto', sheet: sheet({ name: 'Astra' }), gear: [] }];
    let pane = render({ mode: 'idle', sheet: sheet(), skills: [], party, rules }, handlers);
    $(pane, '.rpg-battle-start-over').click();
    assert.equal(calls.length, 0, 'the first click only arms it');
    assert.match($(pane, '.rpg-battle-start-over').textContent, /Click again/);
    const keep = $(pane, '.rpg-battle-keep-companions');
    assert.equal(keep.checked, true);
    keep.checked = false;
    keep.dispatch('change');
    $(pane, '.rpg-battle-start-over').click();
    assert.deepEqual(calls.at(-1), { name: 'onStartOver', args: [{ keepCompanions: false }] });

    reset();
    pane = render({ mode: 'idle', sheet: sheet({ hp: { cur: 0, max: 62 } }), skills: [], party: [], rules, gameOver: { name: 'Ren' } }, handlers);
    assert.equal($(pane, '.rpg-battle-game-over-text').textContent, 'Ren has died.');
    assert.equal($(pane, '.rpg-battle-start'), null, 'no fights after death');
    assert.equal($(pane, '.rpg-battle-keep-companions'), null, 'no companions to keep');
    $(pane, '.rpg-battle-start-over').click();
    $(pane, '.rpg-battle-start-over').click();
    assert.deepEqual(calls.at(-1), { name: 'onStartOver', args: [{ keepCompanions: false }] });
    assert.ok($(pane, '.rpg-battle-party-import'));
});

test('offers: each with its own Accept and Not now; one that asks twice; model text stays text', () => {
    reset();
    const { handlers, calls } = recorder();
    const offers = [
        { key: '7:joins:Lyra', kind: 'joins', text: 'Lyra joined. Add as companion?', accept: 'Add as companion' },
        { key: '7:xp:major', kind: 'xp', text: '+25 XP: <b>rescued</b> the caravan. Award?', accept: 'Award' },
        { key: 'fallen:astra', kind: 'fallen', text: 'Astra fell. Remove from the party?', accept: 'Remove', confirm: true },
    ];
    const pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, offers }, handlers);
    assert.deepEqual(texts(root(pane), '.rpg-battle-offer-text'), offers.map(offer => offer.text));
    assert.equal(root(pane).querySelectorAll('b').length, 0);
    const notice = key => $$(pane, '.rpg-battle-notice.is-offer').find(node => node.dataset.offer === key);
    notice('7:joins:Lyra').querySelector('.rpg-battle-offer-accept').click();
    notice('7:xp:major').querySelector('.rpg-battle-offer-dismiss').click();
    assert.deepEqual(calls.map(call => [call.name, ...call.args]), [['onAcceptOffer', '7:joins:Lyra'], ['onDismissOffer', '7:xp:major']]);
    notice('fallen:astra').querySelector('.rpg-battle-offer-accept').click();
    assert.equal(calls.length, 2, 'asks twice');
    assert.match(notice('fallen:astra').querySelector('.rpg-battle-offer-accept').textContent, /Click again/);
    notice('fallen:astra').querySelector('.rpg-battle-offer-accept').click();
    assert.deepEqual(calls.at(-1), { name: 'onAcceptOffer', args: ['fallen:astra'] });
});

test('party file: Export, Import (a picked file goes to the glue) and the confirm notice', () => {
    reset();
    const { handlers, calls } = recorder();
    const pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, importing: { summary: 'Load Ren (Level 4) and 1 companion into this chat?', note: 'Your gear goes into the Inventory: Iron Sword.' } }, handlers);
    assert.equal($(pane, '.rpg-battle-import-text').textContent, 'Load Ren (Level 4) and 1 companion into this chat?');
    $(pane, '.rpg-battle-import-confirm').click();
    $(pane, '.rpg-battle-import-cancel').click();
    $(pane, '.rpg-battle-party-export').click();
    assert.deepEqual(calls.map(call => call.name), ['onConfirmImport', 'onCancelImport', 'onExportParty']);
    assert.equal($(pane, '.rpg-battle-party-file').hidden, true);
});

test('learn: at the cap it asks which skill sits out; a companion learns; the story\'s skill prefills the template', () => {
    reset();
    const { handlers, last } = recorder();
    const two = { ...rules, character: { ...rules.character, activeSkills: 2 } };
    const lyra = sheet({ name: 'Lyra', stats: stats({ INT: 6 }), skills: [{ name: 'Quick Jab', mastery: 1 }, { name: 'Spark', mastery: 1 }] });
    const prefill = { name: 'Frost Lance', type: 'magic', stat: 'INT', target: 'all', element: 'ice', words: 'ice magic, hits all' };
    const pane = render({ mode: 'learn', sheet: lyra, library: [...LIBRARY, ...TIER2], rules: two, memberId: 'lyra', prefill }, handlers);
    assert.match($(pane, '.rpg-battle-section.is-learn-intro').textContent, /From the story: Frost Lance \(ice magic, hits all\)/);
    assert.equal($(pane, '.rpg-battle-template-name').value, 'Frost Lance');
    assert.deepEqual([$(pane, '.rpg-battle-template-type').value, $(pane, '.rpg-battle-template-target').value, $(pane, '.rpg-battle-template-element').value], ['magic', 'all', 'ice']);
    assert.equal($(pane, '.rpg-battle-learn-template').disabled, true, 'at the cap, choose first');
    const aside = $(pane, '.rpg-battle-learn-aside');
    assert.deepEqual(aside.querySelectorAll('option').map(node => node.textContent), ['Choose one to set aside…', 'Set aside Quick Jab', 'Set aside Spark', 'Keep the new skill set aside']);
    aside.value = 'Quick Jab';
    aside.dispatch('change');
    $(pane, '.rpg-battle-learn-template').click();
    assert.deepEqual(last('onConfirmLearn').args[0], { name: 'Frost Lance', template: { type: 'magic', stat: 'INT', target: 'all', element: 'ice' }, setAside: 'Quick Jab', memberId: 'lyra' });
    const keepNew = $(pane, '.rpg-battle-learn-aside');
    keepNew.value = keepNew.querySelectorAll('option').at(-1).value;
    keepNew.dispatch('change');
    $(pane, '.rpg-battle-learn-template').click();
    assert.equal(last('onConfirmLearn').args[0].setAside, 'Frost Lance');
    // A library skill's name is learned from the library, with its requirements.
    const name = $(pane, '.rpg-battle-template-name');
    name.value = 'fireball';
    name.dispatch('input');
    assert.equal($(pane, '.rpg-battle-learn-template').disabled, true);
    assert.match($(pane, '.rpg-battle-template-hint').textContent, /Fireball is in the library: learn it there \(it needs INT 8\)/);
    assert.match($$(pane, '.rpg-battle-library-skill').find(node => node.dataset.skill === 'Fireball').textContent, /INT 8 \(has 6\)/);
});

test('spend: a companion\'s points, sent with their id', () => {
    reset();
    const { handlers, last } = recorder();
    const pane = render({ mode: 'spend', sheet: sheet({ name: 'Merrit', points: 1 }), memberId: 'merrit', rules }, handlers);
    assert.match($(pane, '.rpg-battle-section.is-spend').textContent, /Spend points: Merrit/);
    plus(pane, 'VIT').click();
    $(pane, '.rpg-battle-confirm').click();
    assert.deepEqual(last('onConfirmSpend').args, [{ STR: 0, VIT: 1, AGI: 0, DEX: 0, INT: 0, LUK: 0, CHA: 0 }, 'merrit']);
});

test('cards: Dossier only for a companion linked to an NPC State Delta dossier', () => {
    reset();
    const { handlers, calls } = recorder();
    const party = [
        { id: 'lyra', name: 'Lyra', role: 'healer', control: 'auto', sheet: sheet({ name: 'Lyra' }), gear: [], dossier: true },
        { id: 'bram', name: 'Bram', role: 'guard', control: 'auto', sheet: sheet({ name: 'Bram' }), gear: [] },
    ];
    const pane = render({ mode: 'idle', sheet: sheet(), skills: [], party, rules }, handlers);
    const card = id => $$(pane, '.rpg-battle-member-card').find(node => node.dataset.memberId === id);
    assert.equal(card('bram').querySelector('.rpg-battle-dossier'), null);
    card('lyra').querySelector('.rpg-battle-dossier').click();
    assert.deepEqual(calls.at(-1), { name: 'onOpenDossier', args: ['lyra'] });
});

test('setup: a story fight in engagements tags the later ones and sends their wave', () => {
    reset();
    const { handlers, last } = recorder();
    const prefill = [{ name: 'Bandit', count: 3 }, { name: 'Bandit Captain', count: 1, boss: true, wave: 1 }];
    const pane = render({ mode: 'setup', bestiary: ['Bandit', 'Bandit Captain'], suggestedRank: 'E', prefill, rules }, handlers);
    assert.deepEqual(texts(root(pane), '.rpg-battle-wave'), ['then 2']);
    $(pane, '.rpg-battle-begin').click();
    assert.deepEqual(last('onStart').args[0].rows.map(row => [row.name, row.wave ?? 0]), [['Bandit', 0], ['Bandit Captain', 1]]);
});

test('two tabs at once: a click in one pane redraws that pane, not the one drawn last', () => {
    reset();
    const party = [{ id: 'astra', name: 'Astra', role: 'companion', control: 'auto', sheet: sheet({ name: 'Astra' }), gear: [] }];
    const partyPane = render({ mode: 'idle', sheet: sheet(), skills: [], party, rules });
    const battlePane = render({ mode: 'offer', encounter: { text: '2 wolf', rows: [{ name: 'Wolf', count: 2 }] } });
    $(partyPane, '.rpg-battle-remove-companion').click();
    assert.match($(partyPane, '.rpg-battle-remove-companion').textContent, /Click again/, 'the Party pane redrew itself');
    assert.equal(root(battlePane).dataset.mode, 'offer', 'the Battle pane is untouched');
});
