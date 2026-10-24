// Gear condition and refinement, the pure rules (items/condition.js, define.js kits, gear-tail.js):
// bands and their stat shares, refinement, the write-per-key record, the validator, resale and the
// share a repair or a refinement must at least cost, repair kits from the item.define hook, the
// money scale (MODULES §F104) and the feature toggles (MODULES §F100).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BANDS, FULL, MAX_EVENTS, REFINE_FEATURE, STORY_WEAR, WEAR_FEATURE, addEvent, applyEvent, bandFactor, bandOf, featureOn, foldPiece, freshRecord,
    gearFeatures, maxResaleShare, pieceName, pieceOf, refineFactor, resaleFactor, resaleOf, scaleStats, validateGear, wearWord,
} from '../../../src/v2/items/condition.js';
import { REPAIR_MAX, defineItem, repairKitAmount, scaledCoin } from '../../../src/v2/items/define.js';
import { condition, gear } from '../../../src/v2/items/queries.js';
import { gearTail } from '../../../src/v2/items/gear-tail.js';
import { DEFAULT_RULES } from '../../../src/rules.js';
import { PC, makeState } from './helpers/state.js';

test('bands: good ≥75, worn ≥40, tattered ≥10, broken <10, giving 100/85/60/0%', () => {
    assert.deepEqual(BANDS.map(b => [b.band, b.from, b.factor]), [['good', 75, 1], ['worn', 40, 0.85], ['tattered', 10, 0.6], ['broken', 0, 0]]);
    for (const [cond, band] of [[100, 'good'], [75, 'good'], [74, 'worn'], [40, 'worn'], [39, 'tattered'], [10, 'tattered'], [9, 'broken'], [0, 'broken']]) assert.equal(bandOf(cond), band, `cond ${cond}`);
    assert.equal(bandFactor('worn'), 0.85);
    assert.equal(bandFactor('broken'), 0);
});

test('scaleStats: the band share and the refinement, rounded; broken gives nothing; a malus stays', () => {
    assert.deepEqual(scaleStats({ ATK: 10, DEX: -1 }, { factor: 1, refine: 0 }), { ATK: 10, DEX: -1 });
    assert.deepEqual(scaleStats({ ATK: 10, DEX: -1 }, { factor: 0.85, refine: 0 }), { ATK: 9, DEX: -1 });
    assert.deepEqual(scaleStats({ ATK: 10 }, { factor: 0.6, refine: 0 }), { ATK: 6 });
    assert.deepEqual(scaleStats({ ATK: 10, DEX: -1 }, { factor: 0, refine: 3 }), {});
    assert.deepEqual(scaleStats({ ATK: 10 }, { factor: 1, refine: 2 }), { ATK: 12 });
    assert.deepEqual(scaleStats({ ATK: 25 }, { factor: 1, refine: 3 }), { ATK: 31 });
    // +8% a level, rounded once (RX-E-5): a small stat gains only what that rounds to.
    assert.deepEqual(scaleStats({ DEF: 1 }, { factor: 1, refine: 3 }), { DEF: 1 });
    assert.deepEqual(scaleStats({ ATK: 2 }, { factor: 1, refine: 3 }), { ATK: 2 });
    assert.deepEqual(scaleStats({ ATK: 4 }, { factor: 1, refine: 3 }), { ATK: 5 });
    // A stat of 5 or more gains at least +1 once refined.
    assert.deepEqual(scaleStats({ ATK: 5 }, { factor: 1, refine: 1 }), { ATK: 6 });
    assert.deepEqual(scaleStats({ ATK: 5 }, { factor: 1, refine: 3 }), { ATK: 6 });
    assert.deepEqual(scaleStats({ ATK: 6, DEX: -1 }, { factor: 0.85, refine: 1 }), { ATK: 6, DEX: -1 });
    assert.equal(refineFactor(1), 1.08);
    assert.equal(refineFactor(9), refineFactor(3), 'refinement is held to +3');
});

