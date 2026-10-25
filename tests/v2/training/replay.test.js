// Training under refusal, interruption and replay (contract §5, §6; B3 "Training crosses midnight, caps/interruption apply on
// recorded completion day; same request reuses event/null draw; failed SD advance leaves no fee, event or credit"; C06
// "re-read removes jump/completion/event").
import test from 'node:test';
import { seeded } from '../integration/helpers/host.js';
import assert from 'node:assert/strict';
import { DAY, SD, realWorld } from '../progress/helpers/world.js';
import { ref, trainersPin } from '../progress/helpers/fixture.js';
import { trainingProblems } from '../../../src/v2/training/domain.js';
import { expectedSessionId, sessionsOf, currentOf } from '../../../src/v2/training/session.js';

const HAVEN = 'pack.fixture/haven';
const START = 4 * DAY + 1410;
const at = (w, text) => w.host.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
const drop = async (w, index) => { await w.host.st.deleteMessage(index); await w.host.st.deleteMessage(index - 1); };
const coin = w => w.q('inventory.wallet', { owner: 'party' }).coin ?? 0;
const clock = w => w.q('director.time', {}).minutes;
const sessions = w => w.slice('training').sessions;
const offer = (w, trainer = 'mentor', skill = 's00') => w.q('rules.training', { actor: w.pc }).offers.find(item => item.trainer === ref(trainer) && item.skill === ref(skill));

async function ready(t, over = {}) {
    const w = await realWorld(t, { given: trainersPin(), sd: true, ...over });
    await w.say('Haven at dusk.', [`~ time ${START}`, `~ here ${HAVEN}`]);
    assert.equal(w.host.bus.command('test.coin', { amount: 100 }, { cause: 'ui' }).ok, true);
    return w;
}

test('a session the host cannot start is refused with its reason: no fee, no time, no event, no credit, and the player may ask again', async t => {
    const w = await ready(t);
    // The party walks away before the host answers.
    const item = offer(w);
    assert.equal(w.ui('skill.train', item.payload).ok, true);
    await w.say('She wanders off.', ['~ here pack.fixture/mill']);
    let session = sessions(w)[item.session];
    assert.deepEqual([session.status, session.fee, session.startMinute, session.event], ['refused', null, null, null]);
    assert.match(session.reason, /Old Brann is not here/);
    assert.equal(coin(w), 100);
    assert.equal(clock(w), START);
    assert.deepEqual(Object.keys(w.slice('progress').attempts), []);
    assert.equal(w.q('rules.training', { actor: w.pc }).session.status, 'refused');
    // Back at Haven, with the purse short: refused again, for the coin.
    await w.say('Back at Haven.', [`~ here ${HAVEN}`]);
    assert.equal(w.ui('skill.train', offer(w).payload).ok, true, 'a refusal frees the character to ask again');
    const second = w.q('rules.training', { actor: w.pc }).session;
    assert.equal(second.status, 'requested');
    assert.equal(sessions(w)[second.id]?.status, 'requested');
    assert.notEqual(second.id, item.session);
    assert.deepEqual(w.problems(), []);
});

test('no coin: refused for the fee; the fee, the time and the credit are all or nothing', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    await w.say('Haven.', [`~ time ${START}`, `~ here ${HAVEN}`]);
    const item = offer(w);
    assert.equal(w.ui('skill.train', item.payload).ok, true);
    await w.say('The lesson.', [`~ here ${HAVEN}`]);
    assert.match(sessions(w)[item.session].reason, /cannot pay 20/);
    assert.equal(clock(w), START);
});

test('a failed advance of the clock leaves no fee, no event, no credit: the whole start is rejected and the request stays', async t => {
    const stuck = { ...SD, commands: { 'director.advance': () => ({ summary: 'Nothing moves.', narrate: false, data: { minutes: START, from: START, advanced: 0 } }) } };
    const w = await ready(t, { sd: stuck });
    const item = offer(w);
    assert.equal(w.ui('skill.train', item.payload).ok, true);
    const turns = [];
    w.host.events.on('turn', turn => turns.push(turn));
    await w.say('The lesson.', [`~ here ${HAVEN}`]);
    assert.deepEqual(turns.flatMap(turn => turn.problems).map(problem => problem.code), ['REFUSED']);
    assert.equal(coin(w), 100, 'no fee');
    assert.equal(sessions(w)[item.session].status, 'requested');
    assert.equal(sessions(w)[item.session].event, null, 'no event');
    assert.deepEqual(Object.keys(w.slice('progress').attempts), [], 'no credit');
    assert.equal(Object.keys(w.head().meta.claims).some(key => key.includes('train:')), false);
});

