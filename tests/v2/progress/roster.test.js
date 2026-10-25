// rules.party, party.setActive and summon.end (contract §3, fixture C08; track C's fixtures, RB #139): on the real
// party module with the rules-v2 parts beside it, and on built states for what the real module cannot make yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realWorld } from './helpers/world.js';
import { assess } from '../../../src/v2/progress/assess.js';
import { partyView, activeIds, lifeOf, SLOTS } from '../../../src/v2/rules/sheet.js';
import { ref } from './helpers/fixture.js';
import { golden, slice, basic } from './helpers/states.js';

const rosterOf = w => w.q('rules.party', {});
const ids = sheets => sheets.map(sheet => sheet.id);

// (The party part allows three companions by default, so one is in reserve here; C08's two reserves need the setting raised.)
test('C08 roster: the PC and two companions active, the rest in reserve, temporary units beside, each a SheetView', async t => {
    const w = await realWorld(t, { companions: ['Lyra', 'Bram', 'Cass'] });
    w.host.bus.command('test.unit', { id: 'ac_wolf0001' }, { cause: 'ui' });
    w.host.bus.command('test.unit', { id: 'ac_spark001', kind: 'pet', name: 'Spark' }, { cause: 'ui' });
    const party = rosterOf(w);
    assert.equal(party.pc, w.pc);
    assert.equal(party.activeLimit, 3);
    assert.deepEqual(ids(party.active), [w.pc, w.mates[0], w.mates[1]]);
    assert.deepEqual(ids(party.reserve), [w.mates[2]]);
    assert.deepEqual(party.temporary.map(sheet => [sheet.id, sheet.kind, sheet.name]), [['ac_wolf0001', 'summon', 'Grey wolf'], ['ac_spark001', 'pet', 'Spark']]);
    const [astra] = party.active;
    assert.deepEqual(Object.keys(astra).sort(), ['background', 'class', 'conditions', 'control', 'gear', 'hp', 'id', 'kind', 'level', 'life', 'mp', 'name', 'npcId', 'origin', 'portrait', 'role', 'skills', 'sp', 'stats', 'tier', 'unspent', 'xp', 'xpToNext'].sort());
    assert.equal(astra.kind, 'pc');
    assert.equal(astra.control, 'player');
    assert.equal(astra.class, ref('c0'));
    assert.equal(astra.tier, 0);
    assert.equal(astra.skills.length, 3);
    assert.deepEqual(astra.skills.map(skill => [skill.skill, skill.mastery, skill.uses]), [[ref('s00'), 0, 0], [ref('s01'), 0, 0], [ref('s02'), 0, 0]]);
    assert.deepEqual(Object.keys(astra.gear), [...SLOTS]);
    assert.ok(Object.values(astra.gear).every(value => value === null));
    assert.equal(astra.level, w.q('party.pc').level);
    assert.deepEqual(astra.hp, { cur: w.q('party.pc').hp.cur, max: w.q('party.pc').hp.max });
    assert.equal(astra.xpToNext, 100);
    assert.equal(astra.life, 'alive');
    assert.equal(party.active[1].kind, 'companion');
    assert.equal(party.active[1].control, 'auto');
});

test('rules.party is null without a pinned ruleset, and a member with no class yet is left out', async t => {
    const w = await realWorld(t, { pin: false });
    assert.equal(w.q('rules.party', {}), null, 'nothing pinned');
    assert.equal((await w.internal('party.addCompanion', { name: 'Lyra', level: 1 })).ok, true, 'a legacy companion, made before any pack');
    assert.equal(w.host.bus.command('test.pin', {}, { cause: 'ui' }).ok, true);
    assert.equal(w.host.bus.command('test.start', { actor: w.pc, class: ref('c0') }, { cause: 'ui' }).ok, true);
    assert.deepEqual(ids(rosterOf(w).active), [w.pc], 'a companion with no basic class is not a rules-v2 sheet');
    assert.equal(w.q('rules.party', { x: 1 }), null);
});

