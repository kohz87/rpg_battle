// beta.1 live test, the reader's note "use item is missing": a draught in the bag could only be used by
// the story (`! use X | on: Y`, MODULES §F96); no screen offered Use. Fixed: `items.useOn` names, per
// consumable the party holds, the members a dose would help now (not at full HP with nothing to cure),
// and nobody while a fight has the party (its Item action does it); Story Block's Inventory draws "Use
// on…" from it, each choice `item.use { stack, target }` (bag management, rule 6). From a click in a fight item.use refuses and points to the Fight screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded, playOut } from '../integration/helpers/host.js';
import { useOn } from '../../../src/v2/items/queries.js';

async function hurtWithDraught(host) {
    assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await host.send('Go.', host.reply('Ren slips on the rocks.', ['~ place Bluewatch Road | kind: road', '+ item Minor Healing Draught | qty: 2 | note: heal 20', '~ wound Ren — slipped on the rocks | harm: wound']));
    const draught = host.q('inventory.items', {}).find(item => item.name === 'Minor Healing Draught');
    assert.ok(draught, 'setup: a draught in the bag');
    const pc = host.q('party.pc');
    assert.ok(pc.hp.cur < pc.hp.max, 'setup: hurt');
    return { stack: draught.stack, pc };
}

test('items.useOn: the hurt member for the draught; a click on Use heals and takes one dose; at full HP nobody', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(31, async () => {
        const host = await rpgHost();
        try {
            const { stack, pc } = await hurtWithDraught(host);
            assert.deepEqual(host.q('items.useOn', {}), { [stack]: [{ id: pc.id, name: 'Ren' }] });
            assert.deepEqual(host.q('inventory.equipment').users, { [stack]: [{ id: pc.id, name: 'Ren' }] }, 'Story Block\'s Inventory picker reads it');
            const used = await host.cmd('item.use', { stack, target: pc.id });
            assert.equal(used.ok, true, used.message);
            assert.ok(host.q('party.pc').hp.cur > pc.hp.cur, 'healed');
            assert.equal(host.q('inventory.items', {}).find(item => item.stack === stack)?.qty, 1, 'one dose used');
            // Heal to full: then nobody would be helped and the picker is gone.
            for (let n = 0; n < 3 && host.q('party.pc').hp.cur < host.q('party.pc').hp.max; n += 1) await host.cmd('item.use', { stack, target: pc.id });
            if (host.q('party.pc').hp.cur >= host.q('party.pc').hp.max) assert.deepEqual(host.q('items.useOn', {}), {});
        } finally {
            host.close();
        }
    });
});

test('while a fight has the party: no Use on…, a click is refused (the Fight screen\'s Item does it), and the board has Item', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(32, async () => {
        const host = await rpgHost();
        try {
            const { stack, pc } = await hurtWithDraught(host);
            await host.send('On.', host.reply('A wolf.', ['! encounter 1 Wolf — on the road | tier: trivial']));
            assert.equal((await host.cmd('combat.start', { offer: host.q('combat.offers')[0].id })).ok, true);
            assert.deepEqual(host.q('items.useOn', {}), {});
            const refused = await host.cmd('item.use', { stack, target: pc.id });
            assert.equal(refused.ok, false);
            assert.match(refused.message, /Fight screen/);
            assert.ok((host.q('combat.board').actions.items ?? []).some(item => item.name === 'Minor Healing Draught'), 'the fight\'s Item action has it');
            await playOut(host);
            assert.deepEqual(host.q('items.useOn', {}), {}, 'over and not yet settled: still the fight\'s');
            assert.equal((await host.cmd('combat.end', {})).ok, true);
            if (host.q('party.pc').hp.cur < host.q('party.pc').hp.max) assert.ok(host.q('items.useOn', {})[stack], 'settled: Use is back');
        } finally {
            host.close();
        }
    });
});

test('useOn: the shared bag\'s and the members\' consumables, in party order; not a stranger\'s; {} for no party', () => {
    const REN = 'ac_ren00001';
    const MIRA = 'ac_mira0001';
    const def = { id: 'story/draught', name: 'Minor Healing Draught', kind: 'consumable', effect: { heal: 20 } };
    const state = {
        domains: {
            party: { pc: REN, order: [REN, MIRA], actors: {
                [REN]: { id: REN, name: 'Ren', level: 1, xp: 0, points: 0, hp: { cur: 10, max: 50 }, mp: { cur: 0, max: 0 }, conditions: [] },
                [MIRA]: { id: MIRA, name: 'Mira', level: 1, xp: 0, points: 0, hp: { cur: 5, max: 40 }, mp: { cur: 0, max: 0 }, conditions: [] },
            } },
            inventory: { defs: { [def.id]: def }, stacks: {
                it_bag00001: { id: 'it_bag00001', def: def.id, qty: 1, owner: 'party', equipped: null },
                it_mira0001: { id: 'it_mira0001', def: def.id, qty: 1, owner: MIRA, equipped: null },
                it_away0001: { id: 'it_away0001', def: def.id, qty: 1, owner: 'ac_other001', equipped: null },
            } },
        },
    };
    assert.deepEqual(useOn(state), {
        it_bag00001: [{ id: REN, name: 'Ren' }, { id: MIRA, name: 'Mira' }],
        it_mira0001: [{ id: MIRA, name: 'Mira' }],
    });
    assert.deepEqual(useOn({ domains: {} }), {});
});
