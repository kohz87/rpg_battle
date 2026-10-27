// Fixes after review (RPG Battle 2.3.0): template durations under an hour, the pay in a goal, digit groups and non-whole amounts, variant names that fit the told
// encounter line, the pack's own order of templates, the terms and far-out lines kept whole, and the smaller details of the reading. Pure first, then the real host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOffer } from '../../../src/v2/quests/offer-match.js';
import { matchTrainer } from '../../../src/v2/training/offer.js';
import { money, parseReward } from '../../../src/v2/quests/parse.js';
import { farLineOf, farReasonOf, settledTerms } from '../../../src/v2/quests/offer-bands.js';
import { durationRange } from '../../../src/v2/quests/offer-rules.js';
import { readEncounter } from '../../../src/v2/combat/encounter.js';
import { declinedOf, offersOf } from '../../../src/v2/rules/offers.js';
import { seeded } from '../integration/helpers/host.js';
import { COPPER, derivedPin, env, lineOf } from './helpers/offer-env.js';
import { G1, PACK, accept, bluewatch, lastTail } from './helpers/bluewatch.js';

const P = 'pack.ersveil-bluewatch';
const offer = (text, options) => matchOffer(env(options), lineOf(text));
const slug = result => String(result.settled.template).split('/')[1];

// ---- durations under an hour -----------------------------------------------------------------------------------------

test('a template that lasts under an hour has a deadline range of its own duration: 30 minutes is offered as 30 minutes, longer asks are held to it', () => {
    assert.deepEqual([durationRange({ durationMinutes: 30 }), durationRange({ durationMinutes: 59 }), durationRange({ durationMinutes: 60 }), durationRange({ durationMinutes: 120 }), durationRange({})],
        [[30, 30], [59, 59], [60, 60], [60, 120], [60, 43200]]);
    const short = derivedPin(resolved => { for (const quest of Object.values(resolved.quests)) if (quest.open === true) quest.durationMinutes = 30; });
    const plain = offer('+ quest Rats | goal: kill 3 rats | reward: 100 copper', { pin: short });
    assert.equal(plain.settled.durationMinutes, 30);
    const asked = offer('+ quest Rats | goal: kill 3 rats | reward: 100 copper | due: in 3 days', { pin: short });
    assert.deepEqual([asked.settled.durationMinutes, asked.band, asked.notes.includes('deadline set to 30 minutes')], [30, 'moderate', true]);
});

test('on the real host a job from a template of 30 minutes is offered, its guard replays, and the deadline is the template\'s', async t => {
    await seeded(8101, async () => {
        const pack = structuredClone(PACK);
        for (const quest of pack.content.quests) if (quest.open === true) quest.durationMinutes = 30;
        const h = await bluewatch(t, { pack: JSON.stringify(pack) });
        await h.say('Offer.', ['+ quest Rat Trouble | goal: kill 3 rats | reward: 100 copper', '+ quest Old Debts | goal: Settle the matter with the river guild | due: in 3 days']);
        assert.deepEqual(h.turn.problems(), []);
        assert.deepEqual(Object.values(offersOf(h.head().domains.rules)).map(record => [record.name, record.settled.durationMinutes]).sort(), [['Old Debts', 30], ['Rat Trouble', 30]]);
        const live = JSON.stringify(h.head());
        h.store.rebuild();
        assert.equal(JSON.stringify(h.head()), live);
        assert.deepEqual(h.store.problems(), []);
    });
});

// ---- the pay in a goal -----------------------------------------------------------------------------------------------

