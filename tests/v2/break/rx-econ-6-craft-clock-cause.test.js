// rx-economy RX-E-6 (RB #89 4fa7c89 with Story Director v2 b870546): every craft that takes time is
// refused in the whole suite. craft/calls.js advanceClock calls `director.advance { minutes, cause }`
// with `cause` = "Wessel crafts Leech-salt Pouch" (a sentence); Story Director's director.advance
// (#93) takes `cause` as a short label (letters, digits, . _ -, at most 40) and the text as `reason`,
// so it throws INVALID, the craft's whole receipt is dropped and the reply's card says the line "was
// not used". The craft tests pass because they use a fake director that ignores `cause`.
// Needs the four checkouts side by side (helpers/suite.js); skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';

let suite = null;
try { suite = await import('./helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;

test('with Story Director\'s clock, an Ersveil Leech-salt Pouch is crafted', { skip }, async () => {
    const h = await suite.started({ seed: 1 });
    try {
        await h.send('Supplies.', h.reply('A crate.', ['+ item Coarse Salt | qty: 6', '+ item Burlap Sack | qty: 3']));
        await h.send('I make pouches.', h.reply('You twist salt into sacking.', ['! craft Leech-salt Pouch | with: Coarse Salt x2, Burlap Sack | roll: 1']));
        const types = h.ctx.chat.at(-1).extra.storySuite.receipts.map(r => r.type);
        const problems = (h.turn.problems?.() ?? []).map(p => p.message);
        assert.ok(types.includes('capture.craft'), `no craft receipt; the card says: ${problems.join(' | ')}`);
    } finally { h.close(); }
});
