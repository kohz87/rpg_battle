// Real Ersveil 1.5.0 fixture copied from Story Block cc0b793. No sibling checkout is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { SD, AREA_TIERS } from '../progress/helpers/world.js';
import { partyCombatants, fightNumbers } from '../../../src/v2/combat/setup.js';
import { fightRules, sessionStatus, unpackSetup } from '../../../src/v2/combat/stored.js';
import { autoOutcome } from '../../../src/v2/fight/danger.js';
import { pinnedSetup } from '../../../src/v2/fight/index.js';
import { seeded } from '../integration/helpers/host.js';

const PACK = JSON.parse(readFileSync(new URL('./fixtures/ersveil-bluewatch.pack.json', import.meta.url)));
const PLACE = 'pack.ersveil-bluewatch/bluewatch-village';
const ok = result => { assert.equal(result.ok, true, `${result.code}: ${result.message}`); return result; };
const allFoes = setup => [...setup.enemies, ...(setup.waves ?? []).flatMap(wave => wave.enemies)];
const SEEDS = 300;

async function world(t, klass = 'militiaman') {
    const h = await createHost({ modules: [{ ...SD, version: '2.0.0' }] });
    t.after(() => h.close());
    ok(await h.packs.packs.install(structuredClone(PACK)));
    const preflight = () => h.sdk.preflight({ module: 'rpg-battle', rulesVersion: 2, peers: ['story-director'] });
    await h.sdk.registerModule(createModule({ settings: () => h.sdk.settings('rpg-battle'), query: (name, args) => h.sdk.query(name, args), preflight: preflight(), readPreflight: preflight }));
    h.q = (name, args = {}) => h.sdk.query(name, args);
    const { name, ...choice } = h.q('rules.selection').offers[0];
    ok(await h.sdk.command('rules.pin', choice));
    const human = h.q('packs.content', { kind: 'races' }).find(race => /human/i.test(race.id));
    ok(await h.sdk.command('creation.finish', { name: 'Ren', race: human.id, talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: `pack.ersveil-bluewatch/${klass}`, checkActor: null }));
    AREA_TIERS[PLACE] = 0;
    t.after(() => { delete AREA_TIERS[PLACE]; });
    await h.send('Here.', `Here.\n\n<Changes>\n~ time 3000\n~ here ${PLACE}\n</Changes>`);
    h.ctxForFight = { query: h.q, read: domain => h.head().domains[domain] };
    return h;
}

async function offer(h, tier = 'weak', extra = '') {
    await h.send('They attack.', `They attack.\n\n<Changes>\n! encounter 6 Cellar Rat Swarm | tier: ${tier}${extra}\n</Changes>`);
    const result = h.q('combat.offers').at(-1);
    assert.ok(result, JSON.stringify(h.store.problems()));
    return result;
}

function setupOf(h, offered) {
    const party = partyCombatants(h.ctxForFight, { rules: fightRules(fightNumbers({})) });
    return { ...unpackSetup(offered.opposition), id: 'fi_00000001', party };
}

const classes = PACK.content.rules[0].classes.filter(klass => klass.tier === 0);
for (const klass of classes) {
    test(`pinned danger: ${klass.name}, level 1, six real Ersveil rats, ${SEEDS} independent seeds per label`, async t => {
        const h = await world(t, klass.slug);
        const rates = {};
        for (const [label, lo, hi] of [['weak', 85, 100], ['normal', 50, 75], ['strong', 20, 50]]) {
            const offered = await offer(h, label);
            assert.ok(offered.opposition, JSON.stringify(h.store.problems()));
            const setup = setupOf(h, offered);
            assert.equal(allFoes(setup).length, 6);
            assert.ok(allFoes(setup).every(enemy => enemy.pack === 'pack.ersveil-bluewatch/cellar-rat-swarm'));
            let wins = 0;
            for (let seed = 1000; seed < 1000 + SEEDS; seed += 1) if (autoOutcome(setup, seed) === 'victory') wins += 1;
            rates[label] = wins / SEEDS * 100;
            assert.ok(rates[label] >= lo && rates[label] <= hi, `${klass.name} ${label}: ${rates[label].toFixed(1)}%, wanted ${lo}–${hi}%`);
        }
        t.diagnostic(`${klass.name} | ${Object.values(rates).map(rate => rate.toFixed(1) + '%').join(' | ')}`);
    });
}

