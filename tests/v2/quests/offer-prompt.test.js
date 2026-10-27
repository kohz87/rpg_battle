// Jobs from the story, what the narrator is shown and what the reader sees (GENERATIVE_OFFERS_SPEC §2, §9, §10, §16): the rules block and its grading guide, the
// settings, the sizes of §2.5, the bursts, the reply card, the Adjustments log, and the prompts that must not change by a byte (an unpinned chat, a pin without
// an open quest template, strict mode, the extension prompts the host keeps).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { staticParts } from '../../vendor/story-block/src/v2/prompt.js';
import { replyCardLines } from '../../vendor/story-block/src/v2/screens/index.js';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { G1, G2, PACK, PACK_TEXT, accept, bluewatch, lastTail, ok } from './helpers/bluewatch.js';
import { templateless, unpinned } from './helpers/prompt-scenarios.js';
import { offersOf, declinedOf } from '../../../src/v2/rules/offers.js';
import { adjustments } from '../../../src/v2/quests/offer-log.js';

const recorded = JSON.parse(readFileSync(new URL('./fixtures/prompt-2.2.0.json', import.meta.url), 'utf8'));
const json = value => JSON.parse(JSON.stringify(value));
const STRICT = { features: { 'rpg-battle.generative-offers': false } };
// The quests part's settings are stored under its name.
const withModule = values => ({ modules: { 'rpg-battle': Object.fromEntries(Object.entries(values).map(([key, value]) => [`quests.${key}`, value])) } });
const ownText = h => staticParts(h.registry).find(part => part.module === 'rpg-battle').text;
const allText = h => staticParts(h.registry).map(part => part.text).join('\n');
const block = h => h.q('quest.offerBlock', {});
/** The block as the static prompt shows it: with the reader's settings, which the query alone does not know. */
const shown = h => { const text = ownText(h); const from = text.indexOf('Jobs and teachers'); return text.slice(from, text.indexOf('\nGear wears by code', from)); };
const trainerGrammar = h => h.registry.module('rpg-battle').capture.kinds.trainer.grammar;
const openLine = tail => tail.split('\n').find(line => line.startsWith('Open quest:')) ?? null;

// ---- the prompts that do not change ----------------------------------------------------------------------------------

test('an unpinned chat: the static prompt and every tail are byte for byte the ones RPG Battle 2.2.0 sent', async () => {
    assert.deepEqual(await unpinned(), recorded.unpinned);
});

test('a pin with trainers and no open quest template (the open trainers pack without its template): byte for byte 2.2.0\'s', async () => {
    const now = await templateless();
    assert.deepEqual(now, recorded.templateless);
});

test('strict mode: a Bluewatch chat has the 2.2.0 slug lists and no rules block, and gives the same answers each reply', async t => {
    await seeded(6101, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        assert.equal(block(h), null);
        assert.ok(!ownText(h).includes('Jobs and teachers'));
        assert.ok(trainerGrammar(h).includes('(templates: '));
        await h.say('Quiet.');
        const line = openLine(lastTail(h));
        assert.equal(line.length, 450, '§2.5: the tail line is 450 characters on every reply of a Bluewatch 1.6.0 chat');
        assert.match(line, /^Open quest: \+ quest Name \| like: <open template slug> \(templates: /);
        const before = staticParts(h.registry);
        await h.say('Quiet again.');
        assert.deepEqual(staticParts(h.registry), before, 'the static prompt is the same on every reply');
    });
});

test('RPG Battle adds no extension prompt of its own: the host keeps the same keys with and without the rules block', async t => {
    await seeded(6102, async () => {
        const keys = h => [...new Set(h.st.promptLog.map(entry => entry.key))].sort();
        const on = await bluewatch(t);
        await on.say('Quiet.');
        const strict = await bluewatch(t, { settings: STRICT });
        await strict.say('Quiet.');
        assert.deepEqual(keys(on), keys(strict));
        assert.deepEqual(keys(on), ['story_block', 'story_suite_static', 'story_suite_static_story_block', 'story_suite_tail_1', 'story_suite_tail_1_story_block']);
    });
});

