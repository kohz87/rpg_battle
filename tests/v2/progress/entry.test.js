// The entry points into progression (contract §3, B3, B5): the basic class at creation.finish and party.addCompanion,
// the story's paid skill use, and a fight's paid uses. Real party and creation modules with the rules-v2 parts merged in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, realWorld } from './helpers/world.js';
import { ref } from './helpers/fixture.js';

const FINISH = { name: 'Astra', race: 'rpg-battle/human', points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 } };
const finish = (w, over = {}) => w.host.bus.command('creation.finish', { ...FINISH, ...over }, { cause: 'ui' });
const rbClaims = w => Object.keys(w.head().meta.claims).filter(key => key.startsWith('rb:')).sort();

test('creation.finish in a chat with no rules pack is exactly what it was: a class in the payload is ignored, nothing is recorded', async t => {
    const w = await realWorld(t, { character: false, pin: false });
    const out = finish(w, { class: ref('c0'), checkActor: 'whatever' });
    assert.equal(out.ok, true, out.message);
    assert.equal(w.q('party.pc').name, 'Astra');
    assert.deepEqual(w.slice('progress').choices, {});
    assert.equal(w.slice('rules').pin, null);
    assert.deepEqual(rbClaims(w), []);
});

test('creation.finish with a pinned ruleset: the class is required, a basic class of the pack, and recorded in the same transaction', async t => {
    const w = await realWorld(t, { character: false });
    const before = JSON.stringify(w.head().domains.party);
    assert.equal(finish(w).code, 'INVALID', 'no class');
    assert.equal(finish(w, { class: 'c0' }).code, 'INVALID');
    assert.equal(finish(w, { class: ref('c1') }).code, 'REFUSED', 'a promotion class is not a start');
    assert.equal(finish(w, { class: ref('nope') }).code, 'REFUSED');
    assert.equal(finish(w, { class: ref('c0'), checkActor: 'xx' }).code, 'INVALID');
    assert.equal(JSON.stringify(w.head().domains.party), before, 'a refusal makes no character');
    assert.deepEqual(w.slice('progress').choices, {});
    const out = finish(w, { class: ref('c0'), checkActor: 'ca_00000002' });
    assert.equal(out.ok, true, out.message);
    const pc = out.receipt.data.actor;
    assert.equal(w.q('party.pc').id, pc);
    assert.deepEqual(w.slice('progress').choices[`${pc}|0`], { actor: pc, milestone: 0, kind: 'class', previous: null, selected: ref('c0'), skills: [ref('s00'), ref('s01'), ref('s02')], rulesHash: w.slice('rules').rulesHash });
    assert.ok(w.head().meta.claims[`rb:ep_00000000:class:${pc}:0`]);
    const view = w.progress(pc);
    assert.equal(view.level, 1);
    assert.deepEqual(view.checklist.map(item => [item.mastery, item.needed]), [[0, 5], [0, 5], [0, 5]]);
    const span = [...w.host.ctx.chat].reverse().find(message => message.extra?.storySuite).extra.storySuite.spans.at(-1);
    assert.equal(span.guard.predicate.kind, 'class.start');
    assert.deepEqual(w.problems(), []);
});

test('creation.finish: with the pin gone on replay the character is not made, and nothing else is chosen in its place', async t => {
    const w = await realWorld(t, { character: false, pin: false });
    await w.say('Later.');
    const pinned = w.host.bus.command('test.pin', {}, { cause: 'ui' });
    assert.equal(pinned.ok, true);
    await w.say('Then she arrives.');
    assert.equal(finish(w, { class: ref('c0') }).ok, true);
    const pinReply = w.host.ctx.chat.findIndex(message => String(message.mes ?? '').includes('Later.'));
    await w.host.st.deleteMessage(pinReply);
    await w.host.st.deleteMessage(pinReply - 1);
    assert.equal(w.q('party.pc'), null, 'the whole block is off: no character, no class');
    assert.deepEqual(w.slice('progress').choices, {});
    assert.equal(w.problems().filter(problem => problem.code === 'REPLAY_PREREQUISITE').length >= 1, true);
    const live = JSON.stringify(w.head().domains.party);
    w.host.store.rebuild();
    assert.equal(JSON.stringify(w.head().domains.party), live);
});

