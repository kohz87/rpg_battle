// The craft part's pure rules (MODULES §F102): quality bands, chances, half the materials on a
// fail, ranks that grow like RPG Battle's skills, the story's quality words, stations, crafts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CRAFTS, DC_BY_RARITY, chancesOf, craftKey, craftTable, dcOf, dcOfRank, halfOf, materialBonus, mismatchOf, qualityOf, rankOf, saidQuality,
    scaled, stationKey, stationsHere, usesToMax,
} from '../../../src/v2/craft/rules.js';
import { parseMaterials } from '../../../src/v2/craft/commands.js';
import { inputWorth, junkDef, outputDef } from '../../../src/v2/craft/make.js';
import { validateCraft, initialCraft } from '../../../src/v2/craft/domain.js';
import { DEFAULT_RULES } from '../../../src/rules.js';

test('quality bands: under the DC fails, 0–4 made, 5–9 fine, 10+ or a natural 20 masterwork, a natural 1 ruins', () => {
    assert.equal(qualityOf(1, 40, 10), 'ruined', 'a natural 1 ruins whatever the total');
    assert.equal(qualityOf(20, 5, 30), 'masterwork', 'a natural 20 is masterwork whatever the total');
    assert.equal(qualityOf(8, 11, 12), 'fail');
    assert.equal(qualityOf(9, 12, 12), 'normal');
    assert.equal(qualityOf(13, 16, 12), 'normal');
    assert.equal(qualityOf(14, 17, 12), 'fine');
    assert.equal(qualityOf(18, 21, 12), 'fine');
    assert.equal(qualityOf(19, 22, 12), 'masterwork', 'DC + 10');
});

test('chances by code: the 20 faces of the die, whole percents, a natural 1 counted as a fail', () => {
    const odds = chancesOf(2, 12);
    assert.equal(odds.fail + odds.normal + odds.fine + odds.masterwork, 100);
    assert.deepEqual(odds, { fail: 45, normal: 25, fine: 25, masterwork: 5 });
    assert.deepEqual(chancesOf(40, 10), { fail: 5, normal: 0, fine: 0, masterwork: 95 }, 'even a sure thing fails on a 1');
    assert.deepEqual(chancesOf(-30, 30), { fail: 95, normal: 0, fine: 0, masterwork: 5 });
});

test('a fail loses half the materials, rounded up overall', () => {
    const lost = parts => halfOf(parts).map(part => part.lose);
    assert.deepEqual(lost([{ name: 'Ore', qty: 3 }, { name: 'Salt', qty: 1 }]), [2, 0], '4 units: 2 lost');
    assert.deepEqual(lost([{ name: 'Ore', qty: 1 }]), [1], 'one unit: it is lost');
    assert.deepEqual(lost([{ name: 'A', qty: 1 }, { name: 'B', qty: 1 }, { name: 'C', qty: 1 }]), [1, 1, 0]);
    assert.deepEqual(lost([{ name: 'A', qty: 4 }, { name: 'B', qty: 2 }]), [2, 1]);
});

test('craft ranks grow the way RPG Battle skills do: 1 use to rank 1, then masteryUses per rank, up to masteryMax', () => {
    assert.deepEqual(rankOf(0), { rank: 0, uses: 0, toNext: 1, max: 5 });
    assert.equal(rankOf(1).rank, 1);
    assert.equal(rankOf(1).toNext, DEFAULT_RULES.masteryUses[1]);
    assert.equal(rankOf(5).rank, 1);
    assert.equal(rankOf(6).rank, 2);
    assert.equal(rankOf(usesToMax()).rank, 5);
    assert.equal(rankOf(usesToMax() + 50).rank, 5);
    assert.equal(rankOf(usesToMax()).toNext, 0);
    assert.equal(rankOf(3, { masteryMax: 3, masteryUses: [0, 2, 2] }).rank, 2, 'a rules file\'s table is followed');
});

