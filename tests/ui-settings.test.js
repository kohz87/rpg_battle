// The settings panel against the fake DOM: the switch, the money and the block tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './ui-fake-dom.js';

const doc = installFakeDom();
const { renderSettings, textToTiers, tiersToText } = await import('../src/ui/settings.js');

const SETTINGS = {
    enabled: true,
    characterTag: 'Character', partyTag: 'Party', inventoryTag: 'Inventory',
    returnMessage: '*(The fight is over.)*',
    currency: { mode: 'tiers', tiers: [{ name: 'copper', rate: 1 }, { name: 'silver', rate: 10 }, { name: 'gold', rate: 10 }], single: 'coins', row: 'Coins' },
};

function mount(settings = SETTINGS) {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const changes = [];
    renderSettings(container, { settings, version: 'v0.1.0', onChange: next => changes.push(next) });
    return { $: selector => container.querySelector(selector), changes };
}

test('tiers text round-trips; the first coin is always rate 1', () => {
    assert.equal(tiersToText(SETTINGS.currency.tiers), 'copper=1, silver=10, gold=10');
    assert.deepEqual(textToTiers('bits=5, marks=12, crowns=20'), [{ name: 'bits', rate: 1 }, { name: 'marks', rate: 12 }, { name: 'crowns', rate: 20 }]);
    assert.deepEqual(textToTiers('shells'), [{ name: 'shells', rate: 1 }]);
    assert.deepEqual(textToTiers(''), []);
});

test('currency mode switches the rows; edits go through onChange', () => {
    const { $, changes } = mount();
    assert.equal($('#rpg_battle_currency_mode').value, 'tiers');
    const mode = $('#rpg_battle_currency_mode');
    mode.value = 'single';
    mode.dispatch('change');
    assert.equal(changes.at(-1).currency.mode, 'single');
    const tiers = $('#rpg_battle_currency_tiers');
    tiers.value = 'bits, marks=12';
    tiers.dispatch('change');
    assert.deepEqual(changes.at(-1).currency.tiers, [{ name: 'bits', rate: 1 }, { name: 'marks', rate: 12 }]);
    const tag = $('#rpg_battle_party_tag');
    tag.value = 'Company';
    tag.dispatch('change');
    assert.equal(changes.at(-1).partyTag, 'Company');
    assert.equal($('#rpg_battle_character_tag'), null, 'one Party block since 0.4: no Character tag');
    const enabled = $('#rpg_battle_enabled');
    enabled.checked = false;
    enabled.dispatch('change');
    assert.equal(changes.at(-1).enabled, false);
});

test('Story Block\'s Character Sheet: a notice with Turn it off, shown and hidden by the glue', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    let turnedOff = 0;
    const panel = renderSettings(container, { settings: SETTINGS, sheetConflict: true, onDisableSheet: () => { turnedOff += 1; } });
    const notice = container.querySelector('.rpg-battle-settings-conflict');
    assert.match(notice.textContent, /Story Block's Character Sheet is also on: two HP values will disagree\./);
    assert.equal(notice.hidden, false);
    assert.equal(turnedOff, 0, 'never turned off on its own');
    container.querySelector('.rpg-battle-settings-sheet-off').click();
    assert.equal(turnedOff, 1);
    panel.setSheetConflict(false);
    assert.equal(notice.hidden, true);
    const quiet = doc.createElement('div');
    renderSettings(quiet, { settings: SETTINGS });
    assert.equal(quiet.querySelector('.rpg-battle-settings-conflict').hidden, true);
});

