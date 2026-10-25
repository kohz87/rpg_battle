import test from 'node:test';
import assert from 'node:assert/strict';
import { world, ok, ref } from './helpers.js';
import { seeded } from '../integration/helpers/host.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';
import { replayGuard } from '../../../src/v2/death/guard.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { assertFullReplay } from './replay-helper.js';

async function finish(w, type = 'attack') {
    for (let i = 0; i < 200 && w.q('combat.session').status === 'active'; i++) {
        const v = w.q('combat.session');
        ok(w.command('combat.act', { session: v.id, board: v.board, action: { type, ...(type === 'attack' ? { target: v.actions.targets.enemies[0] } : {}) } }, 'ui'));
    }
    return ok(w.command('combat.end', { session: w.q('combat.session').id }, 'ui'));
}

async function injure(w) {
    const e = w.lethal(w.friend);
    ok(w.command('skill.use', { actor: w.pc, skill: ref('s00'), form: ref('s00-base') }));
    const paid = w.q('story.evidence').findLast(p => p.kind === 'use').id;
    const proof = w.proof('rescue', { event: e.event, batch: e.batch, actor: w.friend, rescuer: w.pc, skill: ref('s00'), form: ref('s00-base'), effect: 1, payment: paid }, [paid]);
    ok(w.command('test.intervene', { event: e.event, evidence: proof }));
    ok(w.command('death.resolve', { event: e.event }));
}

test('injury lasts 1440 story minutes through rest, XP rewrites and automatic recovery', async t => seeded(71, async () => {
    const w = await world(t);
    await w.say('<Changes>\n~ time 2000\n</Changes>');
    await injure(w);
    const injury = () => w.q('party.actor', { id: w.friend }).conditions.find(c => c.kind === 'injury');
    assert.equal(injury().at, 2000);
    const penalty = () => w.q('rules.modifier', { actor: w.friend, stat: 'AGI' }).parts.find(p => p.reason === 'Injury')?.amount;
    assert.equal(penalty(), -2);
    ok(w.command('party.rest', { kind: 'long' }, 'story'));
    ok(w.command('party.grantXp', { actor: w.friend, amount: 100, claim: 'injury-level' }));
    assert.equal(injury().at, 2000);
    assert.equal(injury().rounds, 144);
    await w.say('<Changes>\n~ time 2360\n</Changes>');
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'gravely-injured');
    assert.equal(penalty(), -2);
    await w.say('<Changes>\n~ time 3439\n</Changes>');
    assert.equal(penalty(), -2);
    await w.say('<Changes>\n~ time 3440\n</Changes>');
    assert.equal(injury(), undefined);
    ok(w.command('party.grantXp', { actor: w.friend, amount: 1, claim: 'after-injury' }));
    assert.equal(injury(), undefined, 'an expired injury cannot become an indefinite condition during an XP write');
    assert.equal(penalty(), undefined);
    w.host.store.rebuild();
    assert.deepEqual(w.problems(), []);
}));

test('a surviving fight revives its downed companion with injury, including death stakes', async t => seeded(43, async () => {
    const w = await world(t);
    await w.say('<Changes>\n~ time 2000\n</Changes>');
    ok(w.command('test.pool', { actor: w.friend, pool: 'hp', cur: 0 }));
    await w.say('<Changes>\n! encounter 1 Rat — cornered | tier: weak | stakes: death\n</Changes>');
    ok(w.command('combat.start', { offer: w.q('combat.offers')[0].id }, 'ui'));
    const result = await finish(w);
    assert.equal(result.receipt.data.outcome, 'won');
    assert.equal(result.receipt.data.deathBatch, undefined);
    assert.equal(w.q('party.actor', { id: w.friend }).hp.cur, 1);
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'gravely-injured');
    const saved = structuredClone(w.head().domains);
    w.host.store.rebuild();
    assert.deepEqual(w.head().domains, saved);
    assert.deepEqual(w.problems(), []);
}));

