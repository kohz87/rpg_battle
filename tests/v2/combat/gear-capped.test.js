// RB-gear: items.gear's counted rows marked `final: true` hold the stats a piece fights with (capped
// at the wearer's level, then scaled by condition and refinement, +8 % a level). The fight takes
// them as they are: no second cap by rarity, and a piece with no stats is not given a default main
// stat (combat/setup.js gearRows passes `final` on, items.js gearBonuses honours it). A row without
// it (an older items.gear, or `capped: false` meaning only "not cut back") and gear the fight reads
// from the inventory itself are capped as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { partyCombatants } from '../../../src/v2/combat/setup.js';
import { capItem, gearBonuses } from '../../../src/items.js';
import { DEFAULT_RULES } from '../../../src/rules.js';

const actor = { id: 'ac_00000001', kind: 'pc', name: 'Ren', level: 1, stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [] };

function ctxWith(counted, held = []) {
    return {
        query(name) {
            if (name === 'party.actors') return [actor];
            if (name === 'items.gear') return counted === null ? undefined : { counted, unused: [] };
            if (name === 'inventory.items') return held;
            return undefined;
        },
        read: () => null,
    };
}

const bare = partyCombatants(ctxWith([]))[0];
const numbers = c => ({ patk: c.patk, matk: c.matk, pdef: c.pdef, mdef: c.mdef, crit: c.crit, hp: c.hp.max, mp: c.mp.max, stats: c.stats });
// A common blade at its level-1 budget, then refined: one ATK more than the rarity allows.
const atBudget = capItem({ name: 'Blade', slot: 'weapon', rarity: 'common', stats: { ATK: 9 } }, 1).stats.ATK;
const refined = { stack: 'st_00000001', name: 'Blade +2', slot: 'weapon', rarity: 'common', stats: { ATK: atBudget + 1 }, capped: false };

test('a refined piece at its level budget keeps its refined stats in the fight (final: true)', () => {
    const fighter = partyCombatants(ctxWith([{ ...refined, final: true }]))[0];
    assert.equal(fighter.patk - bare.patk, atBudget + 1, 'ATK as items.gear gave it, not cut back to the rarity budget');
    assert.deepEqual(fighter.capped, [], 'nothing reported as capped again');
});

test('a final piece with no stats adds nothing (no default main stat)', () => {
    const plain = { stack: 'st_00000002', name: 'Plain Ring', slot: 'accessory', rarity: 'rare', stats: {}, final: true };
    assert.deepEqual(numbers(partyCombatants(ctxWith([plain]))[0]), numbers(bare));
});

test('a counted row without final (capped: false only) is capped as before', () => {
    const fighter = partyCombatants(ctxWith([refined]))[0];
    assert.equal(fighter.patk - bare.patk, atBudget);
    const plain = { stack: 'st_00000002', name: 'Plain Ring', slot: 'accessory', rarity: 'rare', stats: {} };
    assert.notDeepEqual(numbers(partyCombatants(ctxWith([plain]))[0]), numbers(bare), 'v1 gives an empty piece its main stat');
});

test('gear the fight reads from the inventory itself (no items.gear) is still capped by rarity', () => {
    const held = [{ stack: 'st_00000003', def: 'it_blade', name: 'Runed Sword', qty: 1, kind: 'equipment', rarity: 'common', slot: 'weapon', equipped: 'weapon', owner: actor.id, stats: { ATK: 9 }, final: true }];
    const fighter = partyCombatants(ctxWith(null, held))[0];
    assert.ok(fighter.patk - bare.patk < 9, `capped: +${fighter.patk - bare.patk}`);
});

test('gearBonuses: `final: true` counts the stats as written; without it, v1\'s cap', () => {
    const piece = { name: 'Blade', slot: 'weapon', rarity: 'common', equipped: true, stats: { ATK: 9 } };
    assert.equal(gearBonuses([{ ...piece, final: true }], 1, DEFAULT_RULES).ATK, 9);
    assert.ok(gearBonuses([piece], 1, DEFAULT_RULES).ATK < 9);
    assert.ok(gearBonuses([{ ...piece, capped: true }], 1, DEFAULT_RULES).ATK < 9, '`capped` alone is no flag');
});
