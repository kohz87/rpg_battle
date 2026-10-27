// Real Ersveil 1.5.0 fixture copied from Story Block cc0b793. No sibling checkout is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AREA_TIERS } from '../progress/helpers/world.js';
import { fightRules, sessionStatus, unpackSetup } from '../../../src/v2/combat/stored.js';
import { hashSeed } from '../../../src/rng.js';
import { leanAuto } from '../../../src/v2/fight/lean.js';
import { autoOutcome } from '../../../src/v2/fight/danger.js';
import { pinnedSetup } from '../../../src/v2/fight/index.js';
import { seeded } from '../integration/helpers/host.js';

import { PACK, PLACE, ok, allFoes, SEEDS, world, offer, setupOf } from './helpers/danger.js';

const BASELINE = JSON.parse(readFileSync(new URL('./fixtures/pinned-danger-rates.json', import.meta.url)));

const classes = PACK.content.rules[0].classes.filter(klass => klass.tier === 0);
for (const klass of classes) {
    test(`pinned danger: ${klass.name}, level 1, six real Ersveil rats, ${SEEDS} independent seeds per label`, async t => seeded(7, async () => {
        const h = await world(t, klass.slug);
        const rates = {};
        for (const [label, lo, hi] of [['weak', 85, 100], ['normal', 50, 75], ['strong', 20, 50]]) {
            const offered = await offer(h, label);
            assert.ok(offered.opposition, JSON.stringify(h.store.problems()));
            const setup = setupOf(h, offered);
            assert.equal(allFoes(setup).length, 6);
            // The calibration's own player takes a shipped encounter, and plays its private samples as the engine does.
            const play = leanAuto(setup, fightRules(setup));
            assert.ok(play, `${klass.name} ${label}: the lean player takes the offer`);
            for (let n = 0; n < 48; n += 1) {
                const seed = `pinned-danger:sample:${n}`;
                // A sample the lean player leaves to the engine (-1: a form it does not model, such as a stat buff Auto plays once as practice) is the engine's.
                const quick = play(hashSeed(seed), hashSeed(`${seed}|ca_00000001`));
                if (quick >= 0) assert.equal(quick, autoOutcome(setup, seed) === 'victory' ? 1 : 0, `${klass.name} ${label}: sample ${n}`);
            }
            assert.ok(allFoes(setup).every(enemy => enemy.pack === 'pack.ersveil-bluewatch/cellar-rat-swarm'));
            let wins = 0;
            for (let seed = 1000; seed < 1000 + SEEDS; seed += 1) if (autoOutcome(setup, seed) === 'victory') wins += 1;
            rates[label] = wins / SEEDS * 100;
            const before = BASELINE.wins[klass.slug][label];
            assert.ok(Math.abs(wins - before) <= SEEDS * 0.03, `${klass.name} ${label}: ${wins}/${SEEDS}, baseline ${before}/${SEEDS}; must stay within three points`);
            assert.ok(rates[label] >= lo && rates[label] <= hi, `${klass.name} ${label}: ${rates[label].toFixed(1)}%, wanted ${lo}–${hi}%`);
        }
        t.diagnostic(`${klass.name} | ${Object.values(rates).map(rate => rate.toFixed(1) + '%').join(' | ')}`);
    }));
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

test('the same offer on two cold captures records identical opposition, including after reload', async () => {
    const captures = [];
    for (let run = 0; run < 2; run++) await seeded(7, async () => {
        const cleanup = [];
        try {
            const h = await world({ after: fn => cleanup.push(fn) });
            const offered = await offer(h, 'normal');
            const bytes = JSON.stringify(offered.opposition);
            h.store.rebuild();
            assert.equal(JSON.stringify(h.q('combat.offers').at(-1).opposition), bytes);
            await h.st.loadChat(structuredClone(h.ctx.chat));
            assert.equal(JSON.stringify(h.q('combat.offers').at(-1).opposition), bytes);
            captures.push(bytes);
        } finally { for (const fn of cleanup.reverse()) await fn(); }
    });
    assert.equal(captures[0], captures[1]);
});
