// Open trainers on the real host (RB open trainers §4, §5, §6, §8): the story's `+ trainer` line and the reader's "Make this a trainer"
// offer a trainer from a template of the pinned pack. Code checks the template, narrows its skills only as asked, rolls the fee once in
// the template's range (a seeded d1000, kept with the block), binds the trainer to the place the party is in and records all of it.
// Training with an offer, and what a delete, a swipe and a Re-read take back, are in open-trainers-replay.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashJson } from '../../vendor/story-block/src/v2/replay.js';
import { seeded } from '../integration/helpers/host.js';
import { openTrainerPack, pinFor, ref } from '../progress/helpers/fixture.js';
import { indexOf } from '../../../src/v2/rules/graph.js';
import { openTrainersPin } from '../progress/helpers/fixture.js';
import { feeFor, planTrainer, replayTrainer } from '../../../src/v2/training/opening.js';
import { MAX_OFFERS } from '../../../src/v2/training/domain.js';

import { HAVEN, MILL, offers, only, ready, spans } from './helpers/open.js';
const receipts = w => w.host.sdk.receipts().map(({ receipt }) => receipt).filter(receipt => receipt.type === 'capture.trainer' || receipt.type === 'trainer.open');
const problems = w => w.host.turn.problems().filter(item => /^Trainer refused/.test(item.message));
const state = w => JSON.stringify({ training: w.slice('training'), claims: Object.keys(w.head().meta.claims).sort() });
const LINE = '+ trainer Old Reka — drills | like: drills';

test('a line offers a trainer at the place with a fee from the range, recorded with its die', async t => {
    await seeded(5, async () => {
        const w = await ready(t);
        await w.say('Old Reka offers lessons.', [LINE]);
        const offer = only(w);
        const [span] = spans(w);
        assert.deepEqual(Object.keys(offer).sort(), ['by', 'eventTemplates', 'fee', 'id', 'minutes', 'name', 'npc', 'place', 'rank', 'skills', 'template', 'text', 'where']);
        assert.match(offer.id, /^tn_[0-9a-z]{8}$/);
        assert.deepEqual([offer.by, offer.name, offer.text, offer.template, offer.rank, offer.minutes], ['story', 'Old Reka', 'drills', ref('drills'), 'F', 60]);
        assert.deepEqual(offer.skills, [ref('s00'), ref('s01')], 'the whole list: no teaches label');
        assert.deepEqual([offer.place, offer.where, offer.npc, offer.eventTemplates], [HAVEN, HAVEN, null, []]);
        const die = span.recorded.die;
        assert.ok(Number.isInteger(die) && die >= 1 && die <= 1000, `the die is a d1000: ${die}`);
        assert.ok(offer.fee >= 10 && offer.fee <= 40, `the fee ${offer.fee} is inside the template's range`);
        assert.equal(offer.fee, feeFor({ coinMin: 10, coinMax: 40 }, die), 'the fee is the formula on the recorded die');
        assert.deepEqual(span.recorded, { die, id: offer.id, place: HAVEN, where: HAVEN, npc: null, present: null });
        assert.equal(span.guard.replyBound, true, 'a line\'s block is bound to its reply');
        assert.equal(span.guard.predicate.kind, 'trainer.open');
        assert.deepEqual(span.guard.predicate.payload, { binding: { template: 'drills', name: 'Old Reka', text: 'drills', skills: null }, by: 'story' });
        assert.equal(span.guard.rulesHash, w.slice('rules').rulesHash);
        const receipt = receipts(w).at(-1);
        assert.equal(receipt.narrate, true, 'the narrator is told');
        assert.equal(receipt.summary, `Old Reka will teach s00 and s01 at ${HAVEN} for ${offer.fee} gold a session.`);
        const { v2, ...data } = receipt.data;
        assert.deepEqual(data, { trainer: offer.id, fee: offer.fee, place: HAVEN, where: HAVEN, template: ref('drills'), skills: offer.skills, by: 'story' });
        assert.equal(v2.guard.predicate.kind, 'trainer.open', 'the receipt carries the guard as the host stores it');
        assert.ok(Object.keys(w.head().meta.claims).some(key => key.startsWith('rb:ep_00000000:trainer:')), 'the name is claimed');
        assert.deepEqual(w.problems(), []);
        assert.deepEqual(w.host.turn.problems(), []);
    });
});

