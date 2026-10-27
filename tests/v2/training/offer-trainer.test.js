// A teacher the story offers in its own words (GENERATIVE_OFFERS_SPEC §5.6, §7.2) on the fixture pack with one open template, Drills (fee 10 to 40):
// `trainer.offer` wraps the unchanged `planTrainer`; a written fee that stood or was held is recorded with the offer (`feeBy: 'said'`) and held to the
// template's range on replay; a fee far above it is no offer. Delete, swipe, Re-read, rebuild and reload as for `trainer.open`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../integration/helpers/host.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { replayTrainerOffer } from '../../../src/v2/training/offer-capture.js';
import { HAVEN, MILL, at, coin, drop, offers, only, ready, rowOf, sessions } from './helpers/open.js';

const LINE = '+ trainer Old Reka — drills';
const free = (t, options = {}) => ready(t, { strict: false, ...options });
const spans = w => w.host.ctx.chat.flatMap(message => message.extra?.storySuite?.spans ?? []).filter(span => span.guard?.predicate?.kind === 'trainer.offer');
const tailOf = w => w.host.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).at(-1)?.value ?? '';
const declined = w => Object.values(w.slice('rules').declined ?? {});

test('a free-form line offers a teacher: the template matched by its words, the fee from the recorded die, trainer.offer guarding the reply', async t => {
    await seeded(4101, async () => {
        const w = await free(t, { coin: 100 });
        await w.say('Old Reka offers drills.', [LINE]);
        const offer = only(w);
        assert.deepEqual([offer.by, offer.template, offer.place, offer.name], ['story', 'pack.fixture/drills', HAVEN, 'Old Reka']);
        assert.ok(offer.fee >= 10 && offer.fee <= 40);
        assert.deepEqual([offer.settled.band, offer.settled.matcher, offer.settled.notes, offer.settled.feeBy], ['within', 1, [], undefined]);
        assert.equal(offer.settled.sid, spans(w)[0].source.sid);
        assert.match(offer.settled.line, /^[0-9a-f]{16}$/);
        const [span] = spans(w);
        assert.equal(span.guard.replyBound, true);
        assert.equal(span.recorded.feeBy, undefined);
        assert.equal(w.host.ctx.chat.flatMap(message => message.extra?.storySuite?.spans ?? []).some(item => item.guard?.predicate?.kind === 'trainer.open'), false);
        assert.deepEqual(w.host.store.problems(), []);
        assert.deepEqual(w.host.turn.problems(), []);
        // A lesson is the same as for a trainer made the 2.2.0 way.
        assert.equal(w.ui('skill.train', rowOf(w, offer.id).payload).ok, true);
        await w.say('The lesson.', [`~ here ${HAVEN}`]);
        assert.equal(Object.values(sessions(w))[0].status, 'completed');
        assert.equal(coin(w), 100 - offer.fee);
    });
});

test('the receipt is told as in 2.2.0; a written fee that stood adds "(fee as agreed)"', async t => {
    await seeded(4102, async () => {
        const w = await free(t, { coin: 100 });
        await w.say('Old Reka offers drills.', [`${LINE} | fee: 25`]);
        const offer = only(w);
        assert.equal(offer.fee, 25);
        assert.equal(offer.settled.feeBy, 'said');
        await w.say('Quiet.');
        assert.match(tailOf(w), /Old Reka will teach .* for 25 .* a session\. \(fee as agreed\)/);
        assert.equal(spans(w)[0].recorded.feeBy, 'said');
        assert.equal(spans(w)[0].recorded.fee, 25);
    });
});

