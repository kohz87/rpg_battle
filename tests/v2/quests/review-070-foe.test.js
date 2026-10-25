import test from 'node:test';
import assert from 'node:assert/strict';
import { foesPack, pinFor } from '../progress/helpers/fixture.js';
import { indexOf } from '../../../src/v2/rules/graph.js';
import { killSource } from '../../../src/v2/quests/objectives.js';
import { seal } from '../../../src/v2/fight/batch.js';
import { realQuestHost, killPin, skip } from './helpers/real-host.js';
import { seeded } from '../integration/helpers/host.js';
const pack = foesPack(); pack.content.creatures[1].name = 'Wolf';
const ix = indexOf(pinFor('review-070-collision', pack));
for (const [foe, target, expected] of [['pack.fixture/wolf', 'pack.fixture/warlord', false], ['pack.fixture/warlord', 'pack.fixture/warlord', true], [null, 'pack.fixture/warlord', false], [undefined, 'pack.fixture/warlord', false]]) test(`sealed foe ${foe} matches only canonical ${target}`, () => {
    const batch = seal({ kind: 'fight', fight: 'cf_00000001', outcome: 'victory', enemies: [{ id: 'fo_00000001', name: 'Wolf A', gone: 'down', ...(foe !== undefined ? { foe } : {}) }] });
    const result = killSource({ ix, quest: { acceptedCursor: { rev: 5 } }, combat: { beaten: { cf_00000001: { won: true, rev: 10 } } }, progress: { batches: { br_00000001: batch } } }, { foe: target }, 'cf_00000001');
    assert.equal(result.ok, expected);
});
test('a real fight seals canonical foe refs, retained through reload and rebuild', { skip }, async t => seeded(7, async () => {
    const h = await realQuestHost(t, { given: killPin() });
    await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
    const id = h.sdk.query('director.thread', { key: 'Mill job' }).id;
    assert.equal((await h.sdk.command('quest.take', { id })).ok, true);
    await h.send('Wolves.', '<Changes>\n! encounter 2 Wolf — hungry | tier: weak\n</Changes>');
    assert.equal((await h.sdk.command('combat.start', { offer: h.sdk.query('combat.offers').at(-1).id })).ok, true);
    for (let n = 0; n < 80; n++) {
        const v = h.sdk.query('combat.session'); if (v.status !== 'active') break;
        assert.equal((await h.sdk.command('combat.act', { action: { type: 'attack', target: v.actions.targets.enemies[0] }, session: v.id, board: v.board })).ok, true);
    }
    const v = h.sdk.query('combat.session');
    assert.equal((await h.sdk.command('combat.end', { session: v.id })).ok, true);
    await h.send('Return.', 'The miller waits.');
    assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
    const check = () => {
        const fight = Object.values(h.head().domains.progress.batches).find(b => b.bytes.kind === 'fight');
        assert.deepEqual(fight.bytes.enemies.map(e => e.foe), ['pack.fixture/wolf', 'pack.fixture/wolf']);
        assert.equal(h.sdk.query('director.thread', { id }).rpg.state, 'done'); assert.deepEqual(h.store.problems(), []);
    };
    check(); await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
}));
