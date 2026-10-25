// Training end to end (contract §3 skill.train, rules.settle; §5 "Training start"; fixture C06; B3 training acceptance): the
// player's request, the host's step that pays Story Block and moves Story Director's clock in one transaction, the event die,
// the completion credits on the day the session ends, and what a swipe, delete or Re-read takes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, SD, realWorld } from '../progress/helpers/world.js';
import { ref, trainersPin } from '../progress/helpers/fixture.js';
import { sessionView } from '../../../src/v2/training/session.js';
import { RULES_V2_CONSTANTS } from '../../vendor/story-block/src/v2/packs/rules-v2.js';

const HAVEN = 'pack.fixture/haven';
const START = 4 * DAY + 1410;

async function ready(t, over = {}) {
    const w = await realWorld(t, { given: trainersPin(), sd: true, ...over });
    await w.say('Haven at dusk.', [`~ time ${START}`, `~ here ${HAVEN}`]);
    assert.equal(w.host.bus.command('test.coin', { amount: 100 }, { cause: 'ui' }).ok, true);
    return w;
}
const coin = w => w.q('inventory.wallet', { owner: 'party' }).coin ?? 0;
const clock = w => w.q('director.time', {}).minutes;
const offer = (w, trainer = 'mentor', skill = 's00') => w.q('rules.training', { actor: w.pc }).offers.find(item => item.trainer === ref(trainer) && item.skill === ref(skill));
const train = (w, item = offer(w)) => w.ui('skill.train', item.payload);
const sessions = w => w.slice('training').sessions;

test('offers: the trainers of the pack that teach one of the character\'s skills, each with the id its request must carry and why it is not possible now', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    const before = w.q('rules.training', { actor: w.pc });
    assert.deepEqual(before.offers.map(item => [item.trainer, item.skill, item.fee, item.minutes]), [[ref('mentor'), ref('s00'), 20, 60], [ref('mentor'), ref('s01'), 20, 60], [ref('stormy'), ref('s02'), 5, 60]]);
    assert.ok(before.offers.every(item => item.blocked.includes('The story clock is not set.')));
    assert.ok(before.offers.every(item => /^tr_[0-9a-z]{8}$/.test(item.session) && item.payload.session === item.session && item.payload.actor === w.pc));
    assert.equal(new Set(before.offers.map(item => item.session)).size, 3);
    assert.equal(before.session, null);
    await w.say('Haven.', [`~ time ${START}`, '~ here pack.fixture/mill']);
    const away = offer(w);
    assert.deepEqual(away.blocked, ['Old Brann is not here.', 'It costs 20.']);
    await w.say('Back.', [`~ here ${HAVEN}`]);
    w.host.bus.command('test.coin', { amount: 20 }, { cause: 'ui' });
    assert.deepEqual(offer(w).blocked, []);
    assert.equal(offer(w).session, away.session, 'asking again names the same session: a query assigns nothing');
});

test('skill.train is a request: no fee, no time; refusals for a stranger trainer, a skill not taught, a stale offer, a second request, anyone but the player', async t => {
    const w = await ready(t);
    const item = offer(w);
    const c0 = coin(w);
    const m0 = clock(w);
    assert.equal(w.ui('skill.train', { ...item.payload, session: 'tr_00000000' }).code, 'STALE');
    const out = train(w, item);
    assert.equal(out.ok, true, out.message);
    assert.deepEqual(out.receipt.data.v2.result, { session: item.session, status: 'requested' });
    assert.equal(coin(w), c0);
    assert.equal(clock(w), m0);
    assert.deepEqual(sessions(w)[item.session], { id: item.session, actor: w.pc, skill: ref('s00'), form: ref('s00-base'), trainer: ref('mentor'), status: 'requested', fee: null, startMinute: null, endMinute: null, event: null, reason: null });
    assert.ok(w.head().meta.claims[`rb:ep_00000000:train-request:${item.session}`]);
    assert.equal(w.q('rules.training', { actor: w.pc }).session.status, 'requested');
    const second = offer(w, 'mentor', 's01');
    assert.equal(train(w, second).code, 'REFUSED', 'one waits at a time');
    const ask = over => w.ui('skill.train', { ...second.payload, ...over });
    assert.equal(ask({ trainer: ref('nobody') }).code, 'NOT_FOUND');
    assert.equal(ask({ skill: ref('s02'), form: ref('s02-base') }).code, 'REFUSED', 'Old Brann does not teach it');
    assert.equal(ask({ skill: ref('s10'), form: ref('s10-base') }).code, 'REFUSED', 'not one of her skills');
    assert.equal(ask({ extra: 1 }).code, 'INVALID');
    assert.equal(ask({ session: 'x' }).code, 'INVALID');
    for (const cause of ['story', 'system']) assert.equal(w.host.bus.command('skill.train', second.payload, { cause }).code, 'REFUSED');
    assert.equal(w.q('rules.training', { actor: w.pc }).offers.every(entry => entry.blocked.includes('A training is already waiting.')), true);
});