test('a fight begun before the pin keeps legacy permanent death settlement', async t => seeded(91, async () => {
    const w = await world(t, { pin: false });
    for (const actor of [w.pc, w.friend]) ok(w.command('test.pool', { actor, pool: 'hp', cur: 1 }));
    await w.say('<Changes>\n! encounter 3 Ogre — closing in | tier: deadly | stakes: death\n</Changes>');
    ok(w.command('combat.start', { offer: w.q('combat.offers')[0].id }, 'ui'));
    ok(w.command('test.pin'));
    const out = await finish(w, 'defend');
    assert.equal(out.receipt.data.deathBatch, undefined);
    assert.equal(out.receipt.data.batch, undefined);
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'dead');
    assert.equal(w.q('party.actor', { id: w.friend }), null);
}));

test('the end guard retracts a wipe/outbox when a native fighter link changes', async t => seeded(91, async () => {
    const w = await world(t);
    for (const actor of [w.pc, w.friend]) ok(w.command('test.pool', { actor, pool: 'hp', cur: 1 }));
    await w.say('<Changes>\n! encounter 3 Ogre — closing in | tier: deadly | stakes: normal\n</Changes>');
    ok(w.command('combat.start', { offer: w.q('combat.offers')[0].id }, 'ui'));
    for (let i = 0; i < 200 && w.q('combat.session').status === 'active'; i++) {
        const v = w.q('combat.session');
        ok(w.command('combat.act', { session: v.id, board: v.board, action: { type: 'defend' } }, 'ui'));
    }
    const before = structuredClone(w.head());
    const members = Object.fromEntries(w.q('party.actors').map(m => [m.id, m]));
    ok(w.command('combat.end', { session: w.q('combat.session').id }, 'ui'));
    const spans = w.host.ctx.chat.flatMap(m => m.extra?.storySuite?.spans ?? []);
    const span = spans.findLast(s => s.guard?.predicate?.kind === 'death.fight-end');
    assert.ok(span, 'the root must bind the death owner inputs');
    const view = state => ({ state, hash: hashJson, query: (name, args) => name === 'party.actor' ? { ...members[args.id], npcId: state.domains.party.actors[args.id].npcId } : w.q(name, args) });
    const info = { guard: span.guard, source: span.source, recorded: span.recorded };
    assert.equal(replayGuard(view(before), info).ok, true);
    before.domains.party.actors[w.pc].npcId = 'np_00000002';
    assert.equal(replayGuard(view(before), info).ok, false);
}));

test('F3: an injury recorded with no clock is anchored by the first reply that ends with one, and then ends, also after reload and rebuild', async t => seeded(71, async () => {
    const w = await world(t);
    assert.equal(w.q('director.time').minutes, null, 'no clock yet');
    await injure(w);
    const injury = () => w.q('party.actor', { id: w.friend }).conditions.find(c => c.kind === 'injury');
    const penalty = () => w.q('rules.modifier', { actor: w.friend, stat: 'AGI' }).parts.find(p => p.reason === 'Injury')?.amount;
    // A fold counts rounds down and moves `at` on with them, so the end (at + 10 minutes a round) is what stays put.
    const ends = () => injury().at + injury().rounds * 10;
    assert.equal(injury().at, undefined, 'nothing to anchor it on yet');
    assert.equal(penalty(), -2);
    await w.say('<Changes>\n~ time 5000\n</Changes>');
    assert.equal(injury().at, 5000, 'anchored by the step after the reply that set the clock');
    await w.say('The next reply leaves it where it is.');
    assert.equal(injury().rounds, 144);
    await w.say('<Changes>\n~ time 6439\n</Changes>');
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'gravely-injured');
    assert.equal(penalty(), -2);
    ok(w.command('party.rest', { kind: 'long' }, 'story'));
    assert.equal(ends(), 6440, 'a rest keeps the anchor');
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'gravely-injured');
    // After a reload and a full rebuild the same anchor gives the same answers.
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    assert.equal(ends(), 6440);
    assertFullReplay(w);
    assert.equal(ends(), 6440);
    await w.say('<Changes>\n~ time 6440\n</Changes>');
    assert.equal(injury(), undefined, 'it ends after its 1440 minutes');
    assert.equal(penalty(), undefined);
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'alive');
    ok(w.command('party.rest', { kind: 'long' }, 'story'));
    assert.equal(injury(), undefined, 'a rest does not bring it back');
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    assertFullReplay(w);
    assert.equal(injury(), undefined);
    assert.deepEqual(w.problems(), []);
}));

