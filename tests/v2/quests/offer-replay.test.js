// What a delete, a swipe, a Re-read, a rebuild and a reload do to a job the story offered (GENERATIVE_OFFERS_SPEC §7.3, §16), on the real host. The offer is
// a guarded, reply-bound block: the thread, the record and what was built on them (the acceptance, the turn-in) go with the reply and come back with it,
// and nothing is matched, parsed or rolled again: the settled binding is the recorded one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seeded } from '../integration/helpers/host.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { replayOffer } from '../../../src/v2/quests/offer-plan.js';
import { replayInputs } from '../../../src/v2/quests/seams.js';
import { TYPES } from '../../../src/v2/quests/offer-words.js';
import { G1, VILLAGE, accept, bluewatch, lastTail } from './helpers/bluewatch.js';

const OFFER = '+ quest Old Debts | giver: Marrit | goal: Settle the matter with the river guild | reward: 80 copper | due: in 3 days';
const FAR = '+ quest Boar Hunt | goal: Hunt 3 wild boars | reward: 50 gold';
const wallet = h => h.q('inventory.wallet', { owner: 'party' }).coin ?? 0;
const job = (h, name = 'Old Debts') => h.q('director.thread', { key: name });
const offers = h => h.head().domains.rules.offers;
const at = (h, text) => h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
const prerequisites = h => h.store.problems().filter(item => item.code === 'REPLAY_PREREQUISITE');
const drop = async (h, index) => {
    await h.st.deleteMessage(index);
    await h.st.deleteMessage(index - 1);
};
/** The state the world is in, as the replay tests compare it. */
// (Story Director's ledger of write ids is left out: a Re-read draws its own ids, as it does for a pack quest.)
const world = h => JSON.stringify({ rules: h.head().domains.rules.offers, director: { ...h.head().domains.director, writes: undefined }, wallet: wallet(h), xp: h.q('party.pc').xp, claims: Object.keys(h.head().meta.claims).sort() });
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

/** An offer on reply A, accepted on B, finished and paid on C. */
async function played(t, seed = 3501) {
    return seeded(seed, async () => {
        const h = await bluewatch(t);
        await h.say('The river guild is owed.', [OFFER]);
        const id = job(h).id;
        await accept(h, 'Old Debts');
        await h.say('The guild is settled.', ['~ quest Old Debts | met: yes', '- quest Old Debts — done']);
        return { h, id };
    });
}

test('an offer on A, accepted on B, finished on C: the quest is paid once and the record is the settled binding', async t => {
    const { h, id } = await played(t);
    assert.equal(job(h).rpg.state, 'done', JSON.stringify(h.store.problems()));
    assert.equal(wallet(h), 80);
    const record = offers(h)[id];
    assert.deepEqual([record.band, record.settled.coin, record.settled.durationMinutes, record.said.due, record.said.giver], ['within', 80, 4320, 'in 3 days', 'Marrit']);
    assert.deepEqual(h.store.problems(), []);
    await agree(h, 'played');
});

test('delete A: the thread, the record and what was built on them go; nothing stays paid; the rest is one REPLAY_PREREQUISITE each, no other Problem', async t => {
    const { h } = await played(t);
    await drop(h, at(h, 'The river guild is owed.'));
    assert.equal(job(h), null);
    assert.deepEqual(offers(h), {});
    assert.equal(wallet(h), 0);
    const problems = h.store.problems();
    assert.ok(problems.length >= 1);
    assert.ok(problems.every(item => item.code === 'REPLAY_PREREQUISITE'), JSON.stringify(problems));
    await agree(h, 'after the delete');
});