test('names: "Iron Sword +2"; a written suffix is not doubled; +0 is the plain name', () => {
    assert.equal(pieceName('Iron Sword', 2), 'Iron Sword +2');
    assert.equal(pieceName('Iron Sword +1', 2), 'Iron Sword +2');
    assert.equal(pieceName('Iron Sword', 0), 'Iron Sword');
});

test('wear words: three bands of code numbers, synonyms read, anything else is no word', () => {
    assert.deepEqual(STORY_WEAR, { scuff: 5, tear: 15, ruin: 40 });
    assert.equal(wearWord('scuff'), 'scuff');
    assert.equal(wearWord('Torn'), 'tear');
    assert.equal(wearWord('shattered by the blow'), 'ruin');
    assert.equal(wearWord('40'), null, 'a number is never a wear');
    assert.equal(wearWord(''), null);
});

test('events: each its own key, folded in order; a deleted event takes exactly its own change away', () => {
    const gearSlice = { events: {} };
    addEvent(gearSlice, 'it_aaaaaaaa', { wear: 15 }, 5);
    addEvent(gearSlice, 'it_aaaaaaaa', { refine: 1 }, 7);
    addEvent(gearSlice, 'it_aaaaaaaa', { wear: 40 }, 9);
    addEvent(gearSlice, 'it_aaaaaaaa', { patch: 25, fray: 5 }, 11);
    assert.deepEqual(Object.keys(gearSlice.events), ['it_aaaaaaaa#5', 'it_aaaaaaaa#7', 'it_aaaaaaaa#9', 'it_aaaaaaaa#11']);
    assert.deepEqual(foldPiece(gearSlice, 'it_aaaaaaaa'), { cond: 70, max: 95, low: 45, ever: 45, paid: 0, refine: 1 });
    // The reply that wore it 40 deleted: the rest still applies.
    const without = { events: { ...gearSlice.events } };
    delete without.events['it_aaaaaaaa#9'];
    assert.deepEqual(foldPiece(without, 'it_aaaaaaaa'), { cond: 95, max: 95, low: 85, ever: 85, paid: 0, refine: 1 }, 'the patch is held to the frayed maximum');
    // The refinement's reply deleted: the piece is plain again, its wear stays.
    const plain = { events: { ...gearSlice.events } };
    delete plain.events['it_aaaaaaaa#7'];
    assert.equal(foldPiece(plain, 'it_aaaaaaaa').refine, 0);
    // Two events of one receipt on one piece get their own keys.
    addEvent(gearSlice, 'it_aaaaaaaa', { wear: 1 }, 11);
    assert.ok(Object.hasOwn(gearSlice.events, 'it_aaaaaaaa#11.1'));
    assert.deepEqual(validateGear(gearSlice), []);
    assert.equal(foldPiece(gearSlice, 'it_bbbbbbbb'), null);
});

test('a repair puts a piece back to full and keeps its fee; the worst it ever was stays; deleting the repair undoes exactly it', () => {
    const gearSlice = { events: {} };
    addEvent(gearSlice, 'it_aaaaaaaa', { wear: 40 }, 3);
    addEvent(gearSlice, 'it_aaaaaaaa', { refine: 1 }, 4);
    addEvent(gearSlice, 'it_aaaaaaaa', { patch: 20, fray: 5 }, 5);
    addEvent(gearSlice, 'it_aaaaaaaa', { repair: true, fee: 12 }, 6);
    assert.equal(Object.keys(gearSlice.events).length, 4, 'nothing is removed: each event is its reply\'s own');
    assert.deepEqual(foldPiece(gearSlice, 'it_aaaaaaaa'), { cond: 100, max: 100, low: 100, ever: 60, paid: 12, refine: 1 });
    addEvent(gearSlice, 'it_aaaaaaaa', { wear: 5 }, 8);
    const undone = { events: { ...gearSlice.events } };
    delete undone.events['it_aaaaaaaa#6'];
    assert.deepEqual(foldPiece(undone, 'it_aaaaaaaa'), { cond: 75, max: 95, low: 60, ever: 60, paid: 0, refine: 1 });
});

