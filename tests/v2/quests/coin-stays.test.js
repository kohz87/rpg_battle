// Narrated coin is paid to the wallet at once and never held for a quest. A `done` settlement pays the reward minus the
// narrated coin attributed to that quest instance (guard-bound to its narration); every other ending takes nothing away.
import assert from 'node:assert/strict';
import { test, questHost, offer, template, herb } from './helpers/host.js';

const fresh = (h, templates) => questHost({ templates, st: { chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) } });
const wallet = h => h.sdk.query('inventory.wallet').coin ?? 0;

/** The checks that must hold live, after a reload and after a rebuild. */
async function everywhere(t, h, check, templates) {
    check(h);
    const loaded = await fresh(h, templates);
    t.after(() => loaded.close());
    check(loaded);
    loaded.store.rebuild();
    check(loaded);
}

async function taken(t, templates) {
    const h = await questHost({ templates, ...(templates?.[0]?.durationMinutes ? { minute: 7100 } : {}) });
    t.after(() => h.close());
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    return { h, id: thread.id };
}

for (const ending of ['abandon', 'fail', 'expiry']) test(`narrated coin equal to the reward stays in the wallet when the quest ends by ${ending}`, async t => {
    const templates = [template({ durationMinutes: ending === 'expiry' ? 100 : null })];
    const { h, id } = await taken(t, templates);
    await h.send('Paid in advance.', '<Changes>\n+ coin 30\n</Changes>');
    assert.equal(wallet(h), 30, 'no hold at narration');
    assert.equal(h.head().meta.claims[`rb:ep_00000000:quest-coin:${h.ctx.chat.at(-1).extra?.storySuite?.source?.logical}`], undefined);
    if (ending === 'abandon') assert.equal((await h.sdk.command('quest.abandon', { id })).ok, true);
    else if (ending === 'fail') await h.send('It falls through.', '<Changes>\n- quest Mill job — failed\n</Changes>');
    else await h.send('Time passes.', '<Changes>\n~ time June 3, 1200, 10:00 am\n</Changes>');
    const state = { abandon: 'abandoned', fail: 'failed', expiry: 'expired' }[ending];
    await everywhere(t, h, host => {
        assert.equal(host.sdk.query('director.thread', { id }).rpg.state, state);
        assert.equal(wallet(host), 30);
        assert.equal(host.sdk.query('party.pc').xp, 0);
        assert.deepEqual(host.store.problems(), []);
    }, templates);
});

test('narrated coin stays in the wallet when the acceptance is swiped away', async t => {
    const h = await questHost();
    t.after(() => h.close());
    const thread = await offer(h);
    await h.send('The miller waits.', 'The miller waits.');
    const accepted = h.ctx.chat.length - 1;
    await h.swipe('The miller shrugs.');
    await h.st.swipeTo(accepted, 0);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    await h.send('Paid in advance.', '<Changes>\n+ coin 30\n</Changes>');
    assert.equal(wallet(h), 30);
    assert.equal(h.sdk.query('director.thread', { id: thread.id }).rpg.state, 'active');
    await h.st.swipeTo(accepted, 1);
    await everywhere(t, h, host => {
        assert.equal(wallet(host), 30);
        assert.equal(host.sdk.query('director.thread', { id: thread.id }).rpg.state, 'offered');
        assert.deepEqual(host.store.problems(), []);
    });
});

for (const [narrated, path] of [[30, 'system'], [30, 'ui'], [10, 'system'], [10, 'ui']]) {
    test(`narrated ${narrated} then a ${path} finish on a 30 reward pays 30 in all, through Re-read, reload and rebuild`, async t => {
        const { h, id } = await taken(t);
        assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
        await h.send('Coin first.', `<Changes>\n+ coin ${narrated}\n</Changes>`);
        assert.equal(wallet(h), narrated);
        await h.send('Turn in.', path === 'system' ? '<Changes>\n- quest Mill job — done\n</Changes>' : 'The miller counts the herbs.');
        const turnIn = h.ctx.chat.length - 1;
        if (path === 'ui') assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
        const check = host => {
            const q = host.sdk.query('director.thread', { id }).rpg;
            assert.equal(q.state, 'done');
            assert.equal(q.storyCredit.coin, narrated);
            assert.equal(q.settlement.coinPaid, 30 - narrated);
            assert.equal(wallet(host), 30);
            assert.equal(host.sdk.query('party.pc').xp, 25);
            assert.deepEqual(host.store.problems(), []);
        };
        await everywhere(t, h, check);
        if (path === 'system') { assert.equal((await h.turn.reread(turnIn)).ok, true); check(h); }
    });
}

for (const path of ['system', 'ui']) {
    test(`deleting a narration after a ${path} finish leaves 30 in all (${path === 'system' ? 'the turn-in is planned again' : 'the finish is retracted and can be repeated'})`, async t => {
        const { h, id } = await taken(t);
        assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
        await h.send('Coin first.', '<Changes>\n+ coin 10\n</Changes>');
        const narration = h.ctx.chat.length - 1;
        await h.send('Turn in.', path === 'system' ? '<Changes>\n- quest Mill job — done\n</Changes>' : 'The miller counts the herbs.');
        if (path === 'ui') assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
        assert.equal(wallet(h), 30);
        assert.equal(h.sdk.query('director.thread', { id }).rpg.settlement.coinPaid, 20);
        // The settlement was bound to that narration. Without it the reward is the whole 30, and no narrated coin is left.
        await h.st.deleteMessage(narration);
        if (path === 'ui') {
            await everywhere(t, h, host => {
                assert.equal(host.sdk.query('director.thread', { id }).rpg.state, 'active');
                assert.equal(wallet(host), 0);
                assert.equal(host.sdk.query('party.pc').xp, 0);
            });
            assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
        }
        await everywhere(t, h, host => {
            const q = host.sdk.query('director.thread', { id }).rpg;
            assert.equal(q.state, 'done');
            assert.equal(q.storyCredit.coin, 0);
            assert.equal(q.settlement.coinPaid, 30);
            assert.equal(wallet(host), 30);
            assert.equal(host.sdk.query('party.pc').xp, 25);
        });
    });

    test(`deleting the narration before the quest is done, then a ${path} finish pays 30`, async t => {
        const { h, id } = await taken(t);
        assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
        await h.send('Coin first.', '<Changes>\n+ coin 10\n</Changes>');
        await h.st.deleteMessage(h.ctx.chat.length - 1);
        assert.equal(wallet(h), 0);
        await h.send('Turn in.', path === 'system' ? '<Changes>\n- quest Mill job — done\n</Changes>' : 'The miller counts the herbs.');
        if (path === 'ui') assert.equal((await h.sdk.command('quest.finish', { id })).ok, true);
        await everywhere(t, h, host => {
            const q = host.sdk.query('director.thread', { id }).rpg;
            assert.equal(q.state, 'done');
            assert.equal(q.storyCredit.coin, 0);
            assert.equal(wallet(host), 30);
            assert.equal(host.sdk.query('party.pc').xp, 25);
        });
    });
}
