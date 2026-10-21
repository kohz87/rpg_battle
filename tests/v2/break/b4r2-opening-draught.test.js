// B4r2-1: combat.start plays the foes' and the auto companions' turns before the first choice
// (the opening), but only syncs the pools (index.js start → syncPools); it never takes out what
// the opening used (consumeSpent runs only in combat.act). A hurt companion on auto who drinks a
// draught in the opening is healed, and the draught stays in the bag for good: later actions
// compare the fight's items before and after each action, and the opening's dose is in neither.
// Invariant 3 (no HP from nothing) and the conservation rule of B-b4-1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, playOut, seeded, started } from './helpers.js';

const DRAUGHT = 'Minor Healing Draught';

test('B4r2-1: a draught drunk in the opening turns of a fight leaves the bag', async () => {
    await seeded(1, async () => {
        const host = await started();
        try {
            assert.equal((await host.internal('party.addCompanion', { name: 'Lyra', role: 'ranger' })).ok, true);
            const lyra = host.q('party.actors').find(actor => actor.name === 'Lyra');
            await host.send('Vials.', host.reply('Three vials for Lyra.', [`+ item ${DRAUGHT} | qty: 3 | owner: Lyra | note: heal 20`]));
            const stack = host.q('inventory.items', {}).find(item => item.name === DRAUGHT);
            if (stack.owner !== lyra.id) assert.equal((await host.internal('inventory.transfer', { stack: stack.stack, to: lyra.id })).ok, true);
            assert.equal((await host.internal('party.fightPools', { actors: [{ id: lyra.id, hp: 3 }] })).ok, true);
            const held = () => host.q('inventory.items', { owner: lyra.id }).find(item => item.name === DRAUGHT)?.qty ?? 0;
            assert.equal(held(), 3);
            const { start } = await offerAndStart(host, '! encounter 3 Wolf | tier: even');
            assert.equal(start.ok, true, start.message);
            const opening = host.q('combat.session').log.filter(entry => entry.text.includes(`Lyra uses ${DRAUGHT}`)).length;
            assert.ok(opening > 0, 'seed 1: Lyra drinks in the opening turns');
            assert.equal(held(), 3 - opening, `Lyra drank ${opening} in the opening, the bag still holds ${held()}`);
            let drunk = opening;
            for (let n = 0; n < 300; n += 1) {
                const view = host.q('combat.session');
                if (!view || view.status !== 'active') break;
                const r = await host.cmd('combat.act', { action: { type: 'auto' }, session: view.id, logLength: view.logLength });
                assert.equal(r.ok, true, r.message);
                drunk += r.receipt.data.log.filter(text => text.includes(`Lyra uses ${DRAUGHT}`)).length;
            }
            await host.cmd('combat.end');
            assert.equal(held(), 3 - drunk, `${drunk} drunk in the fight, ${held()} of 3 left in the bag`);
        } finally {
            host.close();
        }
    });
});
