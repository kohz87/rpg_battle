// The checks part (MODULES §F80, §F31, §F32): rolls prepared before each reply (seeded, one set
// per reply index), handed over in the tail with code's modifier table; a `? check … | roll: N |
// result: …` line is recomputed with code's modifiers and recorded, a stated result that
// disagrees flagged; at most 2 checks per reply; the static instruction never changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part, STATIC_TEXT, beforeGenerate, tail } from '../../../src/v2/checks/index.js';
import { pickRoll, preparedFor } from '../../../src/v2/checks/commands.js';
import { MAX_ROLLS, drawFrom, promptRolls, rollDice } from '../../../src/v2/checks/dice.js';
import { EXTRA_CAP, extrasOf, itemTopics, modifiersFor, tableLine, topicsOf } from '../../../src/v2/checks/modifiers.js';
import { mismatchOf, saidOutcome } from '../../../src/v2/checks/shared.js';
import { checkModifier, DEFAULT_RULES } from '../../../src/rules.js';
import { byName, capture, logOf, makeState, pcOf, prepared, run, sfc32, toolsFor, viewOf, withItem, withParty } from './helpers/fake-ctx.js';

const LINE = '? check stealth — slipping past the guard | dc: hard | roll: 1 | result: success';

/** Ren and Lyra, with reply 4's rolls set to `rolls`. */
const ready = (rolls = [12, 5]) => prepared(withParty(), 4, { rolls });

function captured(state, raw = LINE, options = {}) {
    const out = capture(state, raw, options);
    assert.ok(out.ok, out.message);
    return { state: out.state, entry: logOf(out.state).at(-1), result: out.result };
}

// ---------------------------------------------------------------------------------------
// The dice (ported from Story Block v1 src/dice.js)

test('rollDice: seeded, rejection-sampled d20s; the count is clamped; a draw is required', () => {
    const a = rollDice(2, 20, drawFrom(sfc32(9)));
    assert.deepEqual(a, rollDice(2, 20, drawFrom(sfc32(9))), 'the same seed, the same rolls');
    assert.equal(a.length, 2);
    assert.ok(a.every(die => Number.isInteger(die) && die >= 1 && die <= 20));
    assert.equal(rollDice(99, 20, drawFrom(sfc32(1))).length, MAX_ROLLS);
    assert.deepEqual(rollDice(0, 20, drawFrom(sfc32(1))), []);
    // Rejection: a draw at or over the last whole multiple of 20 is skipped, not folded in.
    const draws = [0xFFFFFFFF, 0xFFFFFFF0, 39];
    assert.deepEqual(rollDice(1, 20, () => draws.shift()), [20]);
    assert.throws(() => rollDice(1, 20), /seeded draw/);
});

test('promptRolls ties each roll to an attempt (v1 0.9.6 wording, "uncertain attempt")', () => {
    assert.equal(promptRolls([12, 5]), 'Roll 1 = 12 · Roll 2 = 5 (the first uncertain attempt takes Roll 1, the next Roll 2, whatever they say)');
    assert.equal(promptRolls([7]), 'Roll 1 = 7 (the uncertain attempt takes it, whatever it says)');
    assert.equal(promptRolls([1, 2, 3]), 'Roll 1 = 1 · Roll 2 = 2 · Roll 3 = 3 (the first uncertain attempt takes Roll 1, the next Roll 2, and so on, whatever they say)');
    assert.equal(promptRolls([]), 'none');
});

// ---------------------------------------------------------------------------------------
// checks.prepare

test('checks.prepare: two fresh d20s from the receipt seed for that reply index, not narrated', () => {
    const out = run(withParty(), 'checks.prepare', { for: 4 }, { seed: 11, cause: 'system' });
    assert.ok(out.ok, out.message);
    const [entry] = out.state.domains.checks.prepared;
    assert.equal(entry.for, 4);
    assert.equal(entry.rolls.length, 2);
    assert.equal(entry.rev, out.ctx.rev);
    assert.equal(out.result.narrate, false);
    assert.equal(out.result.summary, `Dice for the next reply: ${promptRolls(entry.rolls)}.`);
    const again = run(withParty(), 'checks.prepare', { for: 4 }, { seed: 11, cause: 'system' });
    assert.deepEqual(again.state.domains.checks.prepared, out.state.domains.checks.prepared, 'replay gives the same rolls');
    assert.deepEqual(part.domains.checks.validate(out.state.domains.checks), []);
});

