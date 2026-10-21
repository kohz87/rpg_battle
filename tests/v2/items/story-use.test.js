// Using a thing in the story (MODULES §F96): the `use` change line, `item.use { story: true }` (the
// path Story Block takes for a `- item … | used: yes` line), every refusal (nothing used, the
// story told why), and the static line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part, USE_STATIC, usedByLine } from '../../../src/v2/items/index.js';
import { makeCtx } from './helpers/fake-ctx.js';
import { LYRA, PC, makeState } from './helpers/state.js';

const harness = (state = makeState(), settings = {}) => makeCtx({ state, settings, handlers: { ...part.commands, 'capture.use': part.kinds.use.apply }, queries: part.queries });
const use = (h, name, labels = {}) => h.run('capture.use', { op: '!', kind: 'use', name, text: '', labels });

/** A refusal: a receipt that tells the story, and nothing changed. */
function told(h, name, labels, summary) {
    const before = h.state();
    const r = use(h, name, labels);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.receipt.summary, summary);
    assert.equal(r.receipt.narrate, true);
    assert.equal(r.receipt.data.refused, true);
    assert.deepEqual(h.calls, [], 'nothing consumed, nobody healed');
    assert.deepEqual(h.state(), before);
    return r;
}

test('! use: one dose on the main character by default, the effect from the def, told to the next reply', () => {
    const h = harness();
    const r = use(h, 'Minor Healing Draught');
    assert.equal(r.ok, true, r.message);
    assert.equal(r.receipt.summary, 'Ren uses the Minor Healing Draught: +20 HP (now 77/82 HP).');
    assert.equal(r.receipt.narrate, true);
    assert.deepEqual(h.calls, [
        { type: 'inventory.consume', payload: { stack: 'it_draught1', qty: 1 } },
        { type: 'party.heal', payload: { actor: PC, hp: 20, cure: [] } },
    ]);
    assert.equal(h.state().domains.inventory.stacks.it_draught1.qty, 1);
    assert.deepEqual({ ...r.receipt.data, now: undefined }, { actor: PC, stack: 'it_draught1', def: 'story/minor-healing-draught', name: 'Minor Healing Draught', doses: 1, asked: 1, hp: 20, mp: 0, cured: [], now: undefined, refused: false });
});

test('! use … | on: Lyra cures her with her own antidote first; qty: N doses, stopping where one would not help', () => {
    const h = harness();
    // Lyra carries a draught of her own: hers is used, not the bag's. She is at full HP, so it is refused.
    told(h, 'minor healing draught', { on: 'Lyra' }, 'Lyra is at full HP; the Minor Healing Draught stays in the bag.');
    const cure = use(h, 'Antidote', { on: 'lyra' });
    assert.equal(cure.receipt.summary, 'Lyra uses the Antidote: cures poisoned (now 60/60 HP).');
    assert.deepEqual(h.state().domains.party.actors[LYRA].conditions, []);
    // Ren is 25 below max: two doses would be +20 and +5; a third would do nothing.
    const three = harness();
    const r = use(three, 'Minor Healing Draught', { qty: '3' });
    assert.equal(r.receipt.summary, 'Ren uses 2 Minor Healing Draught: +25 HP (now 82/82 HP); only 2 were in the bag.');
    assert.equal(r.receipt.data.doses, 2);
    assert.equal(three.state().domains.inventory.stacks.it_draught1, undefined);
    const state = makeState();
    state.domains.inventory.stacks.it_draught1.qty = 5;
    const five = harness(state);
    assert.equal(use(five, 'Minor Healing Draught', { qty: '4' }).receipt.summary, 'Ren uses 2 Minor Healing Draught: +25 HP (now 82/82 HP); 2 more would not help, so they stay in the bag.');
    assert.equal(five.state().domains.inventory.stacks.it_draught1.qty, 3);
});