test('resale: never more than at the worst it ever was plus the repair fees paid', () => {
    // New, a buyer pays 100 for it; worn to 60, repaired for 12, it fetches at most 60 + 12.
    assert.equal(resaleOf(100, { cond: 100, low: 100, ever: 60, paid: 12, refine: 0 }), 72);
    assert.equal(resaleOf(100, { cond: 100, low: 100, ever: 100, paid: 0, refine: 0 }), 100);
    assert.equal(resaleOf(100, { cond: 90, low: 40, ever: 40, paid: 0, refine: 0 }), 40, 'a patch does not raise it');
    assert.equal(resaleOf(100, { cond: 2, low: 2, ever: 2, paid: 0, refine: 0 }), 2);
    assert.equal(resaleOf(10, { cond: 0, low: 0, ever: 0, paid: 0, refine: 0 }), 1, 'scrap fetches 1');
});

test('events are clamped when folded and when kept; past MAX_EVENTS the oldest go', () => {
    assert.deepEqual(applyEvent(freshRecord(), { wear: 999 }), { cond: 0, max: 100, low: 0, ever: 0, paid: 0, refine: 0 });
    assert.deepEqual(applyEvent({ cond: 50, max: 52, low: 50, ever: 50, paid: 0, refine: 3 }, { patch: 30, fray: 5, refine: 1 }), { cond: 50, max: 50, low: 50, ever: 50, paid: 0, refine: 3 });
    assert.deepEqual(applyEvent({ cond: 0, max: 100, low: 0, refine: 1 }, { lost: 1 }).refine, 0);
    const gearSlice = { events: {} };
    assert.equal(addEvent(gearSlice, 'it_aaaaaaaa', { wear: 0 }, 1), null, 'an event that does nothing is not kept');
    for (let n = 1; n <= MAX_EVENTS + 5; n += 1) addEvent(gearSlice, `it_${String(n % 300).padStart(8, '0')}`, { wear: 1 }, n);
    assert.equal(Object.keys(gearSlice.events).length, MAX_EVENTS);
});

test('the gear validator refuses out-of-range, unknown and mis-keyed events', () => {
    assert.deepEqual(validateGear({ events: {} }), []);
    assert.ok(validateGear({ events: { 'it_aaaaaaaa#3': { stack: 'it_aaaaaaaa', wear: 101 } } }).length);
    assert.ok(validateGear({ events: { 'it_aaaaaaaa#3': { stack: 'it_bbbbbbbb', wear: 5 } } }).length);
    assert.ok(validateGear({ events: { 'it_aaaaaaaa#3': { stack: 'it_aaaaaaaa', cond: 50 } } }).length, 'a whole record is no event');
    assert.ok(validateGear({ events: { 'it_aaaaaaaa#3': { stack: 'it_aaaaaaaa', refine: 4 } } }).length);
    assert.ok(validateGear({ events: { nope: {} } }).length);
    assert.ok(validateGear(null).length);
});