test('checks.prepare: a swipe or regenerate of the same reply replaces its rolls; 8 replies kept', () => {
    let state = prepared(withParty(), 4, { seed: 1 });
    const first = state.domains.checks.prepared[0].rolls;
    state = prepared(state, 4, { seed: 2 });
    assert.equal(state.domains.checks.prepared.length, 1);
    assert.notDeepEqual(state.domains.checks.prepared[0].rolls, first, 'fresh rolls for the swipe');
    for (let index = 5; index < 15; index++) state = prepared(state, index, { seed: index });
    assert.deepEqual(state.domains.checks.prepared.map(entry => entry.for), [7, 8, 9, 10, 11, 12, 13, 14]);
    assert.deepEqual(part.domains.checks.validate(state.domains.checks), []);
});

test('checks.prepare is refused from a screen and for a bad index; nothing saved', () => {
    const base = withParty();
    const ui = run(base, 'checks.prepare', { for: 4 }, { cause: 'ui' });
    assert.equal(ui.code, 'REFUSED');
    assert.equal(ui.state, base);
    assert.equal(run(base, 'checks.prepare', { for: -1 }, { cause: 'system' }).code, 'INVALID');
    assert.equal(run(base, 'checks.prepare', { for: 'x' }, { cause: 'system' }).code, 'INVALID');
    const unknown = run(base, 'checks.prepare', {}, { cause: 'system' });
    assert.equal(unknown.ok, true);
    assert.equal(unknown.state.domains.checks.prepared[0].for, null);
});

// ---------------------------------------------------------------------------------------
// The `check` line

test('a check line: the roll it names + code\'s modifiers against the DC is the recorded result', () => {
    const { state, entry, result } = captured(ready([12, 5]));
    const ren = pcOf(state);
    const dex = checkModifier(ren.stats.DEX, DEFAULT_RULES);
    assert.equal(dex, 2, 'DEX 9 gives +2 by v1 rules');
    assert.match(entry.id, /^ck_[0-9a-z]{8}$/);
    assert.deepEqual({ ...entry, id: 'x' }, {
        id: 'x', actor: ren.id, skill: 'stealth', stat: 'DEX', dc: 20, word: 'hard', what: 'slipping past the guard', rev: 4,
        carrier: '4:0', roll: 1, die: 12, modifiers: [{ source: 'stat', amount: 2, reason: 'DEX' }], mod: 2, total: 14,
        outcome: 'fail', said: 'success', mismatch: 'narrated as success, the dice say fail', note: '',
    });
    assert.equal(result.narrate, false, 'the reply narrated it already');
    assert.equal(result.summary, 'Ren tries stealth (slipping past the guard): Roll 1 = 12, DEX +2 → 14 against 20 (hard): fail. The story narrated it as success, the dice say fail.');
    assert.equal(result.data.outcome, 'fail');
    assert.equal(result.data.mismatch, 'narrated as success, the dice say fail');
    // The reply's card reads `last`.
    assert.deepEqual(state.domains.checks.last, {
        carrier: '4:0', rev: 4,
        results: [{ id: entry.id, actor: ren.id, name: 'Ren', text: 'stealth (slipping past the guard): Roll 1 = 12 + 2 = 14 against 20 (hard)', outcome: 'fail', outcomeText: 'fail', mismatch: 'narrated as success, the dice say fail', note: '' }],
    });
    assert.deepEqual(part.domains.checks.validate(state.domains.checks), []);
});

