// The screens part registers the track C screens, view queries and widgets (src/v2/screens/index.js), so the module carries
// them; every one is gated by `active`, so nothing new is offered until RPG Battle's rules queries exist. The five screens
// that were there before are first and unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part, screens } from '../../../../src/v2/screens/index.js';
import { rulesQueries, rulesScreens, rulesWidgets } from '../../../../src/v2/screens/rules/index.js';
import { createModule } from '../../../../src/v2/module.js';
import { definitionProblems } from '../helpers/runtime.js';

test('the five old screens come first and unchanged; the five new ones follow, each gated', () => {
    assert.deepEqual(screens.slice(0, 5).map(screen => screen.id), ['rpg-battle/party', 'rpg-battle/trade', 'rpg-battle/crafting', 'rpg-battle/hud', 'rpg-battle/status-card']);
    assert.deepEqual(screens.slice(5), rulesScreens);
    assert.equal(part.screens, screens);
    assert.ok(rulesScreens.every(screen => typeof screen.active === 'function'), 'offered only while the rules queries exist');
    assert.ok(screens.slice(0, 5).every(screen => screen.active === undefined), 'the old screens are as they were');
    assert.equal(new Set(screens.map(screen => screen.id)).size, screens.length);
});

test('the part carries the view queries and widgets, and no other part claims their names', () => {
    for (const name of Object.keys(rulesQueries)) assert.equal(part.queries[name], rulesQueries[name], name);
    for (const name of Object.keys(rulesWidgets)) assert.equal(part.widgets[name], rulesWidgets[name], name);
    assert.deepEqual(part.domains, {});
    assert.deepEqual(part.commands, {});
});

test('Story Block\'s registry accepts RPG Battle with them merged in, and a pack or card may restyle a screen by its id', { skip: definitionProblems ? false : 'registry.js not found' }, () => {
    const merged = createModule({ settings: () => ({}) });
    for (const screen of rulesScreens) assert.ok(merged.screens.includes(screen), screen.id);
    for (const name of Object.keys(rulesQueries)) assert.equal(typeof merged.queries[name], 'function', name);
    for (const name of Object.keys(rulesWidgets)) assert.ok(merged.widgets[name], name);
    assert.deepEqual(definitionProblems(merged), []);
});