test('the event die is rolled once and recorded; a Re-read of the reply gives the same die and the same result', async t => {
    const w = await ready(t);
    const item = offer(w, 'stormy', 's02');
    assert.equal(w.ui('skill.train', item.payload).ok, true);
    await w.say('The lesson.', [`~ here ${HAVEN}`]);
    const before = JSON.stringify([sessions(w), w.slice('progress').credits, coin(w), clock(w)]);
    const session = sessions(w)[item.session];
    assert.ok(Number.isInteger(session.event.die) && session.event.die >= 1 && session.event.die <= 100);
    assert.equal(session.status, session.event.template ? 'interrupted' : 'completed');
    const index = at(w, 'The lesson.');
    assert.equal((await w.host.turn.reread(index)).ok, true);
    assert.equal(JSON.stringify([sessions(w), w.slice('progress').credits, coin(w), clock(w)]), before, 'a Re-read of unchanged text draws no new die');
    w.host.store.rebuild();
    assert.equal(JSON.stringify([sessions(w), w.slice('progress').credits, coin(w), clock(w)]), before);
});

test('an event interrupts: the fee is paid and the time passes, no credit and no refund; ten in a hundred is the pin\'s rate', t => seeded(9, async () => {
    const w = await ready(t);
    // Enough coin for sixty lessons at 5 (the die is random: ten in a hundred, so a run of twenty without an event is not rare).
    assert.equal(w.host.bus.command('test.coin', { amount: 300 }, { cause: 'ui' }).ok, true);
    let hit = null;
    let before = null;
    for (let n = 0; n < 60 && !hit; n += 1) {
        const item = offer(w, 'stormy', 's02');
        assert.equal(w.ui('skill.train', item.payload).ok, true);
        const held = { coin: coin(w), time: clock(w), credits: Object.keys(w.slice('progress').attempts).length };
        await w.say(`Lesson ${n}.`, [`~ here ${HAVEN}`]);
        const session = sessions(w)[item.session];
        assert.ok(['completed', 'interrupted'].includes(session.status), session.reason);
        assert.equal(session.event.die <= 10, session.status === 'interrupted', 'the template is drawn exactly when the die is within the pinned percent');
        assert.equal(coin(w), held.coin - 5, 'the fee is paid either way');
        assert.equal(clock(w), held.time + 60, 'the time passes either way');
        if (session.status === 'interrupted') {
            hit = session;
            before = held;
            assert.equal(session.event.template, ref('storm'));
            assert.match(session.reason, /interrupted/);
            assert.equal(Object.keys(w.slice('progress').attempts).length, held.credits, 'no credit for a session an event broke');
            assert.equal(w.q('rules.training', { actor: w.pc }).session.status, 'interrupted');
        } else {
            assert.equal(Object.keys(w.slice('progress').attempts).length, held.credits + 2, 'two completion credits');
        }
    }
    assert.ok(hit && before, 'sixty sessions at ten percent drew an event');
    // Deleting nothing and asking again: an interrupted session frees the character to ask for another.
    assert.equal(w.ui('skill.train', offer(w, 'stormy', 's02').payload).ok, true);
    assert.deepEqual(w.problems(), []);
}));

test('C06: the clock jump taken out, the whole training goes with it (fee, time, event, credits); put back, it returns', async t => {
    const w = await ready(t);
    const item = offer(w);
    assert.equal(w.ui('skill.train', item.payload).ok, true);
    await w.say('The lesson.', [`~ here ${HAVEN}`]);
    assert.equal(sessions(w)[item.session].status, 'completed');
    assert.equal(coin(w), 80);
    // The reply that set the clock is edited so it no longer does: the lesson has no start minute any more.
    const index = at(w, 'Haven at dusk.');
    const message = w.host.ctx.chat[index];
    const original = message.mes;
    const edited = original.replace(`~ time ${START}\n`, '');
    assert.notEqual(edited, original);
    message.mes = edited;
    message.swipes[message.swipe_id] = edited;
    assert.equal((await w.host.turn.reread(index)).ok, true);
    assert.equal(sessions(w)[item.session].status, 'requested', 'the request stands; the settlement is gone');
    assert.equal(coin(w), 100, 'the fee is back');
    assert.deepEqual(Object.keys(w.slice('progress').attempts), []);
    assert.deepEqual(Object.keys(w.slice('progress').credits), []);
    assert.equal(sessions(w)[item.session].event, null);
    message.mes = original;
    message.swipes[message.swipe_id] = original;
    assert.equal((await w.host.turn.reread(index)).ok, true);
    assert.equal(sessions(w)[item.session].status, 'completed');
    assert.equal(coin(w), 80);
});