test('Terms: level name, XP name, tier titles with size and numerals, and the cap', () => {
    const { $, changes } = mount();
    assert.equal($('#rpg_battle_terms_level').value, '', 'empty: the plain "Level"');
    assert.equal($('#rpg_battle_terms_level').placeholder, 'Level');
    assert.equal($('#rpg_battle_terms_tiers').checked, false, 'tier titles are off by default');
    assert.equal($('.rpg-battle-settings-tiers').hidden, true);
    const level = $('#rpg_battle_terms_level');
    level.value = '  Soul Class ';
    level.dispatch('change');
    assert.deepEqual(changes.at(-1).terms, { levelName: 'Soul Class', xpName: 'XP', tiers: null, cap: null });
    const xp = $('#rpg_battle_terms_xp');
    xp.value = 'Soul Growth';
    xp.dispatch('change');
    const tiers = $('#rpg_battle_terms_tiers');
    tiers.checked = true;
    tiers.dispatch('change');
    assert.equal($('.rpg-battle-settings-tiers').hidden, false);
    assert.deepEqual(changes.at(-1).terms, { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' }, cap: null });
    const size = $('#rpg_battle_terms_tier_size');
    size.value = '5.4';
    size.dispatch('change');
    assert.equal(size.value, '5');
    const numerals = $('#rpg_battle_terms_numerals');
    numerals.value = 'arabic';
    numerals.dispatch('change');
    assert.deepEqual(changes.at(-1).terms.tiers, { size: 5, numerals: 'arabic' });
    const cap = $('#rpg_battle_terms_cap');
    cap.value = '100';
    cap.dispatch('change');
    assert.equal(changes.at(-1).terms.cap, 100);
    cap.value = '';
    cap.dispatch('change');
    assert.equal(changes.at(-1).terms.cap, null, 'empty: back to the default cap');
    level.value = '';
    level.dispatch('change');
    assert.equal(changes.at(-1).terms.levelName, 'Level');
    tiers.checked = false;
    tiers.dispatch('change');
    assert.equal(changes.at(-1).terms.tiers, null);
    assert.equal($('.rpg-battle-settings-tiers').hidden, true);
    // Saved terms are shown as saved.
    const saved = mount({ ...SETTINGS, terms: { levelName: 'Circle', xpName: 'Power', tiers: { size: 3, numerals: 'arabic' }, cap: 40 } });
    assert.equal(saved.$('#rpg_battle_terms_level').value, 'Circle');
    assert.equal(saved.$('#rpg_battle_terms_xp').value, 'Power');
    assert.equal(saved.$('#rpg_battle_terms_tiers').checked, true);
    assert.equal(saved.$('#rpg_battle_terms_tier_size').value, '3');
    assert.equal(saved.$('#rpg_battle_terms_numerals').value, 'arabic');
    assert.equal(saved.$('#rpg_battle_terms_cap').value, '40');
});

test('Monsters: flavour on by default, the chat\'s model or a connection profile, the answer length', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const changes = [];
    const profiles = [{ id: 'fast', name: 'Fast' }, { id: 'big', name: 'Big' }];
    renderSettings(container, { settings: SETTINGS, profiles, onChange: next => changes.push(next) });
    const $ = selector => container.querySelector(selector);
    const on = $('#rpg_battle_flavour');
    assert.equal(on.checked, true, 'on by default');
    const model = $('#rpg_battle_flavour_model');
    assert.deepEqual(model.querySelectorAll('option').map(node => node.textContent), ['Same as chat', 'Fast', 'Big']);
    assert.equal(model.value, '');
    model.value = 'fast';
    model.dispatch('change');
    assert.deepEqual(changes.at(-1).flavour.model, { source: 'profile', profileId: 'fast' });
    model.value = '';
    model.dispatch('change');
    assert.deepEqual(changes.at(-1).flavour.model, { source: 'chat' });
    const tokens = $('#rpg_battle_flavour_tokens');
    assert.equal(tokens.value, '400');
    tokens.value = '5000';
    tokens.dispatch('change');
    assert.equal(changes.at(-1).flavour.maxTokens, 2000, 'bounded');
    on.checked = false;
    on.dispatch('change');
    assert.equal(changes.at(-1).flavour.enabled, false);
    assert.equal(model.disabled, true);
    // A saved profile that no longer exists is shown as missing, not silently dropped.
    const other = doc.createElement('div');
    doc.body.appendChild(other);
    renderSettings(other, { settings: { ...SETTINGS, flavour: { enabled: true, model: { source: 'profile', profileId: 'gone' }, maxTokens: 300 } }, profiles: null });
    const select = other.querySelector('#rpg_battle_flavour_model');
    assert.equal(select.value, 'gone');
    assert.ok(select.querySelectorAll('option').map(node => node.textContent).includes('(missing profile)'));
    assert.match(other.textContent, /Connection Manager is off/);
});

test('Source of truth: Automatic, This extension or The other one per shared area, and who the story follows now', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const changes = [];
    const panel = renderSettings(container, {
        settings: SETTINGS,
        sources: { stats: { mine: true, name: 'RPG Battle' }, rolls: { mine: true, name: 'RPG Battle' }, items: { mine: false, name: 'Story Block' } },
        onChange: next => changes.push(next),
    });
    const $ = selector => container.querySelector(selector);
    assert.match(container.textContent, /Source of truth/);
    for (const area of ['stats', 'rolls', 'items']) {
        const select = $(`#rpg_battle_truth_${area}`);
        assert.equal(select.value, 'auto', `${area}: Automatic by default`);
        assert.deepEqual(select.querySelectorAll('option').map(node => [node.value, node.textContent]), [['auto', 'Automatic'], ['mine', 'This extension'], ['theirs', 'The other one']]);
    }
    assert.deepEqual(container.querySelectorAll('.rpg-battle-settings-source').map(node => node.textContent), ['Now: RPG Battle', 'Now: RPG Battle', 'Now: Story Block']);
    const stats = $('#rpg_battle_truth_stats');
    stats.value = 'theirs';
    stats.dispatch('change');
    assert.deepEqual(changes.at(-1).sourceOfTruth, { stats: 'theirs', rolls: 'auto', items: 'auto' });
    const items = $('#rpg_battle_truth_items');
    items.value = 'mine';
    items.dispatch('change');
    assert.deepEqual(changes.at(-1).sourceOfTruth, { stats: 'theirs', rolls: 'auto', items: 'mine' }, 'earlier choices are kept');
    // The glue says who the story follows whenever the suite changes.
    panel.setSources({ stats: { mine: false, name: 'Story Block' }, rolls: { mine: true, name: 'RPG Battle' }, items: { mine: true, name: 'RPG Battle' } });
    assert.deepEqual(container.querySelectorAll('.rpg-battle-settings-source').map(node => node.textContent), ['Now: Story Block', 'Now: RPG Battle', 'Now: RPG Battle']);
    panel.setSources(null);
    assert.deepEqual(container.querySelectorAll('.rpg-battle-settings-source').map(node => node.textContent), ['', '', '']);
    // Saved choices are shown as saved; an unknown one as Automatic.
    const saved = doc.createElement('div');
    renderSettings(saved, { settings: { ...SETTINGS, sourceOfTruth: { stats: 'mine', rolls: 'theirs', items: 'nonsense' } } });
    assert.deepEqual(['stats', 'rolls', 'items'].map(area => saved.querySelector(`#rpg_battle_truth_${area}`).value), ['mine', 'theirs', 'auto']);
});

