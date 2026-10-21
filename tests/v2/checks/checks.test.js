// The checks part (MODULES §F16): a `? check` line makes a pending check with the automatic stat
// modifier; the reader's modifiers are checked against what the member has; the roll is the
// receipt's (same seed, same result) and read by Story Block's dice rules; beforeGenerate rolls
// what is still waiting; cancel; the static instruction never changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part, STATIC_TEXT, beforeGenerate, tail } from '../../../src/v2/checks/index.js';
import { checkModifier, DEFAULT_RULES } from '../../../src/rules.js';
import { byName, capture, makeState, pcOf, pendingOf, run, toolsFor, withItem, withParty } from './helpers/fake-ctx.js';

const LINE = '? check stealth — slipping past the guard | dc: hard';

function waiting(raw = LINE, options = {}) {
    const out = capture(withParty(), raw, { seed: 7, ...options });
    assert.ok(out.ok, out.message);
    return { state: out.state, check: pendingOf(out.state).at(-1), result: out.result };
}

/** Ren knows Shadow Step (a story-taught skill) and keeps a talent; the pack holds a cloak and a rope. */
function equipped(state) {
    const out = structuredClone(state);
    const ren = pcOf(out);
    ren.skills.push({ name: 'Shadow Step', level: 1, uses: 0, active: true });
    ren.talents = ['Keen Eyes', { name: 'Light Feet' }];
    out.domains.party.custom['Shadow Step'] = { name: 'Shadow Step', type: 'physical', stat: 'DEX', description: 'Slip unseen through the shadows.' };
    let next = withItem(out, { id: 'grey-cloak', name: 'Grey Cloak', note: 'good for slipping by unseen', stack: 'it_cloak001' });
    next = withItem(next, { id: 'rope', name: 'Rope', stack: 'it_rope0001' });
    next = withItem(next, { id: 'lute', name: 'Lute', owner: byName(next, 'Lyra').id, note: 'for slipping a tune past a guard', stack: 'it_lute0001' });
    return next;
}

// ---------------------------------------------------------------------------------------
// The pending check

test('a check line makes a pending check, nothing rolled, with the stat modifier', () => {
    const { state, check, result } = waiting();
    const ren = pcOf(state);
    const mod = checkModifier(ren.stats.DEX, DEFAULT_RULES);
    assert.equal(pendingOf(state).length, 1);
    assert.match(check.id, /^ck_[0-9a-z]{8}$/);
    assert.deepEqual({ ...check, id: 'x' }, {
        id: 'x', actor: ren.id, skill: 'stealth', stat: 'DEX', dc: 20, word: 'hard', what: 'slipping past the guard', rev: 3,
        modifiers: [{ source: 'stat', amount: mod, reason: 'DEX' }],
    });
    assert.equal(mod, 2, 'DEX 9 gives +2 by v1 rules');
    assert.equal(result.narrate, false, 'nothing has happened yet');
    assert.equal(result.summary, 'Ren must check stealth (slipping past the guard) against 20 (hard): DEX +2 so far, waiting for the roll.');
    assert.deepEqual(state.domains.checks.log, []);
    assert.deepEqual(part.domains.checks.validate(state.domains.checks), []);
});

test('who, a named stat, a number and a missing difficulty', () => {
    const lyra = waiting('? check climbing — up the mill wall | dc: 12 | who: Lyra');
    assert.equal(lyra.check.actor, byName(lyra.state, 'Lyra').id);
    assert.equal(lyra.check.stat, 'STR');
    assert.equal(lyra.check.dc, 12);
    assert.equal(lyra.check.word, '');
    const stat = waiting('? check INT — recalling the old song | dc: easy');
    assert.equal(stat.check.stat, 'INT');
    assert.equal(stat.check.dc, 10);
    const labelled = waiting('? check bluffing — about the seal | stat: luk');
    assert.equal(labelled.check.stat, 'LUK');
    assert.equal(labelled.check.dc, 15, 'no dc: normal');
    assert.equal(labelled.check.modifiers[0].amount, checkModifier(pcOf(labelled.state).stats.LUK, DEFAULT_RULES));
});