// ---- the rules block -------------------------------------------------------------------------------------------------

const FIXED = [
    'Jobs and teachers: write them your way. These labels help code read them; code keeps the numbers inside this world\'s limits.',
    'Job: + quest Name | giver: who | type: hunt, cull, gather, deliver, explore, escort or task | goal: what to do, with a count | reward: an amount | due: how long, e.g. in 3 days | difficulty: easy, normal or hard. Example: + quest Cellar Trouble | giver: the innkeeper | type: cull | goal: kill 4 rats in the cellar | reward: 5 silver | due: in 2 days | difficulty: easy',
    'Teacher: + trainer Name — what they teach | fee: an amount. Example: + trainer Old Soldier — spear and shield drills | fee: 4 silver',
    'Every job needs a deadline (due:). Code settles the template, rank, count, reward, XP, deadline and fee and tells you the terms on the next turn; use them from then on. A job offered in this reply can be taken up from {{user}}\'s next message (then write + quest Name).',
    'A hunt or cull counts only foes beaten in a fight: ! encounter 4 Foe (the terms name the foe). A gathering counts what the party holds when it is handed in: loot first, else + item as the story gives it.',
    'Job ranks here (a hunt takes its foe\'s rank; otherwise difficulty and {{user}}\'s rank decide):',
];
const GUIDE = [
    'Rank F (Registered, levels 1–10, pays 5 silver–4 gold): story tasks, hunts, deliveries; foes like Cellar Rat Swarm, Crag Wolf Matriarch, Restless Corpse.',
    'Rank E (Journeyman, levels 11–20, pays 8 gold–30 gold): story tasks, hunts, deliveries; foes like Reef Shark, Ash Crawler, Ice Troll.',
    'Rank D (Proven, levels 21–30, pays 30 gold–120 gold): story tasks, hunts, deliveries; foes like Stone Hound, Dungeon Shade, Glass Beetle.',
    'Rank C (Veteran, levels 26–40, pays 120 gold–600 gold): story tasks, hunts, deliveries; foes like Dust Wraith, Tomb Sentinel.',
];

test('Bluewatch 1.6.0: the rules block is the text of §2.2 with the pack\'s own money and the guide of §2.3, 551 characters of it', async t => {
    await seeded(6103, async () => {
        const h = await bluewatch(t);
        assert.equal(block(h), [...FIXED, ...GUIDE].join('\n'));
        assert.equal(FIXED.join('\n').length, 1195, '§2.5: the fixed lines are 1,195 characters');
        assert.equal(GUIDE.join('\n').length, 551, '§2.5: the guide is 551 characters');
        assert.equal(block(h).length, 1195 + 1 + 551);
        assert.ok(ownText(h).includes(`\n${block(h)}\n`), 'and the static prompt shows it');
        assert.equal(h.q('quest.offerBlockOn', {}), true);
    });
});

test('§2.5 sizes on Bluewatch 1.6.0: the static prompt grows by 1,652 characters, the trainer line shrinks from 209 to 114, the tail loses 450', async t => {
    await seeded(6104, async () => {
        const on = await bluewatch(t);
        const off = await bluewatch(t, { settings: STRICT });
        const length = h => allText(h).length;
        assert.equal(trainerGrammar(off).length, 209);
        assert.equal(trainerGrammar(on).length, 114);
        assert.equal(trainerGrammar(on), '+ trainer Name — what they teach [| teaches: skill, skill] [| fee: amount]. Code picks the lessons, fee and place.');
        assert.equal(trainerGrammar(on).length - trainerGrammar(off).length, -95);
        // The block, its newline, and 95 characters fewer in the trainer line.
        assert.equal(length(on) - length(off), 1195 + 1 + 551 - 95 + 1, 'the block and the newline that joins it, less the trainer line\'s 95');
        await on.say('Quiet.');
        await off.say('Quiet.');
        assert.equal(openLine(lastTail(on)), null, 'the slug list is gone while the block is shown');
        assert.equal(lastTail(off).length - lastTail(on).length, 450 + 1, 'the 450 characters of the line and its newline');
        // Four ranks of 201 characters at most, the cap of the guide.
        assert.ok(GUIDE.every(line => line.length <= 201));
    });
});

