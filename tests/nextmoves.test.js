// Next moves (0.5.4): the prompt, reading the answer, and the moves code writes without a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEXT_MOVES_MAX, NEXT_MOVES_SYSTEM, fallbackMoves, nextMovesPrompt, parseNextMoves } from '../src/nextmoves.js';

test('the prompt: the settled outcome, the scene and the character; four short moves asked for', () => {
    const [system, user] = nextMovesPrompt({ handoff: '[Battle resolved by RPG Battle: narrate this outcome, do not change it]\nVictory in 4 rounds.', scene: 'Narrator: Two wolves  come out of the reeds.', pcName: 'Ren' });
    assert.equal(system.role, 'system');
    assert.equal(system.content, NEXT_MOVES_SYSTEM);
    assert.match(NEXT_MOVES_SYSTEM, /outcome is settled and must not change/);
    assert.match(NEXT_MOVES_SYSTEM, /exactly 4 lines/);
    assert.match(user.content, /^The player's character: Ren$/m);
    assert.match(user.content, /How the fight ended:\nVictory in 4 rounds\./, 'the header is left out');
    assert.match(user.content, /The scene before it:\nNarrator: Two wolves come out of the reeds\./);
    assert.match(nextMovesPrompt({}).find(message => message.role === 'user').content, /\(no summary\)[\s\S]*\(no story yet\)/);
});

test('reading the answer: numbered or bulleted lines, cleaned, at most four, no duplicates or preamble', () => {
    assert.deepEqual(parseNextMoves('Here are some options:\n1. Skin the wolves for their pelts.\n2) "Bind Lyra\'s arm"\n- Search the den\n* skin the wolves for their pelts!\n4: Head back to Kael.\n5. Sleep.'), [
        'Skin the wolves for their pelts.', 'Bind Lyra\'s arm.', 'Search the den.', 'Head back to Kael.',
    ]);
    assert.equal(parseNextMoves('').length, 0);
    assert.equal(parseNextMoves(null).length, 0);
    const long = parseNextMoves(`1. ${'Walk very carefully along the riverbank '.repeat(6)}`)[0];
    assert.ok(long.length <= 121, long);
    assert.match(long, /…$/);
    assert.equal(NEXT_MOVES_MAX, 4);
});

const party = (over = []) => [
    { memberId: 'pc', name: 'Ren', hp: { cur: 70, max: 82 }, down: false },
    { memberId: 'lyra', name: 'Lyra', hp: { cur: 40, max: 110 }, down: false },
    ...over,
];

test('fallback after a victory: skin or search, tend the hurt, look around, press on', () => {
    const moves = fallbackMoves({ outcome: 'victory', party: party(), defeated: ['Wolf A', 'Wolf B'], loot: { items: [{ name: 'Wolf Pelt', kind: 'material', qty: 2 }], money: 0 } });
    assert.deepEqual(moves, ['Skin the wolves and take what is worth keeping.', 'Tend to Lyra\'s wounds before moving on.', 'Look around for what brought them here.', 'Press on before anything else arrives.']);
    const coins = fallbackMoves({ outcome: 'victory', party: [party()[0]], defeated: ['Bandit A'], loot: { items: [], money: 7 } });
    assert.equal(coins[0], 'Search the fallen for anything worth taking.');
    assert.ok(coins.length >= 2 && coins.length <= 4);
    const downed = fallbackMoves({ outcome: 'victory', party: party([{ memberId: 'kael', name: 'Kael', hp: { cur: 0, max: 90 }, down: true }]), defeated: [], loot: { items: [] } });
    assert.ok(downed.includes('Get Kael back on their feet.'));
});

test('fallback after fleeing, falling back or losing', () => {
    const fled = fallbackMoves({ outcome: 'fled', party: party() });
    assert.equal(fled[0], 'Get clear before they regroup.');
    assert.ok(fled.includes('Help Lyra keep up.'));
    const withdrew = fallbackMoves({ outcome: 'withdrew', party: [party()[0]], notReached: ['the yard', 'the tower'] });
    assert.ok(withdrew.includes('Think of another way to reach the yard.'));
    const lost = fallbackMoves({ outcome: 'defeat', party: party() });
    assert.equal(lost[0], 'Try to come to your senses and see where you are.');
    assert.ok(lost.includes('Look for Lyra.'));
    for (const moves of [fled, withdrew, lost]) assert.ok(moves.length >= 2 && moves.length <= NEXT_MOVES_MAX);
});

test('fallback names a pack in the plural it reads as', () => {
    const skin = (name, count) => fallbackMoves({ outcome: 'victory', party: [], defeated: Array.from({ length: count }, (_, i) => `${name} ${'ABC'[i]}`), loot: { items: [{ name: 'Pelt', kind: 'material' }] } })[0];
    assert.equal(skin('Wolf', 2), 'Skin the wolves and take what is worth keeping.');
    assert.equal(skin('Feral Ditch-Dog', 3), 'Skin the feral ditch-dogs and take what is worth keeping.');
    assert.equal(skin('Fox', 2), 'Skin the foxes and take what is worth keeping.');
    assert.equal(skin('Bear', 1), 'Skin the bear and take what is worth keeping.');
});

test('fallback after foes fled a fight won: follow them', () => {
    const moves = fallbackMoves({ outcome: 'victory', party: [], defeated: [], fled: ['Wolf A', 'Wolf B'], loot: { items: [] } });
    assert.deepEqual(moves, ['Follow the ones that got away.', 'Look around for what brought them here.', 'Press on before anything else arrives.']);
    assert.equal(fallbackMoves({ outcome: 'victory', party: [], defeated: ['Wolf A'], fled: ['Wolf B'], loot: { items: [] } })[0], 'Follow the wolf that got away.');
});
