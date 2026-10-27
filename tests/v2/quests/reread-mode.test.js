// A Re-read of an unchanged line is decided as the line was first read, whatever the reader's "Jobs from the story" switch says now (Story Block runs a line that made a
// change before with every feature on, so the route taken at the first read is kept with the line); an edited line is read under the setting of the moment.
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

const OFFER = '+ quest Old Debts | giver: Marrit | goal: Settle the matter with the river guild | reward: 80 copper | due: in 3 days';
const LIKE = '+ quest Rat Trouble | like: open-hunt-f | foe: cellar-rat-swarm';
const TEACHER = '+ trainer Old Reka — blade drills';
const FIGHT = '! encounter 3 Rats Of Doom | like: cellar-rat-swarm';

// [what it is, the line read with the switch on, the line that does something in strict mode too, the reply's text]
const CASES = [
    ['an offer the story wrote', OFFER, LIKE, 'The river guild is owed.'],
    ['a named kind of an open template', LIKE, LIKE, 'Rats in the cellar.'],
    ['a teacher', TEACHER, '+ trainer Old Reka | like: open-blade-drills', 'Reka offers drills.'],
];

for (const [name, line, strictLine, text] of CASES) {
    test(`${name}: first read with the switch on, switched off, Re-read unchanged: the same state and receipts`, async t => {
        await seeded(9401, async () => {
            const h = await bluewatch(t);
            await h.say(text, [line]);
            const held = world(h);
            set(h, false);
            await reread(h, at(h, text));
            same(held, world(h));
            assert.deepEqual(h.store.problems(), []);
        });
    });

    test(`${name}: first read in strict mode, switched on, Re-read unchanged: the same state and receipts`, async t => {
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

test('a free-form line that did nothing in strict mode is read afresh when the switch is on: nothing was decided for the Re-read to keep', async t => {
    await seeded(9407, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('The river guild is owed.', [OFFER]);
        assert.equal(Object.keys(h.head().domains.rules).some(key => key.startsWith('offer.')), false);
        assert.ok(h.turn.problems().length > 0, 'the line is a Problem');
        set(h, true);
        await reread(h, at(h, 'The river guild is owed.'));
        assert.equal(Object.keys(h.head().domains.rules).some(key => key.startsWith('offer.')), true);
    });
});

test('a count in front of a named kind: read with the switch on stays read so when the switch goes off, and 2.2.0\'s reading stays when it goes on', async t => {
    const foes = h => h.q('combat.offers').map(offer => offer.foes.map(foe => [foe.name, foe.count]));
    await seeded(9403, async () => {
        const h = await bluewatch(t);
        await h.say('Rats.', [FIGHT]);
        assert.deepEqual(foes(h), [[['Rats Of Doom', 3]]]);
        set(h, false);
        await reread(h, at(h, 'Rats.'));
        assert.deepEqual(foes(h), [[['Rats Of Doom', 3]]]);
    });
    await seeded(9404, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Rats.', [FIGHT]);
        assert.deepEqual(foes(h), [[['3 Rats Of Doom', 1]]]);
        set(h, true);
        await reread(h, at(h, 'Rats.'));
        assert.deepEqual(foes(h), [[['3 Rats Of Doom', 1]]]);
    });
});

test('an edited line is read under the setting of the moment', async t => {
    await seeded(9405, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Rats.', [FIGHT]);
        set(h, true);
        edit(h, at(h, 'Rats.'), 'Rats Of Doom', 'Rats Of Ruin');
        await reread(h, at(h, 'Rats.'));
        assert.deepEqual(h.q('combat.offers').map(offer => offer.foes.map(foe => [foe.name, foe.count])), [[['Rats Of Ruin', 3]]]);
    });
    await seeded(9406, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('The river guild is owed.', [OFFER]);
        assert.equal(Object.keys(h.head().domains.rules).filter(key => key.startsWith('offer.')).length, 0, 'strict mode makes no offer of a free-form line');
        set(h, true);
        edit(h, at(h, 'The river guild is owed.'), 'reward: 80 copper', 'reward: 90 copper');
        await reread(h, at(h, 'The river guild is owed.'));
        assert.equal(Object.keys(h.head().domains.rules).filter(key => key.startsWith('offer.')).length, 1, 'the edited line is read with the switch on');
    });
});

// ---- an edited line is a new line -------------------------------------------------------------------------------------------

const offerRecords = h => Object.keys(h.head().domains.rules).filter(key => key.startsWith('offer.'));
const teachers = h => Object.values(h.head().domains.training.offers ?? {});