test('a check line is refused for nobody, a bad difficulty, a bad stat, no character', () => {
    const base = withParty();
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
});

// ---------------------------------------------------------------------------------------
// Modifiers

test('modifiers: a skill, an ability, an item carried, a custom reason', () => {
    let { state, check } = waiting();
    state = equipped(state);
    const add = payload => {
        const out = run(state, 'check.addModifier', { id: check.id, ...payload });
        assert.ok(out.ok, out.message);
        assert.equal(out.result.narrate, false);
        state = out.state;
        return out;
    };
    assert.equal(add({ source: 'skill', amount: 2, reason: 'shadow step' }).result.summary, 'Shadow Step +2 on Ren\'s stealth (slipping past the guard) check (now + 4).');
    add({ source: 'ability', amount: 1, reason: 'Light Feet' });
    add({ source: 'item', amount: 1, stack: 'it_cloak001', reason: 'ignored when the stack is given' });
    add({ source: 'item', amount: -1, reason: 'Rope' });
    add({ source: 'custom', amount: -2, reason: 'wet boots' });
    assert.deepEqual(pendingOf(state)[0].modifiers, [
        { source: 'stat', amount: 2, reason: 'DEX' },
        { source: 'skill', amount: 2, reason: 'Shadow Step' },
        { source: 'ability', amount: 1, reason: 'Light Feet' },
        { source: 'item', amount: 1, reason: 'Grey Cloak' },
        { source: 'item', amount: -1, reason: 'Rope' },
        { source: 'custom', amount: -2, reason: 'wet boots' },
    ]);
    assert.deepEqual(part.domains.checks.validate(state.domains.checks), []);
});

test('modifiers are refused for what the member does not have, bad amounts and repeats', () => {
    const first = waiting();
    const state = equipped(first.state);
    const id = first.check.id;
    const cases = [
        [{ source: 'skill', amount: 2, reason: 'Fireball' }, 'REFUSED'],
        [{ source: 'skill', amount: 2 }, 'INVALID'],
        [{ source: 'ability', amount: 2, reason: 'Night Vision' }, 'REFUSED'],
        [{ source: 'item', amount: 2, reason: 'Lantern' }, 'REFUSED'],
        [{ source: 'item', amount: 2, reason: 'Lute' }, 'REFUSED'],               // Lyra's, not Ren's
        [{ source: 'item', amount: 2, stack: 'it_lute0001' }, 'REFUSED'],
        [{ source: 'custom', amount: 2, reason: '  ' }, 'INVALID'],
        [{ source: 'stat', amount: 2, reason: 'STR' }, 'REFUSED'],
        [{ source: 'luck', amount: 2, reason: 'x' }, 'INVALID'],
        [{ source: 'custom', amount: 11, reason: 'too much' }, 'INVALID'],
        [{ source: 'custom', amount: -11, reason: 'too little' }, 'INVALID'],
        [{ source: 'custom', amount: 1.5, reason: 'half' }, 'INVALID'],
        [{ source: 'custom', amount: '2', reason: 'text' }, 'INVALID'],
        [{ source: 'custom', amount: 0, reason: 'nothing' }, 'INVALID'],
    ];
    for (const [payload, code] of cases) {
        const out = run(state, 'check.addModifier', { id, ...payload });
        assert.equal(out.ok, false, JSON.stringify(payload));
        assert.equal(out.code, code, JSON.stringify(payload));
        assert.equal(out.state, state, 'nothing saved');
    }
    assert.equal(run(state, 'check.addModifier', { id: 'ck_00000000', source: 'custom', amount: 1, reason: 'x' }).code, 'NOT_FOUND');
    const once = run(state, 'check.addModifier', { id, source: 'skill', amount: 2, reason: 'Shadow Step' }).state;
    assert.equal(run(once, 'check.addModifier', { id, source: 'skill', amount: 3, reason: 'SHADOW STEP' }).code, 'REFUSED', 'counts once');
    let full = state;
    for (let n = 1; n <= 8; n++) full = run(full, 'check.addModifier', { id, source: 'custom', amount: 1, reason: `reason ${n}` }).state;
    assert.equal(run(full, 'check.addModifier', { id, source: 'custom', amount: 1, reason: 'one more' }).code, 'REFUSED', 'at most 8 added');
});

