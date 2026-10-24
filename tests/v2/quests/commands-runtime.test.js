// Retained selectors run production commands against the SD-owned thread.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offer, questHost, template } from './helpers/host.js';
import { terminalQuest, nextOffers } from '../../../src/v2/quests/outcomes.js';

for (const selector of ['id', 'key']) {
    test(`quest.take keeps the ${selector} selector and installs acceptance + RPG atomically`, async t => {
        const h = await questHost();
        t.after(() => h.close());
        const offered = await offer(h);
        assert.ok(offered?.rpg, JSON.stringify(h.store.problems()));
        const taken = await h.sdk.command('quest.take', { [selector]: offered[selector] });
        assert.equal(taken.ok, true, taken.message);
        const thread = h.sdk.query('director.thread', { id: offered.id });
        assert.equal(thread.rpg.state, 'active');
        assert.equal(thread.offer, false);
        assert.ok(thread.acceptance.proof);
        assert.deepEqual(thread.rpg.acceptedCursor, thread.acceptance.cursor);
        assert.equal(h.sdk.query('quest.progress', { id: offered.id }).source, 'inventory');
        assert.equal((await h.sdk.command('quest.take', { id: offered.id })).code, 'REFUSED');
        assert.deepEqual(h.sdk.query('rules.quests').map(q => q.id), [offered.id]);
    });
}

test('failed, expired and abandoned outcomes pay zero; cooldown starts at the terminal minute', () => {
    const q = { ...template(), id: 'th_00000001', instance: 1, repeat: { cooldownMinutes: 10, nextOfferAt: null } };
    for (const outcome of ['failed', 'expired', 'abandoned']) {
        const result = terminalQuest(q, { outcome, id: 'st_00000001', source: { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001', ordinal: 0 },
            epoch: 'ep_00000000', minute: 100, payout: { coin: 99, xp: 99, items: [] } });
        assert.equal(result.ok, true);
        assert.equal(result.quest.repeat.nextOfferAt, 110);
        assert.equal(result.quest.settlement.coinPaid, 0);
        assert.equal(result.quest.settlement.xpPaid, 0);
    }
    assert.equal(terminalQuest(q, { outcome: 'failed', minute: null }).code, 'CLOCK_UNSET');
});

test('the next chain template is offered only after done', () => {
    const first = template({ chain: { previous: null, next: 'pack.fixture/next' } });
    const next = template({ id: 'pack.fixture/next', name: 'Next' });
    const q = { ...first, template: first.id, instance: 1 };
    assert.deepEqual(nextOffers(q, 'failed', 100, [first, next]), []);
    assert.equal(nextOffers(q, 'done', 100, [first, next])[0].template.id, next.id);
});

test('historical quests and old owed money stay readable and cannot enter settlement', async t => {
    const old = { id: 'th_00000001', kind: 'quest', key: 'Old job', summary: 'From a previous chat', fields: { reward: '30 gold' },
        status: 'active', offer: false, taken: { rev: 0 }, ended: null, target: null, reward: null, rev: 0, owed: { text: '30 gold', rev: 0 } };
    const h = await questHost({ legacy: [old] });
    t.after(() => h.close());
    const before = h.sdk.query('director.thread', { id: old.id });
    for (const type of ['quest.take', 'quest.finish', 'quest.abandon']) assert.equal((await h.sdk.command(type, { id: old.id })).code, 'REFUSED');
    assert.equal(h.sdk.query('quest.board').active[0].finish.blocked, true);
    assert.match(h.sdk.query('quest.owed')[0].text, /earlier version/);
    assert.deepEqual(h.sdk.query('director.thread', { id: old.id }), before);
    assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0);
});