test('Equipment: how many worn pieces and accessories count, whole numbers 0 to 9', () => {
    const { $, changes } = mount();
    assert.equal($('#rpg_battle_gear_worn').value, '1');
    assert.equal($('#rpg_battle_gear_accessories').value, '2');
    const accessories = $('#rpg_battle_gear_accessories');
    accessories.value = '4.2';
    accessories.dispatch('change');
    assert.equal(accessories.value, '4');
    assert.deepEqual(changes.at(-1).gear, { worn: 1, accessories: 4 });
    const worn = $('#rpg_battle_gear_worn');
    worn.value = '40';
    worn.dispatch('change');
    assert.deepEqual(changes.at(-1).gear, { worn: 9, accessories: 4 });
    worn.value = '';
    worn.dispatch('change');
    assert.equal(worn.value, '1', 'empty goes back to the default');
});

test('the sections fold, closed, each with a one-line summary that follows the settings', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    renderSettings(container, { settings: { ...SETTINGS, gear: { worn: 1, accessories: 2 }, terms: { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' }, cap: null } }, onChange: () => {} });
    const folds = container.querySelectorAll('.story-suite-fold');
    assert.deepEqual(folds.map(node => node.dataset.fold), ['money', 'equipment', 'terms', 'monsters', 'combat', 'party', 'truth', 'diagnostics', 'blocks']);
    assert.ok(folds.every(node => node.open === false), 'all start closed');
    const hint = key => container.querySelector(`.story-suite-fold[data-fold="${key}"] > summary small`).textContent;
    assert.equal(hint('money'), 'copper / silver / gold');
    assert.equal(hint('equipment'), '1 worn · 2 accessories');
    assert.equal(hint('terms'), 'Soul Class · Soul Growth · tiers');
    assert.equal(hint('monsters'), 'Model calls on');
    assert.match(container.querySelector('.story-suite-fold[data-fold="monsters"] > summary b').textContent, /Generated words/);
    assert.equal(hint('truth'), 'Automatic');
    assert.equal(hint('blocks'), 'Party · Inventory');
    assert.equal(hint('party'), '6 active skills · auto-spend');
    assert.equal(hint('combat'), 'Timeline · speed AGI + 10 · stats ≤ 99 · hit 75% ± 3%');
    // The controls live inside their fold, and a change updates its summary.
    const accessories = container.querySelector('.story-suite-fold[data-fold="equipment"] #rpg_battle_gear_accessories');
    accessories.value = '1';
    accessories.dispatch('change');
    assert.equal(hint('equipment'), '1 worn · 1 accessory');
    const truth = container.querySelector('.story-suite-fold[data-fold="truth"] #rpg_battle_truth_stats');
    truth.value = 'mine';
    truth.dispatch('change');
    assert.equal(hint('truth'), '1 chosen by hand');
    // The switches stay outside the folds.
    assert.equal(container.querySelector('.story-suite-fold #rpg_battle_enabled'), null);
});

test('Story Suite: a "Manage all" link above the switches, shown and hidden by the glue', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    let opened = 0;
    const panel = renderSettings(container, { settings: SETTINGS, onOpenSuite: () => { opened += 1; } });
    const link = container.querySelector('.story-suite-manage');
    assert.equal(link.hidden, true, 'hidden unless the glue says the overlay is there');
    assert.match(link.textContent, /Manage all in Story Suite/);
    assert.equal(link.getAttribute('data-story-suite-link'), '', 'marked for Story Block\'s overlay to hide it inside');
    assert.equal(container.querySelectorAll('[data-story-suite-link]').length, 1);
    const content = container.querySelector('.inline-drawer-content');
    assert.equal(content.children[0], link, 'first in the panel, above the switches');
    panel.setSuiteLink(true);
    assert.equal(link.hidden, false);
    container.querySelector('.story-suite-manage .menu_button').click();
    assert.equal(opened, 1);
    panel.setSuiteLink(false);
    assert.equal(link.hidden, true);
    const shown = doc.createElement('div');
    renderSettings(shown, { settings: SETTINGS, suiteLink: true });
    assert.equal(shown.querySelector('.story-suite-manage').hidden, false);
    assert.doesNotThrow(() => shown.querySelector('.story-suite-manage .menu_button').click(), 'no handler: nothing happens');
});

test('Story Suite: choices and the switch changed in the overlay show in the panel', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const changes = [];
    const panel = renderSettings(container, { settings: SETTINGS, onChange: next => changes.push(next) });
    const $ = selector => container.querySelector(selector);
    const hint = () => $('.story-suite-fold[data-fold="truth"] > summary small').textContent;
    panel.setTruth('stats', 'theirs');
    assert.equal($('#rpg_battle_truth_stats').value, 'theirs');
    assert.equal(hint(), '1 chosen by hand');
    panel.setTruth('items', 'nonsense');
    panel.setTruth('scene', 'mine');
    assert.equal($('#rpg_battle_truth_items').value, 'auto', 'an unknown choice is ignored');
    assert.equal(changes.length, 0, 'showing a change made elsewhere does not save it again');
    // A later change in the panel keeps the overlay's choice.
    const rolls = $('#rpg_battle_truth_rolls');
    rolls.value = 'mine';
    rolls.dispatch('change');
    assert.deepEqual(changes.at(-1).sourceOfTruth, { stats: 'theirs', rolls: 'mine', items: 'auto' });
    panel.setEnabled(false);
    assert.equal($('#rpg_battle_enabled').checked, false);
    const tag = $('#rpg_battle_party_tag');
    tag.value = 'Allies';
    tag.dispatch('change');
    assert.equal(changes.at(-1).enabled, false, 'the switch as the overlay left it');
    panel.setEnabled(true);
    assert.equal($('#rpg_battle_enabled').checked, true);
});

test('Party: active skills 3 to 12, companions\' points spent automatically', () => {
    const { $, changes } = mount();
    const active = $('.story-suite-fold[data-fold="party"] #rpg_battle_active_skills');
    assert.equal(active.value, '6');
    active.value = '20';
    active.dispatch('change');
    assert.equal(changes.at(-1).activeSkills, 12);
    assert.equal(active.value, '12');
    active.value = 'x';
    active.dispatch('change');
    assert.equal(changes.at(-1).activeSkills, 6);
    const auto = $('.story-suite-fold[data-fold="party"] #rpg_battle_auto_spend');
    assert.equal(auto.checked, true, 'on by default');
    auto.checked = false;
    auto.dispatch('change');
    assert.equal(changes.at(-1).autoSpend, false);
    assert.equal($('.story-suite-fold[data-fold="party"] > summary small').textContent, '6 active skills · points by hand');
    assert.equal($('#rpg_battle_party_tab'), null, 'RPG Battle\'s Party tab shows the party: the block has none of its own');
});

test('Party: the XP rate, 1 by default, 0.25 to 5 on steps of 0.05, in a Story Suite row (0.5.2)', () => {
    const { $, changes } = mount();
    const rate = $('.story-suite-fold[data-fold="party"] #rpg_battle_xp_rate');
    assert.ok(rate, 'in the Party fold');
    assert.equal(rate.value, '1');
    assert.deepEqual([rate.getAttribute('type'), rate.getAttribute('min'), rate.getAttribute('max'), rate.getAttribute('step')], ['number', '0.25', '5', '0.05']);
    const label = $('label.story-suite-row[for="rpg_battle_xp_rate"]');
    assert.equal(label.querySelector('b').textContent, 'XP rate');
    assert.equal(label.querySelector('.rpg-battle-settings-hint').textContent, 'Multiplies all XP: fights, quests and story awards.');
    for (const [typed, kept] of [['2', 2], ['9', 5], ['0.1', 0.25], ['1.33', 1.35], ['', 1], ['fast', 1]]) {
        rate.value = typed;
        rate.dispatch('change');
        assert.equal(changes.at(-1).xpRate, kept, typed);
        assert.equal(rate.value, String(kept));
    }
    rate.value = '1.5';
    rate.dispatch('change');
    assert.equal($('.story-suite-fold[data-fold="party"] > summary small').textContent, '6 active skills · auto-spend · XP ×1.5');
    assert.equal(mount({ ...SETTINGS, xpRate: 3 }).$('#rpg_battle_xp_rate').value, '3');
});

test('the panel wears the Story Suite look: quickbar switches, folds of rows, the notice, the Manage line', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    renderSettings(container, { settings: SETTINGS, sheetConflict: true, suiteLink: true, onChange: () => {} });
    const panel = container.querySelector('.inline-drawer-content.story-suite-panel');
    assert.ok(panel);
    assert.equal(panel.firstElementChild, container.querySelector('.story-suite-manage[data-story-suite-link]'), 'the Manage line first');
    assert.ok(container.querySelector('.story-suite-manage .menu_button .fa-layer-group'));
    assert.ok(container.querySelector('.story-suite-notice .rpg-battle-settings-sheet-off'), 'the Character Sheet notice with its button');
    const switches = container.querySelectorAll('.story-suite-quickbar > label.story-suite-row');
    assert.deepEqual(switches.map(row => [row.getAttribute('for'), row.querySelector('b').textContent, row.lastElementChild?.id ?? row.children.at(-1).id]), [
        ['rpg_battle_enabled', 'Battles on', 'rpg_battle_enabled'],
        ['rpg_battle_recover', 'Recover over time', 'rpg_battle_recover'],
    ]);
    assert.equal(container.querySelectorAll('.story-suite-folds > details.story-suite-fold').length, 9);
    for (const fold of container.querySelectorAll('details.story-suite-fold')) {
        assert.ok(fold.querySelector(':scope > summary > b') && fold.querySelector(':scope > summary > small'), fold.dataset.fold);
        assert.ok(fold.querySelector(':scope > .story-suite-fold-body'), fold.dataset.fold);
    }
    const currency = container.querySelector('label.story-suite-row[for="rpg_battle_currency_mode"]');
    assert.equal(currency.querySelector('span > b').textContent, 'Currency');
    assert.equal(currency.querySelector('span > small').textContent, 'Loot is written in it.');
    assert.ok(container.querySelector('label.story-suite-row[for="rpg_battle_gear_worn"] .story-suite-number #rpg_battle_gear_worn'), 'a number with its unit');
    assert.equal(container.querySelector('.rpg-battle-settings-fold'), null, 'no panel classes of its own for what the suite styles');
});

