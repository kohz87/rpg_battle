// "Jobs from the story" is fixed for a chat when its rules are pinned (rules/mode.js): every capture of the chat (live, Re-read edited or not, rebuild, reload) reads the mode it was pinned in, and so
// do the rules block, the cards and the queries, whatever the reader's switch says afterwards. A new pin takes the switch of its moment; a pin made before 2.3.0 records none and is strict.
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
const pinnedMode = h => h.head().domains.rules.mode;
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

// ---- the mode is recorded at the pin ------------------------------------------------------------------------------------------------

test('the pin records the switch of its moment: on is free, off is strict; the pin of a chat made before 2.3.0 records none and reads strict', async t => {
    await seeded(9430, async () => {
        assert.equal(pinnedMode(await bluewatch(t)), 'free');
        assert.equal(pinnedMode(await bluewatch(t, { settings: STRICT })), 'strict');
        assert.equal(modeOf({}), 'strict', 'no mode recorded');
        assert.equal(modeOf({ mode: 'free' }), 'free');
        assert.equal(modeOf({ mode: 'maybe' }), 'strict');
        const rules = structuredClone((await bluewatch(t)).head().domains.rules);
        assert.deepEqual(rulesProblems(rules).filter(error => /mode/.test(error)), []);
        rules.mode = 'maybe';
        assert.ok(rulesProblems(rules).some(error => /mode/.test(error)));
    });
});

for (const [name, line, strictLine, text] of CASES) {
    test(`${name}: read in a chat pinned with the switch on, then switched off: a Re-read of the unchanged reply gives the same state and receipts`, async t => {
        await seeded(9401, async () => {
            const h = await bluewatch(t);
            await h.say(text, [line]);
            const held = world(h);
            set(h, false);
            await reread(h, at(h, text));
            same(held, world(h));
            assert.deepEqual(h.store.problems(), []);
            assert.equal(pinnedMode(h), 'free', 'the chat keeps the mode it was pinned with');
        });
    });

    test(`${name}: read in a chat pinned with the switch off, then switched on: a Re-read of the unchanged reply gives the same state and receipts`, async t => {
        await seeded(9402, async () => {
            const h = await bluewatch(t, { settings: STRICT });
            await h.say(text, [strictLine]);
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

test('toggling the switch after the pin changes nothing in that chat: a reply written after it, a Re-read, a rebuild and a reload read the pinned mode', async t => {
    await seeded(9415, async () => {
        const h = await bluewatch(t);
        await h.say('Rats A.', [fight('Rats A')]);
        set(h, false);
        await h.say('Rats B.', [fight('Rats B')]);
        await h.say('Debts B.', [OFFER]);
        set(h, true);
        set(h, false);
        await h.say('Rats C.', [fight('Rats C')]);
        assert.deepEqual(foes(h), [[FREE('Rats A')], [FREE('Rats B')], [FREE('Rats C')]], 'every reply is read freely: the chat was pinned so');
        assert.equal(offerRecords(h).length, 1, 'and the job is an offer');
        await agree(h, 'live');
        for (const on of [false, true, false]) {
            set(h, on);
            for (const letter of 'ABC') {
                const held = world(h);
                await reread(h, at(h, `Rats ${letter}.`));
                same(held, world(h));
            }
        }
        for (const letter of 'ABC') {
            edit(h, at(h, `Rats ${letter}.`), `Rats ${letter} |`, `Rats ${letter}x |`);
            await reread(h, at(h, `Rats ${letter}.`));
        }
        assert.deepEqual(foes(h), [[FREE('Rats Ax')], [FREE('Rats Bx')], [FREE('Rats Cx')]]);
        await agree(h, 'after the Re-reads');
        assert.deepEqual(h.store.problems().filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), []);
    });
    await seeded(9416, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Rats A.', [fight('Rats A')]);
        set(h, true);
        await h.say('Rats B.', [fight('Rats B')]);
        await h.say('Debts B.', [OFFER]);
        assert.deepEqual(foes(h), [[ONE('Rats A')], [ONE('Rats B')]], 'every reply is read in strict mode: the chat was pinned so');
        assert.deepEqual(offerRecords(h), [], 'and the job is no offer');
        await agree(h, 'strict live');
        for (const letter of 'AB') await reread(h, at(h, `Rats ${letter}.`));
        assert.deepEqual(foes(h), [[ONE('Rats A')], [ONE('Rats B')]]);
        await agree(h, 'strict, read again');
    });
});

test('delete, swipe and a Re-read of other replies change no reply\'s mode: the mode is the chat\'s', async t => {
    await seeded(9418, async () => {
        const h = await bluewatch(t);
        for (const letter of 'ABCDEF') {
            if (letter === 'C') set(h, false);
            if (letter === 'E') set(h, true);
            await h.say(`Rats ${letter}.`, [fight(`Rats ${letter}`)]);
        }
        const all = 'ABCDEF'.split('').map(letter => [FREE(`Rats ${letter}`)]);
        assert.deepEqual(foes(h), all);
        let left = 'ABCDEF';
        for (const gone of ['A', 'C', 'F']) {
            const index = at(h, `Rats ${gone}.`);
            await h.st.deleteMessage(index);
            await h.st.deleteMessage(index - 1);
            left = left.replace(gone, '');
            assert.deepEqual(foes(h), left.split('').map(letter => [FREE(`Rats ${letter}`)]), `${gone} deleted`);
            await agree(h, `deleted ${gone}`);
            for (const letter of left) await reread(h, at(h, `Rats ${letter}.`));
            assert.deepEqual(foes(h), left.split('').map(letter => [FREE(`Rats ${letter}`)]), `${gone} deleted, the rest read again`);
        }
        set(h, false);
        await h.swipe(`Rats F, again.\n\n<Changes>\n${fight('Rats Fz')}\n</Changes>`);
        assert.deepEqual(foes(h).at(-1), [FREE('Rats Fz')], 'a swiped reply is read in the pinned mode');
        await agree(h, 'swiped');
    });
});

// ---- edited lines are read in the mode of their chat --------------------------------------------------------------------------------

test('an edited line is read in the chat\'s pinned mode, whatever the switch says now: in both directions, for a fight, an offer and a teacher', async t => {
    await seeded(9405, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Rats.', [fight('Rats Of Doom')]);
        set(h, true);
        edit(h, at(h, 'Rats.'), 'Rats Of Doom', 'Rats Of Ruin');
        await reread(h, at(h, 'Rats.'));
        assert.deepEqual(foes(h), [[ONE('Rats Of Ruin')]], 'strict chat: one foe called "3 Rats Of Ruin"');
    });
    await seeded(9406, async () => {
        const h = await bluewatch(t);
        await h.say('Rats.', [fight('Rats Of Doom')]);
        set(h, false);
        edit(h, at(h, 'Rats.'), 'Rats Of Doom', 'Rats Of Ruin');
        await reread(h, at(h, 'Rats.'));
        assert.deepEqual(foes(h), [[FREE('Rats Of Ruin')]], 'free chat: three of them');
    });
    await seeded(9408, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Rats in the cellar.', [LIKE]);
        assert.deepEqual(offerRecords(h), []);
        set(h, true);
        edit(h, at(h, 'Rats in the cellar.'), 'foe: cellar-rat-swarm', 'foe: cellar-rat-swarm | reward: 90 copper');
        await reread(h, at(h, 'Rats in the cellar.'));
        assert.deepEqual(offerRecords(h), [], 'strict chat: 2.2.0\'s reading, which has no place for a reward');
    });
    await seeded(9409, async () => {
        const h = await bluewatch(t);
        await h.say('Rats in the cellar.', [LIKE]);
        assert.equal(offerRecords(h).length, 1);
        set(h, false);
        edit(h, at(h, 'Rats in the cellar.'), 'foe: cellar-rat-swarm', 'foe: cellar-rat-swarm | reward: 90 copper');
        await reread(h, at(h, 'Rats in the cellar.'));
        assert.equal(offerRecords(h).length, 1, 'free chat: read as an offer, with the reward it names');
    });
    await seeded(9412, async () => {
        const h = await bluewatch(t);
        await h.say('Reka offers drills.', ['+ trainer Old Reka | like: open-blade-drills']);
        set(h, false);
        edit(h, at(h, 'Reka offers drills.'), 'like: open-blade-drills', 'like: open-blade-drills | fee: 6 silver');
        await reread(h, at(h, 'Reka offers drills.'));
        assert.equal(teachers(h)[0]?.settled?.feeBy, 'said', 'free chat: the fee it names stands');
    });
    await seeded(9413, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Reka offers drills.', ['+ trainer Old Reka | like: open-blade-drills']);
        set(h, true);
        edit(h, at(h, 'Reka offers drills.'), 'like: open-blade-drills', 'like: open-blade-drills | fee: 6 silver');
        await reread(h, at(h, 'Reka offers drills.'));
        assert.equal(teachers(h)[0]?.settled, undefined, 'strict chat: 2.2.0\'s reading');
    });
});

