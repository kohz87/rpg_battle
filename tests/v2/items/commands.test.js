import test from 'node:test';
import assert from 'node:assert/strict';
import { part } from '../../../src/v2/items/index.js';
import { makeCtx } from './helpers/fake-ctx.js';
import { LYRA, PC, makeState } from './helpers/state.js';

const harness = (state = makeState(), settings = {}) => makeCtx({ state, settings, handlers: part.commands, queries: part.queries });

/** A rejection saves nothing: the state is exactly what it was. */
function refused(h, type, payload, code, message) {
    const before = h.state();
    const saves = h.saves;
    const result = h.run(type, payload);
    assert.equal(result.ok, false, `${type} should be refused`);
    assert.equal(result.code, code);
    if (message) assert.equal(result.message, message);
    assert.deepEqual(h.state(), before, 'nothing changed');
    assert.equal(h.saves, saves, 'nothing saved');
    return result;
}

// ---------------------------------------------------------------------------------------
// item.use

test('item.use heals by v1 rules, consumes one dose and says so like v1', () => {
    const h = harness();
    const result = h.run('item.use', { stack: 'it_draught1', target: PC });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.summary, 'Ren uses the Minor Healing Draught: +20 HP (now 77/82 HP).');
    assert.equal(result.receipt.narrate, true);
    assert.deepEqual(h.calls, [
        { type: 'inventory.consume', payload: { stack: 'it_draught1', qty: 1 } },
        { type: 'party.heal', payload: { actor: PC, hp: 20, cure: [] } },
    ]);
    const state = h.state();
    assert.equal(state.domains.inventory.stacks.it_draught1.qty, 1);
    assert.equal(state.domains.party.actors[PC].hp.cur, 77);
    assert.deepEqual(result.receipt.data.now.hp, { cur: 77, max: 82 });

    // The page stays open: a second click is a second dose, healed only up to max.
    const again = h.run('item.use', { stack: 'it_draught1', target: PC });
    assert.equal(again.receipt.summary, 'Ren uses the Minor Healing Draught: +5 HP (now 82/82 HP).');
    assert.equal(h.state().domains.inventory.stacks.it_draught1, undefined);
});

test('item.use without a target is the main character; MP goes through party.restore', () => {
    const h = harness();
    const result = h.run('item.use', { stack: 'it_tonic001' });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.summary, 'Ren uses the Mana Tonic: +10 MP (now 40/40 MP).');
    assert.deepEqual(h.calls.map(call => call.type), ['inventory.consume', 'party.restore']);
    assert.deepEqual(h.calls[1].payload, { actor: PC, mp: 10 });
});

test('item.use cures a companion\'s poison with the party\'s antidote', () => {
    const h = harness();
    const result = h.run('item.use', { stack: 'it_antidot1', target: LYRA });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.summary, 'Lyra uses the Antidote: cured poisoned (now 60/60 HP).');
    assert.deepEqual(h.calls[1], { type: 'party.heal', payload: { actor: LYRA, hp: 0, cure: ['poisoned'] } });
    assert.deepEqual(h.state().domains.party.actors[LYRA].conditions, []);
});

test('item.use at full HP refuses without consuming anything', () => {
    const h = harness();
    refused(h, 'item.use', { stack: 'it_draught1', target: LYRA }, 'INVALID', 'Lyra does not need the Minor Healing Draught now.');
    assert.deepEqual(h.calls, [], 'no sub-command ran');
    const mpFull = makeState();
    mpFull.domains.party.actors[PC].mp.cur = 40;
    refused(harness(mpFull), 'item.use', { stack: 'it_tonic001', target: PC }, 'INVALID', 'Ren does not need the Mana Tonic now.');
});

