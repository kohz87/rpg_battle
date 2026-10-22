// rx-combat (RB #88 gear): a broken piece gives nothing (items.gear leaves it out, why 'broken'),
// but the fight's attack still counts it: combat/setup.js partyCombatants overrides the combatant's
// numbers with party.combatNumbers, which reads every equipped def's stats (party/sheets.js gearOf →
// v1 capItem) with no condition, refinement or broken rule. Same for a worn/tattered piece's 85 %/60 %
// and a refinement's +8 %/level: the fight, the HUD's numbers and the sheet use full def stats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';

// Stands in for Story Block's route of `~ item X | wear: ruin` to item.wear (as gear-host.test.js does).
const WEAR_ROUTE = {
    id: 'rx-wear-route', name: 'rx wear route', version: '0.0.0',
    capture: {
        kinds: { testwear: { grammar: '~ testwear <piece> | wear: scuff|tear|ruin' } },
        apply: (ctx, line) => ctx.call('item.wear', { name: line.name, wear: line.labels?.wear ?? '', story: true }),
    },
};

async function fightAttack({ sword, ruins }) {
    return seeded(3, async () => {
        const host = await rpgHost({ modules: [WEAR_ROUTE] });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await host.send('go', host.reply('Town.', ['~ place Bluewatch Town | kind: settlement', ...(sword ? ['+ item Iron Sword | note: weapon ATK +4'] : [])]));
            for (const row of host.q('inventory.items', {}).filter(item => item.kind === 'equipment')) assert.equal((await host.cmd('item.equip', { stack: row.stack })).ok, true);
            for (let n = 0; n < ruins; n += 1) await host.send('go', host.reply('Crack.', ['~ testwear Iron Sword | wear: ruin']));
            const gear = host.q('items.gear', {});
            const numbers = host.q('party.combatNumbers', { id: host.q('party.pc').id });
            await host.send('go', host.reply('A wolf.', ['! encounter 1 Wolf | tier: weak']));
            assert.equal((await host.cmd('combat.start', { offer: host.q('combat.offers').at(-1).id })).ok, true);
            const ren = host.head().domains.combat.session.setup.party[0];
            return { gear, numbers, patk: ren.patk };
        } finally {
            host.close();
        }
    });
}

test('rx-combat: a broken sword adds nothing to the fight\'s attack (nor to party.combatNumbers)', async t => {
    t.mock.method(console, 'warn', () => {});
    const bare = await fightAttack({ sword: false, ruins: 0 });
    const broken = await fightAttack({ sword: true, ruins: 3 });
    assert.deepEqual(broken.gear.counted, [], 'items.gear leaves the broken sword out');
    assert.deepEqual(broken.gear.unused.map(row => row.why), ['broken']);
    assert.equal(broken.numbers.attack, bare.numbers.attack, `party.combatNumbers counts the broken sword (${broken.numbers.attack} vs ${bare.numbers.attack} bare-handed)`);
    assert.equal(broken.patk, bare.patk, `the fight counts the broken sword (attack ${broken.patk} vs ${bare.patk} bare-handed)`);
});
