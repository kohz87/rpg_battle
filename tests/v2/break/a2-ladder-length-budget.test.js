// Breaker a2 (v2 break pass 2): the rank ladder's length and Levels per rank (RPG Battle Terms, F105)
// set the money one reply may give. Rewards "by place" grow ×4.5 a rank (terms.js rankReward, Story
// Director quests/ranks.js rewardByPlace), and Story Block's per-reply story coin budget is the top of the
// party's rank's reward (inventory.js storyCoinBudget → quest.ranks). A reader who lists 12 ranks with
// Levels per rank 1 gets, for the same level-12 character, a budget millions of times the default
// ladder's; `+ coin 999999999` is then paid in full. Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
// Needs the four Story Suite checkouts side by side (helpers/suite.js); skipped otherwise (CI checks out
// this repo alone; the rule is also tested on its own in tests/v2/break/a2-rules.test.js).
let suite = null;
try { suite = await import('./helpers/suite.js'); } catch (error) { suite = { error }; }
const skip = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;
const { suiteHost } = suite?.error ? {} : suite;

const CALLER = { id: 'a2-caller', name: 'a2 caller', version: '0.0.0', commands: { 'a2.call': (ctx, { type, payload } = {}) => ctx.call(type, payload ?? {}) } };

async function paidAtLevel12(t, rb) {
    const host = await suiteHost({ pack: false, settings: { modules: { 'rpg-battle': rb } }, modules: [CALLER] });
    t.after(() => host.close());
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    assert.equal((await host.cmd('a2.call', { type: 'party.grantXp', payload: { amount: 1100 } })).ok, true);
    await host.send('In.', host.reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement']));
    const level = host.q('party.pc').level;
    const budget = host.q('inventory.storyBudget').budget;
    await host.send('A chest.', host.reply('Gold everywhere.', ['+ coin 999999999']));
    return { level, budget, paid: host.wallet() };
}

test('a2-ladder: a longer rank ladder (Terms) does not multiply what one reply may pay at the same level', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    const plain = await paidAtLevel12(t, {});
    const twelve = Array.from({ length: 12 }, (_, i) => ({ rank: `Circle ${i + 1}` }));
    const renamed = await paidAtLevel12(t, { 'party.ranks': twelve, 'party.levelsPerRank': 1 });
    assert.equal(renamed.level, plain.level, 'same character level');
    assert.ok(renamed.budget <= plain.budget * 20,
        `level ${plain.level}: default ladder budget ${plain.budget}; 12 ranks × 1 level budget ${renamed.budget}`);
    assert.ok(renamed.paid <= plain.budget * 20, `+ coin 999999999 paid ${renamed.paid} (default ladder pays ${plain.paid})`);
});