test('a result the dice agree with carries no flag; a second check takes Roll 2 and joins the same card', () => {
    let { state, entry } = captured(ready([18, 5]), '? check stealth — past the guard | dc: hard | roll: 1 | result: success');
    assert.equal(entry.outcome, 'success');
    assert.equal(entry.mismatch, '');
    ({ state, entry } = captured(state, '? check climbing — up the mill wall | dc: 12 | who: Lyra | roll: 2 | result: fail'));
    const lyra = byName(state, 'Lyra');
    assert.equal(entry.actor, lyra.id);
    assert.equal(entry.stat, 'STR');
    assert.equal(entry.roll, 2);
    assert.equal(entry.die, 5);
    assert.equal(entry.outcome, 'fail');
    assert.equal(entry.mismatch, '');
    assert.deepEqual(state.domains.checks.last.results.map(row => row.name), ['Ren', 'Lyra']);
});

test('F31: a natural 20 always succeeds and a natural 1 always fails, whatever the modifiers and DC', () => {
    const crit = captured(ready([20, 1]), '? check lore — the old song | dc: 40 | roll: 1 | result: success').entry;
    assert.equal(crit.outcome, 'crit');
    assert.equal(crit.mismatch, '');
    const fumble = captured(ready([1, 20]), '? check lore — the old song | dc: 1 | roll: 1 | result: success').entry;
    assert.equal(fumble.outcome, 'critfail');
    assert.equal(fumble.mismatch, 'narrated as success, the dice say critical fail');
});

test('outcomes: at or over the DC succeeds, 1 or 2 short succeeds at a cost, lower fails', () => {
    const outcome = (die, dc) => captured(ready([die, 5]), `? check stealth — x | dc: ${dc} | roll: 1`).entry;
    assert.equal(outcome(13, 15).outcome, 'success');     // 13 + 2 = 15
    assert.equal(outcome(12, 15).outcome, 'cost');
    assert.equal(outcome(11, 15).outcome, 'cost');
    assert.equal(outcome(10, 15).outcome, 'fail');
    // No result written: nothing to disagree with.
    assert.equal(outcome(10, 15).said, null);
    assert.equal(outcome(10, 15).mismatch, '');
});

test('the roll named: "Roll 2", a die value handed over, none, one used already, one never handed', () => {
    const named = written => captured(ready([12, 5]), `? check stealth — x | dc: 10${written === null ? '' : ` | roll: ${written}`}`).entry;
    assert.deepEqual([named('Roll 2').roll, named('Roll 2').die], [2, 5]);
    assert.deepEqual([named('12').roll, named('12').note], [1, ''], 'a die value that was handed over is that roll');
    assert.deepEqual([named(null).roll, named(null).note], [1, 'no roll was named: Roll 1 taken']);
    assert.deepEqual([named('17').roll, named('17').note], [1, '17 is not a roll that was handed over: Roll 1 taken']);
    const first = captured(ready([12, 5]), '? check stealth — x | dc: 10 | roll: 1').state;
    const reused = captured(first, '? check climb — y | dc: 10 | roll: 1').entry;
    assert.deepEqual([reused.roll, reused.die, reused.note], [2, 5, 'Roll 1 was already used: Roll 2 taken']);
});

test('no rolls handed over for the reply: code rolls the d20 itself and says so', () => {
    const out = capture(withParty(), LINE, { dice: [17] });
    assert.ok(out.ok, out.message);
    const entry = logOf(out.state).at(-1);
    assert.deepEqual([entry.roll, entry.die, entry.note], [0, 17, 'no dice were handed over for this reply: code rolled']);
    assert.match(out.result.summary, /: d20 17, DEX \+2 → 19 against 20 \(hard\): success, at a cost\./);
});

