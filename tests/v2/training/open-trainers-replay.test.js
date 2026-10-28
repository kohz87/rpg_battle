// Training with a recorded open trainer, and what a delete, a swipe, a Re-read, a rebuild and a reload take back (RB open trainers §6, §7, §8).
// The offer is a guarded block of its reply; a request and a settlement stand on it, so they go with it and come back with it, and nothing
// is rolled again: the die, the fee and the `tn_` id are the recorded ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../integration/helpers/host.js';
import { ref } from '../progress/helpers/fixture.js';
import { HAVEN, MILL, START, at, clock, coin, drop, offers, only, ready, rowOf, sessions, spans } from './helpers/open.js';

const LINE = '+ trainer Old Reka — drills | like: drills';
const prerequisites = w => w.host.store.problems().filter(item => item.code === 'REPLAY_PREREQUISITE');

/** A chat with the offer on one reply, the request clicked on the next and the lesson run on a third. */
async function lessonRan(t, seed = 31) {
    return seeded(seed, async () => {
        const w = await ready(t, { coin: 100 });
        await w.say('Reka offers drills.', [LINE]);
        const offer = structuredClone(only(w));
        await w.say('She asks Old Reka.');
        assert.equal(w.ui('skill.train', rowOf(w, offer.id).payload).ok, true);
        await w.say('The lesson.', [`~ here ${HAVEN}`]);
        return { w, offer };
    });
}
const world = w => JSON.stringify({ training: w.slice('training'), progress: w.slice('progress'), coin: coin(w), clock: clock(w), claims: Object.keys(w.head().meta.claims).sort() });

test('training with an open trainer pays its fee, takes 60 minutes and credits the form, as a fixed trainer does', async t => {
    const { w, offer } = await lessonRan(t);
    const [session] = Object.values(sessions(w));
    assert.deepEqual([session.trainer, session.status, session.fee, session.startMinute, session.endMinute], [offer.id, 'completed', offer.fee, START, START + 60]);
    assert.equal(coin(w), 100 - offer.fee);
    assert.equal(clock(w), START + 60);
    assert.equal(Object.keys(w.slice('progress').attempts).length, 2, 'two completion credits');
    assert.ok(Object.values(w.slice('progress').credits).every(credit => credit.award === 1));
    const view = w.q('rules.training', { actor: w.pc }).session;
    assert.deepEqual([view.status, view.fee, view.trainer, view.credits, view.creditsAwarded], ['completed', offer.fee, offer.id, 2, 2]);
    assert.equal(w.progress().checklist.find(item => item.skill === ref('s00')).mastery, 1, 'two uses reach the first mastery step');
    assert.deepEqual(w.problems(), []);
    assert.deepEqual(w.host.turn.problems(), []);
});

test('a second lesson with the same trainer is the next session; the offer stays', async t => {
    const { w, offer } = await lessonRan(t);
    const first = Object.keys(sessions(w))[0];
    const again = rowOf(w, offer.id, 's00');
    assert.notEqual(again.session, first);
    assert.equal(w.ui('skill.train', again.payload).ok, true);
    await w.say('Another lesson.', [`~ here ${HAVEN}`]);
    assert.equal(Object.keys(sessions(w)).length, 2);
    assert.equal(coin(w), 100 - 2 * offer.fee);
    assert.equal(clock(w), START + 120);
    assert.deepEqual(Object.keys(offers(w)), [offer.id]);
});

test('the trainer stays where it was offered: elsewhere it is "not here", asking anyway is refused at the host\'s step with no fee and no time', async t => {
    await seeded(32, async () => {
        const w = await ready(t, { coin: 100 });
        await w.say('Reka offers drills.', [LINE]);
        const offer = only(w);
        await w.say('To the mill.', [`~ here ${MILL}`]);
        const row = rowOf(w, offer.id);
        assert.deepEqual(row.blocked, ['Old Reka is not here.']);
        assert.equal(row.where, HAVEN, 'the row says where it stands');
        assert.equal(w.ui('skill.train', row.payload).ok, true, 'a request is only asked for');
        await w.say('Still at the mill.', [`~ here ${MILL}`]);
        const session = sessions(w)[row.session];
        assert.deepEqual([session.status, session.reason, session.fee, session.startMinute], ['refused', 'Old Reka is not here.', null, null]);
        assert.equal(coin(w), 100);
        assert.equal(clock(w), START);
        assert.deepEqual(Object.keys(w.slice('progress').attempts), []);
        assert.equal(only(w).place, HAVEN, 'the offer did not move');
        // Back at Haven the same trainer can be asked again.
        await w.say('Back.', [`~ here ${HAVEN}`]);
        assert.deepEqual(rowOf(w, offer.id).blocked, []);
    });
});

