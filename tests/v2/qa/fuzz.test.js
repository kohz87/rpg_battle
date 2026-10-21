// QA: seeded fuzz, on each host. 500 sequences × 30 random commands and change lines (valid and invalid
// payloads: wrong ids, 0, −1, 1.5, NaN, Infinity, "2", 1e9, null…) through the real bus. After
// every step:
//   * a rejection leaves the state byte-identical, with a coded plain-sentence message, and no
//     handler ever throws (no FAILED);
//   * a commit bumps meta.rev by one and commits no NaN, negative or fractional number in the
//     inventory, party or trade, and no fight or offer counts that are not whole;
//   * conservation: goods and money change only by a command that says so, by exactly what its
//     receipt says (a sale's total, a purchase's total, a fee, a fight's loot, a coin line's
//     amount, one dose), and every new stack names the receipt that made it.
// Then: the same seeds give the same states (determinism).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytes, each, holdings } from './helpers/harness.js';
import { apply } from './vendor/src/v2/ops.js';
import { committedNumbers, conservationProblem, hash, newStacksWithoutCause } from './helpers/invariants.js';
import { runSequence } from './helpers/fuzz.js';

const SEQUENCES = 500;
const STEPS = 30;

each(`fuzz: ${SEQUENCES} seeded sequences × ${STEPS} steps keep every invariant`, () => {
    const problems = [];
    const tally = { committed: 0, rejected: 0, byType: {} };
    const finals = [];
    const note = (seed, n, type, text) => { if (problems.length < 40) problems.push(`seed ${seed} step ${n} ${type}: ${text}`); };
    for (let seed = 0; seed < SEQUENCES; seed++) {
        const h = runSequence(seed, STEPS, step => {
            const { type, result, before, after, n } = step;
            const t = (tally.byType[type] ??= { ok: 0, no: 0 });
            if (!result.ok) {
                tally.rejected += 1;
                t.no += 1;
                if (bytes(after) !== bytes(before)) note(seed, n, type, 'a rejection changed the state');
                if (result.code === 'FAILED') note(seed, n, type, `a handler threw: ${result.message}`);
                if (typeof result.message !== 'string' || !result.message || /undefined|\[object|NaN/.test(result.message)) note(seed, n, type, `message "${result.message}"`);
                return;
            }
            tally.committed += 1;
            t.ok += 1;
            if (after.meta.rev !== before.meta.rev + 1) note(seed, n, type, `rev ${before.meta.rev} → ${after.meta.rev}`);
            for (const [path, value] of committedNumbers(after).slice(0, 3)) note(seed, n, type, `committed ${path} = ${value}`);
            const leak = conservationProblem(step);
            if (leak) note(seed, n, type, leak);
            for (const text of newStacksWithoutCause(step)) note(seed, n, type, `a new stack without this receipt as its cause: ${text}`);
            if (/NaN|undefined|\[object/.test(result.receipt.summary)) note(seed, n, type, `summary "${result.receipt.summary}"`);
        });
        finals.push(hash(h.state()));
    }
    // Enough of each kind of step actually committed for the run to mean something.
    for (const type of ['item.use', 'item.equip', 'item.give', 'trade.sell', 'trade.buy', 'combat.start', 'combat.act', 'combat.end', 'capture.encounter', 'capture.item', 'capture.coin', 'party.rest']) {
        assert.ok((tally.byType[type]?.ok ?? 0) > 5, `${type} committed only ${tally.byType[type]?.ok ?? 0} times: ${JSON.stringify(tally.byType[type])}`);
    }
    assert.ok(tally.rejected > 1000, `invalid payloads were tried (${tally.rejected} rejections)`);
    assert.deepEqual(problems, []);

    // Determinism: the same seeds again give byte-identical states.
    for (let seed = 0; seed < 60; seed++) {
        const again = runSequence(seed, STEPS, () => {});
        assert.equal(hash(again.state()), finals[seed], `seed ${seed} replayed differently`);
    }
});

test('the fuzz checks themselves catch a leak, a wrong total, a new stack without its cause and a bad number', () => {
    const state = (stacks, coin = 0, extra = {}) => ({
        v: 2, meta: { rev: 1, claims: {} },
        domains: {
            inventory: { defs: { 'story/rope': { id: 'story/rope', name: 'Rope' } }, stacks, wallets: { party: { coin } }, aliases: {} },
            party: { pc: null, order: [], actors: {}, custom: {}, offers: [] }, trade: { orders: {}, shops: {} },
            combat: { offers: [], session: null, beaten: [], last: null }, bestiary: { creatures: {} }, ...extra,
        },
    });
    const rope = (qty, from = 'rc_00000001') => ({ it_00000001: { id: 'it_00000001', def: 'story/rope', qty, owner: 'party', equipped: null, note: '', from } });
    const receipt = (data, id = 'rc_00000002') => ({ ok: true, receipt: { id, data, summary: '' } });
    // A command that should move nothing, but money appeared.
    assert.notEqual(conservationProblem({ type: 'party.rest', result: receipt({}), before: state({}, 5), after: state({}, 6) }), '');
    // A sale paid one more than its receipt says.
    assert.notEqual(conservationProblem({ type: 'trade.sell', result: receipt({ def: 'story/rope', qty: 1, total: 3 }), before: state(rope(2), 0), after: state(rope(1), 4) }), '');
    assert.equal(conservationProblem({ type: 'trade.sell', result: receipt({ def: 'story/rope', qty: 1, total: 3 }), before: state(rope(2), 0), after: state(rope(1), 3) }), '');
    // A fight's loot that is not in the receipt.
    assert.notEqual(conservationProblem({ type: 'combat.end', result: receipt({ loot: { money: 0, items: [] } }), before: state({}), after: state(rope(1)) }), '');
    // A new stack that names another receipt.
    assert.equal(newStacksWithoutCause({ result: receipt({}), before: state({}), after: state(rope(1, 'rc_99999999')) }).length, 1);
    // Fractions, negatives and NaN are reported.
    assert.equal(committedNumbers(state(rope(1.5))).length, 1);
    assert.equal(committedNumbers(state({}, -2)).length, 1);
    assert.ok(committedNumbers(state({}, Number.NaN)).length >= 1);
    void bytes;
});

// ---------- properties that do not hold yet (todo) ----------

const SMALL = 200;

each(`fuzz (${SMALL} sequences): every receipt that moves money names the amount in the one currency`, () => {
    const bad = [];
    for (let seed = 0; seed < SMALL && bad.length < 5; seed++) {
        runSequence(seed, STEPS, ({ type, result, before, after }) => {
            if (!result.ok) return;
            const moved = Math.abs(holdings(after).money - holdings(before).money);
            const summary = result.receipt.summary;
            if (!moved) return;
            if (/\d\s*(?:copper|silver|gold)\b/i.test(summary) || !new RegExp(`\\b${moved} crowns?\\b`).test(summary)) bad.push(`${type} (${moved} moved): ${summary.slice(0, 200)}`);
        }, { coreSettings: { currency: 'crowns' } });
    }
    assert.deepEqual(bad, []);
});

each(`fuzz (${SMALL} sequences): no stack or wallet ever belongs to someone who is not in the party`, { todo: 'party.removeCompanion / party.create replace leave the actor\'s stacks and wallet behind (see conservation.test.js)' }, () => {
    const bad = [];
    for (let seed = 0; seed < SMALL && bad.length < 5; seed++) {
        runSequence(seed, STEPS, ({ type, result, after, n }) => {
            if (!result.ok) return;
            const actors = after.domains.party.actors;
            const inv = after.domains.inventory;
            for (const stack of Object.values(inv.stacks)) if (stack.owner !== 'party' && !actors[stack.owner]) bad.push(`seed ${seed} step ${n} ${type}: stack ${stack.id} (${inv.defs[stack.def].name} ×${stack.qty}) owned by ${stack.owner}`);
            for (const owner of Object.keys(inv.wallets)) if (owner !== 'party' && !actors[owner]) bad.push(`seed ${seed} step ${n} ${type}: wallet of ${owner}`);
        });
    }
    assert.deepEqual(bad.slice(0, 5), []);
});

each(`fuzz (${SMALL} sequences): a finished fight can always be settled (combat.end never sticks)`, { todo: 'combat.end fails with NOT_FOUND for good once a stack the fight used was sold, used or given away meanwhile (see conservation.test.js)' }, () => {
    const bad = [];
    for (let seed = 0; seed < SMALL && bad.length < 5; seed++) {
        runSequence(seed, STEPS, ({ type, after, h, n }) => {
            const session = after.domains.combat.session;
            if (!session || session.status === 'active') return;
            const tried = h.preview('combat.end', {});
            if (!tried.ok) bad.push(`seed ${seed} step ${n} after ${type}: ${tried.code} ${tried.message}`);
        });
    }
    assert.deepEqual(bad.slice(0, 5), []);
});

each('replay equals rebuild: every sequence\'s ops, applied to the initial state, give the head again', () => {
    for (let seed = 0; seed < 40; seed++) {
        const h = runSequence(seed, STEPS, () => {});
        let state = h.registry.initialState();
        for (const entry of h.store.log) state = apply(state, entry.ops);
        assert.equal(bytes(state), bytes(h.state()), `seed ${seed}`);
        assert.equal(state.meta.rev, h.store.log.length, 'one rev per receipt');
    }
});
