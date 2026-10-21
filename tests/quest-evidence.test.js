import test from 'node:test';
import assert from 'node:assert/strict';
import { appendEvidence, queryEvidence, resultEvidence } from '../src/quest-evidence.js';
import { questCoins, questInventory, purseOf, settleQuestInventory } from '../src/items.js';
import { DEFAULT_RULES } from '../src/rules.js';

const currency = DEFAULT_RULES.currency;
const result = {
    outcome: 'fled',
    enemies: [
        { id: 'e1', name: 'Wolf A', gone: 'down' },
        { id: 'e2', name: 'Wolf B', gone: 'parleyed' },
        { id: 'e3', name: 'Wolf C', gone: 'fled' },
        { id: 'e4', name: 'Wolf spider', gone: 'down' },
    ],
};

test('structured outcomes record actual defeats even when the party fled, never parley or escape', () => {
    const event = resultEvidence('fight', result);
    assert.deepEqual(event.defeated, [{ id: 'fight:e1', name: 'Wolf' }, { id: 'fight:e4', name: 'Wolf spider' }]);
    assert.throws(() => resultEvidence('fight', { ...result, outcome: 'active' }), /not resolved/);
    const named = resultEvidence('named', { outcome: 'victory', enemies: [
        { id: 'e1', name: 'Specimen A A', questName: 'Specimen A', gone: 'down' },
    ] });
    assert.equal(named.defeated[0].name, 'Specimen A', 'canonical names retain their own letter suffix');
});

test('stage contributions deduplicate and same-reply earlier results stay before acceptance', () => {
    const one = resultEvidence('plan-1', result, { planId: 'plan' });
    const two = resultEvidence('plan-2', result, { planId: 'plan' });
    const first = appendEvidence(null, one, 'reply-a');
    assert.strictEqual(appendEvidence(first, one, 'reply-a'), first);
    const both = appendEvidence(first, two, 'reply-a');
    const history = [{ owner: 'reply-a', ledger: both }, { owner: 'reply-b', ledger: appendEvidence(null, two, 'reply-b') }];
    assert.deepEqual(queryEvidence(history, { version: 1, anchor: 'reply-a', excluded: [one.id] }).events.map(event => event.id), ['plan-2']);
    assert.equal(queryEvidence(history, { version: 1, anchor: 'removed' }).availability, 'incomplete');
    assert.equal(queryEvidence(history, null).availability, 'unavailable');
    assert.equal(queryEvidence([{ owner: 'new-swipe', ledger: both }], { version: 1, anchor: 'new-swipe' }).availability, 'incomplete');
});

test('currency parsing accepts exact configured units and rejects unknown or partial rewards', () => {
    assert.equal(questCoins('8 silver', currency), 80);
    assert.equal(questCoins('1 gold', currency), 100);
    for (const text of ['1 unknown', '1 silver and a sword', '1.5 silver', '-1 silver', '1 s']) assert.equal(questCoins(text, currency), null);
    assert.equal(questCoins('7 credits', { mode: 'single', single: 'credits' }), 7);
});

const base = '[Bag]\nRat Tail | 3 | proof\nRat Tail | 5 | proof\nRope | 1 | tied\nCoins | 2 silver |\n[Lyra > Bag]\nRat Tail | 99 |\n[Shop]\nRat Tail | 200 | for sale\n[Orders]\nRat Tail | 20 | uncollected';
const scope = { members: ['Lyra'], owner: null };
const plan = { payment: 50, consume: { names: ['Rat Tail'], qty: 5 } };

test('held items respect player ownership and reject invalid quantities', () => {
    const inventory = questInventory(base, currency, scope);
    assert.equal(inventory.items.filter(item => item.name === 'Rat Tail').reduce((n, item) => n + item.qty, 0), 8);
    assert.equal(questInventory('Rat Tail | -2 |\nPermit | unknown |', currency).items.every(item => item.qty === null), true);
});

test('delivery consumes across duplicate rows exactly once and preserves companion/stock rows', () => {
    const next = settleQuestInventory(base, base, plan, currency, scope);
    assert.equal(questInventory(next, currency, scope).items.find(item => item.name === 'Rat Tail').qty, 3);
    assert.equal(purseOf(next, currency, scope).total, 70);
    assert.match(next, /Rat Tail \| 99/);
    assert.match(next, /Rat Tail \| 200/);
    assert.equal(settleQuestInventory(base, next, plan, currency, scope), next, 'model echoes the planned effects');
});

test('unrelated changes survive; ambiguous payment and delivery changes block', () => {
    const changed = base.replace('Rope | 1', 'Rope | 2');
    assert.match(settleQuestInventory(base, changed, plan, currency, scope), /Rope \| 2/);
    assert.throws(() => settleQuestInventory(base, base.replace('2 silver', '3 silver'), plan, currency, scope), /ambiguously/);
    assert.throws(() => settleQuestInventory(base, base.replace('Rat Tail | 3', 'Rat Tail | 2'), plan, currency, scope), /ambiguously/);
    const possess = settleQuestInventory(base, base, { payment: 0, consume: null }, currency, scope);
    assert.equal(possess, base);
    assert.throws(() => settleQuestInventory('Coins | -2 silver |', 'Coins | -2 silver |', { payment: 10 }, currency), /Invalid purse/);
});
