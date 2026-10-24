// P07 planner decisions (A4 follow-up): the two-hander plus a dual-slot piece (B2), who may be moved
// (the stack's durable owner), which lives may change gear, and the §9 read adapters for older keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { equipPlan, equipmentSlots } from '../../../src/v2/items/equip-plan.js';

const PC = 'ac_00000001';
const BUDDY = 'ac_00000002';
const stats = { STR: 10, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 };
const rule = (def, allowedSlots, hands) => ({ def, allowedSlots, hands, requires: {}, weight: 1, unique: false });

function world(extraStacks = {}) {
    const rules = [
        rule('pack.fixture/greatsword', ['weapon'], 2),
        rule('pack.fixture/dagger', ['weapon', 'offhand'], 1),
        rule('pack.fixture/shield', ['offhand'], 1),
        rule('pack.fixture/cuirass', ['body'], 0),
        rule('pack.fixture/plate', ['body'], 0),
        rule('pack.fixture/helm', ['head'], 0),
    ];
    const itemRules = Object.fromEntries(rules.map(entry => [entry.def, entry]));
    const defs = Object.fromEntries(rules.map(entry => [entry.def, { id: entry.def, name: entry.def.split('/')[1], kind: 'equipment', stats: {} }]));
    const stack = (id, def, owner, equipped = null) => ({ id, def, qty: 1, owner, equipped });
    const stacks = Object.fromEntries([
        stack('it_great001', 'pack.fixture/greatsword', PC, 'weapon'),
        stack('it_dagger01', 'pack.fixture/dagger', PC),
        stack('it_shield01', 'pack.fixture/shield', PC),
        stack('it_cuirass1', 'pack.fixture/cuirass', 'party', 'armour'),
        stack('it_plate001', 'pack.fixture/plate', 'party'),
        stack('it_helm0001', 'pack.fixture/helm', 'party'),
        ...Object.values(extraStacks),
    ].map(entry => [entry.id, entry]));
    const sheet = (id, kind) => ({ id, kind, life: 'alive', stats: { ...stats } });
    return { stacks, defs, itemRules, actorSheet: sheet(PC, 'pc'), owners: [PC, BUDDY], rulesHash: 'b'.repeat(64), sheets: { [PC]: sheet(PC, 'pc'), [BUDDY]: sheet(BUDDY, 'companion') } };
}
const ask = (env, payload, as = PC) => equipPlan({ actor: as, ...payload }, { ...env, actorSheet: env.sheets[as] });

test('B2: a two-hander worn and a dual-slot piece with no targetSlot swaps the first legal slot, never the refused offhand', () => {
    const env = world();
    const plan = ask(env, { stack: 'it_dagger01' });
    assert.equal(plan.ok, true, plan.message);
    assert.equal(plan.plan.slot, 'weapon');
    assert.deepEqual(plan.plan.unequip, ['it_great001']);
    assert.deepEqual(plan.plan.move, []);
    // Asking for the blocked offhand on purpose is still a refusal; the weapon slot is the explicit swap.
    assert.equal(ask(env, { stack: 'it_dagger01', targetSlot: 'offhand' }).code, 'REFUSED');
    assert.equal(ask(env, { stack: 'it_dagger01', targetSlot: 'weapon' }).plan.slot, 'weapon');
    // A piece that can only go in the offhand has no legal slot while the two-hander is worn.
    const shield = ask(env, { stack: 'it_shield01' });
    assert.equal(shield.code, 'REFUSED');
    assert.match(shield.message, /two-handed/);
});

test('a one-hander worn: the dual-slot piece takes the empty offhand; both hands full swaps the first slot', () => {
    const env = world();
    env.stacks.it_great001.def = 'pack.fixture/dagger';
    const free = ask(env, { stack: 'it_shield01' });
    assert.equal(free.plan.slot, 'offhand');
    env.stacks.it_dagger01.def = 'pack.fixture/dagger';
    const second = ask(env, { stack: 'it_dagger01' });
    assert.equal(second.plan.slot, 'offhand', 'a free offhand comes before swapping the main hand');
    env.stacks.it_shield01.equipped = 'offhand';
    const full = ask(env, { stack: 'it_dagger01' });
    assert.equal(full.plan.slot, 'weapon');
    assert.deepEqual(full.plan.unequip, ['it_great001']);
    const explicit = ask(env, { stack: 'it_dagger01', targetSlot: 'offhand' });
    assert.deepEqual(explicit.plan.unequip, ['it_shield01']);
});

