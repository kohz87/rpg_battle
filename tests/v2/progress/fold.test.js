// The ledger stays bounded (progress/fold.js, docs/dev/progress.md): settled attempts fold into sealed counts without moving any
// number derived from them, the fold follows a deleted reply, and a payer never fails on the ledger's size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR, DAY, nextKey, ref, started } from './helpers/world.js';
import { FOLD_AT, applyFold, foldInputs, planFold } from '../../../src/v2/progress/fold.js';
import { RULES_V2_CONSTANTS } from '../../vendor/story-block/src/v2/packs/rules-v2.js';
import { decide, rowsOf, tallyOf, tallyOfProgress, usesOf } from '../../../src/v2/progress/credit.js';
import { MAX_ATTEMPTS, progressProblems } from '../../../src/v2/progress/domain.js';

const SR = n => `sr_${String(n).padStart(8, '0')}`;
const AT = n => `at_${String(n).padStart(8, '0')}`;
const src = n => ({ sid: SR(n), swipeKey: `sw_${String(n).padStart(8, '0')}`, evidence: `ev_${String(n).padStart(8, '0')}` });
const one = (n, over = {}) => ({ actor: ACTOR, skill: ref('s00'), form: ref('s00-base'), kind: 'narrative', source: src(n), capSource: src(n), cost: null, session: null, minute: null, ...over });
const credit = (n, award = 1, day = 3) => ({ award, reason: award ? null : 'skill-day', minute: day * DAY + 5, day, reply: SR(n) });

function ledger(count, { waiting = [] } = {}) {
    const progress = { schema: 2, choices: {}, attempts: {}, credits: {}, roster: { active: null }, temporary: {}, sealed: { forms: {}, days: {}, folded: 0 } };
    for (let n = 1; n <= count; n += 1) {
        progress.attempts[AT(n)] = one(n, { form: ref(n % 2 ? 's00-base' : 's01-base'), skill: ref(n % 2 ? 's00' : 's01') });
        if (!waiting.includes(n)) progress.credits[AT(n)] = credit(n, n % 5 === 0 ? 0 : 1, 3 + (n % 3));
    }
    return progress;
}

test('a small ledger is not folded; a large one folds the settled attempts of other replies and nothing else', () => {
    assert.equal(planFold(ledger(FOLD_AT), [], SR(1)), null);
    const big = ledger(FOLD_AT + 50, { waiting: [7] });
    const fold = planFold(big, [], SR(FOLD_AT + 50));
    assert.ok(fold.ids.length > 0);
    assert.ok(!fold.ids.includes(AT(FOLD_AT + 50)), 'the reply that settles keeps its own attempts');
    assert.ok(!fold.ids.includes(AT(7)), 'a waiting attempt is not folded');
    assert.deepEqual(fold.ids, [...fold.ids].sort());
    assert.equal(fold.ids.length, FOLD_AT + 50 - 2, 'every settled one but the settling reply\'s and the waiting one');
    // Only the credited ones count, as the live tally counts them.
    const credited = fold.ids.filter(id => big.credits[id].award === 1).length;
    assert.equal(Object.values(fold.forms).reduce((a, b) => a + b, 0), credited);
    assert.equal(Object.values(fold.days).reduce((a, b) => a + b, 0), credited);
});

test('N5: the fold writes totals (base + n), so the guard carries the totals it was planned on: other totals, other inputs', () => {
    const big = ledger(FOLD_AT + 50);
    const one1 = planFold(big, [], SR(FOLD_AT + 50));
    assert.ok(Object.keys(one1.base.forms).length > 0 && Object.values(one1.base.forms).every(n => n === 0));
    const other = structuredClone(big);
    const key = Object.keys(one1.forms)[0];
    other.sealed.forms[key] = 7;
    const two = planFold(other, [], SR(FOLD_AT + 50));
    assert.equal(two.base.forms[key], 7);
    assert.notDeepEqual(foldInputs(one1), foldInputs(two));
    const draft = structuredClone(other);
    applyFold(draft, two);
    assert.equal(draft.sealed.forms[key], 7 + two.forms[key]);
    assert.equal(foldInputs(null), null);
});

test('a waiting attempt keeps its whole reply\'s rows: the reply caps are still counted from them', () => {
    const big = ledger(FOLD_AT + 10);
    big.attempts[AT(1000)] = one(3, { form: ref('s00-base') });   // a held attempt of reply 3, with no credit
    const fold = planFold(big, [], SR(FOLD_AT + 10));
    assert.ok(!fold.ids.includes(AT(3)), 'reply 3 has one waiting, so its credited attempt stays');
});

