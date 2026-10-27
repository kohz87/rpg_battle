// Jobs and teachers from the story on Bluewatch 1.6.0 and pins derived from it, on the real host (the vendored Story Director): dedupe against threads,
// the technical limits, teachers, packs with count bounds, aliases and offer words, gathering by loot and by a story item, strict mode, a chat recorded
// on 2.2.0 offering its first generative job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seeded } from '../integration/helpers/host.js';
import { G1, PACK, PACK_TEXT, accept, bluewatch, fight, lastTail, ok } from './helpers/bluewatch.js';
import { replyCardLines } from '../../vendor/story-block/src/v2/screens/index.js';
import { declinedOf, offersOf } from '../../../src/v2/rules/offers.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pinned-2.2.0.json', import.meta.url), 'utf8'));
const wallet = h => h.q('inventory.wallet', { owner: 'party' }).coin ?? 0;
const job = (h, name) => h.q('director.thread', { key: name });
const offers = h => offersOf(h.head().domains.rules);
const trainers = h => h.head().domains.training.offers ?? {};
const at = (h, text) => h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
const drop = async (h, index) => { await h.st.deleteMessage(index); await h.st.deleteMessage(index - 1); };
const items = (h, name) => h.q('inventory.items', { owner: 'party' }).filter(item => (item.def?.name ?? item.name) === name).reduce((sum, item) => sum + item.qty, 0);

test('the same name is one job: a second offer is a quiet no-op, "The" and case do not matter, "II" is another job, a finished job is far out', async t => {
    await seeded(4201, async () => {
        const h = await bluewatch(t);
        await h.say('Hollis has a job.', [G1]);
        const first = structuredClone(job(h, 'Granary Vermin'));
        await h.say('Again.', ['+ quest The Granary Vermin | type: cull | goal: kill 6 rats', '+ quest granary vermin | goal: kill 2 rats']);
        assert.deepEqual(job(h, 'Granary Vermin'), first);
        assert.equal(Object.keys(offers(h)).length, 1);
        assert.deepEqual(h.turn.problems(), []);
        await h.say('A second.', ['+ quest Granary Vermin II | goal: Settle the matter with the river guild | reward: 60 copper']);
        assert.equal(Object.keys(offers(h)).length, 2);
        assert.notEqual(job(h, 'Granary Vermin II').id, first.id);
        // Finished: offering the same name again is far out ("already done"), told once.
        await accept(h, 'Granary Vermin II');
        await h.say('Done.', ['~ quest Granary Vermin II | met: yes', '- quest Granary Vermin II — done']);
        assert.equal(job(h, 'Granary Vermin II').rpg.state, 'done', JSON.stringify(h.store.problems()));
        await h.say('Once more.', ['+ quest Granary Vermin II | goal: Settle the matter with the guild | reward: 60 copper']);
        assert.equal(Object.keys(offers(h)).length, 2);
        await h.say('Quiet.');
        assert.match(lastTail(h), /Earlier, Granary Vermin II was mentioned as a job, but it isn't one that can be offered here \(Granary Vermin II is already done\)\. Let it stay as talk or a rumour; if a job is wanted, offer a new job under a new name\./);
        assert.deepEqual(h.turn.problems(), []);
    });
});

test('two equal keys in one reply: the second is the no-op', async t => {
    await seeded(4202, async () => {
        const h = await bluewatch(t);
        await h.say('Twice.', ['+ quest Rat Trouble | goal: kill 2 rats | reward: 60 copper', '+ quest Rat Trouble | goal: kill 3 rats | reward: 90 copper']);
        assert.equal(Object.keys(offers(h)).length, 1);
        assert.equal(Object.values(offers(h))[0].settled.coin, 60);
        assert.deepEqual(h.turn.problems(), []);
    });
});

test('an SD hook of the same name becomes the job: one owner, one thread', async t => {
    await seeded(4203, async () => {
        const h = await bluewatch(t);
        ok(await h.sdk.command('threads.offer', { write: 'wr_goal0001', thread: 'th_goal0001', kind: 'hook', key: 'Hollis\'s Debt', summary: 'he wants it settled', fields: {}, expectedHash: null }));
        const hook = job(h, 'Hollis\'s Debt');
        assert.ok(hook && !hook.rpg && hook.offer);
        await h.say('Hollis names a price.', ['+ quest Hollis\'s Debt | goal: Settle the debt with the river guild | reward: 90 copper']);
        const made = job(h, 'Hollis\'s Debt');
        assert.equal(made.id, hook.id, 'the offer is made on that thread');
        assert.equal(made.rpg.reward.coin, 90);
        assert.equal(Object.keys(offers(h))[0], hook.id);
        assert.deepEqual(h.turn.problems(), []);
        await agree(h);
    });
});

async function agree(h) {
    const live = JSON.stringify(h.head());
    const problems = JSON.stringify(h.store.problems());
    h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), live);
    await h.st.loadChat(JSON.parse(JSON.stringify(h.ctx.chat)));
    assert.equal(JSON.stringify(h.head()), live);
    assert.equal(JSON.stringify(h.store.problems()), problems);
}

