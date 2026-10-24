// Confirm soak (C-2): deleting an earlier reply keeps a later reply's level-up that the XP left no longer
// reaches. Level, XP and points are counts (pools.js PARTY_COUNTERS): reply B's level-up is stored as
// "level +1, xp −100 (+50 award), points +4" and replayed on top of whatever is there. With reply A's XP
// gone, B still adds the level; XP goes to −25 (read as 0), so C's 25 XP is lost and the character keeps
// a level, 4 points and 4 max HP that no reply in the chat earns.
// Drops into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';

async function started() {
    const host = await rpgHost();
    const made = await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' });
    assert.ok(made.ok, made.message);
    await host.send('We look around.', host.reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement']));
    return host;
}
const pc = host => { const p = host.q('party.pc'); return { level: p.level, xp: p.xp, points: p.points, maxHp: p.hp?.max }; };

test('C-2: deleting an earlier XP reply leaves what the later replies alone give', async () => {
    // What B and C give on their own (the state before A, with B and C on top).
    const alone = await started();
    await alone.send('b', alone.reply('B.', ['+ xp milestone — held the gate']));
    await alone.send('c', alone.reply('C.', ['+ xp major — found the bell']));
    const expected = pc(alone);
    alone.close();

    const host = await started();
    try {
        await host.send('a', host.reply('A.', ['+ xp milestone — cleared the cellar', '+ xp minor — a', '+ xp minor — b']));
        const a = host.ctx.chat.length - 1;
        await host.send('b', host.reply('B.', ['+ xp milestone — held the gate']));
        assert.equal(pc(host).level, 2, 'A and B level Wessel up');
        await host.send('c', host.reply('C.', ['+ xp major — found the bell']));
        await host.st.deleteMessage(a);
        assert.deepEqual(pc(host), expected, `after deleting A: ${JSON.stringify(pc(host))}; B and C alone: ${JSON.stringify(expected)}`);
    } finally { host.close(); }
});

test('C-2: no stored XP below zero after a middle delete', async () => {
    const host = await started();
    try {
        await host.send('a', host.reply('A.', ['+ xp milestone — cleared the cellar', '+ xp minor — a', '+ xp minor — b']));
        const a = host.ctx.chat.length - 1;
        await host.send('b', host.reply('B.', ['+ xp milestone — held the gate']));
        await host.send('c', host.reply('C.', ['+ xp major — found the bell']));
        await host.st.deleteMessage(a);
        const raw = Object.values(host.head().domains.party.actors)[0];
        assert.ok(raw.xp >= 0, `stored xp is ${raw.xp} at level ${raw.level}`);
    } finally { host.close(); }
});
