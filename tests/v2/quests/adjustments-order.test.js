// The Adjustments log is ordered by the reply a record was made on as the chat stands now (after deletes, swipes, Re-reads, a rebuild), the last record of a reply first; the reply is found by
// the record's own reply (its `sid`), so it does not depend on which receipt carries the record's id. A record whose reply is no longer in the receipts is shown last, with no number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../integration/helpers/host.js';
import { bluewatch } from './helpers/bluewatch.js';
import { adjustments } from '../../../src/v2/quests/offer-log.js';

const job = n => `+ quest Debt ${n} | giver: Marrit | goal: Settle matter ${n} with the river guild | reward: 900 copper | due: in 3 days`;
const far = n => `+ quest Far ${n} | giver: Marrit | goal: Settle matter ${n} with the river guild | reward: 90000 gold | due: in 3 days`;
const teacher = '+ trainer Old Reka | like: open-blade-drills | fee: 600 silver';
const at = (h, text) => h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
const names = h => h.q('quest.adjustments', {}).rows.map(row => [row.name, row.reply]);
const play = async h => {
    await h.say('Reply A.', [far(1), job(1)]);
    await h.say('Reply B.', ['! rest long']);
    await h.say('Reply C.', ['+ present Old Reka', teacher, job(2), far(2)]);
    await h.say('Reply D.', [job(3)]);
};
const NAMES = ['Debt 3', 'Far 2', 'Debt 2', 'Old Reka', 'Long rest at Bluewatch Village', 'Debt 1', 'Far 1'];

test('newest reply first, the last record of a reply first, across jobs, teachers, refusals and rests', async t => {
    await seeded(9601, async () => {
        const h = await bluewatch(t);
        await play(h);
        const rows = names(h);
        assert.deepEqual(rows.map(([name]) => name), NAMES);
        assert.deepEqual(rows.map(([, reply]) => reply), [at(h, 'Reply D.'), at(h, 'Reply C.'), at(h, 'Reply C.'), at(h, 'Reply C.'), at(h, 'Reply B.'), at(h, 'Reply A.'), at(h, 'Reply A.')]);
    });
});

test('after a delete, a swipe, a Re-read, a rebuild and a reload the log has the replies where the chat has them now', async t => {
    await seeded(9602, async () => {
        const h = await bluewatch(t);
        await play(h);
        await h.turn.reread(at(h, 'Reply A.'));
        assert.deepEqual(names(h).map(([name]) => name), NAMES);
        await h.st.deleteMessage(at(h, 'Reply B.'));
        await h.st.deleteMessage(at(h, 'Reply B.') - 1);
        const rows = names(h);
        assert.deepEqual(rows.map(([name]) => name), NAMES.filter(name => !/rest/.test(name)));
        assert.deepEqual(rows.map(([, reply]) => reply), [at(h, 'Reply D.'), at(h, 'Reply C.'), at(h, 'Reply C.'), at(h, 'Reply C.'), at(h, 'Reply A.'), at(h, 'Reply A.')]);
        await h.swipe(`Reply D2.\n\n<Changes>\n${job(5)}\n</Changes>`);
        assert.deepEqual(names(h)[0], ['Debt 5', at(h, 'Reply D2.')]);
        const before = JSON.stringify(names(h));
        h.store.rebuild();
        assert.equal(JSON.stringify(names(h)), before);
        await h.st.loadChat(JSON.parse(JSON.stringify(h.ctx.chat)));
        assert.equal(JSON.stringify(names(h)), before);
    });
});

test('the reply is found by the record\'s own reply, whichever receipt carries its id; a record whose reply is gone comes last with no number', async t => {
    await seeded(9603, async () => {
        const h = await bluewatch(t);
        await play(h);
        const state = h.head();
        const real = h.sdk.receipts();
        // Receipts that name no job, teacher or refusal by its id (a rest names its record in `record`): only the reply (the sid) each one was stored on.
        const bare = real.map(({ index, receipt }) => ({ index, receipt: { ...receipt, data: { v2: receipt.data?.v2, ...(receipt.data?.record ? { record: receipt.data.record } : {}) } } }));
        const found = adjustments(state, {}, { receipts: () => bare });
        assert.deepEqual(found.rows.map(row => [row.name, row.reply]), names(h));
        // Without the receipts of Reply C (trimmed), its records are shown after the others with no number, in their own order.
        const trimmed = bare.filter(entry => entry.index !== at(h, 'Reply C.'));
        const rows = adjustments(state, {}, { receipts: () => trimmed }).rows;
        assert.deepEqual(rows.map(row => row.name), ['Debt 3', 'Long rest at Bluewatch Village', 'Debt 1', 'Far 1', 'Far 2', 'Debt 2', 'Old Reka']);
        assert.deepEqual(rows.slice(4).map(row => [row.reply, row.replyText]), [[null, ''], [null, ''], [null, '']]);
        assert.deepEqual(adjustments(state, {}, { receipts: () => [] }).rows.every(row => row.reply === null), true);
    });
});