test('removeModifier takes the reader\'s back, never the stat', () => {
    const { state: start, check } = waiting();
    let state = run(start, 'check.addModifier', { id: check.id, source: 'custom', amount: 3, reason: 'a distraction' }).state;
    state = run(state, 'check.addModifier', { id: check.id, source: 'custom', amount: -1, reason: 'the moon' }).state;
    const byIndex = run(state, 'check.removeModifier', { id: check.id, index: 1 });
    assert.ok(byIndex.ok, byIndex.message);
    assert.deepEqual(pendingOf(byIndex.state)[0].modifiers.map(entry => entry.reason), ['DEX', 'the moon']);
    const byName = run(state, 'check.removeModifier', { id: check.id, source: 'custom', reason: 'The Moon' });
    assert.deepEqual(pendingOf(byName.state)[0].modifiers.map(entry => entry.reason), ['DEX', 'a distraction']);
    assert.equal(run(state, 'check.removeModifier', { id: check.id, index: 0 }).code, 'REFUSED');
    assert.equal(run(state, 'check.removeModifier', { id: check.id, index: 7 }).code, 'NOT_FOUND');
    assert.equal(run(state, 'check.removeModifier', { id: check.id, index: 'one' }).code, 'INVALID');
    assert.equal(run(state, 'check.removeModifier', { id: 'ck_00000000', index: 1 }).code, 'NOT_FOUND');
});

// ---------------------------------------------------------------------------------------
// The roll

test('a roll is the same for the same seed and moves the check to the log', () => {
    const { state, check } = waiting();
    const a = run(state, 'check.roll', { id: check.id }, { seed: 42 });
    const b = run(state, 'check.roll', { id: check.id }, { seed: 42 });
    assert.ok(a.ok, a.message);
    assert.deepEqual(a.result, b.result);
    assert.deepEqual(a.state, b.state);
    assert.equal(a.result.narrate, true);
    assert.deepEqual(pendingOf(a.state), []);
    const entry = a.state.domains.checks.log[0];
    assert.equal(entry.id, check.id);
    assert.equal(entry.total, entry.die + 2);
    assert.equal(a.result.summary, `Ren tries stealth (slipping past the guard): d20 ${entry.die} + 2 DEX = ${entry.total} against 20 (hard), ${({ crit: 'critical success', success: 'success', cost: 'success, at a cost', fail: 'fail', critfail: 'critical fail' })[entry.outcome]}.`);
    const dice = new Set();
    for (let seed = 1; seed <= 60; seed++) dice.add(run(state, 'check.roll', { id: check.id }, { seed }).result.data.die);
    assert.ok(dice.size > 10, 'different seeds roll differently');
    assert.equal(run(a.state, 'check.roll', { id: check.id }).code, 'NOT_FOUND', 'rolled once');
    assert.deepEqual(part.domains.checks.validate(a.state.domains.checks), []);
});

test('outcomes: natural 20, natural 1, at or over the DC, DC−1 and DC−2, lower', () => {
    const { state: start, check } = waiting();            // DC 20, DEX +2
    const state = run(start, 'check.addModifier', { id: check.id, source: 'custom', amount: 3, reason: 'a distraction' }).state;   // +5 in all
    const table = [
        [20, 'crit', 'critical success'],
        [1, 'critfail', 'critical fail'],
        [15, 'success', 'success'],
        [19, 'success', 'success'],
        [14, 'cost', 'success, at a cost'],
        [13, 'cost', 'success, at a cost'],
        [12, 'fail', 'fail'],
        [2, 'fail', 'fail'],
    ];
    for (const [die, outcome, words] of table) {
        const out = run(state, 'check.roll', { id: check.id }, { dice: [die] });
        assert.equal(out.result.data.outcome, outcome, `d20 ${die}`);
        assert.equal(out.result.data.total, die + 5);
        assert.equal(out.result.summary, `Ren tries stealth (slipping past the guard): d20 ${die} + 2 DEX + 3 a distraction = ${die + 5} against 20 (hard), ${words}.`);
    }
    const minus = run(start, 'check.addModifier', { id: check.id, source: 'custom', amount: -4, reason: 'mud' }).state;
    assert.match(run(minus, 'check.roll', { id: check.id }, { dice: [10] }).result.summary, /d20 10 \+ 2 DEX − 4 mud = 8 against 20 \(hard\), fail\.$/);
});

