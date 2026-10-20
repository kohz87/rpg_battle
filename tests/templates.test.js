// Creatures made up from their names (src/templates.js), and how a fight uses them: the
// template a name picks, deterministic generation, numbers only from the rules, the chat's
// bestiary before the shipped one, and projection and loot through enemies.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, RANKS, RARITIES, makeRules, rarityBudget } from '../src/rules.js';
import { makeRng } from '../src/rng.js';
import { DEFAULT_BESTIARY, projectEnemy, rankRowForLevel, rollLoot } from '../src/enemies.js';
import { creatureSkill } from '../src/skills.js';
import {
    TEMPLATES, TEMPLATE_IDS, TRAITS, classify, cleanCreature, cleanTraits, combinedBestiary, creatureSingular,
    creaturesToMake, generateCreature, lookupCreature, storeCreatures, templateFor, traitMods,
    FAMILIES, familyOf, familyTitle, findKin, upgradePerson,
} from '../src/templates.js';
import { resolveThreats } from '../src/story.js';
import { enemiesFromRows } from '../src/party.js';
import { foeXpWorth } from '../src/combat.js';
import { flavourPrompt } from '../src/flavour.js';

const rules = DEFAULT_RULES;

test('templateFor: a name\'s words pick its template; nature beats profession, the head noun wins', () => {
    const cases = {
        'Marsh Wolf': 'beast', 'Hellhound': 'beast', 'Cave Bear': 'beast', 'Bat Swarm': 'beast',
        'Bog Wight': 'undead', 'Skeleton Mage': 'undead', 'Barrow Lich': 'undead',
        'Road Thug': 'humanoid', 'Pirate': 'humanoid', 'Elf Archer': 'humanoid',
        'Bandit Captain': 'leader', 'Orc Warlord': 'leader', 'Warlord': 'leader',
        'Hedge Witch': 'caster', 'Goblin Shaman': 'caster', 'Cultist': 'caster',
        'Stone Golem': 'construct', 'Bone Golem': 'construct', 'Brass Sentinel': 'construct',
        'Acid Slime': 'ooze', 'Grey Ooze': 'ooze', 'Mire Jelly': 'ooze',
        'Cave Spider': 'insect', 'Spider Queen': 'insect', 'Giant Scorpion': 'insect',
        'Ashen Drake': 'drake', 'Wyvern': 'drake', 'Swamp Lizard': 'drake',
        'Grave Wisp': 'spirit', 'Fire Elemental': 'spirit', 'Restless Ghost': 'spirit',
        'Old Treant': 'plant', 'Strangler Vine': 'plant', 'Bog Shambler': 'plant',
        'Glimmerfolk': 'generic', '': 'generic',
    };
    for (const [name, template] of Object.entries(cases)) assert.equal(templateFor(name), template, name);
    // A leader word on a creature of another nature makes it a leader of its kind.
    assert.deepEqual(classify('Wolf Matriarch'), { template: 'beast', noun: 'Wolf', leader: true, role: null, traits: [] });
    assert.equal(classify('Skeleton Mage').role, 'caster', 'a caster word under a nature casts');
    assert.equal(classify('Elf Archer').role, 'skirmisher');
    assert.deepEqual(classify('Hill Ogre').traits, ['hulking']);
    // "pirate" does not end in a short keyword's compound ("rat"), "aristocrat" neither.
    assert.equal(templateFor('Aristocrat'), 'generic');
    assert.deepEqual([...TEMPLATE_IDS].sort(), ['beast', 'caster', 'construct', 'drake', 'generic', 'humanoid', 'insect', 'leader', 'ooze', 'plant', 'spirit', 'undead'].sort());
});

test('creatureSingular: plurals of creature words only', () => {
    assert.equal(creatureSingular('wights'), 'wight');
    assert.equal(creatureSingular('Wolves'), 'wolf');
    assert.equal(creatureSingular('hellhounds'), 'hellhound');
    assert.equal(creatureSingular('wight'), null, 'already singular');
    assert.equal(creatureSingular('bones'), null, 'a keyword as it is');
    assert.equal(creatureSingular('vyrrks'), null);
});

