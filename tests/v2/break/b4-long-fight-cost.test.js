// B4-12: every combat.act (and every combat.session read: the board, the HUD) rebuilds the fight
// by replaying all its actions from the setup (v1 replay), and each v1 act structuredClones the
// whole fight with its growing log, so one action costs O(n²) in the actions so far. A party of
// four the reader commands, holding out against a tough foe, reaches a few hundred actions within
// the 60-round limit; with the 12 companions the settings allow, a click took ~1 s at 360 actions
// (sim/longfight-13.txt). Invariant 8: the per-action cost must not grow with the fight's length.
//
// Measured two ways. The work is counted (combat/view.js replayWork: the stored actions the fight's
// rebuilds play), which no load on the machine changes: each click with its board read plays the one
// new action, at the 20th action as at the 200th. The time is checked too, by each window's fastest
// action (the cost without the pauses other test files running beside it cause: an earlier version
// compared medians of a difference of two separately timed commands, and failed under load).
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
            // (RB-fix1: since Story Block da54eaf the host's own save of each command grows with the
            // chat too (the testkit's fake SillyTavern copies the whole chat), so RPG Battle's share is
            // measured: each action's time less a plain Story Block command's (scene.present) beside it.)
            const acts = [];
            const plains = [];
            const work = [];
            for (let n = 0; n < 200; n += 1) {
                const before = replayWork.played;
                const view = host.q('combat.session');
                if (!view || view.status !== 'active') break;
                let t = performance.now();
                const r = await host.cmd('combat.act', { action: { type: 'defend' } });
                acts.push(performance.now() - t);
                assert.equal(r.ok, true, r.message);
                work.push(replayWork.played - before);
                t = performance.now();
                assert.equal((await host.cmd('scene.present', n % 2 ? { remove: ['Watcher'] } : { add: ['Watcher'] })).ok, true);
                plains.push(performance.now() - t);
            }
            assert.ok(acts.length >= 150, `the fight ended after ${acts.length} actions; pick a tougher foe`);
            // The work: a board read and a click play at most the one new action each, however long the fight.
            assert.ok(work.every(played => played <= 2), `actions replayed per click: ${[...new Set(work)].join(', ')} (the 200th must cost what the 20th did)`);
            assert.deepEqual([...new Set(work.slice(10, 30))], [...new Set(work.slice(-20))], 'the same work early and late');
            // The time, RPG Battle's share (a plain Story Block command's beside it taken off): each
            // window's fastest, which pauses from elsewhere only lengthen.
            const fastest = (list, from, to) => Math.min(...list.slice(from, to));
            const early = Math.max(0, fastest(acts, 10, 30) - fastest(plains, 10, 30));
            const late = Math.max(0, fastest(acts, -20) - fastest(plains, -20));
            assert.ok(late < early * 4 + 1, `action ${acts.length}: ${late.toFixed(2)} ms against ${early.toFixed(2)} ms at action 20 (×${(late / Math.max(early, 0.01)).toFixed(1)})`);
        } finally {
            host.close();
        }
    });
});