test('offer owns the pack identity and stats through reinstall, rebuild, reload and start; old offers retain their recorded data', async t => seeded(7, async () => {
    const h = await world(t);
    const offered = await offer(h);
    const bytes = JSON.stringify(offered);
    const foes = allFoes(unpackSetup(offered.opposition));
    const changed = structuredClone(PACK);
    changed.content.creatures.find(foe => foe.name === 'Cellar Rat Swarm').name = 'Reinstalled Rat';
    ok(await h.packs.packs.install(changed));
    h.store.rebuild();
    assert.equal(JSON.stringify(h.q('combat.offers').at(-1)), bytes);
    await h.st.loadChat(structuredClone(h.ctx.chat));
    assert.equal(JSON.stringify(h.q('combat.offers').at(-1)), bytes);
    // Changing the live area's rules and party after capture cannot change the offer's foes.
    AREA_TIERS[PLACE] = 9;
    await h.send('I am hurt.', 'Hurt.\n\n<Changes>\n~ wound Ren | harm: wound\n</Changes>');
    assert.ok(h.q('party.pc').hp.cur < h.q('party.pc').hp.max);
    ok(await h.sdk.command('combat.start', { offer: offered.id }));
    const session = Object.values(h.head().domains.combat.fights).at(-1);
    assert.deepEqual(allFoes(unpackSetup(session.setup)), foes);
    const live = JSON.stringify(session);
    h.store.rebuild();
    assert.equal(JSON.stringify(Object.values(h.head().domains.combat.fights).at(-1)), live);
    ok(await h.sdk.command('combat.act', { action: { type: 'auto' } }));
    const played = Object.values(h.head().domains.combat.fights).at(-1);
    assert.equal(played.status, sessionStatus(autoOutcome(unpackSetup(session.setup), session.setup.seed, played.actions[0].id)), 'the simulator is the live command engine');
    const old = { ...offered };
    delete old.opposition;
    const before = JSON.stringify(old);
    const built = pinnedSetup(h.ctxForFight, { ...setupOf(h, offered), enemies: foes, waves: [] }, old);
    assert.equal(JSON.stringify(old), before, 'an existing offer is never rewritten or calibrated');
    assert.equal(built.enemies[0].hp.max, 74, 'the historical pack adapter still supplies its recorded 74 HP');
    assert.deepEqual(built.enemies[0].skills, foes[0].skills);
    assert.deepEqual(built.enemies[0].loot, foes[0].loot);
    assert.deepEqual(built.enemies[0].stats, foes[0].stats, 'the seven budgeted stats are unchanged');
    assert.deepEqual(h.store.problems(), []);
}));

test('death stakes and explicit ranks have no new scaling record', async t => {
    const h = await world(t);
    assert.equal((await offer(h, 'weak', ' | stakes: death')).opposition, undefined);
    assert.equal((await offer(h, 'weak', ' | rank: F')).opposition, undefined);
});

test('like variants keep their frozen base, variant name, skills and loot in the scaled offer', async t => {
    const h = await world(t);
    await h.send('An ash rat.', 'It comes.\n\n<Changes>\n! encounter Ash Rat | like: cellar-rat-swarm | tier: weak\n</Changes>');
    const offered = h.q('combat.offers').at(-1);
    assert.ok(offered?.opposition);
    const [foe] = allFoes(unpackSetup(offered.opposition));
    assert.equal(foe.name, 'Ash Rat');
    assert.equal(foe.pack, 'pack.ersveil-bluewatch/cellar-rat-swarm~ash-rat');
    assert.equal(foe.skills.length, 1);
    assert.equal(foe.loot[0].def, 'pack.ersveil-bluewatch/rat-tail');
});
