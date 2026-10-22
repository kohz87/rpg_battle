// rx-combat: a story's "stunned" (a wound line's condition, stacks 1) goes into the next fight as a
// 3-round stun (setup.js roundsOf: stacks ≤ 1 → 3), so your character loses its first three turns
// in a row. The stun rule says nobody loses two turns in a row to a stun, and every stun in the
// game is 1 round (skills, monsters, rules.generated.effectRounds.stun = 1). FIXED (wave C): a carried
// condition lasts no longer than the same one from a blow (setup.js roundsOf, effectRounds).
import test from 'node:test';
import assert from 'node:assert/strict';
import { started, offerAndStart, seeded } from './helpers.js';
import { partyCombatants } from '../../../src/v2/combat/setup.js';

const lostTurns = log => {
    let run = 0;
    let most = 0;
    for (const entry of log) {
        const text = String(entry?.text ?? entry ?? '');
        if (/is stunned and loses the turn/.test(text)) { run += 1; most = Math.max(most, run); }
        else if (/^Ren\b/.test(text) && !/stunned|dazed/.test(text)) run = 0;
    }
    return most;
};

test('rx-combat: a story stun carried into a fight costs at most one turn', async () => {
    await seeded(7, async () => {
        const host = await started();
        try {
            await host.send('I get hit.', host.reply('A rock hits Ren.', ['~ wound Ren — stunned: a rock to the head']));
            assert.deepEqual(host.q('party.actors')[0].conditions.map(c => c.kind), ['stunned']);
            const { start } = await offerAndStart(host, '! encounter 1 Wolf | tier: weak');
            assert.ok(start.ok, start.message);
            const session = host.q('combat.session');
            const ren = session.combatants.find(c => c.side === 'party');
            const stun = (ren.conditions ?? []).find(c => /stun/.test(c.name ?? c.kind ?? ''));
            const log = session.log ?? [];
            const count = log.filter(entry => /Ren is stunned and loses the turn/.test(String(entry?.text ?? entry))).length;
            assert.ok(count <= 1 && (!stun || (stun.rounds ?? 0) <= 1),
                `Ren lost ${count} turns in a row to the story's stun (stun left: ${JSON.stringify(stun ?? null)})`);
        } finally {
            host.close();
        }
    });
});

test('rx-combat: every carried condition lasts no longer than effectRounds (a fight-left poison of 9 is 3)', () => {
    const actor = { id: 'ac_00000001', kind: 'pc', name: 'Ren', level: 1, stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [],
        conditions: [{ kind: 'poisoned', stacks: 9 }, { kind: 'stunned', stacks: 4 }, { kind: 'bleeding', stacks: 1 }, { kind: 'exhausted', stacks: 1 }] };
    const ctx = { query: name => (name === 'party.actors' ? [actor] : undefined), read: () => null };
    const [ren] = partyCombatants(ctx);
    assert.deepEqual(ren.conditions.map(c => [c.name, c.rounds]), [['poison', 3], ['stun', 1], ['bleed', 2]]);
});
