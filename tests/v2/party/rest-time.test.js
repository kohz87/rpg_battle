// A rest the story writes needs the time to pass in the same reply (RPG Battle 2.3.0, with Story Director's clock): `! rest long` after six hours or more,
// `! rest short` after an hour. Otherwise nobody rests, the narrator is told once what a rest needs, and the Adjustments log says so. The decision is kept
// with the reply, so delete, swipe, Re-read, rebuild and reload give what the live chat had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seeded } from '../integration/helpers/host.js';
import { bluewatch, lastTail } from '../quests/helpers/bluewatch.js';
import { restsOf } from '../../../src/v2/rules/offers.js';

const fixture = JSON.parse(readFileSync(new URL('../quests/fixtures/pinned-2.2.0.json', import.meta.url), 'utf8'));
const hp = h => h.q('party.pc').hp.cur;
const max = h => h.q('party.pc').hp.max;
const at = (h, text) => h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
const drop = async (h, index) => { await h.st.deleteMessage(index); await h.st.deleteMessage(index - 1); };
const agree = async (h, when) => {
    const live = JSON.stringify(h.head());
    const problems = JSON.stringify(h.store.problems());
    const chat = JSON.parse(JSON.stringify(h.ctx.chat));
    h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), live, `${when}: rebuild equals live`);
    await h.st.loadChat(chat);
    assert.equal(JSON.stringify(h.head()), live, `${when}: reload equals live`);
    assert.equal(JSON.stringify(h.store.problems()), problems, `${when}: the same Problems`);
};
const wounded = async h => {
    await h.say('A fall.', ['~ wound Ren — fell from the wall | harm: severe']);
    assert.ok(hp(h) < max(h), 'Ren is hurt');
};
const NIGHT = 'A long rest needs the night to pass, e.g. ! time +8h.';

test('a long rest in a reply that moved the clock too little heals nobody: the narrator is told once and the Adjustments log has the row', async t => {
    await seeded(9201, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        const hurt = hp(h);
        await h.say('Ren sleeps a moment.', ['! time +1h', '! rest long — a night at the inn']);
        assert.equal(hp(h) >= hurt && hp(h) < max(h), true, 'an hour of story time heals its 5%, the rest adds nothing');
        assert.deepEqual(h.turn.problems(), []);
        await h.say('Quiet.');
        assert.ok(lastTail(h).split('\n').includes(NIGHT), lastTail(h));
        const [record] = Object.values(restsOf(h.head().domains.rules));
        assert.deepEqual([record.kind, record.needed, record.moved, record.place], ['long', 360, 60, 'Bluewatch Village']);
        const row = h.q('quest.adjustments', {}).rows.find(entry => entry.kind === 'rest');
        assert.deepEqual([row.name, row.band, row.bandLabel, row.became], ['Long rest at Bluewatch Village', 'dropped', 'Dropped', 'Rest · long · Bluewatch Village · not taken']);
        assert.equal(row.dropped, 'Only 1 hour of story time passed in that reply; a long rest needs 6 hours (e.g. ! time +8h). Nothing was healed.');
        assert.equal(row.wrote, 'rest: long · place: Bluewatch Village · a night at the inn');
        await h.say('Later.');
        assert.ok(!lastTail(h).includes(NIGHT), 'told once');
        await agree(h, 'refused');
    });
});

test('a long rest after six hours counts, a short one after an hour does, a short one after half an hour does not', async t => {
    await seeded(9202, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        await h.say('The night passes.', ['! time +8h', '! rest long — a night at the inn']);
        assert.equal(hp(h), max(h));
        assert.deepEqual(Object.keys(restsOf(h.head().domains.rules)), []);
        await wounded(h);
        await h.say('Half an hour.', ['! time +30m', '! rest short — a breather']);
        assert.equal(Object.values(restsOf(h.head().domains.rules)).filter(record => record.kind === 'short').length, 1);
        await h.say('Quiet.');
        assert.ok(lastTail(h).includes('A short rest needs an hour to pass, e.g. ! time +1h.'));
        const hurt = hp(h);
        await h.say('An hour.', ['! time +1h', '! rest short — a breather']);
        assert.ok(hp(h) > hurt);
        assert.equal(Object.keys(restsOf(h.head().domains.rules)).length, 1, 'no new refusal');
        await agree(h, 'rests');
    });
});