test('the log keeps the last 30 results', () => {
    let state = withParty();
    const ids = [];
    for (let n = 0; n < 33; n++) {
        state = capture(state, '? check luck — a coin toss | dc: 10', { seed: 100 + n }).state;
        const id = pendingOf(state)[0].id;
        ids.push(id);
        state = run(state, 'check.roll', { id }, { seed: n + 1 }).state;
    }
    assert.equal(state.domains.checks.log.length, 30);
    assert.deepEqual(state.domains.checks.log.map(entry => entry.id), ids.slice(3));
    assert.deepEqual(part.domains.checks.validate(state.domains.checks), []);
});

test('a check whose member left cannot be rolled; cancel calls it off', () => {
    const { state, check } = waiting('? check climbing — up the wall | who: Lyra');
    const gone = structuredClone(state);
    delete gone.domains.party.actors[check.actor];
    gone.domains.party.order = gone.domains.party.order.filter(id => id !== check.actor);
    assert.equal(run(gone, 'check.roll', { id: check.id }).code, 'NOT_FOUND');
    const cancelled = run(state, 'check.cancel', { id: check.id });
    assert.ok(cancelled.ok, cancelled.message);
    assert.deepEqual(pendingOf(cancelled.state), []);
    assert.deepEqual(cancelled.state.domains.checks.log, [], 'a cancelled check is not a result');
    assert.equal(cancelled.result.summary, 'Lyra does not try climbing (up the wall) after all.');
    assert.equal(cancelled.result.narrate, true);
    assert.equal(run(cancelled.state, 'check.cancel', { id: check.id }).code, 'NOT_FOUND');
    assert.ok(run(gone, 'check.cancel', { id: check.id }).ok, 'a check of someone gone can still be called off');
});

// ---------------------------------------------------------------------------------------
// beforeGenerate, the prompt, the validator

test('beforeGenerate rolls every waiting check with what it has', () => {
    assert.deepEqual(beforeGenerate({ state: withParty() }), { commands: [] });
    let { state } = waiting();
    state = capture(state, '? check climbing — up the wall | who: Lyra', { seed: 9 }).state;
    const [first, second] = pendingOf(state);
    const out = beforeGenerate({ state, query: (name, args) => toolsFor(state).query(name, args) });
    assert.deepEqual(out, { commands: [{ type: 'check.roll', payload: { id: first.id } }, { type: 'check.roll', payload: { id: second.id } }] });
    for (const command of out.commands) state = run(state, command.type, command.payload).state;
    assert.deepEqual(pendingOf(state), []);
    assert.equal(state.domains.checks.log.length, 2);
    assert.deepEqual(beforeGenerate({ state }), { commands: [] });
});

test('beforeGenerate calls off a check whose member left', () => {
    const { state, check } = waiting('? check climbing — up the wall | who: Lyra');
    const gone = structuredClone(state);
    delete gone.domains.party.actors[check.actor];
    assert.deepEqual(beforeGenerate({ state: gone }), { commands: [{ type: 'check.cancel', payload: { id: check.id } }] });
});

test('the static instruction is byte-identical whatever the state', () => {
    const expected = 'Any action whose outcome is uncertain (sneaking, climbing, persuading, searching, picking a lock, resisting) gets a `? check` line, and the reply stops before the outcome: never tell whether it works. The reader rolls it, and the next reply is told the result in a [Happened] line.';
    assert.equal(STATIC_TEXT, expected);
    assert.equal(part.context.static(), expected);
    const { state } = waiting();
    assert.equal(part.context.static({ state }), part.context.static({ state: makeState() }));
    assert.equal(part.kinds.check.grammar, '? check <skill or stat> — what is attempted | dc: easy|normal|hard|<number> | who: Name');
    assert.doesNotMatch(expected, /\d/, 'no numbers');
});

