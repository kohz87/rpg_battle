// How rules.equipPlan gets its inputs (contract §3): rulesHash, the wearer's base sheet and one ItemRule per def come
// through the seam queries (rules.identity, rules.sheet, rules.item) once track B3's frozen rules answer them; until
// then the one INTERIM binding (equip-query.js) supplies them, and the two are never mixed. The slot queries are the
// payloads track C's rules screens (draft #139) send and read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part } from '../../../src/v2/items/index.js';
import { INTERIM_BINDING, INTERIM_RULES_HASH, equipEnv, interimItemRule, interimSheet, interimSheetQuery } from '../../../src/v2/items/equip-query.js';
import { equipInputHash as hostInputHash } from '../../vendor/story-block/src/v2/domains/inventory.js';
import { LYRA, PC, makeState } from './helpers/state.js';

const clone = value => JSON.parse(JSON.stringify(value));
const run = (name, state, args, queries = {}) => {
    const all = { ...part.queries, ...queries };
    const tools = { query: (other, otherArgs) => { if (!all[other]) throw Object.assign(new Error(`There is no query called "${other}".`), { code: 'NOT_FOUND' }); return all[other](state, otherArgs, tools); } };
    return all[name](state, args, tools);
};
const H = 'e'.repeat(64);
const rule = (def, allowedSlots, hands, requires = {}) => ({ def, allowedSlots, hands, requires, weight: 1, unique: false });

test('the interim binding is named, signs plans with a fixed hash of its name, and derives rules from the def alone', () => {
    assert.equal(INTERIM_BINDING, 'rb-items-interim-1');
    assert.match(INTERIM_RULES_HASH, /^[0-9a-f]{64}$/);
    const state = makeState();
    const plan = run('rules.equipPlan', state, { stack: 'it_blade001', actor: PC });
    assert.equal(plan.ok, true, plan.message);
    assert.equal(plan.plan.rulesHash, INTERIM_RULES_HASH);
    const defs = state.domains.inventory.defs;
    assert.deepEqual(interimItemRule(defs['story/steel-blade']).rule, { def: 'story/steel-blade', requires: {}, weight: 4, unique: false, allowedSlots: ['weapon'], hands: 1 });
    assert.equal(interimItemRule(defs['story/greatsword']).rule.hands, 2);
    assert.deepEqual(interimItemRule(defs['story/oak-buckler']).rule.allowedSlots, ['offhand']);
    assert.deepEqual(interimItemRule(defs['story/silver-ring']).rule.allowedSlots, ['accessory-1'], 'one slot: the interim rule never invents a second');
    assert.equal(interimItemRule(defs['story/rope']), null, 'not equipment: no rule');
    const generic = interimItemRule({ id: 'pack.x/band', name: 'Plain Band', kind: 'equipment', slot: 'worn', tags: [] });
    assert.deepEqual(generic.rule.allowedSlots, []);
    assert.match(generic.note, /Plain Band has an old "worn" slot/);
    // The hash Story Block recomputes from its own records is the plan's.
    const stack = state.domains.inventory.stacks.it_blade001;
    const worn = [state.domains.inventory.stacks.it_dagger01];
    const sheet = interimSheet(state, PC);
    assert.equal(plan.plan.inputHash, hostInputHash({ rulesHash: INTERIM_RULES_HASH, actor: PC, stats: sheet.stats, life: sheet.life, targetSlot: null, stack, affected: worn }));
});

test('the interim sheet is the party domain\'s base stats and a known life; a downed or dead member is refused, not unavailable', () => {
    const state = makeState();
    assert.deepEqual(interimSheet(state, PC), { id: PC, kind: 'pc', life: 'alive', stats: { STR: 7, VIT: 7, AGI: 6, DEX: 6, INT: 5, LUK: 5, CHA: 5 } });
    assert.equal(interimSheet(state, LYRA).kind, 'companion');
    assert.equal(interimSheet(state, 'ac_nobody01'), null);
    assert.deepEqual(Object.keys(interimSheetQuery(state, { actor: PC })).sort(), ['id', 'kind', 'level', 'life', 'name', 'stats']);
    assert.equal(interimSheetQuery(state, { actor: 'ac_nobody01' }), null);
    state.domains.party.actors[LYRA].hp.cur = 0;
    assert.equal(run('rules.equipPlan', state, { stack: 'it_blade001', actor: LYRA }).code, 'REFUSED');
    state.domains.party.actors[LYRA].hp.cur = 5;
    state.domains.party.actors[LYRA].conditions = [{ kind: 'dead', stacks: 1 }];
    assert.equal(interimSheet(state, LYRA).life, 'dead');
    assert.match(run('rules.equipPlan', state, { stack: 'it_blade001', actor: LYRA }).message, /dead/);
    assert.equal(run('items.canWear', state, { actor: LYRA, stack: 'it_blade001' }).ok, false);
});

