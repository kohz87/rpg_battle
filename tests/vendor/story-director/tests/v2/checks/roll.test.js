// checks.roll (contract §3 P09): one d20, the standalone subtotal or RPG Battle's projection in its place, one NPC social part, the clamp
// with its cap part, and the evidence a check stands on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashOf, makeState, run, write } from './helpers.js';
import { combine, rbParts, socialParts, standaloneParts } from '../../../src/v2/checks/roll.js';
import { statForCheck, topicsOf } from '../../../src/v2/checks/words.js';

const EVIDENCE = 'ev_00000001';
const known = { 'story.evidence': () => [{ id: EVIDENCE }] };

function withActor(bonuses = {}, rb = null) {
    let state = makeState();
    state = run(state, 'checks.actor', { write: write(), name: 'Mara', bonuses, expectedHash: hashOf(state) }).state;
    const id = state.domains.checks.policy.defaultActor;
    if (rb) state = run(state, 'checks.link', { write: write(), actor: id, rbActor: rb, expectedHash: hashOf(state) }, { queries: { 'rules.sheet': () => ({ id: rb, kind: 'pc' }) } }).state;
    return { state, id };
}
/** The log record of a roll: where its modifier came from. */
const how = out => out.state.domains.checks.log[out.result.data.v2.result.check];
const roll = (state, payload, options = {}) => run(state, 'checks.roll', { skill: 'Stealth', evidence: EVIDENCE, ...payload }, { cause: 'capture', queries: known, ...options });

test('the words: an explicit stat first, then the skill word, unknown is luck; topics are the table\'s', () => {
    assert.equal(statForCheck('stealth'), 'DEX');
    assert.equal(statForCheck('stealth', 'str'), 'STR');
    assert.equal(statForCheck('persuade the guard'), 'CHA');
    assert.equal(statForCheck('mumble'), 'LUK');
    assert.deepEqual(topicsOf('sneak past'), ['stealth']);
    assert.deepEqual(topicsOf('pick the lock'), ['lock']);
});

test('standalone: bonuses[stat] and each matching topic once; the outcome is the d20 against the difficulty', () => {
    const { state, id } = withActor({ DEX: 2, 'topic:stealth': 1, 'topic:lock': 5 });
    const out = roll(state, { dc: 15 }, { die: 12 });
    assert.ok(out.ok, out.message);
    const result = out.result.data.v2.result;
    assert.match(result.check, /^ck_[0-9a-z]{8}$/);
    assert.deepEqual(result.modifiers, [{ source: 'standalone', ref: 'DEX', reason: 'DEX bonus', amount: 2 }, { source: 'standalone', ref: 'topic:stealth', reason: 'stealth bonus', amount: 1 }]);
    assert.deepEqual(Object.keys(result), ['check', 'actor', 'die', 'modifiers', 'mod', 'total', 'dc', 'outcome'], 'the contract\'s result, nothing more');
    assert.deepEqual([result.actor, result.die, result.mod, result.total, result.dc, result.outcome], [id, 12, 3, 15, 15, 'success']);
    assert.deepEqual([how(out).source, how(out).fallback], ['standalone', 'no-link'], 'where the modifier came from is on the log record');
    assert.deepEqual(out.state.domains.checks.log[result.check].modifiers, result.modifiers);
    assert.equal(out.result.narrate, true);
});

test('outcomes: natural 20 and 1, success, cost within the margin, fail; no dc uses the setting', () => {
    const { state } = withActor();
    const outcome = (die, dc, settings) => roll(state, dc ? { dc } : {}, { die, settings }).result.data.v2.result.outcome;
    assert.equal(outcome(20, 40), 'crit');
    assert.equal(outcome(1, 1), 'critfail');
    assert.equal(outcome(10, 10), 'success');
    assert.equal(outcome(8, 10), 'cost');
    assert.equal(outcome(7, 10), 'fail');
    assert.equal(outcome(7, 10, { costMargin: 3 }), 'cost');
    assert.equal(roll(state, {}, { die: 14, settings: { defaultDc: 14 } }).result.data.v2.result.outcome, 'success');
    assert.equal(roll(state, {}, { die: 14 }).result.data.v2.result.dc, 15);
});