test('every template is complete: a known role, traits, temperament, 3+ skills and loot', () => {
    for (const [id, template] of Object.entries(TEMPLATES)) {
        assert.ok(['brute', 'skirmisher', 'caster', 'tank', 'support'].includes(template.role), id);
        for (const trait of template.traits) assert.ok(TRAITS.includes(trait), `${id}: ${trait}`);
        assert.ok(DEFAULT_RULES.generated.temperaments[template.temperament], id);
        assert.equal(typeof template.talks, 'boolean');
        assert.ok(template.skills.length >= 3, id);
        assert.ok(template.loot.materials.length >= 1, id);
    }
    // Who talks: people and casters do, beasts, undead, constructs and oozes do not.
    for (const id of ['humanoid', 'leader', 'caster']) assert.equal(TEMPLATES[id].talks, true, id);
    for (const id of ['beast', 'undead', 'construct', 'ooze']) assert.equal(TEMPLATES[id].talks, false, id);
});

test('generateCreature: deterministic for the same name, level and seed; a different seed may differ', () => {
    const a = generateCreature({ name: 'marsh wolf', level: 12 }, { rules, seed: 'chat-1' });
    const b = generateCreature({ name: 'Marsh Wolf', level: 12 }, { rules, seed: 'chat-1' });
    assert.deepEqual(a, b);
    assert.equal(a.name, 'Marsh Wolf');
    assert.equal(a.generated, true);
    assert.equal(a.template, 'beast');
    assert.equal(a.level, 12);
    assert.equal(a.rank, rankRowForLevel(12, rules).rank);
    assert.equal(a.role, 'skirmisher');
    assert.equal(a.talks, false);
    assert.equal(a.flavoured, false);
    assert.equal(a.moves[0].name, 'Bite', 'the signature move always');
    const names = new Set();
    for (let n = 0; n < 12; n++) names.add(generateCreature({ name: 'Marsh Wolf', level: 12 }, { rules, seed: `s${n}` }).moves.map(entry => entry.name).join(','));
    assert.ok(names.size > 1, 'the seed picks the other moves');
    // An rng can be passed instead of a seed.
    const rngA = generateCreature({ name: 'Bog Wight', level: 4 }, { rules, rng: makeRng(3) });
    const rngB = generateCreature({ name: 'Bog Wight', level: 4 }, { rules, rng: makeRng(3) });
    assert.deepEqual(rngA, rngB);
});

test('generateCreature: two skills, three from the extra-skill level and for leaders and bosses', () => {
    assert.equal(generateCreature({ name: 'Road Thug', level: 3 }).moves.length, 2);
    assert.equal(generateCreature({ name: 'Road Thug', level: rules.generated.extraSkillLevel }).moves.length, 3);
    assert.equal(generateCreature({ name: 'Road Thug', level: 3, boss: true }).moves.length, 3);
    const chief = generateCreature({ name: 'Raider Chief', level: 3 });
    assert.equal(chief.template, 'leader');
    assert.equal(chief.moves.length, 3);
    assert.ok(chief.traits.includes('leader'));
    // A leader stands firmer: more morale, flees later.
    const thug = generateCreature({ name: 'Road Thug', level: 3 });
    const matriarch = generateCreature({ name: 'Wolf Matriarch', level: 3 });
    const wolf = generateCreature({ name: 'Marsh Wolf', level: 3 });
    assert.ok(matriarch.morale > wolf.morale);
    assert.ok(matriarch.fleesBelow <= rules.generated.leaderFleesBelow && wolf.fleesBelow > matriarch.fleesBelow);
    assert.ok(chief.morale > thug.morale);
    // A row's role wins over the template's.
    assert.equal(generateCreature({ name: 'Marsh Wolf', level: 3, role: 'tank' }).role, 'tank');
});

