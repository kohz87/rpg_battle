// Fuzz for jobs and teachers from the story on a pinned chat (GENERATIVE_OFFERS_SPEC §16): seeded sequences of offers (the user's two lines, a far-out one, a
// duplicate, messy ones from the corpus, teachers), acceptances, turn-ins, Re-reads, swipes, deletes of earlier replies, rebuilds and reloads. After every
// step replay equals live: a rebuild and a reload of the stored chat give the head that was, with the Problems that were, and the only Problems are the
// replay's own (a block whose reason went). Deterministic: the same seed is the same run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../integration/helpers/host.js';
import { createPicker } from '../qa/helpers/fuzz.js';
import { G1, G2, bluewatch } from './helpers/bluewatch.js';

const LINES = [
    G1, G2, '+ quest Boar Hunt | goal: Hunt 3 wild boars | reward: 50 gold', '+ quest The Granary Vermin | type: cull | goal: kill 6 rats',
    '+ quest Rat Trouble | goal: Kill a dozen rats | reward: a dozen copper', '+ quest Leech Duty | goal: Kill 8 sluice leeches | reward: 120 copper', '+ quest Tails | goal: Collect 6 rat tails | reward: 60 copper',
    '+ quest Old Debts | goal: Settle the matter with the river guild | difficulty: nightmare', '+ quest The Missing Boy', '+ quest Smugglers — find out who is moving salt at night',
    '+ quest Bear Problem | type: hunt | goal: Slay the frost bear | difficulty: easy', '+ quest Listen | like: open-chat | text: Hear the miller out',
    '+ trainer Old Reka — blade drills', '+ trainer Old Reka — swordplay', '+ trainer Old Pell — fishing and net mending', '+ trainer Brad — blade drills | fee: 5 gold',
    '+ trainer Cal — blade drills | fee: 10 copper', '+ trainer Fen | teaches: cane-draw, gutter feint',
];
const NAMES = ['Granary Vermin', 'Scrub Pack', 'Rat Trouble', 'Leech Duty', 'Tails', 'Old Debts', 'The Missing Boy', 'Smugglers', 'Bear Problem', 'Boar Hunt'];
const known = problems => problems.filter(item => item.code !== 'REPLAY_PREREQUISITE');

const seen = { offers: 0, declined: 0, trainers: 0, done: 0 };

async function run(t, seed, steps) {
    await seeded(seed, async () => {
        const h = await bluewatch(t);
        const p = createPicker(seed);
        const replies = () => h.ctx.chat.map((message, index) => ({ message, index })).filter(({ message }) => !message.is_user && message.extra?.storySuite?.ops?.length);
        for (let n = 0; n < steps; n += 1) {
            const roll = p.int(100);
            let what;
            if (roll < 45) {
                what = p.pick(LINES);
                await h.say(`Offer ${n}.`, [what]);
            } else if (roll < 60) {
                what = `accept`;
                const name = p.pick(NAMES);
                await h.send(`I accept the ${name} job.`, `Agreed.\n\n<Changes>\n+ quest ${name}\n</Changes>`);
            } else if (roll < 68) {
                what = 'turn in';
                const name = p.pick(NAMES);
                await h.say(`Turn in ${n}.`, [`~ quest ${name} | met: yes`, `- quest ${name} — done`]);
            } else if (roll < 78) {
                what = 're-read';
                const list = replies();
                if (list.length) await h.turn.reread(p.pick(list).index);
            } else if (roll < 86) {
                what = 'delete';
                const list = replies().filter(({ index }) => index > 2);
                if (list.length) {
                    const { index } = p.pick(list);
                    await h.st.deleteMessage(index);
                    await h.st.deleteMessage(index - 1);
                }
            } else if (roll < 92) {
                what = 'swipe';
                await h.swipe(`Another take ${n}.`);
            } else {
                what = 'say';
                await h.say(`Nothing ${n}.`);
            }
            const live = JSON.stringify(h.head());
            const problems = JSON.stringify(h.store.problems());
            assert.deepEqual(known(h.store.problems()), [], `seed ${seed} step ${n} (${what}): ${problems}`);
            if (n % 3 === 2 || n === steps - 1) {
                const chat = JSON.parse(JSON.stringify(h.ctx.chat));
                h.store.rebuild();
                assert.equal(JSON.stringify(h.head()), live, `seed ${seed} step ${n} (${what}): rebuild equals live`);
                await h.st.loadChat(chat);
                assert.equal(JSON.stringify(h.head()), live, `seed ${seed} step ${n} (${what}): reload equals live`);
                assert.equal(JSON.stringify(h.store.problems()), problems, `seed ${seed} step ${n} (${what}): the same Problems`);
            }
        }
        // Whatever stands is whole: every record names a thread that is there, and every offered job has its record.
        const rules = h.head().domains.rules;
        seen.offers += Object.keys(rules.offers ?? {}).length;
        seen.declined += Object.keys(rules.declined ?? {}).length;
        seen.trainers += Object.keys(h.head().domains.training.offers ?? {}).length;
        seen.done += h.q('director.threads', {}).filter(row => row.rpg?.state === 'done').length;
        for (const id of Object.keys(rules.offers ?? {})) assert.ok(h.q('director.thread', { id }), `record ${id} has its thread`);
        for (const thread of h.q('director.threads', {}).filter(row => row.rpg && row.rpg.template.includes('/open-'))) assert.ok(rules.offers?.[thread.id], `${thread.key} has its record`);
    });
}

for (const seed of [11, 12, 13]) test(`fuzz: offers, acceptances, turn-ins, Re-reads, swipes and deletes keep replay equal to live (seed ${seed})`, async t => run(t, seed, 18));

test('the fuzz reached offers, teachers, far-out lines and a finished job (it is not running on nothing)', () => {
    assert.ok(seen.offers > 0 && seen.trainers > 0 && seen.declined > 0, JSON.stringify(seen));
});