test('the purse and the clock are checked as for a fixed trainer', async t => {
    await seeded(33, async () => {
        const poor = await ready(t, { coin: 5 });
        await poor.say('Reka offers drills.', ['+ trainer Old Reka | like: drills']);
        const offer = only(poor);
        assert.deepEqual(rowOf(poor, offer.id).blocked, [`It costs ${offer.fee} gold.`]);
        assert.equal(poor.ui('skill.train', rowOf(poor, offer.id).payload).ok, true);
        await poor.say('The lesson.', [`~ here ${HAVEN}`]);
        assert.match(sessions(poor)[Object.keys(sessions(poor))[0]].reason, new RegExp(`cannot pay ${offer.fee}`));
        assert.equal(coin(poor), 5);
        const bare = await ready(t, { clock: false, coin: 100 });
        await bare.say('Reka offers drills.', ['+ trainer Old Reka | like: drills']);
        const noClock = only(bare);
        assert.ok(rowOf(bare, noClock.id).blocked.includes('The story clock is not set.'));
        assert.equal(bare.ui('skill.train', rowOf(bare, noClock.id).payload).ok, true);
        await bare.say('Waiting.', []);
        assert.equal(Object.values(sessions(bare))[0].status, 'requested', 'it waits for a clock');
        assert.equal(coin(bare), 100);
    });
});

test('one request waits at a time, and the next offer is the next session id, for an open trainer too', async t => {
    await seeded(34, async () => {
        const w = await ready(t, { clock: false, coin: 100 });
        await w.say('Reka offers drills.', [LINE]);
        const offer = only(w);
        const row = rowOf(w, offer.id);
        assert.equal(w.ui('skill.train', { ...row.payload, session: 'tr_00000000' }).code, 'STALE');
        assert.equal(w.ui('skill.train', row.payload).ok, true);
        assert.equal(w.ui('skill.train', rowOf(w, offer.id, 's01').payload).code, 'REFUSED', 'one waits at a time');
        assert.equal(w.ui('skill.train', { ...row.payload, skill: ref('s02'), form: ref('s02-base') }).code, 'REFUSED', 'Drills do not teach s02');
        assert.equal(w.ui('skill.train', { ...row.payload, trainer: 'tn_00000000' }).code, 'NOT_FOUND');
        assert.equal(w.ui('skill.train', { ...row.payload, trainer: ref('drills') }).code, 'NOT_FOUND', 'a template is not a trainer');
    });
});

test('delete the creating reply: the trainer and the session that waited for it go', async t => {
    await seeded(35, async () => {
        const w = await ready(t, { clock: false, coin: 100 });
        await w.say('Reka offers drills.', [LINE]);
        const offer = only(w);
        await w.say('She asks Old Reka.');
        assert.equal(w.ui('skill.train', rowOf(w, offer.id).payload).ok, true);
        assert.equal(Object.keys(sessions(w)).length, 1);
        const unchanged = [coin(w), clock(w)];
        await drop(w, at(w, 'Reka offers drills.'));
        assert.deepEqual(offers(w), {});
        assert.deepEqual(sessions(w), {});
        assert.deepEqual([coin(w), clock(w)], unchanged);
        const found = prerequisites(w);
        assert.equal(found.length, 1, JSON.stringify(w.host.store.problems()));
        assert.match(found[0].message, /That is not a trainer of this world/);
        assert.equal(w.q('rules.training', { actor: w.pc }).offers.some(row => row.open), false);
        assert.equal(Object.keys(w.head().meta.claims).some(key => key.includes(':trainer:') || key.includes('train-request')), false);
        const live = world(w);
        w.host.store.rebuild();
        assert.equal(world(w), live);
    });
});

