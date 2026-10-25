// B6 review F1: a pinned fight's settlement binds only what it writes. Without a death or injury it keeps the plain
// combat.end guard; with one it binds who is downed (and the story minute when one is written), never hp or conditions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { world, ok } from './helpers.js';
import { wipe } from './fight-helper.js';
import { seeded } from '../integration/helpers/host.js';
import { replayGuard } from '../../../src/v2/death/guard.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';

const at = (w, text) => w.host.ctx.chat.findIndex(m => !m.is_user && String(m.mes ?? '').includes(text));
const drop = async (w, text) => { const i = at(w, text); await w.host.st.deleteMessage(i); await w.host.st.deleteMessage(i - 1); };
const endSpan = w => w.host.ctx.chat.flatMap(m => m.extra?.storySuite?.spans ?? []).findLast(s => ['combat.end', 'death.fight-end'].includes(s.guard?.predicate?.kind));
const xpClaims = w => Object.keys(w.head().meta.claims).filter(key => key.startsWith('xp:combat:'));

async function rat(w, stakes = 'normal') {
    await w.say(`<Changes>\n! encounter 2 Wolf — hungry | tier: weak | stakes: ${stakes}\n</Changes>`);
    ok(w.command('combat.start', { offer: w.q('combat.offers')[0].id }, 'ui'));
    for (let i = 0; i < 200 && w.q('combat.session').status === 'active'; i++) {
        const v = w.q('combat.session');
        ok(w.command('combat.act', { session: v.id, board: v.board, action: { type: 'attack', target: v.actions.targets.enemies[0] } }, 'ui'));
    }
    const pre = structuredClone(w.head());
    return Object.assign(ok(w.command('combat.end', { session: w.q('combat.session').id }, 'ui')), { pre });
}

test('F1: a won fight with no one downed keeps combat.end; deleting an earlier clock-only or hp-edit reply keeps its XP', async t => seeded(91, async () => {
    const w = await world(t);
    await w.say('Clock only.\n\n<Changes>\n~ time 3000\n</Changes>');
    await w.say('Hurt.');
    ok(w.command('test.pool', { actor: w.friend, pool: 'hp', cur: w.q('party.actor', { id: w.friend }).hp.max - 1 }));
    const xp0 = w.q('party.actor', { id: w.pc }).earned ?? 0;
    const out = await rat(w);
    assert.equal(out.receipt.data.outcome, 'won');
    const xp = w.q('party.actor', { id: w.pc }).earned - xp0;
    assert.ok(xp > 0, 'the fight paid XP');
    assert.equal(xpClaims(w).length, 2);
    await drop(w, 'Hurt.');
    assert.equal(xpClaims(w).length, 2, 'the hp edit is gone, the settlement stands');
    assert.equal(w.q('party.actor', { id: w.pc }).earned - xp0, xp);
    await drop(w, 'Clock only.');
    assert.equal(w.q('party.actor', { id: w.pc }).earned - xp0, xp, 'and the clock reply too');
    assert.equal(xpClaims(w).length, 2);
    assert.equal(endSpan(w).guard.predicate.kind, 'combat.end', 'no death or injury is written: main\'s guard');
    assert.deepEqual(w.problems(), []);
    w.host.store.rebuild();
    assert.equal(w.q('party.actor', { id: w.pc }).earned - xp0, xp);
    assert.deepEqual(w.problems(), []);
}));

test('F1: an injury settlement binds who was downed and the minute, not hp or conditions, and says so in its own words', async t => seeded(43, async () => {
    const w = await world(t);
    await w.say('Clock.\n\n<Changes>\n~ time 2000\n</Changes>');
    ok(w.command('test.pool', { actor: w.friend, pool: 'hp', cur: 0 }));
    await w.say('Edit.');
    const out = await rat(w, 'death');
    assert.equal(out.receipt.data.outcome, 'won');
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'gravely-injured');
    const span = endSpan(w);
    assert.equal(span.guard.predicate.kind, 'death.fight-end');
    const view = s => ({ state: s, hash: hashJson, query: (name, args) => w.q(name, args) });
    const info = { guard: span.guard, source: span.source, recorded: span.recorded };
    const prior = out.pre;
    assert.equal(replayGuard(view(prior), info).ok, true);
    // hp and conditions of the fighters are not bound.
    for (const id of [w.pc, w.friend]) {
        prior.domains.party.actors[id].hp.cur = 7;
        prior.domains.party.actors[id].conditions = [{ kind: 'poison', stacks: 1, rounds: 3 }];
    }
    assert.equal(replayGuard(view(prior), info).ok, true, 'hp and conditions are free');
    // The minute is written (the injury `at`), so it is bound; the failure has its own text.
    prior.domains.director.time.minutes = 2001;
    const off = replayGuard(view(prior), info);
    assert.equal(off.ok, false);
    assert.match(off.reason, /fight ended differently/);
    assert.doesNotMatch(off.reason, /lethal batch/);
}));

test('F1: a wipe stays on its carrier when an earlier hp-only reply is deleted', async t => seeded(91, async () => {
    const w = await world(t);
    await w.say('Edit reply.');
    const out = await wipe(w);
    const batch = out.receipt.data.deathBatch;
    assert.ok(batch);
    const carrier = at(w, 'Ogre');
    assert.equal(endSpan(w).guard.predicate.kind, 'death.fight-end');
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'dead');
    await drop(w, 'Edit reply.');
    const moved = at(w, 'Ogre');
    assert.ok(moved >= 0 && moved === carrier - 2, 'the same reply, two messages earlier');
    assert.equal(Object.values(w.slice('death').batches)[0].status, 'complete');
    assert.equal(Object.keys(w.slice('death').outbox).length, 1);
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'dead');
    assert.equal(endSpan(w).guard.predicate.kind, 'death.fight-end');
    assert.equal(w.host.ctx.chat[moved].extra.storySuite.spans.some(s => s.guard?.predicate?.kind === 'death.fight-end'), true, 'on its own carrier');
    assert.deepEqual(w.problems(), []);
    w.host.store.rebuild();
    assert.equal(lifeOf(w.q('party.actor', { id: w.pc })), 'dead');
    assert.deepEqual(w.problems(), []);
}));
