import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../src/v2/module.js';

test('an unpinned raw fight result retains its XP through reload and rebuild', async t => {
    const h = await createHost({ modules: [createModule()] });
    t.after(() => h.close());
    assert.equal((await h.sdk.command('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await h.send('Fight.', 'Victory.');
    const pc = h.sdk.query('party.pc');
    const result = { outcome: 'victory', stakes: 'normal', party: [{ memberId: pc.id, name: pc.name, level: 1,
        hp: pc.hp, mp: pc.mp, down: false, conditions: [] }], xp: { [pc.id]: 120 }, uses: {} };
    assert.equal(h.bus.command('party.applyResult', { result }, { cause: 'system' }).ok, true);
    const check = () => {
        assert.equal(h.sdk.query('party.pc').level, 2);
        assert.equal(h.sdk.query('party.pc').xp, 20);
        assert.deepEqual(h.store.problems(), []);
    };
    check();
    await h.st.loadChat(structuredClone(h.ctx.chat));
    check(); h.store.rebuild(); check();
});
