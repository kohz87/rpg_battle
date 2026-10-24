// Quest contract fixtures exercise production planners; runtime settlement remains a handoff.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findQuest, objectiveProgress, planSettlement, settlementKey, settlementInputs } from '../../../src/v2/quests/planner.js';

function createFixture() {
    const source = {
        sid: 'sr_00000001',
        swipeKey: 'sw_00000001',
        evidence: 'ev_00000001',
        ordinal: 0,
    };
    const cursor = {
        sid: source.sid,
        swipeKey: source.swipeKey,
        block: 'bl_00000001',
        op: 0,
        rev: 1,
    };
    const proof = {
        id: 'pf_00000001',
        source: { ...source },
        owner: 'story-director',
        kind: 'acceptance',
        payload: { thread: 'th_00000001', selection: 'Accept the contract' },
        payloadHash: 'a'.repeat(64),
        parents: [],
    };
    const quest = {
        id: 'th_00000001',
        template: 'pack.fixture/herbs',
        instance: 1,
        title: 'Gather medicinal herbs',
        category: 'side',
        giver: null,
        turnInPlace: 'pack.fixture/mill',
        requirements: [],
        objectives: [
            { id: 'ob_00000001', kind: 'collect', def: 'pack.fixture/herb', count: 3, consume: true },
        ],
        evidence: {},
        reward: {
            coin: 50,
            xp: 40,
            items: [],
        },
        storyCredit: {
            coin: 10,
            claims: ['th_00000001:credit:01'],
        },
        acceptedAt: 100,
        acceptedCursor: { ...cursor },
        deadline: 500,
        repeat: null,
        chain: null,
        state: 'active',
        settlement: null,
    };
    const thread = {
        id: 'th_00000001',
        key: 'Gather medicinal herbs',
        kind: 'hook',
        summary: 'Gather medicinal herbs for the miller',
        fields: {},
        status: 'active',
        offer: false,
        taken: { rev: 1 },
        ended: null,
        acceptance: {
            source: { ...source },
            cursor: { ...cursor },
            minute: 100,
            proof: proof.id,
        },
        rpg: quest,
    };
    const inputs = {
        proofs: [proof],
        clock: { minutes: 200, text: 'Day 1 morning' },
        place: { id: 'pack.fixture/mill' },
        activeActors: ['ac_00000001'],
        items: [
            { id: 'st_00000001', def: 'pack.fixture/herb', owner: 'party', qty: 5 },
        ],
        giverPresent: true,
    };
    return { thread, inputs };
}

test('findQuest returns null on unknown id, unknown key, or missing rpg extension', () => {
    const { thread } = createFixture();
    assert.equal(findQuest([thread], { id: 'th_99999999' }), null);
    assert.equal(findQuest([thread], { key: 'Unknown quest title' }), null);
    assert.equal(findQuest([{ id: 'th_99999998', key: 'Generic hook', status: 'active' }], { id: 'th_99999998' }), null);
    assert.equal(findQuest([], { id: 'th_00000001' }), null);
});

test('findQuest resolves SD alias to same instance and returns isolated clone without copied ledger', () => {
    const { thread } = createFixture();
    const found = findQuest([thread], { key: 'Historical alias' }, ({ key }) => (key === 'Historical alias' ? thread : null));
    assert.ok(found);
    assert.equal(found.id, thread.id);
    assert.equal(found.rpg.instance, thread.rpg.instance);

    found.rpg.instance = 99;
    found.rpg.reward.coin = 9999;
    assert.equal(thread.rpg.instance, 1);
    assert.equal(thread.rpg.reward.coin, 50);
});

test('settlementKey assigns different claims to two quests at instance 1', () => {
    const { thread } = createFixture();
    const key1 = settlementKey('ep_00000001', thread.rpg);
    const quest2 = { ...thread.rpg, id: 'th_00000002' };
    const key2 = settlementKey('ep_00000001', quest2);

    assert.equal(key1, 'rb:ep_00000001:quest:th_00000001:1:settled');
    assert.equal(key2, 'rb:ep_00000001:quest:th_00000002:1:settled');
    assert.notEqual(key1, key2);
});

test('settlementInputs projects canonical B5 envelope without mutating input references', () => {
    const { thread, inputs } = createFixture();
    const plan = planSettlement(thread, inputs);
    const operation = { type: 'quest.finish', payload: { id: thread.id } };
    const envelope = settlementInputs({
        operation,
        source: thread.acceptance.source,
        epoch: 'ep_00000001',
        rulesHash: 'f'.repeat(64),
        thread,
        inputs,
        plan,
    });

    assert.equal(envelope.version, 2);
    assert.deepEqual(envelope.operation, operation);
    assert.deepEqual(envelope.source, thread.acceptance.source);
    assert.equal(envelope.epoch, 'ep_00000001');
    assert.equal(envelope.rulesHash, 'f'.repeat(64));
    assert.deepEqual(envelope.inputs.payout, plan.payout);
    assert.deepEqual(envelope.inputs.consumed, plan.consumed);

    thread.rpg.title = 'Mutated title';
    assert.equal(envelope.inputs.thread.rpg.title, 'Gather medicinal herbs');
});

