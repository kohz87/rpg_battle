// Wave C party features on the real Story Block host: timed effects from a story line (in the
// check table and the tail, gone with a swipe, pruned by key when over), party.ranks and a foe
// line's absolute rank, a companion by formula, the points-to-spend query, the static prompt
// byte-identical reply to reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from './helpers/host.js';

async function started() {
    const host = await rpgHost();
    assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await host.send('We walk into the village.', host.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement']));
    return host;
}

test('an effect from the story: in the tail and the check table, counted on the check, gone with a swipe', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(3, async () => {
        const host = await started();
        try {
            await host.send('I drink it.', host.reply('Her eyes sharpen.', ['+ effect Keen Sight — sharper eyes | on: perception | for: 3 replies']));
            const [effect] = host.q('party.effects', {});
            assert.equal(effect.name, 'Keen Sight');
            assert.equal(effect.tone, 'good');
            assert.equal(effect.left, '3 replies', 'no clock: replies');
            await host.send('I look around.', host.reply('She scans the square.', ['? check perception — the square | dc: normal | roll: 1 | result: success']));
            const tail = host.tails().at(-1);
            assert.match(tail, /Effects: Ren — Keen Sight \(sharper eyes, \d repl/);
            // The check table (checks/table.js) has a Perception row for the effect's topic.
            assert.ok(!tail.includes('Checks — Ren'));
            const [check] = Object.values(host.head().domains.checks.log);
            assert.deepEqual(check.modifiers.find(entry => entry.source === 'effect'), { source: 'effect', ref: null, amount: 1, reason: 'Keen Sight' });
            await host.swipe('She looks around, nothing more.');
            assert.equal(Object.values(host.head().domains.checks.log).length, 0, 'the swipe takes the check back');
            assert.equal(host.q('party.effects', {}).length, 1, 'the effect is the earlier reply\'s');
            const statics = new Set(host.statics());
            assert.equal(statics.size, 1, 'the static prompt is byte-identical reply to reply');
            assert.match([...statics][0], /\+ effect Name — short note/);
        } finally {
            host.close();
        }
    });
});

test('an effect that is over leaves the tail, is pruned by key before the next reply, and the rebuild equals the live head', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(4, async () => {
        const host = await started();
        try {
            await host.send('Rest.', host.reply('Warm by the fire.', ['+ effect Warmth — by the fire | on: endurance | for: 1 reply']));
            assert.equal(Object.keys(host.head().domains.effects.active).length, 1);
            await host.send('On.', host.reply('We go on.'));
            await host.send('On again.', host.reply('Still on.'));
            await host.send('And on.', host.reply('Further.'));
            assert.deepEqual(host.q('party.effects', {}), []);
            assert.deepEqual(host.head().domains.effects.active, {}, 'pruned by key');
            assert.equal(host.tails().at(-1).includes('Effects:'), false);
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
        } finally {
            host.close();
        }
    });
});

test('party.ranks, an absolute foe rank, a companion by formula and party.toSpend on the host', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(5, async () => {
        const host = await started();
        try {
            const ladder = host.q('party.ranks', {});
            assert.deepEqual(ladder.map(rank => rank.id), ['F', 'E', 'D', 'C', 'B', 'A', 'S']);
            await host.send('Wolves!', host.reply('They come.', ['! encounter 2 Wolf — on the road | rank: E']));
            const [offer] = host.q('combat.offers');
            assert.deepEqual(offer.foes.map(foe => [foe.rank, foe.level, foe.tier]), [['E', 6, 'strong']]);
            await host.send('A stranger.', host.reply('An archer waves.', ['+ join Lyra — the archer | role: ranger']));
            const join = host.q('party.offers')[0];
            assert.equal((await host.cmd('party.acceptOffer', { offer: join.id })).ok, true);
            const lyra = host.q('party.actor', { name: 'Lyra' });
            assert.ok([1, 2].includes(lyra.level));
            assert.equal(Object.values(lyra.stats).reduce((a, b) => a + b, 0), 45 + 4 * (lyra.level - 1));
            assert.deepEqual(host.q('party.toSpend', {}), { total: 0, people: [] });
        } finally {
            host.close();
        }
    });
});

test('standalone (WAVE_BRIEF 11): without Story Director and NPC State Delta, ranks, effects and the party still work', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(6, async () => {
        const host = await started();
        try {
            const missing = name => { try { return host.q(name, {}) === undefined || host.q(name, {}) === null; } catch { return true; } };
            assert.ok(missing('director.time'), 'no Story Director clock here');
            assert.ok(missing('npc.portrait'), 'no NPC State Delta here');
            assert.equal(host.q('party.ranks', {})[0].id, 'F');
            await host.send('Drink.', host.reply('Bitter.', ['+ effect Hawk Eye — sharp | on: perception | for: 2h']));
            const [effect] = host.q('party.effects', {});
            assert.equal(effect.left, '4 replies', 'two hours without a clock: replies');
            assert.equal(host.q('party.pc').portrait, null);
        } finally {
            host.close();
        }
    });
});