test('a linked character\'s rules.modifier replaces the standalone subtotal, never added to it; the parts sum to the modifier', () => {
    const { state } = withActor({ DEX: 9, 'topic:stealth': 9 }, 'ac_00000001');
    const parts = [{ source: 'stat', ref: null, reason: 'DEX 11', amount: 3 }, { source: 'skill', ref: 'pack.fixture/s00', reason: 'Shadow Step', amount: 2 }];
    let asked = null;
    const out = roll(state, { dc: 10 }, { die: 5, queries: { ...known, 'rules.modifier': args => { asked = args; return { actor: args.actor, stat: args.stat, amount: 5, parts }; } } });
    assert.ok(out.ok, out.message);
    assert.deepEqual(asked, { actor: 'ac_00000001', stat: 'DEX', skill: 'Stealth' });
    const result = out.result.data.v2.result;
    assert.deepEqual([result.mod, how(out).source, how(out).fallback], [5, 'rb', null]);
    assert.equal(result.modifiers.reduce((sum, part) => sum + part.amount, 0), result.mod);
});

test('RB absent, off, throwing, null or malformed: the standalone bonuses and the reason', () => {
    const { state } = withActor({ DEX: 2 }, 'ac_00000001');
    const reason = (queries, settings) => { const out = roll(state, {}, { queries: { ...known, ...queries }, settings }); return { ...how(out), mod: out.result.data.v2.result.mod }; };
    assert.deepEqual([reason({}).fallback, reason({}).mod], ['rb-unavailable', 2]);
    assert.equal(reason({ 'rules.modifier': () => null }).fallback, 'rb-no-answer');
    assert.equal(reason({ 'rules.modifier': args => ({ actor: args.actor, stat: args.stat, amount: 99, parts: [] }) }).fallback, 'rb-malformed');
    assert.equal(reason({ 'rules.modifier': args => ({ actor: args.actor, stat: args.stat, amount: 4, parts: [{ source: 'stat', ref: null, reason: '', amount: 1 }] }) }).fallback, 'rb-malformed', 'parts that do not add up');
    assert.equal(reason({ 'rules.modifier': args => ({ actor: 'ac_00000009', stat: args.stat, amount: 0, parts: [] }) }).fallback, 'rb-malformed', 'another character\'s answer');
    assert.equal(reason({}, { rbModifiers: false }).fallback, 'rb-modifiers-off');
});

test('the clamp: a modifier past 30 is held with a cap part, so the parts still sum to it', () => {
    const { state } = withActor({ DEX: 30, 'topic:stealth': 30 });
    const out = roll(state, {}, { die: 10 });
    const result = out.result.data.v2.result;
    assert.equal(result.mod, 30);
    assert.deepEqual(result.modifiers.at(-1), { source: 'cap', ref: null, reason: 'held to 30', amount: -30 });
    assert.equal(result.modifiers.reduce((sum, part) => sum + part.amount, 0), 30);
    assert.deepEqual(combine([{ source: 'x', ref: null, reason: '', amount: -45 }]).mod, -30);
});

test('a person\'s social part: the identity resolves to the current name, one call, parts from the reasons; NSD absent or off adds nothing; unknown is NOT_FOUND', () => {
    const { state } = withActor({ DEX: 1 });
    const asked = [];
    const queries = {
        ...known,
        'npc.identity': args => (args.id === 'np_00000001' ? { id: args.id, nativeKey: 'brannoc', name: 'Brannoc' } : null),
        'npc.socialModifier': args => { asked.push(args); return { mod: 2, name: args.name, skill: args.skill, reasons: [{ text: 'trusts you', value: 3 }, { text: 'owes a favour', value: -1 }] }; },
    };
    const out = roll(state, { targetNpc: 'np_00000001', skill: 'Persuade' }, { queries, die: 4 });
    assert.ok(out.ok, out.message);
    assert.deepEqual(asked, [{ name: 'Brannoc', skill: 'Persuade' }]);
    const result = out.result.data.v2.result;
    assert.deepEqual(result.modifiers.filter(part => part.source === 'social').map(part => part.amount), [3, -1]);
    assert.equal(result.mod, 2);
    assert.equal(roll(state, { targetNpc: 'np_00000009' }, { queries }).code, 'NOT_FOUND');
    const absent = roll(state, { targetNpc: 'np_00000001' }, { queries: known });
    assert.ok(absent.ok, 'with NSD absent the target adds nothing');
    assert.equal(absent.result.data.v2.result.modifiers.some(part => part.source === 'social'), false);
    const off = roll(state, { targetNpc: 'np_00000001' }, { queries, settings: { social: false } });
    assert.equal(off.result.data.v2.result.modifiers.some(part => part.source === 'social'), false);
    assert.equal(asked.length, 1, 'off asks nobody');
});

