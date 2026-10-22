// rx-combat (RB #92, F91 companion formula): a companion of your character's level gets
// companionBase + companionPerLevel × level = 55 + 5L stat points in all (formula.js), while your
// character has 7 × 5 + startPoints 10 + 4 × (L − 1) = 41 + 4L. At level 1 that is 60 against 45
// (25 spare points against 10): a level-1 fighter companion has attack 30 / HP 138 / defence 13
// against your fighter's 18 / 98 / 8. At level 10: 105 vs 81, at 60: 355 vs 281. Tiers budget per
// member who can fight, so the stronger companion makes every tier easier than it says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';

const total = stats => Object.values(stats).reduce((sum, value) => sum + value, 0);

test('rx-combat: a companion of your level is no stronger than your character of that level', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(4, async () => {
        const h = await rpgHost();
        try {
            assert.equal((await h.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await h.send('We walk in.', h.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement', '+ join Lyra — a fighter | level: 1 | role: fighter']));
            const [offer] = h.q('party.offers', {});
            assert.equal((await h.cmd('party.acceptOffer', { offer: offer.id })).ok, true);
            const [ren, lyra] = h.q('party.actors');
            assert.equal(lyra.level, ren.level);
            const numbers = actor => h.q('party.combatNumbers', { id: actor.id });
            assert.ok(total(lyra.stats) <= total(ren.stats), `Lyra (level ${lyra.level}) has ${total(lyra.stats)} stat points, Ren (level ${ren.level}) ${total(ren.stats)}`);
            assert.ok(numbers(lyra).attack <= numbers(ren).attack * 1.1, `Lyra attacks for ${numbers(lyra).attack}, Ren for ${numbers(ren).attack} (same preset, same level)`);
        } finally {
            h.close();
        }
    });
});
