// GENERATIVE_OFFERS_SPEC §11.2 end to end on Story Block's real host with the real Story Director (the sibling checkout; skipped without it): the
// user's two lines on Bluewatch 1.6.0, the PC Ren at level 3 at Bluewatch Village. The narrator offers; code settles and tells the narrator the terms on
// the next prompt; the reader accepts; the fights count; the turn-in pays once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../integration/helpers/host.js';
import { G1, G1_TERMS, G2, VILLAGE, accept, bluewatch, fightUntil, lastTail, skipSibling } from './helpers/bluewatch.js';

const wallet = h => h.q('inventory.wallet', { owner: 'party' }).coin ?? 0;
const job = (h, name) => h.q('director.thread', { key: name });

test('G1: offered, told back, accepted, fought to 6/6 and turned in at the village: 50 copper and 50 XP, once', { skip: skipSibling }, async t => {
    await seeded(3401, async () => {
        const h = await bluewatch(t, { useSibling: true });
        const xp0 = h.q('party.pc').xp;
        await h.say('Hollis has a job.', [G1]);
        assert.deepEqual(h.store.problems(), []);
        const thread = job(h, 'Granary Vermin');
        assert.equal(thread.rpg.state, 'offered');
        assert.deepEqual([thread.rpg.template, thread.rpg.category, thread.rpg.giver, thread.rpg.turnInPlace], ['pack.ersveil-bluewatch/open-hunt-f', 'bounty', null, VILLAGE]);
        assert.deepEqual(thread.rpg.objectives, [{ allowVariants: true, count: 6, id: 'ob_00000001', kind: 'kill', foe: 'pack.ersveil-bluewatch/cellar-rat-swarm' }]);
        assert.deepEqual(thread.rpg.reward, { coin: 50, xp: 50, items: [] });
        assert.equal(thread.fields.giver, 'Hollis');
        assert.equal(thread.fields.goal, 'Kill 6 culvert rats in the south levee granary and collect tails');
        const record = h.head().domains.rules.offers[thread.id];
        assert.deepEqual([record.band, record.matcher, record.where, record.settled.foe.name, record.settled.durationMinutes], ['moderate', 1, 'Bluewatch Village', 'Culvert Rats', 10080]);
        assert.equal(record.notes.join('; '), 'reward "12 crowns" is not this chat\'s money; set to 5 silver; Culvert Rats is a named kind of Cellar Rat Swarm; deadline set to 7 days');
        // The next prompt carries the settled terms, once.
        await h.say('Hollis waits.');
        assert.match(lastTail(h), new RegExp(`\\[Happened\\]\\n${G1_TERMS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        await h.say('The wind turns.');
        assert.equal(lastTail(h).includes('Posted job'), false, 'told once');
        // Accepted from the reader's next message; the deadline runs from there.
        const now = h.q('director.time').minutes;
        await accept(h, 'Granary Vermin');
        assert.equal(job(h, 'Granary Vermin').rpg.state, 'active');
        assert.equal(job(h, 'Granary Vermin').rpg.deadline, now + 10080);
        // The terms' encounter line, again and again until the board counts 6/6.
        const progress = await fightUntil(h, thread.id, '6 Culvert Rats | like: cellar-rat-swarm | tier: trivial', 6);
        assert.deepEqual([progress.have, progress.need, progress.met], [6, 6, true]);
        assert.equal(wallet(h), 0);
        const xp1 = h.q('party.pc').xp;
        await h.say('Hollis counts the tails.', ['- quest Granary Vermin — done']);
        assert.equal(job(h, 'Granary Vermin').rpg.state, 'done', JSON.stringify(h.store.problems()));
        assert.equal(wallet(h), 50);
        assert.equal(h.q('party.pc').xp - xp1, 50);
        assert.ok(xp1 >= xp0);
        // Paid once: a Re-read of the turn-in, a reload and a rebuild pay nothing more.
        const turnIn = h.ctx.chat.length - 1;
        assert.equal((await h.turn.reread(turnIn)).ok, true);
        assert.equal(wallet(h), 50);
        const live = JSON.stringify(h.head());
        h.store.rebuild();
        assert.equal(JSON.stringify(h.head()), live);
        await h.st.loadChat(structuredClone(h.ctx.chat));
        assert.equal(JSON.stringify(h.head()), live);
        assert.equal(wallet(h), 50);
        assert.deepEqual(h.store.problems(), []);
    });
});

test('G1 turned in away from where it was offered stays open: the turn-in place is the offer place', { skip: skipSibling }, async t => {
    await seeded(3402, async () => {
        const h = await bluewatch(t, { useSibling: true });
        await h.say('Hollis has a job.', [G1]);
        const id = job(h, 'Granary Vermin').id;
        await accept(h, 'Granary Vermin');
        await fightUntil(h, id, '6 Culvert Rats | like: cellar-rat-swarm | tier: trivial', 6);
        await h.say('Elsewhere.', ['~ place Auvoth | kind: city', '- quest Granary Vermin — done']);
        assert.equal(job(h, 'Granary Vermin').rpg.state, 'active');
        assert.equal(wallet(h), 0);
        await h.say('Back.', ['~ place Bluewatch Village | kind: settlement', '- quest Granary Vermin — done']);
        assert.equal(job(h, 'Granary Vermin').rpg.state, 'done', JSON.stringify(h.store.problems()));
        assert.equal(wallet(h), 50);
    });
});

test('G2: a named kind of the Starved Crag Wolf; the terms say how to fight it; one win closes the board', { skip: skipSibling }, async t => {
    await seeded(3403, async () => {
        const h = await bluewatch(t, { useSibling: true });
        await h.say('Hollis has another.', [G2]);
        const thread = job(h, 'Scrub Pack');
        assert.deepEqual(thread.rpg.objectives.map(o => [o.kind, o.count, o.foe]), [['kill', 1, 'pack.ersveil-bluewatch/starved-crag-wolf']]);
        await h.say('Hollis waits.');
        assert.match(lastTail(h), /Posted job: Scrub Pack \(from Hollis\): kill 1 Alpha of the Scrub Wolf Pack within 7 days; pays 5 silver and 50 XP, turned in at Bluewatch Village\. Fight it as ! encounter Alpha of the Scrub Wolf Pack \| like: starved-crag-wolf\./);
        await accept(h, 'Scrub Pack');
        const progress = await fightUntil(h, thread.id, 'Alpha of the Scrub Wolf Pack | like: starved-crag-wolf | tier: trivial', 1);
        assert.equal(progress.have, 1);
        await h.say('Hollis pays.', ['- quest Scrub Pack — done']);
        assert.equal(job(h, 'Scrub Pack').rpg.state, 'done', JSON.stringify(h.store.problems()));
        assert.equal(wallet(h), 50);
    });
});
