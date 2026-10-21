// QA: payloads between parts. Every ctx.call one part makes to another (or to Story Block) is
// recorded through the real bus; each test checks that the caller sends the MODULES §F5 shape and
// that the callee does exactly what the payload asks (nothing ignored, nothing extra). Known
// mismatches are `todo` tests: their bodies state the expected behaviour and fail today.
import assert from 'node:assert/strict';
import { createHarness, fightOut, holdings, patch, sent, stacksOf, storyCoin, storyItem, winFight, withHero, each } from './helpers/harness.js';

const keys = payload => Object.keys(payload).sort();
const stackOf = (h, defId) => stacksOf(h, defId)[0]?.stack;

function hurt(h, name = 'Ren', harm = 'wound') {
    const r = h.capture({ op: '~', kind: 'wound', name, text: 'a fall', labels: { harm } });
    assert.equal(r.ok, true, r.message);
}

// ---------- items → inventory / party ----------

each('item.use → inventory.consume { stack, qty: 1 } and party.heal { actor, hp, cure }: the callee heals exactly hp', () => {
    const { h, pc } = withHero();
    const pot = storyItem(h, 'Minor Healing Draught', 2);
    hurt(h);
    const before = h.state().domains.party.actors[pc].hp.cur;
    const r = h.command('item.use', { stack: stackOf(h, pot), target: pc });
    assert.equal(r.ok, true, r.message);
    const [consume] = sent(h, 'item.use', 'inventory.consume');
    assert.deepEqual(keys(consume), ['qty', 'stack']);
    assert.equal(consume.qty, 1);
    const [heal] = sent(h, 'item.use', 'party.heal');
    assert.deepEqual(keys(heal), ['actor', 'cure', 'hp']);
    assert.equal(heal.actor, pc);
    assert.deepEqual(heal.cure, []);
    assert.equal(h.state().domains.party.actors[pc].hp.cur - before, heal.hp, 'party.heal applied the hp item.use sent');
    assert.equal(r.receipt.data.hp, heal.hp);
    assert.equal(stacksOf(h, pot)[0].qty, 1);
});

each('item.use (an antidote) → party.heal { cure: [the kept kind] }: the condition the party keeps is lifted', () => {
    const { h, pc } = withHero();
    const anti = storyItem(h, 'Antidote', 1);
    const poisoned = h.capture({ op: '~', kind: 'wound', name: 'Ren', text: 'a spider bite', labels: { condition: 'poisoned' } });
    assert.equal(poisoned.ok, true, poisoned.message);
    assert.deepEqual(h.state().domains.party.actors[pc].conditions.map(c => c.kind), ['poisoned']);
    const r = h.command('item.use', { stack: stackOf(h, anti) });
    assert.equal(r.ok, true, r.message);
    const [heal] = sent(h, 'item.use', 'party.heal');
    assert.deepEqual(heal, { actor: pc, hp: 0, cure: ['poisoned'] });
    assert.deepEqual(h.state().domains.party.actors[pc].conditions, []);
});

each('item.use (a mana tonic) → party.restore { actor, mp }: the callee restores exactly mp', () => {
    const { h, pc } = withHero();
    const tonic = storyItem(h, 'Mana Tonic', 1);
    patch(h, s => { s.domains.party.actors[pc].mp.cur = 2; });
    const r = h.command('item.use', { stack: stackOf(h, tonic) });
    assert.equal(r.ok, true, r.message);
    const [restore] = sent(h, 'item.use', 'party.restore');
    assert.deepEqual(keys(restore), ['actor', 'mp']);
    assert.equal(h.state().domains.party.actors[pc].mp.cur, 2 + restore.mp);
    assert.equal(sent(h, 'item.use', 'party.heal').length, 0, 'no heal call for an MP-only dose');
});

