// Story wounds and fights from the story: the <Wounds> grammar, applying it to the sheets
// (one blow per person, 0 HP allowed, healing capped, conditions and cures, names by first
// name), the <Encounter> grammar, and the instruction's length.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRules } from '../src/rules.js';
import { DEFAULT_BESTIARY } from '../src/enemies.js';
import { PRESETS } from '../src/skills.js';
import { newSheet } from '../src/sheet.js';
import { newCompanion } from '../src/party.js';
import { STORY_INSTRUCTION, applyWounds, describeWound, parseEncounter, parseWounds } from '../src/story.js';

const rules = makeRules();
const ren = { ...newSheet({ name: 'Ren Aldane', stats: PRESETS[0].points, skills: PRESETS[0].skills }, rules), hp: { cur: 98, max: 98 } };
const astra = newCompanion({ name: 'Astra', role: 'mage', preset: PRESETS[2] }, { rules });
const merrit = newCompanion({ name: 'Merrit Vane', role: 'hireling', preset: PRESETS[0] }, { rules, existing: [astra] });

// ---------------------------------------------------------------------------
// parseWounds

test('wounds: harm, heal, condition and cure lines, leniently written', () => {
    const wounds = parseWounds([
        '<Wounds>',
        'Ren — wound: fell down the ravine',
        '- **Astra** – heal scratch: a poultice',
        '* merrit - SEVERE: a crossbow bolt.',
        'Ren — poisoned: a dart in the dark',
        '1. Astra -- cure poison: an antidote',
        'Ren — treated wound: the healer',
        'Ren — healed',
        '</Wounds>',
    ].join('\n'));
    assert.deepEqual(wounds, [
        { name: 'Ren', kind: 'harm', severity: 'wound', cause: 'fell down the ravine' },
        { name: 'Astra', kind: 'heal', severity: 'scratch', cause: 'a poultice' },
        { name: 'merrit', kind: 'harm', severity: 'severe', cause: 'a crossbow bolt' },
        { name: 'Ren', kind: 'condition', condition: 'poisoned', cause: 'a dart in the dark' },
        { name: 'Astra', kind: 'cure', condition: 'poison', cause: 'an antidote' },
        { name: 'Ren', kind: 'heal', severity: 'wound', cause: 'the healer' },
        { name: 'Ren', kind: 'heal', severity: 'scratch', cause: '' },
    ]);
});

test('wounds: the worst severity word counts; causes in brackets or after a dash; nothing lines skipped', () => {
    assert.deepEqual(parseWounds('Ren — grievously wounded (crushed by the cart)'), [{ name: 'Ren', kind: 'harm', severity: 'grievous', cause: 'crushed by the cart' }]);
    assert.deepEqual(parseWounds('Ren — severe wound — a sabre cut'), [{ name: 'Ren', kind: 'harm', severity: 'severe', cause: 'a sabre cut' }]);
    assert.deepEqual(parseWounds('Mary-Jane — scratched'), [{ name: 'Mary-Jane', kind: 'harm', severity: 'scratch', cause: '' }], 'a hyphenated name keeps its hyphen');
    assert.deepEqual(parseWounds('Ren — unhurt: dodged\nRen — none\nRen wounded\nRen — a long story about how he tripped over things'), []);
    assert.deepEqual(parseWounds(''), []);
    assert.deepEqual(parseWounds(null), []);
});

// ---------------------------------------------------------------------------
// applyWounds

test('apply: a share of max HP per word, by full or first name, the sheets passed in untouched', () => {
    const sheets = { pc: ren, members: [astra, merrit] };
    const { pc, members, applied } = applyWounds(sheets, parseWounds('Ren — wound: fell down the ravine\nMerrit — scratch: brambles'), rules);
    assert.equal(pc.hp.cur, 98 - 29, 'a wound is 30 % of 98, rounded');
    assert.equal(members[1].sheet.hp.cur, merrit.sheet.hp.cur - Math.round(merrit.sheet.hp.max * 0.1));
    assert.equal(members[0].sheet.hp.cur, astra.sheet.hp.cur, 'Astra was not named');
    assert.deepEqual(applied[0], { name: 'Ren Aldane', memberId: 'pc', kind: 'harm', severity: 'wound', hp: -29, condition: null, cause: 'fell down the ravine', down: false });
    assert.equal(applied[1].memberId, merrit.id);
    assert.equal(describeWound(applied[0]), 'Ren Aldane: wound (−29 HP), fell down the ravine.');
    assert.equal(ren.hp.cur, 98, 'pure');
    assert.equal(merrit.sheet.hp.cur, merrit.sheet.hp.max, 'pure');
});

