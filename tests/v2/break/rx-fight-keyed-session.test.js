// FUZZ_DELETE seed 3 at 40 replies (final soak follow-up): a reply deleted from the middle made a later
// fight's start block skip (it named a deleted companion). That fight's actions were stored as
// `combat/session/actions/-` and `combat/session/status`, positions in whatever fight was there, so on
// replay they were played on the fight before it (whose end had been skipped too) and `combat.session`
// threw "The fight is over." to the reader (SPEC §2.2, invariant 4).
// Now each fight is kept under its own id (`combat.fights.<fi_…>`, combat/stored.js): its actions and
// its end name it, so without its start they do not apply and are listed as a Problem; a fight view
// never throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { fightOut, patch, withHero } from '../qa/helpers/harness.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

test('a fight\'s actions and status are written under its own id', () => {
    const { h } = withHero();
    assert.equal(h.capture({ op: '!', kind: 'encounter', name: 'Bandit', text: 'on the road', labels: { tier: 'weak' } }).ok, true);
    const start = h.command('combat.start', { offer: h.query('combat.offers')[0].id });
    assert.equal(start.ok, true, start.message);
    const id = start.receipt.data.session;
    const combat = h.state().domains.combat;
    assert.deepEqual(Object.keys(combat.fights), [id]);
    assert.equal(combat.session, null);
    const view = h.query('combat.session');
    const acted = h.command('combat.act', { action: { type: 'defend' }, session: id });
    assert.equal(acted.ok, true, acted.message);
    assert.equal(sessionOf(h.state().domains.combat).actions.length, 1);
    assert.equal(view.id, id);
});

test('deleting the reply that started a fight drops its later actions as a Problem; nothing throws', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(31, async () => {
        const h = await rpgHost();
        try {
            assert.equal((await h.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await h.send('We set out.', h.reply('The road.', ['~ place Old Weir | kind: wild']));
            await h.send('Bandits!', h.reply('They come.', ['! encounter 1 Bandit — on the road | tier: weak']));
            const started = await h.cmd('combat.start', { offer: h.q('combat.offers')[0].id });
            assert.equal(started.ok, true, started.message);
            const fightId = h.q('combat.session').id;
            const startReply = h.st.ctx.chat.length - 1;
            await h.send('Fight on.', h.reply('Steel rings.'));
            assert.equal((await h.cmd('combat.act', { action: { type: 'defend' } })).ok, true);
            const ops = h.st.ctx.chat.at(-1).extra.storySuite.ops.map(op => op.path);
            assert.ok(ops.some(path => path.startsWith(`/domains/combat/fights/${fightId}/actions/`)), ops.join(' '));
            await h.st.deleteMessage(startReply);
            await h.st.deleteMessage(startReply - 1);
            const problems = h.store.problems().map(problem => problem.why ?? problem.message);
            assert.ok(problems.length && problems.every(why => why.includes(`(no "${fightId}")`)), problems.join(' | '));
            assert.equal(h.q('combat.session'), null, 'no fight: its actions went with its start');
            assert.doesNotThrow(() => h.q('combat.board'));
        } finally { h.close(); }
    });
});

test('a fight left over from a skipped end is shown once the newer one is settled; never two at once to the reader', () => {
    const { h } = withHero();
    assert.equal(h.capture({ op: '!', kind: 'encounter', name: 'Bandit', text: 'on the road', labels: { tier: 'weak' } }).ok, true);
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers')[0].id }).ok, true);
    fightOut(h);
    const older = structuredClone(sessionOf(h.state().domains.combat));
    // What a replay that passed over this fight's end leaves, with a newer fight started after it.
    assert.equal(h.command('combat.end').ok, true);
    assert.equal(h.capture({ op: '!', kind: 'encounter', name: 'Wolf', text: 'in the reeds', labels: { tier: 'weak' } }).ok, true);
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers').at(-1).id }).ok, true);
    const newer = sessionOf(h.state().domains.combat);
    patch(h, state => { state.domains.combat.fights[older.id] = { ...older, rev: 0 }; });
    assert.equal(h.query('combat.session').id, newer.id, 'the newest fight is the one under way');
    fightOut(h);
    assert.equal(h.command('combat.end').ok, true);
    assert.equal(h.query('combat.session').id, older.id, 'then the one left over, to be settled');
    assert.equal(h.command('combat.end').ok, false, 'its end was already claimed on this line of history');
});

test('a stored fight with actions past its end reads as far as it goes, never throws', () => {
    const { h } = withHero();
    assert.equal(h.capture({ op: '!', kind: 'encounter', name: 'Bandit', text: 'on the road', labels: { tier: 'weak' } }).ok, true);
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers')[0].id }).ok, true);
    fightOut(h);
    const played = sessionOf(h.state().domains.combat).actions.length;
    patch(h, state => {
        const fight = sessionOf(state.domains.combat);
        fight.actions.push({ type: 'defend' }, { type: 'defend' });
    });
    const view = h.query('combat.session');
    assert.ok(view && view.status !== 'active');
    assert.equal(sessionOf(h.state().domains.combat).actions.length, played + 2);
    assert.doesNotThrow(() => h.query('combat.board'));
});
