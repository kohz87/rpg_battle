// Breaker a2 (v2 break pass 2): RPG Battle's fights never read the packs' creatures (packs.content
// { kind: 'creatures' }: PACKS.md "free-form records for RPG Battle's bestiary"). combat.start and the
// encounter capture look only at the chat's bestiary domain (combat/index.js:447, :673), which starts empty,
// so Ersveil's River Drake (level 12, loot "River Drake Scale" 60 % — a 300-copper pack material) is made up
// from the drake template and drops "Drake Scale" (a new story item). With an item quest that names the
// pack's material, a quest-sized fight (24 drakes, each a sure drop) drops 30+ "Drake Scale" that never
// count: the quest stays 0/72 and every later fight is sized to 24 again. Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playOut } from '../integration/helpers/host.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';
// Needs the four Story Suite checkouts side by side (helpers/suite.js); skipped otherwise (CI checks out
// this repo alone; the rule is also tested on its own in tests/v2/break/a2-rules.test.js).
let suite = null;
try { suite = await import('./helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;
const { started } = suite?.error ? {} : suite;

test('a2-pack-creatures: a pack creature written in an encounter is fought with the pack\'s own loot', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    // Ersveil now supplies rules-v2 foes. This regression specifically exercises the
    // unpinned legacy bestiary path, so keep its legacy creature schema explicit.
    const packText = JSON.stringify({ id: 'legacy-creature-fixture', version: '1.0.0', name: 'Legacy creature fixture', requires: { storyBlock: '^2' }, content: {
        creatures: [{ name: 'River Drake', template: 'drake', level: 12,
            loot: [{ name: 'River Drake Scale', chance: 60, qty: [1, 2], kind: 'material' }] }],
    } });
    const host = await started({ seed: 5, packText });
    t.after(() => host.close());
    await host.send('Hunt.', host.reply('A drake on the bank.', ['! encounter River Drake | tier: even']));
    const offer = host.q('combat.offers').at(-1);
    assert.equal((await host.cmd('combat.start', { offer: offer.id })).ok, true);
    const foe = sessionOf(host.head().domains.combat).setup.enemies[0];
    const loot = (Array.isArray(foe.loot) ? foe.loot : []).map(row => row.name);
    assert.ok(loot.includes('River Drake Scale'), `the River Drake's loot: ${loot.join(', ')} (the pack's is River Drake Scale, Small Monster Core)`);
});

test('a2-pack-creatures: an unpinned legacy quest cannot become a reward-bearing quest', { skip }, async t => {
    const host = await started({ seed: 5 });
    t.after(() => host.close());
    await host.send('Job.', host.reply('Fenna asks.', ['+ quest Drake Scales — the tanner wants scales | goal: bring 72 River Drake Scale | reward: 10 copper | giver: Fenna']));
    assert.deepEqual(host.q('rules.quests'), []);
    assert.deepEqual(host.q('director.threads').filter(t => t.rpg), []);
});