test('F32: up to 2 checks per reply; a third is refused (a problem), nothing saved; a swipe is its own reply', () => {
    let state = captured(ready([12, 5]), '? check stealth — one | dc: 10 | roll: 1').state;
    state = captured(state, '? check climb — two | dc: 10 | roll: 2').state;
    const third = capture(state, '? check lore — three | dc: 10');
    assert.equal(third.ok, false);
    assert.equal(third.code, 'REFUSED');
    assert.equal(third.message, 'Only 2 checks count in one reply: lore (three) was not rolled.');
    assert.equal(third.state, state, 'nothing saved');
    // The same reply's swipe (its own carrier key) gets its own two, with its own rolls.
    const swiped = prepared(state, 4, { rolls: [9, 9] });
    const again = captured(swiped, '? check lore — three | dc: 10 | roll: 1', { carrier: { index: 4, swipe: 1 } });
    assert.equal(again.entry.carrier, '4:1');
    assert.equal(again.entry.die, 9);
    assert.deepEqual(again.state.domains.checks.last.results.map(row => row.text.split(':')[0]), ['lore (three)'], 'the swipe\'s card shows its own checks');
});

test('a check line is refused for nobody, a bad difficulty, a bad stat, no character; nothing saved', () => {
    const base = ready();
    for (const [raw, code] of [
        ['? check stealth — sneaking | dc: hard | who: Bram', 'NOT_FOUND'],
        ['? check stealth — sneaking | dc: 99', 'INVALID'],
        ['? check stealth — sneaking | dc: whenever', 'INVALID'],
        ['? check stealth — sneaking | stat: WIS', 'INVALID'],
    ]) {
        const out = capture(base, raw);
        assert.equal(out.ok, false, raw);
        assert.equal(out.code, code, raw);
        assert.equal(out.state, base, 'nothing saved');
    }
    assert.equal(capture(makeState(), LINE).code, 'NOT_FOUND', 'no character yet');
    const stat = captured(base, '? check bluffing — about the seal | stat: luk | roll: 1').entry;
    assert.equal(stat.stat, 'LUK');
    assert.equal(stat.dc, 15, 'no dc: normal');
});

test('the same receipt replays to the same result (no randomness outside the seed)', () => {
    const state = ready([7, 14]);
    const a = capture(state, LINE, { seed: 5 });
    const b = capture(state, LINE, { seed: 5 });
    assert.deepEqual(a.state, b.state);
    assert.deepEqual(a.result, b.result);
});

test('the log keeps the last 30 results', () => {
    let state = withParty();
    for (let reply = 0; reply < 35; reply++) {
        state = prepared(state, reply, { rolls: [10, 10] });
        state = captured(state, '? check stealth — again | dc: 10 | roll: 1', { carrier: { index: reply } }).state;
    }
    assert.equal(logOf(state).length, 30);
    assert.equal(logOf(state)[0].carrier, '5:0');
    assert.deepEqual(part.domains.checks.validate(state.domains.checks), []);
});

test('an older chat\'s pending checks are accepted and dropped by the next checks command', () => {
    const state = withParty();
    state.domains.checks = { pending: [{ id: 'ck_00000001' }], log: [] };
    assert.deepEqual(part.domains.checks.validate(state.domains.checks), []);
    const out = prepared(state, 4);
    assert.equal('pending' in out.domains.checks, false);
    assert.equal(out.domains.checks.last, null);
});

// ---------------------------------------------------------------------------------------
// Which rolls a reply's capture takes

test('preparedFor: the latest rolls for the newest reply, an older reply\'s own when read again', () => {
    const checks = { prepared: [{ for: 2, rolls: [1, 1], rev: 1 }, { for: 4, rolls: [2, 2], rev: 3 }] };
    assert.equal(preparedFor(checks, 4).rev, 3);
    assert.equal(preparedFor(checks, 3).rev, 3, 'a swipe whose type the hook did not hear counted one too many');
    assert.equal(preparedFor(checks, 2).rev, 1, 'an older reply read again');
    assert.equal(preparedFor(checks, 0).rev, 3);
    assert.equal(preparedFor(checks, null).rev, 3);
    assert.equal(preparedFor({ prepared: [] }, 4), null);
    assert.deepEqual(pickRoll(null, '1', [], 1, () => 9), { roll: 0, die: 9, note: 'no dice were handed over for this reply: code rolled' });
    assert.deepEqual(pickRoll({ rolls: [3, 4] }, '2', [1, 2], 3, () => 11), { roll: 0, die: 11, note: 'every roll handed over was used: code rolled' });
});