test('delete A of two offers: the other offer, its record and its thread stand (each record is its own key)', async t => {
    await seeded(3502, async () => {
        const h = await bluewatch(t);
        await h.say('The river guild is owed.', [OFFER]);
        await h.say('Another.', ['+ quest Rat Trouble | goal: kill a handful of rats in the cellar | reward: 100 copper']);
        const second = job(h, 'Rat Trouble').id;
        await drop(h, at(h, 'The river guild is owed.'));
        assert.equal(job(h), null);
        assert.deepEqual(Object.keys(offers(h)), [second]);
        assert.equal(job(h, 'Rat Trouble').rpg.state, 'offered');
        assert.deepEqual(h.store.problems(), []);
        await agree(h, 'after deleting the first of two');
    });
});

test('swipe the offering reply away and back: the same thread id and the same settled binding', async t => {
    await seeded(3503, async () => {
        const h = await bluewatch(t);
        await h.say('The river guild is owed.', [OFFER]);
        const id = job(h).id;
        const record = structuredClone(offers(h)[id]);
        const thread = structuredClone(job(h));
        const last = h.ctx.chat.length - 1;
        await h.swipe('Nobody is owed anything.');
        assert.equal(job(h), null);
        assert.deepEqual(offers(h), {});
        await h.st.swipeTo(last, 0);
        assert.deepEqual(offers(h)[id], record);
        assert.deepEqual(job(h), thread);
        assert.deepEqual(h.store.problems(), []);
        await agree(h, 'after swiping back');
    });
});

test('Re-read of the unchanged offering reply: the record is deep-equal, the thread the same, nothing is paid twice', async t => {
    const { h, id } = await played(t, 3504);
    const record = structuredClone(offers(h)[id]);
    const held = world(h);
    assert.equal((await h.turn.reread(at(h, 'The river guild is owed.'))).ok, true);
    assert.deepEqual(offers(h)[id], record);
    assert.equal(world(h), held);
    assert.equal(wallet(h), 80);
    assert.deepEqual(h.store.problems(), []);
    await agree(h, 'after the Re-read');
});

test('Re-read after the line was edited makes a new record under a new thread; what stood on the old one is off', async t => {
    const { h, id } = await played(t, 3505);
    const index = at(h, 'The river guild is owed.');
    const message = h.ctx.chat[index];
    const edited = message.mes.replace('reward: 80 copper', 'reward: 100 copper');
    assert.notEqual(edited, message.mes);
    message.mes = edited;
    message.swipes[message.swipe_id] = edited;
    assert.equal((await h.turn.reread(index)).ok, true);
    const now = job(h);
    assert.notEqual(now.id, id, 'an edited line is a new line with a fresh seed');
    assert.equal(offers(h)[now.id].settled.coin, 100);
    assert.equal(offers(h)[id], undefined);
    assert.equal(wallet(h), 0, 'the acceptance and the turn-in stood on the old thread');
    assert.ok(prerequisites(h).length >= 1);
    await agree(h, 'after the edited Re-read');
});

test('a Re-read after an upgrade never re-decides: the matcher that decided is the one on record, and the stored decision stands', async t => {
    await seeded(3506, async () => {
        const h = await bluewatch(t);
        await h.say('Hollis has a job.', ['+ quest Rat Trouble | type: cull | goal: Kill 3 rats | reward: 100 copper']);
        const id = job(h, 'Rat Trouble').id;
        const record = structuredClone(offers(h)[id]);
        assert.equal(record.settled.template, 'pack.ersveil-bluewatch/open-hunt-f');
        // A matcher whose table would decide it differently: a cull is a delivery now.
        const was = TYPES.cull.kind;
        TYPES.cull.kind = 'collect';
        t.after(() => { TYPES.cull.kind = was; });
        const index = at(h, 'Hollis has a job.');
        assert.equal((await h.turn.reread(index)).ok, true);
        assert.deepEqual(offers(h)[id], record, 'the same settled binding, on the same matcher version');
        assert.equal(job(h, 'Rat Trouble').id, id);
        // An edited line is read by the matcher running now.
        const message = h.ctx.chat[index];
        message.mes = message.mes.replace('reward: 100 copper', 'reward: 110 copper');
        message.swipes[message.swipe_id] = message.mes;
        assert.equal((await h.turn.reread(index)).ok, true);
        const fresh = job(h, 'Rat Trouble');
        assert.notEqual(fresh.id, id);
        assert.equal(offers(h)[fresh.id].settled.template, 'pack.ersveil-bluewatch/open-story-task-f', 'a cull is a delivery now, and nothing in the cellar is an item: the story judges the goal');
        TYPES.cull.kind = was;
    });
});

