// Each reply keeps the mode of "Jobs from the story" it was read under (rules/mode.js, a stamp written by its first capture of a line the mode changes): a line is read in its reply's mode, live, on
// a Re-read (edited or not) and on a rebuild or a reload alike, whatever the reader's switch says now; a new reply stamps the switch of its moment. Deleting a reply takes its own stamp only.
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
const sidAt = (h, text) => h.ctx.chat[at(h, text)]?.extra?.storySuite?.source?.logical;
/** The mode the reply whose text holds `text` was read under: 'free' when it is stamped so, else 'strict' (a reply read with the switch off keeps no stamp). */
const modeAt = (h, text) => Object.entries(h.head().domains.rules).filter(([key]) => key.startsWith('mode.')).map(([, stamp]) => stamp).find(stamp => stamp.sid === sidAt(h, text))?.mode ?? 'strict';
const stamps = h => Object.entries(h.head().domains.rules).filter(([key]) => key.startsWith('mode.')).length;
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
            assert.equal(modeAt(h, text), 'free');
            const held = world(h);
            set(h, false);
            await reread(h, at(h, text));
            same(held, world(h));
            assert.deepEqual(h.store.problems(), []);
            assert.equal(modeAt(h, text), 'free', 'the reply keeps its own stamp');
        });
    });

    test(`${name}: read in strict mode, then switched on: a Re-read of the unchanged reply gives the same state and receipts`, async t => {
        await seeded(9402, async () => {
            const h = await bluewatch(t, { settings: STRICT });
            await h.say(text, [strictLine]);
            assert.equal(modeAt(h, text), 'strict');
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

test('a free-form line that did nothing in strict mode stays so on a Re-read after the switch is on; the reply after it is read freely', async t => {
    await seeded(9407, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('The river guild is owed.', [OFFER]);
        assert.deepEqual(offerRecords(h), []);
        assert.ok(h.turn.problems().length > 0, 'the line is a Problem');
        set(h, true);
        await reread(h, at(h, 'The river guild is owed.'));
        assert.deepEqual(offerRecords(h), [], 'the reply was read in strict mode');
        await h.say('Later.');
        await h.say('The guild again.', [OFFER]);
        assert.equal(modeAt(h, 'The guild again.'), 'free', 'a new reply stamps the switch of its moment');
        assert.equal(offerRecords(h).length, 1);
        await reread(h, at(h, 'The river guild is owed.'));
        assert.equal(offerRecords(h).length, 1, 'the earlier reply is still read in its own mode');
    });
});

// ---- edited lines are read in the mode of their reply -------------------------------------------------------------------------------

test('an edited line is read in the mode of its reply, whatever the switch says now: in both directions, for a fight, an offer and a teacher', async t => {
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

test('a reply that had no line the mode changes has no stamp, and when an edit adds one it is read as 2.2.0 did (strict), whatever the switch says', async t => {
    await seeded(9421, async () => {
        const h = await bluewatch(t);
        await h.say('Quiet.');
        assert.equal(modeAt(h, 'Quiet.'), 'strict');
        assert.equal(stamps(h), 0);
        edit(h, at(h, 'Quiet.'), 'Quiet.', `Quiet.\n\n<Changes>\n${fight('Rats Of Doom')}\n</Changes>`);
        await reread(h, at(h, 'Quiet.'));
        assert.deepEqual(foes(h), [[ONE('Rats Of Doom')]]);
        assert.equal(stamps(h), 0, 'a Re-read of a reply with no stamp writes none');
    });
});

// ---- the switch, reply by reply -----------------------------------------------------------------------------------------------

test('toggles in the middle of a chat: every reply is read in its own mode, live, on a Re-read of an unchanged or an edited line, on a rebuild and on a reload', async t => {
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
        assert.deepEqual('ABCDE'.split('').map(letter => modeAt(h, `Rats ${letter}.`)), ['free', 'strict', 'strict', 'free', 'strict']);
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
        // Edited lines: read in the mode of their own reply.
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
        assert.equal(stamps(h), 2, 'one stamp for each reply read freely, none more for a Re-read');
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
        assert.equal(modeAt(h, 'Many more.'), 'strict');
        assert.equal(stamps(h), 1, 'the strict reply keeps no stamp');
        await agree(h, '120 lines');
    });
});

// ---- delete, swipe, rebuild, reload ----------------------------------------------------------------------------------------------

/** Six replies: A and B read freely, C and D in strict mode (the switch changed before C), E and F freely again (it changed before E). */
async function six(t) {
    const h = await bluewatch(t);
    await h.say('Rats A.', [fight('Rats A')]);
    await h.say('Rats B.', [fight('Rats B')]);
    set(h, false);
    await h.say('Rats C.', [fight('Rats C')]);
    await h.say('Rats D.', [fight('Rats D')]);
    set(h, true);
    await h.say('Rats E.', [fight('Rats E')]);
    await h.say('Rats F.', [fight('Rats F')]);
    return h;
}
const SIX = { A: FREE('Rats A'), B: FREE('Rats B'), C: ONE('Rats C'), D: ONE('Rats D'), E: FREE('Rats E'), F: FREE('Rats F') };
const rowsOf = letters => letters.split('').map(letter => [SIX[letter]]);

for (const [label, gone] of [['the first free reply', 'A'], ['a middle one', 'B'], ['the one where the switch changed', 'C'], ['the one where it changed back', 'E'], ['the last', 'F']]) {
    test(`delete ${label}: every other reply is still read in its own mode, live, on a Re-read, on a rebuild and on a reload`, async t => {
        await seeded(9418, async () => {
            const h = await six(t);
            assert.deepEqual(foes(h), rowsOf('ABCDEF'));
            const index = at(h, `Rats ${gone}.`);
            await h.st.deleteMessage(index);
            await h.st.deleteMessage(index - 1);
            const rest = 'ABCDEF'.replace(gone, '');
            assert.deepEqual(foes(h), rowsOf(rest));
            assert.deepEqual(rest.split('').map(letter => modeAt(h, `Rats ${letter}.`)), rest.split('').map(letter => ('AB'.includes(letter) || 'EF'.includes(letter) ? 'free' : 'strict')));
            await agree(h, `deleted ${gone}`);
            for (const on of [false, true]) {
                set(h, on);
                for (const letter of rest) await reread(h, at(h, `Rats ${letter}.`));
                assert.deepEqual(foes(h), rowsOf(rest), `Re-read with the switch ${on ? 'on' : 'off'}`);
            }
            await agree(h, `deleted ${gone}, read again`);
        });
    });
}

test('swipe: a swiped reply is read afresh under the switch of its moment, stamps its own mode and leaves the others alone', async t => {
    await seeded(9422, async () => {
        const h = await six(t);
        set(h, false);
        await h.swipe(`Rats F, again.\n\n<Changes>\n${fight('Rats Fz')}\n</Changes>`);
        assert.deepEqual(foes(h).at(-1), [ONE('Rats Fz')], 'the new swipe is a new reading: the switch is off');
        assert.equal(modeAt(h, 'Rats F, again.'), 'strict');
        assert.deepEqual(foes(h).slice(0, 5), rowsOf('ABCDE'));
        assert.equal(stamps(h), 3, 'the stamp of the swiped-away reading went with it');
        set(h, true);
        await reread(h, at(h, 'Rats F, again.'));
        assert.deepEqual(foes(h).at(-1), [ONE('Rats Fz')]);
        await agree(h, 'swiped');
    });
});

test('a stamp is the host\'s own record: another module, a click and a stamp that is not whole are refused; a state with one is not whole', async t => {
    await seeded(9420, async () => {
        const h = await bluewatch(t);
        await h.say('Rats A.', [fight('Rats A')]);
        const before = JSON.stringify(h.head());
        const id = Object.keys(h.head().domains.rules).find(key => key.startsWith('mode.')).slice(5);
        const click = await h.sdk.command('rules.recordOffer', { write: 'wr_stamp001', mode: id, record: { v: 1, sid: sidAt(h, 'Rats A.'), mode: 'strict' } });
        assert.equal(click.ok, false);
        assert.equal(JSON.stringify(h.head()), before);
        const rules = structuredClone(h.head().domains.rules);
        assert.deepEqual(rulesProblems(rules).filter(error => /mode|stamp/.test(error)), []);
        rules[`mode.${id}`] = { v: 1, sid: 'sr_x', mode: 'maybe' };
        assert.ok(rulesProblems(rules).some(error => /modes/.test(error)));
    });
});

import { rulesProblems } from '../../../src/v2/rules/index.js';

test('a long chat of toggles: one small stamp for each reply read freely, and rebuild and reload equal live', async t => {
    await seeded(9410, async () => {
        const h = await bluewatch(t);
        for (let n = 1; n <= 12; n += 1) {
            set(h, n % 2 === 0);
            await h.say(`Rats ${n}.`, [fight(`Rats ${n}`)]);
        }
        assert.equal(stamps(h), 6, 'one for each reply read freely');
        // The fights on offer are the newest ten.
        assert.deepEqual(foes(h).map(([row]) => row), Array.from({ length: 10 }, (_, n) => ((n + 3) % 2 === 0 ? FREE(`Rats ${n + 3}`) : ONE(`Rats ${n + 3}`))));
        await agree(h, 'twelve toggles');
        assert.deepEqual(h.store.problems().filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), []);
    });
});
