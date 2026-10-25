// Check outcomes are receipt summaries; the fight-folding regression coverage still runs unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playOut, rpgHost, seeded } from '../integration/helpers/host.js';
import { settleBeforeReply } from '../../../src/v2/combat/index.js';
import { statusCardScreen } from '../../../src/v2/screens/index.js';
const lastIndex = host => host.ctx.chat.length - 1;

/** A character, an offered fight, started and played out (not finished on the board). */
async function foughtOut(host) {
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    await host.send('On.', host.reply('Wolves.', ['~ place Ridge Road | kind: road', '! encounter 2 Wolf — circling | tier: trivial']));
    const [offer] = host.q('combat.offers');
    assert.equal((await host.cmd('combat.start', { offer: offer.id })).ok, true);
    await playOut(host);
    return lastIndex(host);
}

const folds = host => host.sdk.receipts().map(entry => entry.receipt).filter(receipt => receipt.type === 'combat.fold');

test('settled before the next reply: shown in full on that reply, folded before the one after; once; replay equals live', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(23, async () => {
        const host = await rpgHost();
        try {
            const fought = await foughtOut(host);
            await host.send('We walk on.', host.reply('The road is quiet.'));
            const last = host.q('combat.last');
            assert.ok(last, 'settled by the cue');
            assert.equal(last.reply.index, fought, 'kept on the reply it was fought on');
            assert.equal(last.folded, false, 'the reply that tells it shows it in full');
            // A swipe or a regenerate of the reply that tells it: still news.
            await host.swipe(host.reply('The road bends.'));
            assert.equal(host.q('combat.last').folded, false);
            await host.regenerate(host.reply('The road climbs.'));
            assert.equal(host.q('combat.last').folded, false);
            assert.equal(folds(host).length, 0);
            // The reader's next message: the fight is old news.
            await host.send('Further.', host.reply('Pines.'));
            assert.equal(host.q('combat.last').folded, true);
            assert.equal(folds(host).length, 1);
            assert.equal(folds(host)[0].cause, 'system');
            await host.send('Still further.', host.reply('Rocks.'));
            assert.equal(folds(host).length, 1, 'folded once');
            assert.equal(host.q('combat.last').folded, true);
            // Never from a click.
            assert.equal((await host.cmd('combat.fold', {})).code, 'REFUSED');
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
            // Deleting back to the reply that told it: the fold was kept on that reply, so it stays folded
            // (live and rebuilt alike); deleting that reply too brings the result back in full.
            const end = lastIndex(host);
            await host.st.deleteMessage(end);
            await host.st.deleteMessage(end - 1);
            await host.st.deleteMessage(end - 2);
            await host.st.deleteMessage(end - 3);
            const told = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), told);
            await host.st.deleteMessage(lastIndex(host));
            await host.st.deleteMessage(lastIndex(host));
            assert.equal(lastIndex(host), fought);
            assert.equal(host.q('combat.last').folded, false, 'on the fight\'s own reply it is news again');
        } finally {
            host.close();
        }
    });
});

test('Finish pressed: the next reply still shows it in full; the one after folds it', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(24, async () => {
        const host = await rpgHost();
        try {
            await foughtOut(host);
            assert.equal((await host.cmd('combat.end', {})).ok, true);
            assert.equal(host.q('combat.last').fresh, true, 'the head is the reply it settled on');
            await host.send('We walk on.', host.reply('The road is quiet.'));
            assert.equal(host.q('combat.last').folded, false, 'the reply that tells it');
            assert.equal(host.q('combat.last').fresh, false);
            await host.send('Further.', host.reply('Pines.'));
            assert.equal(host.q('combat.last').folded, true);
            assert.equal(folds(host).length, 1);
        } finally {
            host.close();
        }
    });
});

test('settleBeforeReply folds only a result that is not news, only for a new reply; an older chat\'s result folds at once', () => {
    const view = last => ({ state: { domains: { combat: { fights: {}, last: [last] } } }, query: () => last });
    const old = { summary: 'Victory.', moments: [], rev: 7, folded: false, fresh: false };
    assert.deepEqual(settleBeforeReply(view(old), { type: 'normal' }), { commands: [{ type: 'combat.fold', payload: { rev: 7 } }] });
    assert.deepEqual(settleBeforeReply(view(old), { type: 'regenerate' }), { commands: [{ type: 'combat.fold', payload: { rev: 7 } }] });
    for (const type of ['swipe', 'continue', 'quiet', 'impersonate']) assert.deepEqual(settleBeforeReply(view(old), { type }), { commands: [] }, type);
    assert.deepEqual(settleBeforeReply(view({ ...old, fresh: true }), { type: 'normal' }), { commands: [] }, 'still news');
    assert.deepEqual(settleBeforeReply(view({ ...old, fresh: null }), { type: 'normal' }), { commands: [] }, 'unknown: left as it is');
    assert.deepEqual(settleBeforeReply(view({ ...old, folded: true }), { type: 'normal' }), { commands: [] }, 'folded already');
    // RPG Battle's status card never shows a fight's result (only HP, conditions and what the reply changed).
    assert.ok(!/combat|last/i.test(statusCardScreen.template));
});

for (const labels of ['', ' | result: success', ' | result: fail']) test(`check receipts show the actual die and outcome, without a status row (${labels})`, async () => {
    const host = await rpgHost();
    try {
        assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
        await host.send('Try.', host.reply('An attempt.', [`? check AGI — chase | dc: 40${labels}`]));
        const record = Object.values(host.head().domains.checks.log)[0];
        const receipt = host.ctx.chat.at(-1).extra.storySuite.receipts.find(row => row.type === 'capture.check');
        assert.equal(receipt.data.v2.result.die, record.die);
        assert.equal(receipt.data.v2.result.outcome, record.outcome);
        assert.match(receipt.summary, new RegExp(`d20 ${record.die} .* = ${record.total} against 40`));
        assert.equal(receipt.problem, undefined);
        assert.deepEqual(host.turn.problems(), []);
        assert.equal(host.module.domains.checks, undefined);
    } finally { host.close(); }
});
