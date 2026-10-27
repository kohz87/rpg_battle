// The switch "Jobs from the story" is on the chat's timeline (rules/mode.js): a line is read in the mode in force at its reply, live, on a Re-read (edited or not) and on a rebuild or a
// reload alike, whatever the reader's switch says now. The switch is compared with the timeline when the next reply is asked for, and a change is kept as an event on the reply at the head.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../integration/helpers/host.js';
import { bluewatch } from './helpers/bluewatch.js';

const FEATURE = 'rpg-battle.generative-offers';
const STRICT = { features: { [FEATURE]: false } };
const at = (h, text) => h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
/** What a Re-read must leave alone: the head without the ledger of write ids a Re-read draws afresh. */
const world = h => {
    const head = structuredClone(h.head());
    if (head.domains.director) delete head.domains.director.writes;
    const { rules, training, combat, director } = head.domains;
    const told = h.sdk.receipts().map(({ receipt }) => receipt).filter(receipt => String(receipt.type).startsWith('capture.')).map(receipt => [receipt.type, receipt.summary, receipt.narrate, receipt.problem ?? null]);
    return JSON.stringify({ rules, training, combat, director, claims: Object.keys(head.meta.claims).sort(), told });
};
/** The paths where two snapshots differ, for the failure message. */
function paths(a, b, at = '') {
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    if (a && b && typeof a === 'object' && typeof b === 'object') return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => paths(a[key], b[key], `${at}/${key}`));
    return [`${at}: ${JSON.stringify(a)?.slice(0, 80)} -> ${JSON.stringify(b)?.slice(0, 80)}`];
}
const same = (before, after) => assert.deepEqual(paths(JSON.parse(before), JSON.parse(after)), []);
const set = (h, on) => h.features.set(FEATURE, on);
const edit = (h, index, from, to) => {
    const message = h.ctx.chat[index];
    assert.ok(message.mes.includes(from), from);
    message.mes = message.mes.replace(from, to);
    message.swipes[message.swipe_id] = message.mes;
};
const reread = async (h, index) => assert.equal((await h.turn.reread(index)).ok, true);


const foes = h => h.q('combat.offers').map(offer => offer.foes.map(foe => [foe.name, foe.count]));
const modeOf = h => h.head().domains.rules.mode;
const events = h => h.sdk.receipts().map(({ receipt }) => receipt).filter(receipt => receipt.type === 'rules.mode').map(receipt => receipt.data.mode);
const OFFER = '+ quest Old Debts | giver: Marrit | goal: Settle the matter with the river guild | reward: 80 copper | due: in 3 days';
const LIKE = '+ quest Rat Trouble | like: open-hunt-f | foe: cellar-rat-swarm';
const TEACHER = '+ trainer Old Reka — blade drills';
const fight = name => `! encounter 3 ${name} | like: cellar-rat-swarm`;
const FREE = name => [name, 3];
const ONE = name => [`3 ${name}`, 1];
const offerRecords = h => Object.keys(h.head().domains.rules).filter(key => key.startsWith('offer.'));
const teachers = h => Object.values(h.head().domains.training.offers ?? {});
/** The chat agrees with itself: rebuilt from its replies and loaded afresh it is the chat that was played. */
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

// [what it is, the line read with the switch on, the line that does something in strict mode too, the reply's text]
const CASES = [
    ['an offer the story wrote', OFFER, LIKE, 'The river guild is owed.'],
    ['a named kind of an open template', LIKE, LIKE, 'Rats in the cellar.'],
    ['a teacher', TEACHER, '+ trainer Old Reka | like: open-blade-drills', 'Reka offers drills.'],
];