each('item.equip → inventory.equip { stack, slot } and inventory.unequip { stack } when a weapon is swapped', () => {
    const { h, pc } = withHero();
    const a = storyItem(h, 'Iron Sword', 1, 'a plain sword, ATK +2');
    const b = storyItem(h, 'Steel Axe', 1, 'an axe, ATK +3');
    assert.equal(h.command('item.equip', { stack: stackOf(h, a) }).ok, true);
    const r = h.command('item.equip', { stack: stackOf(h, b) });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(sent(h, 'item.equip', 'inventory.unequip').map(keys), [['stack']]);
    const equips = sent(h, 'item.equip', 'inventory.equip');
    assert.deepEqual(equips.map(keys), [['slot', 'stack'], ['slot', 'stack']]);
    assert.deepEqual(equips.map(p => p.slot), ['weapon', 'weapon']);
    const worn = h.query('inventory.items').filter(row => row.equipped);
    assert.deepEqual(worn.map(row => row.def), [b], 'only the axe is wielded');
    assert.equal(r.receipt.data.actor, pc);
});

each('item.equip of one accessory → inventory.equip { slot: accessory-1 } (its own key per allowed copy)', () => {
    const { h } = withHero();
    const ring = storyItem(h, 'Silver Ring', 1, 'a ring of LUK +2');
    const r = h.command('item.equip', { stack: stackOf(h, ring) });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(sent(h, 'item.equip', 'inventory.equip'), [{ stack: stackOf(h, ring), slot: 'accessory-1' }]);
    assert.equal(r.receipt.data.slot, 'accessory');
    assert.equal(r.receipt.data.key, 'accessory-1');
});

each('item.equip: a second accessory (rules allow 2) is worn beside the first, not in its place; a third is refused', () => {
    const { h } = withHero();
    const silver = storyItem(h, 'Silver Ring', 1, 'a ring of LUK +2');
    const gold = storyItem(h, 'Gold Ring', 1, 'a ring of DEX +2');
    const jade = storyItem(h, 'Jade Ring', 1, 'a ring of INT +2');
    assert.equal(h.command('item.equip', { stack: stackOf(h, silver) }).ok, true);
    const r = h.command('item.equip', { stack: stackOf(h, gold) });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(r.receipt.data.removed, [], 'nothing came off');
    assert.doesNotMatch(r.receipt.summary, /puts away/);
    const worn = h.query('inventory.items').filter(row => row.equipped);
    assert.deepEqual(worn.map(row => [row.def, row.equipped]).sort(), [[gold, 'accessory-2'], [silver, 'accessory-1']].sort());
    assert.equal(h.query('items.gear', {}).counted.length, 2, 'both count');
    const third = h.command('item.equip', { stack: stackOf(h, jade) });
    assert.equal(third.code, 'REFUSED');
    // Taking the first off frees its key for the next.
    assert.equal(h.command('item.unequip', { stack: stackOf(h, silver) }).ok, true);
    assert.equal(h.command('item.equip', { stack: stackOf(h, jade) }).ok, true);
    assert.equal(h.query('inventory.items').find(row => row.def === jade).equipped, 'accessory-1');
});

each('item.equip: a weapon swapped says what came off', () => {
    const { h } = withHero();
    const a = storyItem(h, 'Iron Sword', 1, 'a plain sword, ATK +2');
    const b = storyItem(h, 'Steel Axe', 1, 'an axe, ATK +3');
    assert.equal(h.command('item.equip', { stack: stackOf(h, a) }).ok, true);
    const r = h.command('item.equip', { stack: stackOf(h, b) });
    assert.match(r.receipt.summary, /; puts away the Iron Sword\.$/);
    assert.deepEqual(r.receipt.data.removed, [stackOf(h, a)]);
});

each('item.give → inventory.transfer { stack, to, qty }: the callee moves exactly qty to that actor', () => {
    const { h, pc } = withHero();
    const joined = h.command('party.addCompanion', { name: 'Lyra', role: 'archer' });
    assert.equal(joined.ok, true, joined.message);
    const lyra = joined.receipt.data.actor;
    const pot = storyItem(h, 'Minor Healing Draught', 3);
    const r = h.command('item.give', { stack: stackOf(h, pot), to: lyra, qty: 2 });
    assert.equal(r.ok, true, r.message);
    const [transfer] = sent(h, 'item.give', 'inventory.transfer');
    assert.deepEqual(transfer, { stack: r.receipt.data.stack, to: lyra, qty: 2 });
    const rows = stacksOf(h, pot);
    assert.deepEqual(rows.map(row => [row.owner, row.qty]).sort(), [[lyra, 2], ['party', 1]].sort());
    void pc;
});

