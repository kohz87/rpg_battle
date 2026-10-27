// A rest the story writes needs the time to pass in the same reply (RPG Battle 2.3.0, with Story Director's clock): `! rest long` after six hours or more,
// `! rest short` after an hour. Otherwise nobody rests, the narrator is told once what a rest needs, and the Adjustments log says so. The decision is kept
// with the reply, so delete, swipe, Re-read, rebuild and reload give what the live chat had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seeded } from '../integration/helpers/host.js';
import { bluewatch, lastTail, ok } from '../quests/helpers/bluewatch.js';
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

test('a long rest in the reply that moved the clock eight hours heals what the hours give, and says what it healed', async t => {
    await seeded(9208, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        await h.say('The night passes.', ['! time +8h', '! rest long — a night at the inn']);
        assert.equal(hp(h), max(h));
        const [receipt] = restReceipts(h).slice(-1);
        assert.doesNotMatch(receipt.summary, /Nobody needed/);
        assert.match(receipt.summary, /^The party takes a long rest \(a night at the inn\): Ren HP \+\d+/);
        assert.equal(receipt.narrate, true);
        assert.ok(Object.values(receipt.data.gains).some(gain => gain.hp > 0), 'the numbers are the hours\'');
        await agree(h, 'rest after the hours');
    });
});