test('folding moves no number: the tally of the rows and the sealed counts is the tally of all the rows', () => {
    const big = ledger(FOLD_AT + 80);
    const before = tallyOfProgress(big);
    const fold = planFold(big, [], SR(FOLD_AT + 80));
    const draft = structuredClone(big);
    applyFold(draft, fold);
    const after = tallyOfProgress(draft);
    for (const name of ['formUses', 'skillDay', 'actorDay']) assert.deepEqual([...after[name]].sort(), [...before[name]].sort(), name);
    assert.equal(Object.keys(draft.attempts).length, 1, 'the rows of the folded ones are gone; the settling reply\'s own stay');
    assert.equal(draft.sealed.folded, FOLD_AT + 79);
    assert.deepEqual(progressProblems(draft), []);
    assert.equal(usesOf(tallyOf(rowsOf(draft), draft.sealed), ACTOR, ref('s00-base')), usesOf(before, ACTOR, ref('s00-base')));
    // Folding again changes nothing more until it grows again.
    assert.equal(planFold(draft, [], SR(FOLD_AT + 80)), null);
});

test('the sealed counts are held to their shape', () => {
    const bad = patch => progressProblems({ ...ledger(1), sealed: { forms: {}, days: {}, folded: 0, ...patch } }).length;
    assert.equal(bad({}), 0);
    assert.ok(bad({ forms: { 'ac_00000001': 3 } }), 'a form key is actor|form');
    assert.ok(bad({ days: { 'ac_00000001|x': 3 } }), 'a day key is actor|skill|day');
    assert.ok(bad({ forms: { 'a|b': 0 } }));
    assert.ok(bad({ folded: -1 }));
    assert.ok(progressProblems({ ...ledger(1), sealed: null }).length);
});

const TEN = ['s00', 's01', 's02', 's10', 's11', 's12', 's20', 's21', 's22', 's30'].map(skill => ref(`${skill}-base`));
const snapshot = w => JSON.stringify({ progress: w.slice('progress'), view: w.progress() });

test('on the host: 350 settled uses fold at the next settlement, the character\'s masteries are the same, and the state is a rebuild\'s', async t => {
    const w = await started(t);
    await w.say('The long years.', [`~ time ${40 * DAY + 600}`]);
    const uses = Object.fromEntries(TEN.map(form => [form, 35]));
    assert.equal(w.host.bus.command('test.seed', { uses }, { cause: 'ui' }).ok, true);
    assert.equal(Object.keys(w.slice('progress').attempts).length, 350);
    const view = w.progress();
    const masteries = view.checklist.map(item => [item.skill, item.mastery, item.uses]);
    await w.say('One more.', [`! attempt ${ACTOR} | skill: s00 | form: s00-base | key: ${nextKey()}`]);
    const progress = w.slice('progress');
    assert.equal(Object.keys(progress.attempts).length, 1, 'only the settling reply\'s own attempt is left');
    assert.equal(progress.sealed.folded, 350);
    assert.equal(Object.keys(progress.sealed.forms).length, 10);
    assert.deepEqual(w.progress().checklist.map(item => [item.skill, item.mastery, item.uses]), masteries, 'the masteries are the same');
    assert.deepEqual(w.problems(), []);
    const live = snapshot(w);
    w.host.store.rebuild();
    assert.equal(snapshot(w), live);
});

test('the day caps still count what was folded: the sealed uses of a day are spent room', () => {
    const constants = { ...RULES_V2_CONSTANTS };
    const sealed = { forms: { [`${ACTOR}|${ref('s00-base')}`]: 12 }, days: { [`${ACTOR}|${ref('s00')}|3`]: 10, [`${ACTOR}|${ref('s01')}|3`]: 20 }, folded: 30 };
    const tally = tallyOf([], sealed);
    assert.equal(usesOf(tally, ACTOR, ref('s00-base')), 12);
    assert.equal(tally.skillDay.get(`${ACTOR}|${ref('s00')}|3`), 10);
    assert.equal(tally.actorDay.get(`${ACTOR}|3`), 30, 'the actor\'s day is the sum of its skills');
    const skillDay = decide(constants, tally, one(1), 3 * DAY + 5);
    assert.deepEqual([skillDay.award, skillDay.reason], [0, 'skill-day']);
    const actorDay = decide(constants, tally, one(1, { skill: ref('s02'), form: ref('s02-base') }), 3 * DAY + 5);
    assert.deepEqual([actorDay.award, actorDay.reason], [0, 'actor-day']);
    assert.equal(decide(constants, tally, one(1), 4 * DAY + 5).award, 1, 'another day has room');
});

