import test from 'node:test';
import assert from 'node:assert/strict';
import { realQuestHost, questPin, skip } from './helpers/real-host.js';
const ok = out => assert.equal(out.ok, true, JSON.stringify(out));
for (const gate of ['place', 'giver', 'both']) test(`deleting the ${gate} arrival retracts closure, coin and XP, including reload and rebuild`, { skip }, async t => {
    const given = questPin({ objectives: [{ id: 'ob_00000001', kind: 'story', text: 'Greet' }],
        turnInPlace: gate === 'giver' ? null : 'pack.fixture/haven', giver: gate === 'place' ? null : 'np_00000001' });
    const h = await realQuestHost(t, { given, modules: [{ id: 'npc-state-delta', version: '1.2.20', queries: { 'npc.identity': () => ({ id: 'np_00000001', name: 'Miller' }) } }] });
    ok(await h.packs.packs.install(JSON.stringify({ id: 'fixture', version: '2.0.0', name: 'Places', requires: { storyBlock: '^2' }, content: { places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }] } })));
    await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
    const id = h.sdk.query('director.thread', { key: 'Mill job' }).id;
    ok(await h.sdk.command('quest.take', { id }));
    await h.send('Greet.', '<Changes>\n~ quest Mill job | met: yes\n</Changes>');
    await h.send('Arrive.', '<Changes>\n~ place Haven\n+ present Miller\n</Changes>');
    const arrival = h.ctx.chat.length - 1;
    await h.send('Turn in.', 'The miller counts the work.');
    ok(await h.sdk.command('quest.finish', { id }));
    const paid = () => { assert.equal(h.sdk.query('inventory.wallet').coin, 30); assert.equal(h.sdk.query('party.pc').xp, 25); assert.deepEqual(h.store.problems(), []); };
    paid(); await h.st.loadChat(structuredClone(h.ctx.chat)); paid(); h.store.rebuild(); paid();
    await h.st.deleteMessage(arrival);
    const retracted = () => {
        assert.equal(h.sdk.query('director.thread', { id }).rpg.state, 'active');
        assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0); assert.equal(h.sdk.query('party.pc').xp, 0);
        assert.equal(h.head().meta.claims[`rb:ep_00000000:quest:${id}:1:settled`], undefined);
    };
    retracted(); await h.st.loadChat(structuredClone(h.ctx.chat)); retracted(); h.store.rebuild(); retracted();
});
