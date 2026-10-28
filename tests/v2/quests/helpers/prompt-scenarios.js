// Two chats whose prompt must not change with RPG Battle 2.3.0: one that pins no rules, and one pinned to a pack that has trainers but no open template (the
// open trainers pack without its template). Each is played the same way on RPG Battle 2.2.0 (to record fixtures/prompt-2.2.0.json, see record-prompt-2.2.0.mjs) and
// on the current code, and the static prompt and every tail the host staged are compared byte for byte (GENERATIVE_OFFERS_SPEC §16).
import { staticParts } from '../../../vendor/story-block/src/v2/prompt.js';
import { rpgHost, seeded } from '../../integration/helpers/host.js';
import { trainerPack } from '../../progress/helpers/fixture.js';
import { DAY } from '../../progress/helpers/world.js';
import { ok, openWorld } from '../../training/helpers/pinned.js';

const tailsOf = h => h.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).map(entry => entry.value);
const json = value => JSON.parse(JSON.stringify(value));

/** A chat that pins no rules: a character, a place, a coin, a quest line of the 2.2.0 forms that need no pin (it is refused), a second reply. */
export async function unpinned() {
    return seeded(9001, async () => {
        const h = await rpgHost();
        try {
            ok(await h.cmd('party.create', { name: 'Ren', preset: 'fighter' }));
            await h.send('We arrive.', h.reply('The road is long.', ['~ place Bluewatch Village | kind: settlement', '+ coin 20', '+ quest Granary Vermin | giver: Hollis | type: cull | goal: Kill 6 rats']));
            await h.send('Go on.', h.reply('Quiet.', ['+ trainer Old Reka — blade drills | like: drills']));
            await h.send('And then.', 'Rain.');
            return json({ prompt: staticParts(h.registry), tails: tailsOf(h) });
        } finally { h.close(); }
    });
}

/** A chat pinned to a pack with trainers and no open template: the same replies. */
export async function templateless() {
    return seeded(9002, async () => {
        const h = await openWorld({ packs: [trainerPack()] });
        try {
            ok(await h.pin());
            ok(await h.sdk.command('creation.finish', { name: 'Astra', race: 'rpg-battle/human', talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: 'pack.fixture/c0', checkActor: null }));
            await h.say('Haven at dusk.', [`~ time ${4 * DAY + 1410}`, '~ here pack.fixture/haven', '+ present Old Reka', '+ coin 50']);
            await h.say('Reka offers drills.', ['+ trainer Old Reka — drills | like: drills', '+ quest Granary Vermin | giver: Hollis | goal: Kill 6 rats']);
            await h.say('Quiet evening.');
            return json({ prompt: staticParts(h.registry), tails: tailsOf(h) });
        } finally { h.close(); }
    });
}