test('traits: known only, opposites resolved, at most three plus leader, multipliers bounded by the rules', () => {
    assert.deepEqual(cleanTraits(['swift', 'slow', 'sparkly', 'armoured', 'hulking', 'frail', 'fierce', 'leader']), ['swift', 'armoured', 'hulking', 'leader']);
    assert.deepEqual(traitMods([], rules), { hp: 1, attack: 1, defence: 1, agi: 1 });
    const armoured = traitMods(['armoured'], rules);
    assert.equal(armoured.defence, rules.generated.traits.armoured.defence);
    const stacked = traitMods(['hulking', 'leader'], makeRules({ generated: { modMax: 1.2 } }));
    assert.equal(stacked.hp, 1.2, 'capped');
    const construct = generateCreature({ name: 'Stone Golem', level: 5 });
    assert.ok(construct.mods.defence > 1 && construct.mods.agi < 1, 'armoured and slow');
    // A venomous creature's first harmful skill poisons; a regenerating one can heal itself.
    const spider = generateCreature({ name: 'Cave Spider', level: 5 });
    assert.ok(spider.skills[0].effect.includes('poison'));
    const troll = generateCreature({ name: 'Moss Troll', level: 5 });
    assert.ok(troll.traits.includes('regenerating'));
    assert.ok(troll.skills.some(entry => entry.effect.includes('regen')));
});

test('temperament sets morale and the flee threshold from the rules; a higher rank adds morale', () => {
    const low = generateCreature({ name: 'Marsh Wolf', level: 1 });
    const high = generateCreature({ name: 'Marsh Wolf', level: 40 });
    assert.equal(low.temperament, 'wild');
    assert.equal(low.fleesBelow, rules.generated.temperaments.wild.fleesBelow);
    assert.equal(low.morale, rules.generated.temperaments.wild.morale);
    assert.ok(high.morale > low.morale);
    const wight = generateCreature({ name: 'Bog Wight', level: 5 });
    assert.equal(wight.fleesBelow, 0, 'the mindless dead never flee');
});

test('loot: the template\'s materials named for the creature, gear from the rarity budget, the rank\'s potion', () => {
    const wolf = generateCreature({ name: 'Marsh Wolf', level: 12 });
    assert.deepEqual(wolf.loot.map(row => row.name), ['Marsh Wolf Pelt', 'Wolf Fang', 'Wolf-fang Charm', 'Greater Healing Draught']);
    const gear = wolf.loot.find(row => row.kind === 'equipment');
    assert.equal(gear.rarity, rules.generated.gearRarity[wolf.rank]);
    assert.equal(gear.stats.ATK, Math.round(rarityBudget(gear.rarity, 12, rules) * rules.generated.gearBudgetShare));
    for (const id of TEMPLATE_IDS) {
        const entry = generateCreature({ name: `Test ${id}`, level: 20 });
        for (const row of entry.loot) {
            assert.ok(['material', 'consumable', 'equipment'].includes(row.kind));
            assert.ok(row.chance > 0 && row.chance <= 100);
            if (row.kind === 'equipment') assert.ok(RARITIES.includes(row.rarity));
            if (row.kind === 'consumable') assert.match(row.effect, /^(heal|mp|cure)\b/);
        }
    }
    // A creature of a higher rank drops rarer gear.
    const late = generateCreature({ name: 'Marsh Wolf', level: 40 }).loot.find(row => row.kind === 'equipment');
    assert.ok(RARITIES.indexOf(late.rarity) > RARITIES.indexOf(gear.rarity));
});

