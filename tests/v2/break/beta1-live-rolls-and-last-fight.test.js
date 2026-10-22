// beta.1 live test, the reader's notes:
//
// 1. "there's no way for us to know the rolls?" A reply wrote `? check AGI — pursuing the wounded wolf |
//    dc: 10 | roll: 1 | result: success` (and a second check also naming `roll: 1`); `roll: 1` is "Roll 1",
//    the first die handed over, and the dice were shown only on RPG Battle's own status card, which is off by
//    default. Fixed: each check is a line on the reply's "Changed this reply" card (Story Block's
//    hooks.replyCard, MODULES §F123; checks/card.js): skill and stat, the d20 and which roll it was, the
//    modifiers, the total against the DC, code's outcome, and "Story said …; dice said …" when the written
//    result disagrees. Code's outcome is the one kept. The dice handed over are in Settings → Diagnostics.
// 2. "it still shows the last battle result after 2 more messages". Fixed: the Fight screen shows the last
//    fight in full only on the reply it settled on and the one that tells it; before any later reply it is
//    folded (combat.fold), "No fight on offer" with "Last fight" closed under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playOut, rpgHost, seeded } from '../integration/helpers/host.js';
import { changesSummary, replyCardLines } from '../../vendor/story-block/src/v2/screens/index.js';
import { replyCard } from '../../../src/v2/checks/card.js';
import { settleBeforeReply } from '../../../src/v2/combat/index.js';
import { statusCardScreen } from '../../../src/v2/screens/index.js';

const KIND = { crit: 'success', success: 'success', cost: 'cost', fail: 'fail', critfail: 'fail' };
const WORDS = { crit: 'critical success', success: 'success', cost: 'success, at a cost', fail: 'fail', critfail: 'critical fail' };

/** The lines Story Block's card gets for the reply at `index`, through the host's registry (as ui-host asks). */
const cardLines = (host, index) => replyCardLines(host.registry.hookEntries('replyCard'), { index, state: host.store.at(index), changes: host.store.changesAt(index) });
const lastIndex = host => host.ctx.chat.length - 1;
const entriesAt = (host, index) => Object.values(host.store.at(index).domains.checks.log)
    .filter(entry => host.store.changesAt(index).some(path => path.startsWith(`/domains/checks/log/${entry.id}`)))
    .sort((a, b) => a.rev - b.rev);

const USER_CHECKS = [
    '? check AGI — pursuing the wounded wolf | dc: 10 | roll: 1 | result: success',
    '? check perception — spotting where it went to ground | dc: 40 | roll: 1 | result: success',
];

test('the reply\'s checks on "Changed this reply": the die, which roll, modifiers, total vs DC, code\'s outcome, a disagreement told', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(21, async () => {
        const host = await rpgHost();
        try {
            assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
            await host.send('After it!', host.reply('Wessel runs the wolf down.', USER_CHECKS));
            const index = lastIndex(host);
            const handed = host.q('checks.rolls').rolls;
            const entries = entriesAt(host, index);
            assert.equal(entries.length, 2, 'both checks count');
            const lines = cardLines(host, index);
            assert.equal(lines.length, 2);
            assert.ok(lines.every(line => line.module === 'rpg-battle' && line.icon === 'fa-dice-d20'));
            entries.forEach((entry, n) => {
                const line = lines[n];
                // Roll 1 for the first check, Roll 2 for the second, whatever the line named (B-b4-2).
                assert.equal(entry.roll, n + 1);
                assert.equal(entry.die, handed[n]);
                const mods = entry.modifiers.map(mod => ` ${mod.amount < 0 ? '−' : '+'} ${Math.abs(mod.amount)} ${mod.reason}`).join('');
                assert.ok(line.text.startsWith('Wessel, '), line.text);
                assert.ok(line.text.includes(`: d20 ${entry.die} (Roll ${n + 1})${mods} = ${entry.total} vs DC ${entry.dc} → ${WORDS[entry.outcome]}`), line.text);
                assert.equal(entry.total, entry.die + entry.mod);
                assert.ok(line.summary.endsWith(`${entry.total} vs DC ${entry.dc}: ${WORDS[entry.outcome]}${line.flag ? ' (story said otherwise)' : ''}`), line.summary);
                // The written result is only compared: code's outcome is kept, a disagreement told.
                assert.equal(entry.said, 'success');
                assert.equal(line.flag, KIND[entry.outcome] === 'success' ? '' : `Story said success; dice said ${WORDS[entry.outcome]}`);
            });
            assert.match(lines[0].text, /AGI — pursuing the wounded wolf/);
            assert.match(lines[1].text, /Perception \(\w+\) — spotting where it went to ground/);
            assert.match(lines[1].note, /named Roll 1, but this is the reply's second check: Roll 2 taken/);
            // DC 40 cannot be reached but by a natural 20: the story's "success" is flagged otherwise.
            if (entries[1].die !== 20) assert.match(lines[1].flag, /^Story said success; dice said (fail|critical fail)$/);
            // The folded header tells them after the rest.
            const header = changesSummary({ state: host.store.at(index), changes: host.store.changesAt(index), lines });
            assert.ok(header.includes(lines[0].summary) && header.includes(lines[1].summary), header);
            // Nothing is a Problem: both lines were used.
            assert.equal((host.turn.problems?.() ?? []).filter(problem => problem.index === index).length, 0);

            // A Re-read of the same text: the same dice, the same lines.
            const before = JSON.stringify(lines);
            assert.equal((await host.sdk.reread(index)).ok, true);
            assert.equal(JSON.stringify(cardLines(host, index)), before, 'Re-read reads the same checks');

            // The next reply rolled nothing: its card has no check, the earlier reply keeps its own.
            await host.send('Rest.', host.reply('They catch their breath.'));
            const next = lastIndex(host);
            assert.deepEqual(cardLines(host, next), []);
            assert.equal(changesSummary({ state: host.store.at(next), changes: host.store.changesAt(next), lines: [] }), 'No changes');
            assert.equal(JSON.stringify(cardLines(host, index)), before);

            // A swipe brings fresh dice and its own checks only.
            await host.swipe(host.reply('Wessel climbs a ledge instead.', ['? check athletics — up the ledge | dc: 15 | roll: 1 | result: fail']));
            const swiped = cardLines(host, next);
            assert.equal(swiped.length, 1);
            const [entry] = entriesAt(host, next);
            assert.equal(entry.die, host.q('checks.rolls').rolls[0]);
            assert.match(swiped[0].text, /^Wessel, Athletics \(STR\) — up the ledge: d20 \d+ \(Roll 1\)/);
            assert.equal(swiped[0].flag, KIND[entry.outcome] === 'fail' ? '' : `Story said fail; dice said ${WORDS[entry.outcome]}`);
            assert.equal(JSON.stringify(cardLines(host, index)), before, 'the earlier reply still shows its own');

            // Replay equals live.
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
        } finally {
            host.close();
        }
    });
});

