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
    const host = await started({ seed: 5 });
    t.after(() => host.close());
    await host.send('Hunt.', host.reply('A drake on the bank.', ['! encounter River Drake | tier: even']));
    const offer = host.q('combat.offers').at(-1);
    assert.equal((await host.cmd('combat.start', { offer: offer.id })).ok, true);
    const foe = sessionOf(host.head().domains.combat).setup.enemies[0];
    const loot = (Array.isArray(foe.loot) ? foe.loot : []).map(row => row.name);
    assert.ok(loot.includes('River Drake Scale'), `the River Drake's loot: ${loot.join(', ')} (the pack's is River Drake Scale, Small Monster Core)`);
});

test('a2-pack-creatures: a quest-sized fight for a pack material quest drops what the quest counts', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await started({ seed: 5 });
    t.after(() => host.close());
    await host.send('Job.', host.reply('Fenna asks.', ['+ quest Drake Scales — the tanner wants scales | goal: bring 72 River Drake Scale | reward: 10 copper | giver: Fenna']));
    const [quest] = host.q('director.threads', { kind: 'quest', status: 'active' });
    assert.ok(quest, 'the quest is active');
    await host.send('Hunt.', host.reply('Drakes.', ['! encounter River Drake | tier: trivial']));
    const offer = host.q('combat.offers').at(-1);
    assert.equal(offer.foes.reduce((sum, foe) => sum + foe.count, 0), 24, 'sized for the quest: 24 drakes, each a sure drop');
    assert.equal((await host.cmd('combat.start', { offer: offer.id })).ok, true);
    assert.equal(await playOut(host), 'won');
    assert.equal((await host.cmd('combat.end', {})).ok, true);
    const progress = host.q('quest.progress', { id: quest.id });
    const dropped = host.items().filter(item => /Scale/.test(item.name)).map(item => `${item.qty} ${item.name}`).join(', ');
    assert.ok(progress.have > 0, `quest ${progress.label} after killing 24 drakes that each drop the quest's item (dropped: ${dropped})`);
});