for (const [name, line, strictLine, text] of CASES) {
    test(`${name}: read with the switch on, then switched off: a Re-read of the unchanged reply gives the same state and receipts`, async t => {
        await seeded(9401, async () => {
            const h = await bluewatch(t);
            await h.say(text, [line]);
            assert.equal(modeOf(h), 'free');
            const held = world(h);
            set(h, false);
            await reread(h, at(h, text));
            same(held, world(h));
            assert.deepEqual(h.store.problems(), []);
            assert.equal(modeOf(h), 'free', 'a Re-read records no event: the next reply asked for does');
        });
    });

    test(`${name}: read in strict mode, then switched on: a Re-read of the unchanged reply gives the same state and receipts`, async t => {
        await seeded(9402, async () => {
            const h = await bluewatch(t, { settings: STRICT });
            await h.say(text, [strictLine]);
            assert.equal(modeOf(h), 'strict');
            const held = world(h);
            assert.ok(JSON.parse(held).director.keys || JSON.parse(held).training.offers, 'strict mode made something of the line');
            const problems = JSON.stringify(h.store.problems());
            set(h, true);
            await reread(h, at(h, text));
            same(held, world(h));
            assert.equal(JSON.stringify(h.store.problems()), problems);
        });
    });
}

test('a free-form line that did nothing in strict mode is read afresh by a Re-read after the switch is on only once a reply has put the chat in free mode', async t => {
    await seeded(9407, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('The river guild is owed.', [OFFER]);
        assert.deepEqual(offerRecords(h), []);
        assert.ok(h.turn.problems().length > 0, 'the line is a Problem');
        set(h, true);
        // Still the mode of that reply: strict.
        await reread(h, at(h, 'The river guild is owed.'));
        assert.deepEqual(offerRecords(h), []);
        // A reply asked for with the switch on puts the chat in free mode from there; the earlier reply is still read as it was.
        await h.say('Later.');
        assert.equal(modeOf(h), 'free');
        await reread(h, at(h, 'The river guild is owed.'));
        assert.deepEqual(offerRecords(h), [], 'the earlier reply is read in the mode at its place');
        await h.say('The guild again.', [OFFER]);
        assert.equal(offerRecords(h).length, 1);
    });
});

// ---- edited lines are read in the mode at their reply -------------------------------------------------------------------------------

test('an edited line is read in the mode at its reply, whatever the switch says now: in both directions, for a fight, an offer and a teacher', async t => {
    await seeded(9405, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Rats.', [fight('Rats Of Doom')]);
        set(h, true);
        edit(h, at(h, 'Rats.'), 'Rats Of Doom', 'Rats Of Ruin');
        await reread(h, at(h, 'Rats.'));
        assert.deepEqual(foes(h), [[ONE('Rats Of Ruin')]], 'strict at its reply: one foe called "3 Rats Of Ruin"');
    });
    await seeded(9406, async () => {
        const h = await bluewatch(t);
        await h.say('Rats.', [fight('Rats Of Doom')]);
        set(h, false);
        edit(h, at(h, 'Rats.'), 'Rats Of Doom', 'Rats Of Ruin');
        await reread(h, at(h, 'Rats.'));
        assert.deepEqual(foes(h), [[FREE('Rats Of Ruin')]], 'free at its reply: three of them');
    });
    await seeded(9408, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Rats in the cellar.', [LIKE]);
        assert.deepEqual(offerRecords(h), []);
        set(h, true);
        edit(h, at(h, 'Rats in the cellar.'), 'foe: cellar-rat-swarm', 'foe: cellar-rat-swarm | reward: 90 copper');
        await reread(h, at(h, 'Rats in the cellar.'));
        assert.deepEqual(offerRecords(h), [], 'strict at its reply: 2.2.0\'s reading, which has no place for a reward');
    });
    await seeded(9409, async () => {
        const h = await bluewatch(t);
        await h.say('Rats in the cellar.', [LIKE]);
        assert.equal(offerRecords(h).length, 1);
        set(h, false);
        edit(h, at(h, 'Rats in the cellar.'), 'foe: cellar-rat-swarm', 'foe: cellar-rat-swarm | reward: 90 copper');
        await reread(h, at(h, 'Rats in the cellar.'));
        assert.equal(offerRecords(h).length, 1, 'free at its reply: read as an offer, with the reward it names');
    });
    await seeded(9412, async () => {
        const h = await bluewatch(t);
        await h.say('Reka offers drills.', ['+ trainer Old Reka | like: open-blade-drills']);
        set(h, false);
        edit(h, at(h, 'Reka offers drills.'), 'like: open-blade-drills', 'like: open-blade-drills | fee: 6 silver');
        await reread(h, at(h, 'Reka offers drills.'));
        assert.equal(teachers(h)[0]?.settled?.feeBy, 'said', 'free at its reply: the fee it names stands');
    });
    await seeded(9413, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Reka offers drills.', ['+ trainer Old Reka | like: open-blade-drills']);
        set(h, true);
        edit(h, at(h, 'Reka offers drills.'), 'like: open-blade-drills', 'like: open-blade-drills | fee: 6 silver');
        await reread(h, at(h, 'Reka offers drills.'));
        assert.equal(teachers(h)[0]?.settled, undefined, 'strict at its reply: 2.2.0\'s reading');
    });
});