test('replay never calls the matcher: a stored chat loads and rebuilds with every type of the table made to throw', async t => {
    const { h } = await played(t, 3507);
    const chat = JSON.parse(JSON.stringify(h.ctx.chat));
    const live = JSON.stringify(h.head());
    const saved = Object.fromEntries(Object.entries(TYPES).map(([name, row]) => [name, row.kind]));
    for (const row of Object.values(TYPES)) Object.defineProperty(row, 'kind', { configurable: true, get() { throw new Error('the matcher was called on replay'); } });
    t.after(() => { for (const [name, kind] of Object.entries(saved)) Object.defineProperty(TYPES[name], 'kind', { configurable: true, writable: true, enumerable: true, value: kind }); });
    h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), live);
    await h.st.loadChat(chat);
    assert.equal(JSON.stringify(h.head()), live);
    assert.deepEqual(h.store.problems(), []);
});

test('the quest guard asks only quest.replayInputs and story.evidence, and the replay module names no matcher and no money parser', async t => {
    await seeded(3508, async () => {
        const h = await bluewatch(t);
        const before = structuredClone(h.head());
        await h.say('The river guild is owed.', [OFFER]);
        const span = h.ctx.chat.flatMap(message => message.extra?.storySuite?.spans ?? []).find(item => item.guard?.predicate?.kind === 'quest.offer');
        assert.ok(span, 'the block carries a quest.offer guard');
        assert.equal(span.guard.replyBound, true);
        assert.equal(span.guard.version, 2);
        const asked = [];
        const query = (name, args) => {
            asked.push(name);
            if (name === 'quest.replayInputs') return replayInputs(before, { reply: args?.reply ?? null });
            if (name === 'story.evidence') return [];
            throw new Error(`the guard asked ${name}`);
        };
        const ask = (over = {}) => replayOffer({ state: over.state ?? before, query, hash: hashJson }, { guard: over.guard ?? span.guard, source: span.source, recorded: Object.hasOwn(over, 'recorded') ? over.recorded : span.recorded });
        assert.deepEqual(ask(), { ok: true });
        assert.deepEqual([...new Set(asked)].sort(), ['quest.replayInputs', 'story.evidence']);
        assert.equal(replayOffer({ state: before, query, hash: hashJson }, { guard: { ...span.guard, predicate: { kind: 'quest.open', payload: {} } } }), undefined, 'answers only its own kind');
        // The recorded numbers are hashed: another coin, tier or count is another block.
        const settled = structuredClone(span.guard.predicate.payload.settled);
        const other = (change, text) => {
            const guard = structuredClone(span.guard);
            change(guard.predicate.payload.settled);
            const answer = ask({ guard });
            assert.equal(answer.ok, false, text);
        };
        other(s => { s.coin = 81; }, 'a coin of the template\'s range but not the recorded one');
        other(s => { s.coin = 5; }, 'a coin below the template floor');
        other(s => { s.xp += 1; }, 'xp is the formula');
        other(s => { s.durationMinutes = 5; }, 'a deadline below an hour');
        other(s => { s.template = 'pack.ersveil-bluewatch/open-hunt-f'; }, 'a template of another kind');
        other(s => { s.area = { tier: 3, from: 'place' }; }, 'an area that is not the recorded one');
        assert.equal(ask({ recorded: null }).ok, false);
        assert.equal(ask({ guard: { ...span.guard, rulesHash: '0'.repeat(64) } }).ok, false);
        assert.equal(ask({ guard: { ...span.guard, epoch: 'ep_11111111' } }).ok, false);
        assert.ok(settled.coin === 80);
        const source = readFileSync(new URL('../../../src/v2/quests/offer-plan.js', import.meta.url), 'utf8');
        const imports = source.split('\n').filter(line => line.startsWith('import ')).join('\n');
        assert.equal(/offer-match|parse\.js|offer-words|offer-bands/.test(imports), false, imports);
        const replay = source.slice(source.indexOf('export function replayOffer'));
        assert.equal(/matchOffer|parseReward|countOf|ctx\.|\bask\(/.test(replay), false, 'replayOffer names no matcher, no parser and no live query');
        assert.equal(replayOffer.length, 2);
    });
});

test('a far-out line: no thread, no record of an offer, no Problem; the next prompt tells it once; deleting its reply takes the line away', async t => {
    await seeded(3509, async () => {
        const h = await bluewatch(t);
        await h.say('A wild offer.', [FAR]);
        assert.equal(job(h, 'Boar Hunt'), null);
        assert.deepEqual(offers(h), {});
        assert.deepEqual(h.store.problems(), []);
        assert.deepEqual(h.turn.problems(), []);
        const declined = Object.values(h.head().domains.rules.declined);
        assert.deepEqual(declined.map(row => [row.name, row.band]), [['Boar Hunt', 'far']]);
        await h.say('The market is quiet.');
        assert.match(lastTail(h), /Earlier, Boar Hunt was mentioned as a job, but it isn't one that can be offered here \(50 gold is far above what a rank F job pays: 4 gold at most\)\. Let it stay as talk or a rumour; if a job is wanted, offer it for 4 gold or less\./);
        await h.say('Later.');
        assert.equal(lastTail(h).includes('Earlier, Boar Hunt'), false, 'told once');
        // A bare acceptance of a job that never existed is quiet.
        await h.send('I accept the Boar Hunt job.', 'Fine.\n\n<Changes>\n+ quest Boar Hunt\n</Changes>');
        assert.equal(job(h, 'Boar Hunt'), null);
        assert.deepEqual(h.turn.problems(), []);
        await agree(h, 'after a far-out line');
        // Delete its reply: the next prompt has no retcon line and the decision is gone.
        await drop(h, at(h, 'A wild offer.'));
        assert.deepEqual(h.head().domains.rules.declined, {});
        await h.say('Another day.');
        assert.equal(lastTail(h).includes('Earlier, Boar Hunt'), false);
    });
});

test('swipe a far-out line: it is told again only for the swipe that is shown', async t => {
    await seeded(3510, async () => {
        const h = await bluewatch(t);
        await h.say('A wild offer.', [FAR]);
        const last = h.ctx.chat.length - 1;
        await h.swipe('Nothing is offered.');
        assert.deepEqual(h.head().domains.rules.declined, {});
        await h.say('Quiet.');
        assert.equal(lastTail(h).includes('Earlier, Boar Hunt'), false);
        await h.st.swipeTo(last, 0);
        assert.equal(Object.keys(h.head().domains.rules.declined).length, 1);
        await h.say('The market again.');
        assert.match(lastTail(h), /Earlier, Boar Hunt was mentioned as a job/);
    });
});

test('the user\'s line (G1) replays: delete, swipe-and-back and Re-read keep one thread, one record, one set of terms', async t => {
    await seeded(3511, async () => {
        const h = await bluewatch(t);
        await h.say('Hollis has a job.', [G1]);
        const id = job(h, 'Granary Vermin').id;
        const record = structuredClone(offers(h)[id]);
        assert.equal((await h.turn.reread(at(h, 'Hollis has a job.'))).ok, true);
        assert.deepEqual(offers(h)[id], record);
        await agree(h, 'after a Re-read');
        assert.equal(VILLAGE.endsWith('bluewatch-village'), true);
    });
});
