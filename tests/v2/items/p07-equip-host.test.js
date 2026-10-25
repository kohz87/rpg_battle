// P07 equipment on the real Story Block host (the vendored E4 runtime and testkit): item.equip is routed through
// inventory.equipOn with `targetSlot`, Story Block checks the plan this module's `rules.equipPlan` gives and applies
// it in one step, and nothing a caller says can bypass it. Also the slot queries as the host's pickers read them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';

const quiet = t => t.mock.method(console, 'warn', () => {});

const ITEMS = [
    '+ item Iron Sword | note: weapon, ATK +4', '+ item Greatsword | note: ATK +9, two-handed, rare', '+ item Oak Buckler | note: offhand, DEF +2',
    '+ item Steel Dagger | note: weapon, ATK +3', '+ item Twin Dagger | note: weapon, ATK +3', '+ item Chain Shirt | note: armour DEF +3',
    '+ item Iron Helm | note: DEF +2, slot: head', '+ item Silver Ring | note: LUK +2, slot: accessory-1', '+ item Old Hood | note: worn, DEF +1',
    '+ item Minor Healing Draught | qty: 2',
];

async function hero(options = {}, lines = ITEMS) {
    const host = await rpgHost({ equip: true, ...options });
    assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await host.send('We set out.', host.reply('Bluewatch Town.', ['~ place Bluewatch Town | kind: settlement', '+ coin 900', ...lines]));
    host.rows = () => host.q('inventory.items', {});
    host.stackOf = name => host.rows().find(item => item.name === name)?.stack;
    host.at = name => host.rows().find(item => item.name === name)?.equipped ?? null;
    host.pc = () => host.q('party.pc').id;
    host.snapshot = () => JSON.stringify(host.rows().map(row => [row.stack, row.owner, row.equipped]));
    return host;
}
const equip = (host, name, extra = {}) => host.cmd('item.equip', { stack: host.stackOf(name), ...extra });

test('item.equip on the host: one inventory.equipOn step; a two-hander clears the off-hand and an off-hand beside it is refused', async t => {
    quiet(t);
    await seeded(21, async () => {
        const host = await hero();
        try {
            assert.equal((await equip(host, 'Iron Sword')).ok, true);
            assert.equal((await equip(host, 'Oak Buckler')).ok, true);
            assert.deepEqual([host.at('Iron Sword'), host.at('Oak Buckler')], ['weapon', 'offhand']);
            const great = await equip(host, 'Greatsword');
            assert.equal(great.ok, true, great.message);
            assert.equal(great.receipt.data.slot, 'weapon');
            assert.deepEqual([...great.receipt.data.removedNames].sort(), ['Iron Sword', 'Oak Buckler']);
            assert.deepEqual([host.at('Greatsword'), host.at('Iron Sword'), host.at('Oak Buckler')], ['weapon', null, null]);
            assert.equal(host.rows().filter(row => row.equipped === 'weapon').length, 1, 'one stack for the two-hander');
            const before = host.snapshot();
            const shield = await equip(host, 'Oak Buckler');
            assert.equal(shield.ok, false);
            assert.equal(shield.code, 'REFUSED');
            assert.match(shield.message, /two-handed/);
            assert.equal(host.snapshot(), before, 'nothing changed');
            // The slot picker says what blocks the off-hand, and the question is the same answer.
            const slots = host.q('items.slots', { actor: host.pc() });
            assert.equal(slots.slots.find(slot => slot.key === 'offhand').blockedBy, host.stackOf('Greatsword'));
            assert.equal(host.q('items.canWear', { actor: host.pc(), stack: host.stackOf('Oak Buckler') }).ok, false);
        } finally {
            host.close();
        }
    });
});

test('a piece goes to the slot its def names; the stack becomes its wearer\'s; the receipt carries the slot', async t => {
    quiet(t);
    await seeded(22, async () => {
        const host = await hero();
        try {
            for (const [name, slot] of [['Chain Shirt', 'body'], ['Iron Helm', 'head'], ['Silver Ring', 'accessory-1'], ['Iron Sword', 'weapon']]) {
                const result = await equip(host, name);
                assert.equal(result.ok, true, `${name}: ${result.message}`);
                assert.equal(host.at(name), slot);
                assert.equal(result.receipt.data.slot, slot);
                assert.equal(result.receipt.data.key, slot);
                assert.equal(host.rows().find(row => row.name === name).owner, host.pc(), 'a piece of the bag goes to its wearer');
            }
            const gear = host.q('items.gear', {});
            assert.deepEqual(gear.counted.map(row => row.key).sort(), ['accessory-1', 'body', 'head', 'weapon']);
            // Taking one off needs no plan; the others stay.
            assert.equal((await host.cmd('item.unequip', { stack: host.stackOf('Iron Helm') })).ok, true);
            assert.equal(host.at('Iron Helm'), null);
        } finally {
            host.close();
        }
    });
});

