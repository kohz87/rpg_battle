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
    const tag = $('#rpg_battle_character_tag');
    tag.value = 'Hero';
    tag.dispatch('change');
    assert.equal(changes.at(-1).characterTag, 'Hero');
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
