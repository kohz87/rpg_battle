// beta.1 live test, the reader's notes "fight battle doesn't go off/clear after a turn" and "skill xp
// didn't increase": a fight that is over (won, lost, fled) stayed on until the reader pressed Finish on
// the board. A reader who went on with the story instead kept the board up, the tail's "being settled"
// line, a party held by the fight (no recovery, no new fight), and no HP, XP, skill uses or loot written:
// the skill's use never counted. Fixed (combat/index.js settleBeforeReply): the next new reply settles it
// first, as Finish would (a `combat.end` cue), once; and the Party screen shows a skill's uses toward its
// next level ("1/5 uses to Lv 2"), the skill tree's badge the level alone (screens/view.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { settleBeforeReply } from '../../../src/v2/combat/index.js';
import { skillProgress } from '../../../src/v2/screens/view.js';

/** A character, an offered fight, started, and played out with Power Strike whenever it is ready. */
async function wonFight(host) {
    assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await host.send('We go on.', host.reply('Wolves.', ['~ place Bluewatch Road | kind: road', '! encounter 2 Wolf — circling | tier: trivial']));
    const [offer] = host.q('combat.offers');
    assert.equal((await host.cmd('combat.start', { offer: offer.id })).ok, true);
    const pc = host.q('party.pc').id;
    let strikes = 0;
    for (let n = 0; n < 200; n += 1) {
        const board = host.q('combat.board');
        if (!board || board.status !== 'active') break;
        const enemy = board.actions.targets.enemies[0];
        const skill = (board.actions.skills ?? []).find(entry => entry.name === 'Power Strike' && entry.usable !== false && entry.ready !== false);
        const action = board.actions.actor === pc && skill ? { type: 'skill', skill: 'Power Strike', target: enemy } : { type: 'attack', target: enemy };
        let done = await host.cmd('combat.act', { action });
        if (done.ok && action.type === 'skill') strikes += 1;
        if (!done.ok) done = await host.cmd('combat.act', { action: { type: 'attack', target: enemy } });
        assert.equal(done.ok, true, done.message);
    }
    assert.notEqual(host.q('combat.board')?.status ?? null, 'active', 'setup: the fight is over');
    return { pc, strikes };
}

const receipts = host => host.sdk.receipts().map(entry => entry.receipt);
const skillOf = (host, name) => host.head().domains.party.actors[host.q('party.pc').id].skills.find(entry => entry.name === name);

test('a fight over and not finished is settled before the next reply, once; the reply is told it', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(11, async () => {
        const host = await rpgHost();
        try {
            const { strikes } = await wonFight(host);
            assert.ok(strikes >= 1, 'setup: Power Strike was used');
            assert.equal(skillOf(host, 'Power Strike').uses, 0, 'nothing is written before it is settled');
            const xp = host.q('party.pc').xp;
            await host.send('We walk on.', host.reply('The road is quiet.'));
            assert.equal(host.q('combat.board'), null, 'the board clears');
            assert.equal(host.q('combat.session'), null);
            assert.ok(host.q('combat.last'), 'the Fight screen shows it as the last fight');
            assert.equal(skillOf(host, 'Power Strike').uses, strikes, 'each use counted once');
            assert.ok(host.q('party.pc').xp > xp || host.q('party.pc').level > 1, 'the fight\'s XP');
            const tail = host.tails().at(-1);
            assert.ok(!/being settled/.test(tail), 'the tail no longer says it is being settled');
            assert.match(tail, /\[Happened\][\s\S]*Victory/, 'this reply is told how the fight went');
            assert.ok(receipts(host).some(r => r.type === 'combat.end' && r.cause === 'system'), 'settled as a system step');
            // Once: the next reply has nothing to settle, and Finish has nothing left.
            await host.send('On.', host.reply('Further on.'));
            assert.equal(receipts(host).filter(r => r.type === 'combat.end').length, 1);
            assert.equal(skillOf(host, 'Power Strike').uses, strikes);
            assert.equal((await host.cmd('combat.end', {})).code, 'NOT_FOUND');
            // Replay equals live.
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
        } finally {
            host.close();
        }
    });
});

test('Finish pressed: the next reply has nothing to settle; the uses are counted once', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(12, async () => {
        const host = await rpgHost();
        try {
            const { strikes } = await wonFight(host);
            assert.equal((await host.cmd('combat.end', {})).ok, true);
            await host.send('We walk on.', host.reply('The road is quiet.'));
            assert.equal(receipts(host).filter(r => r.type === 'combat.end').length, 1);
            assert.equal(skillOf(host, 'Power Strike').uses, strikes);
        } finally {
            host.close();
        }
    });
});

test('the next reply swiped or deleted: the fight stays settled once (kept on the reply it was fought on); replay equals live', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(13, async () => {
        const host = await rpgHost();
        try {
            const { strikes } = await wonFight(host);
            await host.send('We walk on.', host.reply('The road is quiet.'));
            await host.swipe('The road bends.');
            assert.equal(host.q('combat.board'), null);
            assert.equal(skillOf(host, 'Power Strike').uses, strikes);
            assert.equal(receipts(host).filter(r => r.type === 'combat.end').length, 1, 'a swipe does not settle again');
            const last = host.ctx.chat.length - 1;
            await host.st.deleteMessage(last);
            await host.st.deleteMessage(last - 1);
            assert.equal(host.q('combat.board'), null, 'settled on the fight\'s own reply');
            assert.equal(skillOf(host, 'Power Strike').uses, strikes);
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
        } finally {
            host.close();
        }
    });
});

test('settleBeforeReply: only a fight that is over, only for a new reply', () => {
    const view = status => ({ state: { domains: { combat: { fights: { fi_aaaaaaaa: { id: 'fi_aaaaaaaa', rev: 1, setup: {}, actions: [], status } } } } } });
    for (const status of ['won', 'lost', 'fled']) {
        assert.deepEqual(settleBeforeReply(view(status), { type: 'normal' }), { commands: [{ type: 'combat.end', payload: { session: 'fi_aaaaaaaa' } }] }, status);
        for (const type of ['swipe', 'continue', 'quiet', 'impersonate']) assert.deepEqual(settleBeforeReply(view(status), { type }), { commands: [] }, type);
    }
    assert.deepEqual(settleBeforeReply(view('active'), { type: 'normal' }), { commands: [] }, 'a fight under way stays the reader\'s');
    assert.deepEqual(settleBeforeReply({ state: { domains: {} } }, {}), { commands: [] }, 'no fight');
    assert.deepEqual(settleBeforeReply(null, {}), { commands: [] });
});

test('a skill\'s uses toward its next level, in plain words', () => {
    assert.equal(skillProgress({ level: 1, uses: 0 }), '0/5 uses to Lv 2');
    assert.equal(skillProgress({ level: 1, uses: 1 }), '1/5 uses to Lv 2');
    assert.equal(skillProgress({ level: 2, uses: 3 }), '3/12 uses to Lv 3');
    assert.equal(skillProgress({ level: 5, uses: 0 }), 'top level');
});
