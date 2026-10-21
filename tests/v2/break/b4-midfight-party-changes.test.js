// B4-4 / B4-6: what the party changes while a fight is under way, and what combat.end then writes.
// combat.end's party.applyResult writes the HP pools the fight began with (their max too), so
// points spent mid-fight leave a character whose stats and max HP disagree for good (B4-4); and a
// story `~ wound` line mid-fight is applied to the party, then silently put back by the next
// fight action (party.fightPools), so the receipt's "−78 HP" never happened (B4-6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, playOut, seeded, started } from './helpers.js';

test('B4-4: points spent mid-fight still count after combat.end (max HP follows the stats), or the spend is refused', async () => {
    await seeded(41, async () => {
        const host = await started();
        try {
            assert.equal((await host.internal('party.grantXp', { amount: 300 })).ok, true);
            const before = host.q('party.pc');
            assert.ok(before.points > 0);
            await offerAndStart(host, '! encounter 2 Wolf | tier: weak');
            const spent = await host.cmd('party.spend', { points: { VIT: before.points } });
            if (!spent.ok) return;   // refused while the fight runs: also a fix
            const raised = host.q('party.pc').hp.max;
            assert.ok(raised > before.hp.max, 'VIT raised max HP');
            await playOut(host);
            assert.equal((await host.cmd('combat.end')).ok, true);
            const after = host.q('party.pc');
            assert.equal(after.stats.VIT, before.stats.VIT + before.points);
            assert.equal(after.hp.max, raised, `VIT ${after.stats.VIT} but max HP went back from ${raised} to ${after.hp.max}`);
        } finally {
            host.close();
        }
    });
});

test('B4-6: a story wound accepted mid-fight is not undone by the next fight action (or it is refused)', async () => {
    await seeded(101, async () => {
        const host = await started();
        try {
            await offerAndStart(host, '! encounter 2 Wolf | tier: weak');
            const was = host.q('party.pc').hp.cur;
            await host.send('Look out!', host.reply('A rock falls on you.', ['~ wound Ren — a falling rock | harm: grievous']));
            const receipts = host.st.ctx.chat.at(-1).extra.storySuite.receipts.filter(r => r.type === 'capture.wound');
            if (!receipts.length) return;   // refused mid-fight: also a fix
            const hurt = host.q('party.pc').hp.cur;
            assert.ok(hurt < was);
            const fightHp = host.q('combat.session').combatants.find(c => c.side === 'party').hp.cur;
            assert.equal(fightHp, hurt, `the receipt says ${receipts[0].summary} but the fight still has Ren at ${fightHp}`);
            await host.cmd('combat.act', { action: { type: 'defend' } });
            assert.ok(host.q('party.pc').hp.cur <= hurt, `the wound was undone: ${hurt} → ${host.q('party.pc').hp.cur} after a defend`);
        } finally {
            host.close();
        }
    });
});
