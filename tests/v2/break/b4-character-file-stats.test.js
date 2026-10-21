// B4-14: a character file's stats are checked only as a total (portable.js readCharacter: the
// points above startStat, summed), so stats below the start value pay for others: a level-1 file
// with AGI, INT, LUK and CHA at 0 brings STR 35, where creation allows 15 at most (startStat 5 +
// 10 start points). Every stat starts at startStat (MODULES §F12 / v1 newSheet).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from './helpers.js';
import { CHARACTER_FILE_VERSION } from '../../../src/v2/party/portable.js';

test('B4-14: a character file cannot lower stats below the start value to raise others', async () => {
    await seeded(5, async () => {
        const host = await rpgHost();
        try {
            const character = { rpgBattleCharacter: CHARACTER_FILE_VERSION, name: 'Ren', level: 1, xp: 0, points: 0, stats: { STR: 35, VIT: 5, AGI: 0, DEX: 5, INT: 0, LUK: 0, CHA: 0 }, skills: [] };
            const made = await host.cmd('creation.import', { character });
            const pc = host.q('party.pc');
            assert.ok(!made.ok || pc.stats.STR <= 15, `a level-1 character arrived with STR ${pc?.stats.STR} (${JSON.stringify(pc?.stats)})`);
        } finally {
            host.close();
        }
    });
});