test('Diagnostics: the glue\'s report, read when the fold opens and on Refresh (0.5.9)', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    let calls = 0;
    renderSettings(container, { settings: SETTINGS, onChange: () => {}, onDiagnostics: () => `RPG Battle v0.5.9 · on\nCall ${++calls}` });
    const fold = container.querySelector('.story-suite-fold[data-fold="diagnostics"]');
    assert.equal(fold.querySelector('summary small').textContent, 'What RPG Battle sees and sent');
    assert.equal(calls, 0, 'nothing read while closed');
    fold.open = true;
    fold.dispatch('toggle');
    assert.equal(fold.querySelector('.rpg-battle-diagnostics').textContent, 'RPG Battle v0.5.9 · on\nCall 1');
    fold.querySelector('.rpg-battle-diagnostics-refresh').click();
    assert.match(fold.querySelector('.rpg-battle-diagnostics').textContent, /Call 2$/);
    const broken = doc.createElement('div');
    doc.body.appendChild(broken);
    renderSettings(broken, { settings: SETTINGS, onChange: () => {}, onDiagnostics: () => { throw new Error('boom'); } });
    const other = broken.querySelector('.story-suite-fold[data-fold="diagnostics"]');
    other.open = true;
    other.dispatch('toggle');
    assert.equal(other.querySelector('.rpg-battle-diagnostics').textContent, 'Diagnostics failed: boom');
});