test('C06 training midnight: day 4 minute 1410, sixty minutes later it is day 5 minute 30; the fee is paid, two credits count on day 5, and the cap of day 5 applies', async t => {
    const w = await ready(t);
    // Day 5 already holds 29 of the character's 30 credits, earned on other skills.
    const others = ['s10', 's11', 's12', 's20', 's21', 's22'];
    let n = 0;
    for (let reply = 0; reply < 5; reply += 1) {
        const lines = [`~ time ${5 * DAY + 100 + reply}`];
        for (const skill of others) if (n < 29) { n += 1; lines.push(`! attempt ${w.pc} | skill: ${skill} | form: ${skill}-base | key: fill${n}`); }
        await w.say(`Day five ${reply}.`, lines);
    }
    assert.equal(Object.values(w.slice('progress').credits).filter(credit => credit.day === 5 && credit.award === 1).length, 29);
    await w.say('Dusk on day four.', [`~ time ${START}`]);
    const item = offer(w);
    assert.equal(train(w, item).ok, true);
    const turns = [];
    w.host.events.on('turn', turn => turns.push(turn));
    await w.say('The lesson.', ['~ here pack.fixture/haven']);
    assert.deepEqual(turns.flatMap(turn => turn.problems), []);
    const session = sessions(w)[item.session];
    assert.deepEqual([session.status, session.fee, session.startMinute, session.endMinute, session.event.template], ['completed', 20, START, START + 60, null]);
    assert.equal(clock(w), 5 * DAY + 30, 'day 5, minute 30');
    assert.equal(coin(w), 80);
    const attempts = Object.entries(w.slice('progress').attempts).filter(([, attempt]) => attempt.session === item.session);
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every(([, attempt]) => attempt.kind === 'training' && attempt.minute === START + 60 && attempt.cost === item.session));
    const awards = attempts.map(([id]) => w.slice('progress').credits[id]).map(credit => [credit.award, credit.reason, credit.day]);
    assert.deepEqual(awards.sort(), [[0, 'actor-day', 5], [1, null, 5]].sort(), 'the cap of day 5 holds the second credit');
    const view = w.q('rules.training', { actor: w.pc });
    assert.equal(view.session.id, item.session);
    assert.deepEqual([view.session.status, view.session.startMinute, view.session.endMinute, view.session.fee, view.session.credits, view.session.creditsAwarded, view.session.reason, view.session.capDay], ['completed', START, START + 60, 20, 2, 1, 'actor-day', 5]);
    // N8: the session keeps what it earned, so its view is the same once the ledger has folded its attempts away.
    assert.deepEqual([session.awarded, session.unearned], [1, 'actor-day']);
    const folded = sessionView(session, { constants: RULES_V2_CONSTANTS, trainer: null, progress: { attempts: {}, credits: {} } });
    assert.deepEqual([folded.creditsAwarded, folded.reason], [1, 'actor-day']);
    const receipt = w.host.ctx.chat.at(-1).extra.storySuite.receipts.find(entry => entry.type === 'rules.settle' && entry.data?.v2?.result?.started?.length);
    assert.deepEqual([receipt.data.v2.result.started, receipt.data.v2.result.completed, receipt.data.v2.result.expired], [[item.session], [item.session], []]);
    assert.equal(receipt.data.v2.result.credited.length, 1);
    assert.deepEqual(w.problems(), []);
    assert.notEqual(offer(w).session, item.session, 'the next session has its own id');
});

test('a session in a day with room earns both credits; the next request is a new session', async t => {
    const w = await ready(t);
    const first = offer(w);
    assert.equal(train(w, first).ok, true);
    await w.say('The lesson.', [`~ here ${HAVEN}`]);
    const view = w.q('rules.training', { actor: w.pc });
    assert.equal(view.session.creditsAwarded, 2);
    assert.equal(w.progress().checklist[0].mastery, 1, 'two credited uses are the first step');
});

test('N2: a request the host cannot start (no clock) waits and blocks the next ask; the player withdraws it, nothing moves, and the next ask is a new session', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    await w.say('No clock yet.', []);
    const item = offer(w);
    assert.equal(train(w, item).ok, true);
    await w.say('Still no clock.', []);
    assert.equal(sessions(w)[item.session].status, 'requested', 'the host waits for the clock');
    assert.equal(train(w, offer(w, 'mentor', 's01')).code, 'REFUSED', 'a waiting request blocks the next');
    const c0 = coin(w);
    assert.equal(w.ui('skill.cancelTrain', { actor: w.pc, session: 'tr_00000000' }).code, 'NOT_FOUND');
    assert.equal(w.ui('skill.cancelTrain', { actor: 'ac_other001', session: item.session }).code, 'NOT_FOUND');
    assert.equal(w.host.bus.command('skill.cancelTrain', { actor: w.pc, session: item.session }, { cause: 'system' }).code, 'REFUSED', 'only the player withdraws');
    const out = w.ui('skill.cancelTrain', { actor: w.pc, session: item.session });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual([sessions(w)[item.session].status, sessions(w)[item.session].reason, sessions(w)[item.session].fee], ['refused', 'The player withdrew the request.', null]);
    assert.equal(coin(w), c0);
    assert.equal(w.ui('skill.cancelTrain', { actor: w.pc, session: item.session }).code, 'NO_LONGER_DONE');
    assert.equal(w.q('rules.training', { actor: w.pc }).session.status, 'refused');
    const again = offer(w);
    assert.notEqual(again.session, item.session);
    assert.equal(train(w, again).ok, true, 'the character may ask again');
    // A rebuild from the log keeps it.
    w.host.store.rebuild();
    assert.equal(sessions(w)[item.session].status, 'refused');
});