test('apply: one harm-or-heal line per person (the first wins); conditions alongside', () => {
    const { pc, applied } = applyWounds({ pc: ren, members: [] }, parseWounds('Ren — scratch: a branch\nRen — grievous: the same fall\nRen — heal wound: oops\nRen — exhausted: the climb'), rules);
    assert.equal(pc.hp.cur, 98 - 10);
    assert.deepEqual(applied.map(entry => entry.kind), ['harm', 'condition']);
    assert.deepEqual(pc.conditions, [{ name: 'exhausted', rounds: null }]);
});

test('apply: harm can take someone to 0 HP (down); healing never goes above max', () => {
    const hurt = { ...ren, hp: { cur: 20, max: 98 } };
    const down = applyWounds({ pc: hurt, members: [] }, parseWounds('Ren — grievous: the bridge gives way'), rules);
    assert.equal(down.pc.hp.cur, 0);
    assert.equal(down.applied[0].hp, -20, 'the change actually made');
    assert.equal(down.applied[0].down, true);
    assert.match(describeWound(down.applied[0]), /\(−20 HP, down\)/);
    const healed = applyWounds({ pc: { ...ren, hp: { cur: 90, max: 98 } }, members: [] }, parseWounds('Ren — heal severe: a priest'), rules);
    assert.equal(healed.pc.hp.cur, 98);
    assert.equal(healed.applied[0].hp, 8);
    assert.equal(describeWound(healed.applied[0]), 'Ren Aldane: heal severe (+8 HP), a priest.');
    const full = applyWounds({ pc: ren, members: [] }, parseWounds('Ren — heal wound: rest'), rules);
    assert.deepEqual(full.applied, [], 'a heal that changes nothing is not reported');
    const zero = applyWounds({ pc: { ...ren, hp: { cur: 0, max: 98 } }, members: [] }, parseWounds('Ren — wound: kicked while down'), rules);
    assert.deepEqual(zero.applied, []);
});

test('apply: a condition once (poisoned is poison), a cure removes it, unknown names are ignored', () => {
    const poisoned = { ...ren, conditions: [{ name: 'poison', rounds: 2 }, { name: 'cursed', rounds: null }] };
    const again = applyWounds({ pc: poisoned, members: [] }, parseWounds('Ren — poisoned: another dart'), rules);
    assert.deepEqual(again.applied, [], 'already poisoned');
    const cured = applyWounds({ pc: poisoned, members: [] }, parseWounds('Ren — cure poison: an antidote\nRen — cure curse: holy water\nRen — cure exhaustion: sleep'), rules);
    assert.deepEqual(cured.pc.conditions, []);
    assert.deepEqual(cured.applied.map(entry => describeWound(entry)), ['Ren Aldane: cured poison, an antidote.', 'Ren Aldane: cured curse, holy water.']);
    const stranger = applyWounds({ pc: ren, members: [astra] }, parseWounds('Gareth — grievous: an arrow\nRenwick — wound: a fall'), rules);
    assert.deepEqual(stranger.applied, []);
});

test('apply: custom shares from the rules; no character sheet, only the party', () => {
    const harsh = makeRules({ wounds: { scratch: 0.25 } });
    const { pc } = applyWounds({ pc: ren, members: [] }, parseWounds('Ren — scratch: thorns'), harsh);
    assert.equal(pc.hp.cur, 98 - Math.round(98 * 0.25));
    const party = applyWounds({ pc: null, members: [astra] }, parseWounds('Astra — wound: a fall'), rules);
    assert.equal(party.pc, null);
    assert.equal(party.members[0].sheet.hp.cur, astra.sheet.hp.max - Math.round(astra.sheet.hp.max * 0.3));
});

// ---------------------------------------------------------------------------
// parseEncounter

test('encounter: counts, bosses, ranks and roles; plurals made singular for bestiary creatures', () => {
    assert.deepEqual(parseEncounter('3 bandit, bandit captain (boss)', DEFAULT_BESTIARY), [
        { name: 'Bandit', count: 3, rank: null, role: null, boss: false },
        { name: 'Bandit Captain', count: 1, rank: null, role: null, boss: true },
    ]);
    assert.deepEqual(parseEncounter('2 x dire wolf rank D'), [{ name: 'Dire Wolf', count: 2, rank: 'D', role: null, boss: false }]);
    assert.deepEqual(parseEncounter('3 bandits and a goblin shaman'), [
        { name: 'Bandit', count: 3, rank: null, role: null, boss: false },
        { name: 'Goblin Shaman', count: 1, rank: null, role: null, boss: false },
    ]);
    assert.deepEqual(parseEncounter('two wolves; 4× slimes\n3x giant rats'), [
        { name: 'Wolf', count: 2, rank: null, role: null, boss: false },
        { name: 'Slime', count: 4, rank: null, role: null, boss: false },
        { name: 'Giant Rat', count: 3, rank: null, role: null, boss: false },
    ]);
});