test('the dice handed over are in Diagnostics (behind a click), never in the reply\'s card; numbers only', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(22, async () => {
        const host = await rpgHost();
        try {
            assert.deepEqual(host.module.hooks.diagnostics(), ['Dice: none handed over yet (they are rolled when a reply starts).']);
            assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
            await host.send('Look.', host.reply('Wessel looks around.', ['? check perception — the treeline | dc: 10 | roll: 1 | result: success']));
            const { rolls, for: at } = host.q('checks.rolls');
            const lines = host.module.hooks.diagnostics();
            assert.deepEqual(lines, [
                `Dice handed over for the latest reply (message ${at}): Roll 1 = ${rolls[0]} · Roll 2 = ${rolls[1]}.`,
                'Taken by a check: Roll 1.',
                'Every new reply, swipe or regenerate rolls fresh dice when it starts; a Continue keeps them.',
            ]);
            assert.ok(!lines.join(' ').includes('treeline'), 'no story words');
            // The hook is registered for Story Block's Diagnostics fold.
            assert.ok(host.registry.hookEntries('diagnostics').some(entry => entry.moduleId === 'rpg-battle'));
            // The tail hands over the reply's own dice only (unchanged); the card shows no dice still to come.
            assert.ok(cardLines(host, lastIndex(host)).every(line => !line.text.includes('Roll 2')));
        } finally {
            host.close();
        }
    });
});

test('replyCard: an older chat\'s whole-log write shows that reply\'s entries; no checks, no lines', () => {
    const entry = (id, carrier, rev) => ({ id, actor: 'ac_ren00001', name: 'Ren', skill: 'stealth', stat: 'DEX', dc: 15, word: 'normal', what: 'past the gate', rev, carrier, roll: 1, die: 9, modifiers: [{ source: 'stat', amount: 2, reason: 'DEX' }], mod: 2, total: 11, outcome: 'fail', said: null, note: '' });
    const state = { domains: { party: { pc: 'ac_ren00001', actors: {} }, checks: { prepared: {}, log: { ck_a: entry('ck_a', 'old', 1), ck_b: entry('ck_b', 'new', 2) } } } };
    assert.deepEqual(replyCard({ state, changes: ['/domains/checks/log'] }).map(line => line.text), ['Ren, Stealth (DEX) — past the gate: d20 9 (Roll 1) + 2 DEX = 11 vs DC 15 (normal) → fail']);
    assert.deepEqual(replyCard({ state, changes: ['/domains/party/actors/ac_ren00001/hp'] }), []);
    assert.deepEqual(replyCard({ state: null, changes: null }), []);
    // A result kept before `said` existed keeps its own note as the flag.
    const old = { ...entry('ck_c', 'x', 3), said: undefined, mismatch: 'narrated as success, the dice say fail' };
    delete old.said;
    assert.equal(replyCard({ state: { domains: { checks: { log: { ck_c: old } } } }, changes: ['/domains/checks/log/ck_c'] })[0].flag, 'Narrated as success, the dice say fail');
});

