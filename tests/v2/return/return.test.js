// The return part (MODULES §F17): where Return goes, the rewind it asks of Story Block, the cue
// told once on the new branch, and generation held while your character is dead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aliveState, createHost, FIGHT, killed, OTHER_FIGHT, runCommand } from './helpers/fake-host.js';
import { canGenerate, DEAD_REASON, findReturnPoint, isDead, logFromChat, part, returnInTime } from '../../../src/v2/return/index.js';

/**
 * greeting (0, rev 1) → [an earlier won fight on reply 2] → the fatal reply: encounter, [two
 * clicks], combat.start, combat.act, [a user message mid-fight and another reply], combat.end lost.
 */
function fatal(host, { uiBefore = false, earlierWin = false, place = null, acrossReplies = false } = {}) {
    host.greeting(aliveState());
    if (earlierWin) {
        host.user().reply('Wolves.');
        host.receipt('encounter', { offer: 'en_aaaaaaaa' }, { cause: 'story' });
        host.receipt('combat.start', { session: OTHER_FIGHT, offer: 'en_aaaaaaaa', made: [] });
        host.receipt('combat.end', { session: OTHER_FIGHT, outcome: 'won' });
    }
    host.user().reply('Rats boil out of the bins.');
    host.receipt('encounter', { offer: 'en_bbbbbbbb' }, { cause: 'story' });
    if (uiBefore) {
        host.receipt('item.use', { stack: 'it_aaaaaaaa' });
        host.receipt('item.equip', { stack: 'it_bbbbbbbb' });
    }
    host.receipt('combat.start', { session: FIGHT, offer: 'en_bbbbbbbb', made: [], ...(place ? { place } : {}) });
    host.receipt('combat.act', { session: FIGHT, status: 'active' });
    if (acrossReplies) host.user('I keep swinging.').reply('Steel rings.');
    host.receipt('combat.end', { session: FIGHT, outcome: 'lost' }, { state: killed(host.head) });
    return host;
}

const carriers = host => host.chat.map((message, index) => (message.is_user ? null : index)).filter(index => index !== null);

test('death is read from the party: party.applyResult with death stakes marks your character dead', () => {
    const alive = aliveState();
    assert.equal(isDead(alive), false);
    assert.equal(isDead(killed(alive)), true);
    assert.equal(isDead({ domains: {} }), false, 'no character yet is not dead');
    // A lost fight that is not to the death leaves your character alive.
    const pc = alive.domains.party.actors[alive.domains.party.pc];
    const lost = runCommand(alive, (ctx, payload) => ctx.call('party.applyResult', payload), {
        outcome: 'defeat', stakes: 'normal', actors: [{ id: pc.id, hp: { cur: 1, max: pc.hp.max }, mp: { ...pc.mp }, down: true, conditions: [], uses: {} }],
    });
    assert.ok(lost.ok, lost.message);
    assert.equal(isDead(lost.state), false);
});

test('return.point: a single fight goes back to its reply, just before combat.start', () => {
    const host = fatal(createHost());
    const fatalReply = carriers(host)[1];
    assert.deepEqual(host.sdk.query('return.point'), { index: fatalReply, beforeRev: 3, place: 'the Old Weir', fight: FIGHT });
});

test('return.point: after other clicks on the same reply, only the fight is dropped; an earlier fight is not the one', () => {
    const host = fatal(createHost(), { uiBefore: true, earlierWin: true, place: 'Granary Cellar' });
    const fatalReply = carriers(host)[2];
    // rev 1 greeting; 2-4 the won fight; 5 encounter, 6 item.use, 7 item.equip, 8 combat.start.
    assert.deepEqual(host.sdk.query('return.point'), { index: fatalReply, beforeRev: 8, place: 'Granary Cellar', fight: FIGHT });
});

test('return.point: a fight that went on over a later reply still returns to the reply it began on', () => {
    const host = fatal(createHost(), { acrossReplies: true });
    const point = host.sdk.query('return.point');
    assert.equal(point.index, carriers(host)[1]);
    assert.equal(point.beforeRev, 3);
});