test('a whitespace-only edit is no different from no edit: the reply is read in the chat\'s mode, the line the same', async t => {
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

test('a reply of 120 lines is read in the chat\'s mode from its first line to its last, on a Re-read under either switch', async t => {
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
        await agree(h, '120 lines');
    });
});

// ---- what the narrator is shown follows the pinned mode ------------------------------------------------------------------------------------

import { lastTail } from './helpers/bluewatch.js';
import { modeOf, rulesProblems } from '../../../src/v2/rules/index.js';

test('the rules block, the quests\' tail and the queries of the feature follow the mode the chat was pinned in, not the switch of the moment', async t => {
    await seeded(9431, async () => {
        const h = await bluewatch(t);
        await h.say('Quiet.');
        assert.equal(h.q('quest.offerBlockOn', {}), true);
        assert.ok(h.q('quest.offerBlock', {}));
        const tail = lastTail(h);
        assert.doesNotMatch(tail, /Open quest: \+ quest Name \| like:/, 'the block says how to write a job');
        set(h, false);
        await h.say('Quiet again.');
        assert.equal(h.q('quest.offerBlockOn', {}), true, 'still on for this chat');
        assert.ok(h.q('quest.offerBlock', {}));
        assert.doesNotMatch(lastTail(h), /Open quest: \+ quest Name \| like:/);
        assert.ok(h.q('quest.adjustments', {}), 'the log is there');
    });
    await seeded(9432, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Quiet.');
        assert.ok(h.q('quest.offerBlockOn', {}) !== true);
        assert.equal(h.q('quest.offerBlock', {}), null);
        assert.match(lastTail(h), /Open quest: \+ quest Name \| like:/, 'the frozen forms, as before');
        set(h, true);
        await h.say('Quiet again.');
        assert.ok(h.q('quest.offerBlockOn', {}) !== true, 'still off for this chat');
        assert.equal(h.q('quest.offerBlock', {}), null);
        assert.match(lastTail(h), /Open quest: \+ quest Name \| like:/);
        assert.equal(h.q('quest.adjustments', {}), null);
    });
});