test('the block is the same on every reply, and the settings change it: ranks, examples, none at all', async t => {
    await seeded(6105, async () => {
        const h = await bluewatch(t);
        const first = block(h);
        await h.say('Quiet.');
        await h.say('Quiet again.');
        assert.equal(block(h), first);

        const two = await bluewatch(t, { settings: withModule({ offerGuideRanks: 2 }) });
        assert.equal(shown(two), [...FIXED, ...GUIDE.slice(0, 2)].join('\n'));

        const none = await bluewatch(t, { settings: withModule({ offerGuideRanks: 0 }) });
        assert.equal(shown(none), FIXED.slice(0, -1).join('\n'), 'no guide and no header line for it');

        const bare = await bluewatch(t, { settings: withModule({ offerGuideExamples: 0 }) });
        assert.equal(shown(bare), [...FIXED, ...GUIDE.map(line => line.replace(/; foes like .*\.$/, '.'))].join('\n'));

        const one = await bluewatch(t, { settings: withModule({ offerGuideExamples: 1 }) });
        assert.equal(shown(one), [...FIXED, ...GUIDE.map(line => line.replace(/; foes like ([^,]*)(?:,.*)?\.$/, '; foes like $1.'))].join('\n'));

        // Eight is the most; the pack has four ranks with a template, so no more than four lines; a value out of range is the default.
        const most = await bluewatch(t, { settings: withModule({ offerGuideRanks: 8 }) });
        assert.equal(shown(most), block(h));
        const wild = await bluewatch(t, { settings: withModule({ offerGuideRanks: 99, offerGuideExamples: -1 }) });
        assert.equal(shown(wild), block(h));
    });
});

test('the block is made from the pin: removing the installed pack afterwards leaves the guide to the ladder the templates give', async t => {
    await seeded(6106, async () => {
        const h = await bluewatch(t);
        const installed = block(h);
        await h.packs.packs.remove(PACK.id);
        const pinned = block(h);
        // The pack's money is gone with it (the examples name the chat's own currency); the other lines are as they were.
        assert.deepEqual([0, 3, 4, 5].map(n => pinned.split('\n')[n]), [0, 3, 4, 5].map(n => FIXED[n]));
        const lines = pinned.split('\n').slice(FIXED.length);
        assert.ok(lines.length >= 1 && lines.length <= 4);
        assert.ok(lines.every(line => /^Rank \S+ \(\S.*, pays .*\): .*\.$/.test(line) && line.length <= 201), lines.join('\n'));
        assert.equal(installed.split('\n').length, FIXED.length + 4);
    });
});

test('a pin whose pack has no trainer template leaves the Teacher line out', async t => {
    await seeded(6107, async () => {
        const pack = JSON.parse(PACK_TEXT);
        pack.content.rules[0].trainers = [];
        const h = await bluewatch(t, { pack: JSON.stringify(pack) });
        assert.equal(block(h), [FIXED[0], FIXED[1], ...FIXED.slice(3), ...GUIDE].join('\n'));
        assert.equal(h.q('quest.offerBlockOn', {}), true);
    });
});

// ---- bursts: the terms told, the rest counted -----------------------------------------------------------------------

const jobs = (count, extra = '') => Array.from({ length: count }, (_, n) => `+ quest Job ${n + 1} | giver: Hollis | type: cull | goal: kill ${n + 1} rats | reward: 60 copper | due: in 2 days${extra}`);
const farJobs = count => Array.from({ length: count }, (_, n) => `+ quest Gold Job ${n + 1} | type: hunt | goal: slay 2 wolves | reward: ${n + 1}00 gold`);
const posted = tail => tail.split('\n').filter(line => line.startsWith('Posted job: '));
const earlier = tail => tail.split('\n').filter(line => line.startsWith('Earlier, '));
const counted = tail => tail.split('\n').filter(line => line.startsWith('…and '));