test('return.point: none while your character lives, nor when the receipts do not show the fight', () => {
    const host = fatal(createHost());
    const log = host.sdk.receipts();
    assert.equal(findReturnPoint(aliveState(), log), null, 'alive');
    // Dead, but the receipts hold no lost fight, or no start for it.
    assert.equal(findReturnPoint(host.head, []), null);
    assert.equal(findReturnPoint(host.head, log.filter(entry => entry.receipt.type !== 'combat.start')), null);
    assert.equal(findReturnPoint(host.head, log.filter(entry => entry.receipt.type !== 'combat.end')), null);
    // Receipts after this state's rev (a later line) are not read.
    assert.equal(findReturnPoint({ ...host.head, meta: { ...host.head.meta, rev: 4 } }, log), null);
    // Another module's receipt of the same type is not RPG Battle's fight.
    const foreign = log.map(entry => (entry.receipt.type === 'combat.start' ? { ...entry, receipt: { ...entry.receipt, module: 'other' } } : entry));
    assert.equal(findReturnPoint(host.head, foreign), null);
    // A fresh alive chat: null through the query too.
    const quiet = createHost().greeting(aliveState());
    assert.equal(quiet.sdk.query('return.point'), null);
});

test('return.point reads the query tools first, then the sdk\'s receipts, then its chat', () => {
    const host = fatal(createHost());
    const expected = host.sdk.query('return.point');
    const query = part.queries['return.point'];
    // tools.receipts() given by the host to queries.
    assert.deepEqual(query(host.head, undefined, { receipts: () => host.sdk.receipts() }), expected);
    // The sdk's chat() when it gives no receipts().
    const chatOnly = fatal(createHost({ withReceipts: false }));
    assert.deepEqual(chatOnly.sdk.query('return.point'), expected);
    // Neither: no point.
    const blind = fatal(createHost({ withReceipts: false, withChat: false }));
    assert.equal(blind.sdk.query('return.point'), null);
});

test('logFromChat reads carriers as the store does: no user messages, no record copied into another swipe', () => {
    const receipt = rev => ({ id: `rc_0000000${rev}`, type: 't', module: 'rpg-battle', cause: 'ui', seed: 1, summary: '', narrate: false, data: {}, rev });
    const record = (rev, extra = {}) => ({ v: 2, sid: `sw_${rev}`, ops: [], receipts: [receipt(rev)], narrated: [], ...extra });
    const shown = { storySuite: record(3, { swipe: 0 }) };
    const copied = { storySuite: record(4, { swipe: 0 }) };
    const chat = [
        { is_user: false, extra: { storySuite: record(1) } },
        { is_user: true, extra: { storySuite: record(2) } },
        { is_user: false, swipe_id: 0, extra: shown, swipe_info: [{ extra: shown }] },
        // SillyTavern copied swipe 0's extra into swipe 1, which is shown: not this swipe's record.
        { is_user: false, swipe_id: 1, extra: { storySuite: { ...copied.storySuite } }, swipe_info: [{ extra: copied }, { extra: {} }] },
        { is_user: false, extra: { storySuite: { v: 1, receipts: [receipt(5)] } } },
        null,
    ];
    assert.deepEqual(logFromChat(chat).map(entry => [entry.index, entry.receipt.rev]), [[0, 1], [2, 3]]);
    assert.deepEqual(logFromChat(undefined), []);
});

test('Return: rewinds to the point, then tells the cue once on the new branch', async () => {
    const host = fatal(createHost(), { uiBefore: true });
    const point = host.sdk.query('return.point');
    const result = await returnInTime(host.sdk);
    assert.ok(result.ok, result.message);
    assert.deepEqual(host.calls.rewind, [{ index: point.index, beforeRev: point.beforeRev }]);
    assert.deepEqual(result.point, point);
    // The new branch: the fight is gone, your character lives, the clicks before it stay.
    assert.equal(isDead(host.head), false);
    assert.deepEqual(host.chat[point.index].extra.storySuite.receipts.map(entry => entry.type), ['encounter', 'item.use', 'item.equip', 'return.cue']);
    // The cue: the reader's own action (B4r2-6: the sdk refuses 'system'), told to the next reply, claimed for this fight.
    assert.deepEqual(host.calls.command, [{ type: 'return.cue', payload: { fight: FIGHT, place: 'the Old Weir' }, options: {} }]);
    assert.equal(result.receipt.cause, 'ui');
    assert.equal(result.receipt.narrate, true);
    assert.equal(result.receipt.summary, '{{user}} is back at the moment before the fight at the Old Weir, alive.');
    assert.equal(host.head.meta.claims[`return:${FIGHT}`], true);
    // Told once: the same cue again on this branch is refused, nothing more is written.
    const again = await host.sdk.command('return.cue', { fight: FIGHT, place: 'the Old Weir' });
    assert.equal(again.ok, false);
    assert.equal(again.code, 'CLAIMED');
    assert.equal(host.chat[point.index].extra.storySuite.receipts.length, 4);
    // Alive now: nothing to return from, and generation goes on.
    assert.equal(host.sdk.query('return.point'), null);
    assert.deepEqual(canGenerate(host.sdk.view()), { ok: true });
});