test('who may roll, and what it stands on: the story and the pre-roll, not a click; unknown evidence NOT_FOUND; the same check twice is refused', () => {
    const { state } = withActor();
    assert.equal(roll(state, {}, { cause: 'ui' }).code, 'REFUSED');
    assert.equal(roll(state, {}, { cause: 'system', caller: 'rpg-battle' }).code, 'REFUSED');
    assert.ok(roll(state, {}, { cause: 'system', caller: 'story-block' }).ok, 'the pre-roll');
    assert.equal(roll(state, { evidence: 'ev_00000009' }).code, 'NOT_FOUND');
    assert.ok(roll(state, { evidence: 'ev_00000009' }, { source: { evidence: 'ev_00000009' }, queries: {} }).ok, 'the block\'s own evidence');
    const first = roll(state, { dc: 12 });
    assert.ok(first.ok);
    assert.equal(roll(first.state, { dc: 12 }, { claimed: true }).code, 'REFUSED', 'used');
    assert.ok(roll(first.state, { dc: 13 }).ok, 'another meaning on the same evidence is another check');
});

test('S3: the pre-roll stands on the previous reply\'s evidence but is its own check: the reply\'s check of the same meaning does not stop it, and it does not stop the reply\'s', () => {
    const { state } = withActor();
    const reply = roll(state, { dc: 12 }, { cause: 'story' });
    assert.ok(reply.ok, reply.message);
    const pre = roll(reply.state, { dc: 12 }, { cause: 'system', caller: 'story-block' });
    assert.ok(pre.ok, pre.message);
    assert.equal(roll(pre.state, { dc: 12 }, { cause: 'story' }).code, 'REFUSED', 'the reply\'s own check is still once');
    // The other way round: the pre-roll first, then the reply\'s check on the same evidence and meaning.
    const first = roll(state, { dc: 12 }, { cause: 'system', caller: 'story-block' });
    assert.ok(first.ok);
    assert.ok(roll(first.state, { dc: 12 }, { cause: 'story' }).ok);
    assert.ok(roll(first.state, { dc: 12 }, { cause: 'system', caller: 'story-block' }).ok, 'a later message\'s pre-roll, whatever the claims; once per message is the assist\'s claim');
});

test('refusals: no actor, unknown actor, bad payloads, a supplied die or outcome', () => {
    assert.equal(roll(makeState(), {}).code, 'NOT_FOUND');
    const { state } = withActor();
    assert.equal(roll(state, { actor: 'ca_zzzzzzzz' }).code, 'NOT_FOUND');
    for (const extra of [{ die: 20 }, { outcome: 'crit' }, { stat: 'WIS' }, { dc: 41 }, { dc: 0 }, { targetNpc: 'brannoc' }, { skill: '' }, { evidence: 'x' }]) assert.equal(roll(state, extra).code, 'INVALID', JSON.stringify(extra));
});

test('the pure parts: RB\'s answer and NSD\'s are checked before they are believed', () => {
    assert.equal(rbParts(null, 'ac_00000001', 'DEX'), null);
    assert.equal(rbParts({ actor: 'ac_00000001', stat: 'STR', amount: 0, parts: [] }, 'ac_00000001', 'DEX'), null);
    assert.deepEqual(rbParts({ actor: 'ac_00000001', stat: 'DEX', amount: 0, parts: [] }, 'ac_00000001', 'DEX'), []);
    assert.deepEqual(socialParts({ mod: 0, reasons: [] }), []);
    assert.deepEqual(socialParts({ mod: 2, name: 'Brannoc', skill: 'x', reasons: [{ text: 'a', value: 5 }] }).map(part => part.amount), [2], 'reasons that do not add up are kept as one part');
    assert.deepEqual(standaloneParts(null, 'DEX', 'sneak'), []);
});