test('item.use refuses what is not a consumable, a fight-only flask, an empty or unknown stack, a stranger', () => {
    const h = harness();
    refused(h, 'item.use', { stack: 'it_rope0001', target: PC }, 'INVALID', 'The Rope is not something to use.');
    refused(h, 'item.use', { stack: 'it_blade001', target: PC }, 'INVALID', 'The Steel Blade is not something to use.');
    refused(h, 'item.use', { stack: 'it_flask001', target: PC }, 'INVALID', 'Ember Flask can only be used in a fight.');
    refused(h, 'item.use', { stack: 'it_empty001', target: PC }, 'NOT_ENOUGH', 'There is no Minor Healing Draught left.');
    refused(h, 'item.use', { stack: 'it_nothing1', target: PC }, 'NOT_FOUND');
    refused(h, 'item.use', {}, 'NOT_FOUND');
    refused(h, 'item.use', { stack: 'it_npc00001', target: PC }, 'NOT_FOUND', 'That item is not among the party\'s things.');
    refused(h, 'item.use', { stack: 'it_draught1', target: 'ac_nobody01' }, 'NOT_FOUND', 'That companion is not in the party.');
    const nobody = makeState();
    nobody.domains.party.pc = null;
    refused(harness(nobody), 'item.use', { stack: 'it_draught1' }, 'NOT_FOUND', 'Make your character first.');
});

test('item.use: a companion\'s own draught works on the main character', () => {
    const h = harness();
    const result = h.run('item.use', { stack: 'it_lyradr01', target: PC });
    assert.equal(result.ok, true);
    assert.equal(h.state().domains.inventory.stacks.it_lyradr01, undefined);
});

test('item.use reports the party owner\'s numbers when it clamps differently', () => {
    const state = makeState();
    const h = makeCtx({ state, handlers: part.commands });
    // A party owner whose heal clamps lower (e.g. a wound cap): the summary keeps the computed gain,
    // the "now" is what the party says.
    const original = h.ctx.call;
    h.ctx.call = (type, payload) => (type === 'party.heal' ? original('party.restore', { actor: payload.actor, mp: 0 }) : original(type, payload));
    const result = h.run('item.use', { stack: 'it_draught1', target: PC });
    assert.equal(result.receipt.summary, 'Ren uses the Minor Healing Draught: +20 HP (now 57/82 HP).');
});

test('the items part owns no domain: drafting one is refused', () => {
    const h = harness();
    const result = h.run('item.use', { stack: 'it_draught1' });
    assert.equal(result.ok, true);
    assert.throws(() => h.ctx.draft('inventory'), /owns no domain/);
});

// ---------------------------------------------------------------------------------------
// item.equip / item.unequip

test('item.equip swaps the weapon, with the stats it gives at the wearer\'s level', () => {
    const h = harness();
    const result = h.run('item.equip', { stack: 'it_blade001' });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.summary, 'Ren equips the Steel Blade (ATK +4, DEX +1, capped from ATK +6, DEX +1 at level 3); puts away the Iron Dagger.');
    assert.deepEqual(h.calls, [
        { type: 'inventory.unequip', payload: { stack: 'it_dagger01' } },
        { type: 'inventory.equip', payload: { stack: 'it_blade001', slot: 'weapon' } },
    ]);
    const stacks = h.state().domains.inventory.stacks;
    assert.equal(stacks.it_blade001.equipped, 'weapon');
    assert.equal(stacks.it_dagger01.equipped, null);
    assert.deepEqual(result.receipt.data.removed, ['it_dagger01']);
});

test('item.equip caps an epic piece by the level cap (v1 capItem) and says so', () => {
    const h = harness();
    const result = h.run('item.equip', { stack: 'it_stars001' });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.data.capped, true);
    assert.match(result.receipt.summary, /^Ren equips the Starsteel Sword \(ATK \+\d+.*, capped from ATK \+20, crit \+4% at level 3\); puts away the Iron Dagger\.$/);
    assert.ok(result.receipt.data.stats.ATK < 20);
});

