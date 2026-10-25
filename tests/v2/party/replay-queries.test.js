// The party part names the queries a replay guard may ask (Story Block REPLAY.md "Guards are pure"): only these two, each a query of the part,
// each answering from the state alone (no tools, so no settings, no clock, no other module).
import test from 'node:test';
import assert from 'node:assert/strict';
import { part } from '../../../src/v2/party/index.js';

test('the party part lists party.actor and party.actors as replay queries, and both answer from the state and their arguments alone', () => {
    assert.deepEqual(part.replayQueries, ['party.actor', 'party.actors']);
    for (const name of part.replayQueries) assert.equal(typeof part.queries[name], 'function', name);
    const state = { domains: { party: { pc: 'ac_00000001', order: ['ac_00000001'], actors: { ac_00000001: { id: 'ac_00000001', kind: 'pc', name: 'Ren', level: 1, hp: { max: 10, lost: 0 }, mp: { max: 0, lost: 0 }, sp: { max: 0, lost: 0 }, stats: {}, skills: [], conditions: [] } }, custom: {}, offers: [] } }, meta: { rev: 1 } };
    // No tools at all: a replay gives a guard nothing but the state.
    assert.equal(part.queries['party.actor'](state, { id: 'ac_00000001' }, null).name, 'Ren');
    assert.deepEqual(part.queries['party.actors'](state, {}, null).map(member => member.id), ['ac_00000001']);
    assert.equal(part.queries['party.actor'](state, { id: 'ac_99999999' }, null), null);
});
