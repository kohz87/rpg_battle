// The craft part's pure rules (MODULES §F102): quality bands, chances, half the materials on a
// fail, ranks that grow like RPG Battle's skills, the story's quality words, stations, crafts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DC_BY_RARITY, chancesOf, craftKey, craftTable, dcOf, dcOfRank, halfOf, materialBonus, mismatchOf, qualityOf, rankOf, saidQuality,
    scaled, stationKey, stationsHere, stationsOfRecipe, stationsText, statList, statsModifier, statsOf, usesToMax,
} from '../../../src/v2/craft/rules.js';
import { parseMaterials, teachesFrom, worthParts } from '../../../src/v2/craft/commands.js';
import { clip, nameKey } from '../../../src/v2/craft/rules.js';
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

test('stations: by what is said about the place (its name and kind, its pack place, the shops there); a town has an inn, not worth telling', () => {
    assert.ok(stationsHere({ texts: ["Hollis's Smithy", 'settlement'] }).forge);
    assert.ok(stationsHere({ texts: ["Hollis's Smithy"] }).workbench, 'a smithy has a workbench');
    const town = stationsHere({ texts: ['Bluewatch Village', 'settlement'] });
    assert.equal(town.forge, undefined);
    assert.equal(town.inn.notable, false, 'a town has an inn, but is not a station to tell about');
    assert.ok(stationsHere({ texts: ['Bluewatch Village', 'Salt-and-Ash Dispensary', 'apothecary'] })['alchemy-table'], 'an apothecary shop there');
    assert.equal(stationsHere({ texts: ['The Drowned Inn'] }).inn.notable, true);
    assert.deepEqual(stationsHere({ texts: ['Deep Woods', 'wild'] }), {});
    assert.ok(stationsHere({ texts: ['Deep Woods'], made: ['campfire'] }).campfire, 'a campfire made on the spot');
    assert.ok(stationsHere({ texts: ['Salt-and-Ash Yard', 'yard'], known: ['salt-yard'] })['salt-yard'], 'a pack\'s own station, every word of it said');
    assert.equal(stationsHere({ texts: ['Salt Road'], known: ['salt-yard'] })['salt-yard'], undefined);
    assert.equal(stationKey('anvil'), 'forge');
    assert.equal(stationKey('campfire'), 'campfire');
    assert.equal(stationKey('alchemy table'), 'alchemy-table');
    assert.equal(stationKey('sofa'), null);
    assert.equal(stationsText(['campfire', 'inn']), 'a campfire or an inn');
    assert.equal(stationsText(['salt-yard']), 'a salt yard');
});

test('crafts: Story Block\'s table (packs.crafts), the words a story writes for them, a recipe\'s own stat and station', () => {
    const table = craftTable([
        { craft: 'smithing', title: 'Smithing', stats: ['STR', 'DEX'], stations: ['forge'], pack: null },
        { craft: 'leather', title: 'Leatherwork', stats: ['DEX'], stations: ['workbench', 'campfire', 'inn'], pack: null },
        { craft: 'alchemy', title: 'Alchemy', stats: ['INT', 'DEX'], stations: ['alchemy-table'], pack: 'ersveil' },
        { craft: 'fieldcraft', title: 'Fieldcraft', stats: ['DEX'], stations: [], pack: 'ersveil' },
    ]);
    assert.equal(craftKey('brewing', table), 'alchemy');
    assert.equal(craftKey('Smithing', table), 'smithing');
    assert.equal(craftKey('leatherwork', table), 'leather', 'RB\'s old word is Story Block\'s leather');
    assert.equal(craftKey('Fieldcraft', table), 'fieldcraft');
    assert.equal(craftKey('juggling', table), null);
    assert.equal(craftKey('cooking', table), null, 'a craft the table does not have');
    assert.deepEqual(statsOf({}, 'alchemy', table), ['INT', 'DEX']);
    assert.deepEqual(statsOf({ stat: 'STR+VIT' }, 'alchemy', table), ['STR', 'VIT'], 'the recipe\'s own wins');
    assert.deepEqual(statsOf({}, 'unknown', table), ['INT']);
    assert.deepEqual(stationsOfRecipe({}, 'leather', table), ['workbench', 'campfire', 'inn']);
    assert.deepEqual(stationsOfRecipe({ station: 'salt-yard' }, 'alchemy', table), ['salt-yard']);
    assert.deepEqual(stationsOfRecipe({}, 'fieldcraft', table), [], 'anywhere');
    assert.deepEqual(statList('STR+DEX+STR+XYZ'), ['STR', 'DEX']);
    // Several stats: the average of their check modifiers, rounded down (STR 9 → +2, DEX 6 → +0: +1).
    assert.equal(statsModifier({ stats: { STR: 9, DEX: 6 } }, ['STR', 'DEX']), 1);
    assert.equal(statsModifier({ stats: { INT: 9 } }, ['INT']), 2);
});