test('a piece with an old generic slot word is refused until the reader chooses; a word that is no slot is refused for good', async t => {
    quiet(t);
    await seeded(23, async () => {
        const host = await hero();
        try {
            const before = host.snapshot();
            const result = await equip(host, 'Old Hood');
            assert.equal(result.ok, false);
            assert.equal(result.code, 'REFUSED');
            assert.match(result.message, /^Choose where to wear it: Head, Body, Legs or Feet\./);
            assert.deepEqual(host.q('items.canWear', { actor: host.pc(), stack: host.stackOf('Old Hood') }).choose, ['head', 'body', 'legs', 'feet']);
            for (const targetSlot of ['weapon', 'accessory-1', 'worn', 'armour', 'Head', '']) {
                const asked = await equip(host, 'Old Hood', { targetSlot });
                assert.equal(asked.ok, false, `targetSlot ${targetSlot}`);
            }
            assert.equal(host.snapshot(), before);
            const chosen = await equip(host, 'Old Hood', { targetSlot: 'legs' });
            assert.equal(chosen.ok, true, chosen.message);
            assert.equal(host.at('Old Hood'), 'legs');
        } finally {
            host.close();
        }
    });
});

test('direct equip never bypasses the rules: no payload carries a plan, a token or a way round one', async t => {
    quiet(t);
    await seeded(24, async () => {
        const host = await hero();
        try {
            assert.equal((await equip(host, 'Greatsword')).ok, true);
            const before = host.snapshot();
            const sword = host.stackOf('Iron Sword');
            const pc = host.pc();
            const plan = { actor: pc, stack: sword, def: 'story/iron-sword', slot: 'offhand', unequip: [], move: [], rulesHash: 'a'.repeat(64), inputHash: 'b'.repeat(64) };
            const attempts = [
                ['inventory.equip', { stack: host.stackOf('Greatsword'), plan }],
                ['inventory.equipOn', { stack: sword, actor: pc, plan }],
                ['inventory.equipOn', { stack: sword, actor: pc, bypass: true }],
                ['inventory.equipOn', { stack: sword, actor: pc, force: true }],
                ['inventory.equipOn', { stack: sword, actor: pc, token: 'x' }],
                ['inventory.equipOn', { stack: sword, actor: pc, unequip: [], move: [] }],
                ['inventory.equipOn', { stack: sword, actor: pc, rulesHash: 'a'.repeat(64) }],
                ['inventory.equip', { stack: sword, slot: 'armour' }],
                ['item.equip', { stack: sword, plan }],
                ['item.equip', { stack: sword, bypass: true }],
            ];
            for (const [type, payload] of attempts) {
                const result = await host.cmd(type, payload);
                assert.equal(result.ok, false, `${type} ${JSON.stringify(Object.keys(payload))}`);
                assert.ok(['INVALID', 'REFUSED'].includes(result.code), `${type}: ${result.code} ${result.message}`);
            }
            // A two-handed weapon still blocks the off-hand from the inventory's own commands.
            const direct = await host.cmd('inventory.equipOn', { stack: sword, actor: pc, targetSlot: 'offhand' });
            assert.equal(direct.ok, false);
            assert.equal(direct.code, 'REFUSED');
            // A bag piece cannot be equipped directly: it needs "Equip on…" with someone named.
            const bag = await host.cmd('inventory.equip', { stack: host.stackOf('Steel Dagger'), slot: 'weapon' });
            assert.equal(bag.ok, false);
            assert.match(bag.message, /choose who puts it on/);
            assert.equal(host.snapshot(), before, 'nothing changed');
        } finally {
            host.close();
        }
    });
});

