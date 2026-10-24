// Final soak follow-up (party/pools.js): the numbers later replies change on a member are counts, so a
// reply deleted from the middle takes back only its own change and never makes a later reply's block
// fail. HP, MP and SP keep `lost` (and `max`); a rest stores a pool full ("restore to full"); level,
// XP, points and stats are counts too; readers fit them (a pool held to 0…max). Old chats, whose
// records wrote whole values, still load. RPG Battle alone (no Story Director).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { PARTY_COUNTERS } from '../../../src/v2/party/pools.js';

async function hero() {
    const h = await rpgHost();
    assert.equal((await h.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await h.send('We set out.', h.reply('Bluewatch Town.', ['~ place Bluewatch Town | kind: settlement']));
    h.pc = () => h.q('party.pc');
    h.say = (text, lines = []) => h.send(text, h.reply(`${text}.`, lines));
    // The index of the last reply (the carrier a reply's changes and its clicks are written to).
    h.last = () => h.st.ctx.chat.length - 1;
    h.problems = () => h.store.problems().map(problem => problem.why ?? problem.message);
    h.same = () => {
        const live = JSON.stringify(h.head());
        h.store.rebuild();
        assert.equal(JSON.stringify(h.head()), live, 'the head rebuilt from the chat is the live one');
    };
    return h;
}

const fits = actor => ['hp', 'mp', 'sp'].every(name => Number.isInteger(actor[name].cur) && actor[name].cur >= 0 && actor[name].cur <= actor[name].max && !('lost' in actor[name]));

test('pools: a wound deleted from the middle takes back its own damage only; the later wound still counts', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(3, async () => {
        const h = await hero();
        try {
            const max = h.pc().hp.max;
            await h.say('A fall', ['~ wound Ren — off the wall | harm: severe']);
            const first = h.last();
            const afterFirst = h.pc().hp.cur;
            await h.say('A bite', ['~ wound Ren — a dog | harm: scratch']);
            const scratch = afterFirst - h.pc().hp.cur;
            assert.ok(scratch > 0);
            await h.st.deleteMessage(first);
            assert.deepEqual(h.problems(), []);
            assert.equal(h.pc().hp.cur, max - scratch, 'only the bite is left');
            h.same();
        } finally { h.close(); }
    });
});

test('pools: a rest after a deleted heal still restores to full (a rest is "restore to full", not a number)', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(4, async () => {
        const h = await hero();
        try {
            await h.say('The bridge', ['~ wound Ren — the bridge gave way | harm: grievous']);
            await h.say('A poultice', ['~ wound Ren — a poultice | heal: wound']);
            const healed = h.last();
            await h.say('Bolts', ['~ wound Ren — a crossbow bolt | harm: severe']);
            await h.say('Sleep', ['! rest long — a night at the inn']);
            const rest = h.st.ctx.chat.at(-1).extra.storySuite.sid;
            assert.equal(h.pc().hp.cur, h.pc().hp.max);
            await h.st.deleteMessage(healed);
            assert.deepEqual(h.problems(), []);
            assert.equal(h.pc().hp.cur, h.pc().hp.max, 'the rest still fills HP');
            assert.ok(Object.hasOwn(h.head().meta.claims, `rest:sid:${rest}`), 'the rest\'s claim is kept');
            // After the rest a wound counts from full again.
            await h.say('A cut', ['~ wound Ren — a knife | harm: scratch']);
            const cut = h.pc().hp.max - h.pc().hp.cur;
            assert.ok(cut > 0);
            h.same();
            // A swipe of that reply takes the cut back; a reload reads the same.
            await h.swipe(h.reply('No knife after all.'));
            assert.equal(h.pc().hp.cur, h.pc().hp.max);
            assert.deepEqual(h.problems(), []);
            const live = JSON.stringify(h.head());
            await h.st.loadChat(structuredClone(h.st.ctx.chat));
            assert.equal(JSON.stringify(h.head()), live, 'a reload reads the same head');
        } finally { h.close(); }
    });
});

test('levels: a level-up deleted from the middle takes back its level, points and max HP; a later one counts on top', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(5, async () => {
        const h = await hero();
        try {
            const one = h.pc();
            await h.say('A deed');
            assert.equal((await h.internal('party.grantXp', { xp: 1000, reason: 'a deed' })).ok, true);
            const deed = h.last();
            const two = h.pc();
            assert.ok(two.level > one.level);
            await h.say('Hurt', ['~ wound Ren — a fall | harm: wound']);
            const hurt = two.hp.max - h.pc().hp.cur;
            await h.say('Another deed');
            assert.equal((await h.internal('party.grantXp', { xp: 300, reason: 'another' })).ok, true);
            const three = h.pc();
            const step = three.level - two.level;
            await h.st.deleteMessage(deed);
            assert.deepEqual(h.problems(), []);
            const now = h.pc();
            assert.equal(now.level, one.level + step, 'only the later level-up is left');
            assert.equal(now.hp.max, one.hp.max + (three.hp.max - two.hp.max), 'and the max HP it brought');
            assert.equal(now.hp.cur, now.hp.max - hurt, 'the wound still counts');
            assert.equal(now.points, three.points - two.points + one.points, 'and the points it gave');
            assert.ok(fits(now));
            h.same();
        } finally { h.close(); }
    });
});

