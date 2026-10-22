// beta.1 live test, the reader's note "debuff doesn't change according to time, only battle turns": a
// condition a fight left (poisoned, bleeding… with rounds to go) showed "3 turns left" until it was gone
// all at once 10 story minutes after the fight, whatever the rounds; nothing counted down with the story
// clock. Fixed (party/pools.js roundsLeft): outside a fight each round left lasts FIGHT_LEFT_MINUTES (10)
// story minutes from the minute the fight ended, counted down by the clock (Story Director's, `! time
// +…`): the Party screen says the minutes left, the status card and the next fight the rounds left.
// Derived from what is stored and the clock only, so a swipe, a delete, a Re-read and a replay agree; no
// clock (no Story Director) → no story time: it waits for a rest or the next fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { CLOCK } from '../party/helpers/clock.js';
import { FIGHT_LEFT_MINUTES, fitActor, lapsed, minutesLeft, roundsLeft } from '../../../src/v2/party/pools.js';

const poison = (over = {}) => ({ kind: 'poisoned', stacks: 3, rounds: 3, at: 600, ...over });

test('roundsLeft / minutesLeft / lapsed: a round left is FIGHT_LEFT_MINUTES story minutes', () => {
    assert.equal(FIGHT_LEFT_MINUTES, 10);
    const entry = poison();
    assert.deepEqual([0, 9, 10, 19, 20, 29, 30, 500].map(n => roundsLeft(entry, 600 + n)), [3, 3, 2, 2, 1, 1, 0, 0]);
    assert.deepEqual([0, 9, 10, 29, 30].map(n => minutesLeft(entry, 600 + n)), [30, 21, 20, 1, 0]);
    assert.deepEqual([29, 30].map(n => lapsed(entry, 600 + n)), [false, true]);
    assert.equal(roundsLeft(entry, 590), 3, 'a clock set back gives back no more than was stored');
    assert.equal(roundsLeft(entry, null), 3, 'no clock: no story time');
    assert.equal(minutesLeft(entry, null), null);
    assert.equal(roundsLeft({ kind: 'cursed', stacks: 1 }, 700), null, 'a story\'s condition has no rounds: until a rest or a cure');
    assert.equal(lapsed({ kind: 'cursed', stacks: 1 }, 99999), false);
    assert.equal(roundsLeft(poison({ at: undefined }), 999), 3, 'a fight that ended with no clock: no story time');
});

test('fitActor counts it down and moves `at` on: fitting twice changes nothing, and the count never grows', () => {
    const actor = { id: 'ac_ren00001', name: 'Ren', level: 1, xp: 0, points: 0, conditions: [poison(), { kind: 'cursed', stacks: 1 }] };
    assert.equal(fitActor(actor, { minutes: 605 }), actor, 'no round passed: the same object');
    const later = fitActor(actor, { minutes: 615 });
    assert.deepEqual(later.conditions, [{ kind: 'poisoned', stacks: 2, rounds: 2, at: 610 }, { kind: 'cursed', stacks: 1 }]);
    assert.deepEqual(fitActor(later, { minutes: 615 }).conditions, later.conditions, 'idempotent');
    assert.deepEqual(fitActor(later, { minutes: 625 }).conditions, fitActor(actor, { minutes: 625 }).conditions, 'the same from the stored record or the fitted one');
    assert.deepEqual(fitActor(actor, { minutes: 630 }).conditions, [{ kind: 'cursed', stacks: 1 }], 'worn off');
    assert.equal(fitActor(actor), actor, 'no clock: as stored');
});

/** Ren with a poison a fight left (3 rounds) at story minute 600. */
async function poisoned(host) {
    assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await host.send('Start.', host.reply('Morning.', ['~ time 600']));
    const id = host.q('party.pc').id;
    const left = await host.internal('party.applyResult', {
        outcome: 'victory',
        actors: [{ id, hp: { cur: host.q('party.pc').hp.cur }, mp: { cur: host.q('party.pc').mp.cur }, down: false, conditions: [{ kind: 'poison', rounds: 3 }], uses: {} }],
    });
    assert.equal(left.ok, true, left.message);
    assert.deepEqual(host.head().domains.party.actors[id].conditions, [{ kind: 'poisoned', stacks: 3, rounds: 3, at: 600 }]);
    return id;
}

const shown = host => host.q('party.pc').conditions.map(entry => [entry.kind, entry.stacks]);
// The card's conditions as ss.status props (view.js conditionStatus): the counter is `left`, the unit 'minutes' or 'turns'.
const badge = host => host.q('rpg-battle.cards', {})[0].statuses.map(entry => [entry.kind, entry.left, entry.unit]);

test('on the host with a clock: the poison counts down with `! time +…`, a swipe takes the time back, replay equals live', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(21, async () => {
        const host = await rpgHost({ modules: [CLOCK] });
        try {
            const id = await poisoned(host);
            assert.deepEqual(badge(host), [['poisoned', 30, 'minutes']]);
            await host.send('Walk.', host.reply('They walk a while.', ['! time +12m']));
            assert.deepEqual(shown(host), [['poisoned', 2]]);
            assert.deepEqual(badge(host), [['poisoned', 18, 'minutes']]);
            assert.equal(host.q('party.pools', {})[id].turns.poisoned, 2, 'the status card\'s rounds left');
            assert.match(host.tails().at(-1) ?? '', /poisoned/);
            await host.swipe('They wait instead.', host.reply('They wait.', []));
            assert.deepEqual(shown(host), [['poisoned', 3]], 'the swipe took the time back');
            await host.send('Walk on.', host.reply('Half an hour on.', ['! time +30m']));
            assert.deepEqual(shown(host), [], 'worn off');
            assert.equal(host.head().domains.party.actors[id].conditions.length, 1, 'nothing written as time passes: derived');
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
        } finally {
            host.close();
        }
    });
});

test('the next fight starts it with the rounds left by the clock', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(22, async () => {
        const host = await rpgHost({ modules: [CLOCK] });
        try {
            await poisoned(host);
            await host.send('Walk.', host.reply('Wolves on the road.', ['! time +25m', '! encounter 1 Wolf — on the road | tier: trivial']));
            assert.equal((await host.cmd('combat.start', { offer: host.q('combat.offers')[0].id })).ok, true);
            const ren = host.q('combat.board').combatants.find(entry => entry.side === 'party');
            const cond = ren.conditions.find(entry => entry.name === 'poison');
            assert.ok(cond, 'the poison is in the fight');
            assert.ok(cond.turns <= 1, `1 round left after 25 minutes (${cond.turns})`);
        } finally {
            host.close();
        }
    });
});

test('without a clock (no Story Director): no story time, it waits for a rest or the next fight', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(23, async () => {
        const host = await rpgHost();
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            const id = host.q('party.pc').id;
            const left = await host.internal('party.applyResult', { outcome: 'victory', actors: [{ id, hp: { cur: host.q('party.pc').hp.cur }, mp: { cur: 0 }, down: false, conditions: [{ kind: 'poison', rounds: 3 }], uses: {} }] });
            assert.equal(left.ok, true, left.message);
            await host.send('Walk.', host.reply('A long walk.'));
            assert.deepEqual(shown(host), [['poisoned', 3]]);
            assert.deepEqual(badge(host), [['poisoned', 3, 'turns']]);
        } finally {
            host.close();
        }
    });
});