test('a burst: three terms and "…and 2 more jobs are posted", two far-out lines and "…and 2 more offers were not possible", then nothing the reply after', async t => {
    await seeded(6108, async () => {
        const h = await bluewatch(t);
        await h.say('A rush.', [...jobs(5), ...farJobs(4)]);
        assert.deepEqual(h.turn.problems(), []);
        await h.say('Quiet.');
        const tail = lastTail(h);
        assert.equal(posted(tail).length, 3);
        assert.equal(earlier(tail).length, 2);
        assert.deepEqual(counted(tail), ['…and 2 more jobs are posted (see the board).', '…and 2 more offers were not possible.']);
        assert.ok(posted(tail).every(line => line.length <= 320));
        assert.ok(earlier(tail).every(line => line.length <= 300));
        // All five are posted, the three first told: the board has them all.
        assert.equal(Object.keys(offersOf(h.head().domains.rules)).length, 5);
        assert.equal(Object.keys(declinedOf(h.head().domains.rules)).length, 4);
        // Worst case of §2.5: the lines past the terms are at most 60 and 50 characters.
        assert.ok(counted(tail).every(line => line.length <= 60));
        // The reply after tells none of it again.
        await h.say('Later.');
        const next = lastTail(h);
        assert.deepEqual([posted(next), earlier(next), counted(next)], [[], [], []]);
    });
});

test('offerTermsPerReply sets how many terms a reply tells: 1 counts four, 6 counts none', async t => {
    await seeded(6109, async () => {
        const one = await bluewatch(t, { settings: withModule({ offerTermsPerReply: 1 }) });
        await one.say('A rush.', jobs(5));
        await one.say('Quiet.');
        assert.equal(posted(lastTail(one)).length, 1);
        assert.deepEqual(counted(lastTail(one)), ['…and 4 more jobs are posted (see the board).']);

        const six = await bluewatch(t, { settings: withModule({ offerTermsPerReply: 6 }) });
        await six.say('A rush.', jobs(5));
        await six.say('Quiet.');
        assert.equal(posted(lastTail(six)).length, 5);
        assert.deepEqual(counted(lastTail(six)), []);

        const odd = await bluewatch(t, { settings: withModule({ offerTermsPerReply: 0 }) });
        await odd.say('A rush.', jobs(4));
        await odd.say('Quiet.');
        assert.equal(posted(lastTail(odd)).length, 3, 'out of range is the default of 3');
        assert.deepEqual(counted(lastTail(odd)), ['…and 1 more job is posted (see the board).']);
    });
});

test('the counted lines follow the reply: deleting it takes them away', async t => {
    await seeded(6110, async () => {
        const h = await bluewatch(t);
        await h.say('A rush.', [...jobs(4), ...farJobs(3)]);
        h.store.rebuild();
        await h.say('Quiet.');
        assert.deepEqual(counted(lastTail(h)), ['…and 1 more job is posted (see the board).', '…and 1 more offer was not possible.']);
        const index = h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes('A rush.'));
        await h.st.deleteMessage(index + 1);
        await h.st.deleteMessage(index);
        await h.st.deleteMessage(index - 1);
        await h.say('Instead.');
        assert.deepEqual(counted(lastTail(h)), []);
        assert.deepEqual(Object.keys(offersOf(h.head().domains.rules)), []);
    });
});

// ---- the reply card and the Adjustments log --------------------------------------------------------------------------

const cardOf = h => {
    const index = h.store.headIndex();
    return replyCardLines(h.registry.hookEntries('replyCard'), { index, state: h.store.at(index), changes: h.store.changesAt(index) });
};

test('the reply card: one "Posted:" line for the job, Adjusted when code moved something, and one short Why', async t => {
    await seeded(6111, async () => {
        const h = await bluewatch(t);
        await h.say('Hollis has two jobs.', [G1, G2, '+ quest Boar Hunt | type: hunt | goal: Hunt 3 wild boars | reward: 50 gold']);
        const lines = cardOf(h);
        assert.equal(lines.length, 2, 'the far-out offer is not a job and has no line');
        assert.deepEqual(lines.map(line => ({ text: line.text, summary: line.summary, flag: line.flag, note: line.note, icon: line.icon })), [
            { text: 'Posted: Granary Vermin, kill 6 Culvert Rats, 5 silver', summary: 'Job: Granary Vermin', flag: 'Adjusted', icon: 'fa-scroll',
                note: '12 crowns isn’t this chat’s money, so it was set to 5 silver.' },
            { text: 'Posted: Scrub Pack, kill 1 Alpha of the Scrub Wolf Pack, 5 silver', summary: 'Job: Scrub Pack', flag: 'Adjusted', icon: 'fa-scroll',
                note: '30 crowns isn’t this chat’s money, and the count was set to 1.' },
        ]);
        assert.deepEqual(h.turn.problems(), [], 'a normalized offer is not a Problem');
        // The next reply offers nothing, so it has no such line.
        await h.say('Quiet.');
        assert.deepEqual(cardOf(h), []);
    });
});

