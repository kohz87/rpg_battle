// Final soak (live soak seed 23, reply ~230–300; reproduced here): deleting a reply from the middle of the
// chat skips a LATER reply's rest as a whole. Party pools are stored as whole values (HP cur/max replaced),
// not as changes. A fight won in reply A levels Wessel up (max HP 98 → 102); reply B wounds him and reply C
// rests him back to 102/102. Delete reply A: max goes back to 98, C's stored "cur: 102" no longer validates
// ("HP must be whole numbers with 0 ≤ cur ≤ max"), and C's whole block is skipped: the rest's heal AND its
// claim (rest:<sid>) are gone, Wessel is left at 0 HP although the rest reply is still in the chat. A reload
// replays the same way and the next checkpoint stores it. In the live soak the rest's claim vanished this way
// (store rebuild without validators kept it; the runtime and the live page did not).
// Invariant 2 (a delete restores the state of that point, here the later replies' changes on top of it) and 7.
//
// Fixed in party/pools.js: a pool keeps `lost` (a count), a rest stores it full ("restore to full"), and
// readers fit the numbers. Run twice: with RPG Battle alone (always), and in the whole suite with the
// Ersveil pack (helpers/suite-final.js; needs the four checkouts side by side, skipped otherwise).
import test from 'node:test';
import { DIRECTOR_CLOCK } from '../integration/helpers/peer.js';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { rpgHost } from '../integration/helpers/host.js';

let suite = null;
try { suite = await import('./helpers/suite-final.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;

/** splitmix32 over a counter: the same dice every run. */
function seededDice(seed) {
    let x = seed | 0;
    const next = () => {
        x = (x + 0x9E3779B9) | 0;
        let z = x;
        z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B);
        z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35);
        return (z ^ (z >>> 16)) >>> 0;
    };
    return { getRandomValues: array => { for (let i = 0; i < array.length; i += 1) array[i] = array instanceof Uint8Array ? next() & 0xFF : next(); return array; } };
}

/** RPG Battle with a fixed SD clock fixture, no NPC State Delta or pack: a character and opening reply. */
async function alone() {
    const h = await rpgHost({ modules: [DIRECTOR_CLOCK] });
    assert.equal((await h.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    await h.send('We look around Bluewatch.', h.reply('The village smells of salt and tar.', ['~ place Bluewatch Village | kind: settlement']));
    return h;
}

async function play(h) {
    // Real record ids (a seeded randomUUID would give every reply the same sid, and so the same claim
    // key); the dice stay seeded, so the fights play the same every run.
    const dice = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
        value: { getRandomValues: array => dice.getRandomValues(array), randomUUID: () => webcrypto.randomUUID() }, configurable: true, writable: true,
    });
    const pc = () => h.q('party.pc');
    let fightReply = -1;
    for (let k = 0; k < 15 && pc().level < 2; k++) {
        // A lost fight leaves Wessel down: a night's rest first, in a reply of its own.
        if (pc().hp.cur * 2 < pc().hp.max) await h.send('Rest first.', h.reply('You sleep it off.', ['! rest long — by the fire']));
        await h.send('Fight.', h.reply('Rats!', ['! encounter 3 Cellar Rat Swarm — boiling out | tier: weak | stakes: normal']));
        fightReply = h.ctx.chat.length - 1;
        const offer = h.q('combat.offers')[0];
        const started = await h.cmd('combat.start', { offer: offer.id });
        assert.equal(started.ok, true, started.message);
        for (let i = 0; i < 80; i++) { const s = h.q('combat.session'); if (!s || s.status !== 'active') break; if (!(await h.cmd('combat.act', { action: { type: 'auto' } })).ok) break; }
        await h.cmd('combat.end', {});
    }
    assert.equal(pc().level, 2, 'the last fight levelled Wessel up');
    await h.send('Ow.', h.reply('A fist.', ['~ wound Wessel — a beating | harm: severe']));
    await h.send('Rest.', h.reply('You sleep.', ['! rest long — in a rented cot']));
    assert.equal(pc().hp.cur, pc().hp.max);
    const restClaim = `rest:sid:${h.ctx.chat.at(-1).extra.storySuite.sid}`;
    const rests = Object.keys(h.head().meta.claims).filter(key => key.startsWith('rest:')).length;
    assert.ok(Object.hasOwn(h.head().meta.claims, restClaim));

    await h.st.deleteMessage(fightReply);   // the reader deletes that fight's reply from the middle

    assert.deepEqual(h.store.problems().map(problem => problem.why), [], 'no later block is skipped');
    assert.ok(pc().hp.cur > 0, 'the later rest still healed Wessel');
    assert.equal(pc().hp.cur, pc().hp.max, 'the rest restores to full, the max as it stands now');
    assert.ok(Object.hasOwn(h.head().meta.claims, restClaim), 'the rest\'s claim is kept');
    assert.equal(Object.keys(h.head().meta.claims).filter(key => key.startsWith('rest:')).length, rests, 'every rest\'s claim is kept');
    // A reload replays the same way.
    const live = JSON.stringify(h.head());
    h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), live, 'the rebuilt head is the live one');
}

test('final: deleting an earlier reply (a level-up fight) keeps a later reply\'s rest (RPG Battle alone)', async t => {
    t.mock.method(console, 'warn', () => {});
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: seededDice(23), configurable: true, writable: true });
    const h = await alone();
    t.after(() => { h.close(); Object.defineProperty(globalThis, 'crypto', saved); });
    await play(h);
});

test('final: deleting an earlier reply (a level-up fight) keeps a later reply\'s rest (the whole suite)', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const h = await suite.started();
    // close() puts back the crypto the suite host found.
    t.after(() => h.close());
    await play(h);
});
