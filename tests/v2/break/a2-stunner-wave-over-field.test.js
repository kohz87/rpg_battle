// Breaker a2 (v2 break pass 2): spreadStunners (combat/setup.js:403-416) moves each wave's stunners past
// MAX_STUNNERS into ONE extra wave after the last, without the field cap (planWaves) or the stunner cap
// applied again. `! encounter 4 Ogre; then: 4 Ogre; then: 4 Ogre | tier: trivial` against one member (field
// 4) ends with a wave of 6 Ogres, all stunners (trivial allows 2 a member). Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { market } from './helpers/econ.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';
import { COMBAT_DEFAULTS, MAX_STUNNERS } from '../../../src/v2/combat/setup.js';

test('a2-stunners: no wave puts more foes on the field than the field cap, nor more stunners than the tier allows', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await market();
    t.after(() => host.close());
    await host.send('Go.', host.reply('Ogres.', ['! encounter 4 Ogre; then: 4 Ogre; then: 4 Ogre | tier: trivial']));
    const offer = host.q('combat.offers').at(-1);
    const begun = await host.cmd('combat.start', { offer: offer.id });
    assert.equal(begun.ok, true, begun.message);
    const setup = sessionOf(host.head().domains.combat).setup;
    const waves = [setup.enemies, ...(setup.waves ?? []).map(wave => wave.enemies)];
    assert.equal(waves.flat().length, 12, 'every ogre is fought');
    const sizes = waves.map(wave => wave.length);
    assert.ok(sizes.every(n => n <= COMBAT_DEFAULTS.fieldPerMember), `wave sizes ${sizes.join(', ')}; field cap ${COMBAT_DEFAULTS.fieldPerMember} for one member`);
    const stunners = waves.map(wave => wave.filter(enemy => (enemy.skills ?? []).some(skill => Number(skill?.effect?.stun) > 0)).length);
    assert.ok(stunners.every(n => n <= MAX_STUNNERS.trivial), `stunners per wave ${stunners.join(', ')}; trivial allows ${MAX_STUNNERS.trivial}`);
});
