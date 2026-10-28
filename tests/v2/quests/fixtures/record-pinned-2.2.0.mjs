// Records tests/v2/quests/fixtures/pinned-2.2.0.json: a chat pinned to Ersveil: Bluewatch Starter 1.6.0 (open quest and trainer
// templates), played with RPG Battle 2.2.0 (the code before any generative-offers change) on Story Block 2.5.0 and Story Director
// 2.1.0, saved with the state it ended in, the static prompt and tail it was built under and what the quest and training
// queries answered. It holds an open-template quest offer (`like:`), a free-form offer 2.2.0 refuses, an open trainer, a fight and
// a turn-in. It was recorded BEFORE any 2.3.0 change; do not run it again to "fix" a failing replay test (the file is the evidence
// that a chat that already exists opens unchanged):
//
//   node tests/v2/quests/fixtures/record-pinned-2.2.0.mjs > tests/v2/quests/fixtures/pinned-2.2.0.json
//
import { seeded } from '../../integration/helpers/host.js';
import { staticParts } from '../../../vendor/story-block/src/v2/prompt.js';
import { readFileSync } from 'node:fs';
import { bluewatch, ok } from '../helpers/bluewatch.js';

const read = file => readFileSync(new URL(`../../../vendor/story-block/${file}`, import.meta.url), 'utf8');
const SEED = Number(process.env.SEED ?? 2202);
const GRANARY = '+ quest Granary Vermin | giver: Hollis | type: cull | goal: Kill 6 culvert rats in the south levee granary and collect tails | reward: 12 crowns | difficulty: easy';

const out = await seeded(SEED, async () => {
    const h = await bluewatch({ after() {} });
    // An open quest offered the 2.2.0 way, and a free-form one 2.2.0 refuses (a Problem on the reply, no thread).
    await h.say('The guild clerk has work.', ['+ quest Rats | like: open-hunt-f | text: Cull the rats under the granary | foe: cellar-rat-swarm']);
    await h.say('Hollis wants more.', [GRANARY]);
    // A teacher: an open trainer at the village.
    await h.say('Old Reka drills the militia.', ['+ present Old Reka', '+ trainer Old Reka — blade drills | like: open-blade-drills']);
    // Accepted by the reader's words, fought and turned in.
    await h.send('I accept the Rats job.', 'The clerk nods.\n\n<Changes>\n+ quest Rats\n</Changes>');
    await h.say('Rats swarm the cellar.', ['! encounter 1 Cellar Rat Swarm | tier: trivial']);
    ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
    for (let n = 0; n < 200; n += 1) {
        const s = h.q('combat.session');
        if (!s || s.status !== 'active') break;
        ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: s.id, board: s.board }));
    }
    ok(await h.sdk.command('combat.end', { session: h.q('combat.session').id }));
    await h.say('The cellar is quiet.');
    await h.say('Back at the guild.', ['- quest Rats — done']);
    await h.say('Quiet evening.');
    const thread = h.q('director.thread', { key: 'Rats' });
    const result = {
        recordedWith: { rpgBattle: '2.2.0', storyBlock: read('VERSION').split('\n').slice(0, 2).join(' '), storyDirector: readFileSync(new URL('../../../vendor/story-director/VERSION', import.meta.url), 'utf8').split('\n').slice(0, 2).join(' ') },
        seed: SEED,
        pc: h.q('party.pc').id,
        chat: JSON.parse(JSON.stringify(h.ctx.chat)),
        extensionSettings: JSON.parse(JSON.stringify(h.ctx.extensionSettings)),
        head: JSON.parse(JSON.stringify(h.head())),
        prompt: staticParts(h.registry),
        tails: h.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).map(entry => entry.value).slice(-2),
        problems: h.store.problems(),
        quest: { state: thread.rpg.state, settlement: thread.rpg.settlement },
        openTemplates: h.q('quest.openTemplates', {}),
        board: h.q('quest.board', {}),
        training: h.q('rules.training', { actor: h.q('party.pc').id }),
        wallet: h.q('inventory.wallet', { owner: 'party' }),
        xp: h.q('party.pc').xp,
    };
    h.close();
    return result;
});
process.stdout.write(`${JSON.stringify(out)}\n`);
