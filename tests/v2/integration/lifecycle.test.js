import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../src/v2/module.js';
import { DIRECTOR_PEER } from './helpers/peer.js';

test('without SD the real module reserves its names but initializes nothing and never vetoes generation; late SD activates it', async t => {
    const module = createModule();
    const h = await createHost({ modules: [module] });
    t.after(() => h.close());
    const entry = () => h.sdk.modules().find(item => item.id === module.id);
    assert.equal(entry().status, 'dormant');
    assert.match(entry().reason, /story-director/);
    for (const domain of Object.keys(module.domains)) assert.equal(h.head().domains[domain], undefined, domain);
    assert.equal(h.registry.capture('wound'), null);
    assert.ok(h.registry.contexts().every(item => item.moduleId !== module.id));
    for (const hook of Object.keys(module.hooks)) {
        assert.ok(h.registry.hookEntries(hook).every(item => item.moduleId !== module.id), hook);
    }
    assert.equal((await h.sdk.command('party.create', { name: 'Ren', preset: 'fighter' })).code, 'DEPENDENCY_UNAVAILABLE');
    assert.ok(!(await h.send('Go on.', '<Changes>\n+ item Torch\n</Changes>')).aborted);
    assert.deepEqual(h.st.notices, []);
    assert.ok(Object.keys(h.head().domains.inventory.stacks).length);
    await h.sdk.registerModule(DIRECTOR_PEER);
    assert.equal(entry().status, 'ready');
    assert.equal((await h.sdk.command('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    const before = structuredClone(h.head().domains.party);
    h.registry.setEnabled(DIRECTOR_PEER.id, false);
    assert.equal(entry().status, 'dormant');
    assert.ok(!(await h.send('Go on.', 'The road continues.')).aborted);
    h.registry.setEnabled(DIRECTOR_PEER.id, true);
    await h.send('Go on.', 'Another bend in the road.');
    assert.equal(entry().status, 'ready');
    assert.deepEqual(h.head().domains.party, before, 'reactivation preserves the initialized party');
    assert.deepEqual(h.store.problems(), []);
});