test('deleting the request takes the session, its claim and the whole settlement with it', async t => {
    const w = await ready(t);
    const item = offer(w);
    await w.say('She asks Old Brann.');
    assert.equal(w.ui('skill.train', item.payload).ok, true);
    await w.say('The lesson.', [`~ here ${HAVEN}`]);
    assert.equal(sessions(w)[item.session].status, 'completed');
    await drop(w, at(w, 'She asks Old Brann.'));
    assert.deepEqual(sessions(w), {});
    assert.equal(coin(w), 100);
    assert.equal(clock(w), START);
    assert.deepEqual(Object.keys(w.slice('progress').attempts), []);
    assert.equal(Object.keys(w.head().meta.claims).some(key => key.includes('train')), false);
    const live = JSON.stringify(w.head().domains.training);
    w.host.store.rebuild();
    assert.equal(JSON.stringify(w.head().domains.training), live);
});

test('a settlement asked for out of turn: not by the player, not for a session that is not waiting, not without a clock', async t => {
    const w = await ready(t);
    const item = offer(w);
    assert.equal(w.ui('skill.train', item.payload).ok, true);
    assert.equal(w.host.bus.command('rules.settle', { session: item.session }, { cause: 'ui' }).code, 'REFUSED');
    assert.equal(w.host.bus.command('rules.settle', { session: 'tr_zzzzzzzz' }, { cause: 'system' }).code, 'NO_LONGER_DONE');
    assert.equal(w.host.bus.command('rules.settle', { session: 'x' }, { cause: 'system' }).code, 'INVALID');
    const bare = await realWorld(t, { given: trainersPin(), sd: true });
    await bare.say('No clock yet.', [`~ here ${HAVEN}`]);
    assert.equal(bare.ui('skill.train', offer(bare).payload).ok, true);
    assert.equal(bare.host.bus.command('rules.settle', { session: offer(bare).session }, { cause: 'system' }).code, 'NO_LONGER_DONE');
    const waiting = Object.keys(sessions(bare))[0];
    assert.equal(bare.host.bus.command('rules.settle', { session: waiting }, { cause: 'system' }).code, 'CLOCK_UNSET');
});

test('the session views and ids: the next id counts the sessions already held, a session of one trainer is not another\'s', () => {
    const key = { actor: 'ac_00000001', trainer: ref('mentor'), skill: ref('s00'), form: ref('s00-base') };
    const first = expectedSessionId({}, key, 'h');
    assert.match(first, /^tr_[0-9a-z]{8}$/);
    assert.equal(expectedSessionId({}, key, 'h'), first);
    assert.notEqual(expectedSessionId({}, { ...key, trainer: ref('stormy') }, 'h'), first);
    assert.notEqual(expectedSessionId({}, key, 'other-rules'), first);
    const held = { [first]: { id: first, ...key, status: 'completed', endMinute: 5 } };
    const second = expectedSessionId(held, key, 'h');
    assert.notEqual(second, first);
    assert.deepEqual(sessionsOf({ sessions: { ...held, [second]: { id: second, ...key, status: 'requested', endMinute: null } } }, key.actor).map(item => item.id), [first, second]);
    assert.equal(currentOf({ sessions: { ...held, [second]: { id: second, ...key, status: 'requested', endMinute: null } } }, key.actor).id, second, 'the one waiting is the one shown');
    assert.equal(currentOf({ sessions: held }, key.actor).id, first);
    assert.equal(currentOf({ sessions: {} }, key.actor), null);
});

test('the training validator holds the record\'s shape', () => {
    const ok = { schema: 2, sessions: {} };
    assert.deepEqual(trainingProblems(ok), []);
    const id = 'tr_abcdefgh';
    const base = { id, actor: 'ac_00000001', skill: ref('s00'), form: ref('s00-base'), trainer: ref('mentor'), status: 'requested', fee: null, startMinute: null, endMinute: null, event: null, reason: null };
    assert.deepEqual(trainingProblems({ schema: 2, sessions: { [id]: base } }), []);
    const bad = patch => trainingProblems({ schema: 2, sessions: { [id]: { ...base, ...patch } } }).length;
    assert.ok(bad({ status: 'ran' }));
    assert.ok(bad({ status: 'completed' }), 'a session that ran has its fee and minutes');
    assert.ok(bad({ status: 'refused' }), 'a refusal says why');
    assert.ok(bad({ event: { die: 'x', template: null } }));
    assert.ok(bad({ fee: -1 }));
    assert.equal(bad({ status: 'completed', fee: 20, startMinute: 1, endMinute: 61, event: { die: 50, template: null } }), 0);
    assert.ok(trainingProblems(null).length);
});