test('a coin word in a goal is the goods unless a pay marker comes first: no reward label, no pay from "12 silver spoons"', () => {
    for (const goal of ['Deliver 12 silver spoons to the baker', 'Kill 6 copper beetles in the mine', 'Bring a dozen silver spoons to the baker', 'Kill several gold-scaled lizards',
        'Fetch 3 gold coins for the baker', 'Return the 80 gold stolen by the thieves', 'Escort the miller; he carries 2 gold']) {
        const result = offer(`+ quest Task | goal: ${goal}`);
        assert.equal(result.kind, 'offer', goal);
        assert.deepEqual([result.settled.coinBy, result.band, result.notes.filter(note => /reward/.test(note))], ['formula', 'within', []], goal);
    }
    const pays = offer('+ quest Task | goal: Clear the cellar of rats, pays 40 copper');
    assert.deepEqual([pays.settled.coinBy, pays.settled.coin, pays.band], ['said', 50, 'moderate'], 'pays 40 is raised to the 50 floor');
    assert.equal(offer('+ quest Task | goal: Kill 3 rats in the cellar for 3 silver').settled.coin, 50);
    assert.equal(offer('+ quest Task | goal: Kill 3 rats in the cellar for 300 copper').settled.coin, 300);
    // Never far out from a goal: a huge pay in the goal is held to the top of the range.
    const huge = offer('+ quest Task | goal: Kill 3 rats in the cellar, pays 90000 gold');
    assert.deepEqual([huge.kind, huge.settled?.coin, huge.band], ['offer', 400, 'moderate']);
    // A label still is the reward, and far out as before.
    assert.equal(offer('+ quest Task | goal: Kill 3 rats | reward: 90000 gold').kind, 'far');
    // A goal amount that is not readable is no pay, with no note.
    assert.deepEqual(offer('+ quest Task | goal: Kill 3 rats, pays 1.5 gold').notes.filter(note => /reward/.test(note)), []);
});

// ---- money in digit groups, decimals, fractions, signs -------------------------------------------------------------------

test('digit groups are one number; a decimal, a fraction or a sign is no amount code can read, never another number', () => {
    const read = reward => parseReward({ reward }, '', { currency: COPPER, amountWords: true });
    for (const [written, copper] of [['1,000 gold', 100000], ['2,500 copper', 2500], ['10,000 copper', 10000], ['1 000 copper', 1000], ['1.000 copper', 1000], ['1.000.000 copper', 1000000], ['5 gold', 500], ['1 gold 5 silver', 150]]) {
        assert.equal(read(written).amount, copper, written);
    }
    for (const written of ['1.5 gold', '3.5 silver', '12,5 gold', '0.500 gold', '1,000.50 gold', '½ gold', '1/2 gold', '1½ gold', '-5 gold', '+5 gold']) {
        const got = read(written);
        assert.equal(got.amount, null, written);
        assert.match(got.problem, /is not a whole amount code can read/, written);
    }
});

test('in an offer: "1,000 copper" is a thousand (held to the range), "1.5 gold" and "-5 gold" are unreadable and the reward is the template\'s formula', () => {
    const big = offer('+ quest Rats | goal: kill 3 rats | reward: 1,000 copper');
    assert.deepEqual([big.settled.coin, big.band, big.notes[0]], [400, 'moderate', 'reward set to 4 gold (rank F range)']);
    for (const written of ['1.5 gold', '-5 gold', '1/2 gold']) {
        const bad = offer(`+ quest Rats | goal: kill 3 rats | reward: ${written}`);
        assert.deepEqual([bad.settled.coinBy, bad.band, bad.notes[0]], ['formula', 'moderate', `reward "${written}" has no amount code can read; set to 5 silver`], written);
    }
});

test('the same for a teacher\'s fee', () => {
    const fee = text => matchTrainer(env(), lineOf(`+ trainer Old Reka — blade drills | fee: ${text}`));
    const grouped = fee('1,000 copper');
    assert.deepEqual([grouped.kind, grouped.why, grouped.written], ['far', 'fee', 1000], 'a thousand copper, not 1');
    assert.deepEqual(fee('6 silver').fee, { value: 60, by: 'said' });
    const odd = fee('1.5 silver');
    assert.equal(odd.fee, null);
    assert.ok(odd.notes.some(note => /^fee "1\.5 silver" has no amount code can read/.test(note)), odd.notes.join('|'));
});

// ---- variant names ---------------------------------------------------------------------------------------------------

const told = result => /Fight (?:them|it) as (! encounter [^\n]*?)\. These are/.exec(settledTerms({ ...result, where: 'Bluewatch Village' }, 'Task', COPPER))?.[1];