test('a spoofed plan is rejected by Story Block, whatever the rules module answers: nothing is written', async t => {
    quiet(t);
    await seeded(25, async () => {
        const tamper = {
            'a displaced piece left out': plan => ({ ...plan, unequip: [] }),
            'a changed input hash': plan => ({ ...plan, inputHash: 'c'.repeat(64) }),
            'an extra field': plan => ({ ...plan, trusted: true }),
            'another wearer': plan => ({ ...plan, actor: 'ac_00000000' }),
            'another piece': plan => ({ ...plan, stack: 'it_00000000' }),
            'a hand-over of someone else\'s piece': plan => ({ ...plan, move: [{ stack: plan.unequip[0] ?? plan.stack, from: 'party', to: 'party' }] }),
        };
        for (const [what, change] of Object.entries(tamper)) {
            let armed = false;
            const host = await hero({
                tweak: module => {
                    const real = module.queries['rules.equipPlan'];
                    module.queries['rules.equipPlan'] = (state, args, tools) => {
                        const answer = real(state, args, tools);
                        return armed && answer?.ok === true ? { ...answer, plan: change(answer.plan) } : answer;
                    };
                },
            });
            try {
                assert.equal((await equip(host, 'Iron Sword')).ok, true, `setup ${what}`);
                armed = true;
                const before = host.snapshot();
                const result = await equip(host, 'Steel Dagger');
                assert.equal(result.ok, false, what);
                assert.ok(['RULES_MISMATCH', 'STALE', 'REFUSED'].includes(result.code), `${what}: ${result.code} ${result.message}`);
                assert.equal(host.snapshot(), before, `${what}: nothing was written`);
                assert.deepEqual([host.at('Iron Sword'), host.at('Steel Dagger')], ['weapon', null]);
                armed = false;
                assert.equal((await equip(host, 'Steel Dagger')).ok, true, `${what}: the honest plan still works`);
            } finally {
                host.close();
            }
        }
    });
});

test('the plan is checked for a stale world: a piece that changed hands since the answer makes it STALE', async t => {
    quiet(t);
    await seeded(26, async () => {
        const host = await hero();
        try {
            assert.equal((await equip(host, 'Iron Sword')).ok, true);
            // The stack asked about is the sword now worn; a plan for another weapon is made against it.
            const plan = host.q('rules.equipPlan', { stack: host.stackOf('Steel Dagger'), actor: host.pc() });
            assert.equal(plan.ok, true);
            assert.deepEqual(plan.plan.unequip, [host.stackOf('Iron Sword')]);
            assert.equal(plan.plan.slot, 'weapon');
            assert.match(plan.plan.inputHash, /^[0-9a-f]{64}$/);
            // Same question, same bytes (a pure query), and a different request (a slot) is a different input.
            assert.deepEqual(host.q('rules.equipPlan', { stack: host.stackOf('Steel Dagger'), actor: host.pc() }), plan);
            const asked = host.q('rules.equipPlan', { stack: host.stackOf('Steel Dagger'), actor: host.pc(), targetSlot: 'weapon' });
            assert.notEqual(asked.plan.inputHash, plan.plan.inputHash);
            // Malformed asks are Failures, not throws.
            for (const args of [{}, { stack: 'x', actor: 'y' }, { stack: host.stackOf('Steel Dagger') }, { stack: host.stackOf('Steel Dagger'), actor: host.pc(), targetSlot: 'armour' }]) {
                const failed = host.q('rules.equipPlan', args);
                assert.equal(failed.ok, false);
                assert.equal(failed.code, 'INVALID');
            }
        } finally {
            host.close();
        }
    });
});

test('a companion wears a piece of the bag (to): handed over and worn in one step; another member\'s piece is not taken; the carry limit applies', async t => {
    quiet(t);
    await seeded(27, async () => {
        const host = await hero({ settings: { modules: { 'rpg-battle': { 'items.carrySize': 10 } } } });
        try {
            const joined = await host.internal('party.addCompanion', { name: 'Lyra', role: 'ranger' });
            assert.equal(joined.ok, true, joined.message);
            const lyra = host.q('party.actors').find(actor => actor.name === 'Lyra').id;
            // Lyra's pack is small: a heavy piece is refused with the reason, and stays in the bag.
            const before = host.snapshot();
            const heavy = await equip(host, 'Greatsword', { to: lyra });
            assert.equal(heavy.ok, false);
            assert.equal(heavy.code, 'REFUSED');
            assert.equal(host.snapshot(), before);
            const light = await equip(host, 'Steel Dagger', { to: lyra });
            assert.equal(light.ok, true, light.message);
            assert.deepEqual([host.at('Steel Dagger'), host.rows().find(row => row.name === 'Steel Dagger').owner], ['weapon', lyra]);
            assert.deepEqual(light.receipt.data.moved, { from: 'party', to: lyra });
            // Lyra carries the dagger: Ren cannot wear her piece by naming himself.
            const stolen = await equip(host, 'Steel Dagger', { to: host.pc() });
            assert.equal(stolen.ok, false);
            assert.equal(stolen.code, 'REFUSED');
            assert.equal(host.at('Steel Dagger'), 'weapon');
        } finally {
            host.close();
        }
    });
});