test('the hours of a reply are taken once: a heal of the same reply that took them first leaves the rest nothing, and the receipt says so instead of "nobody needed it"', async t => {
    await seeded(9216, async () => {
        const h = await bluewatch(t);
        await h.say('Ren is hurt.', ['~ wound Ren — fell from the wall | harm: severe']);
        const hurt = hp(h);
        // The time first, then a second wound (which folds the hours in before it lands), then the rest: the eight hours are spent.
        await h.say('The night passes.', ['! time +8h', '~ wound Ren — a rotten step | harm: wound', '! rest long — a night at the inn']);
        const [receipt] = restReceipts(h).slice(-1);
        assert.equal(receipt.summary, 'The party takes a long rest (a night at the inn). The hours of this reply were already counted: nothing was left to heal.');
        assert.ok(hp(h) < max(h), 'the night healed the first wound before the second landed, and the rest is not a second night');
        assert.ok(hp(h) > hurt - 1000);
        await agree(h, 'taken');
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

// ---- every way a rest can heal needs the hours ------------------------------------------------------------------------------

test('a rest in the first reply of a chat whose clock was just started, with no time written, heals nobody (Story Director has settled nothing yet)', async t => {
    await seeded(9211, async () => {
        const h = await bluewatch(t, { start: false });
        await h.say('Bluewatch at dawn, and a fall.', ['~ place Bluewatch Village | kind: settlement', '~ wound Ren — fell from the wall | harm: severe', '! rest long — a night at the inn']);
        assert.ok(hp(h) < max(h), `${hp(h)}/${max(h)}`);
        assert.equal(Object.values(restsOf(h.head().domains.rules)).length, 1);
        await h.say('Quiet.');
        assert.ok(lastTail(h).split('\n').includes(NIGHT), lastTail(h));
        await h.say('The night passes.', ['! time +8h', '! rest long']);
        assert.equal(hp(h), max(h));
    });
});

test('a short rest after a jump of half an hour heals nobody, and a rest after a jump is the rest of that jump alone', async t => {
    await seeded(9212, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        const hurt = hp(h);
        await h.say('A breather.', ['! time +30m', '! rest short']);
        assert.equal(hp(h) >= hurt && hp(h) < max(h), true);
        assert.equal(Object.values(restsOf(h.head().domains.rules)).filter(record => record.kind === 'short').length, 1);
    });
});

test('the party.rest command is the same rest: with the clock set and no jump behind it, it heals nobody; after the night it heals in full', async t => {
    await seeded(9213, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        const hurt = hp(h);
        const before = JSON.stringify(h.head().domains.party);
        const refused = await h.sdk.command('party.rest', { kind: 'long' });
        assert.equal(refused.ok, false);
        assert.equal(refused.code, 'REFUSED');
        assert.match(refused.message, /needs 6 hours/);
        assert.equal(hp(h), hurt);
        assert.equal(JSON.stringify(h.head().domains.party), before, 'nothing changed');
        const short = await h.sdk.command('party.rest', { kind: 'short' });
        assert.equal(short.ok, false);
        assert.equal(hp(h), hurt);
        await h.say('The night passes.', ['! time +8h']);
        const after = await h.sdk.command('party.rest', { kind: 'long' });
        assert.equal(after.ok, true, after.message);
        assert.equal(hp(h), max(h));
    });
});

// ---- a long chat of refused rests ---------------------------------------------------------------------------------------------

test('sixty refused rests: every one is recorded and told, and the log shows the newest fifty and says how many older ones it does not list', async t => {
    await seeded(9214, async () => {
        const h = await bluewatch(t);
        await h.say('A fall.', ['~ wound Ren — fell | harm: severe']);
        for (let n = 1; n <= 60; n += 1) {
            await h.say(`Ren dozes ${n}.`, ['! rest long — a doze']);
            assert.deepEqual(h.turn.problems(), [], `reply ${n}`);
            await h.say(`Quiet ${n}.`);
            assert.ok(lastTail(h).split('\n').includes(NIGHT), `the narrator is told of refusal ${n}`);
        }
        assert.equal(Object.keys(restsOf(h.head().domains.rules)).length, 60);
        const log = h.q('quest.adjustments', {});
        assert.equal(log.rows.length, 50);
        assert.equal(log.more, 10);
        assert.ok(log.rows.every(row => row.kind === 'rest'));
        const replies = log.rows.map(row => row.reply);
        assert.deepEqual(replies, [...replies].sort((a, b) => b - a), 'newest first');
        await agree(h, 'sixty refusals');
    });
});

test('the party.rest command on a chat where Story Director has settled no time yet is refused like the line: no time has passed, so nothing is healed', async t => {
    await seeded(9215, async () => {
        const h = await bluewatch(t, { start: false });
        await h.say('Bluewatch at dawn.', ['~ place Bluewatch Village | kind: settlement', '~ wound Ren — fell from the wall | harm: severe']);
        assert.equal(h.q('time.overdue', {}), null, 'nothing settled');
        const hurt = hp(h);
        assert.ok(hurt < max(h));
        const before = JSON.stringify(h.head().domains.party);
        for (const kind of ['short', 'long']) {
            const out = await h.sdk.command('party.rest', { kind });
            assert.equal(out.ok, false, kind);
            assert.equal(out.code, 'REFUSED');
        }
        assert.equal(hp(h), hurt);
        assert.equal(JSON.stringify(h.head().domains.party), before, 'nothing changed');
    });
});

// ---- the first reply of a chat: the clock is set in it ---------------------------------------------------------------------------

test('a rest in the first reply that moved the clock the hours it needs heals them, whatever the order of the lines; with no hours written, nothing', async t => {
    for (const [seed, lines, healed] of [
        [9217, ['~ wound Ren — fell | harm: severe', '! time +8h', '! rest long — a night'], true],
        [9218, ['! time +8h', '~ wound Ren — fell | harm: severe', '! rest long — a night'], false],
        [9219, ['~ place Bluewatch Village | kind: settlement', '~ wound Ren — fell | harm: severe', '! rest long — a night'], false],
    ]) {
        await seeded(seed, async () => {
            const h = await bluewatch(t, { start: false });
            await h.say('Dawn.', lines);
            assert.deepEqual(h.turn.problems().filter(problem => /rest/i.test(JSON.stringify(problem))), []);
            assert.equal(hp(h) === max(h), healed, `${lines.join(' / ')}: ${hp(h)}/${max(h)}`);
            // The hours were written after the wound in the second case, so they came and went before anyone was hurt: no night after the wound; the third wrote none.
            assert.equal(Object.keys(restsOf(h.head().domains.rules)).length, seed === 9219 ? 1 : 0);
            await agree(h, `first reply ${seed}`);
        });
    }
});

test('a rest in the first reply with a time that only sets the date (no hours written) heals nobody', async t => {
    await seeded(9220, async () => {
        const h = await bluewatch(t, { start: false });
        await h.say('Dawn.', ['~ time CY 611, Goldwane 12, 08:00 am', '~ wound Ren — fell | harm: severe', '! rest long — a night']);
        assert.ok(hp(h) < max(h));
        assert.equal(Object.keys(restsOf(h.head().domains.rules)).length, 1);
    });
});

// ---- the same hours are not paid twice ---------------------------------------------------------------------------------------------

test('passive recovery and a rest in the same reply give what the hours give once: the same as the hours alone', async t => {
    const run = async (seed, lines, settings) => seeded(seed, async () => {
        const h = await bluewatch(t, settings ? { settings } : {});
        await wounded(h);
        await h.say('Hours pass.', lines);
        await h.say('Quiet.');
        return hp(h);
    });
    // Two hours: the hours alone (passive recovery folds them before the next reply) and with a short rest or a long one asked for: the rest is the hours' formula, nothing more.
    const alone = await run(9221, ['! time +2h']);
    assert.equal(await run(9221, ['! time +2h', '! rest short — a breather']), alone, 'a short rest after two hours');
    assert.equal(await run(9221, ['! time +2h', '! rest long']), alone, 'a long rest after two hours is refused and the hours stand');
    // With passive recovery off the rest is what gives the hours back; with it on the rest finds them already given or gives them itself.
    const rest = await run(9222, ['! time +2h', '! rest short — a breather'], NO_RECOVERY);
    assert.equal(rest, alone, 'the rest heals what the hours give, switch or not');
    assert.ok(alone > 0);
});

test('two rests in one reply (the line, then the command) take the hours once; so do two commands after the reply', async t => {
    await seeded(9223, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        await h.say('An hour.', ['! time +1h', '! rest short — a breather']);
        const once = hp(h);
        assert.ok(once > 0);
        const again = await h.sdk.command('party.rest', { kind: 'short' });
        assert.equal(again.ok, true, again.message);
        assert.equal(hp(h), once, 'the same hour pays one rest');
        assert.match(again.receipt.summary, /already counted|already healed/);
        const third = await h.sdk.command('party.rest', { kind: 'short' });
        assert.equal(hp(h), once);
        assert.equal(third.ok, true);
        await agree(h, 'rests');
    });
});

test('one hour pays one short rest, however it is asked for: 60 commands heal as one', async t => {
    await seeded(9224, async () => {
        const h = await bluewatch(t);
        await wounded(h);
        await h.say('An hour.', ['! time +1h']);
        const first = await h.sdk.command('party.rest', { kind: 'short' });
        assert.equal(first.ok, true, first.message);
        const once = hp(h);
        for (let n = 0; n < 60; n += 1) assert.equal((await h.sdk.command('party.rest', { kind: 'short' })).ok, true);
        assert.equal(hp(h), once);
        const sibling = await bluewatch(t);
        await wounded(sibling);
        await sibling.say('An hour.', ['! time +1h']);
        await sibling.say('Quiet.');
        assert.equal(hp(sibling), once, 'the rest healed what the hour gives passively');
    });
});

// ---- a fight over midnight --------------------------------------------------------------------------------------------------------

test('hours that pass while a fight has the party pay no rest, across midnight too: the rest in the fight is refused, and the rest after the fight needs hours of its own', async t => {
    await seeded(9225, async () => {
        const h = await bluewatch(t);
        await h.say('Dusk.', ['~ time CY 611, Goldwane 12, 11:00 pm']);
        await wounded(h);
        await h.say('They attack.', ['! encounter 2 Rats | like: cellar-rat-swarm | tier: trivial']);
        ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
        const hurt = hp(h);
        await h.say('A long night of fighting.', ['! time +8h', '! rest long — in the middle of it']);
        assert.equal(hp(h), hurt, 'no rest in the middle of a fight');
        assert.ok(h.turn.problems().some(problem => /fight/i.test(JSON.stringify(problem))), 'the line is a Problem');
        assert.deepEqual(Object.keys(restsOf(h.head().domains.rules)), [], 'it was not a rest the clock refused');
        for (let n = 0; n < 300; n += 1) {
            const session = h.q('combat.session');
            if (!session || session.status !== 'active') break;
            ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: session.id, board: session.board }));
        }
        ok(await h.sdk.command('combat.end', { session: h.q('combat.session').id }));
        await h.say('Morning.', ['~ wound Ren — a stiff neck | harm: wound', '! rest long — in the morning']);
        assert.equal(Object.keys(restsOf(h.head().domains.rules)).length, 1, 'the rest after the fight, with no hours of its own, was refused');
        await h.say('Quiet.');
        assert.ok(lastTail(h).split('\n').includes(NIGHT), lastTail(h));
        await agree(h, 'fight');
    });
});