test('F3: an XP rewrite or a rest never invents or moves the anchor', async t => seeded(72, async () => {
    const w = await world(t);
    await injure(w);
    const injury = () => w.q('party.actor', { id: w.friend }).conditions.find(c => c.kind === 'injury');
    ok(w.command('party.grantXp', { actor: w.friend, amount: 10, claim: 'no-clock' }));
    const before = structuredClone(w.head());
    assert.equal(w.command('party.rest', { kind: 'long' }, 'story').code, 'CLOCK_UNSET');
    assert.deepEqual(w.head(), before);
    assert.equal(injury().at, undefined, 'no clock, so nothing to anchor on, and a rewrite does not make one up');
    await w.say('<Changes>\n~ time 3000\n</Changes>');
    ok(w.command('party.rest', { kind: 'long' }, 'story'));
    assert.equal(injury().at, 3000);
    assert.equal(injury().rounds, 144);
    await w.say('<Changes>\n~ time 3100\n</Changes>');
    ok(w.command('party.grantXp', { actor: w.friend, amount: 10, claim: 'later' }));
    assert.equal(injury().at + injury().rounds * 10, 3000 + 1440, 'a clock read later never moves the anchor');
    assert.deepEqual(w.problems(), []);
}));

test('F3a: deleting the reply of the injury retracts its anchor and penalty, live and after a rebuild', async t => seeded(71, async () => {
    const w = await world(t);
    await w.say('Lethal reply.');
    await injure(w);
    const injury = () => w.q('party.actor', { id: w.friend }).conditions.find(c => c.kind === 'injury');
    const penalty = () => w.q('rules.modifier', { actor: w.friend, stat: 'AGI' }).parts.find(p => p.reason === 'Injury')?.amount;
    await w.say('<Changes>\n~ time 5000\n</Changes>');
    await w.say('Fold reply.');
    assert.equal(injury().at, 5000);
    assert.equal(penalty(), -2);
    const spans = w.host.ctx.chat.flatMap(m => m.extra?.storySuite?.spans ?? []);
    assert.ok(spans.some(x => x.guard?.predicate?.kind === 'injury.anchor'), 'the anchor is a guarded block');
    const index = w.host.ctx.chat.findIndex(m => !m.is_user && String(m.mes ?? '').includes('Lethal reply.'));
    await w.host.st.deleteMessage(index);
    await w.host.st.deleteMessage(index - 1);
    for (const phase of ['live', 'rebuilt']) {
        if (phase === 'rebuilt') w.host.store.rebuild();
        assert.equal(injury(), undefined, `${phase}: no injury`);
        assert.equal(penalty(), undefined, `${phase}: no penalty`);
        assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'alive', phase);
        assert.deepEqual(w.problems(), [], phase);
    }
    assertFullReplay(w);
}));

test('F3a: deleting the clock reply an anchor was read from leaves the state a full replay gives, live and rebuilt', async t => seeded(73, async () => {
    const w = await world(t);
    await injure(w);
    const injury = () => w.q('party.actor', { id: w.friend }).conditions.find(c => c.kind === 'injury');
    await w.say('First clock.\n\n<Changes>\n~ time 5000\n</Changes>');
    await w.say('Second clock.\n\n<Changes>\n~ time 5100\n</Changes>');
    await w.say('Later.');
    assert.equal(injury().at + injury().rounds * 10, 6440, 'anchored on the first clock, 5000');
    const index = w.host.ctx.chat.findIndex(m => !m.is_user && String(m.mes ?? '').includes('First clock.'));
    await w.host.st.deleteMessage(index);
    await w.host.st.deleteMessage(index - 1);
    const view = () => structuredClone({ injury: injury() ?? null, party: w.head().domains.party, claims: w.head().meta.claims });
    const live = view();
    // The anchor went with the clock it was read from; no earlier clock is invented, and nothing stale is left behind.
    assert.equal(live.injury.at, undefined, 'unanchored until a reply ends with a clock');
    w.host.store.rebuild();
    assert.deepEqual(view(), live, 'live state is the state of a full replay');
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    assert.deepEqual(view(), live, 'and after a reload');
    await w.say('<Changes>\n~ time 5200\n</Changes>');
    assert.equal(injury().at, 5200, 'the next reply that ends with a clock gives it its anchor (the end moves with it)');
    assertFullReplay(w);
    assert.deepEqual(w.problems(), []);
}));