test('the encounter line the terms tell is accepted by the encounter reader, whatever the narrator wrote for the foe', () => {
    for (const goal of ['Kill 2 extremely aggressive territorial marsh crocodile hatchlings', 'Kill 2 Ünïcödé rats', "Kill 2 rat-catchers' guild", 'Kill 2 "big" rats', 'Kill 2 aggressive marsh crocodile hatchlings',
        'Kill 99 extremely aggressive territorial marsh crocodile hatchlings', 'Kill 2 rats: the big ones', 'Kill 2 a|b crocodiles']) {
        const result = offer(`+ quest Task | goal: ${goal} | reward: 100 copper`, { pin: derivedPin(resolved => { for (const quest of Object.values(resolved.quests)) if (quest.open === true && quest.objectives[0].kind === 'kill') Object.assign(quest.objectives[0], { countMin: 1, countMax: 99 }); }) });
        if (result.kind !== 'offer' || !result.settled.foe) continue;
        const line = told(result);
        assert.ok(line, goal);
        const read = readEncounter(lineOf(line), { bestiary: [], literal: true, leadingCount: true });
        assert.equal(read.ok, true, `${goal}: ${line}: ${read.message}`);
        assert.ok([...result.settled.foe.name].length <= 45, goal);
    }
});

test('a variant is not made from stray tokens: "level 5", numbers and ordinals are not part of a kind of foe', () => {
    const named = goal => offer(`+ quest Task | goal: ${goal}`).settled.foe?.name ?? null;
    assert.equal(named('Kill 2 second goblins'), 'Goblins');
    assert.equal(named('Kill 2 level 5 goblins'), null, 'the phrase stops at the number, and "level" alone is no kind of foe');
    assert.equal(named('Kill 2 level'), null);
    assert.equal(named('Kill 3 7th'), null);
});

// ---- the pack's own order ---------------------------------------------------------------------------------------------

test('"first in pack order" is the pack\'s order of templates, not the pin\'s id order; without the pack the id order stands', () => {
    const pin = derivedPin(resolved => {
        const hunt = resolved.quests[`${P}/open-hunt-f`];
        const second = structuredClone(hunt);
        Object.assign(second, { id: `${P}/open-aaa-hunt-f`, slug: 'open-aaa-hunt-f', name: 'Aaa Hunt (F)' });
        const rest = Object.entries(resolved.quests).filter(([id]) => id !== `${P}/open-hunt-f`);
        for (const id of Object.keys(resolved.quests)) delete resolved.quests[id];
        // Sorted by id, as the pin keeps them: aaa before hunt.
        Object.assign(resolved.quests, Object.fromEntries([[second.id, second], [hunt.id, hunt], ...rest]));
    });
    assert.equal(slug(offer('+ quest Rats | goal: kill 3 rats', { pin })), 'open-aaa-hunt-f', 'no pack order: the id order');
    const order = [`${P}/open-hunt-f`, `${P}/open-aaa-hunt-f`];
    assert.equal(slug(offer('+ quest Rats | goal: kill 3 rats', { pin, questOrder: order })), 'open-hunt-f', 'the pack lists the hunt first');
    assert.equal(slug(offer('+ quest Rats | goal: kill 3 rats', { pin, questOrder: [`${P}/open-aaa-hunt-f`] })), 'open-aaa-hunt-f');
});

test('on the real host the order comes from the installed pack', async t => {
    await seeded(8102, async () => {
        const pack = structuredClone(PACK);
        const quests = pack.content.quests;
        const hunt = quests.find(quest => quest.slug === 'open-hunt-f');
        const first = structuredClone(hunt);
        Object.assign(first, { slug: 'open-zeta-hunt-f', name: 'Zeta Hunt (F)' });
        // The pack lists zeta before the hunt; sorted by id the hunt comes first.
        quests.splice(quests.indexOf(hunt), 0, first);
        const h = await bluewatch(t, { pack: JSON.stringify(pack) });
        assert.deepEqual(h.q('packs.content', { kind: 'quests', pack: PACK.id }).filter(row => /^open-(zeta-)?hunt-f$/.test(row.slug)).map(row => row.slug), ['open-zeta-hunt-f', 'open-hunt-f']);
        await h.say('Offer.', ['+ quest Rats | goal: kill 3 rats | reward: 100 copper']);
        assert.deepEqual(h.turn.problems(), []);
        assert.equal(Object.values(offersOf(h.head().domains.rules))[0].settled.template, `${P}/open-zeta-hunt-f`);
    });
});

// ---- the lines told back ---------------------------------------------------------------------------------------------