// ---------------------------------------------------------------------------------------------------
// 2. The last fight folds once the story has moved on

/** A character, an offered fight, started and played out (not finished on the board). */
async function foughtOut(host) {
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    await host.send('On.', host.reply('Wolves.', ['~ place Ridge Road | kind: road', '! encounter 2 Wolf — circling | tier: trivial']));
    const [offer] = host.q('combat.offers');
    assert.equal((await host.cmd('combat.start', { offer: offer.id })).ok, true);
    await playOut(host);
    return lastIndex(host);
}

const folds = host => host.sdk.receipts().map(entry => entry.receipt).filter(receipt => receipt.type === 'combat.fold');

test('settled before the next reply: shown in full on that reply, folded before the one after; once; replay equals live', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(23, async () => {
        const host = await rpgHost();
        try {
            const fought = await foughtOut(host);
            await host.send('We walk on.', host.reply('The road is quiet.'));
            const last = host.q('combat.last');
            assert.ok(last, 'settled by the cue');
            assert.equal(last.reply.index, fought, 'kept on the reply it was fought on');
            assert.equal(last.folded, false, 'the reply that tells it shows it in full');
            // A swipe or a regenerate of the reply that tells it: still news.
            await host.swipe(host.reply('The road bends.'));
            assert.equal(host.q('combat.last').folded, false);
            await host.regenerate(host.reply('The road climbs.'));
            assert.equal(host.q('combat.last').folded, false);
            assert.equal(folds(host).length, 0);
            // The reader's next message: the fight is old news.
            await host.send('Further.', host.reply('Pines.'));
            assert.equal(host.q('combat.last').folded, true);
            assert.equal(folds(host).length, 1);
            assert.equal(folds(host)[0].cause, 'system');
            await host.send('Still further.', host.reply('Rocks.'));
            assert.equal(folds(host).length, 1, 'folded once');
            assert.equal(host.q('combat.last').folded, true);
            // Never from a click.
            assert.equal((await host.cmd('combat.fold', {})).code, 'REFUSED');
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
            // Deleting back to the reply that told it: the fold was kept on that reply, so it stays folded
            // (live and rebuilt alike); deleting that reply too brings the result back in full.
            const end = lastIndex(host);
            await host.st.deleteMessage(end);
            await host.st.deleteMessage(end - 1);
            await host.st.deleteMessage(end - 2);
            await host.st.deleteMessage(end - 3);
            const told = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), told);
            await host.st.deleteMessage(lastIndex(host));
            await host.st.deleteMessage(lastIndex(host));
            assert.equal(lastIndex(host), fought);
            assert.equal(host.q('combat.last').folded, false, 'on the fight\'s own reply it is news again');
        } finally {
            host.close();
        }
    });
});

test('Finish pressed: the next reply still shows it in full; the one after folds it', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(24, async () => {
        const host = await rpgHost();
        try {
            await foughtOut(host);
            assert.equal((await host.cmd('combat.end', {})).ok, true);
            assert.equal(host.q('combat.last').fresh, true, 'the head is the reply it settled on');
            await host.send('We walk on.', host.reply('The road is quiet.'));
            assert.equal(host.q('combat.last').folded, false, 'the reply that tells it');
            assert.equal(host.q('combat.last').fresh, false);
            await host.send('Further.', host.reply('Pines.'));
            assert.equal(host.q('combat.last').folded, true);
            assert.equal(folds(host).length, 1);
        } finally {
            host.close();
        }
    });
});

test('settleBeforeReply folds only a result that is not news, only for a new reply; an older chat\'s result folds at once', () => {
    const view = last => ({ state: { domains: { combat: { fights: {}, last: [last] } } }, query: () => last });
    const old = { summary: 'Victory.', moments: [], rev: 7, folded: false, fresh: false };
    assert.deepEqual(settleBeforeReply(view(old), { type: 'normal' }), { commands: [{ type: 'combat.fold', payload: { rev: 7 } }] });
    assert.deepEqual(settleBeforeReply(view(old), { type: 'regenerate' }), { commands: [{ type: 'combat.fold', payload: { rev: 7 } }] });
    for (const type of ['swipe', 'continue', 'quiet', 'impersonate']) assert.deepEqual(settleBeforeReply(view(old), { type }), { commands: [] }, type);
    assert.deepEqual(settleBeforeReply(view({ ...old, fresh: true }), { type: 'normal' }), { commands: [] }, 'still news');
    assert.deepEqual(settleBeforeReply(view({ ...old, fresh: null }), { type: 'normal' }), { commands: [] }, 'unknown: left as it is');
    assert.deepEqual(settleBeforeReply(view({ ...old, folded: true }), { type: 'normal' }), { commands: [] }, 'folded already');
    // RPG Battle's status card never shows a fight's result (only HP, conditions and what the reply changed).
    assert.ok(!/combat|last/i.test(statusCardScreen.template));
});