// ---------- combat → party / inventory ----------

each('combat.end → party.applyResult { outcome, stakes, actors: [{ id, hp, mp, sp, down, conditions, uses }] }: HP/MP/SP land exactly', () => {
    const { h, pc } = withHero({ seed: 3 });
    const { end } = winFight(h, 'Cellar Rat');
    assert.equal(end.ok, true, end.message);
    const [applied] = sent(h, 'combat.end', 'party.applyResult');
    assert.deepEqual(keys(applied), ['actors', 'outcome', 'stakes']);
    assert.deepEqual(keys(applied.actors[0]), ['conditions', 'down', 'hp', 'id', 'mp', 'sp', 'uses']);
    const me = h.state().domains.party.actors[pc];
    assert.equal(applied.actors[0].id, pc);
    assert.deepEqual(me.hp, applied.actors[0].hp);
    assert.deepEqual(me.mp, applied.actors[0].mp);
    assert.deepEqual(me.sp, applied.actors[0].sp);
    // A fight's "bleed" is kept as the party's kind word.
    for (const cond of applied.actors[0].conditions) assert.ok(me.conditions.some(c => c.kind.startsWith(cond.kind.slice(0, 4))), `${cond.kind} kept`);
});

each('combat.end → party.grantXp { actor, amount }: the XP the fight result gives is the XP the actor gets', () => {
    const { h, pc } = withHero({ seed: 1 });
    const xpBefore = h.state().domains.party.actors[pc].xp;
    const { end } = winFight(h, 'Cellar Rat');
    assert.equal(end.ok, true, end.message);
    const grants = sent(h, 'combat.end', 'party.grantXp');
    assert.deepEqual(grants.map(keys), [['actor', 'amount']]);
    assert.equal(grants[0].amount, end.receipt.data.xp[pc]);
    assert.equal(h.state().domains.party.actors[pc].xp - xpBefore, grants[0].amount);
});

each('combat.end → inventory.grant { def, qty, owner } and wallet.receive { owner, amount, note }: loot lands as sent, from this receipt', () => {
    const { h } = withHero({ seed: 4 });
    const before = holdings(h.state());
    const { end } = winFight(h, 'Bandit');
    assert.equal(end.ok, true, end.message);
    const grants = sent(h, 'combat.end', 'inventory.grant');
    assert.ok(grants.length > 0, 'seed 4 drops a piece');
    for (const grant of grants) {
        assert.deepEqual(keys(grant).filter(key => !['def', 'qty', 'owner', 'note'].includes(key)), [], 'only the F5 fields');
        const rows = stacksOf(h, grant.def.id);
        assert.equal(rows.reduce((n, row) => n + row.qty, 0), grant.qty);
        assert.ok(rows.every(row => row.owner === grant.owner && row.note === (grant.note ?? '')));
        assert.ok(rows.every(row => row.from === end.receipt.id), 'the stacks name the combat.end receipt as their cause');
    }
    const [pay] = sent(h, 'combat.end', 'wallet.receive');
    assert.deepEqual(keys(pay), ['amount', 'note', 'owner']);
    assert.equal(pay.amount, end.receipt.data.loot.money);
    assert.equal(holdings(h.state()).money - before.money, pay.amount);
});

each('combat.end → inventory.grant: a loot def keeps the price item.define gives it (no value sent)', () => {
    const { h } = withHero({ seed: 1 });
    const { end } = winFight(h, 'Cellar Rat');
    assert.equal(end.ok, true, end.message);
    const def = h.state().domains.inventory.defs['story/cellar-rat-tail'];
    assert.ok(def, 'the tail was looted');
    assert.ok(def.value > 0, `stored value ${def.value}`);
});