test('a whitespace-only edit is no different from no edit: the reply is read in its mode, the line the same', async t => {
    await seeded(9414, async () => {
        const h = await bluewatch(t);
        await h.say('Rats.', [fight('Rats Of Doom')]);
        await h.say('Debts.', [OFFER]);
        await h.say('Reka offers drills.', ['+ trainer Old Reka | like: open-blade-drills | fee: 6 silver']);
        const held = world(h);
        set(h, false);
        edit(h, at(h, 'Rats.'), '! encounter 3 Rats Of Doom | like: cellar-rat-swarm', '!   encounter   3 Rats Of Doom |   like: cellar-rat-swarm  ');
        await reread(h, at(h, 'Rats.'));
        edit(h, at(h, 'Debts.'), '| giver: Marrit', '|   giver:   Marrit');
        await reread(h, at(h, 'Debts.'));
        edit(h, at(h, 'Reka offers drills.'), '| like: open-blade-drills |', '|  like: open-blade-drills   |');
        await reread(h, at(h, 'Reka offers drills.'));
        assert.deepEqual(foes(h), [[FREE('Rats Of Doom')]]);
        assert.equal(offerRecords(h).length, 1);
        same(held, world(h));
    });
});

// ---- the switch on the timeline -------------------------------------------------------------------------------------------------

test('toggles in the middle of a chat: every reply is read in the mode at its place, live, on a Re-read of an unchanged or an edited line, on a rebuild and on a reload', async t => {
    await seeded(9415, async () => {
        const h = await bluewatch(t);
        await h.say('Rats A.', [fight('Rats A')]);
        set(h, false);
        await h.say('Rats B.', [fight('Rats B')]);
        await h.say('Rats C.', [fight('Rats C')]);
        set(h, true);
        await h.say('Rats D.', [fight('Rats D')]);
        set(h, false);
        await h.say('Rats E.', [fight('Rats E')]);
        const expected = () => [[FREE('Rats A')], [ONE('Rats B')], [ONE('Rats C')], [FREE('Rats D')], [ONE('Rats E')]];
        assert.deepEqual(foes(h), expected());
        assert.deepEqual(events(h), ['strict', 'free', 'strict'], 'one event for each toggle, none for the replies in between');
        assert.equal(modeOf(h), 'strict');
        await agree(h, 'live');
        // Re-read each reply unchanged, under the switch off and then on: the reading never changes.
        for (const on of [false, true, false]) {
            set(h, on);
            for (const letter of 'ABCDE') {
                const held = world(h);
                await reread(h, at(h, `Rats ${letter}.`));
                same(held, world(h));
                assert.deepEqual(foes(h), expected(), `Rats ${letter} with the switch ${on ? 'on' : 'off'}`);
            }
        }
        // Edited lines: read in the mode at their own reply.
        set(h, true);
        for (const letter of 'ABCDE') {
            edit(h, at(h, `Rats ${letter}.`), `Rats ${letter} |`, `Rats ${letter}x |`);
            await reread(h, at(h, `Rats ${letter}.`));
        }
        assert.deepEqual(foes(h), [[FREE('Rats Ax')], [ONE('Rats Bx')], [ONE('Rats Cx')], [FREE('Rats Dx')], [ONE('Rats Ex')]]);
        set(h, false);
        for (const letter of 'ABCDE') {
            edit(h, at(h, `Rats ${letter}.`), `Rats ${letter}x |`, `Rats ${letter}y |`);
            await reread(h, at(h, `Rats ${letter}.`));
        }
        assert.deepEqual(foes(h), [[FREE('Rats Ay')], [ONE('Rats By')], [ONE('Rats Cy')], [FREE('Rats Dy')], [ONE('Rats Ey')]]);
        assert.deepEqual(events(h), ['strict', 'free', 'strict'], 'a Re-read adds no event');
        await agree(h, 'after the Re-reads');
        assert.deepEqual(h.store.problems().filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), []);
    });
});