test('party.addCompanion and an accepted join offer: the player\'s class is required in a rules chat, the companion starts at 0/5', async t => {
    const w = await realWorld(t);
    const before = Object.keys(w.head().domains.party.actors).length;
    const refused = await w.internal('party.addCompanion', { name: 'Lyra', level: 1 });
    assert.equal(refused.code, 'INVALID');
    assert.equal((await w.internal('party.addCompanion', { name: 'Lyra', level: 1, class: ref('c2') })).code, 'REFUSED');
    assert.equal(Object.keys(w.head().domains.party.actors).length, before, 'a refusal adds nobody');
    const joined = await w.internal('party.addCompanion', { name: 'Lyra', level: 1, class: ref('c0') });
    assert.equal(joined.ok, true, joined.message);
    const lyra = joined.receipt.data.actor;
    assert.equal(w.progress(lyra).class, ref('c0'));
    assert.ok(w.progress(lyra).checklist.every(item => item.mastery === 0));
    // From the story: an offer, then the player accepts and chooses the class.
    await w.say('A stranger asks to come.', ['+ join Bram — a guard | role: guard']);
    const offer = w.q('party.offers')[0];
    assert.ok(offer);
    assert.equal((await w.host.sdk.command('party.acceptOffer', { offer: offer.id })).code, 'INVALID', 'no class');
    const accepted = await w.host.sdk.command('party.acceptOffer', { offer: offer.id, class: ref('c0') });
    assert.equal(accepted.ok, true, accepted.message);
    assert.equal(w.progress(accepted.receipt.data.actor).class, ref('c0'));
    assert.deepEqual(w.problems(), []);
});

async function trained(t, over = {}) {
    const w = await realWorld(t, over);
    await w.say('Clock.', [`~ time ${2 * DAY + 600}`]);
    return w;
}
const useLine = (w, skill = 's00', form = 's00-base') => `! skill-use ${w.pc} | skill: ${ref(skill)} | form: ${ref(form)}`;

test('a skill used in the story pays its cost in the same transaction, gives a use proof, and is a paid attempt that earns a credit', async t => {
    const w = await trained(t);
    const sp = () => w.q('party.pc').sp.cur;
    const was = sp();
    await w.say('She swings.', [useLine(w)]);
    assert.equal(sp(), was - 1, 'the physical form costs 1 SP');
    const [id] = Object.keys(w.slice('progress').attempts);
    const attempt = w.slice('progress').attempts[id];
    assert.equal(attempt.kind, 'narrative');
    assert.equal(attempt.actor, w.pc);
    const proofs = w.host.sdk.query('story.evidence', {});
    assert.deepEqual(proofs.map(proof => [proof.kind, proof.owner, proof.payload.actor, proof.payload.skill, proof.payload.form]), [['use', 'rpg-battle', w.pc, ref('s00'), ref('s00-base')]]);
    assert.equal(attempt.cost, proofs[0].payload.use);
    assert.equal(w.slice('progress').credits[id].award, 1, 'the host settled it after the reply');
    assert.ok(w.head().meta.claims[`rb:ep_00000000:use:${id}`]);
    assert.equal(w.progress().checklist[0].mastery, 1);
    const span = w.host.ctx.chat.at(-1).extra.storySuite.spans.find(item => item.guard?.predicate?.kind === 'skill.use');
    assert.ok(span, 'the use is a guarded block');
    assert.equal(span.evidence.length, 1);
    assert.deepEqual(w.problems(), []);
    // Gone with the reply: the SP is back, the attempt, the credit and the proof go.
    await w.host.st.deleteMessage(w.host.ctx.chat.length - 1);
    await w.host.st.deleteMessage(w.host.ctx.chat.length - 1);
    assert.equal(sp(), was);
    assert.deepEqual(Object.keys(w.slice('progress').attempts), []);
    assert.deepEqual(w.host.sdk.query('story.evidence', {}), []);
});

