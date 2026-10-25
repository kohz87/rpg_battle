// Pure settlement fixtures exercise the owner handoffs without inventing host cursor/epoch APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findQuest, objectiveProgress, planQuestSettlement, settlementKey } from '../../../src/v2/quests/planner.js';

function fixture() {
    const source = { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001', ordinal: 0 };
    const cursor = { sid: source.sid, swipeKey: source.swipeKey, block: 'bl_00000001', op: 0, rev: 1 };
    const proof = { id: 'pf_00000001', kind: 'acceptance', owner: 'story-director', source,
        payload: { thread: 'th_00000001', selection: 'Take the job' }, payloadHash: 'a'.repeat(64), parents: [] };
    const thread = { id: 'th_00000001', kind: 'hook', key: 'Mill job', status: 'active', offer: false,
        taken: { rev: 1 }, acceptance: { source, cursor, minute: 100, proof: proof.id },
        rpg: { id: 'th_00000001', template: 'pack.fixture/job', instance: 1, state: 'active',
            acceptedCursor: cursor, acceptedAt: 100, deadline: 200, settlement: null,
            requirements: [], objectives: [{ id: 'ob_00000001', kind: 'collect', def: 'pack.fixture/herb', count: 2, consume: true }],
            evidence: {}, reward: { coin: 30, xp: 25, items: [] }, storyCredit: { coin: 10, claims: ['same-reward'] },
            giver: null, turnInPlace: 'pack.fixture/mill' } };
    const inputs = { proofs: [proof], clock: { minutes: 199, text: '' }, place: { id: 'pack.fixture/mill' },
        activeActors: ['ac_00000001'], items: [{ id: 'st_00000001', def: 'pack.fixture/herb', owner: 'party', qty: 2 }] };
    return { thread, inputs };
}

test('one pure settlement plan consumes exact stacks and credits only its own reward', () => {
    const { thread, inputs } = fixture();
    const before = structuredClone({ thread, inputs });
    const plan = planQuestSettlement(thread, inputs);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.payout, { coin: 20, xp: 25, items: [] });
    assert.deepEqual(plan.consumed, [{ stack: 'st_00000001', qty: 2 }]);
    assert.deepEqual({ thread, inputs }, before);
    assert.deepEqual(planQuestSettlement(thread, inputs), plan);
});

test('deadline equality expires before turn-in and unset time holds', () => {
    const { thread, inputs } = fixture();
    inputs.clock.minutes = 200;
    assert.deepEqual(planQuestSettlement(thread, inputs).payout, { coin: 0, xp: 0, items: [] });
    assert.equal(planQuestSettlement(thread, inputs).outcome, 'expired');
    inputs.clock.minutes = null;
    assert.equal(planQuestSettlement(thread, inputs).code, 'CLOCK_UNSET');
});

test('deleted acceptance cannot authorize rewards; reserve and temporary items cannot qualify', () => {
    const { thread, inputs } = fixture();
    inputs.proofs = [];
    assert.equal(planQuestSettlement(thread, inputs).code, 'REFUSED');
    const again = fixture();
    again.inputs.items[0].owner = 'ac_reserve1';
    assert.equal(planQuestSettlement(again.thread, again.inputs).code, 'NOT_ENOUGH');
});

test('one physical item cannot pay two consuming objectives', () => {
    const { thread, inputs } = fixture();
    thread.rpg.objectives.push({ ...thread.rpg.objectives[0], id: 'ob_00000002' });
    const progress = objectiveProgress(thread, inputs);
    assert.equal(progress.met, false);
    assert.deepEqual(progress.consumed, [{ stack: 'st_00000001', qty: 2 }]);
});

test('story text is never sufficient proof without the shared B3 checker', () => {
    const { thread, inputs } = fixture();
    thread.rpg.objectives = [{ id: 'ob_00000001', kind: 'story', text: 'Rescue the miller' }];
    thread.ready = { rev: 10 };
    assert.equal(planQuestSettlement(thread, inputs).code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(planQuestSettlement(thread, inputs, { validateProof: () => false }).code, 'NOT_ENOUGH');
});

test('missing requirements/carry checker holds all payout', () => {
    const { thread, inputs } = fixture();
    thread.rpg.requirements = [{ kind: 'class', classes: ['pack.fixture/c0'] }];
    assert.equal(planQuestSettlement(thread, inputs).code, 'DEPENDENCY_UNAVAILABLE');
    thread.rpg.requirements = [];
    thread.rpg.reward.items = [{ def: 'pack.fixture/stone', qty: 1 }];
    assert.equal(planQuestSettlement(thread, inputs).code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(planQuestSettlement(thread, inputs, { canReceive: () => ({ ok: false, code: 'REFUSED', message: 'Too heavy.' }) }).code, 'REFUSED');
});

test('aliases resolve to the same SD thread, including an RPG extension on a hook', () => {
    const { thread } = fixture();
    const found = findQuest([thread], { key: 'Old alias' }, () => thread);
    assert.equal(found.id, thread.id);
    found.rpg.reward.coin = 999;
    assert.equal(thread.rpg.reward.coin, 30);
    assert.equal(findQuest([thread], { id: 'th_missing1' }), null);
});

test('settlement claims include epoch, thread and instance', () => {
    const { thread } = fixture();
    assert.equal(settlementKey('ep_00000001', thread.rpg), 'rb:ep_00000001:quest:th_00000001:1:settled');
    assert.notEqual(settlementKey('ep_00000001', thread.rpg), settlementKey('ep_00000001', { ...thread.rpg, id: 'th_00000002' }));
});