test('toggles and offers: a job written in a reply read in strict mode stays a plain goal, one in free mode an offer, on every Re-read', async t => {
    await seeded(9416, async () => {
        const h = await bluewatch(t);
        await h.say('Debts A.', [OFFER]);
        set(h, false);
        await h.say('Quiet.');
        await h.say('Debts B.', ['+ quest Old Debts B | giver: Marrit | goal: Settle the matter with the river guild | reward: 80 copper | due: in 3 days']);
        set(h, true);
        await h.say('Debts C.', ['+ quest Old Debts C | giver: Marrit | goal: Settle the matter with the river guild | reward: 80 copper | due: in 3 days']);
        const count = () => offerRecords(h).length;
        assert.equal(count(), 2, 'A and C are offers, B a Problem');
        for (const on of [false, true]) {
            set(h, on);
            for (const letter of 'ABC') await reread(h, at(h, `Debts ${letter}.`));
            assert.equal(count(), 2);
        }
        await agree(h, 'offers');
    });
});

test('a reply of 120 lines is read in one mode from its first line to its last, on a Re-read under either switch', async t => {
    await seeded(9417, async () => {
        const h = await bluewatch(t);
        const jobs = (word, count) => Array.from({ length: count }, (_, n) => `+ quest ${word} ${n + 1} | giver: Marrit | goal: Settle matter number ${n + 1} with the river guild | reward: 80 copper | due: in 3 days`);
        await h.say('Many jobs.', jobs('Debt', 120));
        const made = offerRecords(h).length;
        assert.ok(made > 0, 'the lines were read freely');
        const held = world(h);
        for (const on of [false, true]) {
            set(h, on);
            await reread(h, at(h, 'Many jobs.'));
            same(held, world(h));
        }
        assert.equal(offerRecords(h).length, made);
        // The next reply is strict from its first line to its last: not one of its 120 lines is an offer.
        set(h, false);
        await h.say('Many more.', jobs('Duty', 120));
        assert.equal(offerRecords(h).length, made);
        assert.equal(modeOf(h), 'strict');
        await agree(h, '120 lines');
    });
});

test('delete, swipe and rebuild of other replies leave a toggle where it is; a reply that holds a toggle takes it with it, and the next reply asked for compares the switch again', async t => {
    await seeded(9418, async () => {
        const h = await bluewatch(t);
        await h.say('Rats A.', [fight('Rats A')]);
        await h.say('Rats B.', [fight('Rats B')]);
        set(h, false);
        await h.say('Rats C.', [fight('Rats C')]);
        await h.say('Rats D.', [fight('Rats D')]);
        await h.say('Rats E.', [fight('Rats E')]);
        set(h, true);
        await h.say('Rats F.', [fight('Rats F')]);
        const expected = [[FREE('Rats A')], [FREE('Rats B')], [ONE('Rats C')], [ONE('Rats D')], [ONE('Rats E')], [FREE('Rats F')]];
        assert.deepEqual(foes(h), expected);
        assert.deepEqual(events(h), ['strict', 'free']);
        // The toggle to strict is on B (the head when C was asked for): deleting D, which holds none, changes nothing for the rest.
        await h.st.deleteMessage(at(h, 'Rats D.'));
        await h.st.deleteMessage(at(h, 'Rats D.') - 1);
        assert.deepEqual(foes(h), [expected[0], expected[1], expected[2], expected[4], expected[5]]);
        await agree(h, 'a reply without a toggle deleted');
        for (const letter of 'ABCEF') await reread(h, at(h, `Rats ${letter}.`));
        assert.deepEqual(foes(h), [expected[0], expected[1], expected[2], expected[4], expected[5]]);
        // A swipe of the last reply is read in the mode at its place, whatever the switch says.
        set(h, false);
        await h.swipe(`Rats F, again.\n\n<Changes>\n${fight('Rats Fz')}\n</Changes>`);
        assert.equal(modeOf(h), 'free', 'a swipe records nothing');
        assert.deepEqual(foes(h).at(-1), [FREE('Rats Fz')], 'the swiped reply is read in the mode at its place');
        assert.deepEqual(events(h), ['strict', 'free']);
        await agree(h, 'swiped');
    });
});