test('with no time written at all, and with the rest written before the time, nobody rests (the time first, then the rest)', async t => {
    await seeded(9203, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        const hurt = hp(h);
        await h.say('Rest.', ['! rest long']);
        assert.equal(hp(h), hurt);
        await h.say('Rest, then the night.', ['! rest long', '! time +8h']);
        assert.equal(Object.keys(restsOf(h.head().domains.rules)).length, 2);
    });
});

test('delete, swipe and Re-read of the replies around a refused rest agree with the live chat', async t => {
    await seeded(9204, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        await h.say('Ren naps.', ['! time +1h', '! rest long']);
        await h.say('The night passes.', ['! time +8h', '! rest long']);
        assert.equal(hp(h), max(h));
        assert.equal(Object.keys(restsOf(h.head().domains.rules)).length, 1);
        const nap = at(h, 'Ren naps.');
        // Swiping the napping reply away takes its refusal; the reply after it keeps its own rest.
        await h.turn.reread(nap);
        await agree(h, 're-read');
        await drop(h, nap);
        assert.equal(Object.keys(restsOf(h.head().domains.rules)).length, 0);
        assert.deepEqual(h.store.problems().filter(item => item.code !== 'REPLAY_PREREQUISITE'), []);
        await agree(h, 'deleted');
        await h.swipe('Another night.');
        await agree(h, 'swiped');
    });
});

test('a chat recorded on 2.2.0 (no record of anything in its pin) refuses a rest without time the same way and replays it', async t => {
    await seeded(9205, async () => {
        const h = await bluewatch(t, { st: { chat: structuredClone(fixture.chat), extensionSettings: structuredClone(fixture.extensionSettings) } });
        await h.say('A fall.', ['~ wound Ren — fell | harm: wound']);
        const hurt = hp(h);
        await h.say('Rest.', ['! rest long — at the inn']);
        assert.equal(hp(h), hurt);
        assert.equal(Object.keys(restsOf(h.head().domains.rules)).length, 1);
        await h.say('Quiet.');
        assert.ok(lastTail(h).includes(NIGHT));
        await agree(h, 'legacy');
        await drop(h, at(h, 'Rest.'));
        assert.equal(Object.keys(restsOf(h.head().domains.rules)).length, 0);
        await agree(h, 'legacy deleted');
    });
});

// ---- with passive recovery off ---------------------------------------------------------------------------------------------

const NO_RECOVERY = { features: { 'rpg-battle.recovery': false } };

test('the time a rest needs does not depend on the switch of passive recovery: with it off, an untimed rest heals nobody and a timed one heals in full', async t => {
    await seeded(9203, async () => {
        const h = await bluewatch(t, { settings: NO_RECOVERY });
        await wounded(h);
        const hurt = hp(h);
        await h.say('Ren sleeps.', ['! rest long — a night at the inn']);
        assert.equal(hp(h), hurt, 'no story time passed: nothing is healed');
        assert.deepEqual(h.turn.problems(), []);
        const [record] = Object.values(restsOf(h.head().domains.rules));
        assert.deepEqual([record.kind, record.needed, record.moved], ['long', 360, 0]);
        await h.say('Quiet.');
        assert.ok(lastTail(h).split('\n').includes(NIGHT), lastTail(h));
        await h.say('Ren sleeps again.', ['! time +30m', '! rest short — a breather']);
        assert.equal(hp(h), hurt, 'half an hour is too little for a short rest');
        await h.say('The night passes.', ['! time +8h', '! rest long — a night at the inn']);
        assert.equal(hp(h), max(h));
        await agree(h, 'recovery off');
    });
});

test('with recovery on or off an untimed rest is refused alike, and a rest after the night heals in full alike', async t => {
    const run = async (settings, seed) => seeded(seed, async () => {
        const h = await bluewatch(t, settings ? { settings } : {});
        await wounded(h);
        const hurt = hp(h);
        await h.say('Ren sleeps.', ['! rest long']);
        const untimed = hp(h) === hurt;
        const refused = Object.keys(restsOf(h.head().domains.rules)).length;
        await h.say('The night passes.', ['! time +8h', '! rest long']);
        return [untimed, refused, hp(h) === max(h), Object.keys(restsOf(h.head().domains.rules)).length];
    });
    assert.deepEqual(await run(null, 9204), [true, 1, true, 1]);
    assert.deepEqual(await run(NO_RECOVERY, 9205), [true, 1, true, 1]);
});

