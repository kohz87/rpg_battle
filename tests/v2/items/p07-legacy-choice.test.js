// Generic old slot words (§9): not guessed, but not dead ends either. A bare accessory is one of the two interchangeable
// accessory slots (the plan takes the first empty one); worn, hands and waist list the slots they may go in and the
// READER chooses with targetSlot; the rules never pick. slotsForLegacy is the one pure mapping track B calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { equipPlan } from '../../../src/v2/items/equip-plan.js';
import { slotWords, slotsForLegacy } from '../../../src/v2/items/slots.js';
import { interimItemRule } from '../../../src/v2/items/equip-query.js';
import { part } from '../../../src/v2/items/index.js';
import { makeState } from './helpers/state.js';

const PC = 'ac_00000001';
const stats = { STR: 10, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 };

function world(words = {}) {
    const defs = {};
    const itemRules = {};
    const choices = {};
    for (const [name, slot] of Object.entries(words)) {
        const def = { id: `pack.fixture/${name}`, name, kind: 'equipment', slot, tags: [], stats: {} };
        const made = interimItemRule(def);
        defs[def.id] = def;
        itemRules[def.id] = made.rule;
        if (made.choice) choices[def.id] = made.choice;
    }
    const stacks = Object.fromEntries(Object.keys(defs).map((id, at) => [`it_item000${at}`, { id: `it_item000${at}`, def: id, qty: 1, owner: 'party', equipped: null }]));
    return { stacks, defs, itemRules, choices, notes: {}, owners: [PC], actorSheet: { id: PC, kind: 'pc', life: 'alive', stats }, rulesHash: 'd'.repeat(64) };
}
const stackOf = (env, name) => Object.values(env.stacks).find(stack => env.defs[stack.def].name === name).id;
const plan = (env, name, extra = {}) => equipPlan({ stack: stackOf(env, name), actor: PC, ...extra }, env);

test('slotsForLegacy: one slot, a choice, or nothing; it never picks among kinds of slot', () => {
    assert.deepEqual(['weapon', 'offhand', 'armour'].map(slotsForLegacy), [{ slot: 'weapon' }, { slot: 'offhand' }, { slot: 'body' }]);
    assert.deepEqual(slotsForLegacy('accessory'), { choose: ['accessory-1', 'accessory-2'], auto: true });
    assert.deepEqual(slotsForLegacy('worn'), { choose: ['head', 'body', 'legs', 'feet'], auto: false });
    assert.deepEqual(slotsForLegacy('hands'), { choose: ['weapon', 'offhand'], auto: false });
    assert.deepEqual(slotsForLegacy('waist'), { choose: ['accessory-1', 'accessory-2'], auto: false });
    assert.deepEqual(['mainhand', 'main-hand', 'off-hand', 'armor', 'accessory-2'].map(slotsForLegacy), [{ slot: 'weapon' }, { slot: 'weapon' }, { slot: 'offhand' }, { slot: 'body' }, { slot: 'accessory-2' }]);
    for (const word of ['worn-1', 'accessory-3', '', 'banana', 'toString', null, undefined, 4, {}]) assert.equal(slotsForLegacy(word), null, String(word));
    slotsForLegacy('worn').choose.push('x');
    assert.equal(slotsForLegacy('worn').choose.length, 4, 'a copy: the table cannot be changed through it');
    assert.equal(slotWords(['head', 'body', 'legs', 'feet']), 'Head, Body, Legs or Feet');
    assert.equal(slotWords(['weapon', 'offhand']), 'Main hand or Off hand');
});

test('a bare accessory is not ambiguous: the first empty accessory slot, else an explicit swap of the first', () => {
    const env = world({ ring: 'accessory', band: 'accessory', charm: 'accessory' });
    assert.equal(plan(env, 'ring').plan.slot, 'accessory-1');
    env.stacks[stackOf(env, 'ring')].equipped = 'accessory-1';
    assert.equal(plan(env, 'band').plan.slot, 'accessory-2');
    env.stacks[stackOf(env, 'band')].equipped = 'accessory-2';
    const full = plan(env, 'charm');
    assert.equal(full.plan.slot, 'accessory-1');
    assert.deepEqual(full.plan.unequip, [stackOf(env, 'ring')]);
    assert.deepEqual(plan(env, 'charm', { targetSlot: 'accessory-2' }).plan.unequip, [stackOf(env, 'band')]);
    assert.equal(plan(env, 'charm', { targetSlot: 'head' }).code, 'REFUSED');
});