test('delete the creating reply after a session ran: its fee, its hour and its credits go with it', async t => {
    const { w } = await lessonRan(t);
    const before = { coin: 100, clock: START };
    assert.equal(Object.values(sessions(w))[0].status, 'completed');
    await drop(w, at(w, 'Reka offers drills.'));
    assert.deepEqual(offers(w), {});
    assert.deepEqual(sessions(w), {});
    assert.deepEqual([coin(w), clock(w)], [before.coin, before.clock]);
    assert.deepEqual(w.slice('progress').attempts, {});
    assert.deepEqual(w.slice('progress').credits, {});
    const found = prerequisites(w);
    assert.equal(found.length, 1, JSON.stringify(w.host.store.problems()));
    assert.match(found[0].message, /That is not a trainer of this world/);
    const live = world(w);
    w.host.store.rebuild();
    assert.equal(world(w), live);
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    assert.equal(world(w), live);
});

test('swipe away and back: the trainer and its session go and come back with the same id and fee', async t => {
    await seeded(36, async () => {
        const w = await ready(t, { coin: 100 });
        await w.say('Reka offers drills.', [LINE]);
        const offer = structuredClone(only(w));
        assert.equal(w.ui('skill.train', rowOf(w, offer.id).payload).ok, true);
        const held = world(w);
        const last = w.host.ctx.chat.length - 1;
        await w.host.swipe('Nobody offers anything.');
        assert.deepEqual(offers(w), {});
        assert.deepEqual(sessions(w), {});
        assert.equal(coin(w), 100);
        await w.host.st.swipeTo(last, 0);
        assert.deepEqual(only(w), offer, 'the same id, fee and place');
        assert.equal(Object.keys(sessions(w)).length, 1);
        assert.equal(world(w), held);
        w.host.store.rebuild();
        assert.equal(world(w), held);
    });
});

test('Re-read of the unchanged creating reply keeps the id, the fee and what was built on them', async t => {
    const { w, offer } = await lessonRan(t, 37);
    const held = world(w);
    const problems = JSON.stringify(w.host.store.problems());
    const result = await w.host.turn.reread(at(w, 'Reka offers drills.'));
    assert.equal(result.ok, true);
    assert.deepEqual(only(w), offer, 'the same offer, die and id');
    assert.equal(world(w), held, 'the session still completed, coin and clock as they were');
    assert.equal(JSON.stringify(w.host.store.problems()), problems);
    assert.deepEqual(w.host.store.problems(), []);
    // Again, after a rebuild: the same.
    w.host.store.rebuild();
    assert.deepEqual(only(w), offer);
    assert.equal((await w.host.turn.reread(at(w, 'Reka offers drills.'))).ok, true);
    assert.equal(world(w), held);
});

test('Re-read after the line was edited makes a new trainer and turns the old one\'s session off; nothing is paid twice', async t => {
    const { w, offer } = await lessonRan(t, 38);
    const index = at(w, 'Reka offers drills.');
    const message = w.host.ctx.chat[index];
    const edited = message.mes.replace(LINE, `${LINE} | teaches: s01`);
    assert.notEqual(edited, message.mes);
    message.mes = edited;
    message.swipes[message.swipe_id] = edited;
    assert.equal((await w.host.turn.reread(index)).ok, true);
    const now = only(w);
    assert.notEqual(now.id, offer.id, 'an edited line is a new line with a fresh seed');
    assert.deepEqual(now.skills, [ref('s01')]);
    assert.deepEqual(sessions(w), {}, 'the old session stood on the old trainer');
    assert.equal(coin(w), 100, 'nothing was paid');
    assert.equal(clock(w), START);
    assert.deepEqual(w.slice('progress').attempts, {});
    assert.equal(prerequisites(w).length, 1, JSON.stringify(w.host.store.problems()));
    const live = world(w);
    w.host.store.rebuild();
    assert.equal(world(w), live);
});

test('a reader-made trainer survives a Re-read of the reply it was made on, and goes when that reply is deleted', async t => {
    await seeded(39, async () => {
        const w = await ready(t, { coin: 100 });
        await w.say('Reka is here.');
        const out = w.ui('trainer.open', { name: 'Old Reka', template: 'drills' });
        assert.equal(out.ok, true, out.message);
        const offer = structuredClone(only(w));
        assert.equal(w.ui('skill.train', rowOf(w, offer.id).payload).ok, true);
        const held = world(w);
        const index = at(w, 'Reka is here.');
        assert.equal((await w.host.turn.reread(index)).ok, true);
        assert.deepEqual(only(w), offer, 'a kept click');
        assert.equal(world(w), held);
        assert.deepEqual(w.host.store.problems(), []);
        await drop(w, index);
        assert.deepEqual(offers(w), {}, 'a click goes with the reply it was made on');
        assert.deepEqual(sessions(w), {});
    });
});

