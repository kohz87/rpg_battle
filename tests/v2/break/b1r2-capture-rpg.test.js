// b1-capture round 2 (RPG Battle): findings against 2f52c80 on its vendored host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';

async function started(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await rpgHost();
    t.after(() => host.close());
    const made = await host.cmd('party.create', { name: 'Ren', preset: 'fighter' });
    assert.equal(made.ok, true, made.message);
    // A village (its settlement type sets its prices, MODULES §F107).
    await host.send('We walk into the village.', host.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: village']));
    return host;
}
const coin = host => host.q('inventory.wallet', { owner: 'party' }).coin ?? 0;

// B-b1r2-5: the story item budget is 20 of one item per reply, with no limit on how many different
// items: 150 lines of "Superior Healing Potion Xn | qty: 20" make 3000 potions, and selling them
// pays 189,000 gold for one reply (the story coin budget at level 1 is 50).
// Story Block 2.0.0-alpha.2 holds a reply's story goods to a worth budget (b3 r2-2); RPG Battle
// sells story-made items at their capped value.
test('selling what one reply\'s story lines made pays no more than a reply\'s story money', async t => {
    const host = await started(t);
    const lines = Array.from({ length: 150 }, (_, i) => `+ item Superior Healing Potion ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)} | qty: 20`);
    await host.send('We loot the apothecary.', host.reply('Shelves of potions.', lines));
    const inv = host.head().domains.inventory;
    for (const stack of Object.values(inv.stacks)) await host.cmd('trade.sell', { stack: stack.id, qty: stack.qty });
    assert.ok(coin(host) <= 1000, `selling one reply's story items paid ${coin(host)}`);
});

// B-b1r2-6: shortages are looked up with `shortages[key]` on a plain object (trade/core.js
// shortageAt, trade/index.js applyMarket), so a place keyed "constructor" finds Object itself:
// `! market Constructor` fails as "returned data that is not a plain JSON object", and a market at a
// place called Constructor is always short (prices 150%) with no shortage written.
test('a place called Constructor has no shortage until one is written, and ! market works there', async t => {
    const host = await started(t);
    await host.send('We go on.', host.reply('Constructor, a mill town.', ['~ place Constructor | kind: settlement']));
    assert.equal(host.q('trade.market').shortage ?? null, null, JSON.stringify(host.q('trade.market')));
    await host.send('Bread?', host.reply('No bread.', ['! market Constructor — no bread']));
    const codes = host.turn.problems().map(problem => problem.code);
    assert.ok(!codes.includes('FAILED'), JSON.stringify(host.turn.problems().map(problem => problem.message)));
});

// B-b1r2-13: the F80 dice bookkeeping (checks.prepared, appended by list position, and checks.last,
// replaced field by field) chains each reply to the one before. Deleting an early reply that made a
// check makes every later reply's check fail on replay ("…/checks/prepared/3 has no list position",
// "…/checks/last/carrier goes through something that is not an object"): their results are gone.
test('deleting an early reply with a check keeps the checks of later replies', async t => {
    const host = await started(t);
    await host.send('a', host.reply('A.', ['? check stealth — sneak | dc: normal | roll: 1 | result: success']));
    const a = host.store.headIndex();
    await host.send('b', host.reply('B.', ['? check athletics — climb | dc: normal | roll: 1 | result: success']));
    await host.send('c', host.reply('C.', ['? check STR — lift | dc: normal | roll: 2 | result: fail']));
    await host.st.deleteMessage(a);
    await host.st.deleteMessage(a - 1);
    // The log is keyed by check id (B-b1r2-13, approved): read through its query, oldest first.
    const skills = Object.values(host.head().domains.checks.log).map(entry => entry.skill);
    assert.deepEqual(skills, ['athletics', 'STR'], JSON.stringify(host.store.problems().map(problem => problem.message)));
});