test('projectEnemy fights a made-up creature: its level, skills built at the fight\'s level, its own loot', () => {
    const entry = generateCreature({ name: 'Marsh Wolf', level: 12 }, { seed: 'x' });
    const own = projectEnemy({ name: 'Marsh Wolf' }, { bestiary: [entry], rules, id: 'e1' });
    assert.equal(own.level, 12, 'no power on the row: its own level');
    assert.equal(own.role, 'skirmisher');
    assert.equal(own.generated, true);
    assert.equal(own.talks, false);
    assert.equal(own.morale, entry.morale);
    assert.deepEqual(own.skills.map(skill => skill.name), entry.skills.map(skill => skill.name));
    const bite = own.skills[0];
    assert.equal(bite.mp, 0, 'a monster\'s physical move costs no MP');
    assert.deepEqual(bite.effect, { bleed: rules.generated.effectRounds.bleed });
    assert.ok(Array.isArray(own.loot) && own.loot[0].name === 'Marsh Wolf Pelt');
    // A row's power wins, and the skills grow with the fight's level.
    const strong = projectEnemy({ name: 'Marsh Wolf', level: 30 }, { bestiary: [entry], rules });
    assert.equal(strong.level, 30);
    assert.ok(strong.skills[0].power > bite.power);
    const ranked = projectEnemy({ name: 'Marsh Wolf', rank: 'F' }, { bestiary: [entry], rules });
    assert.equal(ranked.level, rules.ranks.F.level);
    // Traits reach the numbers through `mods`.
    const plain = projectEnemy({ name: 'Foe', level: 12, role: 'skirmisher' }, { bestiary: [], rules });
    assert.ok(own.hp.max < plain.hp.max && own.stats.AGI > plain.stats.AGI, 'swift: quicker, a little less HP');
    // A boss gets its role's signature on top.
    const boss = projectEnemy({ name: 'Marsh Wolf', boss: true }, { bestiary: [entry], rules });
    assert.ok(boss.skills.some(skill => skill.name === 'Flurry'));
    // Its loot rolls from its own table.
    const drop = rollLoot({ ...own, boss: true }, { rng: makeRng(1), rules });
    const names = new Set(own.loot.map(row => row.name));
    for (const item of drop.items) assert.ok(names.has(item.name), item.name);
});

test('creatureSkill: the template machinery at the level, × skillPower, known conditions only, stuns wait', () => {
    const bite = creatureSkill({ name: 'Bite', type: 'physical', target: 'one', effect: ['bleed', 'glitter'], cooldown: 2 }, 1, rules);
    assert.equal(bite.mp, 0);
    assert.equal(bite.power, Math.round(rules.templates.physical.power * rules.generated.skillPower * 100) / 100);
    assert.deepEqual(bite.effect, { bleed: rules.generated.effectRounds.bleed });
    assert.equal(bite.cooldown, 2);
    const slam = creatureSkill({ name: 'Slam', type: 'physical', effect: ['stun'] }, 1, rules);
    assert.ok(slam.cooldown >= rules.generated.stunCooldown);
    // Harm stays on the harmful side: a buff does not poison, a bite does not shield.
    assert.equal(creatureSkill({ name: 'Ward', type: 'buff', target: 'self', effect: ['poison'] }).effect.shield > 0, true, 'the buff\'s own default');
    assert.equal(creatureSkill({ name: 'Bite', type: 'physical', effect: ['shield'] }).effect, null);
    const spell = creatureSkill({ name: 'Bolt', type: 'magic' }, 1, rules);
    assert.ok(spell.mp > 0, 'magic still costs MP');
});

test('the bestiary lookup order: the chat\'s creatures, then the shipped ones, then make it up', () => {
    const wolfOwn = cleanCreature({ ...generateCreature({ name: 'Wolf', level: 9 }), look: 'A black wolf of this story.' });
    const marsh = generateCreature({ name: 'Marsh Wolf', level: 4 });
    const chat = [wolfOwn, marsh];
    assert.deepEqual(lookupCreature('wolf', chat), { entry: wolfOwn, source: 'chat' });
    assert.equal(lookupCreature('Goblin', chat).source, 'default');
    assert.equal(lookupCreature('Goblin', chat).entry.name, 'Goblin');
    assert.equal(lookupCreature('Bog Wight', chat), null);
    assert.equal(combinedBestiary(chat)[0], wolfOwn, 'the chat first, so its Wolf wins');
    // Only names neither knows are made, once per name; the first row sets level and role.
    const made = creaturesToMake([
        { name: 'Marsh Wolf', level: 4 },
        { name: 'Goblin', level: 3 },
        { name: 'Bog Wight', level: 6, role: 'tank' },
        { name: 'bog wight', level: 20 },
        { name: 'Grave Wisp', level: 2, boss: true },
    ], { chatBestiary: chat, rules, seed: 'chat-1' });
    assert.deepEqual(made.map(entry => [entry.name, entry.level, entry.role]), [['Bog Wight', 6, 'tank'], ['Grave Wisp', 2, 'caster']]);
    // Stored: replacing the same name, newest last, capped.
    const stored = storeCreatures(chat, made);
    assert.deepEqual(stored.map(entry => entry.name), ['Wolf', 'Marsh Wolf', 'Bog Wight', 'Grave Wisp']);
    const again = storeCreatures(stored, [generateCreature({ name: 'marsh wolf', level: 30 })], 3);
    assert.deepEqual(again.map(entry => [entry.name, entry.level]), [['Bog Wight', 6], ['Grave Wisp', 2], ['Marsh Wolf', 30]]);
    assert.equal(DEFAULT_BESTIARY.some(entry => entry.generated), false);
});

