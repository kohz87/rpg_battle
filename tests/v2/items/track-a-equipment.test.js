// P07 production planner fixtures, including parity with the actual SB inventory hash seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EQUIP_SLOTS, SLOT_LABELS, normalizeSlot, isAmbiguousSlot, equipPlan, equipInputHash, equipmentSlots } from '../../../src/v2/items/equip-plan.js';
import { canonicalJson, hashJson } from '../../../src/v2/items/equip-hash.js';
import { equipInputHash as hostInputHash } from '../../vendor/story-block/src/v2/domains/inventory.js';

function fixture() {
    const actorSheet = { id: 'ac_00000001', kind: 'pc', life: 'alive', stats: { STR: 15, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 } };
    const stacks = {
        st_00000001: { id: 'st_00000001', def: 'pack.fixture/blade', qty: 1, owner: actorSheet.id, equipped: null },
        st_00000002: { id: 'st_00000002', def: 'pack.fixture/shield', qty: 1, owner: actorSheet.id, equipped: 'offhand' },
        st_00000003: { id: 'st_00000003', def: 'pack.fixture/ring', qty: 1, owner: 'party', equipped: null },
        st_00000004: { id: 'st_00000004', def: 'pack.fixture/ring', qty: 1, owner: actorSheet.id, equipped: 'accessory-1' },
    };
    const rule = (def, allowedSlots, hands) => ({ def, allowedSlots, hands, requires: {}, weight: 1, unique: false });
    const itemRules = {
        'pack.fixture/blade': rule('pack.fixture/blade', ['weapon'], 2),
        'pack.fixture/shield': rule('pack.fixture/shield', ['offhand'], 1),
        'pack.fixture/ring': rule('pack.fixture/ring', ['accessory-2', 'accessory-1'], 0),
    };
    const defs = Object.fromEntries(Object.keys(itemRules).map(id => [id, { id, name: id, kind: 'equipment', stats: {} }]));
    return { stacks, defs, itemRules, actorSheet, rulesHash: 'a'.repeat(64), owners: [actorSheet.id, 'ac_00000002'] };
}
const request = { stack: 'st_00000001', actor: 'ac_00000001' };

test('eight slots and compatibility counts use the contract order and labels', () => {
    const env = fixture();
    const projected = equipmentSlots(env);
    assert.deepEqual(projected.slots.map(slot => slot.key), ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2']);
    assert.equal(SLOT_LABELS.weapon, 'Main hand');
    assert.equal(projected.accessory, 2);
    assert.equal(projected.worn, 4);
    assert.equal(projected.slots.every(slot => slot.blockedBy === null), true);
    env.stacks.st_00000001.equipped = 'weapon';
    assert.equal(equipmentSlots(env).slots[1].blockedBy, 'st_00000001');
});

test('authoring aliases normalize explicitly and ambiguous slots never guess', () => {
    for (const [alias, slot] of [['mainhand', 'weapon'], ['main-hand', 'weapon'], ['off-hand', 'offhand'], ['armor', 'body'], ['armour', 'body']]) assert.equal(normalizeSlot(alias), slot);
    for (const alias of ['worn', 'hands', 'waist', 'accessory']) {
        assert.equal(isAmbiguousSlot(alias), true);
        assert.equal(normalizeSlot(alias), null);
    }
    assert.equal(equipPlan({ ...request, targetSlot: 'armor' }, fixture()).code, 'INVALID');
});

test('2H clears offhand with one physical stack and no writes', () => {
    const env = fixture();
    const before = structuredClone(env);
    const result = equipPlan(request, env);
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.unequip, ['st_00000002']);
    assert.deepEqual(result.plan.move, []);
    assert.equal(result.plan.slot, 'weapon');
    assert.deepEqual(env, before);
    assert.deepEqual(equipPlan(request, env), result);
});

test('offhand beside 2H refuses and a missing incumbent rule cannot bypass it', () => {
    const env = fixture();
    env.stacks.st_00000001.equipped = 'weapon';
    env.stacks.st_00000002.equipped = null;
    const payload = { stack: 'st_00000002', actor: request.actor };
    assert.equal(equipPlan(payload, env).code, 'REFUSED');
    delete env.itemRules['pack.fixture/blade'];
    assert.equal(equipPlan(payload, env).code, 'RULES_MISMATCH');
});

test('dual-slot pieces choose canonical first empty slot, then first-slot swap', () => {
    const env = fixture();
    const payload = { stack: 'st_00000003', actor: request.actor };
    assert.equal(equipPlan(payload, env).plan.slot, 'accessory-2');
    env.stacks.st_00000004.equipped = 'accessory-2';
    assert.equal(equipPlan(payload, env).plan.slot, 'accessory-1');
    env.stacks.st_00000005 = { ...env.stacks.st_00000004, id: 'st_00000005', equipped: 'accessory-1' };
    const plan = equipPlan(payload, env).plan;
    assert.equal(plan.slot, 'accessory-1');
    assert.deepEqual(plan.unequip, ['st_00000005']);
    assert.deepEqual(plan.move, [{ stack: 'st_00000003', from: 'party', to: request.actor }]);
});