test('pieceOf: new pieces are full; folded from the events alone (Story Block\'s stack.cond is not read); features off read full and plain', () => {
    const inventory = { stacks: { it_aaaaaaaa: { id: 'it_aaaaaaaa', cond: 99 }, it_bbbbbbbb: { id: 'it_bbbbbbbb' } } };
    const gearSlice = { events: { 'it_aaaaaaaa#4': { stack: 'it_aaaaaaaa', wear: 70 }, 'it_aaaaaaaa#5': { stack: 'it_aaaaaaaa', refine: 2 } } };
    assert.deepEqual(pieceOf(inventory, gearSlice, 'it_bbbbbbbb'), { stack: 'it_bbbbbbbb', cond: FULL, max: FULL, low: FULL, ever: FULL, paid: 0, refine: 0, fresh: true, band: 'good', factor: 1 });
    const piece = pieceOf(inventory, gearSlice, 'it_aaaaaaaa');
    assert.deepEqual([piece.cond, piece.band, piece.low, piece.refine], [30, 'tattered', 30, 2]);
    const off = pieceOf(inventory, gearSlice, 'it_aaaaaaaa', { wear: false, refine: false });
    assert.deepEqual([off.cond, off.band, off.factor, off.refine], [FULL, 'good', 1, 0]);
});

test('features: on without a host feature function (an older host), off only when it says false', () => {
    assert.equal(featureOn(null, WEAR_FEATURE), true);
    assert.equal(featureOn({}, WEAR_FEATURE), true);
    assert.equal(featureOn({ feature: id => id !== WEAR_FEATURE }, WEAR_FEATURE), false);
    assert.deepEqual(gearFeatures({ feature: id => id !== REFINE_FEATURE }), { wear: true, refine: false });
    assert.equal(featureOn({ feature: () => { throw new Error('x'); } }, WEAR_FEATURE), true);
});

test('resale: condition kept since the last proper repair (a patch does not raise it) × refinement', () => {
    assert.equal(resaleFactor({ cond: 100, low: 100, refine: 0 }), 1);
    assert.equal(resaleFactor({ cond: 90, low: 40, refine: 0 }), 0.4, 'patched to 90, but it had been at 40');
    assert.equal(resaleFactor({ cond: 100, low: 100, refine: 2 }), 1.16);
    // The most anyone pays, as a share of worth: sell rate × best buyer × best place × dearest word.
    assert.equal(maxResaleShare(DEFAULT_RULES), 0.5 * 1.3 * 1.25 * 1.25);
});

