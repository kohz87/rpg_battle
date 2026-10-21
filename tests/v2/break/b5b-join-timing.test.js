// B-b5b-robust-13: a `+ join` line's list labels (skills, focus) are split with /\s*[,;/]\s*/
// (src/v2/party/capture.js:81 `list`), which is quadratic on a long run of spaces; the label value is not
// clipped first (the line's text is, to 160). Story Block's own parse of the same line is fast (about 25 ms).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';

test('B-b5b-robust-13: a join offer with a long run of spaces in its skills label is read in linear time', async () => {
    const host = await rpgHost();
    try {
        const made = await host.cmd('party.create', { name: 'Ren', preset: 'fighter' });
        assert.equal(made.ok, true, made.message);
        // (RB-fix1: one plain reply first, so the first-call warm-up is not counted, and a bound of
        // 1 s: the suite runs files in parallel, and the quadratic split took 4.1 s.)
        await host.send('Hello.', host.reply('Brecht nods.', ['+ join Mira — a scout | level: 1 | skills: Slash']));
        const start = Date.now();
        await host.send('Hi.', host.reply('Brecht asks to come along.', [`+ join Brecht — a guard | level: 2 | skills: Slash${' '.repeat(40_000)}x`]));
        const took = Date.now() - start;
        assert.ok(took < 1000, `the reply took ${took} ms to capture`);
        assert.ok(host.head().domains.party.offers.some(offer => offer.name === 'Brecht'), 'the offer was read');
    } finally {
        host.close?.();
    }
});