test('encounter: unknown names kept (and not singularised), notes in brackets, roles written last, counts capped', () => {
    assert.deepEqual(parseEncounter('1 bog wight (boss, rank C) tank'), [{ name: 'Bog Wight', count: 1, rank: 'C', role: 'tank', boss: true }]);
    assert.deepEqual(parseEncounter('3 bog wights'), [{ name: 'Bog Wights', count: 3, rank: null, role: null, boss: false }]);
    assert.deepEqual(parseEncounter('bandit caster x2'), [{ name: 'Bandit', count: 2, rank: null, role: 'caster', boss: false }]);
    assert.deepEqual(parseEncounter('a pair of brigands'), [{ name: 'Brigand', count: 2, rank: null, role: null, boss: false }], 'an alias keeps its own name');
    assert.deepEqual(parseEncounter('12 goblins'), [{ name: 'Goblin', count: 9, rank: null, role: null, boss: false }]);
    assert.deepEqual(parseEncounter('Caster'), [{ name: 'Caster', count: 1, rank: null, role: null, boss: false }], 'a name that is only a role word stays a name');
    assert.deepEqual(parseEncounter('the Hollow King (boss) rank SS'), [{ name: 'Hollow King', count: 1, rank: 'SS', role: null, boss: true }]);
    assert.deepEqual(parseEncounter(''), []);
    assert.deepEqual(parseEncounter('none'), []);
});

// ---------------------------------------------------------------------------
// The instruction

test('the story instruction is short (about 90 tokens) and names both tags and the grammar', () => {
    const pieces = STORY_INSTRUCTION.match(/[A-Za-z]+|\d+|[^\sA-Za-z\d]/g).length;
    assert.ok(STORY_INSTRUCTION.length <= 380, `${STORY_INSTRUCTION.length} characters`);
    assert.ok(Math.ceil(STORY_INSTRUCTION.length / 4) <= 95, 'about 90 tokens at four characters a token');
    assert.ok(pieces <= 92, `${pieces} words and marks`);
    for (const part of ['<Wounds>', '<Encounter>', 'scratch|wound|severe|grievous', 'heal', 'poisoned', 'Character or Party sheet', 'not an RPG Battle fight', 'stop at the first blow']) {
        assert.ok(STORY_INSTRUCTION.includes(part), part);
    }
    // Its own examples read back as the grammar says.
    assert.deepEqual(parseWounds('Ren — heal wound: x').map(entry => entry.kind), ['heal']);
    assert.equal(parseEncounter(STORY_INSTRUCTION.match(/<Encounter>(.*?)<\/Encounter>/)[1]).length, 2);
});

test('parseEncounter: a power in the reader\'s terms becomes the row\'s level', async () => {
    const { makeRules } = await import('../src/rules.js');
    const soul = makeRules({ terms: { levelName: 'Soul Class', tiers: { size: 10, numerals: 'roman' } } });
    assert.deepEqual(parseEncounter('3 wolf (Soul Class I), bandit captain (boss, Soul Class II)', DEFAULT_BESTIARY, soul), [
        { name: 'Wolf', count: 3, rank: null, role: null, boss: false, level: 1 },
        { name: 'Bandit Captain', count: 1, rank: null, role: null, boss: true, level: 11 },
    ]);
    assert.deepEqual(parseEncounter('2 ogres (level 12)', DEFAULT_BESTIARY, soul), [{ name: 'Ogre', count: 2, rank: null, role: null, boss: false, level: 12 }]);
    assert.deepEqual(parseEncounter('bog wight (Lv 24, caster)'), [{ name: 'Bog Wight', count: 1, rank: null, role: 'caster', boss: false, level: 24 }], 'plain terms read "level"/"Lv" too');
    // A bare numeral is not a power, and "rank D" stays a rank even where levels are called Rank.
    assert.deepEqual(parseEncounter('bandit (II)', DEFAULT_BESTIARY, soul), [{ name: 'Bandit', count: 1, rank: null, role: null, boss: false }]);
    const ranked = makeRules({ terms: { levelName: 'Rank', tiers: { size: 10 } } });
    assert.deepEqual(parseEncounter('bandit (boss, rank D)', DEFAULT_BESTIARY, ranked), [{ name: 'Bandit', count: 1, rank: 'D', role: null, boss: true }]);
    assert.deepEqual(parseEncounter('bandit (Rank III)', DEFAULT_BESTIARY, ranked), [{ name: 'Bandit', count: 1, rank: null, role: null, boss: false, level: 21 }]);
});