test('cleanCreature: an imported or stored entry keeps its words, and its numbers come from them again', () => {
    const forged = {
        name: 'Bog Wight <script>', level: 9999, template: 'nonsense', role: 'god', traits: ['armoured', 'invincible', 'armoured'],
        temperament: 'relentless', morale: 999, fleesBelow: -5, mods: { hp: 50, attack: 50 },
        moves: [{ name: 'Death Touch', type: 'magic', target: 'all', effect: ['stun', 'doom', 'poison', 'burn'], cooldown: 99, power: 50 }],
        loot: [
            { name: 'Crown', chance: 900, qty: [1, 99], kind: 'equipment', rarity: 'mythic', stats: { ATK: 500, NOPE: 3 } },
            { name: 'Bad Potion', chance: 50, qty: [1, 1], kind: 'consumable', effect: 'kill everyone' },
            { name: 'Junk', chance: 50, kind: 'treasure' },
        ],
        look: 'x'.repeat(500),
    };
    const entry = cleanCreature(forged, rules);
    assert.equal(entry.name, 'Bog Wight script');
    assert.equal(entry.template, 'undead', 'an unknown template: from the name');
    assert.equal(entry.level, 999);
    assert.equal(entry.role, 'brute');
    assert.deepEqual(entry.traits, ['armoured']);
    assert.deepEqual(entry.mods, traitMods(['armoured'], rules));
    assert.ok(entry.morale <= 20 && entry.fleesBelow === 0);
    assert.deepEqual(entry.moves[0].effect, ['stun', 'poison']);
    assert.equal(entry.moves[0].cooldown, 6);
    assert.equal('power' in entry.moves[0], false);
    assert.equal(entry.loot.length, 1);
    assert.deepEqual(entry.loot[0], { name: 'Crown', chance: 100, qty: [1, 9], kind: 'equipment', rarity: 'common', stats: { ATK: 500 } });
    assert.equal(entry.look.length, 300);
    assert.equal(cleanCreature({ name: '  ' }), null);
    assert.equal(cleanCreature(null), null);
    // A clean entry comes back the same.
    const made = generateCreature({ name: 'Cave Spider', level: 7 });
    assert.deepEqual(cleanCreature(JSON.parse(JSON.stringify(made))), made);
    // No loot written: its kind's table.
    assert.ok(cleanCreature({ name: 'Ashen Drake', level: 5 }).loot.some(row => row.name === 'Drake Scale'));
    assert.ok(RANKS.includes(entry.rank));
});

// ---------------------------------------------------------------------------
// Kin (0.5.2): a new kind in a family the story already has is made as kin of its relative

test('familyOf: the creature noun and its family; plurals and compounds; a noun of its own', () => {
    assert.deepEqual(familyOf('Feral Ditch-Dog'), { noun: 'dog', family: 'canine' });
    assert.deepEqual(familyOf('Hellhound'), { noun: 'hound', family: 'canine' });
    assert.deepEqual(familyOf('razor dogs'), { noun: 'dog', family: 'canine' });
    assert.deepEqual(familyOf('Wolfdog'), { noun: 'dog', family: 'canine' }, 'a compound\'s ending');
    assert.deepEqual(familyOf('Mangy Cur'), { noun: 'cur', family: 'canine' });
    assert.deepEqual(familyOf('Giant Rats'), { noun: 'rat', family: 'rodent' });
    assert.deepEqual(familyOf('Cave Bear'), { noun: 'bear', family: 'ursine' });
    assert.deepEqual(familyOf('Bog Wight'), { noun: 'wight', family: 'wight' });
    assert.equal(familyTitle('canine'), 'Canines');
    assert.equal(familyTitle('wight'), 'Wights');
    assert.equal(familyTitle('golem'), 'Golems');
    assert.ok(Object.values(FAMILIES).every(list => list.every(noun => /^[a-z]+$/.test(noun))));
});