test('the terms line keeps the pay, the fight line and "These are the terms…" whole when the name, the giver and the place are long', () => {
    const here = 'The Great Hall of the Honourable Guild of River Wardens and Lamplighters, Eastern Quarter';
    const name = 'N'.repeat(80);
    const result = matchOffer({ ...env(), here: { id: env().here.id, name: here } }, lineOf(`+ quest ${name} | giver: ${'G'.repeat(80)} | goal: Kill 6 extremely aggressive territorial marsh crocodile hatchlings | reward: 100 copper | due: in 3 days`));
    const line = settledTerms({ ...result, where: here }, name, COPPER);
    assert.ok([...line].length <= 320);
    assert.match(line, /; pays 1 gold and 50 XP, turned in at .*\. Fight them as ! encounter 6 .* \| like: [a-z-]+\. These are the terms from now on; nobody in the scene has to restate them\.$/);
    assert.ok(told(result) && line.includes(`Fight them as ${told(result)}.`));
});

test('the far-out reason is built from its parts: a "(" in the name does not garble the record', async t => {
    const result = offer('+ quest Boar Hunt (Part 2) | goal: Hunt 3 wild boars | reward: 50 gold');
    assert.equal(result.kind, 'far');
    assert.deepEqual(farReasonOf(result, COPPER), { reason: '50 gold is far above what a rank F job pays: 4 gold at most', suggestion: 'it for 4 gold or less' });
    assert.ok([...farLineOf(result, COPPER)].length <= 300);
    await seeded(8103, async () => {
        const h = await bluewatch(t);
        await h.say('Wild.', ['+ quest Boar Hunt (Part 2) | goal: Hunt 3 wild boars | reward: 50 gold']);
        const [record] = Object.values(declinedOf(h.head().domains.rules));
        assert.deepEqual([record.reason, record.suggestion], ['50 gold is far above what a rank F job pays: 4 gold at most', 'it for 4 gold or less']);
    });
});

test('a goal that flattens to nothing is the job\'s name', () => {
    const result = offer('+ quest Rats | goal: \u0007');
    assert.equal(result.kind, 'offer');
    assert.equal(result.settled.text, 'Rats');
});

test('like: a story template with foe: says the foe was not used', () => {
    const result = offer('+ quest Listen | like: open-story-task-f | foe: cellar-rat-swarm | text: Hear the miller out');
    assert.equal(result.settled.template.endsWith('open-story-task-f'), true);
    assert.ok(result.notes.includes('foe was not used'), result.notes.join('|'));
    assert.ok(!offer('+ quest Listen | like: open-story-task-f | text: Hear the miller out').notes.some(note => /was not used/.test(note)));
});

// ---- a job's deadline across a rebuild and a Re-read ---------------------------------------------------------------------

test('a job accepted with a day to go expires when the clock passes it, and a rebuild, a reload and a Re-read of the offering reply agree', async t => {
    await seeded(8104, async () => {
        const h = await bluewatch(t);
        const job = () => h.q('director.thread', { key: 'Old Debts' });
        await h.say('Hollis offers.', ['+ quest Old Debts | giver: Marrit | goal: Settle the matter with the river guild | reward: 80 copper | due: in 1 day']);
        await accept(h, 'Old Debts');
        assert.equal(job().rpg.state, 'active');
        await h.say('Much later.', ['! time +3d']);
        assert.equal(job().rpg.state, 'expired', JSON.stringify(h.store.problems()));
        const live = JSON.stringify(h.head());
        const problems = JSON.stringify(h.store.problems());
        h.store.rebuild();
        assert.equal(JSON.stringify(h.head()), live);
        await h.st.loadChat(JSON.parse(JSON.stringify(h.ctx.chat)));
        assert.equal(JSON.stringify(h.head()), live);
        assert.equal(JSON.stringify(h.store.problems()), problems);
        const reread = await h.turn.reread(h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes('Hollis offers.')));
        assert.equal(reread.ok, true);
        assert.equal(job().rpg.state, 'expired');
        assert.equal(JSON.stringify(h.store.problems()), problems);
    });
});

// ---- a count in front of a named kind ----------------------------------------------------------------------------------------

