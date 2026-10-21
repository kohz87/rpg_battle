// Break round F103, b2-timeline: RPG Battle's one-blow-per-reply claim is keyed by the reply's chat
// index (`wound:<actor>:<index>:<swipe>`, party/util.js replyOf + party/capture.js). Indexes shift when
// a middle message is deleted, so a later reply that lands on the index an earlier reply had is refused
// as "already hurt or healed in this reply". Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';

test('B-b2-timeline-10: after a middle delete, a new reply\'s wound is not refused by an older reply\'s claim', async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await rpgHost();
    t.after(() => h.close());
    assert.equal((await h.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await h.send('one', 'Nothing yet.');
    await h.send('two', h.reply('Ren falls.', ['~ wound Ren — a fall | harm: scratch']));
    const pc = h.head().domains.party.pc;
    const afterFall = h.head().domains.party.actors[pc].hp.cur;
    await h.st.deleteMessage(1);
    await h.st.deleteMessage(1);                    // the first exchange is deleted; the fall reply moves to index 2
    await h.send('three', h.reply('Ren is hit.', ['~ wound Ren — a blow | harm: wound']));   // lands on index 4
    const refused = h.turn.problems().filter(p => /already hurt or healed/.test(p.message));
    assert.deepEqual(refused.map(p => p.message), [], 'the new reply\'s blow is accepted');
    assert.ok(h.head().domains.party.actors[pc].hp.cur < afterFall, 'and Ren loses HP');
});