// ---- re-check 3: a rest heals by the hours that passed before the damage it would heal, and only the party's ----------------------------------------------

const lineWound = (name, harm = 'severe') => `~ wound ${name} — a blow | harm: ${harm}`;

for (const [label, settings] of [['passive recovery on', null], ['passive recovery off', NO_RECOVERY]]) {
    test(`${label}: a rest heals no wound that lands after its hours passed, and a wound that landed before them is healed by them`, async t => {
        await seeded(9230, async () => {
            // The hours first, then the wound, then the rest: the wound did not exist while the hours passed.
            const h = await bluewatch(t, settings ? { settings } : {});
            await h.say('The night, then a fall, then a rest.', ['! time +8h', lineWound('Ren'), '! rest long — in the wreck']);
            assert.ok(hp(h) < max(h), `${label}: the night passed before the wound (${hp(h)}/${max(h)})`);
            const after = hp(h);
            await h.say('Quiet.');
            assert.ok(hp(h) >= after, 'and nothing was taken from the wound');
            await agree(h, 'hours, wound, rest');
        });
        await seeded(9231, async () => {
            // The wound first, then the hours, then the rest: the hours healed it.
            const h = await bluewatch(t, settings ? { settings } : {});
            await h.say('A fall, then the night, then a rest.', [lineWound('Ren'), '! time +8h', '! rest long — in the wreck']);
            assert.equal(hp(h), max(h), `${label}: the wound came first (${hp(h)}/${max(h)})`);
            await agree(h, 'wound, hours, rest');
        });
        await seeded(9232, async () => {
            // The rest before the wound: a rest heals nothing that lands after its line.
            const h = await bluewatch(t, settings ? { settings } : {});
            await h.say('The night, a rest, then a fall.', ['! time +8h', '! rest long — in the wreck', lineWound('Ren')]);
            assert.ok(hp(h) < max(h), `${label}: the wound came after the rest (${hp(h)}/${max(h)})`);
            await agree(h, 'hours, rest, wound');
        });
    });
}