test('active acceptance binds valid Source, cursor, minute, and proof', () => {
    const { thread, inputs } = createFixture();
    const progress = objectiveProgress(thread, inputs);
    assert.equal(progress.ok, true);
    assert.equal(progress.met, true);

    const plan = planSettlement(thread, inputs);
    assert.equal(plan.ok, true);
    assert.equal(plan.outcome, 'done');
    assert.deepEqual(plan.payout, { coin: 40, xp: 40, items: [] });
    assert.deepEqual(plan.consumed, [{ stack: 'st_00000001', qty: 3 }]);
});

test('full Source fields evidence and ordinal matter for acceptance proof binding', () => {
    const { thread, inputs } = createFixture();

    const proofDiffEvidence = {
        ...inputs.proofs[0],
        source: { ...inputs.proofs[0].source, evidence: 'ev_00000099' },
    };
    const planEv = planSettlement(thread, { ...inputs, proofs: [proofDiffEvidence] });
    assert.equal(planEv.ok, false);
    assert.equal(planEv.code, 'REFUSED');

    const proofDiffOrdinal = {
        ...inputs.proofs[0],
        source: { ...inputs.proofs[0].source, ordinal: 7 },
    };
    const planOrd = planSettlement(thread, { ...inputs, proofs: [proofDiffOrdinal] });
    assert.equal(planOrd.ok, false);
    assert.equal(planOrd.code, 'REFUSED');
});

test('missing, changed, or deleted acceptance holds ALL outcomes including expired closure', () => {
    const { thread, inputs } = createFixture();
    inputs.clock.minutes = 500;

    const planDeleted = planSettlement(thread, { ...inputs, proofs: [] });
    assert.equal(planDeleted.ok, false);
    assert.equal(planDeleted.code, 'REFUSED');

    const threadMissing = { ...thread, acceptance: null };
    const planMissing = planSettlement(threadMissing, inputs);
    assert.equal(planMissing.ok, false);
    assert.equal(planMissing.code, 'REFUSED');

    const threadChangedMinute = {
        ...thread,
        acceptance: { ...thread.acceptance, minute: 999 },
    };
    const planChangedMin = planSettlement(threadChangedMinute, inputs);
    assert.equal(planChangedMin.ok, false);
    assert.equal(planChangedMin.code, 'REFUSED');

    const threadChangedCursor = {
        ...thread,
        acceptance: {
            ...thread.acceptance,
            cursor: { ...thread.acceptance.cursor, rev: 99 },
        },
    };
    const planChangedCur = planSettlement(threadChangedCursor, inputs);
    assert.equal(planChangedCur.ok, false);
    assert.equal(planChangedCur.code, 'REFUSED');
});

test('time equality expires at deadline and unset story clock holds timed quests', () => {
    const { thread, inputs } = createFixture();

    inputs.clock.minutes = 500;
    const planEqual = planSettlement(thread, inputs);
    assert.equal(planEqual.ok, true);
    assert.equal(planEqual.outcome, 'expired');
    assert.deepEqual(planEqual.payout, { coin: 0, xp: 0, items: [] });
    assert.deepEqual(planEqual.consumed, []);

    inputs.clock.minutes = 501;
    assert.equal(planSettlement(thread, inputs).outcome, 'expired');

    inputs.clock.minutes = null;
    const planUnset = planSettlement(thread, inputs);
    assert.equal(planUnset.ok, false);
    assert.equal(planUnset.code, 'CLOCK_UNSET');

    const threadUntimed = structuredClone(thread);
    threadUntimed.rpg.deadline = null;
    const planUntimed = planSettlement(threadUntimed, inputs);
    assert.equal(planUntimed.ok, true);
    assert.equal(planUntimed.outcome, 'done');
});