test('saidOutcome reads the verdict words; a mismatch is a success read as a fail or back', () => {
    assert.equal(saidOutcome('success'), 'success');
    assert.equal(saidOutcome('Success, at a cost'), 'cost');
    assert.equal(saidOutcome('fail'), 'fail');
    assert.equal(saidOutcome('critical success'), 'crit');
    assert.equal(saidOutcome('critical fail'), 'critfail');
    assert.equal(saidOutcome(''), null);
    assert.equal(saidOutcome('who knows'), null);
    assert.equal(mismatchOf('success', 'cost'), '', 'a cost is still a success');
    assert.equal(mismatchOf('cost', 'fail'), 'narrated as success, at a cost, the dice say fail');
    assert.equal(mismatchOf(null, 'fail'), '');
});

// ---------------------------------------------------------------------------------------
// Code's modifiers (the fixed rule, modifiers.js)

test('topics: a check\'s skill word falls under fixed topics; items by their name or tags', () => {
    assert.deepEqual(topicsOf('stealth'), ['stealth']);
    assert.deepEqual(topicsOf('Perception'), ['perception']);
    assert.deepEqual(topicsOf('lockpicking'), ['lock']);
    assert.deepEqual(topicsOf('climbing'), ['climb']);
    assert.deepEqual(topicsOf('resist poison'), ['endurance', 'will']);
    assert.deepEqual(topicsOf('dance'), []);
    assert.deepEqual(itemTopics({ name: 'Hempen Rope' }), ['climb']);
    assert.deepEqual(itemTopics({ name: 'Thieves\' Tools' }), ['lock', 'craft']);
    assert.deepEqual(itemTopics({ name: 'Odd Stone', tags: ['luck'] }), ['luck']);
});

test('modifiers: the stat, +2 a skill in use, +1 a talent by its tags, +1 one item; at most +3 on top', () => {
    const actor = {
        id: 'ac_x', name: 'Ren', stats: { DEX: 9, INT: 5 },
        skills: [{ name: 'Sneak Attack', active: true }, { name: 'Lockpicking', active: true }, { name: 'Stealthy Step', active: false }],
    };
    const member = {
        actor,
        extras: extrasOf({
            actor,
            talents: [{ name: 'Night Owl', tags: ['dark'] }, { name: 'Keen Eyes', tags: ['perception'] }, { name: 'Shadow-born', tags: [] }],
            items: [{ name: 'Rope', kind: 'goods' }, { name: 'Lockpicks', kind: 'goods' }, { name: 'Lantern', kind: 'goods' }, { name: 'Torch', kind: 'goods' }, { name: 'Lockpick Draught', kind: 'consumable' }],
        }),
    };
    assert.deepEqual(member.extras.map(extra => [extra.source, extra.name, extra.topics, extra.amount]), [
        ['skill', 'Lockpicking', ['lock'], 2],
        ['skill', 'Sneak Attack', ['stealth'], 2],
        ['talent', 'Keen Eyes', ['perception'], 1],
        ['talent', 'Night Owl', ['stealth'], 1],
        ['item', 'Lantern', ['perception'], 1],
        ['item', 'Lockpicks', ['lock'], 1],
        ['item', 'Rope', ['climb'], 1],
        ['item', 'Torch', ['perception'], 1],
    ], 'an inactive skill, a talent without a topic and a consumable do not count');
    assert.deepEqual(modifiersFor(member, 'stealth'), [
        { source: 'stat', amount: 2, reason: 'DEX' }, { source: 'skill', amount: 2, reason: 'Sneak Attack' }, { source: 'talent', amount: 1, reason: 'Night Owl' },
    ]);
    assert.deepEqual(modifiersFor(member, 'perception'), [
        { source: 'stat', amount: 0, reason: 'INT' }, { source: 'talent', amount: 1, reason: 'Keen Eyes' }, { source: 'item', amount: 1, reason: 'Lantern' },
    ], 'only one item counts');
    const lots = modifiersFor({ actor, extras: [...member.extras, { source: 'skill', name: 'Picklock Master', topics: ['lock'], amount: 2 }] }, 'pick the lock');
    assert.equal(lots.slice(1).reduce((sum, entry) => sum + entry.amount, 0), EXTRA_CAP, 'capped at +3');
    assert.deepEqual(modifiersFor(member, 'dance'), [{ source: 'stat', amount: 0, reason: 'LUK' }]);
    assert.equal(tableLine(member, { you: true }), 'Ren (you): STR +0, VIT +0, AGI +0, DEX +2, INT +0, LUK +0, CHA +0; +2 lock (Lockpicking), +2 stealth (Sneak Attack), +1 perception (Keen Eyes), +1 stealth (Night Owl), +1 perception (Lantern), +1 lock (Lockpicks), +1 climb (Rope), +1 perception (Torch).');
});