test('points: a spend after a deleted level-up is kept and no block is skipped; the points it took are owed (confirm C-2)', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(6, async () => {
        const h = await hero();
        try {
            await h.say('A deed');
            assert.equal((await h.internal('party.grantXp', { xp: 1000 })).ok, true);
            const deed = h.last();
            const points = h.pc().points;
            assert.ok(points > 0);
            await h.say('Training');
            const before = h.pc().stats.STR;
            assert.equal((await h.cmd('party.spend', { points: { STR: points } })).ok, true);
            await h.st.deleteMessage(deed);
            assert.deepEqual(h.problems(), []);
            // Since confirm C-2 (pools.js): points spent on a level a delete took back are owed, read below 0,
            // and the next level's points pay them first (they used to read 0: free stats).
            assert.equal(h.pc().points, -points, 'the points the spend took are owed');
            assert.equal(h.pc().stats.STR, before + points, 'the stats count: the spend adds its own step on what is there');
            h.same();
        } finally { h.close(); }
    });
});

test('a companion leaving after a deleted reply changed their numbers is gone; the remove carries no count', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(7, async () => {
        const h = await hero();
        try {
            await h.say('Lyra', ['+ join Lyra — an archer | role: ranger']);
            assert.equal((await h.cmd('party.acceptOffer', { offer: h.q('party.offers')[0].id })).ok, true);
            const lyra = h.q('party.actor', { name: 'Lyra' }).id;
            await h.say('Training');
            assert.equal((await h.internal('party.grantXp', { actors: [lyra], xp: 2000 })).ok, true);
            const trained = h.last();
            await h.say('Hurt', ['~ wound Lyra — a fall | harm: wound']);
            await h.say('Goodbye', ['- leave Lyra — parts ways at the ford']);
            assert.equal((await h.cmd('party.acceptOffer', { offer: h.q('party.offers')[0].id })).ok, true);
            const removes = h.st.ctx.chat.at(-1).extra.storySuite.ops.filter(op => op.op === 'remove' && op.path === `/domains/party/actors/${lyra}`);
            assert.equal(removes.length, 1);
            assert.equal(removes[0].was, undefined, 'a member leaving is a plain remove (actors/*/id comes first in the counters)');
            assert.equal(PARTY_COUNTERS[0], 'actors/*/id');
            await h.st.deleteMessage(trained);
            assert.deepEqual(h.problems(), []);
            assert.equal(h.q('party.actor', { id: lyra }), null, 'Lyra is still gone');
            h.same();
        } finally { h.close(); }
    });
});

test('an older chat\'s records (whole values: cur and max written, no counts) still load; the next write keeps counts', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(8, async () => {
        const h = await hero();
        try {
            await h.say('A deed');
            assert.equal((await h.internal('party.grantXp', { xp: 1000 })).ok, true);
            const deed = h.last();
            await h.say('Hurt', ['~ wound Ren — a beating | harm: severe']);
            await h.say('Sleep', ['! rest long — in a rented cot']);
            // Written the way older versions wrote them: whole numbers, no `lost`, no counts.
            for (const message of h.st.ctx.chat) {
                for (const record of [message.extra?.storySuite, ...(message.swipe_info ?? []).map(info => info?.extra?.storySuite)]) {
                    if (!record?.ops) continue;
                    record.ops = record.ops.filter(op => !/\/lost$/.test(op.path)).map(op => {
                        if (!op.path.startsWith('/domains/party/')) return op;
                        const { was, count, ...rest } = op;
                        void was; void count;
                        return rest;
                    });
                }
            }
            h.store.rebuild();
            const max = h.pc().hp.max;
            assert.equal(h.pc().hp.cur, max);
            await h.st.deleteMessage(deed);
            assert.deepEqual(h.problems(), [], 'the old rest (cur written above the max as it stands now) is not skipped');
            assert.ok(h.pc().hp.max < max);
            assert.equal(h.pc().hp.cur, h.pc().hp.max, 'read fitted: full at the max as it stands now');
            assert.ok(fits(h.pc()));
            await h.say('A cut', ['~ wound Ren — a knife | harm: scratch']);
            const pool = h.head().domains.party.actors[h.pc().id].hp;
            assert.equal(pool.lost, pool.max - pool.cur, 'written in the new form');
            h.same();
        } finally { h.close(); }
    });
});

test('a checkpoint over a deleted reply is passed over: the counts replay from the one before', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(9, async () => {
        const h = await hero();
        try {
            await h.say('A deed');
            assert.equal((await h.internal('party.grantXp', { xp: 1000 })).ok, true);
            const deed = h.last();
            await h.say('Hurt', ['~ wound Ren — a beating | harm: severe']);
            for (let n = 0; n < 104; n += 1) await h.say(`Walk ${n}`);
            assert.ok(h.st.ctx.chat.some((message, index) => index > deed && message.extra?.storySuite?.checkpoint), 'a checkpoint was made');
            await h.say('Sleep', ['! rest long — in a rented cot']);
            await h.st.deleteMessage(deed);
            assert.deepEqual(h.problems(), []);
            assert.equal(h.pc().level, 1);
            assert.equal(h.pc().hp.cur, h.pc().hp.max);
            h.same();
        } finally { h.close(); }
    });
});