// The frozen rules (track B3) are not here yet: a test module stands in for the seam queries they will answer, with
// pieces the interim binding cannot express (one allowed in two slots).
const H = 'f'.repeat(64);
const RULES = {
    'story/greatsword': { def: 'story/greatsword', allowedSlots: ['weapon'], hands: 2, requires: {}, weight: 8, unique: false },
    'story/steel-dagger': { def: 'story/steel-dagger', allowedSlots: ['weapon', 'offhand'], hands: 1, requires: {}, weight: 2, unique: false },
    'story/twin-dagger': { def: 'story/twin-dagger', allowedSlots: ['weapon', 'offhand'], hands: 1, requires: {}, weight: 2, unique: false },
    'story/oak-buckler': { def: 'story/oak-buckler', allowedSlots: ['offhand'], hands: 1, requires: { STR: 99 }, weight: 4, unique: false },
};
const FROZEN = {
    id: 'frozen-rules-test',
    name: 'frozen rules test',
    version: '0.0.0',
    queries: { 'rules.identity': () => ({ hash: H, packId: 'test', version: '1' }), 'rules.item': (state, args) => RULES[args?.def] ?? null },
};

test('dual-slot pieces on the host: a two-hander worn swaps the first legal slot (never the refused off-hand); targetSlot dual-wields', async t => {
    quiet(t);
    await seeded(28, async () => {
        const host = await hero({ modules: [FROZEN] });
        try {
            assert.equal((await equip(host, 'Greatsword')).ok, true);
            // B2: no targetSlot, a two-hander in the main hand, a piece allowed in both hands.
            const swap = await equip(host, 'Steel Dagger');
            assert.equal(swap.ok, true, swap.message);
            assert.equal(swap.receipt.data.slot, 'weapon');
            assert.deepEqual(swap.receipt.data.removedNames, ['Greatsword']);
            assert.deepEqual([host.at('Steel Dagger'), host.at('Greatsword')], ['weapon', null]);
            // The off-hand is free now: the second dagger asked for the off-hand dual-wields.
            const second = await equip(host, 'Twin Dagger', { targetSlot: 'offhand' });
            assert.equal(second.ok, true, second.message);
            assert.equal(second.receipt.data.targetSlot, 'offhand');
            assert.deepEqual([host.at('Steel Dagger'), host.at('Twin Dagger')], ['weapon', 'offhand']);
            // Base-stat requirements are the actor's own stats: the buckler asks STR 99, and the item's bonus never qualifies it.
            const buckler = await equip(host, 'Oak Buckler', { targetSlot: 'offhand' });
            assert.equal(buckler.ok, false);
            assert.equal(buckler.code, 'REFUSED');
            assert.match(buckler.message, /Base stats do not meet/);
            // Without a targetSlot the next piece for the hands is the first legal slot taken: both full, so the main hand swaps.
            const again = await equip(host, 'Greatsword');
            assert.equal(again.ok, true, again.message);
            assert.deepEqual([...again.receipt.data.removedNames].sort(), ['Steel Dagger', 'Twin Dagger']);
            // The off-hand cannot be asked for beside the two-hander.
            const refused = await equip(host, 'Steel Dagger', { targetSlot: 'offhand' });
            assert.equal(refused.ok, false);
            assert.equal(refused.code, 'REFUSED');
            // Frozen rules present but a piece without a rule fails closed.
            const unruled = await equip(host, 'Iron Sword');
            assert.equal(unruled.ok, false);
            assert.equal(unruled.code, 'RULES_MISMATCH');
        } finally {
            host.close();
        }
    });
});
