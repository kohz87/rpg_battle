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

// A different mode in between drops every draft, so tests start clean.
const reset = () => render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules });

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

test('create: a preset fills points and skills; exactly three skills; onCreate gets the draft', () => {
    reset();
    const { handlers, last } = recorder();
    const pane = render({ mode: 'create', presets: PRESETS, library: [...LIBRARY, ...TIER2], rules }, handlers);
    // Tier-2 skills never show in the starter picker.
    assert.deepEqual(texts(root(pane), '.rpg-battle-skill-pick .rpg-battle-pick-name'), LIBRARY.map(entry => entry.name));
    const pick = $$(pane, '.rpg-battle-skill-pick').find(node => node.dataset.skill === 'Power Strike');
    assert.match(pick.textContent, /physical · 5 MP · cooldown 1/);
    assert.match(pick.textContent, /Power Strike description/);

    $$(pane, '.rpg-battle-preset').find(node => node.dataset.preset === 'fighter').click();
    assert.equal(valueOf(pane, 'STR'), '9');
    assert.equal(valueOf(pane, 'VIT'), '8');
    assert.match($(pane, '.rpg-battle-remaining').textContent, /^0 of 10/);
    assert.equal($$(pane, '.rpg-battle-preset').find(node => node.dataset.preset === 'fighter').getAttribute('aria-pressed'), 'true');
    const pressed = () => $$(pane, '.rpg-battle-skill-pick').filter(node => node.getAttribute('aria-pressed') === 'true').map(node => node.dataset.skill);
    assert.deepEqual(pressed(), ['Power Strike', 'Quick Jab', 'Guard Up']);
    const spark = $$(pane, '.rpg-battle-skill-pick').find(node => node.dataset.skill === 'Spark');
    assert.equal(spark.disabled, true, 'a fourth skill cannot be picked');

    // Live preview from rules: VIT 8 at level 1.
    assert.equal(factValue(pane, 'Max HP'), String(maxHp({ VIT: 8 }, 1, rules)));
    assert.equal(factValue(pane, 'Attack'), '18');

    assert.equal($(pane, '.rpg-battle-create').disabled, true, 'no name yet');
    const name = $(pane, '.rpg-battle-name-input');
    name.value = '  Ren  ';
    name.dispatch('input');
    assert.equal($(pane, '.rpg-battle-create').disabled, false);
    $(pane, '.rpg-battle-create').click();
    const call = last('onCreate');
    assert.deepEqual(call.args[0], {
        name: 'Ren',
        stats: { STR: 9, VIT: 8, AGI: 6, DEX: 7, INT: 5, LUK: 5, CHA: 5 },
        skills: ['Power Strike', 'Quick Jab', 'Guard Up'],
    });
});

test('create: a preset naming a missing skill fills what exists; toggling a skill frees a slot; draft survives a redraw', () => {
    reset();
    const view = { mode: 'create', presets: PRESETS, library: LIBRARY, rules };
    const pane = render(view);
    $$(pane, '.rpg-battle-preset').find(node => node.dataset.preset === 'caster').click();
    const pressed = () => $$(pane, '.rpg-battle-skill-pick').filter(node => node.getAttribute('aria-pressed') === 'true').map(node => node.dataset.skill);
    assert.deepEqual(pressed(), ['Spark', 'Mend']);
    assert.match($(pane, '.rpg-battle-create-hint').textContent, /a name/);
    assert.match($(pane, '.rpg-battle-create-hint').textContent, /1 more skill/);
    $$(pane, '.rpg-battle-skill-pick').find(node => node.dataset.skill === 'Quick Jab').click();
    // Picks read in library order.
    assert.deepEqual(pressed(), ['Quick Jab', 'Spark', 'Mend']);
    $$(pane, '.rpg-battle-skill-pick').find(node => node.dataset.skill === 'Spark').click();
    assert.deepEqual(pressed(), ['Quick Jab', 'Mend']);
    // Manual changes clear the preset mark.
    assert.equal($$(pane, '.rpg-battle-preset').every(node => node.getAttribute('aria-pressed') === 'false'), true);

    // The glue redraws on chat events: the half-made character is still there.
    renderBattleTab(pane, view, {});
    assert.equal(valueOf(pane, 'INT'), '11');
    assert.deepEqual(pressed(), ['Quick Jab', 'Mend']);
    // Leaving the mode drops the draft.
    renderBattleTab(pane, { mode: 'idle', sheet: sheet(), rules }, {});
    renderBattleTab(pane, view, {});
    assert.equal(valueOf(pane, 'INT'), '5');
});