test('an edited quest line is read under the setting of the moment, in both directions; an unchanged one keeps its route', async t => {
    await seeded(9408, async () => {
        // First read in strict mode (2.2.0's reading), switch on, edit the line: it is a new line, read freely.
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Rats in the cellar.', [LIKE]);
        assert.deepEqual(offerRecords(h), []);
        set(h, true);
        await reread(h, at(h, 'Rats in the cellar.'));
        assert.deepEqual(offerRecords(h), [], 'unchanged: still 2.2.0\'s reading');
        edit(h, at(h, 'Rats in the cellar.'), 'foe: cellar-rat-swarm', 'foe: cellar-rat-swarm | reward: 90 copper');
        await reread(h, at(h, 'Rats in the cellar.'));
        assert.equal(offerRecords(h).length, 1, 'edited: read with the switch on');
        // And back: read freely, switched off, edited: read the 2.2.0 way (which has no place for a reward).
        set(h, false);
        await reread(h, at(h, 'Rats in the cellar.'));
        assert.equal(offerRecords(h).length, 1, 'unchanged: still the free reading');
        edit(h, at(h, 'Rats in the cellar.'), 'reward: 90 copper', 'reward: 95 copper');
        await reread(h, at(h, 'Rats in the cellar.'));
        assert.deepEqual(offerRecords(h), [], 'edited: read with the switch off');
    });
});

test('an edited teacher line is read under the setting of the moment, in both directions', async t => {
    await seeded(9409, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Reka offers drills.', ['+ trainer Old Reka | like: open-blade-drills']);
        assert.equal(teachers(h).length, 1);
        assert.equal(teachers(h)[0].settled, undefined);
        set(h, true);
        await reread(h, at(h, 'Reka offers drills.'));
        assert.equal(teachers(h)[0].settled, undefined, 'unchanged: still 2.2.0\'s reading');
        edit(h, at(h, 'Reka offers drills.'), 'like: open-blade-drills', 'like: open-blade-drills | fee: 6 silver');
        await reread(h, at(h, 'Reka offers drills.'));
        assert.equal(teachers(h)[0]?.settled?.feeBy, 'said', 'edited: read with the switch on, and the fee it names stands');
        set(h, false);
        await reread(h, at(h, 'Reka offers drills.'));
        assert.equal(teachers(h)[0]?.settled?.feeBy, 'said', 'unchanged: still the free reading');
        edit(h, at(h, 'Reka offers drills.'), 'fee: 6 silver', 'fee: 7 silver');
        await reread(h, at(h, 'Reka offers drills.'));
        assert.deepEqual(teachers(h), [], 'edited: read with the switch off, which takes no fee');
    });
});

// ---- a long chat ----------------------------------------------------------------------------------------------------------------

import { rulesProblems } from '../../../src/v2/rules/index.js';
import { ROUTE_KEY, offersProblems } from '../../../src/v2/rules/offers.js';

test('the routes of a long chat never stop a capture: 2,500 replies with a route, and the rules domain still holds', async t => {
    await seeded(9410, async () => {
        const h = await bluewatch(t);
        await h.say('Rats.', [FIGHT]);
        const rules = structuredClone(h.head().domains.rules);
        const [id] = Object.keys(rules).filter(key => key.startsWith(ROUTE_KEY));
        assert.ok(id, 'a route is kept');
        for (let n = 0; n < 2500; n += 1) rules[`${ROUTE_KEY}rt_${n.toString(16).padStart(12, '0')}`] = { v: 1, sid: `sr_${n}`, lines: { [n.toString(16).padStart(16, '0')]: n % 2 ? 'on' : 'off' } };
        assert.deepEqual(offersProblems(rules), []);
        assert.deepEqual(rulesProblems(rules).filter(error => /route|rest|more than/.test(error)), []);
        // Not a cap in disguise: a route that is not whole is still a Problem.
        assert.ok(offersProblems({ ...rules, [`${ROUTE_KEY}rt_ffffffffffff`]: { v: 1, sid: 'sr_x', lines: { bad: 'on' } } }).length > 0);
    });
});

test('routes go with their replies: delete a reply in the middle of a run of routed replies, then rebuild and reload: the state equals the live chat', async t => {
    await seeded(9411, async () => {
        const h = await bluewatch(t);
        for (let n = 1; n <= 12; n += 1) await h.say(`Rats ${n}.`, [`! encounter ${n} Rats ${n} | like: cellar-rat-swarm`]);
        const routes = () => Object.keys(h.head().domains.rules).filter(key => key.startsWith(ROUTE_KEY)).length;
        assert.equal(routes(), 12);
        const index = at(h, 'Rats 6.');
        await h.st.deleteMessage(index);
        await h.st.deleteMessage(index - 1);
        assert.equal(routes(), 11, 'the route of the deleted reply went with it');
        const live = JSON.stringify(h.head());
        h.store.rebuild();
        assert.equal(JSON.stringify(h.head()), live, 'rebuild equals live');
        await h.st.loadChat(JSON.parse(JSON.stringify(h.ctx.chat)));
        assert.equal(JSON.stringify(h.head()), live, 'reload equals live');
        assert.deepEqual(h.store.problems(), []);
    });
});