// ---- narrator text in a refused rest ---------------------------------------------------------------------------------------

const rowOfRest = h => h.q('quest.adjustments', {}).rows.find(entry => entry.kind === 'rest');

test('markup, control characters and a long text in a refused rest are flattened and bounded: the notice is told and the Adjustments row is there', async t => {
    await seeded(9206, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        const text = `<b>a night</b> at <script>alert(1)</script> the inn\u0007\u0000 ${'x'.repeat(500)}`;
        await h.say('Ren sleeps.', [`! rest long — ${text}`]);
        assert.deepEqual(h.turn.problems(), []);
        const [record] = Object.values(restsOf(h.head().domains.rules));
        assert.ok(record, 'the refusal is recorded');
        assert.doesNotMatch(JSON.stringify(record), /[<>]|\\u00/);
        assert.ok([...record.said.text].length <= 200);
        await h.say('Quiet.');
        assert.ok(lastTail(h).split('\n').includes(NIGHT), lastTail(h));
        const row = rowOfRest(h);
        assert.ok(row, 'the log has the row');
        assert.doesNotMatch(JSON.stringify(row), /[<>\u0000-\u001f]/);
        assert.match(row.wrote, /^rest: long · place: Bluewatch Village · b a night \/b at script alert\(1\) \/script the inn x+$/);
        await agree(h, 'markup');
    });
});

test('a place with markup, a control character or 500 characters in its name is flattened and bounded in the refused rest', async t => {
    await seeded(9207, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        for (const [n, name] of [[1, '<b>Stray</b> <i>Oar</i>\u0007'], [2, `Long ${'y'.repeat(500)}`]]) {
            await h.say(`At ${n}.`, [`~ place ${name} | kind: settlement`, `~ here ${name.replace(/[<>\u0007]/g, '')}`]);
            await h.say(`Ren sleeps ${n}.`, ['! rest long']);
        }
        assert.deepEqual(h.turn.problems().filter(problem => /rest/i.test(JSON.stringify(problem))), []);
        for (const record of Object.values(restsOf(h.head().domains.rules))) {
            if (record.place !== undefined) assert.ok(!/[<>\u0000-\u001f]/.test(record.place) && [...record.place].length <= 80, record.place);
        }
        const rows = h.q('quest.adjustments', {}).rows.filter(entry => entry.kind === 'rest');
        assert.ok(rows.length >= 1);
        for (const row of rows) assert.doesNotMatch(JSON.stringify(row), /[<>\u0000-\u001f]/);
    });
});

// ---- the words of a rest that follows the hours ----------------------------------------------------------------------------

const restReceipts = h => h.sdk.receipts().map(entry => entry.receipt).filter(receipt => receipt.type === 'capture.rest');

test('a long rest in the reply that moved the clock eight hours: the hours healed everyone first, and the receipt does not say nobody needed it', async t => {
    await seeded(9208, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        await h.say('The night passes.', ['! time +8h', '! rest long — a night at the inn']);
        assert.equal(hp(h), max(h));
        const [receipt] = restReceipts(h).slice(-1);
        assert.doesNotMatch(receipt.summary, /Nobody needed/);
        assert.equal(receipt.summary, 'The party takes a long rest (a night at the inn). The hours that passed had already healed everyone.');
        assert.equal(receipt.narrate, true);
        assert.ok(Object.values(receipt.data.gains).every(gain => gain.hp === 0 && gain.mp === 0 && gain.sp === 0), 'the numbers are as they were');
        await agree(h, 'rest after the hours');
    });
});

test('a rest that nobody needed, with no hours behind it, still says so', async t => {
    await seeded(9209, async () => {
        const h = await bluewatch(t);
        await h.say('Fresh.', ['! time +8h', '! rest long']);
        const [receipt] = restReceipts(h).slice(-1);
        assert.match(receipt.summary, /Nobody needed it\.$/);
    });
});

test('a rest that still adds something after the hours says what it added, as before', async t => {
    await seeded(9210, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        await h.say('An hour and a breather.', ['! time +1h', '! rest short']);
        const [receipt] = restReceipts(h).slice(-1);
        assert.doesNotMatch(receipt.summary, /had already healed/);
    });
});
