// B4-7: a dead character (party.applyResult's `dead` mark after a lost fight to the death) can
// still be rested back to full HP: the Party screen and HUD show a corpse at 98/98.
// B4-8: with the level cap lowered below a character's level (a settings edit), the level shown
// is the cap ("Lv 3") while the record, the fights and the stats are level 20's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, playOut, rpgHost, seeded, started } from './helpers.js';
import { MODULE_ID } from '../../../src/v2/module.js';

test('B4-7: a dead character is not rested back to full HP', async () => {
    await seeded(3, async () => {
        const host = await started();
        try {
            await offerAndStart(host, '! encounter 1 Lich (boss) | tier: deadly | stakes: death');
            await playOut(host);
            assert.equal((await host.cmd('combat.end')).receipt.data.outcome, 'lost');
            assert.ok(host.q('party.pc').conditions.some(entry => entry.kind === 'dead'));
            const rest = await host.cmd('party.rest', { kind: 'long' });
            const pc = host.q('party.pc');
            assert.ok(!rest.ok || pc.hp.cur === 0, `a dead character rested to ${pc.hp.cur}/${pc.hp.max} HP`);
        } finally {
            host.close();
        }
    });
});

test('B4-8: the level shown is the character\'s level, also after the cap is lowered below it', async () => {
    await seeded(5, async () => {
        const host = await rpgHost({ settings: { modules: { [MODULE_ID]: { 'party.maxLevel': 20 } } } });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await host.internal('party.grantXp', { amount: 5000 });
            const level = host.q('party.pc').level;
            assert.ok(level > 3);
            host.settings.set(MODULE_ID, 'party.maxLevel', 3);
            const [card] = host.q('rpg-battle.cards');
            const shown = Number(card.line.match(/Lv (\d+)/)?.[1]);
            assert.ok(shown === card.level || card.level <= 3, `the card says "${card.line}" for a level-${card.level} character`);
        } finally {
            host.close();
        }
    });
});