test('the story\'s quality words, and the mismatch flag', () => {
    assert.equal(saidQuality('fine'), 'fine');
    assert.equal(saidQuality('Masterwork!'), 'masterwork');
    assert.equal(saidQuality('made'), 'normal');
    assert.equal(saidQuality('success'), 'normal');
    assert.equal(saidQuality('fail'), 'fail');
    assert.equal(saidQuality('ruined'), 'ruined');
    assert.equal(saidQuality(''), null);
    assert.equal(mismatchOf('fine', 'normal'), 'narrated as fine, the dice say made');
    assert.equal(mismatchOf('fine', 'fine'), '');
    assert.equal(mismatchOf(null, 'fail'), '');
});

test('stations: a forge by the place\'s words, a fire at a camp or an inn (a town too, but not worth telling), a pack place\'s list', () => {
    assert.ok(stationsHere({ place: { name: "Hollis's Smithy", kind: 'settlement' } }).forge);
    assert.equal(stationsHere({ place: { name: 'Bluewatch Village', kind: 'settlement' } }).forge, undefined);
    const town = stationsHere({ place: { name: 'Bluewatch Village', kind: 'settlement' } });
    assert.equal(town.fire.notable, false, 'a town has an inn, but is not a station to tell about');
    assert.equal(stationsHere({ place: { name: 'The Drowned Inn', kind: '' } }).fire.notable, true);
    assert.deepEqual(stationsHere({ place: { name: 'Deep Woods', kind: 'wild' } }), {});
    assert.ok(stationsHere({ place: { name: 'Deep Woods', kind: 'wild' }, made: ['fire'] }).fire, 'a campfire made on the spot');
    const packed = stationsHere({ place: { name: 'Tower' }, packPlace: { stations: ['enchanting table', { station: 'forge', bonus: 9 }] } });
    assert.ok(packed.enchanting);
    assert.equal(packed.forge.bonus, 3, 'a station\'s bonus is held to +3');
    assert.equal(stationKey('anvil'), 'forge');
    assert.equal(stationKey('campfire'), 'fire');
    assert.equal(stationKey('sofa'), null);
});

test('crafts: the built-in table, a written word, and a pack\'s `crafts` records over it', () => {
    assert.equal(craftKey('brewing'), 'alchemy');
    assert.equal(craftKey('Smithing'), 'smithing');
    assert.equal(craftKey('tanning'), 'leatherwork');
    assert.equal(craftKey('juggling'), null);
    assert.equal(CRAFTS.smithing.stat, 'STR');
    const table = craftTable([{ name: 'smithing', stat: 'VIT' }, { name: 'Tailoring', stat: 'DEX', station: 'none' }]);
    assert.equal(table.smithing.stat, 'VIT');
    assert.equal(table.smithing.station, 'forge');
    assert.equal(table.tailoring.stat, 'DEX');
    assert.equal(table.tailoring.station, null);
    assert.equal(craftKey('tailoring', table), 'tailoring');
});

test('DCs: the recipe\'s own (5–30), else its item\'s rarity; a rank\'s', () => {
    assert.equal(dcOf({ dc: 14 }), 14);
    assert.equal(dcOf({ dc: 99 }), 30);
    assert.equal(dcOf({}, 'rare'), DC_BY_RARITY.rare);
    assert.equal(dcOfRank('D'), 12);
    assert.equal(dcOfRank('rank B'), 16);
    assert.equal(dcOfRank('Z'), null);
    assert.equal(materialBonus([{ qty: 3, def: { rarity: 'common' } }, { qty: 1, def: { rarity: 'rare' } }]), 0);
    assert.equal(materialBonus([{ qty: 1, def: { rarity: 'rare' } }]), 2);
});

test('the materials a line names', () => {
    assert.deepEqual(parseMaterials('Iron Ore x2, Ember Salt, 3 Leather Strip'), [{ name: 'Iron Ore', qty: 2 }, { name: 'Ember Salt', qty: 1 }, { name: 'Leather Strip', qty: 3 }]);
    assert.deepEqual(parseMaterials('an Herb and the Herb'), [{ name: 'Herb', qty: 2 }]);
    assert.deepEqual(parseMaterials(''), []);
});