test('with frozen rules answering, their hash, sheet and ItemRules are used, never mixed with the interim ones', () => {
    const state = makeState();
    const queries = {
        'rules.identity': () => ({ hash: H, packId: 'p', version: '1' }),
        'rules.sheet': ({ }, { actor }) => ({ id: actor, kind: actor === PC ? 'pc' : 'companion', life: 'alive', stats: { STR: 12, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 } }),
        // The frozen rules describe every def the actor wears; only the blade differs from what the def alone says.
        'rules.item': (_state, { def }) => (def === 'story/steel-blade' ? rule(def, ['weapon', 'offhand'], 1, { STR: 12 }) : interimItemRule(state.domains.inventory.defs[def])?.rule ?? null),
    };
    const plan = run('rules.equipPlan', state, { stack: 'it_blade001', actor: PC, targetSlot: 'offhand' }, queries);
    assert.equal(plan.ok, true, plan.message);
    assert.equal(plan.plan.rulesHash, H);
    assert.equal(plan.plan.slot, 'offhand', 'a second slot the interim rule could not give');
    assert.equal(plan.plan.inputHash, hostInputHash({ rulesHash: H, actor: PC, stats: { STR: 12, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, life: 'alive', targetSlot: 'offhand', stack: state.domains.inventory.stacks.it_blade001, affected: [state.domains.inventory.stacks.it_buckle01] }));
    // The sheet's STR 12 meets the blade's requirement; the party domain's 7 would not (base stats only).
    const low = run('rules.equipPlan', state, { stack: 'it_blade001', actor: PC }, { ...queries, 'rules.sheet': ({ }, { actor }) => ({ id: actor, kind: 'pc', life: 'alive', stats: { STR: 11, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 } }) });
    assert.equal(low.code, 'REFUSED');
    assert.match(low.message, /needs STR 12, base STR is 11/);
    // A piece no rule describes fails closed: the interim derivation is not used beside a real hash.
    const missing = run('rules.equipPlan', state, { stack: 'it_stars001', actor: PC }, { ...queries, 'rules.item': (_state, { def }) => (def === 'story/starsteel-sword' ? null : queries['rules.item'](_state, { def })) });
    assert.equal(missing.code, 'RULES_MISMATCH');
    // A real hash but no sheet: unavailable (it never falls back to the party domain's numbers).
    const noSheet = run('rules.equipPlan', clone(state), { stack: 'it_blade001', actor: PC }, { 'rules.identity': queries['rules.identity'], 'rules.item': queries['rules.item'] });
    assert.equal(noSheet.code, 'DEPENDENCY_UNAVAILABLE');
    // A sheet the rules do not know is NOT_FOUND.
    assert.equal(run('rules.equipPlan', state, { stack: 'it_blade001', actor: PC }, { ...queries, 'rules.sheet': () => null }).code, 'NOT_FOUND');
});

test('equipEnv: no tools at all is the interim binding; a malformed answer from the rules is the planner\'s failure, not a throw', () => {
    const state = makeState();
    const alone = equipEnv(state, undefined, PC, ['story/steel-blade']);
    assert.equal(alone.ok, true);
    assert.equal(alone.binding, 'interim');
    assert.equal(alone.env.rulesHash, INTERIM_RULES_HASH);
    assert.deepEqual(Object.keys(alone.env.itemRules).sort(), ['story/iron-dagger', 'story/jade-ring', 'story/leather-boots', 'story/oak-buckler', 'story/silver-ring', 'story/steel-blade']);
    const bad = run('rules.equipPlan', state, { stack: 'it_blade001', actor: PC }, { 'rules.sheet': () => ({ id: PC, kind: 'pc', life: 'alive', stats: { STR: 'many' } }) });
    assert.equal(bad.code, 'DEPENDENCY_UNAVAILABLE');
    for (const args of [undefined, null, 5, [], { stack: 'it_blade001' }, { actor: PC }, { stack: 'it_blade001', actor: PC, extra: 1 }]) {
        assert.equal(run('rules.equipPlan', state, args).code, 'INVALID', JSON.stringify(args));
    }
});

test('the payloads track C\'s rules screens send and read (draft #139): equipPlan, slots, canWear and the item.equip fields', () => {
    const state = makeState();
    // rules.equipPlan { stack, actor } / { stack, actor, targetSlot }: { ok:true, plan:{ actor, stack, def, slot, unequip, move, rulesHash, inputHash } } | { ok:false, code, message }
    const plan = run('rules.equipPlan', state, { stack: 'it_blade001', actor: PC });
    assert.deepEqual(Object.keys(plan), ['ok', 'plan']);
    assert.deepEqual(Object.keys(plan.plan), ['actor', 'stack', 'def', 'slot', 'unequip', 'move', 'rulesHash', 'inputHash']);
    assert.deepEqual(plan.plan.unequip, ['it_dagger01']);
    assert.deepEqual(plan.plan.move, [{ stack: 'it_blade001', from: 'party', to: PC }], 'a bag piece goes to its wearer in the same step');
    const refused = run('rules.equipPlan', state, { stack: 'it_blade001', actor: PC, targetSlot: 'head' });
    assert.deepEqual(Object.keys(refused), ['ok', 'code', 'message']);
    // items.slots { actor }: the fixed order with labels and blockedBy, beside the compatibility counts.
    const slots = run('items.slots', state, { actor: PC });
    assert.deepEqual(Object.keys(slots).sort(), ['accessory', 'slots', 'worn']);
    assert.deepEqual(slots.slots.map(slot => Object.keys(slot).join()), Array(8).fill('key,label,blockedBy'));
    // items.canWear { actor, stack } and { actor, stack, targetSlot }: { ok } | { ok:false, why }
    assert.deepEqual(run('items.canWear', state, { actor: PC, stack: 'it_blade001' }), { ok: true });
    const no = run('items.canWear', state, { actor: PC, stack: 'it_blade001', targetSlot: 'head' });
    assert.deepEqual(Object.keys(no), ['ok', 'why']);
    assert.equal(no.ok, false);
    // item.equip { stack, to, targetSlot } is the command's payload (tests/v2/items/commands.test.js and p07-equip-host.test.js run it).
    assert.deepEqual(Object.keys(part.commands).filter(name => name === 'item.equip'), ['item.equip']);
});