test('capture uses the same rule: a talent from creation, a carried item, a skill', () => {
    const state = withItem(ready([10, 10]), { id: 'rope', name: 'Rope', stack: 'it_rope0001' });
    const ren = pcOf(state);
    ren.origin = { race: null, talents: [{ id: 'rpg-battle/strong-back', name: 'Strong Back' }] };
    ren.skills.push({ name: 'Climbing', level: 1, uses: 0, active: true });
    const queries = { 'creation.content': () => ({ talents: [{ id: 'rpg-battle/strong-back', name: 'Strong Back', tags: ['labour'] }] }) };
    const out = capture(state, '? check climb — up the mill wall | dc: 15 | roll: 1 | result: success', { queries });
    assert.ok(out.ok, out.message);
    const entry = logOf(out.state).at(-1);
    assert.deepEqual(entry.modifiers, [
        { source: 'stat', amount: 1, reason: 'STR' }, { source: 'skill', amount: 2, reason: 'Climbing' },
        { source: 'talent', amount: 1, reason: 'Strong Back' },
    ], 'the +3 cap leaves no room for the rope');
    assert.equal(entry.total, 14);
    assert.equal(entry.outcome, 'cost');
    assert.deepEqual(part.queries['checks.modifiers'](out.state, { skill: 'climb' }, toolsFor(out.state, queries)), entry.modifiers, 'the query gives what capture used');
    assert.ok(tail(viewOf(out.state, { queries })).lines.some(text => text.includes('+2 climb (Climbing), +1 climb/strength (Strong Back), +1 climb (Rope)')));
});

// ---------------------------------------------------------------------------------------
// The prompt: static, tail, beforeGenerate

test('the static instruction is byte-identical whatever the state, and says the whole rule', () => {
    const empty = part.context.static();
    captured(ready());
    assert.equal(part.context.static(), empty);
    assert.equal(empty, STATIC_TEXT);
    for (const words of ['Roll 1', 'Roll 2', 'at most two per reply', 'natural 20 always succeeds', 'natural 1 always fails', 'in this same reply', '? check <skill> — <what> | dc: … | roll: <1 or 2> | result: success|cost|fail']) {
        assert.ok(STATIC_TEXT.includes(words), words);
    }
    assert.doesNotMatch(STATIC_TEXT, /Ren|Lyra/);
    assert.match(part.kinds.check.grammar, /^\? check <skill or stat> — what is attempted \| dc: .* \| roll: .* \| result: /);
});

test('the tail: this reply\'s rolls tied to attempts, then code\'s table, one line per member', () => {
    assert.deepEqual(tail(viewOf(makeState())), { lines: [], optional: [] }, 'nothing before a character exists');
    const { lines } = tail(viewOf(ready([12, 5])));
    assert.deepEqual(lines, [
        'Dice for this reply: Roll 1 = 12 · Roll 2 = 5 (the first uncertain attempt takes Roll 1, the next Roll 2, whatever they say).',
        'Check modifiers — Ren (you): STR +1, VIT +1, AGI +1, DEX +2, INT +0, LUK +0, CHA +0.',
        'Check modifiers — Lyra: STR +0, VIT +0, AGI +2, DEX +3, INT +0, LUK +0, CHA +0.',
    ]);
    assert.ok(lines.join(' ').length / 4 < part.context.budget, 'within the budget');
});