test('party.setActive: the player\'s choice of who fights; the PC stays; at most three; the rest wait in reserve', async t => {
    const w = await realWorld(t, { companions: ['Lyra', 'Bram', 'Cass'] });
    const [lyra, bram, cass] = w.mates;
    const out = w.ui('party.setActive', { actors: [w.pc, cass, bram] });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual(out.receipt.data.v2.result, { actors: [w.pc, bram, cass], reserve: [lyra] });
    assert.deepEqual(ids(rosterOf(w).active), [w.pc, bram, cass]);
    assert.deepEqual(ids(rosterOf(w).reserve), [lyra]);
    assert.equal(out.receipt.narrate, false);
    // The PC comes first whatever the order given, and a smaller party is fine.
    assert.equal(w.ui('party.setActive', { actors: [lyra, w.pc] }).ok, true);
    assert.deepEqual(ids(rosterOf(w).active), [w.pc, lyra]);
    assert.deepEqual(ids(rosterOf(w).reserve), [bram, cass]);
    assert.deepEqual(w.problems(), []);
});

test('party.setActive refusals: more than three, no PC, a duplicate, a stranger, a summon, odd payloads, anyone but the player', async t => {
    const w = await realWorld(t, { companions: ['Lyra', 'Bram', 'Cass'] });
    const [lyra, bram, cass] = w.mates;
    w.host.bus.command('test.unit', { id: 'ac_wolf0001' }, { cause: 'ui' });
    const before = JSON.stringify(w.slice('progress').roster);
    const codes = payload => w.ui('party.setActive', payload).code;
    assert.equal(codes({ actors: [w.pc, lyra, bram, cass] }), 'REFUSED');
    assert.equal(codes({ actors: [lyra, bram] }), 'REFUSED');
    assert.equal(codes({ actors: [w.pc, lyra, lyra] }), 'REFUSED');
    assert.equal(codes({ actors: [w.pc, 'ac_zzzzzzzz'] }), 'NOT_FOUND');
    assert.equal(codes({ actors: [w.pc, 'ac_wolf0001'] }), 'REFUSED');
    assert.equal(codes({ actors: [] }), 'INVALID');
    assert.equal(codes({ actors: 'x' }), 'INVALID');
    assert.equal(codes({ actors: [w.pc], extra: 1 }), 'INVALID');
    assert.equal(codes({}), 'INVALID');
    for (const cause of ['story', 'system']) assert.equal(w.host.bus.command('party.setActive', { actors: [w.pc] }, { cause }).code, 'REFUSED');
    assert.equal(JSON.stringify(w.slice('progress').roster), before);
});

test('party.setActive on built states: a dead member is refused', () => {
    const ix = golden();
    const members = [{ id: 'ac_00000001', kind: 'pc', name: 'Astra', conditions: [] }, { id: 'ac_00000002', kind: 'companion', name: 'Lyra', conditions: [{ kind: 'dead', stacks: 1 }] }];
    const query = name => (name === 'party.actors' ? members : null);
    const env = { ix, progress: slice({ choices: [basic('ac_00000001', 'c0')] }), query };
    const out = assess('party.setActive', env, { actors: ['ac_00000001', 'ac_00000002'] });
    assert.deepEqual([out.ok, out.code], [false, 'REFUSED']);
    assert.match(out.why, /Lyra is dead/);
    assert.equal(assess('party.setActive', env, { actors: ['ac_00000001'] }).ok, true);
    assert.equal(lifeOf({ hp: { cur: 0 }, conditions: [] }), 'downed');
    assert.equal(lifeOf({ hp: { cur: 5 }, conditions: [{ kind: 'injury' }] }), 'gravely-injured');
    assert.equal(lifeOf({ hp: { cur: 0 }, conditions: [{ kind: 'dead' }] }), 'dead');
    assert.deepEqual(activeIds({ active: ['x', 'ac_00000002', 'ac_00000002'] }, members, 'ac_00000001'), ['ac_00000001', 'ac_00000002']);
    assert.deepEqual(activeIds(undefined, [], null), []);
    assert.equal(partyView(null, {}, null), null);
});

