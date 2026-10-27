// Records tests/v2/quests/fixtures/old-fights-2.2.0.json: a chat played with RPG Battle 2.2.0 (a worktree of that commit, with this folder's tests and vendored runtime copied
// over it) that holds an offered fight left on offer and a fight begun and left under way after up to two Auto actions: both before Auto played each unmastered form once (`autoRule`).
//
//   node tests/v2/quests/fixtures/record-old-fights.mjs > tests/v2/quests/fixtures/old-fights-2.2.0.json
//
// Do not run it again on newer code to "fix" a failing test: the file is the evidence of how those fights were recorded.
import { seeded } from '../../integration/helpers/host.js';
import { bluewatch, ok } from '../helpers/bluewatch.js';

const out = await seeded(4343, async () => {
    const h = await bluewatch({ after() {} });
    await h.say('Rats, left on offer.', ['! encounter 3 Cellar Rat Swarm | tier: weak']);
    await h.say('Rats, fought.', ['! encounter 4 Cellar Rat Swarm | tier: even']);
    ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
    for (let n = 0; n < 2 && h.q('combat.session')?.status === 'active'; n += 1) {
        const s = h.q('combat.session');
        ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: s.id, board: s.board }));
    }
    const result = {
        recordedWith: { rpgBattle: '2.2.0' },
        chat: JSON.parse(JSON.stringify(h.ctx.chat)),
        extensionSettings: JSON.parse(JSON.stringify(h.ctx.extensionSettings)),
        combat: JSON.parse(JSON.stringify(h.head().domains.combat)),
        problems: h.store.problems(),
    };
    h.close();
    return result;
});
process.stdout.write(`${JSON.stringify(out)}\n`);
