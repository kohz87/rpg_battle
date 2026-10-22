// rx-combat (RB #92 effects): one reply of model text stacks three differently named story effects
// that each name every fight number, and the party.combatNumbers cap (COMBAT_CAP: attack/defence/
// magic/mdef +6, crit +9) is reached at once: a level-1 fighter goes from defence 8 to 14 (+75 %),
// attack 18 to 24, crit 11.5 to 20.5, for a day, renewable every reply at no cost. Measured: a lone
// deadly Wolf is won 10/30 plain, 20/30 buffed (seeds 500–529). The same +6 is ~3 % at level 60, so
// a tier no longer means the same at every level band. A story line is meant to be "at most moderate".
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';

test('rx-combat: the story alone moves a fight number by at most one moderate band', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(4, async () => {
        const h = await rpgHost();
        try {
            assert.equal((await h.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await h.send('We walk in.', h.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement']));
            const plain = h.q('party.combatNumbers', { id: h.q('party.pc').id });
            await h.send('We pray.', h.reply('The shrine glows.', [
                '+ effect Iron Skin — moderate toughness | on: attack, defence, magic, magic defence, crit | for: a day',
                '+ effect War Blessing — solid strength | on: attack, defence, mdef, crit, magic | for: a day',
                '+ effect Hero Aura — notable might | on: attack and defence and crit and mdef | for: a day',
            ]));
            const buffed = h.q('party.combatNumbers', { id: h.q('party.pc').id });
            const moved = Object.fromEntries(['attack', 'defence', 'mdef', 'magic', 'crit'].map(key => [key, Math.round((buffed[key] - plain[key]) * 10) / 10]));
            for (const [key, amount] of Object.entries(moved)) {
                assert.ok(amount <= (key === 'crit' ? 3 : 2), `one reply of story lines moved ${key} by +${amount} (${JSON.stringify(moved)})`);
            }
        } finally {
            h.close();
        }
    });
});