test('the fold follows a deleted reply: the settlement is planned again without the attempts that reply held', async t => {
    const w = await started(t);
    await w.say('Clock.', [`~ time ${40 * DAY + 600}`]);
    await w.say('The seed reply.');
    const seedIndex = w.host.ctx.chat.length - 1;
    assert.equal(w.host.bus.command('test.seed', { uses: Object.fromEntries(TEN.map(form => [form, 35])) }, { cause: 'ui' }).ok, true);
    await w.say('One more.', [`! attempt ${ACTOR} | skill: s00 | form: s00-base | key: ${nextKey()}`]);
    assert.equal(w.slice('progress').sealed.folded, 350);
    // The reply that held the seeded uses goes (and the player message before it): nothing of them may stay in the sealed counts.
    await w.host.st.deleteMessage(seedIndex);
    await w.host.st.deleteMessage(seedIndex - 1);
    const after = w.slice('progress');
    assert.equal(after.sealed.folded, 0);
    assert.deepEqual(after.sealed, { forms: {}, days: {}, folded: 0 });
    assert.equal(Object.keys(after.attempts).length, 1);
    assert.deepEqual(w.problems().filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), []);
    const live = snapshot(w);
    w.host.store.rebuild();
    assert.equal(snapshot(w), live, 'a rebuild gives the same');
});

test('a payer never fails on size: an attempt that cannot earn is not kept, and past the hard limit none is kept, neither is an error', async t => {
    const w = await started(t);
    await w.say('Clock.', [`~ time ${2 * DAY + 600}`]);
    const record = key => w.host.bus.command('test.attempt', { actor: ACTOR, skill: ref('s00'), form: ref('s00-base'), kind: 'combat', key }, { cause: 'ui' });
    assert.equal(record('a').receipt.data.created, true);
    assert.equal(record('b').receipt.data.created, true);
    const third = record('c');
    assert.equal(third.ok, true, 'not an error');
    assert.equal(third.receipt.data.created, false);
    assert.equal(third.receipt.data.dropped, true);
    assert.equal(Object.keys(w.slice('progress').attempts).length, 2);
    // A training attempt counts on its own day and is never judged by the reply rule.
    assert.equal(w.host.bus.command('test.attempt', { actor: ACTOR, skill: ref('s00'), form: ref('s00-base'), kind: 'training', key: 't1', minute: 5 * DAY + 30, session: 'tr_00000001', cost: 'wp_00000001' }, { cause: 'ui' }).receipt.data.created, true);
});

test('at the hard limit a payer still succeeds: nothing is kept and nothing fails', async t => {
    const w = await started(t);
    await w.say('Clock.', [`~ time ${2 * DAY + 600}`]);
    assert.equal(w.host.bus.command('test.seed', { uses: { [ref('s00-base')]: MAX_ATTEMPTS } }, { cause: 'ui' }).ok, true);
    assert.equal(Object.keys(w.slice('progress').attempts).length, MAX_ATTEMPTS);
    const out = w.host.bus.command('test.attempt', { actor: ACTOR, skill: ref('s01'), form: ref('s01-base'), kind: 'combat', key: 'late' }, { cause: 'ui' });
    assert.equal(out.ok, true, out.message);
    assert.equal(out.receipt.data.dropped, true);
    assert.equal(Object.keys(w.slice('progress').attempts).length, MAX_ATTEMPTS);
});

test('a key recorded again after its attempt was folded is the same attempt, not a new one, and no later settlement is wedged by it', async t => {
    const w = await started(t);
    const rec = key => w.host.bus.command('test.attempt', { actor: ACTOR, skill: ref('s00'), form: ref('s00-base'), kind: 'combat', key }, { cause: 'ui' });
    await w.say('Clock.', [`~ time ${40 * DAY + 600}`]);
    assert.equal(rec('x').receipt.data.created, true);
    await w.say('x is credited.', [`! xp ${ACTOR} | n: 1`]);
    assert.equal(Object.keys(w.slice('progress').credits).length, 1);
    assert.equal(w.host.bus.command('test.seed', { uses: Object.fromEntries(TEN.map(form => [form, 35])) }, { cause: 'ui' }).ok, true);
    assert.equal(rec('z').receipt.data.created, true);
    await w.say('The fold.', [`! xp ${ACTOR} | n: 1`]);
    assert.ok(w.slice('progress').sealed.folded >= 351, 'x was folded with the rest');
    const again = rec('x');
    assert.equal(again.ok, true, again.message);
    assert.equal(again.receipt.data.created, false, 'a folded attempt is not recorded again under its key');
    assert.equal(rec('w').receipt.data.created, true);
    await w.say('w is credited.', [`! xp ${ACTOR} | n: 1`]);
    assert.deepEqual(w.problems(), []);
    assert.equal(Object.values(w.slice('progress').credits).length >= 1, true);
});