test('a use that cannot be paid, is not the character\'s skill, or is of a downed character is refused whole: no pool, no proof, no attempt', async t => {
    const w = await trained(t);
    const sp0 = w.q('party.pc').sp.cur;
    const refuse = async lines => {
        await w.say('Not this.', lines);
        assert.equal(w.q('party.pc').sp.cur, sp0);
        assert.deepEqual(Object.keys(w.slice('progress').attempts), []);
        assert.deepEqual(w.host.sdk.query('story.evidence', {}), []);
    };
    await refuse([useLine(w, 's10', 's10-base')]);
    await refuse([useLine(w, 's00', 's00-base-g')]);
    await refuse([`! skill-use ac_zzzzzzzz | skill: ${ref('s00')} | form: ${ref('s00-base')}`]);
    await refuse(['! skill-use']);
    assert.equal(w.host.bus.command('test.pool', { actor: w.pc, pool: 'sp', cur: 0 }, { cause: 'ui' }).ok, true);
    const empty = w.q('party.pc').sp.cur;
    const turns = [];
    w.host.events.on('turn', turn => turns.push(turn));
    await w.say('She has nothing left.', [useLine(w)]);
    assert.equal(w.q('party.pc').sp.cur, empty);
    assert.deepEqual(Object.keys(w.slice('progress').attempts), [], 'no pool, no use');
    assert.deepEqual(turns.flatMap(turn => turn.problems).map(problem => problem.code), ['NOT_ENOUGH'], 'the line is told, not applied');
    assert.equal(w.host.bus.command('skill.use', { actor: w.pc, skill: ref('s00'), form: ref('s00-base') }, { cause: 'ui' }).code, 'REFUSED', 'a button is not a story use');
});

test('a use may cite one surviving paid use instead of paying: once, never with a new payment', async t => {
    const w = await trained(t);
    await w.say('She swings.', [useLine(w)]);
    const proof = w.host.sdk.query('story.evidence', {})[0];
    const sp = w.q('party.pc').sp.cur;
    const cite = (id = proof.id, over = {}) => w.internal('skill.use', { actor: w.pc, skill: ref('s00'), form: ref('s00-base'), paid: id, ...over });
    const out = await cite();
    assert.equal(out.ok, true, out.message);
    assert.equal(w.q('party.pc').sp.cur, sp, 'nothing is paid again');
    assert.equal(w.host.sdk.query('story.evidence', {}).length, 1, 'no new proof');
    assert.equal(out.receipt.data.v2.result.paid, true);
    assert.equal((await cite()).code, 'CLAIMED', 'a proof is cited once');
    assert.equal((await cite('pf_zzzzzzzz')).code, 'NOT_FOUND');
    assert.equal((await cite(proof.id, { skill: ref('s01'), form: ref('s01-base') })).code, 'NOT_FOUND', 'another skill\'s proof');
    assert.equal((await cite(proof.id, { paid: 'x' })).code, 'INVALID');
});

test('a fight\'s paid uses are attempts named by the fight, the character, the skill and their number; the same end twice records nothing twice', async t => {
    const w = await trained(t);
    const uses = [{ actor: w.pc, skill: ref('s00'), form: ref('s00-base'), count: 3 }, { actor: w.pc, skill: ref('s01'), form: ref('s01-base'), count: 1 }];
    const out = w.host.bus.command('test.combatEnd', { fight: 'cf_00000001', uses }, { cause: 'ui' });
    assert.equal(out.ok, true, out.message);
    assert.equal(out.receipt.data.created, 3, 'the third use of one skill in one reply cannot earn, so it is not kept');
    assert.equal(out.receipt.data.ids.length, 4);
    assert.equal(Object.keys(w.slice('progress').attempts).length, 3);
    assert.ok(Object.values(w.slice('progress').attempts).every(attempt => attempt.kind === 'combat' && attempt.cost === 'cf_00000001'));
    assert.equal(w.host.bus.command('test.combatEnd', { fight: 'cf_00000001', uses }, { cause: 'ui' }).receipt.data.created, 0);
    assert.equal(Object.keys(w.slice('progress').attempts).length, 3);
    assert.equal(w.host.bus.command('test.combatEnd', { fight: 'cf_00000001', uses: [{ ...uses[0], count: 0 }] }, { cause: 'ui' }).code, 'INVALID');
    assert.equal(w.host.bus.command('test.combatEnd', { fight: '', uses }, { cause: 'ui' }).code, 'INVALID');
    // Settled with the next reply's step: 2 credits for the first skill (the reply cap; its third use was not kept), 1 for the second.
    await w.say('Afterwards.', [useLine(w, 's02', 's02-base')]);
    const credits = Object.entries(w.slice('progress').credits).map(([id, credit]) => [w.slice('progress').attempts[id].skill, credit.award]);
    assert.equal(credits.filter(([skill, award]) => skill === ref('s00') && award === 1).length, 2);
    assert.equal(credits.filter(([skill, award]) => skill === ref('s00') && award === 0).length, 0);
});