test('refusals use nothing and tell the story: full HP, nothing to cure, not a consumable, a fight thing, not in the bag, nobody, a fight on', () => {
    const full = makeState();
    full.domains.party.actors[PC].hp.cur = 82;
    told(harness(full), 'Minor Healing Draught', {}, 'Ren is at full HP; the Minor Healing Draught stays in the bag.');
    told(harness(), 'Antidote', {}, 'Ren has nothing for the Antidote to cure; the Antidote stays in the bag.');
    const mp = makeState();
    mp.domains.party.actors[PC].mp.cur = 40;
    told(harness(mp), 'Mana Tonic', {}, 'Ren is at full MP; the Mana Tonic stays in the bag.');
    told(harness(), 'Rope', {}, 'The Rope is not something to use up; it stays with the party.');
    told(harness(), 'Ember Flask', {}, 'The Ember Flask is for a fight; it stays in the bag.');
    told(harness(), 'Elixir of Ages', {}, 'There is no Elixir of Ages among the party\'s things; nothing is used.');
    told(harness(), 'Minor Healing Draught', { on: 'Mira' }, 'Nobody of that name is in the party; the Minor Healing Draught stays in the bag.');
    // A fight under way with no fight action to take: a Problem, nothing used.
    const fight = makeState();
    fight.domains.combat = { session: { id: 'cb_1', status: 'active' } };
    const h = harness(fight);
    const before = h.state();
    const r = use(h, 'Minor Healing Draught');
    assert.deepEqual([r.ok, r.code, r.message], [false, 'REFUSED', 'It is not the party\'s turn in the fight: the Minor Healing Draught stays in the bag.']);
    assert.deepEqual(h.state(), before);
});

test('malformed use lines are refused (a problem): no name, a bad count, no character', () => {
    const h = harness();
    assert.equal(use(h, '').code, 'INVALID');
    assert.equal(use(h, 'Antidote', { qty: '0' }).code, 'INVALID');
    assert.equal(use(h, 'Antidote', { qty: '11' }).code, 'INVALID');
    const empty = makeState();
    empty.domains.party.pc = null;
    assert.equal(use(harness(empty), 'Antidote').code, 'NOT_FOUND');
});

test('item.use { story: true } (Story Block\'s `- item … | used: yes` path) takes the same rules; a screen cannot', () => {
    const h = harness();
    const r = h.run('item.use', { name: 'Minor Healing Draught', on: 'Ren', story: true });
    assert.equal(r.receipt.summary, 'Ren uses the Minor Healing Draught: +20 HP (now 77/82 HP).');
    const full = makeState();
    full.domains.party.actors[PC].hp.cur = 82;
    const refused = harness(full).run('item.use', { name: 'Minor Healing Draught', story: true });
    assert.equal(refused.receipt.data.refused, true);
    // A click is not the story: the button rules (and a hard refusal) apply.
    const ui = makeCtx({ state: makeState(), handlers: part.commands, queries: part.queries });
    ui.ctx.cause = 'ui';
    assert.equal(ui.run('item.use', { name: 'Minor Healing Draught', story: true }).code, 'NOT_FOUND');
});

test('usedByLine: a `- item` line is a use when it or the reply says so, never when lost, sold or given', () => {
    assert.equal(usedByLine({ labels: { used: 'yes' } }), true);
    assert.equal(usedByLine({ text: 'drank it in one go', labels: {} }), true);
    assert.equal(usedByLine({ text: '', labels: { qty: '1' } }, 'Mira drank the potion and sighed.'), true);
    assert.equal(usedByLine({ text: 'sold to the fence', labels: {} }, 'Mira drank her ale.'), false);
    assert.equal(usedByLine({ text: 'lost in the river', labels: {} }), false);
    assert.equal(usedByLine({ text: 'given to the guard', labels: { used: 'yes' } }), false);
    assert.equal(usedByLine({ text: '', labels: {} }, 'The potion rolled away.'), false);
});

test('the static line tells the story how to write a use, and never changes', () => {
    assert.equal(part.context.static(), USE_STATIC);
    assert.equal(part.context.static(), USE_STATIC);
    assert.match(USE_STATIC, /`! use <item> \| on: <who>`/);
    assert.match(part.kinds.use.grammar, /^! use <item> \| on: Name \| by: Name \| qty: 1/);
    assert.equal(typeof part.commands['item.use'], 'function', 'item.use stays a command');
});