test('explicit legal target slot is retained; illegal target cannot select another slot', () => {
    const env = fixture();
    const result = equipPlan({ stack: 'st_00000003', actor: request.actor, targetSlot: 'accessory-1' }, env);
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.unequip, ['st_00000004']);
    assert.equal(equipPlan({ ...request, targetSlot: 'body' }, env).code, 'REFUSED');
});

test('base stat requirements cannot qualify themselves with the item bonus', () => {
    const env = fixture();
    env.itemRules['pack.fixture/blade'].requires = { STR: 16 };
    env.defs['pack.fixture/blade'].stats.STR = 100;
    assert.equal(equipPlan(request, env).code, 'REFUSED');
    env.actorSheet.stats.STR = 16;
    assert.equal(equipPlan(request, env).ok, true);
});

test('unknown hash, actor, owner and malformed frozen rule fail closed', () => {
    const env = fixture();
    assert.equal(equipPlan(request, { ...env, rulesHash: null }).code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(equipPlan(request, { ...env, actorSheet: null }).code, 'NOT_FOUND');
    assert.equal(equipPlan(request, { ...env, owners: [] }).code, 'NOT_FOUND');
    assert.equal(equipPlan(request, { ...env, itemRules: {} }).code, 'RULES_MISMATCH');
    env.itemRules['pack.fixture/blade'].requires = { class: 'fighter' };
    assert.equal(equipPlan(request, env).code, 'RULES_MISMATCH');
});

test('missing life/kind cannot acquire guessed defaults; nonstandard life is an explicit handoff', () => {
    const env = fixture();
    delete env.actorSheet.life;
    assert.equal(equipPlan(request, env).code, 'DEPENDENCY_UNAVAILABLE');
    env.actorSheet.life = 'gravely-injured';
    assert.equal(equipPlan(request, env).code, 'DEPENDENCY_UNAVAILABLE');
    env.actorSheet.life = 'alive';
    delete env.actorSheet.kind;
    assert.equal(equipPlan(request, env).code, 'DEPENDENCY_UNAVAILABLE');
});

test('malformed slot, quantity and duplicate equipped records cannot produce a plan', () => {
    const env = fixture();
    assert.equal(equipPlan({ ...request, bypass: true }, env).code, 'INVALID');
    env.stacks.st_00000001.qty = 1.5;
    assert.equal(equipPlan(request, env).code, 'RULES_MISMATCH');
    env.stacks.st_00000001.qty = 1;
    env.stacks.st_00000001.equipped = 'worn';
    assert.equal(equipPlan(request, env).code, 'RULES_MISMATCH');
    env.stacks.st_00000001.equipped = null;
    env.stacks.st_00000005 = { ...env.stacks.st_00000002, id: 'st_00000005' };
    assert.equal(equipPlan(request, env).code, 'RULES_MISMATCH');
});

test('inputHash exactly matches the vendored SB reference seam', () => {
    const env = fixture();
    const result = equipPlan(request, env);
    const inputs = { rulesHash: env.rulesHash, actor: request.actor, stats: env.actorSheet.stats, life: env.actorSheet.life,
        targetSlot: null, stack: env.stacks[request.stack], affected: [env.stacks.st_00000002] };
    assert.equal(result.plan.inputHash, hostInputHash(inputs));
    assert.equal(equipInputHash(inputs), hostInputHash(inputs));
    const explicit = equipPlan({ ...request, targetSlot: 'weapon' }, env);
    assert.equal(explicit.plan.inputHash, hostInputHash({ ...inputs, targetSlot: 'weapon' }));
    assert.notEqual(explicit.plan.inputHash, result.plan.inputHash);
});

test('hash covers changed owner, base stats and affected slots, ignoring unrelated pieces', () => {
    const env = fixture();
    const before = equipPlan(request, env).plan.inputHash;
    env.stacks.st_00000003.qty++;
    assert.equal(equipPlan(request, env).plan.inputHash, before);
    env.actorSheet.stats.STR++;
    assert.notEqual(equipPlan(request, env).plan.inputHash, before);
    env.actorSheet.stats.STR--;
    env.stacks.st_00000001.owner = 'party';
    assert.notEqual(equipPlan(request, env).plan.inputHash, before);
});

test('browser hash matches SHA-256 normalized JSON vectors and rejects non-JSON values', () => {
    for (const value of [{ z: 1, a: ['é', -0, true] }, { '\uE000': 'x', '😀': 'y' }, {}, [], null]) {
        const canonical = canonicalJson(value);
        assert.equal(hashJson(value), createHash('sha256').update(canonical).digest('hex'));
    }
    assert.equal(canonicalJson({ z: 2, a: 1 }), '{"a":1,"z":2}');
    assert.equal(canonicalJson([2, 1]), '[2,1]');
    for (const value of [undefined, NaN, { a: undefined }, [undefined], new Date(0)]) assert.throws(() => canonicalJson(value));
});
