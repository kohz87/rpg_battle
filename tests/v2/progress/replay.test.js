// Deleted-prerequisite replay on the real host (contract §6, B5, fixture C14): a swipe, delete, Re-read or reload
// that removes what a credit or a choice depended on removes what depended on it, with its claim, and
// substitutes nothing; when the prerequisite comes back so does the block. The host asks the guard
// (progress/guard.js) on the state before each block; rules.settle is planned again at its place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR, DAY, grind, nextKey, ref, started, world } from './helpers/world.js';
import { PREREQUISITE_REMOVED } from '../../../src/v2/progress/index.js';
import { promoted } from './helpers/states.js';

const BASE = ['s00-base', 's01-base', 's02-base'].map(ref);
const hashOf = w => w.slice('rules').rulesHash;
const promoteTo = (w, milestone, from, to) => w.ui('class.choose', { actor: ACTOR, milestone, class: ref(to), expectedClass: ref(from), rulesHash: hashOf(w) });
const rbClaims = w => Object.keys(w.head().meta.claims).filter(key => key.startsWith('rb:')).sort();
const choices = w => Object.keys(w.slice('progress').choices).sort();
const credited = w => Object.values(w.slice('progress').credits).filter(credit => credit.award === 1).length;

/** What a player would see and what the chat stores, in one comparable string. */
const snap = w => JSON.stringify({ progress: w.slice('progress'), view: w.progress(), claims: rbClaims(w) });

/** Two strings equal, or a failure that shows only where they first differ (a state is long). */
function same(actual, expected, message) {
    if (actual === expected) return;
    let i = 0;
    while (i < actual.length && actual[i] === expected[i]) i += 1;
    assert.fail(`${message}: they differ at ${i}\n  now:    …${actual.slice(Math.max(0, i - 100), i + 160)}\n  wanted: …${expected.slice(Math.max(0, i - 100), i + 160)}`);
}

/** The live state is what a cold rebuild gives. */
function sameAfterRebuild(w, when = '') {
    const live = snap(w);
    const problems = JSON.stringify(w.problems());
    w.host.store.rebuild();
    same(snap(w), live, `${when}: live differs from a rebuild`);
    same(JSON.stringify(w.problems()), problems, `${when}: the problems differ after a rebuild`);
}

// Six attempts, one for each of six skills: the reply caps (2 a skill, 6 in all) do not bind, the day caps do.
const SIX = ['s00', 's01', 's02', 's10', 's11', 's12'];
const sixAttempts = () => SIX.map(skill => `! attempt ${ACTOR} | skill: ${skill} | form: ${skill}-base | key: ${nextKey()}`);

const drop = async (w, index) => {
    await w.host.st.deleteMessage(index);
    await w.host.st.deleteMessage(index - 1);
};
const at = (w, text) => w.host.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));

/** A character promoted to class 1: an XP reply (marked), practice replies and the click. */
async function promotedOnce(t) {
    const w = await started(t);
    await w.say('Years pass.', [`! xp ${ACTOR} | n: 1000`]);
    const xp = w.host.ctx.chat.length - 1;
    const day = await grind(w, { forms: BASE });
    const result = await promoteTo(w, 10, 'c0', 'c1');
    assert.equal(result.ok, true, result.message);
    assert.equal(w.progress().class, ref('c1'));
    return { w, xp, day };
}

test('C14: deleting the reply that gave the XP takes the promotion, its claim and its swap with it, and picks nothing instead', async t => {
    const { w, xp } = await promotedOnce(t);
    assert.deepEqual(choices(w), [`${ACTOR}|0`, `${ACTOR}|10`]);
    await drop(w, xp);
    assert.deepEqual(choices(w), [`${ACTOR}|0`], 'the choice is not applied');
    assert.equal(rbClaims(w).some(key => key.includes(':class:') && key.endsWith(':10')), false, 'nor its claim');
    const view = w.progress();
    assert.equal(view.class, ref('c0'), 'the basic class and its three skills, 5/5 as they were');
    assert.deepEqual(view.checklist.map(item => item.mastery), [5, 5, 5]);
    assert.equal(view.level, 1);
    assert.deepEqual(view.promotions, []);
    const problems = w.problems();
    assert.equal(problems.length, 1);
    assert.equal(problems[0].code, 'REPLAY_PREREQUISITE');
    assert.ok(problems[0].why.includes(PREREQUISITE_REMOVED), problems[0].why);
    assert.match(problems[0].why, /Level 10 is needed/);
    // It is stored, not lost: the reply still holds the block.
    const stored = w.host.ctx.chat.at(-1).extra.storySuite;
    assert.ok(stored.spans.some(span => span.guard?.predicate?.kind === 'class.choose'));
    sameAfterRebuild(w, 'after the delete');
});

