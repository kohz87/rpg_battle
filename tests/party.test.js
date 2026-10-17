// From sheets to fighters: gear capped into the numbers, consumables carried, enemies by row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRules } from '../src/rules.js';
import { makeRng } from '../src/rng.js';
import { DEFAULT_SKILLS, PRESETS } from '../src/skills.js';
import { DEFAULT_BESTIARY } from '../src/enemies.js';
import { newSheet } from '../src/sheet.js';
import { parseInventory } from '../src/items.js';
import { combatantFromSheet, enemiesFromRows } from '../src/party.js';

const rules = makeRules();
const sheet = newSheet({ name: 'Ren', stats: PRESETS[0].points, skills: PRESETS[0].skills }, rules);

test('a sheet becomes a party combatant: gear capped by rarity, consumables, resolved skills', () => {
    const items = parseInventory('[Equipment > Weapons]\nGodsword | 1 | equipped · common · ATK +50\n[Consumables]\nHealing Draught | 2 | heal 30').items;
    const bare = combatantFromSheet(sheet, { gear: [], items: [], library: DEFAULT_SKILLS, rules });
    const armed = combatantFromSheet(sheet, { gear: items.filter(item => item.equipped), items, library: DEFAULT_SKILLS, rules });
    assert.equal(armed.side, 'party');
    assert.equal(armed.memberId, 'pc');
    assert.ok(armed.patk > bare.patk, 'the sword helps');
    assert.ok(armed.patk - bare.patk <= 3, 'but a common sword at level 1 is capped, not +50');
    assert.deepEqual(armed.capped.map(entry => entry.name), ['Godsword']);
    assert.deepEqual(armed.items.map(item => item.name), ['Healing Draught']);
    assert.deepEqual(armed.skills.map(skill => skill.name), PRESETS[0].skills);
    assert.equal(armed.hp.cur, sheet.hp.cur);
});

test('enemy rows: counts become lettered individuals with stable ids', () => {
    const enemies = enemiesFromRows([{ name: 'Goblin', count: 2, rank: 'F' }, { name: '', count: 3 }, { name: 'Bog Wight', count: 1, rank: 'E', role: 'brute', boss: true }], { bestiary: DEFAULT_BESTIARY, library: DEFAULT_SKILLS, rules, rng: makeRng('t') });
    assert.deepEqual(enemies.map(enemy => [enemy.id, enemy.name]), [['e1', 'Goblin A'], ['e2', 'Goblin B'], ['e3', 'Bog Wight']]);
    assert.ok(enemies[2].boss);
    assert.equal(enemies[2].side, 'enemy');
});