test('the reply card for a job kept as written has no flag and no Why; a teacher gets a line of its own', async t => {
    await seeded(6112, async () => {
        const h = await bluewatch(t);
        await h.say('Reka has a lesson.', ['+ quest Rat Trouble | giver: Hollis | type: cull | goal: kill 2 rats | reward: 6 silver | due: in 2 days', '+ trainer Old Reka — blade drills | fee: 6 silver']);
        const lines = cardOf(h);
        const job = lines.find(line => line.summary === 'Job: Rat Trouble');
        assert.ok(job, JSON.stringify(lines));
        assert.equal(job.flag, '');
        assert.match(job.text, /^Posted: Rat Trouble, kill 2 /);
        const teacher = lines.find(line => line.summary === 'Teacher: Old Reka');
        assert.ok(teacher, JSON.stringify(lines));
        assert.equal(teacher.icon, 'fa-chalkboard-user');
        assert.match(teacher.text, /^Posted: Old Reka, /);
    });
});

test('strict mode has no card lines and no Adjustments, and the lines of a posted job stay in the state', async t => {
    await seeded(6113, async () => {
        const h = await bluewatch(t, { settings: STRICT });
        await h.say('Hollis speaks.', [G1]);
        assert.deepEqual(cardOf(h), []);
        assert.equal(h.q('quest.adjustments', { limit: 50 }), null);
    });
});

test('quest.adjustments: the offers code changed, newest first, with what changed and what the narrator wrote', async t => {
    await seeded(6114, async () => {
        const h = await bluewatch(t);
        await h.say('Hollis has a job.', [G1]);
        await h.say('Hollis has another, and a boar hunt.', [G2, '+ quest Boar Hunt | type: hunt | goal: Hunt 3 wild boars | reward: 50 gold', '+ trainer Old Reka — swordplay']);
        const log = h.q('quest.adjustments', { limit: 50 });
        assert.equal(log.count, log.rows.length);
        const by = name => log.rows.find(row => row.name === name);
        assert.deepEqual(log.rows.map(row => row.name).slice(0, 3).sort(), ['Boar Hunt', 'Old Reka', 'Scrub Pack']);
        assert.equal(log.rows.at(-1).name, 'Granary Vermin', 'the older reply is last');
        assert.ok(log.rows[0].reply >= log.rows.at(-1).reply);

        const vermin = by('Granary Vermin');
        assert.equal(vermin.band, 'adjusted');
        assert.equal(vermin.bandLabel, 'Adjusted');
        assert.equal(vermin.became, 'Hunt · kill 6 Culvert Rats · 5 silver · 50 XP · 7 days');
        assert.deepEqual(vermin.changes, [{ k: 'reward', from: '12 crowns', to: '5 silver' }, { k: 'count', from: '', to: '6' }, { k: 'deadline', from: '', to: '7 days' }]);
        assert.equal(vermin.wrote, 'giver: Hollis · type: cull · goal: Kill 6 culvert rats in the south levee granary and collect tails · reward: 12 crowns · difficulty: easy');
        assert.deepEqual(vermin.notes, ['reward "12 crowns" is not this chat\'s money; set to 5 silver', 'Culvert Rats is a named kind of Cellar Rat Swarm', 'deadline set to 7 days']);

        const boar = by('Boar Hunt');
        assert.equal(boar.band, 'dropped');
        assert.equal(boar.bandLabel, 'Dropped');
        assert.equal(boar.became, 'Hunt · Hunt 3 wild boars · 50 gold · not offered');
        assert.equal(boar.dropped, '50 gold is far above a rank F job (max 4 gold). The narrator was told once.');
        assert.deepEqual(boar.notes, ['50 gold is far above what a rank F job pays: 4 gold at most', 'Told once: “…offer it for 4 gold or less.”']);
        assert.deepEqual(boar.changes, []);

        const reka = by('Old Reka');
        assert.equal(reka.kind, 'teacher');
        assert.ok(reka.notes.some(note => /^matched /.test(note)), JSON.stringify(reka));
        assert.equal(reka.wrote, '— swordplay');

        assert.equal(h.q('quest.adjustments', { limit: 1 }).rows.length, 1);
        assert.equal(h.q('quest.adjustments', {}).rows.length, log.rows.length, 'no limit is fifty');
        assert.equal(h.q('quest.adjustments', { limit: 0 }).rows.length, log.rows.length, 'a limit out of range is fifty');
    });
});