test('C14: the contract\'s message and code for a stored choice that is off', async t => {
    const { w, xp } = await promotedOnce(t);
    await drop(w, xp);
    const [problem] = w.problems();
    const fixture = { ok: false, code: 'REPLAY_PREREQUISITE', message: 'The earlier prerequisite was removed.' };
    assert.equal(problem.code, fixture.code);
    assert.ok(problem.why.includes(fixture.message));
});

test('deleting a reply that made a skill 5/5 takes the promotion: 33 uses are 4/5, and the later credits are planned again, not lost', async t => {
    const { w } = await promotedOnce(t);
    const before = credited(w);
    assert.equal(before, 105);
    await drop(w, at(w, 'Practice 4.'));
    assert.deepEqual(choices(w), [`${ACTOR}|0`]);
    assert.equal(credited(w), 105 - 6, 'one reply\'s six credits are gone, every other one stands');
    assert.deepEqual(w.progress().checklist.map(item => item.mastery), [4, 4, 4]);
    assert.equal(w.progress().promotions[0].eligible, false);
    assert.match(w.problems().map(p => p.why).join(' '), /5\/5/);
    assert.deepEqual(w.problems().map(p => p.code), ['REPLAY_PREREQUISITE']);
    sameAfterRebuild(w, 'after the delete');
});

test('a Re-read that removes the practice takes the promotion; a Re-read that puts it back brings the promotion back', async t => {
    const { w } = await promotedOnce(t);
    const target = at(w, 'Practice 4.');
    const message = w.host.ctx.chat[target];
    const original = message.mes;
    const stripped = original.split('\n\n<!--')[0];
    message.mes = stripped;
    message.swipes[message.swipe_id] = stripped;
    assert.equal((await w.host.turn.reread(target)).ok, true);
    assert.deepEqual(choices(w), [`${ACTOR}|0`]);
    assert.equal(rbClaims(w).some(key => key.endsWith(`:class:${ACTOR}:10`)), false);
    assert.equal(w.problems()[0].code, 'REPLAY_PREREQUISITE');
    sameAfterRebuild(w, 'with the practice gone');
    // Put the same lines back: the stored click is asked again and holds.
    message.mes = original;
    message.swipes[message.swipe_id] = original;
    assert.equal((await w.host.turn.reread(target)).ok, true);
    assert.deepEqual(choices(w), [`${ACTOR}|0`, `${ACTOR}|10`]);
    assert.deepEqual(w.problems(), []);
    assert.equal(w.progress().class, ref('c1'));
    sameAfterRebuild(w, 'with the practice back');
});

test('a Re-read that changes nothing leaves every credit and choice exactly as it was', async t => {
    const { w } = await promotedOnce(t);
    const before = snap(w);
    for (const text of ['Practice 0.', 'Practice 9.', 'Practice 17.', 'Years pass.']) {
        const result = await w.host.turn.reread(at(w, text));
        assert.equal(result.ok, true, result.message);
        same(snap(w), before, `re-reading "${text}"`);
    }
    assert.deepEqual(w.problems(), []);
});

test('a reload of the chat keeps the promotion', async t => {
    const { w } = await promotedOnce(t);
    const before = snap(w);
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    same(snap(w), before, 'after the reload');
    assert.deepEqual(w.problems(), []);
});

test('a zero-credit becomes a credit when an earlier reply is deleted: the settlement is planned again at its place', async t => {
    const w = await started(t);
    // Day 1: five replies of six credits fill the character's 30 for the day; the sixth earns nothing.
    for (let n = 0; n < 6; n += 1) await w.say(`Round ${n}.`, [`~ time ${DAY + 600}`, ...sixAttempts()]);
    const credits = () => Object.values(w.slice('progress').credits);
    assert.equal(credits().filter(credit => credit.award === 1).length, 30);
    const zero = credits().filter(credit => credit.award === 0);
    assert.equal(zero.length, 6);
    assert.ok(zero.every(credit => credit.reason === 'actor-day'));
    assert.deepEqual(w.problems(), []);
    await drop(w, at(w, 'Round 0.'));
    assert.equal(credits().length, 30, 'five replies of six attempts remain');
    assert.equal(credits().filter(credit => credit.award === 1).length, 30, 'the sixth reply\'s attempts now fit the day');
    assert.equal(credits().filter(credit => credit.award === 0).length, 0);
    assert.deepEqual(w.problems(), [], 'planned again, not turned off');
    assert.equal(Object.keys(w.slice('progress').credits).length, Object.keys(w.slice('progress').attempts).length);
    // One credit, one claim.
    assert.equal(rbClaims(w).filter(key => key.includes(':credit:')).length, 30);
    sameAfterRebuild(w, 'after the delete');
});

