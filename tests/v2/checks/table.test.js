// The ready-made check table (src/v2/checks/table.js), the default since the user's decision after the
// beta.1 live test: two dice per member per reply, the results worked out in advance with code's modifiers;
// the capture works a check out again from the same die and modifiers, so the table, the record and the
// mismatch flag agree; at most two checks per reply; Story Block's pre-roll (strict mode) takes the 1st.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part, STATIC_TEXT, tail } from '../../../src/v2/checks/index.js';
import { cell, dieText, rowsFor, diceOf } from '../../../src/v2/checks/table.js';
import { memberOf, rulesFor } from '../../../src/v2/checks/modifiers.js';
import { byName, capture, logOf, pcOf, prepared, viewOf, withParty } from './helpers/fake-ctx.js';
import { preparedEntries } from '../../../src/v2/checks/shared.js';

const TIER_DC = { E: 10, N: 15, H: 20, V: 25 };
const WORD = { E: 'easy', N: 'normal', H: 'hard', V: 'very hard' };
const KIND = { crit: 'success', success: 'success', cost: 'cost', fail: 'fail', critfail: 'fail' };

/** What a cell says for a tier: 'success' | 'cost' | 'fail'. */
function reads(text, tier) {
    if (text === '★') return 'success';
    if (text === '✗!' || text === '✗') return 'fail';
    const [best, cost] = text.startsWith('~') ? [null, text.slice(1)] : text.split('~');
    const order = ['E', 'N', 'H', 'V'];
    if (best && order.indexOf(tier) <= order.indexOf(best)) return 'success';
    return cost === tier ? 'cost' : 'fail';
}

/** Ren and Lyra with the table's dice forced: Ren 1st/2nd, Lyra 1st/2nd. */
const table = (rolls = [9, 14, 4, 17]) => prepared(withParty(), 4, { rolls, table: true });

test('cell: the hardest difficulty reached, ~ for 1–2 short, ✗ below, ★ a natural 20, ✗! a natural 1', () => {
    assert.equal(cell(10, 18), 'N~H');
    assert.equal(cell(10, 17), 'N');
    assert.equal(cell(10, 15), 'N');
    assert.equal(cell(10, 25), 'V');
    assert.equal(cell(10, 30), 'V');
    assert.equal(cell(5, 8), '~E');
    assert.equal(cell(5, 7), '✗');
    assert.equal(cell(20, 3), '★');
    assert.equal(cell(1, 40), '✗!');
    assert.equal(dieText(20, [{ label: 'STR', mod: 0 }]), 'all ★');
    assert.equal(dieText(1, [{ label: 'STR', mod: 9 }]), 'all ✗!');
    assert.equal(dieText(10, [{ label: 'STR', mod: 0 }, { label: 'AGI', mod: 8 }, { label: 'DEX', mod: 0 }]), 'AGI N~H · STR DEX E');
});

test('the tail: your character\'s table line always, the companions\' as room allows; within the budget; the same state, the same table', () => {
    const state = table();
    const view = viewOf(state);
    const { lines, optional } = tail(view);
    const [ren, lyra] = [pcOf(state), byName(state, 'Lyra')];
    assert.deepEqual(diceOf(preparedEntries(state.domains.checks).at(-1), ren.id), [9, 14]);
    assert.deepEqual(diceOf(preparedEntries(state.domains.checks).at(-1), lyra.id), [4, 17]);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^Checks — Ren \(you\) 1st: .+ \| 2nd: .+$/);
    assert.match(optional[0], /^Checks — Lyra 1st: .+ \| 2nd: .+$/);
    // Ren: STR +1 VIT +1 AGI +1 DEX +2 INT +0 LUK +0 CHA +0, die 9: DEX 11 → E, the +1s 10 → E, the +0s 9 → ~E.
    assert.equal(lines[0].split(' | ')[0], 'Checks — Ren (you) 1st: STR VIT AGI DEX E · INT LUK CHA ~E');
    // About 50–80 tokens for a member (four characters a token).
    for (const line of [...lines, ...optional]) assert.ok(line.length / 4 <= 80, `${line.length / 4} tokens: ${line}`);
    assert.ok([...lines, ...optional].join('\n').length / 4 < part.context.budget, 'within the checks part\'s budget');
    assert.deepEqual(tail(viewOf(state)), { lines, optional }, 'deterministic');
    // No raw dice in the tail any more.
    assert.doesNotMatch([...lines, ...optional].join(' '), /Roll 1|Dice for this reply/);
});