// ---- a rest for chosen members -----------------------------------------------------------------------------------------------------------------------------

import { PACK_KEY } from '../quests/helpers/bluewatch.js';
const CALLER = { id: 'rb-test-caller', name: 'Caller', version: '0.0.0', commands: { 'rbtest.call': (ctx, { type, payload } = {}) => ctx.call(type, payload ?? {}) } };
const hpOf = (h, id) => h.head().domains.party.actors[id].hp;

test('with the story clock a rest is the whole party\'s: it cannot be asked for some members, and every member it heals is in the receipt', async t => {
    await seeded(9233, async () => {
        const h = await bluewatch(t, { extraModules: [CALLER] });
        const added = await h.sdk.command('rbtest.call', { type: 'party.addCompanion', payload: { name: 'Lyra', level: 1, class: `${PACK_KEY}/militiaman` } });
        assert.equal(added.ok, true, added.message);
        const pc = h.q('party.pc').id;
        const lyra = added.receipt.data.actor;
        await h.say('Both are hurt.', [lineWound('Ren'), lineWound('Lyra')]);
        await h.say('The night passes.', ['! time +8h']);
        const before = JSON.stringify(h.head().domains.party);
        const some = await h.sdk.command('party.rest', { kind: 'long', actors: [pc] });
        assert.equal(some.ok, false);
        assert.equal(some.code, 'INVALID');
        assert.match(some.message, /whole party/);
        assert.equal(JSON.stringify(h.head().domains.party), before, 'nothing changed');
        const all = await h.sdk.command('party.rest', { kind: 'long', actors: [pc, lyra] });
        assert.equal(all.ok, true, all.message);
        assert.match(all.receipt.summary, /Ren HP \+\d+/);
        assert.match(all.receipt.summary, /Lyra HP \+\d+/);
        assert.equal(hpOf(h, pc).lost ?? 0, 0);
        assert.equal(hpOf(h, lyra).lost ?? 0, 0);
        for (const id of [pc, lyra]) assert.ok(all.receipt.data.gains[id].hp > 0, id);
    });
});

// ---- hours that pass while a fight has the party heal nobody, however the fight ends ----------------------------------------------------------------------------

const playOut = async h => {
    for (let n = 0; n < 300; n += 1) {
        const session = h.q('combat.session');
        if (!session || session.status !== 'active') break;
        ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: session.id, board: session.board }));
    }
};

for (const [label, clockLine, ends] of [
    ['hours', '! time +6h', 'click'],
    ['across midnight', '! time +9h', 'click'],
    ['across midnight, the fight settled by the next reply\'s cue', '! time +9h', 'cue'],
]) {
    test(`time spent fighting heals nobody once the fight is over (${label})`, async t => {
        await seeded(9234, async () => {
            const h = await bluewatch(t);
            await h.say('Dusk.', ['~ time CY 611, Goldwane 12, 11:00 pm']);
            await h.say('They attack.', ['! encounter 2 Rats | like: cellar-rat-swarm | tier: strong']);
            ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
            await h.say('A long night of fighting.', [clockLine]);
            await playOut(h);
            if (ends === 'click') ok(await h.sdk.command('combat.end', { session: h.q('combat.session').id }));
            const clock = () => h.q('director.time', {}).minutes;
            let held = hp(h);
            if (ends === 'click') assert.equal(h.head().domains.party.rested, clock(), 'the hours of the fight are spent when it is settled, not healed later');
            // No time passes after the fight: nothing is healed by the replies that follow.
            await h.say('Morning.');
            if (ends === 'cue') held = hp(h);
            assert.equal(h.head().domains.party.rested, clock());
            await h.say('Later.');
            assert.equal(hp(h), held, `${label}: the hours of the fight healed ${hp(h) - held}`);
            assert.ok(max(h) > held, 'the fight left the party hurt');
            await agree(h, label);
        });
    });
}