const ditchDog = () => cleanCreature(generateCreature({ name: 'Feral Ditch-Dog', level: 1 }, { seed: 'kin' }), rules);

test('kin: with a Feral Ditch-Dog in the story, a Razor Dog and a Hellhound are made as its kin', () => {
    const dog = { ...ditchDog(), role: 'brute', temperament: 'cunning', traits: ['hulking', 'savage'], talks: true, moves: [...ditchDog().moves, { name: 'Gutter Lunge', type: 'physical', stat: 'AGI', target: 'one', effect: ['stun'], cooldown: 3, description: 'Low and fast.' }] };
    const story = [cleanCreature(dog, rules)];
    const made = creaturesToMake([{ name: 'Razor Dog', level: 1 }, { name: 'Hellhound', level: 5, boss: true }], { chatBestiary: story, rules, seed: 'kin' });
    assert.deepEqual(made.map(entry => [entry.name, entry.kin, entry.family]), [['Razor Dog', 'Feral Ditch-Dog', 'canine'], ['Hellhound', 'Feral Ditch-Dog', 'canine']]);
    for (const entry of made) {
        assert.equal(entry.template, story[0].template);
        assert.equal(entry.role, 'brute', 'the relative\'s role');
        assert.equal(entry.temperament, 'cunning');
        assert.deepEqual(entry.traits, ['hulking', 'savage']);
        assert.equal(entry.talks, true);
        assert.equal(entry.fleesBelow, story[0].fleesBelow);
        assert.deepEqual(entry.moves.slice(0, story[0].moves.length).map(move => move.name), story[0].moves.map(move => move.name), 'its moves start from the relative\'s');
    }
    assert.equal(made[0].morale, story[0].morale, 'its behaviour: the same morale at the same rank');
    assert.ok(made[1].morale >= story[0].morale, 'and a little firmer at a higher rank, by its temperament');
    assert.deepEqual(made[0].loot.filter(row => row.kind === 'material').map(row => row.name), ['Razor Dog Pelt', 'Razor Dog Fang']);
    assert.deepEqual(made[1].loot.filter(row => row.kind === 'material').map(row => row.name), ['Hellhound Pelt', 'Hellhound Fang']);
    // Its own numbers: its own level and rank.
    assert.deepEqual(made.map(entry => [entry.level, entry.rank]), [[1, 'F'], [5, rankRowForLevel(5, rules).rank]]);
    // Kept in the chat (cleaned) with its kin and family.
    const kept = cleanCreature(made[0], rules);
    assert.equal(kept.kin, 'Feral Ditch-Dog');
    assert.equal(kept.family, 'canine');
    // A role word in its own name wins over the relative's.
    assert.equal(creaturesToMake([{ name: 'Dog Archer', level: 1 }], { chatBestiary: story, rules })[0].role, 'skirmisher');
});

test('kin: its level and XP follow its own threat word, not the relative\'s', () => {
    const story = [ditchDog()];
    const rows = resolveThreats([{ name: 'Razor Dog', count: 1, rank: null, threat: 'weak' }, { name: 'Hellhound', count: 1, rank: null, threat: 'strong' }], 1, rules);
    const made = creaturesToMake(rows, { chatBestiary: story, rules, seed: 'kin' });
    assert.deepEqual(made.map(entry => entry.kin), ['Feral Ditch-Dog', 'Feral Ditch-Dog']);
    const foes = enemiesFromRows(rows, { bestiary: combinedBestiary([...story, ...made]), library: [], rules, rng: null });
    assert.deepEqual(foes.map(foe => [foe.name, foe.level, foe.scale ?? 1, foeXpWorth(foe, 1, rules)]), [['Razor Dog', 1, 0.6, 5], ['Hellhound', 5, 1, 20]]);
});

