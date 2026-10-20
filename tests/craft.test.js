// Crafting (src/craft.js, items.applyCrafts): gear made from the Inventory's materials (0.5.34).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, rarityBudget } from '../src/rules.js';
import { makeRng } from '../src/rng.js';
import { craftPlan, materialAffinity, parseCrafted } from '../src/craft.js';
import { addLoot, applyCrafts, parseInventory } from '../src/items.js';
import { rollLoot } from '../src/enemies.js';

const BEFORE = [
    '[Gear]',
    'Rope | 1 | 30 ft',
    '[Loot]',
    'Granary Cellar Rat Tail | 5',
    'Minor Healing Draught | 3 | heal 20',
    'Brood-Mother Skull | 1 | uncommon material',
    'Venom Sac | 2 | material · poison',
].join('\n');

test('a material lends a stat by what part it is and an element by what it is made of', () => {
    assert.deepEqual(materialAffinity('Brood-Mother Skull'), { stat: 'MDEF', element: null });
    assert.deepEqual(materialAffinity('Venom Sac'), { stat: 'MP', element: 'poison' });
    assert.deepEqual(materialAffinity('Great Fang', '', 'Ember Drake'), { stat: 'ATK', element: 'fire' });
    // The note outranks the name: a hint written by hand is the one used.
    assert.deepEqual(materialAffinity('Brood-Mother Skull', 'uncommon material · VIT, holy'), { stat: 'VIT', element: 'holy' });
    assert.deepEqual(materialAffinity('Lump'), { stat: null, element: null });
});

test('drops carry their affinity in the note; a common one says material', () => {
    let found = null;
    for (let seed = 0; seed < 50 && !found; seed++) {
        found = rollLoot({ name: 'Giant Spider', loot: 'spider', rank: 'D' }, { rng: makeRng(`s${seed}`) }).items.find(item => item.name === 'Venom Sac');
    }
    assert.deepEqual(found.affinity, { stat: 'MP', element: 'poison' });
    const text = addLoot('', { items: [found, { name: 'Brood-Mother Skull', qty: 1, rarity: 'uncommon', kind: 'material', stats: {}, affinity: { stat: 'MDEF', element: 'poison' } }] });
    assert.match(text, /Venom Sac \| 1 \| material · MP, poison/);
    assert.match(text, /Brood-Mother Skull \| 1 \| uncommon material · MDEF, poison/);
    // Read back, a material with a hint is still never gear.
    assert.ok(parseInventory(text).items.every(item => item.slot === null));
});

test('<Crafted> lines: the piece, its materials with how many, a slot', () => {
    assert.deepEqual(parseCrafted('Skull Charm from Brood-Mother Skull, 2 Venom Sac\n- Tail Cord from the rat tail x3 | slot: worn\nnothing here'), [
        { name: 'Skull Charm', materials: [{ name: 'Brood-Mother Skull', qty: 1 }, { name: 'Venom Sac', qty: 2 }], slot: null },
        { name: 'Tail Cord', materials: [{ name: 'rat tail', qty: 3 }], slot: 'worn' },
    ]);
});

test('the code sets the numbers: rarity from the best material, stats from affinities, element carried', () => {
    const [plan] = craftPlan(BEFORE, parseCrafted('Skull Charm from Brood-Mother Skull, Venom Sac'), { level: 5 });
    const budget = rarityBudget('uncommon', 5, DEFAULT_RULES);
    assert.equal(plan.item.rarity, 'uncommon');
    assert.equal(plan.item.slot, 'accessory');
    assert.deepEqual(plan.item.stats, { MDEF: Math.floor(budget / 2), MP: Math.floor(budget / 2 / DEFAULT_RULES.statCost.MP) });
    assert.deepEqual(plan.item.tags, ['poison']);
    assert.deepEqual(plan.used, [{ name: 'Brood-Mother Skull', qty: 1 }, { name: 'Venom Sac', qty: 1 }]);
    // Three tails of the best rarity: one step up. "the rat tail" finds the one row that holds those words.
    const [cord] = craftPlan(BEFORE, parseCrafted('Tail Cord from 3 rat tail | slot: worn'), { level: 5 });
    assert.equal(cord.item.rarity, 'uncommon');
    assert.deepEqual(Object.keys(cord.item.stats), ['AGI']);
    assert.equal(cord.item.slot, 'worn');
    // A material the Inventory does not hold is common and is not taken.
    const [own] = craftPlan(BEFORE, parseCrafted('Iron Ring from Smith\'s Iron'), { level: 5 });
    assert.equal(own.item.rarity, 'common');
    assert.deepEqual(own.used, []);
});