test('the tail has one line per waiting check', () => {
    assert.deepEqual(tail({ state: withParty() }), { lines: [], optional: [] });
    let { state, check } = waiting();
    state = run(state, 'check.addModifier', { id: check.id, source: 'custom', amount: -3, reason: 'the dogs' }).state;
    state = capture(state, '? check climbing — up the wall | who: Lyra | dc: 12', { seed: 3 }).state;
    const lyra = byName(state, 'Lyra');
    const mod = checkModifier(lyra.stats.STR, DEFAULT_RULES);
    assert.deepEqual(tail({ state }).lines, [
        'Check waiting: Ren — stealth (slipping past the guard) against 20 (hard), d20 − 1 (DEX +2, the dogs −3); the reader rolls it, do not write it again.',
        `Check waiting: Lyra — climbing (up the wall) against 12, d20 ${mod < 0 ? `− ${-mod}` : `+ ${mod}`} (STR ${mod < 0 ? `−${-mod}` : `+${mod}`}); the reader rolls it, do not write it again.`,
    ]);
    assert.equal(part.context.budget > 0, true);
});

test('the validator refuses malformed checks', () => {
    const { state, check } = waiting();
    const bad = mutate => {
        const slice = structuredClone(state.domains.checks);
        mutate(slice);
        return part.domains.checks.validate(slice);
    };
    assert.deepEqual(part.domains.checks.validate(part.domains.checks.initial()), []);
    assert.ok(bad(s => { s.pending[0].id = 'nope'; }).length);
    assert.ok(bad(s => { s.pending[0].dc = 0; }).length);
    assert.ok(bad(s => { s.pending[0].stat = 'WIS'; }).length);
    assert.ok(bad(s => { s.pending[0].modifiers.push({ source: 'custom', amount: 12, reason: 'x' }); }).length);
    assert.ok(bad(s => { s.pending[0].modifiers.push({ source: 'custom', amount: 1, reason: '' }); }).length);
    assert.ok(bad(s => { s.pending.push(structuredClone(s.pending[0])); }).length, 'an id twice');
    assert.ok(bad(s => { s.log.push({ ...s.pending[0], die: 21, mod: 0, total: 21, outcome: 'success' }); }).length);
    assert.ok(bad(s => { s.log = Array.from({ length: 31 }, () => ({ ...s.pending[0], die: 5, mod: 0, total: 5, outcome: 'fail' })); }).length);
    assert.ok(bad(s => { s.pending = 'none'; }).length);
    assert.equal(check.modifiers.length, 1);
});

// ---------------------------------------------------------------------------------------
// Suggestions

test('suggest: the member\'s skills, abilities and items that share words with the check', () => {
    const first = waiting();
    let state = equipped(first.state);
    const tools = toolsFor(state);
    const query = (name, args) => tools.query(name, args);
    assert.deepEqual(query('checks.suggest', { id: first.check.id }), [
        { source: 'skill', name: 'Shadow Step', words: ['slip'] },
        { source: 'item', name: 'Grey Cloak', words: ['slip'], stack: 'it_cloak001' },
    ]);
    state = run(state, 'check.addModifier', { id: first.check.id, source: 'skill', amount: 2, reason: 'Shadow Step' }).state;
    assert.deepEqual(toolsFor(state).query('checks.suggest', { id: first.check.id }).map(entry => entry.name), ['Grey Cloak'], 'what already counts is not suggested');
    assert.deepEqual(toolsFor(state).query('checks.suggest', { id: 'ck_00000000' }), []);
    assert.deepEqual(toolsFor(state).query('checks.pending', {}), pendingOf(state));
    assert.deepEqual(toolsFor(state).query('checks.log', {}), []);
});
