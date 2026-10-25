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
    refused(h, 'item.use', { stack: 'it_draught1', target: LYRA }, 'REFUSED', 'Lyra does not need the Minor Healing Draught now.');
    assert.deepEqual(h.calls, [], 'no sub-command ran');
    const mpFull = makeState();
    mpFull.domains.party.actors[PC].mp.cur = 40;
    refused(harness(mpFull), 'item.use', { stack: 'it_tonic001', target: PC }, 'REFUSED', 'Ren does not need the Mana Tonic now.');
});

test('item.use refuses what is not a consumable, a fight-only flask, an empty or unknown stack, a stranger', () => {
    const h = harness();
    refused(h, 'item.use', { stack: 'it_rope0001', target: PC }, 'REFUSED', 'The Rope is not something to use.');
    refused(h, 'item.use', { stack: 'it_blade001', target: PC }, 'REFUSED', 'The Steel Blade is not something to use.');
    refused(h, 'item.use', { stack: 'it_flask001', target: PC }, 'REFUSED', 'Ember Flask can only be used in a fight.');
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
    assert.deepEqual(h.calls, [{ type: 'inventory.equipOn', payload: { stack: 'it_blade001', actor: PC } }], 'one step: the inventory asks the plan and applies it');
    const stacks = h.state().domains.inventory.stacks;
    assert.equal(stacks.it_blade001.equipped, 'weapon');
    assert.equal(result.receipt.data.slot, 'weapon');
    assert.equal(result.receipt.data.key, 'weapon');
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
    assert.deepEqual(result.receipt.data.removed, ['it_buckle01', 'it_dagger01']);
    const stacks = h.state().domains.inventory.stacks;
    assert.equal(stacks.it_buckle01.equipped, null);
    refused(h, 'item.equip', { stack: 'it_buckle01' }, 'REFUSED', 'A two-handed weapon blocks offhand.');
});

test('item.equip: one piece to each of the eight slots; a second for a slot takes the first one off', () => {
    const h = harness();
    // The charm is an accessory-1 piece: it replaces the Silver Ring there and leaves the Jade Ring in accessory-2.
    const charm = h.run('item.equip', { stack: 'it_charm001' });
    assert.equal(charm.ok, true, charm.message);
    assert.equal(charm.receipt.data.slot, 'accessory-1');
    assert.deepEqual(charm.receipt.data.removed, ['it_ring0001']);
    assert.match(charm.receipt.summary, /; puts away the Silver Ring\.$/);
    // The helm goes on the empty head slot: nothing comes off; the boots are in feet and stay.
    const helm = h.run('item.equip', { stack: 'it_helm0001' });
    assert.equal(helm.ok, true, helm.message);
    assert.equal(helm.receipt.data.slot, 'head');
    assert.deepEqual(helm.receipt.data.removed, []);
    const stacks = h.state().domains.inventory.stacks;
    assert.deepEqual(['it_charm001', 'it_ring0002', 'it_helm0001', 'it_boots001'].map(id => stacks[id].equipped), ['accessory-1', 'accessory-2', 'head', 'feet']);
    assert.equal(stacks.it_ring0001.equipped, null);
});

test('item.equip { targetSlot }: the reader picks the slot; a slot the piece cannot use, or a word that is no slot, is refused', () => {
    const h = harness();
    assert.equal(h.run('item.unequip', { stack: 'it_buckle01' }).ok, true);
    const shield = h.run('item.equip', { stack: 'it_buckle01', targetSlot: 'offhand' });
    assert.equal(shield.ok, true, shield.message);
    assert.equal(shield.receipt.data.targetSlot, 'offhand');
    assert.deepEqual(h.calls, [{ type: 'inventory.equipOn', payload: { stack: 'it_buckle01', actor: PC, targetSlot: 'offhand' } }]);
    assert.equal(h.run('item.unequip', { stack: 'it_buckle01' }).ok, true);
    refused(h, 'item.equip', { stack: 'it_buckle01', targetSlot: 'weapon' }, 'REFUSED', 'This item cannot use the requested slot.');
    // Only the canonical IDs are slots in a command; an older word is for reading old records, not for new ones.
    refused(h, 'item.equip', { stack: 'it_buckle01', targetSlot: 'off-hand' }, 'INVALID');
    refused(h, 'item.equip', { stack: 'it_buckle01', targetSlot: 'worn' }, 'INVALID');
    // No plan, token or bypass can be passed along; nothing but the four fields is read.
    for (const claim of ['plan', 'token', 'bypass', 'force', 'rulesHash', 'unequip', 'move']) {
        refused(h, 'item.equip', { stack: 'it_buckle01', [claim]: true }, 'INVALID');
    }
});

