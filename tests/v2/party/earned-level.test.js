// Confirm C-2: a level is earned. XP is kept as `earned` with a step per level-up (pools.js), so after a
// delete takes back the XP a later level-up needed, the level, its points and its HP are undone where
// the member is read. Points the member already spent on it are owed (unspent points below 0, the stats
// kept), and the next level's points pay them first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';

test('C-2: points spent on a level a delete takes back are owed, the stats kept; the next level pays them', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await rpgHost();
    t.after(() => host.close());
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    await host.send('In.', host.reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement']));
    const pc = () => host.q('party.pc');
    const str = pc().stats.STR;
    await host.send('a', host.reply('A.', ['+ xp milestone — cleared the cellar', '+ xp minor — a', '+ xp minor — b']));
    const a = host.ctx.chat.length - 1;
    await host.send('b', host.reply('B.', ['+ xp milestone — held the gate']));
    assert.equal(pc().level, 2);
    const points = pc().points;
    assert.ok(points > 0, 'the level-up gave points');
    assert.equal((await host.cmd('party.spend', { actor: pc().id, points: { STR: points } })).ok, true);
    await host.send('c', host.reply('C.', ['+ xp major — found the bell']));
    await host.st.deleteMessage(a);
    assert.equal(pc().level, 1, 'the level B reached is not earned without A');
    assert.equal(pc().points, -points, 'its points, already spent, are owed');
    assert.equal(pc().stats.STR, str + points, 'the stats they bought stay');
    assert.equal((await host.cmd('party.spend', { actor: pc().id, points: { STR: 1 } })).ok, false, 'nothing to spend while points are owed');
    host.store.rebuild();
    assert.equal(pc().level, 1, 'a rebuild reads the same');
    // Enough XP for level 2 again: its points pay the debt first.
    await host.send('d', host.reply('D.', ['+ xp milestone — the bridge', '+ xp milestone — the tower']));
    assert.equal(pc().level, 2);
    assert.equal(pc().points, 0, 'the new level\'s points paid what was owed');
});