test('the fee is coinMin at die 1, coinMax at die 1000 and never leaves the range', () => {
    for (const range of [{ coinMin: 10, coinMax: 40 }, { coinMin: 1, coinMax: 1000000 }, { coinMin: 7, coinMax: 7 }, { coinMin: 1, coinMax: 2 }, { coinMin: 999999, coinMax: 1000000 }]) {
        assert.equal(feeFor(range, 1), range.coinMin);
        assert.equal(feeFor(range, 1000), range.coinMax);
        let last = 0;
        for (let die = 1; die <= 1000; die += 1) {
            const fee = feeFor(range, die);
            assert.ok(Number.isSafeInteger(fee) && fee >= range.coinMin && fee <= range.coinMax && fee >= last, `${JSON.stringify(range)} die ${die}`);
            last = fee;
        }
    }
});

test('different replies roll different dice; one reply\'s seed gives one die', async t => {
    const fees = new Set();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        await seeded(seed, async () => {
            const w = await ready(t);
            await w.say('Offer.', [LINE]);
            fees.add(only(w).fee);
        });
    }
    assert.ok(fees.size > 1, `eight seeds, ${fees.size} fee(s): the die is rolled`);
});

test('teaches narrows the list and never adds to it; the template\'s order is kept', async t => {
    const w = await ready(t, { present: ['Old Reka', 'Zed'] });
    await w.say('Narrow.', ['+ trainer Old Reka — drills | like: drills | teaches: s01']);
    assert.deepEqual(only(w).skills, [ref('s01')]);
    const [span] = spans(w);
    assert.deepEqual(span.guard.predicate.payload.binding.skills, ['s01'], 'the narrowing is kept as written');
    // Not in the template: refused, nothing written.
    const before = state(w);
    await w.say('Add.', ['+ trainer Zed — more | like: drills | teaches: s02']);
    assert.equal(state(w), before);
    assert.match(problems(w).at(-1).message, /Drills does not teach s02; a trainer teaches only what its template lists/);
    assert.equal(receipts(w).at(-1).data.code, 'REFUSED');
});

test('teaches matches a skill by its ref, slug or name, in any order, any case; a repeat collapses', async t => {
    const w = await ready(t, { present: ['A', 'B', 'C'] });
    await w.say('Ref.', [`+ trainer A | like: pack.fixture/drills | teaches: ${ref('s01')}`]);
    await w.say('Slug twice, reversed.', ['+ trainer B | like: drills | teaches: S01 ; s00, s01']);
    await w.say('Name.', ['+ trainer C | like: drills | teaches: S00']);
    const byName = Object.fromEntries(Object.values(offers(w)).map(offer => [offer.name, offer.skills]));
    assert.deepEqual(byName, { A: [ref('s01')], B: [ref('s00'), ref('s01')], C: [ref('s00')] });
    assert.deepEqual(w.host.turn.problems(), []);
});

test('a name that two skills share is refused: it must match exactly one', async t => {
    const pack = openTrainerPack();
    pack.content.rules[0].skills.find(skill => skill.slug === 's01').name = 'Twin';
    pack.content.rules[0].skills.find(skill => skill.slug === 's00').name = 'twin';
    const w = await ready(t, { given: pinFor('twin-names', pack) });
    await w.say('Both.', ['+ trainer Old Reka | like: drills | teaches: Twin']);
    assert.deepEqual(offers(w), {});
    assert.match(problems(w).at(-1).message, /Drills does not teach Twin/);
    await w.say('By slug.', ['+ trainer Old Reka | like: drills | teaches: s00']);
    assert.deepEqual(only(w).skills, [ref('s00')]);
});

