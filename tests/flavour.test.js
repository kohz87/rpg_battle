// The flavour call's words (src/flavour.js): the prompt, a lenient parse that drops every
// number and every unknown word, and the mapping onto a template creature's knobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, RARITIES } from '../src/rules.js';
import { projectEnemy } from '../src/enemies.js';
import { FLAVOUR_SYSTEM, applyFlavour, flavourPrompt, parseFlavour, sceneText } from '../src/flavour.js';
import { cleanCreature, generateCreature, traitMods } from '../src/templates.js';

const rules = DEFAULT_RULES;
const wight = () => generateCreature({ name: 'Bog Wight', level: 12 }, { rules, seed: 'chat1' });

const ANSWER = [
    '**Look:** A drowned knight in rusted mail, 3 lanterns of marsh-light swinging from its ribs.',
    'Traits: armoured, slow, sparkly, +5 strength',
    'talks: no',
    'temperament: relentless',
    'skills: Drowning Grip — grab, weaken, 2d6 damage; Marsh Stench — all foes, poison; Lantern Glare (stun)',
    'loot: bog-iron shard (common), wight\'s lantern (legendary, MATK +12), 300 gold',
].join('\n');

test('parseFlavour: the six lines as words; numbers and unknown traits dropped', () => {
    const parsed = parseFlavour(ANSWER);
    assert.equal(parsed.look, 'A drowned knight in rusted mail, lanterns of marsh-light swinging from its ribs.');
    assert.deepEqual(parsed.traits, ['armoured', 'slow'], '"sparkly" and "+5 strength" are not traits');
    assert.equal(parsed.talks, false);
    assert.equal(parsed.temperament, 'relentless');
    assert.deepEqual(parsed.skills, [
        { name: 'Drowning Grip', words: ['grab', 'weaken', 'damage'] },
        { name: 'Marsh Stench', words: ['all', 'foes', 'poison'] },
        { name: 'Lantern Glare', words: ['stun'] },
    ]);
    assert.deepEqual(parsed.loot, [
        { name: 'Bog-Iron Shard', rarity: 'common', stat: null },
        { name: 'Wight\'s Lantern', rarity: 'legendary', stat: 'MATK' },
    ], 'money is the code\'s: "300 gold" is no item');
    assert.equal(JSON.stringify(parsed).match(/\d/), null, 'no digit survives');
});

test('parseFlavour: lenient about layout; never throws', () => {
    const parsed = parseFlavour([
        '# Bog Wight',
        '- LOOK = hunched, dripping',
        'Traits: Fast; Venomous',
        'Talks: yes, in a gurgle',
        'Temperament: sly and patient',
        'Skills:',
        '- Mire Lash: all enemies, slows',
        '- Grave Mend - heals itself',
        'Drops:',
        '* a cracked bog-pearl',
    ].join('\n'));
    assert.equal(parsed.look, 'hunched, dripping');
    assert.deepEqual(parsed.traits, ['swift', 'venomous']);
    assert.equal(parsed.talks, true);
    assert.equal(parsed.temperament, 'cunning', 'a synonym');
    assert.deepEqual(parsed.skills.map(skill => skill.name), ['Mire Lash', 'Grave Mend']);
    assert.deepEqual(parsed.loot, [{ name: 'Cracked Bog-Pearl', rarity: null, stat: null }]);
    for (const nonsense of ['', null, 'I cannot help with that.', '{"look": 5}', 'skills: ; ; —']) {
        const empty = parseFlavour(nonsense);
        assert.deepEqual(empty.traits, []);
        assert.equal(empty.temperament, null);
    }
    assert.equal(parseFlavour('talks: no, never').talks, false);
    assert.equal(parseFlavour('talks: maybe').talks, null);
});