test('a fee outside the range is held (moderate, a card note, no "as agreed"); one far above it is no offer and is told once', async t => {
    await seeded(4103, async () => {
        const w = await free(t, { present: ['Old Reka', 'Zed', 'Mia'] });
        await w.say('Old Reka offers cheap drills.', [`${LINE} | fee: 5`]);
        const reka = Object.values(offers(w)).find(offer => offer.name === 'Old Reka');
        assert.deepEqual([reka.fee, reka.settled.band, reka.settled.feeBy], [10, 'moderate', 'said']);
        assert.equal(reka.settled.notes.length, 1);
        assert.match(reka.settled.notes[0], /^fee set to /);
        await w.say('Quiet.');
        assert.doesNotMatch(tailOf(w), /fee as agreed/);
        await w.say('Zed wants a fortune.', ['+ trainer Zed — drills | fee: 200']);
        assert.equal(Object.values(offers(w)).some(offer => offer.name === 'Zed'), false);
        assert.deepEqual(declined(w).map(row => [row.name, row.band]), [['Zed', 'far']]);
        assert.deepEqual(w.host.turn.problems(), []);
        await w.say('Quiet.');
        assert.match(tailOf(w), /Earlier, Zed was mentioned as a job, but it isn't one that can be offered here \(a fee of 200 .* is far above Drills: 40 .* at most\)\./);
        await w.say('Later.');
        assert.equal(tailOf(w).includes('Earlier, Zed'), false);
        await w.say('Mia wants a horse.', ['+ trainer Mia — drills | fee: a fine horse']);
        const mia = Object.values(offers(w)).find(offer => offer.name === 'Mia');
        assert.deepEqual([mia.settled.band, mia.settled.feeBy, mia.fee >= 10 && mia.fee <= 40], ['moderate', undefined, true], 'a fee code cannot read is the rolled one');
    });
});

test('a teacher no template teaches is a Problem; a bare line about a far-out name is quiet', async t => {
    await seeded(4104, async () => {
        const w = await free(t, { present: ['Old Reka', 'Old Pell'] });
        await w.say('Old Pell fishes.', ['+ trainer Old Pell — fishing and net mending']);
        assert.deepEqual(offers(w), {});
        assert.match(JSON.stringify(w.host.turn.problems()), /Trainer refused/);
        await w.say('Zed wants a fortune.', ['+ trainer Zed — drills | fee: 200']);
        const before = w.host.turn.problems().length;
        await w.say('Zed again.', ['+ trainer Zed']);
        assert.equal(w.host.turn.problems().length, before, 'no noise');
        assert.deepEqual(Object.values(offers(w)), []);
    });
});

test('the same name at the same place is a quiet no-op, elsewhere it is far out, a fixed trainer\'s name is quiet', async t => {
    await seeded(4105, async () => {
        const w = await free(t, { coin: 100 });
        await w.say('Old Reka offers drills.', [LINE]);
        const first = structuredClone(only(w));
        await w.say('Again.', [LINE]);
        assert.deepEqual(only(w), first);
        assert.deepEqual(w.host.turn.problems(), []);
        await w.say('To the mill.', [`~ here ${MILL}`, LINE]);
        assert.deepEqual(only(w), first, 'a trainer stays where it was offered');
        assert.deepEqual(declined(w).map(row => row.name), ['Old Reka']);
        await w.say('Quiet.');
        assert.match(tailOf(w), /Old Reka already teaches at pack\.fixture\/haven/);
        await w.say('Old Brann.', ['+ trainer Old Brann — drills']);
        assert.equal(Object.values(offers(w)).length, 1);
        assert.deepEqual(w.host.turn.problems(), []);
    });
});

test('delete, swipe, Re-read, rebuild and reload: the offer and the fee come back as recorded and nothing is rolled again', async t => {
    await seeded(4106, async () => {
        const w = await free(t, { coin: 100 });
        await w.say('Old Reka offers drills.', [`${LINE} | fee: 25`]);
        const offer = structuredClone(only(w));
        const index = at(w, 'Old Reka offers drills.');
        // Re-read, unchanged: the same id, die and fee, and the settled binding of the stored record.
        assert.equal((await w.host.turn.reread(index)).ok, true);
        assert.deepEqual(only(w), offer);
        // Rebuild and reload.
        const live = JSON.stringify(w.head());
        w.host.store.rebuild();
        assert.equal(JSON.stringify(w.head()), live);
        await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
        assert.equal(JSON.stringify(w.head()), live);
        assert.deepEqual(w.host.store.problems(), []);
        // Swipe away and back.
        const last = w.host.ctx.chat.length - 1;
        await w.host.swipe('Nobody offers anything.');
        assert.deepEqual(offers(w), {});
        await w.host.st.swipeTo(last, 0);
        assert.deepEqual(only(w), offer);
        // Edited, read again: a new line, a new offer.
        const message = w.host.ctx.chat[index];
        message.mes = message.mes.replace('fee: 25', 'fee: 30');
        message.swipes[message.swipe_id] = message.mes;
        assert.equal((await w.host.turn.reread(index)).ok, true);
        assert.equal(only(w).fee, 30);
        assert.notEqual(only(w).id, offer.id);
        // Delete the reply: the offer goes.
        await drop(w, index);
        assert.deepEqual(offers(w), {});
        assert.deepEqual(w.host.store.problems(), []);
    });
});

test('the trainer.offer guard asks no query and holds a written fee to the template\'s range', async t => {
    await seeded(4107, async () => {
        const w = await free(t);
        const before = structuredClone(w.head());
        await w.say('Old Reka offers drills.', [`${LINE} | fee: 25`]);
        const [span] = spans(w);
        const ask = (over = {}) => replayTrainerOffer({ state: over.state ?? before, hash: hashJson }, { guard: over.guard ?? span.guard, source: span.source, recorded: Object.hasOwn(over, 'recorded') ? over.recorded : span.recorded });
        assert.deepEqual(ask(), { ok: true });
        assert.equal(replayTrainerOffer.length, 2);
        assert.equal(replayTrainerOffer({ state: before, hash: hashJson }, { guard: { ...span.guard, predicate: { kind: 'trainer.open', payload: {} } } }), undefined);
        const off = (answer, text) => { assert.equal(answer.ok, false); assert.match(answer.reason, text); };
        off(ask({ recorded: { ...span.recorded, fee: 41 } }), /outside the template's range/);
        off(ask({ recorded: { ...span.recorded, fee: 9 } }), /outside the template's range/);
        off(ask({ recorded: { ...span.recorded, feeBy: 'dice' } }), /outside the template's range/);
        off(ask({ recorded: { ...span.recorded, fee: 26 } }), /evidence changed/);
        off(ask({ recorded: null }), /not whole/);
        const { feeBy: _feeBy, fee: _fee, ...rolled } = span.recorded;
        off(ask({ recorded: rolled }), /evidence changed/);
        assert.deepEqual(hashJson({ a: 1 }) === hashJson({ a: 1 }), true);
    });
});