// Every refusal of §4.2 is visible (a Problem on the reply with the code on the receipt) and writes nothing.
const refusals = [
    ['row 1: only a + line offers one', ['- trainer Old Reka', '~ trainer Old Reka', '! trainer Old Reka'], 'INVALID', /Trainer lines only offer one/],
    ['row 3: no like', ['+ trainer Old Reka — drills'], 'INVALID', /An open trainer needs \| like: <template>/],
    ['row 4: a fee', ['+ trainer Old Reka | like: drills | fee: 1'], 'INVALID', /cannot supply a fee, a place or other fields/],
    ['row 4: a place', ['+ trainer Old Reka | like: drills | place: pack.fixture/mill'], 'INVALID', /cannot supply a fee, a place or other fields/],
    ['row 5: a name of 81 characters', [`+ trainer ${'x'.repeat(81)} | like: drills`], 'INVALID', /Name the trainer in at most 80 characters/],
    ['row 5: a name with markup', ['+ trainer Old <b>Reka | like: drills'], 'INVALID', /Name the trainer in at most 80 characters/],
    ['row 5: a text over 240 characters', [`+ trainer Old Reka — ${'y'.repeat(241)} | like: drills`], 'INVALID', /Name the trainer in at most 80 characters/],
    ['row 5: a text with markup', ['+ trainer Old Reka — <i>drills</i> | like: drills'], 'INVALID', /Name the trainer in at most 80 characters/],
    ['row 6: a template the pack does not have', ['+ trainer Old Reka | like: nothing'], 'RULES_MISMATCH', /Choose an open trainer template of this world's rules explicitly/],
    ['row 6: a fixed trainer\'s slug is not a template', ['+ trainer Old Reka | like: mentor', '+ trainer Old Reka | like: pack.fixture/stormy'], 'RULES_MISMATCH', /Choose an open trainer template/],
    ['row 7: a skill the template does not list', ['+ trainer Old Reka | like: drills | teaches: s02'], 'REFUSED', /Drills does not teach s02/],
    ['row 7: a skill of the pack that is not in this template, among good ones', ['+ trainer Old Reka | like: drills | teaches: s00, s10'], 'REFUSED', /Drills does not teach s10/],
    ['row 8: an empty teaches', ['+ trainer Old Reka | like: drills | teaches:'], 'INVALID', /names the skills, or is left out/],
    ['row 9: a fixed trainer\'s name', ['+ trainer Old Brann | like: drills', '+ trainer old   BRANN | like: drills'], 'REFUSED', /Old Brann is already a trainer of this world|old {1,3}BRANN is already a trainer of this world/],
];
for (const [label, lines, code, message] of refusals) {
    test(`refusal ${label}: visible, with its code, and nothing is written`, async t => {
        const w = await ready(t);
        const before = state(w);
        await w.say('A try.', lines);
        assert.equal(state(w), before, 'nothing written');
        assert.deepEqual(w.problems(), []);
        const mine = problems(w);
        assert.equal(mine.length, lines.length, JSON.stringify(mine));
        for (const item of mine) assert.match(item.message, message);
        assert.deepEqual(receipts(w).slice(-lines.length).map(receipt => [receipt.data.code, receipt.data.refused, receipt.narrate]), lines.map(() => [code, true, false]));
        assert.ok(receipts(w).slice(-lines.length).every(receipt => receipt.summary.startsWith('Trainer refused: ')));
        assert.equal(spans(w).length, 0);
    });
}

test('row 2: a fixed trainer\'s name with no like is a quiet note, not a Problem', async t => {
    const w = await ready(t);
    const before = state(w);
    await w.say('Brann is about.', ['+ trainer Old Brann — lessons', '+ trainer  OLD BRANN']);
    assert.equal(state(w), before);
    assert.deepEqual(w.host.turn.problems(), []);
    assert.deepEqual(receipts(w).slice(-2).map(receipt => [receipt.summary, receipt.narrate]), [['Old Brann is a trainer of this world.', false], ['OLD BRANN is a trainer of this world.', false]]);
});

test('row 10: the same name at the same place is a quiet no-op and never rolls again', async t => {
    const w = await ready(t);
    await w.say('First.', [LINE]);
    const first = structuredClone(only(w));
    const claims = Object.keys(w.head().meta.claims).length;
    await w.say('Again, in a later reply.', [LINE, '+ trainer  old reka | like: drills | teaches: s00']);
    assert.deepEqual(only(w), first, 'the same offer, the same fee');
    assert.equal(Object.keys(w.head().meta.claims).length, claims);
    assert.deepEqual(w.host.turn.problems(), []);
    assert.deepEqual(receipts(w).slice(-2).map(receipt => [receipt.summary, receipt.narrate]), [['Old Reka already teaches here.', false], ['old reka already teaches here.', false]]);
    assert.equal(spans(w).length, 1);
    await w.say('Twice in one reply.', [LINE, LINE]);
    assert.deepEqual(only(w), first);
});

test('row 11: the same name at another place is refused: a trainer stays where it was offered', async t => {
    const w = await ready(t);
    await w.say('First.', [LINE]);
    const first = structuredClone(only(w));
    await w.say('To the mill.', [`~ here ${MILL}`, LINE]);
    assert.deepEqual(only(w), first);
    assert.match(problems(w).at(-1).message, new RegExp(`Old Reka already teaches at ${HAVEN}; a trainer stays where it was offered`));
    assert.equal(receipts(w).at(-1).data.code, 'REFUSED');
});

test('row 12: where the party is cannot be told, so the trainer has no place to stand', async t => {
    const w = await ready(t, { here: false });
    await w.say('Somewhere.', [LINE]);
    assert.deepEqual(offers(w), {});
    assert.match(problems(w).at(-1).message, /Where the party is cannot be told, so the trainer has no place to stand/);
    assert.equal(receipts(w).at(-1).data.code, 'DEPENDENCY_UNAVAILABLE');
});

test('row 12: a place that is not an id (nothing a canonical place answers) is the same refusal, not a domain error', () => {
    const ix = indexOf(openTrainersPin());
    const binding = { template: 'drills', name: 'Old Reka', text: '', skills: null };
    for (const place of [null, undefined, '', 'Haven', 'pack.fixture/', 42, {}]) {
        const plan = planTrainer({ ix, training: { offers: {} }, binding, by: 'story', recorded: { place, where: 'x', npc: null, present: null }, roll: () => 5, newId: () => 'tn_00000001' });
        assert.deepEqual([plan.ok, plan.code], [false, 'DEPENDENCY_UNAVAILABLE'], String(place));
        assert.match(plan.message, /Where the party is cannot be told/);
    }
    const good = planTrainer({ ix, training: { offers: {} }, binding, by: 'story', recorded: { place: 'pl_0a1b2c3d', where: 'x', npc: null, present: null }, roll: () => 5, newId: () => 'tn_00000001' });
    assert.equal(good.ok, true, 'an own place (pl_…) is an id');
});

test('row 13: a chat holds at most 100 story trainers; each is a different name', async t => {
    const w = await ready(t, { present: [] });
    const names = Array.from({ length: MAX_OFFERS + 1 }, (_, n) => `Teacher ${n}`);
    for (let at = 0; at < MAX_OFFERS; at += 20) await w.say(`Batch ${at}.`, names.slice(at, at + 20).map(name => `+ trainer ${name} | like: drills`));
    assert.equal(Object.keys(offers(w)).length, MAX_OFFERS);
    assert.deepEqual(w.host.turn.problems(), []);
    const before = state(w);
    await w.say('One too many.', [`+ trainer ${names.at(-1)} | like: drills`]);
    assert.equal(state(w), before);
    assert.match(problems(w).at(-1).message, /This chat has 100 story trainers; no more can be offered/);
    assert.deepEqual(w.problems(), []);
}, { timeout: 120000 });

test('a line is an offer with no reader involved: the trainer needs nobody present, and a second person gets their own', async t => {
    const w = await ready(t, { present: [] });
    await w.say('Strangers.', ['+ trainer Old Reka — drills | like: drills', '+ trainer Zed | like: drills | teaches: s00']);
    assert.deepEqual(Object.values(offers(w)).map(offer => [offer.name, offer.skills.length]).sort(), [['Old Reka', 2], ['Zed', 1]]);
    assert.equal(new Set(Object.keys(offers(w))).size, 2, 'two ids');
});

// ---- the reader's action ----

const click = (w, payload) => w.ui('trainer.open', payload);

test('Make this a trainer: someone the scene lists, a template; the offer is the reader\'s and is not bound to a reply', async t => {
    await seeded(9, async () => {
        const w = await ready(t);
        const out = click(w, { name: 'old reka', template: 'drills' });
        assert.equal(out.ok, true, out.message);
        const offer = only(w);
        assert.deepEqual([offer.by, offer.name, offer.text, offer.place, offer.skills], ['reader', 'Old Reka', '', HAVEN, [ref('s00'), ref('s01')]]);
        const { v2, ...data } = out.receipt.data;
        assert.deepEqual(data, { trainer: offer.id, fee: offer.fee, place: HAVEN, where: HAVEN, template: ref('drills'), skills: offer.skills, by: 'reader' });
        assert.equal(v2.guard.predicate.kind, 'trainer.open');
        assert.equal(out.receipt.narrate, true);
        assert.match(out.receipt.summary, /^Old Reka will teach s00 and s01 at pack\.fixture\/haven for \d+ gold a session\.$/);
        const [span] = spans(w);
        assert.equal(span.guard.replyBound, undefined, 'a click is not reply-bound');
        assert.deepEqual(span.guard.predicate.payload, { binding: { template: 'drills', name: 'Old Reka', text: '', skills: null }, by: 'reader' });
        assert.equal(span.recorded.present, true);
        assert.equal(offer.fee, feeFor({ coinMin: 10, coinMax: 40 }, span.recorded.die));
        assert.deepEqual(w.problems(), []);
    });
});

test('Make this a trainer needs a person who is present, and says so', async t => {
    const w = await ready(t);
    const before = state(w);
    const out = click(w, { name: 'Zed', template: 'drills' });
    assert.equal(out.code, 'NOT_FOUND');
    assert.equal(out.message, 'Zed is not here.');
    assert.equal(state(w), before);
    await w.say('Zed arrives.', ['+ present Zed']);
    assert.equal(click(w, { name: 'Zed', template: 'drills' }).ok, true);
    assert.equal(only(w).name, 'Zed');
    await w.say('Zed leaves.', ['- present Zed']);
    assert.equal(click(w, { name: 'Zed', template: 'drills' }).code, 'NOT_FOUND', 'he left: the offer stays, the click needs him here');
    assert.equal(only(w).name, 'Zed');
    assert.equal(click(w, { name: 'Nobody', template: 'drills' }).code, 'NOT_FOUND');
});

test('Make this a trainer: text, a narrowing of the template\'s skills, and every refusal of §4.2 that a click can meet', async t => {
    const w = await ready(t, { present: ['Old Reka', 'Zed', 'Mia'] });
    const before = state(w);
    for (const [payload, code, message] of [
        [{ name: 'Zed', template: 'nothing' }, 'RULES_MISMATCH', /Choose an open trainer template/],
        [{ name: 'Zed', template: 'mentor' }, 'RULES_MISMATCH', /Choose an open trainer template/],
        [{ name: 'Zed', template: 'drills', skills: [ref('s02')] }, 'REFUSED', /Drills does not teach pack\.fixture\/s02/],
        [{ name: 'Zed', template: 'drills', skills: [ref('s00'), ref('s10')] }, 'REFUSED', /Drills does not teach pack\.fixture\/s10/],
    ]) {
        const out = click(w, payload);
        assert.equal(out.code, code, JSON.stringify(payload));
        assert.match(out.message, message);
    }
    assert.equal(state(w), before);
    const narrowed = click(w, { name: 'Zed', template: 'drills', text: 'light drills', skills: [ref('s01')] });
    assert.equal(narrowed.ok, true, narrowed.message);
    assert.deepEqual([only(w).text, only(w).skills], ['light drills', [ref('s01')]]);
    assert.deepEqual(spans(w)[0].guard.predicate.payload.binding, { template: 'drills', name: 'Zed', text: 'light drills', skills: [ref('s01')] });
    // The name is a pack trainer's.
    await w.say('Brann is here.', ['+ present Old Brann']);
    assert.match(click(w, { name: 'Old Brann', template: 'drills' }).message, /Old Brann is already a trainer of this world/);
    // The same click again is the same trainer, not a second.
    const again = click(w, { name: 'Zed', template: 'drills' });
    assert.equal(again.code, 'REFUSED');
    assert.equal(again.message, 'Zed already teaches here.');
    assert.equal(Object.keys(offers(w)).length, 1);
});

test('Make this a trainer: a closed payload, bounded text and skills', async t => {
    const w = await ready(t);
    const before = state(w);
    for (const payload of [
        undefined, null, 'Old Reka', [], {},
        { name: 'Old Reka' }, { template: 'drills' }, { name: '', template: 'drills' }, { name: 5, template: 'drills' }, { name: 'Old Reka', template: 5 },
        { name: 'Old Reka', template: 'drills', fee: 3 }, { name: 'Old Reka', template: 'drills', place: HAVEN },
        { name: 'Old Reka', template: 'drills', text: 'x'.repeat(241) }, { name: 'Old Reka', template: 'drills', text: 5 },
        { name: 'Old Reka', template: 'drills', skills: [] }, { name: 'Old Reka', template: 'drills', skills: 's00' }, { name: 'Old Reka', template: 'drills', skills: ['s00'] },
        { name: 'Old Reka', template: 'drills', skills: Array.from({ length: 31 }, (_, n) => ref(`s${n}`)) },
    ]) {
        const out = click(w, payload);
        assert.equal(out.ok, false, JSON.stringify(payload));
        assert.equal(out.code, 'INVALID', JSON.stringify(payload));
    }
    assert.equal(state(w), before);
});

test('Make this a trainer is a reader action: the story, the system and another module cannot use it', async t => {
    const w = await ready(t);
    const before = state(w);
    for (const cause of ['story', 'system']) assert.equal(w.host.bus.command('trainer.open', { name: 'Old Reka', template: 'drills' }, { cause }).code, 'REFUSED', cause);
    const nested = await w.internal('trainer.open', { name: 'Old Reka', template: 'drills' });
    assert.equal(nested.ok, false);
    assert.equal(nested.code, 'REFUSED');
    assert.match(nested.message, /reader action/);
    assert.equal(state(w), before);
    assert.equal(click(w, { name: 'Old Reka', template: 'drills' }).ok, true);
});

test('the reader\'s offer and the line\'s agree on one trainer per name', async t => {
    const w = await ready(t);
    assert.equal(click(w, { name: 'Old Reka', template: 'drills' }).ok, true);
    const first = structuredClone(only(w));
    await w.say('The narrator offers the same.', [LINE]);
    assert.deepEqual(only(w), first, 'the line is a no-op beside the click');
    assert.deepEqual(w.host.turn.problems(), []);
});

// ---- the guard ----

/** What the host hands the guard on replay: the stored guard and record, on the state before the block. */
async function guarded(t, { line = LINE, setup = [] } = {}) {
    return seeded(21, async () => {
        const w = await ready(t);
        if (setup.length) await w.say('Setup.', setup);
        const before = structuredClone(w.head());
        await w.say('The offer.', [line]);
        const [span] = spans(w);
        return { w, before, span, ask: (over = {}) => replayTrainer({ state: over.state ?? before, hash: hashJson }, { guard: over.guard ?? span.guard, source: span.source, recorded: Object.hasOwn(over, 'recorded') ? over.recorded : span.recorded }) };
    });
}

test('the guard asks no query: it reads the pin, the state before the block and what was recorded', async t => {
    const { span, before } = await guarded(t);
    const hook = { state: before, query: () => { throw new Error('the guard asked a query'); }, hash: hashJson };
    assert.deepEqual(replayTrainer(hook, { guard: span.guard, source: span.source, recorded: span.recorded }), { ok: true });
    // The hook takes only { state, hash }: a throwing `query` is never reached, and it declares no replay query of its own.
    assert.equal(replayTrainer.length, 2);
    const source = (await import('node:fs')).readFileSync(new URL('../../../src/v2/training/opening.js', import.meta.url), 'utf8');
    const replay = source.slice(source.indexOf('export function replayTrainer'));
    assert.equal(/\bquery\b|ctx\.query|\bask\(/.test(replay), false, 'replayTrainer names no query');
    const { part } = await import('../../../src/v2/training/index.js');
    assert.equal(part.replayQueries, undefined, 'the training part lists no replay query');
});

test('the guard holds on the state it was made on and for another ordinal of the same reply, and answers only its own kind', async t => {
    const { span, ask } = await guarded(t);
    assert.deepEqual(ask(), { ok: true });
    assert.equal(replayTrainer({ state: {}, hash: hashJson }, { guard: { ...span.guard, predicate: { kind: 'class.choose', payload: {} } }, source: span.source, recorded: null }), undefined);
    assert.equal(replayTrainer({ state: {}, hash: hashJson }, { guard: null }), undefined);
});

test('the guard turns the block off when the recorded evidence or the state it stood on changed', async t => {
    const { w, before, span, ask } = await guarded(t);
    const off = (answer, text) => { assert.equal(answer.ok, false); assert.match(answer.reason, text); };
    // The die, the place, the NPC, the id and the name's place: all hashed, so another record is another block.
    off(ask({ recorded: { ...span.recorded, die: span.recorded.die === 1000 ? 1 : span.recorded.die + 1 } }), /The trainer offer evidence changed/);
    off(ask({ recorded: { ...span.recorded, place: MILL } }), /evidence changed/);
    off(ask({ recorded: { ...span.recorded, where: 'Elsewhere' } }), /evidence changed/);
    off(ask({ recorded: { ...span.recorded, npc: 'np_00000001' } }), /evidence changed/);
    off(ask({ recorded: { ...span.recorded, id: 'tn_00000001' } }), /evidence changed/);
    off(ask({ recorded: { ...span.recorded, die: 0 } }), /fee die was not recorded/);
    off(ask({ recorded: { ...span.recorded, die: 1001 } }), /fee die was not recorded/);
    off(ask({ recorded: { ...span.recorded, id: 'th_00000001' } }), /not free/);
    off(ask({ recorded: null }), /not whole/);
    // The block's id is taken, or the name, or the room, on the state before it.
    const taken = structuredClone(before);
    taken.domains.training.offers = { [span.recorded.id]: { ...only(w), name: 'Zed' } };
    off(ask({ state: taken }), /not free/);
    const named = structuredClone(before);
    named.domains.training.offers = { tn_00000001: { ...only(w), id: 'tn_00000001' } };
    off(ask({ state: named }), /already teaches here/);
    const elsewhere = structuredClone(before);
    elsewhere.domains.training.offers = { tn_00000001: { ...only(w), id: 'tn_00000001', place: MILL, where: 'the Mill' } };
    off(ask({ state: elsewhere }), /already teaches at the Mill/);
    const full = structuredClone(before);
    full.domains.training.offers = Object.fromEntries(Array.from({ length: MAX_OFFERS }, (_, n) => [`tn_${String(n).padStart(8, '0')}`, { ...only(w), id: `tn_${String(n).padStart(8, '0')}`, name: `Teacher ${n}` }]));
    off(ask({ state: full }), /100 story trainers/);
    // Other trainers before it, more or fewer, do not move it: the guard hashes that the name was free and there was room (a count would turn
    // off every later trainer when an unrelated earlier reply is deleted).
    const another = structuredClone(before);
    another.domains.training.offers = { tn_00000001: { ...only(w), id: 'tn_00000001', name: 'Zed' } };
    assert.deepEqual(ask({ state: another }), { ok: true });
    // Other rules, another epoch, a guard of another version or without a pin.
    off(ask({ guard: { ...span.guard, rulesHash: '0'.repeat(64) } }), /rules or epoch changed/);
    off(ask({ guard: { ...span.guard, epoch: 'ep_00000001' } }), /rules or epoch changed/);
    off(ask({ guard: { ...span.guard, version: 1 } }), /rules or epoch changed/);
    off(ask({ state: { domains: {} } }), /rules or epoch changed/);
    off(ask({ guard: { ...span.guard, inputHash: '0'.repeat(64) } }), /evidence changed/);
    // A binding the pin cannot honour: the template is gone, the narrowing is not in it.
    const payload = narrowing => ({ ...span.guard, predicate: { ...span.guard.predicate, payload: { ...span.guard.predicate.payload, binding: { ...span.guard.predicate.payload.binding, ...narrowing } } } });
    off(ask({ guard: payload({ template: 'gone' }) }), /Choose an open trainer template/);
    off(ask({ guard: payload({ skills: ['s02'] }) }), /does not teach s02/);
    off(ask({ guard: { ...span.guard, predicate: { ...span.guard.predicate, payload: { binding: span.guard.predicate.payload.binding, by: 'nobody' } } } }), /not whole/);
});

test('a reader\'s block needs the person recorded present', async t => {
    const w = await ready(t);
    const before = structuredClone(w.head());
    assert.equal(click(w, { name: 'Old Reka', template: 'drills' }).ok, true);
    const [span] = spans(w);
    assert.deepEqual(replayTrainer({ state: before, hash: hashJson }, { guard: span.guard, source: span.source, recorded: span.recorded }), { ok: true });
    const answer = replayTrainer({ state: before, hash: hashJson }, { guard: span.guard, source: span.source, recorded: { ...span.recorded, present: null } });
    assert.equal(answer.ok, false);
    assert.match(answer.reason, /Old Reka is not here/);
});
