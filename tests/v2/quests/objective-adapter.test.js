// RPG extensions may live on any SD thread kind; the fight adapter must not invent a ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { questTargets } from '../../../src/v2/combat/quest.js';

test('fight quest adapter includes the same RPG hook and excludes neutral goals', () => {
    const calls = [];
    const threads = [
        { id: 'th_00000001', kind: 'hook', rpg: { instance: 1 }, offer: false, status: 'active' },
        { id: 'th_00000002', kind: 'hook', offer: false, status: 'active' },
        { id: 'th_00000003', kind: 'hook', rpg: { instance: 1 }, offer: true, status: 'active' },
    ];
    const before = structuredClone(threads);
    const ctx = { query(name, args) {
        calls.push([name, args]);
        if (name === 'director.threads') return threads.filter(thread => !args.kind || thread.kind === args.kind);
        if (name === 'quest.progress') return { need: 3, have: 1, countable: true, noun: 'wolves', source: 'fights' };
        throw new Error('No other lookup is authorized.');
    } };
    assert.deepEqual(questTargets(ctx), [{ id: 'th_00000001', noun: 'wolves', kind: 'foes', need: 3, left: 2 }]);
    assert.deepEqual(threads, before);
    assert.deepEqual(calls, [
        ['director.threads', { status: 'active' }],
        ['quest.progress', { id: 'th_00000001' }],
    ]);
});