// ---- minutes short of an hour are not carried across a wound or the end of a fight -------------------------------------------------------------------------------

const clockOf = h => h.q('director.time', {}).minutes;

for (const [label, settings] of [['passive recovery on', null], ['passive recovery off', NO_RECOVERY]]) {
    test(`${label}: ten minutes, a wound, then fifty minutes heal nothing: the ten minutes before the wound are spent with it`, async t => {
        await seeded(9240, async () => {
            const h = await bluewatch(t, settings ? { settings } : {});
            await h.say('Ten minutes, a fall.', ['! time +10m', lineWound('Ren')]);
            const hurt = hp(h);
            assert.ok(hurt < max(h));
            await h.say('Fifty minutes.', ['! time +50m']);
            await h.say('Quiet.');
            await h.say('Quiet again.');
            assert.equal(hp(h), hurt, `${label}: an hour in two parts across a wound is not an hour of the wound's`);
            assert.equal(h.head().domains.party.rested !== null, true);
            // The hours after the wound heal as ever.
            await h.say('An hour.', ['! time +1h']);
            await h.say('Quiet.');
            if (!settings) assert.ok(hp(h) > hurt, 'an hour after the wound heals');
            await agree(h, label);
        });
    });
}

test('a fight that ends at :40 and twenty minutes more heal nobody: the forty minutes of the fight are spent when it is settled', async t => {
    await seeded(9241, async () => {
        const h = await bluewatch(t);
        await h.say('They attack.', ['! encounter 2 Rats | like: cellar-rat-swarm | tier: strong']);
        ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
        await h.say('Forty minutes of fighting.', ['! time +40m']);
        await playOut(h);
        ok(await h.sdk.command('combat.end', { session: h.q('combat.session').id }));
        const left = hp(h);
        assert.ok(left < max(h), 'the fight left the party hurt');
        assert.equal(h.head().domains.party.rested, clockOf(h), 'the forty minutes are spent');
        await h.say('Twenty minutes.', ['! time +20m']);
        await h.say('Quiet.');
        assert.equal(hp(h), left, 'twenty minutes after the fight are not an hour');
        await h.say('Forty more.', ['! time +40m']);
        await h.say('Quiet.');
        assert.ok(hp(h) > left, 'an hour after it heals');
        await agree(h, 'fight at :40');
    });
});

// ---- a clock that cannot say when the reply began --------------------------------------------------------------------------------------------------------

import { CLOCK, realWorld } from '../progress/helpers/world.js';

// A clock that answers `director.time` and nothing of when story time was settled (not Story Director's own).
const BARE = { ...CLOCK, queries: { 'director.time': CLOCK.queries['director.time'] } };

test('with a clock whose elapsed time is unknown a rest is refused, and the whole-party rule holds all the same', async t => {
    await seeded(9242, async () => {
        // The stand-in clock has `director.time` but no `time.overdue`: Story Director would say when the reply began; this one cannot.
        const w = await realWorld(t, { companions: ['Lyra'], sd: BARE });
        const [lyra] = w.mates;
        await w.say('The clock is set.', ['~ time 1000', '~ wound Astra — a fall | harm: severe', '~ wound Lyra — a fall | harm: severe']);
        const hurt = id => w.head().domains.party.actors[id].hp;
        const before = JSON.stringify(w.head().domains.party);
        for (const [payload, code] of [[{ kind: 'long', actors: [w.pc] }, 'INVALID'], [{ kind: 'short', actors: [w.pc] }, 'INVALID'], [{ kind: 'long' }, 'REFUSED'], [{ kind: 'short' }, 'REFUSED']]) {
            const out = await w.host.sdk.command('party.rest', payload);
            assert.equal(out.ok, false, JSON.stringify(payload));
            assert.equal(out.code, code, JSON.stringify(payload));
        }
        assert.equal(JSON.stringify(w.head().domains.party), before, 'nobody was healed');
        assert.ok(hurt(w.pc).lost > 0 && hurt(lyra).lost > 0);
    });
});
