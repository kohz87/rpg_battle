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
