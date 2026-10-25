// Every B3 requirement is checked on the subject's current base sheet and surviving owner projections.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestPart } from '../../../src/v2/quests/index.js';
import { evaluateRequirements } from '../../../src/v2/quests/requirements.js';
import { canReceive } from '../../../src/v2/quests/rewards.js';

const pc = 'ac_00000001';
const inputs = () => ({
    party: { pc, active: [{ id: pc, kind: 'pc', class: 'pack.fixture/c1', level: 10, stats: { STR: 5 } }] },
    activeActors: [pc], flags: { values: { open: false } }, place: { id: 'pack.fixture/haven' },
    items: [{ stack: 'it_00000001', def: 'pack.fixture/herb', owner: pc, qty: 2 }, { stack: 'it_00000002', def: 'pack.fixture/herb', owner: 'ac_00000002', qty: 99 }],
    threads: [{ id: 'th_00000001', status: 'resolved', ended: { outcome: 'done' } },
        { id: 'th_00000002', rpg: { template: 'pack.fixture/job', state: 'done', settlement: { outcome: 'done' } } }],
});

for (const [requirement, bad] of [
    [{ kind: 'class', classes: ['pack.fixture/c1'] }, { classes: ['pack.fixture/c0'] }],
    [{ kind: 'level', min: 10 }, { min: 11 }],
    [{ kind: 'stat', stat: 'STR', min: 5 }, { min: 6 }],
    [{ kind: 'flag', key: 'open', value: false }, { key: 'undeclared' }],
    [{ kind: 'place', place: 'pack.fixture/haven' }, { place: 'Haven' }],
    [{ kind: 'item', def: 'pack.fixture/herb', qty: 2 }, { qty: 3 }],
    [{ kind: 'quest', template: 'pack.fixture/job' }, { template: 'pack.fixture/other' }],
    [{ kind: 'thread', thread: 'th_00000001' }, { thread: 'th_00000002' }],
]) test(`${requirement.kind} requirement refuses the ineligible projection`, () => {
    const given = inputs();
    const before = structuredClone(given);
    assert.deepEqual(evaluateRequirements([requirement], given), { ok: true });
    assert.equal(evaluateRequirements([{ ...requirement, ...bad }], given).ok, false);
    assert.deepEqual(given, before, 'a requirement never writes');
});

test('active or failed quests and unfinished generic goals never satisfy completion requirements', () => {
    for (const state of ['active', 'failed', 'abandoned', 'expired']) {
        const given = inputs();
        given.threads[1].rpg.state = state;
        assert.equal(evaluateRequirements([{ kind: 'quest', template: 'pack.fixture/job' }], given).ok, false);
    }
    const given = inputs();
    given.threads[0].ended.outcome = 'failed';
    assert.equal(evaluateRequirements([{ kind: 'thread', thread: 'th_00000001' }], given).ok, false);
});

test('reward carry checks the whole grant after exact consumption, with active durable members only', () => {
    const given = inputs();
    const def = { id: 'pack.fixture/herb', name: 'Herb', kind: 'goods', weight: 20 };
    given.carry = { inventory: { defs: { [def.id]: def } }, settings: { carryLimit: true, carrySize: 100 } };
    given.items[0].qty = 2; // 40 of 40 capacity; the reserve's 99 pieces do not add capacity or load.
    assert.equal(canReceive([{ def: def.id, qty: 1 }], given).ok, false);
    assert.equal(canReceive([{ def: def.id, qty: 1 }], given, [{ stack: 'it_00000001', qty: 1 }]).ok, true);
    given.party.active[0].stats.STR = 1;
    assert.equal(canReceive([{ def: def.id, qty: 1 }], given, [{ stack: 'it_00000001', qty: 1 }]).ok, false);
});

test('the production quest part wires requirements and reward carry without a supplied policy', () => {
    assert.equal(typeof createQuestPart().commands['quest.take'], 'function');
    assert.equal(typeof createQuestPart().hooks.beforeGenerate, 'function');
});