test('a two-handed piece clears the offhand with it, one stack, and no plan is trusted from the caller', () => {
    const env = world();
    env.stacks.it_great001.equipped = null;
    env.stacks.it_shield01.equipped = 'offhand';
    const plan = ask(env, { stack: 'it_great001' });
    assert.equal(plan.plan.slot, 'weapon');
    assert.deepEqual(plan.plan.unequip, ['it_shield01']);
    assert.equal(ask(env, { stack: 'it_great001', plan: {} }).code, 'INVALID');
});

test('only the stack\'s durable owner may be moved: the actor\'s own, or the party bag; never another member\'s piece', () => {
    const env = world({ it_buddy001: { id: 'it_buddy001', def: 'pack.fixture/helm', qty: 1, owner: BUDDY, equipped: null } });
    const taken = ask(env, { stack: 'it_buddy001' });
    assert.equal(taken.code, 'REFUSED');
    assert.match(taken.message, /hand it over/);
    assert.equal(ask(env, { stack: 'it_buddy001' }, BUDDY).plan.move.length, 0, 'their own piece needs no move');
    const fromBag = ask(env, { stack: 'it_helm0001' }, BUDDY);
    assert.deepEqual(fromBag.plan.move, [{ stack: 'it_helm0001', from: 'party', to: BUDDY }]);
    // The bag's worn piece is the main character's: nobody else can take it off them by wearing it.
    const worn = ask(env, { stack: 'it_cuirass1' }, BUDDY);
    assert.equal(worn.code, 'REFUSED');
    assert.match(worn.message, /main character wears/);
});

test('living members only: downed, gravely injured and dead are refused in words, not "unavailable"', () => {
    const env = world();
    for (const life of ['downed', 'gravely-injured', 'dead']) {
        env.sheets[PC].life = life;
        const answer = ask(env, { stack: 'it_helm0001' });
        assert.equal(answer.code, 'REFUSED', life);
    }
});

test('§9 read adapters: the bag\'s old `armour` key is the main character\'s body and is displaced by a body piece', () => {
    const env = world();
    const plan = ask(env, { stack: 'it_plate001' });
    assert.equal(plan.ok, true, plan.message);
    assert.equal(plan.plan.slot, 'body');
    assert.deepEqual(plan.plan.unequip, ['it_cuirass1']);
    // The same piece is already there under its old word: no plan to put it there again.
    assert.equal(ask(env, { stack: 'it_cuirass1', targetSlot: 'body' }).code, 'REFUSED');
    const slots = equipmentSlots({ actorSheet: env.sheets[PC], stacks: env.stacks, itemRules: env.itemRules });
    assert.equal(slots.slots.find(slot => slot.key === 'offhand').blockedBy, 'it_great001');
});

test('an ambiguous old key (worn-1, a bare accessory) occupies no v2 slot, is never displaced, and never blocks a plan', () => {
    const env = world({
        it_oldworn1: { id: 'it_oldworn1', def: 'pack.fixture/helm', qty: 1, owner: 'party', equipped: 'worn-1' },
        it_oldring1: { id: 'it_oldring1', def: 'pack.fixture/helm', qty: 1, owner: PC, equipped: 'accessory' },
    });
    const plan = ask(env, { stack: 'it_helm0001' });
    assert.equal(plan.ok, true, plan.message);
    assert.equal(plan.plan.slot, 'head');
    assert.deepEqual(plan.plan.unequip, [], 'a record that names no single slot is left exactly as stored');
    assert.equal(plan.plan.inputHash.length, 64);
});