each('combat.act → inventory.consume { stack, qty }: a draught drunk in the fight leaves its stack at once; combat.end takes nothing', () => {
    const { h, pc } = withHero({ seed: 3 });
    const pot = storyItem(h, 'Minor Healing Draught', 2);
    h.capture({ op: '!', kind: 'encounter', name: '2 Cellar Rats', text: '', labels: { tier: 'weak' } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers')[0].id }).ok, true);
    assert.equal(h.command('combat.act', { action: { type: 'defend' } }).ok, true);
    const drink = h.command('combat.act', { action: { type: 'item', item: 'Minor Healing Draught', target: pc } });
    assert.equal(drink.ok, true, drink.message);
    const consumed = sent(h, 'combat.act', 'inventory.consume');
    assert.deepEqual(consumed.map(keys), [['qty', 'stack']]);
    assert.equal(consumed[0].qty, 1);
    assert.equal(stacksOf(h, pot)[0].qty, 1, 'taken at use');
    assert.deepEqual(drink.receipt.data.used, [{ stack: consumed[0].stack, qty: 1 }]);
    fightOut(h);
    const end = h.command('combat.end');
    assert.equal(end.ok, true, end.message);
    assert.deepEqual(sent(h, 'combat.end', 'inventory.consume'), []);
    // One left, plus any the foes dropped.
    const dropped = (end.receipt.data.loot.items.find(item => item.name === 'Minor Healing Draught')?.qty) ?? 0;
    assert.equal(stacksOf(h, pot).reduce((sum, row) => sum + row.qty, 0), 1 + dropped);
});

each('combat.start reads items.gear({ actor }) → { counted: [{ stack, name, slot, rarity, stats }] }: the capped numbers', () => {
    const { h, pc } = withHero();
    const sword = storyItem(h, 'Runed Sword', 1, 'ATK +9');
    assert.equal(h.command('item.equip', { stack: stackOf(h, sword) }).ok, true);
    const gear = h.query('items.gear', { actor: pc });
    assert.ok(Array.isArray(gear.counted), 'combat/setup.js gearRows reads .counted');
    const [row] = gear.counted;
    for (const key of ['stack', 'name', 'slot', 'rarity', 'stats']) assert.ok(Object.hasOwn(row, key), key);
    assert.equal(row.capped, true, 'ATK +9 is over a common piece\'s budget at level 1');
    assert.ok(row.stats.ATK < 9);
});

each('combat.start reads party.combatNumbers({ id }) → { attack, magic, defence, mdef, crit, stats }', () => {
    const { h, pc } = withHero();
    const numbers = h.query('party.combatNumbers', { id: pc });
    for (const key of ['attack', 'magic', 'defence', 'mdef', 'crit']) assert.ok(Number.isFinite(numbers[key]), key);
    assert.equal(typeof numbers.stats, 'object');
});

each('combat.start reads inventory.items({ owner }) rows with the F5 fields', () => {
    const { h } = withHero();
    storyItem(h, 'Minor Healing Draught', 1);
    const [row] = h.query('inventory.items', { owner: 'party' });
    for (const key of ['stack', 'def', 'name', 'kind', 'qty', 'owner', 'equipped', 'note']) assert.ok(Object.hasOwn(row, key), key);
});

// ---------- trade → wallet / inventory ----------

each('trade.sell → inventory.consume { stack, qty } and wallet.receive { owner, amount }: amount is the quoted total', () => {
    const { h } = withHero();
    const tail = storyItem(h, 'Wolf Pelt', 3);
    const quote = h.query('trade.quote', { type: 'sell', stack: stackOf(h, tail), qty: 2 });
    assert.equal(quote.ok, true, quote.message);
    const r = h.command('trade.sell', { stack: stackOf(h, tail), qty: 2 });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(sent(h, 'trade.sell', 'inventory.consume'), [{ stack: quote.stack, qty: 2 }]);
    assert.deepEqual(sent(h, 'trade.sell', 'wallet.receive'), [{ owner: 'party', amount: quote.total }]);
});

each('trade.buy → wallet.pay { owner, amount } and inventory.grant { def, qty, owner }', () => {
    const { h } = withHero();
    storyCoin(h, 500);
    const stock = h.query('trade.stock', { kind: 'general' });
    const item = stock.items.find(entry => entry.def.kind !== 'equipment');
    const r = h.command('trade.buy', { shop: stock.shop, def: item.def.id, qty: 2 });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(sent(h, 'trade.buy', 'wallet.pay'), [{ owner: 'party', amount: item.price * 2 }]);
    const [grant] = sent(h, 'trade.buy', 'inventory.grant');
    assert.deepEqual(grant.def, item.def);
    assert.equal(grant.qty, 2);
    assert.equal(grant.owner, 'party');
    assert.equal(stacksOf(h, item.def.id)[0].qty, 2);
});

each('trade.buy → inventory.grant sends only the F5 fields { def, qty, owner, note? }', () => {
    const { h } = withHero();
    storyCoin(h, 500);
    const stock = h.query('trade.stock', { kind: 'general' });
    const item = stock.items.find(entry => entry.def.kind !== 'equipment');
    assert.equal(h.command('trade.buy', { shop: stock.shop, def: item.def.id, qty: 1 }).ok, true);
    const [grant] = sent(h, 'trade.buy', 'inventory.grant');
    assert.deepEqual(keys(grant).filter(key => !['def', 'qty', 'owner', 'note'].includes(key)), []);
});

each('craft.commission → inventory.consume per material and wallet.pay { owner, amount: fee }; craft.collect → inventory.grant of the piece', () => {
    const { h } = withHero();
    storyCoin(h, 2000);
    const pelt = storyItem(h, 'Wolf Pelt', 4);
    const quote = h.query('trade.quote', { type: 'commission', piece: 'Pelt Cloak', materials: [{ stack: stackOf(h, pelt), qty: 3 }], crafter: 'the tanner' });
    assert.equal(quote.ok, true, quote.message);
    const r = h.command('craft.commission', { piece: 'Pelt Cloak', materials: [{ stack: stackOf(h, pelt), qty: 3 }], crafter: 'the tanner' });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(sent(h, 'craft.commission', 'inventory.consume'), [{ stack: quote.materials[0].stack, qty: 3 }]);
    assert.deepEqual(sent(h, 'craft.commission', 'wallet.pay'), quote.fee > 0 ? [{ owner: 'party', amount: quote.fee }] : []);
    const order = r.receipt.data.order;
    const got = h.command('craft.collect', { order });
    assert.equal(got.ok, true, got.message);
    const [grant] = sent(h, 'craft.collect', 'inventory.grant');
    assert.equal(grant.qty, 1);
    assert.equal(stacksOf(h, grant.def.id).length, 1);
    assert.equal(stacksOf(h, grant.def.id)[0].owner, 'party');
});

// ---------- another module → party ----------

each('Story Director → party.grantXp { quest, difficulty }: given once per quest (claim xp:quest:<id>)', () => {
    const { h, pc } = withHero();
    h.registry.register({
        id: 'story-director',
        commands: { 'quest.finishQa': (ctx, payload) => { ctx.call('party.grantXp', { quest: payload.quest, difficulty: 'hard' }); return { summary: 'done' }; } },
    });
    const first = h.command('quest.finishQa', { quest: 'q_ab12cd34' });
    assert.equal(first.ok, true, first.message);
    assert.ok(h.state().domains.party.actors[pc].xp > 0);
    assert.equal(h.state().meta.claims['xp:quest:q_ab12cd34'], true);
    const again = h.command('quest.finishQa', { quest: 'q_ab12cd34' });
    assert.equal(again.ok, false);
    assert.equal(again.code, 'CLAIMED');
});

each('party.grantXp { difficulty } refuses a word that is not a quest difficulty', () => {
    const { h } = withHero();
    const before = JSON.stringify(h.state());
    const r = h.command('party.grantXp', { difficulty: 'banana' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INVALID');
    assert.equal(JSON.stringify(h.state()), before);
    assert.equal(h.command('party.grantXp', { difficulty: 'Hard' }).ok, true, 'any case of a real one');
});

each('party.heal / party.restore refuse a fractional or negative amount (no half HP reaches the state)', () => {
    const { h, pc } = withHero();
    hurt(h);
    for (const hp of [1.5, -3, Number.NaN, '5']) {
        const before = JSON.stringify(h.state());
        const r = h.command('party.heal', { actor: pc, hp });
        assert.equal(r.ok, false, `hp ${hp}`);
        assert.equal(JSON.stringify(h.state()), before);
    }
    void createHarness;
});