test('Adjustments shows at most fifty rows and keeps the same order after a rebuild', async t => {
    await seeded(6115, async () => {
        const h = await bluewatch(t);
        for (let n = 0; n < 4; n += 1) await h.say(`Rush ${n}.`, Array.from({ length: 4 }, (_, k) => `+ quest Far ${n}-${k} | type: hunt | goal: slay a wolf | reward: ${k + 1}00 gold`));
        const live = json(h.q('quest.adjustments', { limit: 50 }));
        assert.equal(live.rows.length, 16);
        h.store.rebuild();
        assert.deepEqual(json(h.q('quest.adjustments', { limit: 50 })), live);
        assert.deepEqual(live.rows.map(row => row.reply), [...live.rows.map(row => row.reply)].sort((a, b) => b - a), 'newest first');
    });
});

test('the Quests page draws the Adjustments log: a collapsed section with a count, a row for each, none without any', async t => {
    await seeded(6116, async () => {
        const h = await bluewatch(t);
        const empty = h.q('rpg-battle.questsView', {});
        assert.deepEqual(empty.adjustments, { count: 0, recent: [], older: [], hasOlder: false, olderCount: 0 });
        await h.say('Hollis has a job.', [G1, '+ quest Boar Hunt | type: hunt | goal: Hunt 3 wild boars | reward: 50 gold']);
        const view = h.q('rpg-battle.questsView', {});
        assert.equal(view.adjustments.count, 2);
        assert.deepEqual(view.adjustments.recent.map(row => row.name).sort(), ['Boar Hunt', 'Granary Vermin']);
        const vermin = view.adjustments.recent.find(row => row.name === 'Granary Vermin');
        assert.deepEqual([vermin.adjusted, vermin.kept, vermin.dropped], [true, false, false]);
        assert.deepEqual(vermin.changes.map(change => [change.k, change.unwritten]), [['reward', false], ['count', true], ['deadline', true]]);
        assert.equal(view.adjustments.hasOlder, false);
        // More than ten: the rest are behind "Older".
        for (let n = 0; n < 3; n += 1) await h.say(`Rush ${n}.`, Array.from({ length: 4 }, (_, k) => `+ quest Far ${n}-${k} | type: hunt | goal: slay a wolf | reward: ${k + 1}00 gold`));
        const more = h.q('rpg-battle.questsView', {}).adjustments;
        assert.equal(more.count, 14);
        assert.equal(more.recent.length, 10);
        assert.equal(more.older.length, 4);
        assert.equal(more.hasOlder, true);
        assert.equal(more.olderCount, 4);
    });
});

test('an accepted job still shows what code changed', async t => {
    await seeded(6117, async () => {
        const h = await bluewatch(t);
        await h.say('Hollis has a job.', [G1]);
        await accept(h, 'Granary Vermin');
        const row = h.q('quest.adjustments', {}).rows.find(entry => entry.name === 'Granary Vermin');
        assert.equal(row.band, 'adjusted');
        assert.equal(row.reply, h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes('Hollis has a job.')));
    });
});