test('applyFlavour: skills and loot renamed, words mapped to knobs, every number worked out again', () => {
    const before = wight();
    const after = applyFlavour(before, parseFlavour(ANSWER), { rules });
    assert.equal(after.flavoured, true);
    assert.equal(after.name, 'Bog Wight', 'the name stays');
    assert.equal(after.look.startsWith('A drowned knight'), true);
    assert.deepEqual(after.traits, ['armoured', 'slow']);
    assert.deepEqual(after.mods, traitMods(['armoured', 'slow'], rules));
    assert.equal(after.temperament, 'relentless');
    assert.equal(after.fleesBelow, 0);
    assert.equal(after.talks, false);
    // The template's three moves, renamed in order; the words become target, type and conditions.
    assert.equal(after.moves.length, before.moves.length);
    const [grip, stench, glare] = after.moves;
    assert.deepEqual([grip.name, grip.type, grip.target, grip.effect], ['Drowning Grip', before.moves[0].type, 'one', ['slow', 'weaken']]);
    assert.deepEqual([stench.name, stench.target, stench.effect], ['Marsh Stench', 'all', ['poison']]);
    assert.equal(glare.name, 'Lantern Glare');
    assert.deepEqual(glare.effect, ['stun']);
    assert.notEqual(glare.target, 'self', 'a harmful move aims at a foe');
    // The loot: materials and gear renamed, gear value from the budget, rarity capped one step up.
    const names = after.loot.map(row => row.name);
    assert.ok(names.includes('Bog-Iron Shard') && names.includes('Wight\'s Lantern'));
    const lantern = after.loot.find(row => row.name === 'Wight\'s Lantern');
    const own = rules.generated.gearRarity[after.rank];
    assert.equal(lantern.rarity, RARITIES[RARITIES.indexOf(own) + 1], 'legendary capped to one above the rank\'s');
    assert.deepEqual(Object.keys(lantern.stats), ['MATK']);
    assert.ok(lantern.stats.MATK < 12 * 10 && lantern.stats.MATK !== 12, 'the model\'s +12 is not taken');
    // The flavoured creature fights with its new names and the template's numbers.
    const enemy = projectEnemy({ name: 'Bog Wight' }, { bestiary: [after], rules });
    assert.deepEqual(enemy.skills.map(skill => skill.name), ['Drowning Grip', 'Marsh Stench', 'Lantern Glare']);
    assert.ok(enemy.skills[2].cooldown >= rules.generated.stunCooldown);
    // It survives being stored and read back.
    assert.deepEqual(cleanCreature(JSON.parse(JSON.stringify(after)), rules), after);
});

test('applyFlavour: nothing usable leaves the template creature as it was; a leader stays a leader', () => {
    const before = wight();
    assert.equal(applyFlavour(before, parseFlavour('I am sorry, I cannot.'), { rules }), before);
    assert.equal(applyFlavour(before, null, { rules }), before);
    const chief = generateCreature({ name: 'Raider Chief', level: 6 });
    const flavoured = applyFlavour(chief, parseFlavour('traits: hulking, fierce, swift, frail'), { rules });
    assert.deepEqual(flavoured.traits, ['hulking', 'fierce', 'swift', 'leader']);
    // A heal word turns a move into a heal on the friendly side; repeats keep the template's name.
    const healer = applyFlavour(wight(), parseFlavour('skills: Black Water — heals an ally; Black Water — all foes'), { rules });
    assert.equal(healer.moves[0].type, 'heal');
    assert.equal(healer.moves[0].target, 'ally');
    assert.equal(healer.moves[1].name, wight().moves[1].name);
    // A potion-like name renames the potion; gear for a template without any is added.
    const slime = generateCreature({ name: 'Acid Slime', level: 6 });
    const dressed = applyFlavour(slime, parseFlavour('loot: murky vial, slime-coated ring (rare, MDEF)'), { rules });
    assert.ok(dressed.loot.some(row => row.kind === 'consumable' && row.name === 'Murky Vial'));
    const ring = dressed.loot.find(row => row.kind === 'equipment');
    assert.equal(ring.name, 'Slime-Coated Ring');
    assert.equal(ring.chance, rules.generated.gearChance);
});

test('flavourPrompt: words only, the lists code reads, the creature, its power and the scene', () => {
    const [system, user] = flavourPrompt(wight(), { power: 'Soul Class II', party: 'Soul Class I', scene: 'Ren: We wade into the bog.' });
    assert.equal(system.role, 'system');
    assert.equal(system.content, FLAVOUR_SYSTEM);
    for (const part of ['never write a number', 'look:', 'traits:', 'talks:', 'temperament:', 'skills:', 'loot:', 'armoured', 'relentless', 'all foes', 'MATK']) {
        assert.ok(system.content.includes(part), part);
    }
    assert.equal(user.role, 'user');
    for (const part of ['Creature: Bog Wight', 'Power: Soul Class II; the party is Soul Class I', 'Kind: undead', 'Skills (3): Bone Claw (one foe, weaken)', 'Ren: We wade into the bog.']) {
        assert.ok(user.content.includes(part), part);
    }
    assert.ok(user.content.length < 1500);
});

test('sceneText: the latest story as prose, hidden blocks out, the last N words', () => {
    const scene = sceneText([
        { name: 'Ren', text: 'We wade in. <!-- hidden envelope --> <Wounds>Ren — scratch: reeds</Wounds>' },
        { name: 'Narrator', text: 'The water stirs.\n\n<Encounter>3 bog wight</Encounter>' },
        { name: 'Empty', text: '' },
    ]);
    assert.equal(scene, 'Ren: We wade in.\nNarrator: The water stirs.');
    const long = sceneText([{ name: 'N', text: Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ') }], 10);
    assert.ok(long.startsWith('… '));
    assert.ok(long.endsWith('w49'));
    assert.equal(long.split(' ').length, 11);
    assert.equal(sceneText(null), '');
});
