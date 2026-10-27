// Records tests/v2/quests/fixtures/old-encounters-<label>.json: chats that hold encounter lines with a count in front of a named kind ("3 Rats Of Doom | like: …"), played with the code
// of an earlier RPG Battle (a worktree of that commit, with this folder's tests and vendored runtime copied over it) so a Re-read can be checked against how those lines were first read.
//
//   node tests/v2/quests/fixtures/record-old-encounters.mjs <label> [strict|bare] > tests/v2/quests/fixtures/old-encounters-<label>.json
//
// `label`: ce3dbec (before routes were kept) or 2.2.0 (before Jobs from the story). `strict`: the switch off; `bare`: a pack with no open quest template. Do not run it again on newer code
// to "fix" a failing test: the files are the evidence of how those chats were recorded.
import { seeded } from '../../integration/helpers/host.js';
import { bluewatch, ok, PACK } from '../helpers/bluewatch.js';

const [, , label = 'ce3dbec', mode = 'free'] = process.argv;
const settings = mode === 'strict' ? { features: { 'rpg-battle.generative-offers': false } } : undefined;
const pack = (() => {
    if (mode !== 'bare') return undefined;
    const bare = structuredClone(PACK);
    bare.content.quests = bare.content.quests.filter(quest => !quest.open);
    return JSON.stringify(bare);
})();

const out = await seeded(4242, async () => {
    const h = await bluewatch({ after() {} }, { ...(settings ? { settings } : {}), ...(pack ? { pack } : {}) });
    await h.say('Rats, left on offer.', ['! encounter 3 Rats Of Doom | like: cellar-rat-swarm']);
    await h.say('Plague rats, fought.', ['! encounter 2 Plague Rats | like: cellar-rat-swarm | tier: trivial']);
    ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
    for (let n = 0; n < 200; n += 1) {
        const s = h.q('combat.session');
        if (!s || s.status !== 'active') break;
        ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: s.id, board: s.board }));
    }
    ok(await h.sdk.command('combat.end', { session: h.q('combat.session').id }));
    await h.say('Quiet.');
    // A named kind of an open template, a free-form offer (2.2.0 and strict mode refuse it) and a teacher.
    await h.say('Rats in the cellar.', ['+ quest Rat Trouble | like: open-hunt-f | text: Cull the rats | foe: cellar-rat-swarm']);
    await h.say('The river guild is owed.', ['+ quest Old Debts | giver: Marrit | goal: Settle the matter with the river guild | reward: 80 copper | due: in 3 days']);
    await h.say('Reka offers drills.', ['+ present Old Reka', '+ trainer Old Reka | like: open-blade-drills']);
    const result = {
        recordedWith: { rpgBattle: label, mode },
        chat: JSON.parse(JSON.stringify(h.ctx.chat)),
        extensionSettings: JSON.parse(JSON.stringify(h.ctx.extensionSettings)),
        combat: JSON.parse(JSON.stringify(h.head().domains.combat)),
        routes: Object.keys(h.head().domains.rules).filter(key => key.startsWith('route.')),
        offers: h.q('combat.offers').map(offer => offer.foes.map(foe => [foe.name, foe.count])),
        director: JSON.parse(JSON.stringify(h.head().domains.director)),
        training: JSON.parse(JSON.stringify(h.head().domains.training)),
        offerKeys: Object.keys(h.head().domains.rules).filter(key => key.startsWith('offer.')),
        problems: h.store.problems(),
    };
    h.close();
    return result;
});
process.stdout.write(`${JSON.stringify(out)}\n`);
