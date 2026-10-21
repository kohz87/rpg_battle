// B-b3-16: a companion's level is whatever the `+ join … | level:` label (model text) or the
// party.addCompanion payload says, up to the level cap: a level-1 party takes on a level-60
// companion from one line (F91: companion stats by code's formula, not the model).
import test from 'node:test';
import assert from 'node:assert/strict';
import { market, show } from './helpers/econ.js';

test('a join offer\'s level is held near the party\'s level', async () => {
    const host = await market();
    try {
        await host.send('Will you come?', host.reply('A veteran nods.', ['+ join Lyra — a veteran archer | level: 60 | role: ranger']));
        const offer = host.head().domains.party.offers.at(-1);
        assert.ok(offer, 'a join offer');
        const r = await host.cmd('party.acceptOffer', { offer: offer.id });
        assert.equal(r.ok, true, show(r));
        const lyra = host.q('party.actors').find(actor => actor.name === 'Lyra');
        const pc = host.q('party.pc');
        assert.ok(lyra.level <= pc.level + 2, `Lyra joins at level ${lyra.level} beside a level-${pc.level} PC`);
    } finally { host.close(); }
});

test('party.addCompanion from a click does not take a level the rules did not give', async () => {
    const host = await market();
    try {
        const r = await host.cmd('party.addCompanion', { name: 'Brann', level: 50 });
        const brann = host.q('party.actors').find(actor => actor.name === 'Brann');
        assert.ok(!r.ok || brann.level <= 3, `Brann joins at level ${brann?.level}`);
    } finally { host.close(); }
});
