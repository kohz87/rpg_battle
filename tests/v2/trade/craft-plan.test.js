// The v2 commission maths (src/v2/trade/craft-plan.js) is v1's craftPlan on defs: the same
// materials, written once as v1 Inventory rows and once as defs, make the same piece.
import test from 'node:test';
import assert from 'node:assert/strict';
import { craftPlan } from '../../../src/craft.js';
import { craftPiece } from '../../../src/v2/trade/craft-plan.js';
import { def } from './helpers/fake-ctx.js';

const CASES = [
    { name: 'Skull Charm', slot: null, rows: [['Brood-Mother Skull', 1, 'uncommon material · MDEF, poison'], ['Wolf Fang', 2, 'uncommon material']], level: 3 },
    { name: 'Fang Blade', slot: 'weapon', rows: [['Wolf Fang', 1, 'material']], level: 1 },
    { name: 'Hide Jerkin', slot: null, rows: [['Bear Pelt', 3, 'rare material'], ['Ember Core', 1, 'epic material']], level: 12 },
    { name: 'Lucky Ring', slot: null, rows: [['Rat Tail', 4, 'material']], level: 5 },
];

for (const entry of CASES) {
    test(`craftPiece matches v1 craftPlan: ${entry.name}`, () => {
        const inventory = ['[Materials]', ...entry.rows.map(([name, qty, note]) => `${name} | ${qty} | ${note}`)].join('\n');
        const [v1] = craftPlan(inventory, [{ name: entry.name, materials: entry.rows.map(([name, qty]) => ({ name, qty })), slot: entry.slot }], { level: entry.level });
        const parts = entry.rows.map(([name, qty, note]) => {
            const rarity = note.split(' ')[0] === 'material' ? 'common' : note.split(' ')[0];
            const rest = note.split('·')[1]?.trim() ?? '';
            return { def: def(`story/${name.toLowerCase().replace(/\s+/g, '-')}`, name, { kind: 'material', rarity, note: rest }), qty };
        });
        const v2 = craftPiece({ name: entry.name, slot: entry.slot, parts }, { level: entry.level });
        assert.deepEqual(v2, v1.item);
    });
}

test('craftPiece: an element in a def\'s tags carries over like one in its note', () => {
    const piece = craftPiece({ name: 'Charm', parts: [{ def: def('story/x', 'Odd Stone', { kind: 'material', tags: ['fire'] }), qty: 1 }] });
    assert.deepEqual(piece.tags, ['fire']);
});