test('rebuild, reload and live agree on a chat with two offers, requests, settles, a delete and a Re-read', async t => {
    await seeded(40, async () => {
        const w = await ready(t, { present: ['Old Reka', 'Zed'], coin: 100 });
        await w.say('Reka offers drills.', [LINE]);
        const reka = structuredClone(only(w));
        await w.say('Zed is asked.');
        assert.equal(w.ui('trainer.open', { name: 'Zed', template: 'drills', skills: [ref('s01')] }).ok, true);
        const zed = Object.values(offers(w)).find(offer => offer.name === 'Zed');
        assert.equal(w.ui('skill.train', rowOf(w, reka.id).payload).ok, true);
        await w.say('First lesson.', [`~ here ${HAVEN}`]);
        assert.equal(w.ui('skill.train', rowOf(w, zed.id, 's01').payload).ok, true);
        await w.say('Second lesson.', [`~ here ${HAVEN}`]);
        assert.deepEqual(Object.values(sessions(w)).map(session => session.status), ['completed', 'completed']);
        await w.say('Filler.', []);
        assert.equal((await w.host.turn.reread(at(w, 'Reka offers drills.'))).ok, true);
        await w.say('One more.', ['+ trainer Mia | like: drills | teaches: s00']);
        await drop(w, at(w, 'Filler.'));
        const agree = async when => {
            const live = JSON.stringify(w.head());
            const problems = JSON.stringify(w.host.store.problems());
            const chat = JSON.parse(JSON.stringify(w.host.ctx.chat));
            w.host.store.rebuild();
            assert.equal(JSON.stringify(w.head()), live, `${when}: rebuild equals live`);
            await w.host.st.loadChat(chat);
            assert.equal(JSON.stringify(w.head()), live, `${when}: reload equals live`);
            assert.equal(JSON.stringify(w.host.store.problems()), problems, `${when}: the same Problems`);
        };
        await agree('after the script');
        assert.deepEqual(Object.values(offers(w)).map(offer => offer.name).sort(), ['Mia', 'Old Reka', 'Zed']);
        // Taking the first trainer away takes its lesson and nothing else: Zed's and Mia's offers and Zed's lesson stand.
        await drop(w, at(w, 'Reka offers drills.'));
        await agree('after deleting the first offer');
        assert.deepEqual(Object.values(offers(w)).map(offer => offer.name).sort(), ['Mia', 'Zed']);
        assert.deepEqual(Object.values(sessions(w)).map(session => session.trainer), [zed.id]);
    });
});

test('deleting one trainer\'s reply leaves the other trainers, and the lessons taken with them, alone', async t => {
    await seeded(41, async () => {
        const w = await ready(t, { present: ['Old Reka', 'Zed'], coin: 100 });
        await w.say('Reka offers drills.', [LINE]);
        await w.say('Zed offers drills.', ['+ trainer Zed | like: drills']);
        const zed = Object.values(offers(w)).find(offer => offer.name === 'Zed');
        assert.equal(w.ui('skill.train', rowOf(w, zed.id).payload).ok, true);
        await w.say('The lesson.', [`~ here ${HAVEN}`]);
        const lesson = Object.values(sessions(w))[0];
        assert.equal(lesson.status, 'completed');
        await drop(w, at(w, 'Reka offers drills.'));
        assert.deepEqual(Object.values(offers(w)), [zed], 'Zed kept his offer, id and fee');
        assert.deepEqual(Object.values(sessions(w)), [lesson]);
        assert.equal(coin(w), 100 - zed.fee);
        assert.deepEqual(w.host.store.problems(), []);
        // The same when the first reply is swiped away rather than deleted, and when it is edited and read again.
        const w2 = await ready(t, { present: ['Old Reka', 'Zed'], coin: 100 });
        await w2.say('Reka offers drills.', [LINE]);
        const reka = at(w2, 'Reka offers drills.');
        await w2.say('Zed offers drills.', ['+ trainer Zed | like: drills']);
        const message = w2.host.ctx.chat[reka];
        message.mes = 'Nobody offers anything.';
        message.swipes[message.swipe_id] = message.mes;
        assert.equal((await w2.host.turn.reread(reka)).ok, true);
        assert.deepEqual(Object.values(offers(w2)).map(offer => offer.name), ['Zed']);
        assert.deepEqual(w2.host.store.problems(), []);
    });
});