test('a roster choice is guarded: with the reply that brought the companion gone it is off, and the default roster stands', async t => {
    const w = await realWorld(t);
    await w.say('Lyra joins.');
    const out0 = await w.internal('party.addCompanion', { name: 'Lyra', level: 1, class: ref('c0') });
    const lyra = out0.receipt.data.actor;
    await w.say('Later.');
    assert.equal(w.ui('party.setActive', { actors: [w.pc, lyra] }).ok, true);
    assert.deepEqual(ids(rosterOf(w).active), [w.pc, lyra]);
    const joined = w.host.ctx.chat.findIndex(message => String(message.mes ?? '').includes('Lyra joins.'));
    await w.host.st.deleteMessage(joined);
    await w.host.st.deleteMessage(joined - 1);
    assert.deepEqual(ids(rosterOf(w).active), [w.pc]);
    assert.equal(w.slice('progress').roster.active, null);
    assert.deepEqual(w.problems().map(problem => problem.code), ['REPLAY_PREREQUISITE']);
});

test('summon.end: the player dismisses; a rule ends it for any reason; the same dismissal answers the same; a character of the party is not a summon', async t => {
    const w = await realWorld(t, { companions: ['Lyra'] });
    for (const id of ['ac_wolf0001', 'ac_wolf0002', 'ac_wolf0003']) w.host.bus.command('test.unit', { id }, { cause: 'ui' });
    assert.equal(rosterOf(w).temporary.length, 3);
    const end = (actor, reason, cause = 'ui') => w.host.bus.command('summon.end', { actor, reason }, { cause });
    const dismissed = end('ac_wolf0001', 'dismissed');
    assert.equal(dismissed.ok, true, dismissed.message);
    assert.deepEqual(dismissed.receipt.data.v2.result, { actor: 'ac_wolf0001', reason: 'dismissed' });
    assert.equal(rosterOf(w).temporary.length, 2);
    assert.deepEqual(end('ac_wolf0001', 'dismissed').receipt.data.v2.result, { actor: 'ac_wolf0001', reason: 'dismissed' }, 'the same dismissal again');
    assert.equal(end('ac_wolf0001', 'expired', 'system').code, 'REFUSED', 'it already ended another way');
    assert.equal(end('ac_wolf0002', 'expired').code, 'REFUSED', 'the player only dismisses');
    assert.equal(end('ac_wolf0002', 'expired', 'story').code, 'REFUSED');
    assert.equal(end('ac_wolf0002', 'expired', 'system').ok, true);
    assert.equal(end('ac_wolf0003', 'downed', 'system').ok, true);
    assert.equal(rosterOf(w).temporary.length, 0);
    assert.equal(end(w.mates[0], 'dismissed').code, 'REFUSED', 'a durable member does not end');
    assert.equal(end(w.pc, 'dismissed', 'system').code, 'REFUSED');
    assert.equal(end('ac_nobody01', 'dismissed').code, 'REFUSED');
    assert.equal(end('ac_wolf0001', 'gone').code, 'INVALID');
    assert.equal(w.host.bus.command('summon.end', { actor: 'ac_wolf0001' }, { cause: 'ui' }).code, 'INVALID');
    assert.deepEqual(w.problems(), []);
});

test('a fight-end dismissal removes the combat sheet only: the unit is off the roster, the party is the party', async t => {
    const w = await realWorld(t, { companions: ['Lyra'] });
    w.host.bus.command('test.unit', { id: 'ac_wolf0001' }, { cause: 'ui' });
    const before = ids(rosterOf(w).active);
    assert.equal(w.host.bus.command('summon.end', { actor: 'ac_wolf0001', reason: 'fight-ended' }, { cause: 'system' }).ok, true);
    assert.deepEqual(ids(rosterOf(w).active), before);
    assert.deepEqual(rosterOf(w).temporary, []);
});