test('kin: the same noun before the same family, the story\'s before the shipped, the newest first', () => {
    const dog = ditchDog();
    const marshWolf = cleanCreature(generateCreature({ name: 'Marsh Wolf', level: 1 }, { seed: 'kin' }), rules);
    // A wolf dog is a dog: the story's Feral Ditch-Dog, not its newer Marsh Wolf or the shipped Wolf.
    assert.equal(findKin('Wolf Dog', { chatBestiary: [dog, marshWolf] }).entry.name, 'Feral Ditch-Dog');
    assert.equal(findKin('Grey Hound', { chatBestiary: [dog, marshWolf] }).entry.name, 'Marsh Wolf', 'no hound: the newest canine');
    assert.equal(findKin('Wolf Pup', { chatBestiary: [] }).entry.name, 'Wolf', 'the shipped one when the story has none');
    assert.deepEqual(findKin('Wolf Pup', { chatBestiary: [] }), { entry: DEFAULT_BESTIARY.find(entry => entry.name === 'Wolf'), source: 'default' });
    // Kin of a shipped creature: its role, talk and coin, its skills as moves, its table's parts renamed.
    const pup = creaturesToMake([{ name: 'Wolf Pup', level: 1 }], { chatBestiary: [], rules })[0];
    assert.equal(pup.kin, 'Wolf');
    assert.equal(pup.role, 'skirmisher');
    assert.equal(pup.talks, false);
    assert.equal(pup.coins, false);
    assert.equal(pup.moves[0].name, 'Bite');
    assert.deepEqual(pup.loot.filter(row => row.kind === 'material').map(row => row.name), ['Wolf Pup Pelt', 'Wolf Pup Fang']);
});

test('kin: no relative, made as before; an exact or close match is never made at all', () => {
    const golem = creaturesToMake([{ name: 'Glass Golem', level: 3 }], { chatBestiary: [], rules, seed: 'kin' })[0];
    assert.equal(golem.kin, undefined);
    assert.equal(golem.family, 'golem');
    const plain = generateCreature({ name: 'Glass Golem', level: 3 }, { rules, seed: 'kin' });
    assert.deepEqual({ ...golem }, { ...plain }, 'exactly what it was before');
    const dog = ditchDog();
    assert.deepEqual(creaturesToMake([{ name: 'Feral Ditch-Dog', level: 1 }, { name: 'mangy ditch-dogs', level: 1 }, { name: 'young wolf', level: 1 }], { chatBestiary: [dog], rules }), []);
});

test('kin: the flavour call is told whose relative it is', () => {
    const razor = creaturesToMake([{ name: 'Razor Dog', level: 1 }], { chatBestiary: [ditchDog()], rules })[0];
    const [, user] = flavourPrompt(razor, { power: 'Level 1' });
    assert.match(user.content, /^Creature: Razor Dog \(a relative of the Feral Ditch-Dog: make its look fit that kin\)$/m);
    const [, plain] = flavourPrompt(ditchDog(), { power: 'Level 1' });
    assert.match(plain.content, /^Creature: Feral Ditch-Dog$/m);
});

test('a human foe is a person, with what people carry and their coin (0.5.35)', () => {
    for (const name of ['Hired Muscle', 'Dockside Enforcer', 'Cutpurse', 'Cult Fanatic', 'Village Militiaman', 'Grain Factor']) {
        assert.equal(templateFor(name), 'humanoid', name);
    }
    assert.equal(templateFor('Cultist'), 'caster');
    assert.equal(templateFor('Caiman'), 'generic');
    assert.ok(!generateCreature({ name: 'Hired Muscle', level: 3 }).loot.some(row => /trophy/i.test(row.name)));
    // One the chat kept as the catch-all before: a person now, its trophy table replaced.
    const old = { name: 'Hired Muscle', template: 'generic', level: 3, loot: [{ name: 'Muscle Trophy', chance: 55, qty: [1, 1], kind: 'material' }] };
    const now = upgradePerson(old);
    assert.equal(now.template, 'humanoid');
    assert.ok(now.loot.some(row => row.name === 'Whetstone'));
    assert.equal(upgradePerson({ ...old, name: 'Granary Cellar Brood-Mother' }).template, 'generic');
});