test('DCs: the recipe\'s own (5–30), else its item\'s rarity; a rank\'s', () => {
    assert.equal(dcOf({ dc: 14 }), 14);
    assert.equal(dcOf({ dc: 99 }), 40);
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

test('a key item (a story gift, its own stack with key: true) adds nothing to what a craft is worth', () => {
    const def = { name: 'Moon Pearl', kind: 'material', rarity: 'rare', value: 500, tags: [] };
    const parts = [{ name: 'Moon Pearl', need: 2, def, takes: [{ stack: 'it_00000001', qty: 1, key: true }, { stack: 'it_00000002', qty: 1 }] }];
    assert.deepEqual(worthParts(parts).map(part => part.qty), [1], 'only the plain pearl counts');
    const gift = [{ name: 'Moon Pearl', need: 1, def, takes: [{ stack: 'it_00000001', qty: 1, key: true }] }];
    const recipe = { id: 'story/charm', name: 'Pearl Charm', craft: 'leather', makes: { name: 'Pearl Charm', def: { name: 'Pearl Charm', kind: 'equipment', slot: 'accessory', stats: { DEF: 1 } } } };
    assert.equal(outputDef(recipe, 'normal', gift, { worthParts: worthParts(gift) }).def.value, 0, 'gift → craft → sell pays nothing');
    assert.equal(inputWorth(worthParts(gift)).fetch, 0);
});

test('names are flattened (Story Block cleanName): invisible format characters dropped', () => {
    assert.equal(clip('\u202eSalve\u200b', 80), 'Salve');
    assert.equal(nameKey('\u202eSalve\u200b'), nameKey('Salve'));
    assert.deepEqual(parseMaterials('\u200bHerb x2'), [{ name: 'Herb', qty: 2 }]);
});

test('who teaches it: one name word in common with the pack\'s `teaches`', () => {
    assert.equal(teachesFrom('the lay sealer at the Salt-and-Ash Yard, as licensed work', 'the lay sealer'), true);
    assert.equal(teachesFrom('the lay sealer at the Salt-and-Ash Yard', 'Marrit'), false);
    assert.equal(teachesFrom('Hollis at the Gate Forge', 'Hollis'), true);
    assert.equal(teachesFrom('Hollis at the Gate Forge', 'a passing tinker'), false);
});

test('a pack\'s bare `damage: 6` is made as { amount, element: physical }: no "undefined" element', () => {
    const pouch = { id: 'pack.e/pouch', name: 'Leech-salt Pouch', craft: 'fieldcraft', qty: 2, makes: { name: 'Leech-salt Pouch', def: { name: 'Leech-salt Pouch', kind: 'consumable', value: 6, effect: { damage: 6 }, tags: ['salt'] } } };
    const parts = [{ name: 'Coarse Salt', need: 2, def: { name: 'Coarse Salt', kind: 'material', value: 3, tags: [] } }, { name: 'Burlap Sack', need: 1, def: { name: 'Burlap Sack', kind: 'goods', value: 2, tags: [] } }];
    const { def } = outputDef(pouch, 'masterwork', parts);
    assert.deepEqual(def.effect.damage, { amount: 9, element: 'physical', target: 'one' });
    assert.match(def.note, /damage 9/);
    assert.ok(!JSON.stringify(def).includes('undefined'));
    assert.equal(def.value, 4, 'each of the two is worth half of the 8 that went in (RX-E-4)');
});
