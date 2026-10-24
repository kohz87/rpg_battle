// The sealed BatchResult (fight/batch.js): immutable bytes, a stable hash, and Story Block's `batchResults.resolve({ id, state })`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { batchBytes, resolveBatch, seal, sealedProblem, withDraws } from '../../../src/v2/fight/batch.js';
import { conditionProblems, conditionRecord } from '../../../src/v2/fight/records.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { indexOf } from '../../../src/v2/rules/graph.js';
import { pinOf, pinRules, initialRules } from '../../../src/v2/rules/pin.js';
import { fixturePin, ref } from '../progress/helpers/fixture.js';

const rules = initialRules();
assert.equal(pinRules(rules, fixturePin()), '');
const ix = indexOf(pinOf({ domains: { rules } }));
const PC = 'ac_00000001';

// A finished fight, written down by hand: what v1's summarize gave and what the session stored.
const session = () => ({
    id: 'fi_00000001',
    setup: { id: 'fi_00000001', seed: 12345, ruleset: ix.rulesHash, draws: 'action', party: [{ id: PC }], enemies: [{ id: 'fo_00000001' }] },
    actions: [
        { type: 'form', form: ref('s00-base'), id: 'ca_00000001', selections: [{ effect: 0, targets: ['fo_00000001'] }, { effect: 1, targets: [PC] }] },
        { type: 'attack', target: 'fo_00000001', id: 'ca_00000002', stock: [] },
    ],
});
const result = () => ({
    outcome: 'victory', rounds: 4, stakes: 'normal',
    party: [{ memberId: PC, name: 'Astra', level: 3, hp: { cur: 61, max: 90 }, mp: { cur: 8, max: 12 }, sp: { cur: 5, max: 9 }, down: false, conditions: [{ name: 'regen', rounds: 2 }, { name: 'poison', rounds: 1 }] }],
    enemies: [{ id: 'fo_00000001', name: 'Wolf', gone: 'down', xp: 6, level: 2, rank: 'F' }],
    defeated: ['Wolf'], fled: [], parleyed: [],
    xp: { [PC]: 10 }, loot: { money: 4, items: [{ name: 'Wolf Pelt', qty: 1, rarity: 'common' }] },
    uses: { [PC]: { [ref('s00-base')]: 1, 'pack.fixture/gone-base': 2 } }, keyMoments: ['not in the bytes'],
});
const bytes = () => withDraws(batchBytes({ fight: null, session: session(), result: result(), ix, at: 3000 }), [111, 222]);

test('the bytes of a fight\'s result are plain JSON built from what it recorded, with a hash that does not move', () => {
    const sealed = seal(bytes());
    // Recorded once: if this changes, a result sealed by an earlier version no longer matches its hash.
    assert.equal(sealed.hash, '3c834b920610fcf3f7511f5345bbc4e49e8c1475d2ce5718c9a9bdc888cfaeb1');
    assert.equal(hashJson(JSON.parse(JSON.stringify(sealed.bytes))), sealed.hash, 'a JSON round trip hashes the same');
    assert.equal(sealedProblem(sealed), '');
    const b = sealed.bytes;
    assert.deepEqual(Object.keys(b).sort(), ['actions', 'defeated', 'endingMinute', 'enemies', 'fight', 'fled', 'kind', 'loot', 'outcome', 'parleyed', 'party', 'rounds', 'ruleset', 'setup', 'stakes', 'uses', 'v', 'xp']);
    assert.deepEqual(b.actions.map(a => [a.id, a.type, a.form, a.drawEnd]), [['ca_00000001', 'form', ref('s00-base'), 111], ['ca_00000002', 'attack', null, 222]]);
    assert.deepEqual(b.uses, [{ actor: PC, skill: ref('s00'), form: ref('s00-base'), count: 1 }], 'a form the ruleset does not have is not paid');
    assert.equal(b.endingMinute, 3000);
    assert.deepEqual(b.party[0].conditions.map(c => [c.kind, c.rounds, c.at]), [['regenerating', 2, 3000], ['poisoned', 1, 3000]]);
    assert.equal(JSON.stringify(b).includes('not in the bytes'), false, 'the key moments are the story\'s words, not the result');
});

test('the hash is of the normalized JSON: key order and the stored stock of an action do not matter to the order, anything else does', () => {
    const a = seal(bytes());
    const reordered = JSON.parse(JSON.stringify(bytes()), (key, value) => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value));
    assert.equal(seal(reordered).hash, a.hash);
    // Every field is in the hash.
    const flip = patch => seal({ ...bytes(), ...patch }).hash;
    for (const patch of [{ outcome: 'defeat' }, { rounds: 5 }, { endingMinute: 3001 }, { fight: 'fi_00000002' }, { xp: [] }, { uses: [] }, { loot: { money: 5, items: [] } }, { ruleset: 'f'.repeat(64) }]) assert.notEqual(flip(patch), a.hash, JSON.stringify(patch).slice(0, 40));
    const moved = bytes();
    moved.actions[1].drawEnd = 223;
    assert.notEqual(seal(moved).hash, a.hash, 'where a draw ended');
});

test('batchResults.resolve({ id, state }) answers { id, hash, bytes } for a result of this module, null for anything else, and never for bytes that do not hash', () => {
    const sealed = seal(bytes());
    const state = { domains: { progress: { batches: { br_00000001: { ...sealed, seq: 1 } } } } };
    const got = resolveBatch({ id: 'br_00000001', state });
    assert.deepEqual(got, { id: 'br_00000001', hash: sealed.hash, bytes: sealed.bytes });
    assert.notEqual(got.bytes, sealed.bytes, 'a copy: the pin of the host cannot move ours');
    assert.equal(resolveBatch({ id: 'br_00000002', state }), null);
    assert.equal(resolveBatch({ id: 'nope', state }), null);
    assert.equal(resolveBatch({ id: 'br_00000001', state: { domains: {} } }), null);
    assert.equal(resolveBatch({ state }), null);
    assert.equal(resolveBatch(), null);
    const forged = { domains: { progress: { batches: { br_00000001: { hash: sealed.hash, bytes: { ...sealed.bytes, outcome: 'defeat' }, seq: 1 } } } } };
    assert.equal(resolveBatch({ id: 'br_00000001', state: forged }), null, 'changed bytes under the same hash');
});

test('a condition record is closed: kind, stacks, rounds, strength, ending minute, source; a stat shift names its stat and direction', () => {
    const record = conditionRecord({ name: 'regen', rounds: 3, power: 12 }, { at: 700, source: { actor: PC, form: ref('s02-base'), effect: 1 } });
    assert.deepEqual(record, { kind: 'regenerating', stacks: 3, rounds: 3, strength: 12, at: 700, source: { actor: PC, form: ref('s02-base'), effect: 1 } });
    assert.deepEqual(conditionProblems(record), []);
    assert.equal(conditionRecord({ name: 'stat-shift', stat: 'STR', amount: -2, rounds: 2, power: 0 }).kind, 'STR-');
    assert.equal(conditionRecord({ name: 'shield', rounds: 3, power: 9 }).kind, 'shielded');
    assert.equal(conditionRecord({ name: 'daze', rounds: 1, power: 0 }).kind, 'daze');
    assert.notEqual(conditionProblems({ ...record, extra: 1 }).length, 0);
    assert.notEqual(conditionProblems({ ...record, rounds: -1 }).length, 0);
    assert.notEqual(conditionProblems({ ...record, at: 'x' }).length, 0);
    assert.notEqual(conditionProblems(null).length, 0);
});