test('item consumption takes exact quantities in stable order excluding reserve and temporary actors', () => {
    const { thread, inputs } = createFixture();
    inputs.items = [
        { id: 'st_00000002', def: 'pack.fixture/herb', owner: 'party', qty: 2 },
        { id: 'st_00000001', def: 'pack.fixture/herb', owner: 'ac_00000001', qty: 2 },
        { id: 'st_00000003', def: 'pack.fixture/herb', owner: 'ac_00000009', qty: 10 },
        { id: 'st_00000004', def: 'pack.fixture/herb', owner: 'ac_00000008', qty: 10 },
    ];

    const plan = planSettlement(thread, inputs);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.consumed, [
        { stack: 'st_00000001', qty: 2 },
        { stack: 'st_00000002', qty: 1 },
    ]);

    const onlyReserveInputs = {
        ...inputs,
        items: [
            { id: 'st_00000003', def: 'pack.fixture/herb', owner: 'ac_00000009', qty: 10 },
        ],
    };
    const planReserve = planSettlement(thread, onlyReserveInputs);
    assert.equal(planReserve.ok, false);
    assert.equal(planReserve.code, 'NOT_ENOUGH');
});

test('same physical stack cannot be consumed twice across multiple consuming objectives', () => {
    const { thread, inputs } = createFixture();
    thread.rpg.objectives = [
        { id: 'ob_00000001', kind: 'collect', def: 'pack.fixture/herb', count: 3, consume: true },
        { id: 'ob_00000002', kind: 'collect', def: 'pack.fixture/herb', count: 3, consume: true },
    ];

    const progress = objectiveProgress(thread, inputs);
    assert.equal(progress.ok, true);
    assert.equal(progress.met, false);
    assert.equal(progress.objectives[0].met, true);
    assert.equal(progress.objectives[1].met, false);
    assert.equal(progress.objectives[1].have, 2);
    assert.deepEqual(progress.consumed, [{ stack: 'st_00000001', qty: 5 }]);

    const plan = planSettlement(thread, inputs);
    assert.equal(plan.ok, false);
    assert.equal(plan.code, 'NOT_ENOUGH');
});

test('typed reward coin, xp, and credit validate counts and safe integer bounds', () => {
    const { thread, inputs } = createFixture();

    const threadNegCoin = structuredClone(thread);
    threadNegCoin.rpg.reward.coin = -10;
    assert.equal(planSettlement(threadNegCoin, inputs).code, 'INVALID');

    const threadOverflowCoin = structuredClone(thread);
    threadOverflowCoin.rpg.reward.coin = Number.MAX_SAFE_INTEGER + 1;
    assert.equal(planSettlement(threadOverflowCoin, inputs).code, 'INVALID');

    const threadNegXp = structuredClone(thread);
    threadNegXp.rpg.reward.xp = -1;
    assert.equal(planSettlement(threadNegXp, inputs).code, 'INVALID');

    const threadStringXp = structuredClone(thread);
    threadStringXp.rpg.reward.xp = 'forty';
    assert.equal(planSettlement(threadStringXp, inputs).code, 'INVALID');

    const threadNegCredit = structuredClone(thread);
    threadNegCredit.rpg.storyCredit.coin = -1;
    assert.equal(planSettlement(threadNegCredit, inputs).code, 'INVALID');

    const threadNullClaims = structuredClone(thread);
    threadNullClaims.rpg.storyCredit.claims = null;
    assert.equal(planSettlement(threadNullClaims, inputs).code, 'INVALID');

    const threadNullReward = structuredClone(thread);
    threadNullReward.rpg.reward = null;
    assert.equal(planSettlement(threadNullReward, inputs).code, 'INVALID');

    const threadStringItems = structuredClone(thread);
    threadStringItems.rpg.reward.items = 'stone';
    assert.equal(planSettlement(threadStringItems, inputs).code, 'INVALID');
});

test('typed reward item quantities must be valid Int<1,999> and refuse invalid quantities', () => {
    const { thread, inputs } = createFixture();

    const threadZero = structuredClone(thread);
    threadZero.rpg.reward.items = [{ def: 'pack.fixture/herb', qty: 0 }];
    const planZero = planSettlement(threadZero, inputs);
    assert.equal(planZero.ok, false);
    assert.equal(planZero.code, 'INVALID');

    const threadNeg = structuredClone(thread);
    threadNeg.rpg.reward.items = [{ def: 'pack.fixture/herb', qty: -5 }];
    const planNeg = planSettlement(threadNeg, inputs);
    assert.equal(planNeg.ok, false);
    assert.equal(planNeg.code, 'INVALID');

    const threadOverflow = structuredClone(thread);
    threadOverflow.rpg.reward.items = [{ def: 'pack.fixture/herb', qty: 1000 }];
    const planOverflow = planSettlement(threadOverflow, inputs);
    assert.equal(planOverflow.ok, false);
    assert.equal(planOverflow.code, 'INVALID');
});