test('an unpinned chat has neither the block nor the log', async () => {
    await seeded(6118, async () => {
        const h = await rpgHost();
        try {
            assert.equal(h.q('quest.offerBlock', {}), null);
            assert.equal(h.q('quest.offerBlockOn', {}), false);
            assert.deepEqual(h.q('quest.adjustments', {}), { count: 0, rows: [] });
            assert.deepEqual(h.q('quest.replyOffers', {}), { jobs: 0, declined: 0 });
        } finally { h.close(); }
    });
});

// ---- NPC State Delta's own prompt ------------------------------------------------------------------------------------

const nsdPath = new URL('../../../../npc_state_delta/src/storysuite-v2.js', import.meta.url);
const nsdSkip = !existsSync(nsdPath) && 'The sibling NPC State Delta checkout is absent.';

test('NPC State Delta\'s prompt (its instructions part and its two kinds\' lines) is the one recorded beside RPG Battle 2.2.0, with Jobs from the story on and in strict mode', { skip: nsdSkip }, async t => {
    const nsdRecorded = JSON.parse(readFileSync(new URL('./fixtures/nsd-prompt-2.2.0.json', import.meta.url), 'utf8'));
    const { createStorySuiteV2Adapter } = await import(nsdPath.href);
    for (const settings of [undefined, STRICT]) {
        await seeded(6119, async () => {
            const nsd = createStorySuiteV2Adapter({ suiteApi: { npcs: () => [] }, delta: () => ({ isEnabled: () => true, getNpc: () => null }), doc: null, timers: {}, logger: { warn() {} } }).definition;
            const h = await bluewatch(t, { settings, extraModules: [nsd] });
            await h.say('Bluewatch.', ['~ npc Odda | trust: +3']);
            const parts = staticParts(h.registry);
            assert.deepEqual(parts.find(part => part.module === 'npc-state-delta'), nsdRecorded.part);
            const suite = parts.find(part => part.module === 'story-suite').text.split('\n');
            assert.deepEqual(suite.filter(line => line.startsWith('~ npc ') || line.startsWith('+ milestone ')), nsdRecorded.kindLines);
        });
    }
});

// ---- the reply an Adjustments row names --------------------------------------------------------------------------------------

test('an Adjustments row for a job names the reply that made the offer, not the one that took it up or turned it in', async t => {
    await seeded(8801, async () => {
        const h = await bluewatch(t);
        await h.say('Hollis has a job.', [G1]);
        const offered = h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes('Hollis has a job.'));
        await accept(h, 'Granary Vermin');
        await h.say('Later.', ['~ quest Granary Vermin | progress: counting', '- quest Granary Vermin — done']);
        await h.say('Much later.');
        const row = h.q('quest.adjustments', {}).rows.find(entry => entry.name === 'Granary Vermin');
        assert.equal(row.reply, offered);
        assert.equal(row.replyText, `reply ${offered}`);
        const receipts = h.sdk.receipts().filter(entry => entry.receipt?.data?.quest === row.id);
        assert.ok(receipts.length >= 2, 'the thread has later receipts that carry its id');
    });
});

test('the reply of a record is the earliest receipt that carries its id (pure)', () => {
    const state = { domains: { rules: {} } };
    const shape = (id, index) => ({ index, receipt: { data: { quest: id } } });
    const slice = { 'offer.th_aaaaaaaa': { v: 1, matcher: 1, line: '0'.repeat(16), sid: 'sr_1', name: 'A', said: {}, notes: ['x'], where: '', band: 'within',
        settled: { template: 'pack.x/y', text: 'Kill', coin: 1, coinBy: 'formula', xp: 1, durationMinutes: null, turnInPlace: null, giver: null, rank: 'F', area: { tier: 0, from: 'rank' }, waived: [] } } };
    state.domains.rules = slice;
    for (const order of [[shape('th_aaaaaaaa', 4), shape('th_aaaaaaaa', 10), shape('th_aaaaaaaa', 24)], [shape('th_aaaaaaaa', 24), shape('th_aaaaaaaa', 10), shape('th_aaaaaaaa', 4)]]) {
        assert.equal(adjustments(state, {}, { receipts: () => order }).rows[0].reply, 4);
    }
});
