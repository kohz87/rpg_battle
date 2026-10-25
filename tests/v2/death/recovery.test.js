import test from 'node:test';
import assert from 'node:assert/strict';
import { world, ok, ref } from './helpers.js';
import { seeded } from '../integration/helpers/host.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';
import { replayGuard } from '../../../src/v2/death/guard.js';
import { hashJson } from '../../../src/v2/rules/hash.js';

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