test('story-credit reduces only this reward coin and cannot reduce xp or items', () => {
    const { thread, inputs } = createFixture();

    thread.rpg.storyCredit.coin = 100;
    const plan = planSettlement(thread, inputs);
    assert.equal(plan.ok, true);
    assert.equal(plan.payout.coin, 0);
    assert.equal(plan.payout.xp, 40);
    assert.deepEqual(plan.payout.items, []);
});

test('missing B3 validator refuses story, kill, and visit text proofs', () => {
    const { thread, inputs } = createFixture();

    const threadStory = structuredClone(thread);
    threadStory.rpg.objectives = [{ id: 'ob_00000001', kind: 'story', text: 'Negotiate peace' }];
    threadStory.ready = { rev: 12 };
    assert.equal(planSettlement(threadStory, inputs).code, 'DEPENDENCY_UNAVAILABLE');

    const threadKill = structuredClone(thread);
    threadKill.rpg.objectives = [{ id: 'ob_00000001', kind: 'kill', foe: 'pack.fixture/wolf', count: 1 }];
    assert.equal(planSettlement(threadKill, inputs).code, 'DEPENDENCY_UNAVAILABLE');

    const threadVisit = structuredClone(thread);
    threadVisit.rpg.objectives = [{ id: 'ob_00000001', kind: 'visit', place: 'pack.fixture/mill' }];
    assert.equal(planSettlement(threadVisit, inputs).code, 'DEPENDENCY_UNAVAILABLE');
});

test('wrong thread, instance, or objective proof is held by rejecting validator', () => {
    const { thread, inputs } = createFixture();

    thread.rpg.objectives = [{ id: 'ob_00000001', kind: 'story', text: 'Scout forest' }];
    thread.rpg.evidence = {
        ev_00000009: { objective: 'ob_00000001', proof: 'pf_00000009', amount: 1 },
    };
    const storyProof = {
        id: 'pf_00000009',
        source: { ...thread.acceptance.source },
        owner: 'rpg-battle',
        kind: 'story',
        payload: { thread: 'th_00000009', instance: 1 },
        payloadHash: 'c'.repeat(64),
        parents: [],
    };
    const inputsWithStory = {
        ...inputs,
        proofs: [...inputs.proofs, storyProof],
    };

    const rejectingValidator = () => false;
    const plan = planSettlement(thread, inputsWithStory, { validateProof: rejectingValidator });
    assert.equal(plan.ok, false);
    assert.equal(plan.code, 'NOT_ENOUGH');
});

test('pure settlement inputs remain unchanged and yield deterministic repeated plans', () => {
    const { thread, inputs } = createFixture();
    const beforeThread = structuredClone(thread);
    const beforeInputs = structuredClone(inputs);

    const plan1 = planSettlement(thread, inputs);
    const plan2 = planSettlement(thread, inputs);

    assert.deepEqual(plan1, plan2);
    assert.deepEqual(thread, beforeThread);
    assert.deepEqual(inputs, beforeInputs);
});

test('missing requirements and carry checkers fail closed', () => {
    const { thread, inputs } = createFixture();

    thread.rpg.requirements = [{ kind: 'class', classes: ['pack.fixture/c0'] }];
    assert.equal(planSettlement(thread, inputs).code, 'DEPENDENCY_UNAVAILABLE');

    const refusingEvaluator = () => ({ ok: false, code: 'REFUSED', message: 'Wrong class' });
    assert.equal(planSettlement(thread, inputs, { evaluateRequirements: refusingEvaluator }).code, 'REFUSED');

    const malformedEvaluator = () => null;
    assert.equal(planSettlement(thread, inputs, { evaluateRequirements: malformedEvaluator }).code, 'DEPENDENCY_UNAVAILABLE');

    thread.rpg.requirements = [];
    thread.rpg.reward.items = [{ def: 'pack.fixture/staff', qty: 1 }];
    assert.equal(planSettlement(thread, inputs).code, 'DEPENDENCY_UNAVAILABLE');

    const malformedCarry = () => null;
    assert.equal(planSettlement(thread, inputs, { canReceive: malformedCarry }).code, 'DEPENDENCY_UNAVAILABLE');
});

test('overweight refusal holds all payout without partial distribution', () => {
    const { thread, inputs } = createFixture();
    thread.rpg.reward = {
        coin: 100,
        xp: 75,
        items: [{ def: 'pack.fixture/chest', qty: 1 }],
    };
    const canReceive = () => ({ ok: false, code: 'REFUSED', message: 'Inventory is full.' });
    const plan = planSettlement(thread, inputs, { canReceive });

    assert.equal(plan.ok, false);
    assert.equal(plan.code, 'REFUSED');
    assert.equal(plan.message, 'Inventory is full.');
    assert.equal(plan.payout, undefined);
    assert.equal(plan.consumed, undefined);
});
