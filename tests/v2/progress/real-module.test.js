// The real module.js on the real host, with no stand-in moving a query: every query a guard asks on replay is one the module lists as
// replay-safe (module.js unions the parts' lists) or one the block recorded when it was planned (the place and the purse of a training
// session, the area of a fight's end, the clock read from the state). A reload and a rebuild of the chat must then keep what the
// session earned: no block turned off, no Problem stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModule } from '../../../src/v2/module.js';
import { part as partyPart } from '../../../src/v2/party/index.js';
import { part as progressPart } from '../../../src/v2/progress/index.js';
import { rulesParts } from '../../../src/v2/rules/index.js';
import { seeded } from '../integration/helpers/host.js';
import { DAY, realWorld } from './helpers/world.js';
import { fightPin, ref, trainersPin } from './helpers/fixture.js';

const HAVEN = 'pack.fixture/haven';
const START = 4 * DAY + 1410;
const snap = w => JSON.stringify({ progress: w.slice('progress'), training: w.slice('training'), combat: w.slice('combat'), claims: Object.keys(w.head().meta.claims) });

test('module.js lists the party\'s and the progress part\'s replay queries once each, and every one is a query of the module', () => {
    const def = createModule();
    const wanted = new Set([...partyPart.replayQueries, ...progressPart.replayQueries, ...rulesParts.flatMap(([, part]) => part.replayQueries ?? [])]);
    assert.deepEqual([...def.replayQueries].sort(), [...wanted].sort(), 'nothing missing, nothing extra');
    assert.equal(new Set(def.replayQueries).size, def.replayQueries.length, 'no duplicates');
    for (const name of def.replayQueries) assert.equal(typeof def.queries[name], 'function', `${name} is a query of the module`);
});

test('credits and a training session on the real module: a reload and a rebuild keep them, and nothing is turned off', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    await w.say('Haven at dusk.', [`~ time ${START}`, `~ here ${HAVEN}`, `! skill-use ${w.pc} | skill: ${ref('s00')} | form: ${ref('s00-base')}`]);
    assert.equal(w.host.bus.command('test.coin', { amount: 100 }, { cause: 'ui' }).ok, true);
    await w.say('Settled.', [`~ time ${START + 10}`]);
    const item = w.q('rules.training', { actor: w.pc }).offers.find(entry => entry.trainer === ref('mentor') && entry.skill === ref('s00'));
    assert.equal(w.ui('skill.train', item.payload).ok, true);
    await w.say('The lesson.', [`~ here ${HAVEN}`]);
    const session = w.q('rules.training', { actor: w.pc }).session;
    assert.equal(session.status, 'completed');
    assert.ok(session.creditsAwarded > 0);
    assert.ok(w.progress().checklist[0].mastery >= 1, 'the lesson counts');
    assert.deepEqual(w.problems(), []);
    const before = snap(w);
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    assert.equal(snap(w), before, 'after the reload');
    w.host.store.rebuild();
    assert.equal(snap(w), before, 'after the rebuild');
    assert.deepEqual(w.problems(), []);
});

test('a fight\'s end with its loot and XP on the real module: a reload and a rebuild keep them, and nothing is turned off', async t => {
    await seeded(7, async () => {
        const w = await realWorld(t, { given: fightPin(), sd: true });
        await w.say('The wolves come.', ['~ time 3000', '! encounter 2 Wolf — hungry | tier: weak']);
        assert.equal(w.ui('combat.start', { offer: w.q('combat.offers', {})[0].id }).ok, true);
        for (let n = 0; n < 60; n += 1) {
            const v = w.q('combat.session', {});
            if (v.status !== 'active') break;
            assert.equal(w.ui('combat.act', { action: { type: 'attack', target: v.actions.targets.enemies[0] }, session: v.id, board: v.board }).ok, true);
        }
        const v = w.q('combat.session', {});
        const out = w.ui('combat.end', { session: v.id });
        assert.equal(out.ok, true, out.message);
        assert.ok(out.receipt.data.xp[w.pc] > 0);
        assert.deepEqual(w.problems(), []);
        const before = snap(w);
        await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
        assert.equal(snap(w), before, 'after the reload');
        w.host.store.rebuild();
        assert.equal(snap(w), before, 'after the rebuild');
        assert.deepEqual(w.problems(), []);
    });
});