// ---------------------------------------------------------------------------
// idle

test('idle: header, bars, stats with checks, skills, party and the main buttons', () => {
    const { handlers, calls } = recorder();
    const party = [{ id: 'astra', name: 'Astra', role: 'companion', control: 'auto', sheet: sheet({ name: 'Astra', level: 3, hp: { cur: 30, max: 44 } }), gear: [] },
        { id: 'merrit', name: 'Merrit', role: 'hireling', control: 'command', sheet: sheet({ name: 'Merrit', level: 2 }), gear: [] }];
    const resolved = [{ ...skill('Rending Strike', { mp: 6, cooldown: 2 }), mastery: 2 }, { ...skill('Quick Jab', { mp: 2 }), mastery: 1 }];
    const checks = { STR: 2, VIT: 1, AGI: 1, DEX: 1, INT: -1, LUK: 0, CHA: 0 };
    const pane = render({ mode: 'idle', sheet: sheet({ conditions: [{ name: 'poison', rounds: 2 }] }), checks, skills: resolved, party, rules, pending: null }, handlers);

    assert.equal($(pane, '.rpg-battle-head-name').textContent, 'Ren');
    assert.equal($(pane, '.rpg-battle-level').textContent, 'Level 4');
    const bars = $$(pane, '.rpg-battle-section.is-sheet [role="progressbar"]');
    assert.deepEqual(bars.map(node => [node.getAttribute('aria-valuenow'), node.getAttribute('aria-valuemax')]), [['58', '62'], ['21', '30'], ['310', String(xpToNext(4, rules))]]);
    assert.equal(bars[0].querySelector('.rpg-battle-bar-fill').style.width, '94%');
    assert.deepEqual(texts(root(pane), '.rpg-battle-section.is-sheet .rpg-battle-chip'), ['poison 2']);

    const stat = name => $$(pane, '.rpg-battle-stat').find(node => node.dataset.stat === name);
    assert.equal(stat('STR').querySelector('.rpg-battle-stat-value').textContent, '9');
    assert.equal(stat('STR').querySelector('.rpg-battle-stat-check').textContent, '+2');
    assert.equal(stat('INT').querySelector('.rpg-battle-stat-check').textContent, '-1');

    assert.equal($(pane, '.rpg-battle-points-text').textContent, '2 unspent points');
    assert.deepEqual(texts(root(pane), '.rpg-battle-skill .rpg-battle-record-name'), ['Rending Strike', 'Quick Jab']);
    assert.match($(pane, '.rpg-battle-skill .rpg-battle-record-meta').textContent, /physical · 6 MP · cooldown 2/);
    assert.equal($(pane, '.rpg-battle-skill .rpg-battle-tag').textContent, 'Lv 2');

    assert.deepEqual(texts(root(pane), '.rpg-battle-member .rpg-battle-record-name'), ['Astra', 'Merrit']);
    assert.deepEqual(texts(root(pane), '.rpg-battle-member .rpg-battle-control'), ['Acts on its own', 'You command']);
    assert.equal($(pane, '.rpg-battle-member [role="progressbar"]').getAttribute('aria-valuenow'), '30');

    assert.equal($(pane, '.rpg-battle-notice'), null, 'no pending notice');
    $(pane, '.rpg-battle-spend').click();
    $(pane, '.rpg-battle-start').click();
    $(pane, '.rpg-battle-learn').click();
    assert.deepEqual(calls.map(call => call.name), ['onSpend', 'onSetup', 'onLearn']);
});