test('Diagnostics: the raw data as JSON in its own fold, with Copy JSON and Copy both (0.5.11)', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    renderSettings(container, { settings: SETTINGS, onChange: () => {}, onDiagnostics: () => ({ text: 'Report', json: '{"version":"0.5.11"}' }) });
    const fold = container.querySelector('.story-suite-fold[data-fold="diagnostics"]');
    fold.open = true;
    fold.dispatch('toggle');
    assert.equal(fold.querySelector('.rpg-battle-diagnostics').textContent, 'Report');
    assert.equal(fold.querySelector('.rpg-battle-diagnostics-raw > summary').textContent, 'Raw data (JSON)');
    assert.equal(fold.querySelector('.rpg-battle-diagnostics-json').textContent, '{"version":"0.5.11"}');
    assert.deepEqual(fold.querySelectorAll('.rpg-battle-diagnostics-actions .menu_button').map(node => node.textContent.trim()), ['Refresh', 'Copy', 'Copy JSON', 'Copy both']);
});

test('Combat (0.5.14): turn order, speed, stat cap and hit chance, each bounded; speed hides with rounds', () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const changes = [];
    renderSettings(container, { settings: SETTINGS, onChange: next => changes.push(next) });
    const fold = container.querySelector('.story-suite-fold[data-fold="combat"]');
    const hint = () => fold.querySelector(':scope > summary small').textContent;
    const set = (id, value) => {
        const node = fold.querySelector(`#${id}`);
        node.value = value;
        node.dispatch('change');
        return node;
    };
    assert.equal(set('rpg_battle_speed_offset', '80').value, '50', 'bounded');
    assert.equal(changes.at(-1).speedOffset, 50);
    set('rpg_battle_stat_cap', '0');
    assert.equal(changes.at(-1).statCap, 0);
    set('rpg_battle_hit_base', '70');
    set('rpg_battle_hit_per_point', '');
    assert.equal(changes.at(-1).hitPerPoint, 3, 'empty: the shipped value');
    assert.equal(hint(), 'Timeline · speed AGI + 50 · no stat cap · hit 70% ± 3%');
    const points = container.querySelector('.story-suite-fold[data-fold="party"] #rpg_battle_points_per_level');
    points.value = '30';
    points.dispatch('change');
    assert.equal(points.value, '20', 'bounded');
    assert.equal(changes.at(-1).pointsPerLevel, 20);
    assert.match(container.querySelector('.story-suite-fold[data-fold="party"] > summary small').textContent, /^20 points a level · /);
    const speedRow = fold.querySelector('#rpg_battle_speed_offset').closest('label');
    assert.equal(speedRow.hidden, false);
    set('rpg_battle_turn_order', 'rounds');
    assert.equal(changes.at(-1).turnOrder, 'rounds');
    assert.equal(speedRow.hidden, true);
    assert.match(hint(), /^Rounds · /);
});