test('a credit becomes a zero when the clock of a reply moves it into a full day', async t => {
    const w = await started(t);
    for (let n = 0; n < 5; n += 1) await w.say(`Day one ${n}.`, [`~ time ${DAY + 100 + n}`, ...sixAttempts()]);
    await w.say('Day two.', [`~ time ${2 * DAY + 100}`, ...sixAttempts()]);
    assert.equal(credited(w), 36, 'a new story day has its own room');
    // Edit the last reply's clock to day one: it is the sixth reply of that day, so it earns nothing now.
    const index = at(w, 'Day two.');
    const message = w.host.ctx.chat[index];
    const moved = message.mes.replace(`~ time ${2 * DAY + 100}`, `~ time ${DAY + 200}`);
    message.mes = moved;
    message.swipes[message.swipe_id] = moved;
    assert.equal((await w.host.turn.reread(index)).ok, true);
    assert.equal(credited(w), 30);
    assert.deepEqual(Object.values(w.slice('progress').credits).filter(credit => credit.award === 0).map(credit => credit.reason), Array(6).fill('actor-day'));
    sameAfterRebuild(w, 'after the edit');
    // And back: the next day has room again.
    message.mes = moved.replace(`~ time ${DAY + 200}`, `~ time ${2 * DAY + 100}`);
    message.swipes[message.swipe_id] = message.mes;
    assert.equal((await w.host.turn.reread(index)).ok, true);
    assert.equal(credited(w), 36);
    assert.deepEqual(w.problems(), []);
});

test('no clock holds the credits; the clock set earlier at the same place releases them (time is never taken from a wall clock)', async t => {
    const w = await started(t);
    const key = nextKey();
    await w.say('Before the clock.', [`! attempt ${ACTOR} | skill: s00 | form: s00-base | key: ${key}`]);
    const [held] = Object.values(w.slice('progress').credits);
    assert.deepEqual(held, { award: 0, reason: 'clock', minute: null, day: null, reply: held.reply });
    assert.equal(Object.keys(w.slice('progress').attempts).length, 1, 'the attempt is on the ledger');
    const index = at(w, 'Before the clock.');
    const message = w.host.ctx.chat[index];
    const edited = message.mes.replace('<Changes>\n', `<Changes>\n~ time ${3 * DAY + 5}\n`);
    message.mes = edited;
    message.swipes[message.swipe_id] = edited;
    assert.equal((await w.host.turn.reread(index)).ok, true);
    assert.deepEqual(Object.values(w.slice('progress').credits).map(credit => [credit.award, credit.day, credit.minute]), [[1, 3, 3 * DAY + 5]]);
    // And the other way: the clock line taken out again holds it.
    message.mes = message.mes.replace(`~ time ${3 * DAY + 5}\n`, '');
    message.swipes[message.swipe_id] = message.mes;
    assert.equal((await w.host.turn.reread(index)).ok, true);
    assert.deepEqual(Object.values(w.slice('progress').credits).map(credit => [credit.award, credit.reason]), [[0, 'clock']]);
    sameAfterRebuild(w, 'with the clock gone');
});

test('the promotions after a promotion go when the first one does: 20 needs 10, and nothing is picked in their place', async t => {
    const w = await started(t);
    await w.say('Years pass.', [`! xp ${ACTOR} | n: 3000`]);
    const day = await grind(w, { forms: BASE });
    const first = at(w, 'Practice 3.');
    assert.equal((await promoteTo(w, 10, 'c0', 'c1')).ok, true);
    await grind(w, { forms: ['s10-base', 's11-base', 's12-base'].map(ref), day: day + 2 });
    assert.equal((await promoteTo(w, 20, 'c1', 'c2')).ok, true);
    assert.deepEqual(choices(w), [`${ACTOR}|0`, `${ACTOR}|10`, `${ACTOR}|20`]);
    assert.equal(w.progress().class, ref('c2'));
    await drop(w, first);
    assert.deepEqual(choices(w), [`${ACTOR}|0`], 'neither is applied');
    assert.equal(w.progress().class, ref('c0'));
    assert.equal(w.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length >= 2, true);
    assert.deepEqual(rbClaims(w).filter(key => key.includes(':class:')), [`rb:ep_00000001:class:${ACTOR}:0`]);
    sameAfterRebuild(w, 'after the delete');
});

