// A teacher's fee is written in the chat's coins wherever it is told, including the reason a lesson cannot be asked for yet ("It costs 5 silver.", not "It costs 50.").
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../integration/helpers/host.js';
import { money } from '../../../src/v2/quests/parse.js';
import { bluewatch } from '../quests/helpers/bluewatch.js';

test('the purse reason of a lesson is in the chat\'s coins, for a teacher of the pack and one the story made', async t => {
    await seeded(9701, async () => {
        const h = await bluewatch(t);
        await h.say('Holm offers drills.', ['+ trainer Sergeant Holm — spear and shield drills | fee: 6 silver 4 copper']);
        const currency = h.q('inventory.currency');
        const rows = h.q('rules.training', { actor: h.q('party.pc').id }).offers;
        const costly = rows.filter(row => row.blocked.some(reason => reason.startsWith('It costs')));
        assert.ok(costly.length >= 2, 'a teacher of the pack and the story\'s');
        for (const row of costly) {
            assert.deepEqual(row.blocked.filter(reason => reason.startsWith('It costs')), [`It costs ${money(row.fee, currency)}.`], row.name);
            assert.match(row.blocked.find(reason => reason.startsWith('It costs')), /silver|gold|copper/);
        }
        const holm = costly.find(row => row.name === 'Sergeant Holm');
        assert.equal(holm.blocked.find(reason => reason.startsWith('It costs')), 'It costs 6 silver 4 copper.');
        assert.doesNotMatch(JSON.stringify(rows.map(row => row.blocked)), /It costs \d+\./);
    });
});
