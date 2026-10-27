// A chat pinned to Ersveil: Bluewatch Starter 1.6.0 (fixtures/ersveil-bluewatch-1.6.0.pack.json, copied from Story Block's
// examples/packs at 528f239), on Story Block's real host with the real Story Director (the vendored one, or the sibling
// checkout with `sibling: true`) and RPG Battle booted as the module. PC Ren, level 3, at Bluewatch Village.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHost } from '../../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../../src/v2/module.js';
import { createModule as vendoredDirector } from '../../../vendor/story-director/src/v2/module.js';

export const PACK_TEXT = readFileSync(new URL('../fixtures/ersveil-bluewatch-1.6.0.pack.json', import.meta.url), 'utf8');
export const PACK = JSON.parse(PACK_TEXT);
export const PACK_KEY = `pack.${PACK.id}`;
const siblingPath = new URL('../../../../../Story_director/src/v2/module.js', import.meta.url);
export const sibling = existsSync(siblingPath) ? (await import(siblingPath.href)).createModule : null;
export const skipSibling = !sibling && 'Sibling Story Director checkout is absent.';
export const VILLAGE = `${PACK_KEY}/bluewatch-village`;
export const ok = result => { assert.equal(result.ok, true, `${result.code}: ${result.message}`); return result; };

/**
 * `pack`: the pack text to install (default Bluewatch 1.6.0); `sibling`: the real Story Director checkout instead of the vendored copy;
 * `level`: the PC's level (3); `tier`: the world's danger tier (0); `start: false` leaves the chat before its first reply; `settings`: the reader's
 * settings (`{ modules: { 'rpg-battle': { offerGuideRanks: 2 } }, features: { 'rpg-battle.generative-offers': false } }`).
 */
export async function bluewatch(t, { pack = PACK_TEXT, useSibling = false, st = null, tier = 0, level = 3, start = true, settings = null } = {}) {
    const director = useSibling ? sibling : vendoredDirector;
    const h = await createHost({ modules: [director()], ...(st ? { st } : {}), ...(settings ? { settings } : {}) });
    t.after(() => h.close());
    h.q = (name, args = {}) => h.sdk.query(name, args);
    h.say = (text, lines = []) => h.send('Go on.', lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
    if (st) {
        // A saved chat: the pack is in its settings already; RPG Battle resumes from the pin.
        const preflight = () => h.sdk.preflight({ module: 'rpg-battle', rulesVersion: 2, peers: ['story-director'] });
        await h.sdk.registerModule(createModule({ settings: () => h.sdk.settings('rpg-battle'), query: h.q, preflight: preflight(), readPreflight: preflight }));
        return h;
    }
    ok(await h.packs.packs.install(pack));
    const preflight = () => h.sdk.preflight({ module: 'rpg-battle', rulesVersion: 2, peers: ['story-director'] });
    await h.sdk.registerModule(createModule({ settings: () => h.sdk.settings('rpg-battle'), query: h.q, preflight: preflight(), readPreflight: preflight }));
    const { name: _name, ...choice } = h.q('rules.selection').offers[0];
    ok(await h.sdk.command('rules.pin', choice));
    const human = h.q('packs.content', { kind: 'races' }).find(race => /human/i.test(race.id));
    ok(await h.sdk.command('creation.finish', { name: 'Ren', race: human.id, talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: `${PACK_KEY}/militiaman`, checkActor: null }));
    if (start) {
        await h.say('Bluewatch Village at dawn.', ['~ place Bluewatch Village | kind: settlement']);
        // Level 3 (rank F) by story XP, one award a reply; the world is tier 0 with empty allowlists.
        for (let n = 0; n < 12 && h.q('party.pc').level < level; n += 1) await h.say(`A hard day ${n + 1}.`, ['+ xp milestone']);
        assert.equal(h.q('party.pc').level, level);
        ok(await h.sdk.command('atlas.dangerSet', { write: 'wr_area0001', scope: 'world', key: null, policy: { tier, allowedFoes: [], allowedTags: [], lore: [] }, expectedHash: h.q('atlas.policy').hash }));
    }
    return h;
}

export const G1 = '+ quest Granary Vermin | giver: Hollis | type: cull | goal: Kill 6 culvert rats in the south levee granary and collect tails | reward: 12 crowns | difficulty: easy';
export const G2 = '+ quest Scrub Pack | giver: Hollis | type: hunt | goal: Slay the alpha of the scrub wolf pack north of the ditch | reward: 30 crowns | difficulty: normal';
export const G1_TERMS = 'Posted job: Granary Vermin (from Hollis): kill 6 Culvert Rats within 7 days; pays 5 silver and 50 XP, turned in at Bluewatch Village. Fight them as ! encounter 6 Culvert Rats | like: cellar-rat-swarm. These are the terms from now on; nobody in the scene has to restate them.';

/** The reader accepts a job by name on a reply that writes `+ quest Name`. */
export const accept = (h, name) => h.send(`I accept the ${name} job.`, `Agreed.\n\n<Changes>\n+ quest ${name}\n</Changes>`);

/** The last tail the host put in the prompt (the text after the lines of `[Happened]`), or ''. */
export const lastTail = h => h.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).at(-1)?.value ?? '';

/** Plays one fight against `line`'s foes with the Auto tier to its end. */
export async function fight(h, line, text = 'They attack.') {
    await h.say(text, [`! encounter ${line}`]);
    ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
    for (let n = 0; n < 300; n += 1) {
        const session = h.q('combat.session');
        if (!session || session.status !== 'active') break;
        ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: session.id, board: session.board }));
    }
    ok(await h.sdk.command('combat.end', { session: h.q('combat.session').id }));
}

/** Fights `line` again and again until the quest's board counts `need` (foes flee now and then, so one fight is not always enough). */
export async function fightUntil(h, id, line, need, most = 10) {
    for (let n = 0; n < most && h.q('quest.progress', { id }).have < need; n += 1) await fight(h, line, `Fight ${n + 1}.`);
    await h.say('The noise dies down.');
    return h.q('quest.progress', { id });
}