test('C05: the reply that took the step at 40 deleted, the choice at 50 built on it is off (a missing parent invalidates the choice)', async t => {
    const w = await world(t);
    await w.say('Dawn.');
    for (const [type, payload] of [['test.pin', {}], ['tp.add', { id: ACTOR, name: 'Astra' }], ['test.seed', { choices: promoted(), uses: { [ref('s30-base')]: 35, [ref('s31-base')]: 35, [ref('s32-base')]: 35 } }]]) {
        assert.equal(w.host.bus.command(type, payload, { cause: 'ui' }).ok, true);
    }
    await w.say('Years pass.', [`! xp ${ACTOR} | n: 5000`]);
    const path = (milestone, skill, from, option) => w.ui('path.choose', { actor: ACTOR, milestone, skill: ref(skill), fromForm: ref(from), option: ref(option), rulesHash: hashOf(w) });
    assert.equal((await path(40, 's30', 's30-base', 's30-base-a')).ok, true);
    const stepReply = w.host.ctx.chat.length - 1;
    const day = await grind(w, { forms: [ref('s30-base-a')], day: 30 });
    assert.equal(day > 30, true);
    const second = await path(50, 's30', 's30-base-a', 's30-base-a-g');
    assert.equal(second.ok, true, second.message);
    assert.equal(w.progress().checklist[0].form, ref('s30-base-a-g'));
    await drop(w, stepReply);
    assert.deepEqual(choices(w), promoted().map(c => `${c.actor}|${c.milestone}`).sort());
    assert.equal(w.progress().checklist[0].form, ref('s30-base'), 'the skill is back on its base form, not on a form without its parent');
    // The reply with the 40 step is gone with its block; the 50 step stays stored but off, and holds no claim.
    const problems = w.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE');
    assert.equal(problems.length, 1);
    assert.match(problems[0].why, /40 path comes first/);
    assert.deepEqual(rbClaims(w).filter(key => key.includes(':path:')), []);
    sameAfterRebuild(w, 'after the delete');
});

test('with the choice\'s own reply gone its claim is free: the player can choose again', async t => {
    const { w } = await promotedOnce(t);
    await w.say('Later.');
    await drop(w, w.host.ctx.chat.length - 1);
    assert.equal(w.progress().class, ref('c1'), 'the click was on the practice reply and is still there');
    const practice = at(w, 'Practice 17.');
    await drop(w, practice);
    assert.deepEqual(choices(w), [`${ACTOR}|0`], 'the click went with the reply it was on');
    assert.equal(rbClaims(w).some(key => key.endsWith(':class:ac_00000001:10')), false);
});

test('a swipe of the reply the choice was made on takes the choice and its claim; the choice can be made again on the new swipe', async t => {
    const { w } = await promotedOnce(t);
    await w.host.swipe('A different practice, with nothing in it.');
    assert.deepEqual(choices(w), [`${ACTOR}|0`], 'the new swipe has no click');
    assert.equal(rbClaims(w).some(key => key.endsWith(':class:ac_00000001:10')), false);
    assert.equal(w.progress().class, ref('c0'));
    assert.deepEqual(w.progress().checklist.map(item => item.mastery), [4, 4, 4], 'the swiped reply had the last credit of each skill')
    sameAfterRebuild(w, 'after the swipe');
});

test('more than 200 replies later the promotion and the credits are still true to the chat (receipt data is trimmed, the blocks are not)', async t => {
    const { w } = await promotedOnce(t);
    const before = snap(w);
    for (let n = 0; n < 205; n += 1) await w.say(`Filler ${n}.`);
    assert.ok(w.host.ctx.chat.length > 400);
    same(snap(w), before, 'after 205 replies');
    sameAfterRebuild(w, 'after 205 replies');
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    same(snap(w), before, 'after the reload');
    assert.deepEqual(w.problems(), []);
});