test('item.equip refuses what is not gear, is already worn, is someone else\'s, or is gone', () => {
    const h = harness();
    refused(h, 'item.equip', { stack: 'it_draught1' }, 'REFUSED', 'The Minor Healing Draught is not something to wear or wield.');
    refused(h, 'item.equip', { stack: 'it_dagger01' }, 'REFUSED', 'Ren already has the Iron Dagger on.');
    refused(h, 'item.equip', { stack: 'it_blade001', actor: LYRA }, 'REFUSED', 'Ren carries the Steel Blade: give it to Lyra first.');
    refused(h, 'item.equip', { stack: 'it_blade001', actor: 'ac_nobody01' }, 'NOT_FOUND', 'That companion is not in the party.');
    refused(h, 'item.equip', { stack: 'it_nothing1' }, 'NOT_FOUND');
    // The slot it is in already: asking for that slot again is the same refusal; another slot is a move.
    refused(h, 'item.equip', { stack: 'it_dagger01', targetSlot: 'weapon' }, 'REFUSED', 'Ren already has the Iron Dagger on.');
});

test('item.equip { stack, to }: a companion wears a piece of the bag (UI 8f): moved to them, checked, then worn', () => {
    const h = harness();
    const result = h.run('item.equip', { stack: 'it_blade001', to: LYRA });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(h.calls, [{ type: 'inventory.equipOn', payload: { stack: 'it_blade001', actor: LYRA } }],
        'the move and the wear are one inventory command (equipOn), so a swipe or a rollback undoes both');
    const stacks = h.state().domains.inventory.stacks;
    assert.equal(stacks.it_blade001.owner, LYRA);
    assert.equal(stacks.it_blade001.equipped, 'weapon');
    assert.match(result.receipt.summary, /^Lyra equips the Steel Blade \(/);
    assert.deepEqual(result.receipt.data.moved, { from: 'party', to: LYRA });
    assert.equal(result.receipt.data.actor, LYRA);
});

test('item.equip { to } for the main character: a piece the party holds needs no move (as item.equip { stack })', () => {
    const plain = harness();
    const asked = harness();
    const a = plain.run('item.equip', { stack: 'it_blade001' });
    const b = asked.run('item.equip', { stack: 'it_blade001', to: PC });
    assert.equal(b.ok, true);
    assert.deepEqual(asked.calls, plain.calls);
    assert.equal(b.receipt.summary, a.receipt.summary);
    assert.equal(a.ok, true);
    assert.equal(b.receipt.data.moved, undefined);
});

test('item.equip { to } refuses a stranger, a non-gear item and a piece someone wears; the carry limit is the inventory\'s step', () => {
    const h = harness();
    refused(h, 'item.equip', { stack: 'it_blade001', to: 'ac_nobody01' }, 'NOT_FOUND', 'That companion is not in the party.');
    refused(h, 'item.equip', { stack: 'it_draught1', to: LYRA }, 'REFUSED', 'The Minor Healing Draught is not something to wear or wield.');
    refused(h, 'item.equip', { stack: 'it_dagger01', to: LYRA }, 'REFUSED', 'Ren already has the Iron Dagger on.');
    // A piece another member carries is not taken from them by wearing it: hand it over first.
    const state = makeState();
    state.domains.inventory.stacks.it_blade001.owner = LYRA;
    const carried = harness(state);
    refused(carried, 'item.equip', { stack: 'it_blade001', to: PC }, 'REFUSED', 'Another member carries this piece: hand it over first.');
});

test('item.unequip takes a piece off; refuses one not worn', () => {
    const h = harness();
    const result = h.run('item.unequip', { stack: 'it_dagger01' });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.summary, 'Ren takes off the Iron Dagger.');
    assert.deepEqual(h.calls, [{ type: 'inventory.unequip', payload: { stack: 'it_dagger01' } }]);
    refused(h, 'item.unequip', { stack: 'it_dagger01' }, 'REFUSED', 'The Iron Dagger is not being worn.');
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
    refused(h, 'item.give', { stack: 'it_draught1', to: LYRA }, 'REFUSED', 'Lyra already carries the Minor Healing Draught.');
    refused(h, 'item.give', { stack: 'it_tonic001', to: LYRA, qty: 2 }, 'NOT_ENOUGH', 'There is only 1 Mana Tonic to give.');
    refused(h, 'item.give', { stack: 'it_tonic001', to: LYRA, qty: 0 }, 'INVALID', 'Give at least one.');
    refused(h, 'item.give', { stack: 'it_tonic001', to: LYRA, qty: 1.5 }, 'INVALID');
    refused(h, 'item.give', { stack: 'it_tonic001', to: 'ac_nobody01' }, 'NOT_FOUND', 'That companion is not in the party.');
    refused(h, 'item.give', { stack: 'it_nothing1', to: LYRA }, 'NOT_FOUND');
    refused(h, 'item.give', { stack: 'it_npc00001', to: LYRA }, 'NOT_FOUND');
});