test('a count in front of a named kind ("3 Rats Of Doom | like: …") is read only where Jobs from the story shows its block: not in strict mode, not in a pin without open quest templates', async t => {
    const foes = async options => {
        const h = await bluewatch(t, options);
        await h.say('Rats.', ['! encounter 3 Rats Of Doom | like: cellar-rat-swarm']);
        return h.q('combat.offers').at(-1).foes.map(foe => [foe.name, foe.count]);
    };
    await seeded(8105, async () => {
        assert.deepEqual(await foes({}), [['Rats Of Doom', 3]]);
        assert.deepEqual(await foes({ settings: { features: { 'rpg-battle.generative-offers': false } } }), [['3 Rats Of Doom', 1]], 'strict mode: RPG Battle 2.2.0\'s reading');
        const bare = structuredClone(PACK);
        bare.content.quests = bare.content.quests.filter(quest => !quest.open);
        assert.deepEqual(await foes({ pack: JSON.stringify(bare) }), [['3 Rats Of Doom', 1]], 'a pin without open quest templates: 2.2.0\'s reading');
    });
});

// ---- a teacher's fee in the chat's coins ----------------------------------------------------------------------------------

test('a fee is written in the chat\'s coins as a reward is: in the told line, the rolled-fee note and the Progress page; and so in strict mode', async t => {
    await seeded(8106, async () => {
        const h = await bluewatch(t);
        await h.say('Reka.', ['+ trainer Old Reka — blade drills | fee: 6 silver 4 copper', '+ trainer Sergeant Holm — spear and shield drills']);
        await h.say('Quiet.');
        const told = lastTail(h).split('\n').filter(line => /will teach/.test(line));
        assert.equal(told.length, 2);
        assert.match(told[0], / for 6 silver 4 copper a session\. \(fee as agreed\)$/);
        const holm = Object.values(h.head().domains.training.offers).find(offer => offer.name === 'Sergeant Holm');
        const rolled = money(holm.fee, h.q('inventory.currency'));
        assert.match(rolled, /silver/, 'the roll is over ten copper, so it is in silver and copper');
        assert.match(told[1], new RegExp(` for ${rolled} a session\\.$`));
        assert.doesNotMatch(told[1], /\d{2,} copper/);
        assert.deepEqual([holm.settled.shown.fee, holm.settled.notes], [rolled, [`fee ${rolled} (rolled)`]]);
        const member = h.q('rpg-battle.progressView', {}).members[0];
        assert.deepEqual(member.training.stories.map(story => /fee ([^·]*) ·/.exec(story.text)?.[1].trim()).sort(), [rolled, '6 silver 4 copper'].sort());
        assert.ok(member.training.offers.every(offer => /^fee \d+ (?:gold|silver|copper)(?: \d+ (?:silver|copper))?, /.test(offer.detail)), member.training.offers.map(offer => offer.detail).join('|'));
    });
    await seeded(8107, async () => {
        // The page is not gated on the feature: strict mode shows the same coins.
        const h = await bluewatch(t, { settings: { features: { 'rpg-battle.generative-offers': false } } });
        const member = h.q('rpg-battle.progressView', {}).members[0];
        assert.ok(member.training.offers.length > 0 && member.training.offers.every(offer => /^fee \d+ (?:gold|silver|copper)/.test(offer.detail)), member.training.offers.map(offer => offer.detail).join('|'));
    });
});

// ---- the names of what a quest asks for ----------------------------------------------------------------------------------

test('rules.names names the foes, items and places of a quest, and a named kind of foe by the job that made it', async t => {
    await seeded(8108, async () => {
        const h = await bluewatch(t);
        await h.say('Hollis speaks.', [G1]);
        const [record] = Object.values(offersOf(h.head().domains.rules));
        const refs = [record.settled.foe.ref, record.settled.foe.base, `${P}/cellar-rat-swarm`, `${P}/bluewatch-village`, `${P}/rat-tail`, 'pack.nothing/here'];
        const names = h.q('rules.names', { refs });
        assert.equal(names[record.settled.foe.ref], 'Culvert Rats');
        assert.equal(names[`${P}/cellar-rat-swarm`], 'Cellar Rat Swarm');
        assert.equal(names[`${P}/bluewatch-village`], 'Bluewatch Village');
        assert.equal(names[`${P}/rat-tail`], 'Rat Tail');
        assert.equal(Object.hasOwn(names, 'pack.nothing/here'), false);
    });
});
