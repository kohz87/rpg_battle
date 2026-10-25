// The closed objective payloads and the one binding that makes a proof the proof of exactly one objective (B3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { objectivePayload, objectiveProofProblem, payloadProblem, proofKindOf, validateObjectiveProof } from '../../../src/v2/quests/proofs.js';

const quest = { id: 'th_00000001', instance: 1 };
const acceptance = { id: 'pf_00000001', payloadHash: 'a'.repeat(64) };
const objectives = {
    kill: { id: 'ob_00000001', kind: 'kill', foe: 'pack.fixture/wolf', count: 2 },
    story: { id: 'ob_00000002', kind: 'story', text: 'Greet the miller' },
    visit: { id: 'ob_00000003', kind: 'visit', place: 'pack.fixture/haven' },
};
const details = { kill: { fight: 'fi_00000001', batch: { id: 'br_00000001', hash: 'b'.repeat(64) }, count: 2 }, story: { line: 'c'.repeat(64) }, visit: { scene: 'Haven' } };
const proofOf = (kind, edit = payload => payload) => ({ id: 'pf_00000009', owner: 'rpg-battle', kind: proofKindOf(kind), parents: [acceptance.id],
    payload: edit(objectivePayload(quest, objectives[kind], acceptance.id, details[kind])) });

test('collect objectives are counted from the bag; the others ride in RPG Battle\'s kill and story kinds', () => {
    assert.deepEqual(['kill', 'story', 'visit', 'collect'].map(proofKindOf), ['kill', 'story', 'story', null]);
    assert.match(payloadProblem('collect', {}), /not proved/);
});

for (const kind of ['kill', 'story', 'visit']) {
    test(`a ${kind} proof is closed: exact keys, no extra, no missing`, () => {
        const proof = proofOf(kind);
        assert.equal(payloadProblem(kind, proof.payload), '');
        assert.equal(objectiveProofProblem({ objective: objectives[kind], quest, acceptance, proof }), '');
        assert.equal(validateObjectiveProof({ objective: objectives[kind], quest, acceptance, proof, evidence: { amount: kind === 'kill' ? 2 : 1 } }), true);
        assert.match(payloadProblem(kind, { ...proof.payload, extra: 1 }), /exactly/);
        const { thread: _thread, ...missing } = proof.payload;
        assert.match(payloadProblem(kind, missing), /exactly/);
        assert.notEqual(payloadProblem(kind, { ...proof.payload, instance: 0 }), '');
        assert.notEqual(payloadProblem(kind, { ...proof.payload, thread: 'bad' }), '');
    });

    test(`a ${kind} proof for another thread, instance, objective, acceptance, owner or kind is refused with its reason`, () => {
        const problem = edit => objectiveProofProblem({ objective: objectives[kind], quest, acceptance, proof: { ...proofOf(kind), ...edit } });
        const payload = edit => ({ payload: { ...proofOf(kind).payload, ...edit } });
        assert.match(problem(payload({ thread: 'th_00000002' })), /another thread/);
        assert.match(problem(payload({ instance: 2 })), /another instance/);
        assert.match(problem(payload({ objective: 'ob_00000009' })), /another objective/);
        assert.match(problem(payload({ acceptance: 'pf_00000002' })), /acceptance/);
        assert.match(problem({ parents: [] }), /acceptance/);
        assert.match(problem({ parents: [acceptance.id, 'pf_00000003'] }), /acceptance/);
        assert.match(problem({ owner: 'story-director' }), /not RPG Battle/);
        assert.match(problem({ kind: kind === 'kill' ? 'story' : 'kill' }), /not RPG Battle/);
        assert.match(objectiveProofProblem({ objective: objectives[kind], quest: { ...quest, instance: 2 }, acceptance, proof: proofOf(kind) }), /another instance/);
        assert.match(objectiveProofProblem({ objective: objectives[kind], quest: { ...quest, id: 'th_00000003' }, acceptance, proof: proofOf(kind) }), /another thread/);
        assert.match(objectiveProofProblem({ objective: objectives[kind], quest, acceptance: null, proof: proofOf(kind) }), /acceptance/);
    });
}

test('the exact action: a kill is for its foe and count, a story for its text, a visit for its place', () => {
    const wrong = (kind, edit) => objectiveProofProblem({ objective: objectives[kind], quest, acceptance, proof: proofOf(kind, payload => ({ ...payload, ...edit })) });
    assert.match(wrong('kill', { foe: 'pack.fixture/rat' }), /another foe/);
    assert.match(wrong('story', { text: 'Something else' }), /another objective text/);
    assert.match(wrong('visit', { place: 'pack.fixture/mill' }), /another place/);
    const amount = (kind, value) => objectiveProofProblem({ objective: objectives[kind], quest, acceptance, proof: proofOf(kind), amount: value });
    assert.match(amount('kill', 3), /does not say/);
    assert.match(amount('story', 2), /does not say/);
    assert.equal(amount('kill', 2), '');
});