test('the capture reads the same table: every row and tier of the 1st column gives the result the cell says', () => {
    const state = table([9, 14, 4, 17]);
    const ren = pcOf(state);
    const rows = rowsFor(memberOf(name => viewOf(state).query(name), ren, {}), rulesFor(null));
    for (const row of rows) {
        const text = cell(9, 9 + row.mod);
        for (const tier of ['E', 'N', 'H', 'V']) {
            const out = capture(state, `? check ${row.skill} — x | dc: ${WORD[tier]}`);
            assert.ok(out.ok, out.message);
            const entry = logOf(out.state).at(-1);
            assert.equal(entry.die, 9, 'the actor\'s 1st die');
            assert.equal(entry.place, 1);
            assert.equal(entry.dc, TIER_DC[tier]);
            assert.equal(KIND[entry.outcome], reads(text, tier), `${row.label} ${tier}: the table said ${text}, the record ${entry.outcome}`);
        }
    }
});

test('the 2nd attempt reads the acting member\'s 2nd column; a third check is refused; a companion uses their own dice', () => {
    let out = capture(table([9, 14, 4, 17]), '? check stealth — past the gate | dc: normal | result: fail');
    assert.ok(out.ok, out.message);
    assert.equal(logOf(out.state).at(-1).die, 9);
    out = capture(out.state, '? check climb — up the wall | dc: easy | who: Lyra | result: success');
    assert.ok(out.ok, out.message);
    const second = logOf(out.state).at(-1);
    assert.equal(second.actor, byName(out.state, 'Lyra').id);
    assert.deepEqual([second.die, second.place, second.roll], [17, 2, 4], 'Lyra\'s 2nd die (the 4th rolled)');
    const third = capture(out.state, '? check lore — the runes | dc: easy | result: success');
    assert.equal(third.ok, false);
    assert.equal(third.code, 'REFUSED');
});

test('a written result the table does not give is flagged, and told back as before', () => {
    // Ren, die 4 (1st): DEX 6 → ✗ at hard.
    const out = capture(table([4, 14, 4, 17]), '? check DEX — the ledge | dc: hard | result: success');
    assert.ok(out.ok, out.message);
    const entry = logOf(out.state).at(-1);
    assert.equal(entry.outcome, 'fail');
    assert.equal(entry.mismatch, 'narrated as success, the dice say fail');
    assert.equal(part.queries['checks.view'](out.state)[entry.id].flag, 'Story said success; dice said fail');
    assert.match(part.queries['checks.view'](out.state)[entry.id].text, /d20 4 \(1st\) \+ 2 DEX = 6 vs DC 20 \(hard\) → fail$/);
});

test('strict mode: a check Story Block\'s pre-roll made (a system step) takes the 1st column; the tail names it; the reply\'s own check takes the 2nd', () => {
    const state = table([9, 14, 4, 17]);
    const pre = capture(state, '? check stealth — sneaking past | dc: normal', { cause: 'system', carrier: { index: 2 } });
    assert.ok(pre.ok, pre.message);
    const made = logOf(pre.state).at(-1);
    assert.equal(made.pre, true);
    assert.equal(made.die, 9);
    const { lines } = tail(viewOf(pre.state));
    assert.match(lines[0], /^Check already made for the reader's message: Ren, Stealth \(DEX\) — sneaking past: d20 9 \(1st\) \+ 2 DEX = 11 vs DC 15 \(normal\) → fail\. Narrate that; the next uncertain attempt reads the 2nd column\.$/);
    const own = capture(pre.state, '? check climb — up | dc: easy | result: success');
    assert.ok(own.ok, own.message);
    assert.deepEqual([logOf(own.state).at(-1).die, logOf(own.state).at(-1).place], [14, 2]);
    assert.equal(capture(own.state, '? check lore — x | dc: easy').code, 'REFUSED', 'the pre-rolled one counts toward the two');
});

test('a social row against someone here from NPC State Delta\'s opinion (social), held to ±cap', () => {
    const state = table([10, 14, 4, 17]);
    state.domains.scene = { place: null, present: ['Elula', 'Old Tam', 'Lyra'] };
    const queries = { 'npc.socialModifier': (s, { name }) => (name === 'Elula' ? { mod: -9, name, skill: 'social', reasons: [] } : null) };
    const { lines } = tail(viewOf(state, { queries }));
    // CHA +0 with Elula's −5 (held): 10 − 5 = 5 → ✗.
    assert.match(lines[0], /vs Elula ✗/);
    assert.doesNotMatch(lines[0], /Old Tam|vs Lyra/, 'no opinion, no row; party members are not asked');
    const off = tail(viewOf(state, { queries, settings: { outsideCap: 0 } }));
    assert.doesNotMatch(off.lines[0], /vs Elula/, 'the cap at 0 turns them off');
});

test('the static instruction says the table, byte-identical', () => {
    assert.equal(part.context.static(), STATIC_TEXT);
    assert.equal(part.context.static(), part.context.static());
    assert.ok(STATIC_TEXT.length / 4 < 300);
});