test('the reply\'s Inventory gets the piece and loses the materials, the same each time', () => {
    const plans = craftPlan(BEFORE, parseCrafted('Skull Charm from Brood-Mother Skull, Venom Sac'), { level: 5 });
    // The model wrote its own charm with a story note and left the skull in.
    const written = `${BEFORE}\nSkull Charm | 1 | equipped · a charm of yellowed bone`;
    const fixed = applyCrafts(written, BEFORE, plans);
    assert.doesNotMatch(fixed, /Brood-Mother Skull \|/);
    assert.match(fixed, /Venom Sac \| 1 \| material · poison/);
    assert.match(fixed, /Skull Charm \| 1 \| equipped · uncommon · MDEF \+\d+, MP \+\d+, poison/);
    assert.match(fixed, /Granary Cellar Rat Tail \| 5/);
    assert.equal(applyCrafts(fixed, BEFORE, plans), fixed);
    // No charm written: it is added (not equipped), and the parsed row is gear with its element.
    const added = applyCrafts(BEFORE, BEFORE, plans);
    const charm = parseInventory(added).items.find(item => item.name === 'Skull Charm');
    assert.equal(charm.slot, 'accessory');
    assert.equal(charm.equipped, false);
    assert.deepEqual(charm.tags, ['poison']);
});

test('the story instruction\'s own <Crafted> example reads back', async () => {
    const { STORY_INSTRUCTION } = await import('../src/story.js');
    const example = STORY_INSTRUCTION.match(/<Crafted>(.*?)<\/Crafted>/)[1];
    assert.deepEqual(parseCrafted(example), [{ name: 'Bone Charm', materials: [{ name: 'Skull', qty: 1 }, { name: 'Fang', qty: 2 }], slot: null }]);
});

test('an order takes the materials now and waits under [On Order]; its own line collects it (0.5.36)', async () => {
    const { collectOrders, keepNotes } = await import('../src/items.js');
    const before = '[Gear]\nWhetstone | 1 | Worn thin\n[Loot]\nBrood-Mother Skull | 1 | uncommon material · MDEF';
    const lines = parseCrafted('Skull Ring from Brood-Mother Skull | ready: Goldwane 14');
    assert.deepEqual(lines, [{ name: 'Skull Ring', materials: [{ name: 'Brood-Mother Skull', qty: 1 }], slot: null, ready: 'Goldwane 14' }]);
    const plans = craftPlan(before, lines, { level: 2 });
    assert.equal(plans[0].order, 'Goldwane 14');
    // The model already took the skull out: the ring still comes out uncommon, from the skull it was.
    const written = '[Gear]\nWhetstone | 1 | Worn thin';
    const ordered = applyCrafts(written, before, plans);
    assert.match(ordered, /\[On Order\]\nSkull Ring \| 1 \| uncommon · MDEF \+\d+ · on order, ready Goldwane 14/);
    assert.doesNotMatch(ordered, /Brood-Mother Skull/);
    assert.equal(applyCrafts(ordered, before, plans), ordered);
    // Not here yet: nothing to wear.
    const ring = parseInventory(ordered).items.find(item => item.name === 'Skull Ring');
    assert.equal(ring.slot, null);
    assert.equal(ring.onOrder, true);
    // A later reply that retells it or leaves it out: still on order.
    assert.match(keepNotes(ordered.replace(/Skull Ring \| 1 \| .*/, 'Skull Ring | 1 | being carved at the lean-to'), ordered), /Skull Ring \| 1 \| uncommon · MDEF \+\d+ · on order, ready Goldwane 14 · being carved/);
    assert.match(keepNotes(written, ordered), /\[On Order\]\nSkull Ring \| 1 \| uncommon · MDEF/);
    // Collected: the ring as the gear it is, the order row gone, the same each time.
    assert.deepEqual(parseCrafted('Skull Ring — collected from the bone-carver'), [{ name: 'Skull Ring', materials: [], slot: null, pickup: true }]);
    // Retold while it waited ("· being carved" after the order): collected, the numbers alone.
    const retold = keepNotes(ordered.replace(/Skull Ring \| 1 \| .*/, 'Skull Ring | 1 | being carved'), ordered);
    assert.match(collectOrders(retold.replace(/\[On Order\]\n.*\n?/, ''), retold, ['Skull Ring']), /^Skull Ring \| 1 \| uncommon · MDEF \+\d+$/m);
    const collected = collectOrders(ordered, ordered, ['Skull Ring']);
    assert.doesNotMatch(collected, /on order/);
    const worn = parseInventory(collected).items.find(item => item.name === 'Skull Ring');
    assert.equal(worn.slot, 'accessory');
    assert.equal(worn.rarity, 'uncommon');
    assert.equal(collectOrders(collected, ordered, ['Skull Ring']), collected);
    // The story put it on as it handed it over: kept equipped, the order's numbers.
    const onHand = collectOrders(`${ordered}\n[Equipment > Accessories]\nSkull Ring | 1 | Equipped · a bone band`, ordered, ['Skull Ring']);
    assert.match(onHand, /Skull Ring \| 1 \| equipped · uncommon · MDEF \+\d+/);
    assert.equal((onHand.match(/Skull Ring/g) ?? []).length, 1);
    // No order before: nothing collected.
    assert.equal(collectOrders(written, written, ['Skull Ring']), written);
});
