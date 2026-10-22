// B4-12: every combat.act (and every combat.session read: the board, the HUD) rebuilds the fight
// by replaying all its actions from the setup (v1 replay), and each v1 act structuredClones the
// whole fight with its growing log, so one action costs O(n²) in the actions so far. A party of
// four the reader commands, holding out against a tough foe, reaches a few hundred actions within
// the 60-round limit; with the 12 companions the settings allow, a click took ~1 s at 360 actions
// (sim/longfight-13.txt). Invariant 8: the per-action cost must not grow with the fight's length.
//
// Measured two ways. The work is counted (combat/view.js replayWork: the stored actions the fight's
// rebuilds play), which no load on the machine changes: each click with its board read plays the one
// new action, at the 20th action as at the 200th. As a backstop the time of RPG Battle's own work is
// checked too: the combat.act handler and the board read, timed by themselves (never the host's save,
// which the testkit's fake SillyTavern makes grow with the chat), each window by its fastest action,
// which pauses from elsewhere only lengthen. Timed so, it showed the one cost that still grew: v1 act
// deep-copied the fight's whole log on every action (combat.js act now shares the entries, which are
// never changed once written: 1.0 → 2.0 ms over 180 actions before, flat after). (Earlier versions took a plain Story Block command's time
// off the whole command's: late in the fight both are ~10 ms and their difference is load noise, so the
// test failed under parallel test files and passed alone.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, rpgHost, seeded } from './helpers.js';
import { replayWork } from '../../../src/v2/combat/view.js';

test('B4-12: the 200th action of a fight costs about what the 20th did', { timeout: 600000 }, async () => {
    await seeded(91, async () => {
        const host = await rpgHost();
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await host.send('We camp.', host.reply('Camp.', ['~ place Camp']));
            for (const name of ['Ana', 'Bo', 'Cy']) assert.equal((await host.internal('party.addCompanion', { name, role: 'knight', control: 'player' })).ok, true);
            const { start } = await offerAndStart(host, '! encounter 1 Stone Golem | tier: weak');
            assert.equal(start.ok, true, start.message);
            // RPG Battle's own handler, timed inside the command (Story Block calls it from the module's
            // definition at dispatch, so the wrapped one is the one run).
            const handlers = host.module.commands;
            const original = handlers['combat.act'];
            let handled = 0;
            handlers['combat.act'] = Object.assign((ctx, payload) => {
                const t = performance.now();
                try { return original(ctx, payload); } finally { handled = performance.now() - t; }
            }, original);
            const acts = [];
            const work = [];
            for (let n = 0; n < 200; n += 1) {
                const before = replayWork.played;
                let t = performance.now();
                const view = host.q('combat.session');
                const read = performance.now() - t;
                if (!view || view.status !== 'active') break;
                handled = -1;
                const r = await host.cmd('combat.act', { action: { type: 'defend' } });
                assert.equal(r.ok, true, r.message);
                assert.ok(handled >= 0, 'the timed handler ran');
                acts.push(read + handled);
                work.push(replayWork.played - before);
            }
            assert.ok(acts.length >= 150, `the fight ended after ${acts.length} actions; pick a tougher foe`);
            // The work: a board read and a click play at most the one new action each, however long the fight.
            assert.ok(work.every(played => played <= 2), `actions replayed per click: ${[...new Set(work)].join(', ')} (the 200th must cost what the 20th did)`);
            assert.deepEqual([...new Set(work.slice(10, 30))], [...new Set(work.slice(-20))], 'the same work early and late');
            // The backstop: RPG Battle's own time (the board read and the handler), each window's fastest.
            const fastest = (list, from, to) => Math.min(...list.slice(from, to));
            const early = fastest(acts, 10, 30);
            const late = fastest(acts, -20);
            assert.ok(late < early * 4 + 1, `action ${acts.length}: ${late.toFixed(2)} ms against ${early.toFixed(2)} ms at action 20 (×${(late / Math.max(early, 0.01)).toFixed(1)})`);
        } finally {
            host.close();
        }
    });
});
