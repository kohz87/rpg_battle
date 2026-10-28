// A hunt is counted fight by fight, one row of evidence for each, and a kill objective may ask for up to 999: its evidence is not capped at 64 rows. (A hunt of that many fights is out of
// reach of a real chat in a test, where a fight against what the quest asks for is sized up to the whole of what is left; the plan that counts a fight is the same one the host runs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceLimit, planObjective } from '../../../src/v2/quests/objectives.js';

import { foesPack, pinFor } from '../progress/helpers/fixture.js';
import { indexOf } from '../../../src/v2/rules/graph.js';
import { seal } from '../../../src/v2/fight/batch.js';

const WOLF = 'pack.fixture/wolf';
const ix = indexOf(pinFor('long-hunt', foesPack()));
const SOURCE = { sid: 'sr_00000001', swipeKey: 'sw_00000001', evidence: 'ev_00000001', ordinal: 0 };
const CURSOR = { sid: 'sr_00000001', swipeKey: 'sw_00000001', block: 'bl_00000001', op: 0, rev: 5 };
const rows = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`ev_${String(i).padStart(8, '0')}`, { objective: 'ob_00000001', proof: `pf_${String(i + 100).padStart(8, '0')}`, amount: 1 }]));

/** The facts planObjective reads for a hunt of `count` kills that already holds `held` rows of evidence (one kill each), and a won fight to count next. */
function facts(count, held) {
    const quest = { id: 'th_00000001', instance: 1, state: 'active', settlement: null, deadline: null, acceptedAt: 5, acceptedCursor: CURSOR,
        objectives: [{ id: 'ob_00000001', kind: 'kill', foe: WOLF, count }], evidence: rows(held) };
    const thread = { id: 'th_00000001', status: 'active', taken: true, acceptance: { proof: 'pf_00000001', source: SOURCE, cursor: CURSOR, minute: 5 }, rpg: quest };
    const acceptance = { id: 'pf_00000001', kind: 'acceptance', owner: 'story-director', payloadHash: 'a'.repeat(64), payload: { thread: thread.id }, source: SOURCE };
    const batch = seal({ kind: 'fight', fight: 'cf_00000009', outcome: 'victory', enemies: [{ id: 'fo_00000001', name: 'Wolf A', gone: 'down', foe: WOLF }] });
    return { hash: value => 'h'.repeat(64) + JSON.stringify(value).length, ix, thread, threads: [thread], proofs: ids => (ids.includes('pf_00000001') ? [acceptance] : []),
        combat: { beaten: { cf_00000009: { fight: 'cf_00000009', rev: 10, won: true } } }, progress: { batches: { br_00000001: batch } }, clock: null, epoch: 'ep_00000001', line: null, place: null, scene: null };
}

test('a hunt of 120 kills takes the 65th fight\'s row (and the 119th\'s), where it used to stop at 64', () => {
    for (const held of [0, 63, 64, 100, 119]) {
        const plan = planObjective(facts(120, held), { objective: 'ob_00000001', fight: 'cf_00000009' });
        assert.equal(plan.ok, true, `${held} rows: ${plan.code} ${plan.message}`);
        assert.equal(plan.amount, 1);
    }
});

test('a hunt takes no more rows than it asks kills: at its count the objective holds its limit', () => {
    assert.equal(planObjective(facts(120, 120), { objective: 'ob_00000001', fight: 'cf_00000009' }).code, 'LIMITED');
    assert.equal(planObjective(facts(10, 64), { objective: 'ob_00000001', fight: 'cf_00000009' }).code, 'LIMITED', 'a small hunt keeps the 64 of any objective');
    assert.equal(planObjective(facts(999, 998), { objective: 'ob_00000001', fight: 'cf_00000009' }).ok, true);
});

test('the row limit follows what the objective asks: a kill objective takes rows up to its count (999 at most), anything else keeps 64', () => {
    const kill = count => ({ id: 'ob_00000001', kind: 'kill', foe: 'pack.x/rat', count });
    assert.deepEqual([1, 10, 64, 65, 120, 999].map(count => evidenceLimit(kill(count))), [64, 64, 64, 65, 120, 999]);
    assert.equal(evidenceLimit({ id: 'ob_00000001', kind: 'story', text: 'Listen' }), 64);
    assert.equal(evidenceLimit({ id: 'ob_00000001', kind: 'visit', place: 'pack.x/mill' }), 64);
    assert.equal(evidenceLimit({ id: 'ob_00000001', kind: 'collect', def: 'pack.x/rope', count: 500, consume: true }), 64, 'a bag is counted, not proved');
});

// ---- on the real host ---------------------------------------------------------------------------------------------------------

import { seeded } from '../integration/helpers/host.js';
import { PACK, accept, bluewatch, ok } from './helpers/bluewatch.js';

test('a hunt of 9 kills over several fights is counted fight by fight, met, finished once, and the chat rebuilds and reloads to the same', async t => {
    await seeded(9901, async () => {
        const wide = structuredClone(PACK);
        for (const quest of wide.content.quests) if (quest.open === true && quest.objectives[0].kind === 'kill') Object.assign(quest.objectives[0], { countMin: 1, countMax: 999 });
        const h = await bluewatch(t, { pack: JSON.stringify(wide) });
        await h.say('Hollis.', ['+ quest Plague | type: cull | goal: Kill 9 cellar rats in the cellar | reward: 100 copper']);
        await accept(h, 'Plague');
        const thread = () => h.q('director.thread', { key: 'Plague' });
        let fights = 0;
        for (; fights < 12 && !h.q('quest.progress', { id: thread().id }).met; fights += 1) {
            await h.say(`Night ${fights}.`, ['! time +8h', '! rest long', '! encounter 3 Cellar Rat Swarm | tier: weak']);
            ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
            for (let n = 0; n < 120 && h.q('combat.session')?.status === 'active'; n += 1) {
                const session = h.q('combat.session');
                ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: session.id, board: session.board }));
            }
            ok(await h.sdk.command('combat.end', { session: h.q('combat.session').id }));
            await h.say('Counted.');
        }
        const progress = h.q('quest.progress', { id: thread().id });
        assert.equal(progress.met, true, JSON.stringify(progress));
        assert.ok(Object.values(thread().rpg.evidence).length >= 2, 'more than one fight counted');
        await h.say('Back at the guild.', ['- quest Plague — done']);
        assert.equal(thread().rpg.state, 'done', JSON.stringify(h.store.problems()));
        const live = JSON.stringify(h.head());
        h.store.rebuild();
        assert.equal(JSON.stringify(h.head()), live, 'rebuild equals live');
        await h.st.loadChat(JSON.parse(JSON.stringify(h.ctx.chat)));
        assert.equal(JSON.stringify(h.head()), live, 'reload equals live');
        assert.deepEqual(h.store.problems(), []);
    });
});