test('the cue without a place, and its rejections', () => {
    const alive = aliveState('');
    const cue = part.commands['return.cue'];
    const own = { own: [], commands: part.commands };
    const told = runCommand(alive, cue, { fight: FIGHT }, own);
    assert.ok(told.ok, told.message);
    assert.equal(told.result.summary, '{{user}} is back at the moment before the fight, alive.');
    assert.deepEqual(told.result.data, { fight: FIGHT, place: '' });
    for (const payload of [{}, { fight: 'nope' }, { fight: FIGHT, place: 7 }]) {
        const out = runCommand(alive, cue, payload, own);
        assert.equal(out.code, 'INVALID', JSON.stringify(payload));
    }
    const still = runCommand(killed(alive), cue, { fight: FIGHT }, own);
    assert.equal(still.code, 'REFUSED');
    assert.equal(alive.meta.claims[`return:${FIGHT}`], undefined, 'nothing kept on a rejection');
});

test('Return: what it says when it cannot go back', async () => {
    // No point (alive): no rewind asked.
    const alive = createHost().greeting(aliveState());
    const none = await returnInTime(alive.sdk);
    assert.equal(none.code, 'NOT_FOUND');
    assert.deepEqual(alive.calls.rewind, []);
    // A host without rewind.
    const old = fatal(createHost({ withRewind: false }));
    const unsupported = await returnInTime(old.sdk);
    assert.equal(unsupported.code, 'UNSUPPORTED');
    assert.match(unsupported.message, /swipe or delete back/i);
    // The rewind refused: its reason is passed on, no cue.
    const refused = fatal(createHost({ rewindAnswer: { ok: false, code: 'FAILED', message: 'The branch could not be made.' } }));
    const out = await returnInTime(refused.sdk);
    assert.deepEqual([out.code, out.message], ['FAILED', 'The branch could not be made.']);
    assert.deepEqual(refused.calls.command, []);
    // A rewind that did not change the timeline: the cue is refused where your character is dead.
    const stuck = fatal(createHost({ rewindAnswer: { ok: true } }));
    const still = await returnInTime(stuck.sdk);
    assert.equal(still.code, 'REFUSED');
    assert.equal(still.rewound, true);
    assert.equal(isDead(stuck.head), true);
    assert.equal(stuck.head.meta.claims[`return:${FIGHT}`], undefined);
    // No sdk at all.
    assert.equal((await returnInTime(null)).code, 'UNSUPPORTED');
});

test('canGenerate: no story reply while your character is dead', () => {
    const host = fatal(createHost());
    assert.deepEqual(canGenerate(host.sdk.view()), { ok: false, reason: DEAD_REASON, action: false });
    assert.equal(DEAD_REASON, 'You died. Return in time, or swipe/delete back.');
    assert.deepEqual(canGenerate({ state: aliveState() }), { ok: true });
    assert.deepEqual(canGenerate({ state: null }), { ok: true }, 'no character yet is the party part\'s answer, not this one');
    assert.equal(part.hooks.canGenerate, canGenerate);
});

test('the part has the shape the module merges (MODULES §A)', () => {
    assert.deepEqual(Object.keys(part.commands), ['return.cue']);
    assert.deepEqual(Object.keys(part.queries), ['return.point', 'return.status']);
    assert.deepEqual(Object.keys(part.widgets), ['rpg-battle.return-card']);
    assert.equal(typeof part.widgets['rpg-battle.return-card'].render, 'function');
    assert.equal(part.domains, undefined, 'no domain of its own');
});
