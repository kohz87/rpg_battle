// Records tests/v2/training/fixtures/pinned-2.1.0.json: a chat pinned to the trainers pack (fixed trainers, no templates),
// played with RPG Battle 2.1.0 on Story Block 2.3.0, saved with the state it ended in, the static prompt it was built under and
// what the Progress screen's query answered. It was recorded BEFORE any open-trainer change; do not run it again to "fix" a
// failing replay test (the file is the evidence that an older chat opens unchanged):
//
//   node tests/v2/training/fixtures/record-pinned-2.1.0.mjs > tests/v2/training/fixtures/pinned-2.1.0.json
//
import { seeded } from '../../integration/helpers/host.js';
import { staticParts } from '../../../vendor/story-block/src/v2/prompt.js';
import { readFileSync } from 'node:fs';
import { DAY } from '../../progress/helpers/world.js';
import { trainerPack } from '../../progress/helpers/fixture.js';
import { ok, openWorld } from '../helpers/pinned.js';

const HAVEN = 'pack.fixture/haven';
const START = 4 * DAY + 1410;
const read = file => readFileSync(new URL(`../../../vendor/story-block/${file}`, import.meta.url), 'utf8');

const out = await seeded(2101, async () => {
    const h = await openWorld({ packs: [trainerPack()] });
    ok(await h.pin());
    ok(await h.sdk.command('creation.finish', { name: 'Astra', race: 'rpg-battle/human', talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: 'pack.fixture/c0', checkActor: null }));
    const pc = h.q('party.pc').id;
    await h.say('Haven at dusk.', [`~ time ${START}`, `~ here ${HAVEN}`, '+ coin 50']);
    const offers = () => h.q('rules.training', { actor: pc }).offers;
    const find = (trainer, skill) => offers().find(item => item.trainer === `pack.fixture/${trainer}` && item.skill === `pack.fixture/${skill}`);
    // A lesson with Old Brann: asked, then started and finished by the host in the same reply.
    ok(await h.sdk.command('skill.train', find('mentor', 's00').payload));
    await h.say('The first lesson.', [`~ here ${HAVEN}`]);
    // A request the party walks away from: refused at the host's step, no fee, no time.
    ok(await h.sdk.command('skill.train', find('mentor', 's01').payload));
    await h.say('She wanders off.', ['~ here pack.fixture/mill']);
    // Back, and a lesson with Gale, whose storm may interrupt.
    await h.say('Back at Haven.', [`~ here ${HAVEN}`]);
    ok(await h.sdk.command('skill.train', find('stormy', 's02').payload));
    await h.say('The second lesson.', [`~ here ${HAVEN}`]);
    await h.say('Quiet evening.');
    const problems = h.store.problems();
    const result = {
        recordedWith: { rpgBattle: '2.1.0', storyBlock: read('VERSION').split('\n')[0] + ' ' + read('VERSION').split('\n')[1] },
        pc,
        chat: JSON.parse(JSON.stringify(h.ctx.chat)),
        extensionSettings: JSON.parse(JSON.stringify(h.ctx.extensionSettings)),
        head: JSON.parse(JSON.stringify(h.head())),
        prompt: staticParts(h.registry),
        problems,
        training: h.q('rules.training', { actor: pc }),
        sheet: h.q('rules.sheet'),
    };
    h.close();
    return result;
});
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