test('repair kits: named for mending, a consumable with effect.repair and a worth; packs keep their own; sizes by name', () => {
    const blank = name => ({ id: `story/${name.toLowerCase().replace(/\W+/g, '-')}`, name, kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' });
    const kit = defineItem(blank('Repair Kit'), { settings: {}, currency: null, scale: 1 });
    assert.equal(kit.kind, 'consumable');
    assert.deepEqual(kit.effect, { heal: 0, mp: 0, cure: [], repair: 25 });
    assert.equal(kit.value, 50);
    assert.equal(repairKitAmount('Minor Sewing Kit'), 15);
    assert.equal(repairKitAmount('Fine Whetstone'), 35);
    assert.equal(repairKitAmount("Master Armourer's Kit"), 50);
    assert.equal(repairKitAmount('Kit Bag'), 0);
    assert.equal(repairKitAmount('Rope'), 0);
    const pack = defineItem({ ...blank('Tinker Bundle'), kind: 'consumable', value: 70, effect: { repair: 999 } }, { settings: {}, currency: null, scale: 1 });
    assert.equal(pack.effect.repair, REPAIR_MAX, 'a pack kit is held to the largest');
    assert.equal(pack.value, 70, 'a pack\'s own worth stays');
});

test('F104 money scale: a kit\'s fixed coin worth × the pack\'s scale, whole, at least 1', () => {
    const blank = { id: 'story/repair-kit', name: 'Repair Kit', kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' };
    assert.equal(defineItem(blank, { settings: {}, currency: null, scale: 40 }).value, 2000);
    assert.equal(defineItem(blank, { settings: {}, currency: null, scale: 0.001 }).value, 1);
    assert.equal(defineItem(blank, { settings: {}, currency: null, scale: 'x' }).value, 50, 'no scale reads 1');
    assert.equal(scaledCoin(3, 2.5), 8);
    // Through the host's `inventory.economy` when it answers.
    const saved = globalThis.StoryBlock;
    globalThis.StoryBlock = { sdk: { query: name => (name === 'inventory.economy' ? { scale: 10 } : null), settings: () => ({}) } };
    try {
        assert.equal(defineItem(blank, { settings: {}, currency: null }).value, 500);
    } finally {
        if (saved === undefined) delete globalThis.StoryBlock;
        else globalThis.StoryBlock = saved;
    }
});

function wornState() {
    const state = makeState();
    state.domains.gear = { events: {
        'it_dagger01#4': { stack: 'it_dagger01', refine: 2 },
        'it_dagger01#5': { stack: 'it_dagger01', wear: 40 },
        'it_buckle01#6': { stack: 'it_buckle01', wear: 95 },
    } };
    return state;
}

test('items.gear: a worn piece gives its band share × refinement (final: true); a broken one is left out (unused: broken)', () => {
    const view = gear(wornState(), { settings: {} });
    const dagger = view.counted.find(row => row.stack === 'it_dagger01');
    assert.equal(dagger.name, 'Iron Dagger +2');
    assert.equal(dagger.band, 'worn');
    assert.equal(dagger.final, true);
    assert.deepEqual(dagger.stats, { ATK: Math.round(3 * 0.85 * 1.16) });
    assert.equal(view.counted.some(row => row.stack === 'it_buckle01'), false);
    assert.deepEqual(view.unused.find(row => row.stack === 'it_buckle01'), { stack: 'it_buckle01', name: 'Oak Buckler', slot: 'offhand', key: 'offhand', slotLabel: 'Off hand', rarity: 'common', why: 'broken', cond: 5, max: 100, band: 'broken', refine: 0 });
    assert.equal(view.bonuses.DEF, view.counted.reduce((sum, row) => sum + (row.stats.DEF ?? 0), 0), 'the broken buckler adds nothing');
    assert.equal(view.bonuses.DEF, 1, 'only the boots');
    assert.equal(view.bonuses.ATK, dagger.stats.ATK);
    // Both features off: v1's numbers as before.
    const off = gear(wornState(), { settings: {} }, { feature: () => false });
    assert.deepEqual(off.counted.find(row => row.stack === 'it_dagger01').stats, { ATK: 3 });
    assert.equal(off.counted.some(row => row.stack === 'it_buckle01'), true);
});

test('items.condition: band, cur, max, refine, name; null for a non-piece; feature toggles', () => {
    const state = wornState();
    assert.deepEqual(condition(state, { stack: 'it_dagger01' }), { stack: 'it_dagger01', band: 'worn', cur: 60, max: 100, refine: 2, name: 'Iron Dagger +2', factor: 0.85 });
    assert.equal(condition(state, { stack: 'it_draught1' }), null);
    assert.equal(condition(state, { stack: 'it_nothere' }), null);
    const noWear = condition(state, { stack: 'it_dagger01' }, { feature: id => id !== WEAR_FEATURE });
    assert.deepEqual([noWear.band, noWear.cur, noWear.max, noWear.refine, noWear.factor], [null, null, null, 2, 1]);
    const noRefine = condition(state, { stack: 'it_dagger01' }, { feature: id => id !== REFINE_FEATURE });
    assert.deepEqual([noRefine.refine, noRefine.name], [0, 'Iron Dagger']);
    assert.equal(condition(state, { stack: 'it_dagger01' }, { feature: () => false }), null);
});

test('the tail names only pieces worse than good, worst first; nothing when wear is off', () => {
    const state = wornState();
    const tail = gearTail({ state });
    assert.deepEqual(tail.lines, ["[Gear] Not in good repair: Ren's Oak Buckler (broken: gives nothing), Ren's Iron Dagger +2 (worn)."]);
    assert.deepEqual(gearTail({ state, feature: () => false }).lines, []);
    assert.deepEqual(gearTail({ state: makeState() }).lines, []);
    assert.ok(PC);
});

test('a refined piece never passes the next rarity\'s budget at the wearer\'s level (a legendary one stays at its own)', async () => {
    const { capItem } = await import('../../../src/items.js');
    const state = makeState();
    const inv = state.domains.inventory;
    inv.defs['story/starsteel-sword'] = { ...inv.defs['story/starsteel-sword'], rarity: 'legendary', stats: { ATK: 99 } };
    inv.stacks.it_dagger01.equipped = null;
    inv.stacks.it_stars001.equipped = 'weapon';
    state.domains.gear = { events: { 'it_stars001#3': { stack: 'it_stars001', refine: 3 } } };
    const row = gear(state, { settings: {} }).counted.find(entry => entry.stack === 'it_stars001');
    const atBudget = capItem({ slot: 'weapon', rarity: 'legendary', stats: { ATK: 99 } }, 3, DEFAULT_RULES).stats;
    assert.equal(row.name, 'Starsteel Sword +3');
    assert.deepEqual(row.stats, atBudget, 'no refinement past the top budget');
    // A common piece at its budget refines (+8% a level) and stays under the uncommon budget.
    const common = makeState();
    common.domains.inventory.defs['story/iron-dagger'].stats = { ATK: 50 };
    common.domains.gear = { events: { 'it_dagger01#3': { stack: 'it_dagger01', refine: 3 } } };
    const dagger = gear(common, { settings: {} }).counted.find(entry => entry.stack === 'it_dagger01');
    const uncommon = capItem({ slot: 'weapon', rarity: 'uncommon', stats: { ATK: 50 } }, 3, DEFAULT_RULES).stats.ATK;
    assert.ok(dagger.stats.ATK <= uncommon, `${dagger.stats.ATK} ≤ ${uncommon}`);
});

test('items.slots and items.canWear answer from the planner (Story Block\'s Equip on… picker)', async () => {
    const { canWear, slots } = await import('../../../src/v2/items/queries.js');
    // The eight slots in order, the compatibility counts fixed by them; no setting changes them.
    const view = slots(makeState(), { settings: {} });
    assert.deepEqual(view.slots.map(slot => slot.key), ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2']);
    assert.deepEqual(view.slots.map(slot => slot.label), ['Main hand', 'Off hand', 'Head', 'Body', 'Legs', 'Feet', 'Accessory 1', 'Accessory 2']);
    assert.deepEqual([view.accessory, view.worn], [2, 4]);
    assert.equal(view.slots.every(slot => slot.blockedBy === null), true);
    assert.deepEqual(slots(makeState(), { settings: { gear: { accessories: 3, worn: 0 } } }), view);
    const state = makeState();
    assert.deepEqual(canWear(state, { actor: PC, stack: 'it_helm0001', settings: {} }), { ok: true });
    assert.equal(canWear(state, { actor: PC, stack: 'it_draught1', settings: {} }).ok, false);
    assert.equal(canWear(state, { actor: 'ac_nobody00', stack: 'it_helm0001', settings: {} }).ok, false);
    // A def only (Story Block's picker): the slot the def names, for a member who is there.
    assert.equal(canWear(state, { actor: PC, defId: 'story/silver-ring' }).ok, true);
    assert.equal(canWear(state, { actor: PC, defId: 'story/silver-ring', targetSlot: 'head' }).ok, false);
    // An off-hand beside a two-handed weapon is refused, as item.equip refuses it, and the slot says what blocks it.
    state.domains.inventory.stacks.it_dagger01.equipped = null;
    state.domains.inventory.stacks.it_buckle01.equipped = null;
    state.domains.inventory.stacks.it_great001.equipped = 'weapon';
    assert.match(canWear(state, { actor: PC, stack: 'it_buckle01', settings: {} }).why, /two-handed/);
    assert.equal(slots(state, {}).slots.find(slot => slot.key === 'offhand').blockedBy, 'it_great001');
});