test('worn, hands and waist are worn where the reader chooses; without a choice the plan is refused with the list', () => {
    const env = world({ hood: 'worn', gloves: 'hands', belt: 'waist', sword: 'weapon' });
    const unchosen = plan(env, 'hood');
    assert.equal(unchosen.code, 'REFUSED');
    assert.equal(unchosen.message, 'Choose where to wear it: Head, Body, Legs or Feet.');
    assert.equal(plan(env, 'gloves').message, 'Choose where to wear it: Main hand or Off hand.');
    assert.equal(plan(env, 'belt').message, 'Choose where to wear it: Accessory 1 or Accessory 2.');
    for (const slot of ['head', 'body', 'legs', 'feet']) assert.equal(plan(env, 'hood', { targetSlot: slot }).plan.slot, slot);
    assert.equal(plan(env, 'hood', { targetSlot: 'weapon' }).code, 'REFUSED', 'only its own candidates');
    assert.equal(plan(env, 'gloves', { targetSlot: 'offhand' }).plan.slot, 'offhand');
    assert.equal(plan(env, 'belt', { targetSlot: 'accessory-2' }).plan.slot, 'accessory-2');
    // A chosen slot still displaces what is in it, and the hands keep the two-hander rule.
    env.stacks[stackOf(env, 'sword')].equipped = 'weapon';
    assert.deepEqual(plan(env, 'gloves', { targetSlot: 'weapon' }).plan.unequip, [stackOf(env, 'sword')]);
    env.defs['pack.fixture/sword'].tags = ['two-handed'];
    env.itemRules['pack.fixture/sword'] = { ...env.itemRules['pack.fixture/sword'], hands: 2 };
    assert.equal(plan(env, 'gloves', { targetSlot: 'offhand' }).code, 'REFUSED');
    assert.equal(plan(env, 'hood', { targetSlot: 'head' }).plan.rulesHash, env.rulesHash);
});

test('a malformed choice fails closed, and a rule that names slots ignores any choice', () => {
    const env = world({ hood: 'worn' });
    env.choices['pack.fixture/hood'] = { slots: ['head', 'tail'], auto: false };
    assert.equal(plan(env, 'hood', { targetSlot: 'head' }).code, 'RULES_MISMATCH');
    env.choices['pack.fixture/hood'] = { slots: ['head'], auto: 'yes' };
    assert.equal(plan(env, 'hood', { targetSlot: 'head' }).code, 'RULES_MISMATCH');
    delete env.choices['pack.fixture/hood'];
    env.notes = {};
    assert.match(plan(env, 'hood').message, /no equipment slot/);
});

test('items.canWear tells a screen where a piece could go; once a candidate is chosen it is just ok', () => {
    const state = makeState();
    state.domains.inventory.defs['story/iron-helm'].slot = 'worn';
    state.domains.inventory.defs['story/silver-ring'].slot = 'accessory';
    const ask = args => part.queries['items.canWear'](state, args, undefined);
    assert.deepEqual(ask({ actor: 'ac_ren00001', stack: 'it_helm0001' }), { ok: false, why: 'Choose where to wear it: Head, Body, Legs or Feet.', choose: ['head', 'body', 'legs', 'feet'] });
    assert.deepEqual(ask({ actor: 'ac_ren00001', stack: 'it_helm0001', targetSlot: 'head' }), { ok: true });
    assert.deepEqual(ask({ actor: 'ac_ren00001', stack: 'it_helm0001', targetSlot: 'weapon' }).choose, undefined);
    assert.equal(ask({ actor: 'ac_ren00001', defId: 'story/iron-helm' }).choose.length, 4, 'a def only, for the picker');
    assert.deepEqual(ask({ actor: 'ac_ren00001', defId: 'story/silver-ring' }), { ok: true }, 'a bare accessory has no choice to ask');
    // The reader cannot be asked for a slot for someone who cannot wear anything.
    state.domains.party.actors.ac_ren00001.hp.cur = 0;
    assert.equal(ask({ actor: 'ac_ren00001', stack: 'it_helm0001' }).choose, undefined);
});
