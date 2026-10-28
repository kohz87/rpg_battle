import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from './helpers/host.js';
import { CLOCK } from '../party/helpers/clock.js';

test('creation and views work with an unset clock; both rests refuse atomically until story minute zero', async t => {
    const h = await rpgHost({ modules: [CLOCK] });
    t.after(() => h.close());
    assert.equal((await h.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await h.send('Start.', h.reply('A fall.', ['~ wound Ren — off the wall | harm: severe']));
    assert.ok(h.q('party.pc').hp.cur < h.q('party.pc').hp.max);
    for (const kind of ['short', 'long']) {
        const before = structuredClone(h.head());
        const refused = await h.cmd('party.rest', { kind });
        assert.equal(refused.ok, false);
        assert.equal(refused.code, 'CLOCK_UNSET');
        assert.deepEqual(h.head(), before, 'no recovery, claims or receipts on refusal');
    }
    await h.send('It is midnight.', h.reply('The clock starts.', ['~ time 0']));
    for (const kind of ['short', 'long']) assert.equal((await h.cmd('party.rest', { kind })).ok, true);
    assert.equal(h.q('party.pc').hp.cur, h.q('party.pc').hp.max);
    const before = structuredClone(h.head().domains);
    h.store.rebuild();
    assert.deepEqual(h.head().domains, before);
    assert.deepEqual(h.store.problems(), []);
});