test('item.equip: a two-handed weapon puts the off-hand away; an off-hand beside it is refused', () => {
    const h = harness();
    const result = h.run('item.equip', { stack: 'it_great001' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.receipt.data.removed, ['it_dagger01', 'it_buckle01']);
    const stacks = h.state().domains.inventory.stacks;
    assert.equal(stacks.it_buckle01.equipped, null);
    refused(h, 'item.equip', { stack: 'it_buckle01' }, 'INVALID', 'The Greatsword is two-handed: put it away before taking up the Oak Buckler.');
});

test('item.equip keeps to the rules\' limits for accessories and worn pieces (v1 gearLimits)', () => {
    const h = harness();
    refused(h, 'item.equip', { stack: 'it_charm001' }, 'INVALID', 'For Ren only 2 accessories count: take one off first.');
    refused(h, 'item.equip', { stack: 'it_helm0001' }, 'INVALID', 'For Ren only 1 worn piece counts: take one off first.');
    // Taking a ring off makes room.
    assert.equal(h.run('item.unequip', { stack: 'it_ring0002' }).ok, true);
    assert.equal(h.run('item.equip', { stack: 'it_charm001' }).ok, true);
    // The reader's own limits.
    const roomy = harness(makeState(), { gear: { worn: 2, accessories: 3 } });
    assert.equal(roomy.run('item.equip', { stack: 'it_charm001' }).ok, true);
    assert.equal(roomy.run('item.equip', { stack: 'it_helm0001' }).ok, true);
    const none = harness(makeState(), { rules: { gear: { accessories: 0 } } });
    refused(none, 'item.equip', { stack: 'it_charm001' }, 'INVALID', 'In this chat\'s rules no accessories count.');
});

test('item.equip refuses what is not gear, is already worn, is someone else\'s, or is gone', () => {
    const h = harness();
    refused(h, 'item.equip', { stack: 'it_draught1' }, 'INVALID', 'The Minor Healing Draught is not something to wear or wield.');
    refused(h, 'item.equip', { stack: 'it_dagger01' }, 'INVALID', 'Ren already has the Iron Dagger on.');
    refused(h, 'item.equip', { stack: 'it_blade001', actor: LYRA }, 'INVALID', 'Ren carries the Steel Blade: give it to Lyra first.');
    refused(h, 'item.equip', { stack: 'it_blade001', actor: 'ac_nobody01' }, 'INVALID', 'That companion is not in the party.');
    refused(h, 'item.equip', { stack: 'it_nothing1' }, 'NOT_FOUND');
});

test('item.unequip takes a piece off; refuses one not worn', () => {
    const h = harness();
    const result = h.run('item.unequip', { stack: 'it_dagger01' });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.summary, 'Ren takes off the Iron Dagger.');
    assert.deepEqual(h.calls, [{ type: 'inventory.unequip', payload: { stack: 'it_dagger01' } }]);
    refused(h, 'item.unequip', { stack: 'it_dagger01' }, 'INVALID', 'The Iron Dagger is not being worn.');
    refused(h, 'item.unequip', { stack: 'it_nothing1' }, 'NOT_FOUND');
});

// ---------------------------------------------------------------------------------------
// item.give

test('item.give hands a piece to a companion (taking it off first), who can then wear it', () => {
    const h = harness();
    const result = h.run('item.give', { stack: 'it_dagger01', to: LYRA });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.summary, 'Lyra takes the Iron Dagger.');
    assert.deepEqual(h.calls, [
        { type: 'inventory.unequip', payload: { stack: 'it_dagger01' } },
        { type: 'inventory.transfer', payload: { stack: 'it_dagger01', to: LYRA, qty: 1 } },
    ]);
    assert.equal(h.state().domains.inventory.stacks.it_dagger01.owner, LYRA);
    const worn = h.run('item.equip', { stack: 'it_dagger01', actor: LYRA });
    assert.equal(worn.receipt.summary, 'Lyra equips the Iron Dagger (ATK +3).');
});

test('item.give: several of a stack, and every refusal', () => {
    const h = harness();
    const result = h.run('item.give', { stack: 'it_draught1', to: LYRA, qty: 2 });
    assert.equal(result.receipt.summary, 'Lyra takes 2 Minor Healing Draught.');
    refused(h, 'item.give', { stack: 'it_draught1', to: LYRA }, 'INVALID', 'Lyra already carries the Minor Healing Draught.');
    refused(h, 'item.give', { stack: 'it_tonic001', to: LYRA, qty: 2 }, 'NOT_ENOUGH', 'There is only 1 Mana Tonic to give.');
    refused(h, 'item.give', { stack: 'it_tonic001', to: LYRA, qty: 0 }, 'INVALID', 'Give at least one.');
    refused(h, 'item.give', { stack: 'it_tonic001', to: LYRA, qty: 1.5 }, 'INVALID');
    refused(h, 'item.give', { stack: 'it_tonic001', to: 'ac_nobody01' }, 'NOT_FOUND', 'That companion is not in the party.');
    refused(h, 'item.give', { stack: 'it_nothing1', to: LYRA }, 'NOT_FOUND');
    refused(h, 'item.give', { stack: 'it_npc00001', to: LYRA }, 'NOT_FOUND');
});