test('idle: the State words sit quietly under the HP and MP bars', () => {
    let pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules });
    const state = $(pane, '.rpg-battle-section.is-sheet .rpg-battle-state');
    assert.equal(state.textContent, 'unhurt');
    assert.equal(state.tagName.toLowerCase(), 'p');
    assert.match(state.className, /rpg-battle-hint/);
    const kids = $(pane, '.rpg-battle-section.is-sheet').children;
    const index = kids.indexOf(state);
    assert.equal(kids[index - 1].getAttribute('aria-label'), 'MP', 'right under the MP bar');
    pane = render({ mode: 'idle', sheet: sheet({ hp: { cur: 15, max: 62 }, mp: { cur: 3, max: 30 }, conditions: [{ name: 'poison', rounds: 2 }] }), skills: [], party: [], rules });
    assert.equal($(pane, '.rpg-battle-state').textContent, 'badly hurt (bleeding, slow to move) · drained of magic · poisoned');
    pane = render({ mode: 'idle', sheet: sheet({ hp: { cur: 0, max: 62 } }), skills: [], party: [], rules });
    assert.equal($(pane, '.rpg-battle-state').textContent, 'down (unconscious or unable to fight)');
});

test('idle: rests, Use item, Add companion, a companion\'s control and two-click Remove', () => {
    const { handlers, calls } = recorder();
    const party = [{ id: 'astra', name: 'Astra', role: 'companion', control: 'auto', sheet: sheet({ name: 'Astra', level: 3 }), gear: [] }];
    let pane = render({ mode: 'idle', sheet: sheet({ name: 'Ren', level: 4 }), skills: [], party, rules, recovered: '8 hours passed: Ren is fully rested.' }, handlers);
    assert.match($(pane, '.rpg-battle-recovered').textContent, /fully rested/);
    $(pane, '.rpg-battle-rest-short').click();
    $(pane, '.rpg-battle-rest-long').click();
    $(pane, '.rpg-battle-items').click();
    $(pane, '.rpg-battle-add-companion').click();
    $(pane, '.rpg-battle-member .rpg-battle-control').click();
    assert.deepEqual(calls.map(call => [call.name, ...call.args]), [['onRest', 'short'], ['onRest', 'long'], ['onItems'], ['onCompanion'], ['onSetControl', 'astra', 'command']]);
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

test('companion: name, role, level, build, control and equipment go to onAddCompanion', () => {
    const { handlers, calls } = recorder();
    const presets = [{ id: 'healer', name: 'Healer', points: { INT: 4, VIT: 3, CHA: 3 }, skills: ['Mend', 'Firebolt', 'Rally'] }, { id: 'fighter', name: 'Fighter', points: { STR: 4, VIT: 3, DEX: 3 }, skills: ['Power Strike'] }];
    const pane = render({ mode: 'companion', presets, level: 4, maxLevel: 20, rules }, handlers);
    assert.ok($(pane, '.rpg-battle-companion-add').disabled, 'needs a name');
    const name = $(pane, '.rpg-battle-companion-name');
    name.value = 'Astra';
    name.dispatch('input');
    assert.equal($(pane, '.rpg-battle-companion-level').value, '4', 'your level by default');
    const build = $(pane, '.rpg-battle-companion-preset');
    build.value = 'fighter';
    build.dispatch('change');
    const control = $(pane, '.rpg-battle-companion-control');
    control.value = 'command';
    control.dispatch('change');
    const gear = $(pane, '.rpg-battle-companion-gear');
    gear.value = 'Ashwood Staff (rare) · MATK +7';
    gear.dispatch('input');
    $(pane, '.rpg-battle-companion-add').click();
    assert.deepEqual(calls.at(-1), { name: 'onAddCompanion', args: [{ name: 'Astra', role: 'companion', control: 'command', level: 4, presetId: 'fighter', gearLines: 'Ashwood Staff (rare) · MATK +7' }] });
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
    assert.deepEqual(last('onConfirmLearn').args[0], { name: 'Tidebreaker', template: { type: 'magic', stat: 'CHA', target: 'one' } });
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

test('idle: a fight the story starts is offered: Fight? sends its rows, Not now dismisses it', () => {
    reset();
    const { handlers, calls } = recorder();
    const rows = [{ name: 'Bandit', count: 3, rank: null, role: null, boss: false }, { name: 'Bandit Captain', count: 1, rank: null, role: null, boss: true }];
    const pane = render({
        mode: 'idle', sheet: sheet(), skills: [], party: [], rules,
        encounter: { text: '3 bandit, bandit captain (boss)', label: 'Planned by Story Director: Ambush at the weir.', rows },
    }, handlers);
    assert.equal($(pane, '.rpg-battle-encounter-text').textContent, 'A fight is starting: 3 bandit, bandit captain (boss)');
    assert.match($(pane, '.rpg-battle-encounter-label').textContent, /Ambush at the weir/);
    assert.equal(buttonByText(pane, 'Fight?'), $(pane, '.rpg-battle-encounter-fight'));
    $(pane, '.rpg-battle-encounter-fight').click();
    $(pane, '.rpg-battle-encounter-dismiss').click();
    assert.deepEqual(calls.map(call => call.name), ['onFightEncounter', 'onDismissEncounter']);
    assert.deepEqual(calls[0].args[0], rows);
    assert.notEqual(calls[0].args[0][0], rows[0], 'the handler gets copies');
    const quiet = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, encounter: null });
    assert.equal($(quiet, '.rpg-battle-encounter-text'), null);
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
    const xpBar = $$(pane, '.rpg-battle-section.is-sheet [role="progressbar"]')[2];
    assert.equal(xpBar.getAttribute('aria-label'), 'Soul Growth');
    assert.equal(xpBar.querySelector('.rpg-battle-bar-name').textContent, 'Soul Growth');
    assert.equal(xpBar.querySelector('.rpg-battle-bar-value').textContent, '26.34/100');
    assert.ok(xpBar.classList.contains('is-named'));
    assert.equal($(pane, '.rpg-battle-member-level').textContent, 'Soul Class II');
    pane = render({ mode: 'idle', sheet: sheet({ level: 100, xp: 0 }), skills: [], party: [], rules: SOUL });
    assert.equal($$(pane, '.rpg-battle-section.is-sheet [role="progressbar"]')[2].querySelector('.rpg-battle-bar-value').textContent, 'MAX');
    pane = render({ mode: 'idle', sheet: sheet(), skills: [], party, rules: POWER });
    assert.equal($(pane, '.rpg-battle-level').textContent, 'Soul Power 4');
    assert.equal($(pane, '.rpg-battle-member-level').textContent, 'Soul Power 12');
    assert.equal($$(pane, '.rpg-battle-section.is-sheet [role="progressbar"]')[2].querySelector('.rpg-battle-bar-value').textContent, `310/${xpToNext(4, rules)}`);
    pane = render({ mode: 'idle', sheet: sheet(), skills: [], party, rules });
    assert.equal($(pane, '.rpg-battle-member-level').textContent, 'Lv 12', 'the plain terms as before');
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
    render({ mode: 'setup', bestiary: [], suggestedRank: 'E', rules });
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
    assert.deepEqual(texts(root(pane), '.rpg-battle-gear .rpg-battle-record-meta'), ['ATK +6', 'STR +2 · capped from STR +20', 'DEF +4']);
    assert.equal(root(pane).querySelectorAll('.rpg-battle-gear.is-capped').length, 1);
    assert.deepEqual(texts(root(pane), '.rpg-battle-gear-unused'), ['Not counted: Silver Ring (only 2 accessories count)']);
    pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules, gear: { counted: [], unused: [] } });
    assert.match(texts(root(pane), '.rpg-battle-section.is-gear .rpg-battle-hint')[0], /Nothing equipped/);
    assert.equal(root(pane).querySelectorAll('.rpg-battle-gear-unused').length, 0);
    pane = render({ mode: 'idle', sheet: sheet(), skills: [], party: [], rules });
    assert.equal(root(pane).querySelectorAll('.rpg-battle-section.is-gear').length, 0, 'no gear in the view: no section');
});