test('beforeGenerate: one checks.prepare per reply, for the index about to be written', () => {
    const state = withParty();
    const view = (s = state) => viewOf(s, { chat: { length: 5 } });
    assert.deepEqual(beforeGenerate(view()), { commands: [{ type: 'checks.prepare', payload: { for: 5 } }] });
    assert.deepEqual(beforeGenerate(view(), { type: 'regenerate' }), { commands: [{ type: 'checks.prepare', payload: { for: 5 } }] });
    assert.deepEqual(beforeGenerate(view(), { type: 'swipe' }), { commands: [{ type: 'checks.prepare', payload: { for: 4 } }] });
    // A Continue keeps the rolls its reply has.
    assert.deepEqual(beforeGenerate(view(ready()), { type: 'continue' }), { commands: [] });
    assert.deepEqual(beforeGenerate(view(), { type: 'continue' }), { commands: [{ type: 'checks.prepare', payload: { for: 4 } }] });
    assert.deepEqual(beforeGenerate({ state }), { commands: [{ type: 'checks.prepare', payload: { for: null } }] });
});

// ---------------------------------------------------------------------------------------
// Validator and queries

test('the validator refuses malformed checks', () => {
    const good = captured(ready()).state.domains.checks;
    assert.deepEqual(part.domains.checks.validate(part.domains.checks.initial()), []);
    assert.deepEqual(part.domains.checks.validate(good), []);
    const bad = mutate => {
        const slice = structuredClone(good);
        mutate(slice);
        return part.domains.checks.validate(slice);
    };
    assert.ok(bad(s => { s.log = 'x'; }).length);
    assert.ok(bad(s => { s.prepared = {}; }).length);
    assert.ok(bad(s => { s.prepared[0].rolls = [21]; }).length);
    assert.ok(bad(s => { s.prepared.push({ ...s.prepared[0] }); }).length, 'one entry per reply index');
    assert.ok(bad(s => { s.log[0].die = 0; }).length);
    assert.ok(bad(s => { s.log[0].outcome = 'maybe'; }).length);
    assert.ok(bad(s => { s.log[0].roll = 11; }).length);
    assert.ok(bad(s => { s.log[0].modifiers[0].source = 'reader'; }).length);
    assert.ok(bad(s => { s.last = { carrier: '4:0' }; }).length);
    assert.ok(bad(s => { s.last.results = [1, 2, 3]; }).length);
    assert.equal(part.domains.checks.validate(null).length, 1);
});

test('queries: checks.log, checks.rolls, checks.last and the whole table', () => {
    const state = captured(ready([12, 5])).state;
    const tools = toolsFor(state);
    assert.equal(part.queries['checks.log'](state).length, 1);
    assert.deepEqual(part.queries['checks.rolls'](state, {}).rolls, [12, 5]);
    assert.deepEqual(part.queries['checks.rolls'](state, { for: 4 }).rolls, [12, 5]);
    assert.equal(part.queries['checks.last'](state).carrier, '4:0');
    const table = part.queries['checks.modifiers'](state, {}, tools);
    assert.deepEqual(table.map(row => [row.name, row.you, row.stats.DEX]), [['Ren', true, 2], ['Lyra', false, 3]]);
    assert.equal(part.queries['checks.modifiers'](state, { skill: 'x', actor: 'ac_nobody00' }, tools), null);
    assert.deepEqual(Object.keys(part.commands), ['checks.prepare'], 'no reader-rolled or modifier commands any more');
    assert.deepEqual(Object.keys(part.queries).sort(), ['checks.last', 'checks.log', 'checks.modifiers', 'checks.rolls']);
});
