// B4-12: every combat.act (and every combat.session read: the board, the HUD) rebuilds the fight
// by replaying all its actions from the setup (v1 replay), and each v1 act structuredClones the
// whole fight with its growing log, so one action costs O(n²) in the actions so far. A party of
// four the reader commands, holding out against a tough foe, reaches a few hundred actions within
// the 60-round limit; with the 12 companions the settings allow, a click took ~1 s at 360 actions
// (sim/longfight-13.txt). Invariant 8: the per-action cost must not grow with the fight's length.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, rpgHost, seeded } from './helpers.js';

test('B4-12: the 200th action of a fight costs about what the 20th did', { timeout: 600000 }, async () => {
    await seeded(91, async () => {
        const host = await rpgHost();
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await host.send('We camp.', host.reply('Camp.', ['~ place Camp']));
            for (const name of ['Ana', 'Bo', 'Cy']) assert.equal((await host.internal('party.addCompanion', { name, role: 'knight', control: 'player' })).ok, true);
            const { start } = await offerAndStart(host, '! encounter 1 Stone Golem | tier: weak');
            assert.equal(start.ok, true, start.message);
            // (RB-fix1: since Story Block da54eaf the host's own save of each command grows with the
            // chat too (the testkit's fake SillyTavern copies the whole chat), so RPG Battle's share is
            // measured: each action's time less a plain Story Block command's (scene.present) beside it.)
            const times = [];
            for (let n = 0; n < 200; n += 1) {
                const view = host.q('combat.session');
                if (!view || view.status !== 'active') break;
                let t = performance.now();
                const r = await host.cmd('combat.act', { action: { type: 'defend' } });
                const acted = performance.now() - t;
                assert.equal(r.ok, true, r.message);
                t = performance.now();
                assert.equal((await host.cmd('scene.present', n % 2 ? { remove: ['Watcher'] } : { add: ['Watcher'] })).ok, true);
                const plain = performance.now() - t;
                times.push(Math.max(0, acted - plain));
            }
            assert.ok(times.length >= 150, `the fight ended after ${times.length} actions; pick a tougher foe`);
            // Medians of 20 actions: the suite runs files in parallel, and one slow action under load must not decide it.
            const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
            const early = median(times.slice(10, 30));
            const late = median(times.slice(-20));
            assert.ok(late < early * 4 + 1, `action ${times.length}: ${late.toFixed(1)} ms against ${early.toFixed(1)} ms at action 20 (×${(late / early).toFixed(1)})`);
        } finally {
            host.close();
        }
    });
});