test('the reply that holds a toggle takes it with it: the replies after it are read in the mode before it, until the next reply asked for compares the switch again', async t => {
    await seeded(9419, async () => {
        const h = await bluewatch(t);
        await h.say('Rats A.', [fight('Rats A')]);
        set(h, false);
        await h.say('Rats B.', [fight('Rats B')]);
        await h.say('Rats C.', [fight('Rats C')]);
        assert.equal(modeOf(h), 'strict');
        // The event sits on A (the head when B was asked for). Deleting A's reply (and the message it answers) takes the toggle with it.
        await h.st.deleteMessage(at(h, 'Rats A.'));
        await h.st.deleteMessage(at(h, 'Rats A.') - 1);
        assert.equal(modeOf(h), 'free', 'the toggle went with its reply: the mode is the one the chat was pinned in');
        await agree(h, 'toggle deleted');
        await reread(h, at(h, 'Rats B.'));
        assert.deepEqual(foes(h), [[FREE('Rats B')], [ONE('Rats C')]], 'B is now read in the mode at its place, which is free; C stands as it was recorded');
        await reread(h, at(h, 'Rats C.'));
        assert.deepEqual(foes(h), [[FREE('Rats B')], [FREE('Rats C')]]);
        // The next reply asked for finds the switch off and the timeline free: it records the toggle again, on the reply at the head.
        await h.say('Rats D.', [fight('Rats D')]);
        assert.equal(modeOf(h), 'strict');
        assert.deepEqual(foes(h).at(-1), [ONE('Rats D')]);
        await agree(h, 'toggled again');
    });
});

test('rules.mode is the host\'s own step: a click, another module and a payload that is not a mode are refused, and a state with a mode that is neither is not whole', async t => {
    await seeded(9420, async () => {
        const h = await bluewatch(t);
        const before = JSON.stringify(h.head());
        assert.equal((await h.sdk.command('rules.mode', { mode: 'strict' })).ok, false);
        assert.equal((await h.sdk.command('rules.mode', { mode: 'maybe' })).ok, false);
        assert.equal(JSON.stringify(h.head()), before);
        const rules = structuredClone(h.head().domains.rules);
        assert.deepEqual(rulesProblems(rules).filter(error => /mode/.test(error)), []);
        rules.mode = 'maybe';
        assert.ok(rulesProblems(rules).some(error => /mode/.test(error)));
    });
});

// ---- a long chat ----------------------------------------------------------------------------------------------------------------

import { rulesProblems } from '../../../src/v2/rules/index.js';

test('a long chat of toggles: the timeline holds one small event for each, and rebuild and reload equal live', async t => {
    await seeded(9410, async () => {
        const h = await bluewatch(t);
        for (let n = 1; n <= 12; n += 1) {
            set(h, n % 2 === 0);
            await h.say(`Rats ${n}.`, [fight(`Rats ${n}`)]);
        }
        assert.equal(events(h).length, 12, 'one event for each reply, none more');
        // The fights on offer are the newest ten.
        assert.deepEqual(foes(h).map(([row]) => row), Array.from({ length: 10 }, (_, n) => ((n + 3) % 2 === 0 ? FREE(`Rats ${n + 3}`) : ONE(`Rats ${n + 3}`))));
        await agree(h, 'twelve toggles');
        assert.deepEqual(h.store.problems().filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), []);
    });
});
