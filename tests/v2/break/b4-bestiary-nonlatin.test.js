// B4-5: creatureSlug keeps only a–z0–9, so every creature named in another script (狼, 熊,
// Волк, Λύκος) is filed under the one bestiary key "creature": each new one evicts the last, and
// the same creature fought again is made up afresh with other numbers. Invariant: the chat's
// bestiary keeps a creature once made (the same name, the same creature).
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, playOut, seeded, started } from './helpers.js';

const foes = host => host.q('combat.session').combatants.filter(c => c.side === 'enemy');

test('B4-5: creatures named in non-Latin scripts each keep their own bestiary entry and numbers', async () => {
    await seeded(81, async () => {
        const host = await started();
        try {
            const fight = async name => {
                const { start } = await offerAndStart(host, `! encounter 1 ${name} | tier: even`);
                assert.equal(start.ok, true, start.message);
                const [foe] = foes(host);
                await playOut(host);
                assert.equal((await host.cmd('combat.end')).ok, true);
                await host.cmd('party.rest', { kind: 'long' });
                return { foe, made: start.receipt.data.made };
            };
            const wolf = await fight('狼');
            await fight('熊');
            await fight('Волк');
            const names = Object.values(host.head().domains.bestiary.creatures).map(entry => entry.name).sort();
            assert.deepEqual(names, ['Волк', '熊', '狼'].sort(), `the bestiary holds ${JSON.stringify(names)}`);
            const kept = structuredClone(host.head().domains.bestiary.creatures);
            const again = await fight('狼');
            // (RB-fix1: a foe's HP varies a little from fight to fight even for the bestiary's own Wolf,
            // so "the same creature" is checked as: not made up again, its entry unchanged.)
            assert.deepEqual(wolf.made, ['狼']);
            assert.deepEqual(again.made, [], 'the same creature was made up again');
            assert.deepEqual(host.head().domains.bestiary.creatures, kept, 'the bestiary entry changed');
            assert.equal(again.foe.level, wolf.foe.level);
        } finally {
            host.close();
        }
    });
});