test('what is made: the quality scales stats and effects, elements carry over, worth is what went in', () => {
    const recipe = { id: 'pack.x/iron-sword', name: 'Iron Sword', craft: 'smithing', makes: { name: 'Iron Sword', def: { name: 'Iron Sword', kind: 'equipment', rarity: 'common', value: 900, slot: 'weapon', stats: { ATK: 5 }, tags: [] } } };
    const parts = [{ name: 'Iron Ore', need: 3, def: { name: 'Iron Ore', kind: 'material', value: 4, tags: [] } }, { name: 'Ember Salt', need: 1, def: { name: 'Ember Salt', kind: 'material', value: 10, tags: ['fire'] } }];
    const normal = outputDef(recipe, 'normal', parts).def;
    assert.equal(normal.stats.ATK, 5);
    assert.equal(normal.id, 'craft/iron-sword-fire');
    assert.ok(normal.tags.includes('fire'), 'the element of the ember salt carries over');
    assert.equal(normal.value, 22, 'worth the materials (3 × 4 + 10), not the pack\'s 900');
    assert.equal(outputDef(recipe, 'fine', parts).def.stats.ATK, 6);
    const master = outputDef(recipe, 'masterwork', parts);
    assert.equal(master.def.stats.ATK, 8);
    assert.equal(master.refine, 1);
    assert.ok(master.def.tags.includes('refined'));
    assert.match(master.def.note, /\+1 refinement/);
    assert.equal(master.def.name, 'Masterwork Iron Sword');
    const potion = { id: 'pack.x/draught', name: 'Healing Draught', craft: 'alchemy', makes: { name: 'Healing Draught', def: { name: 'Healing Draught', kind: 'consumable', effect: { heal: 30 } } } };
    assert.equal(outputDef(potion, 'fine', []).def.effect.heal, 36);
    assert.equal(outputDef(potion, 'masterwork', []).def.effect.heal, 45);
    assert.match(outputDef(potion, 'fine', []).def.note, /heals 36/, 'the note says it, so the item.define hook keeps it');
    assert.equal(scaled(1, 1.2), 2, 'a positive number always gains at least one');
    const junk = junkDef(recipe, parts);
    assert.equal(junk.name, 'Botched Iron Sword');
    assert.equal(junk.value, 0);
    assert.deepEqual(junk.stats, { ATK: -1 }, 'a small debuff when worn');
    assert.equal(junkDef(potion, []).kind, 'goods');
});

test('F104: a material with no value of its own is priced by code times the pack\'s money scale; a written value stays', () => {
    const plain = [{ name: 'Odd Pebble', need: 2, def: { name: 'Odd Pebble', kind: 'material', rarity: 'uncommon', value: 0, tags: [] } }];
    const written = [{ name: 'Iron Ore', need: 2, def: { name: 'Iron Ore', kind: 'material', value: 4, tags: [] } }];
    const one = inputWorth(plain);
    const ten = inputWorth(plain, { scale: 10 });
    assert.ok(one.worth > 0);
    assert.equal(ten.worth, Math.max(1, Math.round(one.worth / 2 * 10)) * 2);
    assert.ok(ten.fetch <= one.fetch, 'the resale cap is never raised above an unscaled seller\'s price');
    assert.equal(inputWorth(written, { scale: 10 }).worth, 8, 'a value the pack wrote is not scaled');
    assert.equal(inputWorth(plain, { scale: 0.001 }).worth, 2, 'whole, at least 1 each');
});

test('the domain validator: the initial slice is fine, a record under the wrong key is not', () => {
    assert.deepEqual(validateCraft(initialCraft()), []);
    assert.ok(validateCraft({ ...initialCraft(), known: { x: { actor: 'ac_00000000', recipe: 'pack.x/y', name: 'Y', from: '', rev: 1 } } }).length);
    assert.ok(validateCraft(null).length);
});