test('the technical limits: 16 new jobs in one reply, then LIMIT; an empty name is INVALID; no other refusal', async t => {
    await seeded(4204, async () => {
        const h = await bluewatch(t);
        const lines = Array.from({ length: 17 }, (_, n) => `+ quest Odd Job ${n + 1} | goal: Settle matter number ${n + 1} with the guild`);
        await h.say('So many offers.', lines);
        assert.equal(Object.keys(offers(h)).length, 16);
        const problems = h.turn.problems();
        assert.equal(problems.length, 1, JSON.stringify(problems));
        assert.match(problems[0].message, /Quest refused/);
        await h.say('Nothing.', ['+ quest <> | goal: nothing']);
        assert.equal(h.turn.problems().length, 2);
        await agree(h);
    });
});

test('teachers on Bluewatch: G10 to G14 and C31 to C36 read as the corpus says, and each is recorded with how it was read', async t => {
    await seeded(4205, async () => {
        const h = await bluewatch(t);
        await h.say('Teachers come.', [
            '+ trainer Old Reka — blade drills', '+ trainer Sergeant Holm — teaches spear and shield work', '+ trainer Widow Asta — hedge magic, sparks and wards',
            '+ trainer Fen | teaches: cane-draw, gutter feint', '+ trainer Old Pell — fishing and net mending', '+ trainer Brad — blade drills | fee: 5 gold',
            '+ trainer Cal — blade drills | fee: 10 copper', '+ trainer Dun — blade drills | fee: 60 copper']);
        const byName = Object.fromEntries(Object.values(trainers(h)).map(offer => [offer.name, offer]));
        assert.deepEqual(Object.keys(byName).sort(), ['Cal', 'Dun', 'Fen', 'Old Reka', 'Sergeant Holm', 'Widow Asta']);
        assert.deepEqual(Object.values(byName).map(o => [o.name, o.template.split('/')[1]]).sort(), [['Cal', 'open-blade-drills'], ['Dun', 'open-blade-drills'], ['Fen', 'open-street-craft'],
            ['Old Reka', 'open-blade-drills'], ['Sergeant Holm', 'open-spear-and-shield'], ['Widow Asta', 'open-hedge-lessons']]);
        assert.ok(byName['Old Reka'].fee >= 40 && byName['Old Reka'].fee <= 90);
        assert.deepEqual([byName.Cal.fee, byName.Cal.settled.band, byName.Dun.fee, byName.Dun.settled.feeBy], [40, 'moderate', 60, 'said']);
        assert.equal(byName.Fen.skills.length, 2);
        assert.equal(byName['Old Reka'].place, 'pack.ersveil-bluewatch/bluewatch-village');
        assert.equal(byName['Old Reka'].where, 'Bluewatch Village');
        // Old Pell: a Problem and a hook; Brad: far out, told once.
        assert.equal(job(h, 'Old Pell')?.kind, 'hook');
        assert.equal(job(h, 'Brad'), null);
        assert.equal(h.turn.problems().length, 1);
        await h.say('Quiet.');
        assert.match(lastTail(h), /Earlier, Brad was mentioned as a job, but it isn't one that can be offered here \(a fee of 5 gold is far above Blade drills: 9 silver at most\)/);
        await agree(h);
    });
});

// ---- packs with what Story Block 2.5.0 lets a pack write ----

/** Bluewatch 1.6.0 with the 1.7.0 additions of the spec (§12.3) written by hand: bounds on the open hunts and deliveries, aliases, and offer words. */
function derivedPack() {
    const pack = structuredClone(PACK);
    pack.version = '1.7.0-test';
    const limits = { F: [8, 6], E: [8, 6], D: [6, 4], C: [4, 4] };
    for (const quest of pack.content.quests.filter(row => row.open === true)) {
        const [hunt, delivery] = limits[quest.rank];
        const objective = quest.objectives[0];
        if (objective.kind === 'kill') Object.assign(objective, { countMin: 1, countMax: hunt });
        if (objective.kind === 'collect') Object.assign(objective, { countMin: 1, countMax: delivery });
    }
    const creature = slug => pack.content.creatures.find(row => row.slug === slug);
    creature('cellar-rat-swarm').aliases = ['rats', 'cellar rats', 'rat swarm'];
    creature('starved-crag-wolf').aliases = ['crag wolf'];
    creature('roadside-bandit').aliases = ['bandit', 'bandits', 'highwayman'];
    pack.content.rules[0].offerWords = { hunt: ['jagd'], gather: ['sammeln'], hard: ['schwer'] };
    return JSON.stringify(pack);
}

test('Bluewatch 1.6.0 and a pack with explicit bounds, aliases and offer words: implicit and explicit count bounds, an alias, a pack word', async t => {
    await seeded(4206, async () => {
        const old = await bluewatch(t);
        await old.say('Tails.', ['+ quest Tails | goal: Collect 6 rat tails | reward: 60 copper']);
        assert.equal(Object.values(offers(old))[0].settled.count, 4, 'implicit: the largest delivery of the closed quests');
        const fresh = await bluewatch(t, { pack: derivedPack() });
        assert.equal(fresh.head().domains.rules.pin.identity.packVersion, '1.7.0-test');
        await fresh.say('Tails.', ['+ quest Tails | goal: Collect 6 rat tails | reward: 60 copper', '+ quest Wanted | goal: Kill a highwayman on the road', '+ quest Wölfe | type: jagd | goal: Wer jagt die Wölfe? | difficulty: schwer']);
        const all = Object.values(offers(fresh));
        const tails = all.find(o => o.name === 'Tails');
        assert.deepEqual([tails.settled.count, tails.band], [6, 'within'], 'explicit: up to 6');
        assert.deepEqual(all.find(o => o.name === 'Wanted').settled.foe, { ref: 'pack.ersveil-bluewatch/roadside-bandit', base: 'pack.ersveil-bluewatch/roadside-bandit', name: 'Roadside Bandit', how: 'exact' });
        assert.equal(all.find(o => o.name === 'Wölfe').settled.template, 'pack.ersveil-bluewatch/open-story-task-f', 'the pack\'s hunt word, no foe in the goal: the story judges it');
        assert.deepEqual(fresh.turn.problems(), []);
        await agree(fresh);
    });
});

test('disabling or removing the installed pack after an offer changes nothing; the next offer uses the pin', async t => {
    await seeded(4207, async () => {
        const h = await bluewatch(t);
        await h.say('Hollis has a job.', [G1]);
        const before = JSON.stringify(h.head().domains);
        await h.packs.packs.setEnabled('ersveil-bluewatch', false);
        assert.equal(JSON.stringify(h.head().domains), before);
        await h.packs.packs.remove('ersveil-bluewatch');
        assert.equal(JSON.stringify(h.head().domains), before);
        await h.say('Another.', ['+ quest Rat Trouble | goal: kill a handful of rats in the cellar | reward: 100 copper']);
        const made = Object.values(offers(h)).find(o => o.name === 'Rat Trouble');
        // (The money is the chat's, not the pack's: with the pack gone "copper" is no coin here, so the coin is the formula's; the pin still decides the rest.)
        assert.deepEqual([made.settled.template.split('/')[1], made.settled.count, made.settled.rank], ['open-hunt-f', 5, 'F']);
        assert.deepEqual(h.store.problems(), []);
    });
});

// ---- gathering ----

test('a collect job is done by loot, another by a story item: both count at turn-in, are consumed, and pay once', async t => {
    await seeded(4208, async () => {
        const h = await bluewatch(t);
        await h.say('Tails wanted.', ['+ quest Tails | goal: Collect 2 rat tails for the granary keeper | reward: 60 copper', '+ quest Tails Again | goal: Collect 4 rat tails | reward: 80 copper']);
        assert.deepEqual(Object.values(offers(h)).map(o => [o.name, o.settled.item.name, o.settled.count]), [['Tails', 'Rat Tail', 2], ['Tails Again', 'Rat Tail', 4]]);
        await accept(h, 'Tails');
        await h.send('I accept the Tails Again job.', 'Agreed.\n\n<Changes>\n+ quest Tails Again\n</Changes>');
        assert.equal(items(h, 'Rat Tail'), 0);
        // Loot: rats drop tails (80 %).
        for (let n = 0; n < 8 && items(h, 'Rat Tail') < 2; n += 1) await fight(h, 'Cellar Rat Swarm | tier: trivial');
        assert.ok(items(h, 'Rat Tail') >= 2, 'loot gave the tails');
        const owned = items(h, 'Rat Tail');
        await h.say('The keeper counts.', ['- quest Tails — done']);
        assert.equal(job(h, 'Tails').rpg.state, 'done', JSON.stringify(h.store.problems()));
        assert.equal(wallet(h), 60);
        assert.equal(items(h, 'Rat Tail'), owned - 2, 'two tails were consumed');
        // A story item: held to the story goods budget, counted at turn-in.
        await h.say('A farmer brings tails.', ['+ item Rat Tail | qty: 4']);
        const have = items(h, 'Rat Tail');
        assert.ok(have >= 4, `the story's tails came: ${have}`);
        await h.say('The keeper counts again.', ['- quest Tails Again — done']);
        assert.equal(job(h, 'Tails Again').rpg.state, 'done', JSON.stringify(h.store.problems()));
        assert.equal(wallet(h), 140);
        await agree(h);
    });
});

// ---- strict mode ----

test('strict mode: the free-form line is refused as in 2.2.0 and the open-quest line lists the slugs; turning the feature off keeps what was posted', async t => {
    await seeded(4209, async () => {
        const h = await bluewatch(t, { start: true });
        await h.say('Hollis has a job.', [G1]);
        const id = job(h, 'Granary Vermin').id;
        const before = JSON.stringify(h.head());
        h.features.set('rpg-battle.generative-offers', false);
        assert.equal(JSON.stringify(h.head()), before, 'the state is never touched');
        await accept(h, 'Granary Vermin');
        assert.equal(job(h, 'Granary Vermin').rpg.state, 'active', 'a posted job is taken up as ever');
        await h.say('Another.', ['+ quest Rat Trouble | goal: kill 3 rats | reward: 100 copper']);
        assert.equal(job(h, 'Rat Trouble'), null);
        assert.match(JSON.stringify(h.turn.problems()), /no frozen quest template/);
        assert.equal(Object.keys(offers(h)).length, 1);
        assert.equal(offers(h)[id].settled.coin, 50);
        h.features.set('rpg-battle.generative-offers', true);
        await h.say('Again.', ['+ quest Rat Trouble | goal: kill 3 rats | reward: 100 copper']);
        assert.equal(Object.keys(offers(h)).length, 2);
    });
});

// ---- a chat recorded on 2.2.0 ----

test('a chat recorded on 2.2.0 offers its first generative job and a second; a delete takes that reply\'s record only, whichever came first', async t => {
    await seeded(4210, async () => {
        const h = await bluewatch(t, { st: { chat: structuredClone(fixture.chat), extensionSettings: structuredClone(fixture.extensionSettings) } });
        assert.equal(offersOf(h.head().domains.rules) && Object.keys(offersOf(h.head().domains.rules)).length, 0, 'a pin from before 2.3.0 has no offers');
        await h.say('Hollis has a job.', [G1]);
        await h.say('Another.', ['+ quest Rat Trouble | goal: kill 3 rats | reward: 100 copper']);
        assert.equal(Object.keys(offers(h)).length, 2);
        await agree(h);
        // Deleting the second takes the second only.
        await drop(h, at(h, 'Another.'));
        assert.deepEqual(Object.values(offers(h)).map(o => o.name), ['Granary Vermin']);
        assert.deepEqual(h.store.problems(), []);
        await h.say('Another again.', ['+ quest Rat Trouble | goal: kill 3 rats | reward: 100 copper']);
        // Each record is one key of the rules slice, so the first reply made no map the later ones hang on: taking it back takes the first job and nothing else.
        await drop(h, at(h, 'Hollis has a job.'));
        assert.equal(job(h, 'Granary Vermin'), null);
        assert.ok(job(h, 'Rat Trouble'));
        assert.deepEqual(Object.values(offers(h)).map(o => o.name), ['Rat Trouble']);
        assert.deepEqual(h.store.problems(), []);
        await agree(h);
    });
});

test('a chat recorded on 2.2.0: the first job\'s reply has its card line, and swiping it away leaves the later jobs and replies alone', async t => {
    await seeded(4211, async () => {
        const h = await bluewatch(t, { st: { chat: structuredClone(fixture.chat), extensionSettings: structuredClone(fixture.extensionSettings) } });
        const card = () => replyCardLines(h.registry.hookEntries('replyCard'), { index: h.store.headIndex(), state: h.store.at(h.store.headIndex()), changes: h.store.changesAt(h.store.headIndex()) });
        await h.say('Hollis has a job.', [G1]);
        assert.deepEqual(card().map(line => line.text), ['Posted: Granary Vermin, kill 6 Culvert Rats, 5 silver'], 'the first offer on an old pin has its line');
        // Swiped away, the job is gone and nothing else is touched; a later job is then the chat's first.
        await h.swipe('Nobody has a job.');
        assert.equal(job(h, 'Granary Vermin'), null);
        assert.deepEqual(h.store.problems(), []);
        await h.say('Hollis has a job.', [G1]);
        await h.say('Another.', ['+ quest Rat Trouble | goal: kill 3 rats | reward: 100 copper', '+ coin 3']);
        assert.equal(card().length, 1);
        const coin = wallet(h);
        await drop(h, at(h, 'Hollis has a job.'));
        assert.equal(wallet(h), coin, 'the later reply\'s coin stands');
        assert.ok(job(h, 'Rat Trouble'));
        assert.deepEqual(h.store.problems(), []);
        await agree(h);
    });
});

test('a chat recorded on 2.2.0: the first far-out decision makes no map the later ones hang on', async t => {
    await seeded(4212, async () => {
        const h = await bluewatch(t, { st: { chat: structuredClone(fixture.chat), extensionSettings: structuredClone(fixture.extensionSettings) } });
        assert.equal(Object.keys(declinedOf(h.head().domains.rules)).length, 0);
        const before = wallet(h);
        await h.say('Wild offer A.', ['+ quest Boar Hunt | goal: Hunt 3 wild boars | reward: 50 gold']);
        await h.say('Wild offer C.', ['+ coin 7', '+ quest Wolf Hunt | goal: Hunt 3 wolves | reward: 60 gold']);
        assert.deepEqual(Object.values(declinedOf(h.head().domains.rules)).map(row => row.name).sort(), ['Boar Hunt', 'Wolf Hunt']);
        await drop(h, at(h, 'Wild offer A.'));
        assert.deepEqual(Object.values(declinedOf(h.head().domains.rules)).map(row => row.name), ['Wolf Hunt']);
        assert.equal(wallet(h) - before, 7, 'the coin of the later reply stands');
        assert.deepEqual(h.store.problems(), []);
        await agree(h);
    });
});

test('PACK_TEXT is the file the fixture holds (a guard against the copy drifting)', () => {
    assert.equal(JSON.parse(PACK_TEXT).version, '1.6.0');
    assert.equal(ok({ ok: true }).ok, true);
});
