import test from 'node:test';
import assert from 'node:assert/strict';
import { createModule, PARTS } from '../../../src/v2/module.js';
import { realQuestHost, questPin, skip } from './helpers/real-host.js';

test('production registers the rules parts together only with a frozen pack and successful preflight', { skip }, async t => {
    assert.ok(['rules', 'progress', 'training', 'quests', 'items'].every(id => PARTS.some(([key]) => key === id)));
    const legacy = createModule();
    assert.equal(legacy.domains.rules, undefined);
    assert.equal(legacy.commands['skill.use'], undefined);
    const given = questPin({ objectives: [{ id: 'ob_00000001', kind: 'story', text: 'Greet the miller' }] });
    assert.throws(() => createModule({ rules: given }), /preflight/);
    const h = await realQuestHost(t, { given });
    const def = h.registry.module('rpg-battle');
    for (const domain of ['rules', 'progress', 'training']) assert.ok(def.domains[domain]);
    assert.equal(new Set(def.replayQueries).size, def.replayQueries.length);
    await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
    const id = h.sdk.query('director.thread', { key: 'Mill job' }).id;
    assert.equal((await h.sdk.command('quest.take', { id })).ok, true);
    await h.send('Greet.', '<Changes>\n~ quest Mill job | met: yes\n</Changes>');
    assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
    const check = () => {
        assert.equal(h.sdk.query('director.thread', { id }).rpg.state, 'done');
        assert.equal(h.sdk.query('inventory.wallet').coin, 30);
        assert.equal(h.sdk.query('party.pc').xp, 25);
        assert.deepEqual(h.store.problems(), []);
    };
    check(); await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
});

test('an existing rules timeline resumes from preflight without passing a pack or injecting a definition', { skip }, async t => {
    const h = await realQuestHost(t);
    await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
    const image = { chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) };
    const loaded = await realQuestHost(t, { given: null, st: image });
    const check = () => {
        assert.deepEqual(loaded.sdk.query('rules.identity'), h.sdk.query('rules.identity'));
        assert.equal(loaded.sdk.query('rules.identity').hash, h.head().domains.rules.rulesHash);
        assert.ok(loaded.registry.module('rpg-battle').commands['skill.use']);
        assert.equal(loaded.sdk.query('director.thread', { key: 'Mill job' }).rpg.state, 'offered');
        assert.deepEqual(loaded.store.problems(), []);
    };
    check(); loaded.store.rebuild(); check();
});
