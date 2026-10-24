// B4r2-6 (F17 regressed): Return in time rewinds, then sends `return.cue` with { cause: 'system' }
// (src/v2/return/index.js returnInTime). Story Block's sdk.command now refuses any cause but 'ui'
// ("'system' is kept for Story Block itself", Story Block src/v2/sdk.js:253-255), so on the real
// host the chat is branched and rewound but the cue is never committed: returnInTime answers
// { ok: false, code: 'REFUSED', rewound: true }, the return card shows a failure after the chat
// already went back, and the next reply is not told the character is back, alive. The return part's
// own tests use a fake host that still takes 'system'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, playOut, seeded, started } from './helpers.js';
import { returnInTime } from '../../../src/v2/return/index.js';

test('B4r2-6: Return in time on the real host is told to the next reply', async () => {
    await seeded(111, async () => {
        const host = await started();
        try {
            await offerAndStart(host, '! encounter 1 Lich (boss) | tier: deadly | stakes: death');
            await playOut(host);
            assert.equal((await host.cmd('combat.end')).receipt.data.outcome, 'lost');
            const back = await returnInTime(host.sdk);
            assert.equal(back.ok, true, `${back.code}: ${back.message}`);
            await host.send('Again.', 'We stand at the moment before.');
            assert.match(host.tails().at(-1) ?? '', /back at the moment before the fight/);
        } finally {
            host.close();
        }
    });
});
