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
import { STORY_INSTRUCTION, THREATS, applyWounds, describeWound, guessSkill, parseEncounter, parseHints, parseJoins, parseLearned, parseLeaves, parseRest, parseWounds, parseXp, resolveThreats, threatLevel } from '../src/story.js';

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

test('encounter: unknown names kept (singular only for a creature word), notes in brackets, roles written last, counts capped', () => {
    assert.deepEqual(parseEncounter('1 bog wight (boss, rank C) tank'), [{ name: 'Bog Wight', count: 1, rank: 'C', role: 'tank', boss: true }]);
    // "wight" is a word the creature templates know, so its plural is three of one creature;
    // a name made of words nobody knows is kept as written.
    assert.deepEqual(parseEncounter('3 bog wights'), [{ name: 'Bog Wight', count: 3, rank: null, role: null, boss: false }]);
    assert.deepEqual(parseEncounter('2 marsh wolves'), [{ name: 'Marsh Wolf', count: 2, rank: null, role: null, boss: false }]);
    assert.deepEqual(parseEncounter('2 Ashen Vyrrks'), [{ name: 'Ashen Vyrrks', count: 2, rank: null, role: null, boss: false }]);
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

// 0.3 added the threat words (about 15 tokens), so the bound moved from 95 to 110; 0.4 makes it
// one instruction for every hidden block (Joins, Leaves, Learned, XP, Rest, waves): 170.
test('the story instruction is compact (about 170 tokens) and names every tag, the grammar and the threat words', () => {
    const pieces = STORY_INSTRUCTION.match(/[A-Za-z]+|\d+|[^\sA-Za-z\d]/g).length;
    assert.ok(STORY_INSTRUCTION.length <= 680, `${STORY_INSTRUCTION.length} characters`);
    assert.ok(Math.ceil(STORY_INSTRUCTION.length / 4) <= 170, 'about 170 tokens at four characters a token');
    assert.ok(pieces <= 200, `${pieces} words and marks`);
    for (const part of ['<Wounds>', '<Encounter>', '<Joins>', '<Leaves>', '<Learned>', '<XP>', '<Rest>', 'scratch|wound|severe|grievous', 'heal', 'poisoned', 'Party sheet', 'not for an RPG Battle fight', 'stop at the first blow', 'trivial|weak|even|strong|deadly', 'minor|major|milestone', 'short|long', 'then:']) {
        assert.ok(STORY_INSTRUCTION.includes(part), part);
    }
    // Its own examples read back as the grammar says.
    assert.deepEqual(parseWounds('Ren — heal wound: x').map(entry => entry.kind), ['heal']);
    assert.deepEqual(parseEncounter(STORY_INSTRUCTION.match(/<Encounter>(.*?)<\/Encounter>/)[1]).map(row => [row.name, row.boss, row.threat, row.wave ?? 0]), [['Wolf', false, 'weak', 0], ['Wolf Matriarch', true, 'strong', 1]]);
    const example = tag => STORY_INSTRUCTION.match(new RegExp(`<${tag}>(.*?)</${tag}>`))[1];
    assert.deepEqual(parseJoins(example('Joins'), rules).map(entry => [entry.name, entry.role, entry.level]), [['Lyra', 'healer', 6]]);
    assert.deepEqual(parseLeaves(example('Leaves')).map(entry => [entry.name, entry.reason]), [['Lyra', 'went home']]);
    assert.deepEqual(parseLearned(example('Learned')).map(entry => [entry.name, entry.skill, entry.words]), [['Lyra', 'Frost Lance', 'ice magic, hits all']]);
    assert.deepEqual(parseXp('major: rescued the caravan'), [{ kind: 'major', reason: 'rescued the caravan', line: 'major: rescued the caravan' }]);
    assert.deepEqual(parseRest('long: slept at the inn').map(entry => entry.kind), ['long']);
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

// ---------------------------------------------------------------------------
// Threat words

test('parseEncounter: a threat word in brackets or before the name, kept only without a written power', async () => {
    const { makeRules } = await import('../src/rules.js');
    assert.deepEqual(parseEncounter('3 marsh wolf (weak), wolf matriarch (boss, strong)'), [
        { name: 'Marsh Wolf', count: 3, rank: null, role: null, boss: false, threat: 'weak' },
        { name: 'Wolf Matriarch', count: 1, rank: null, role: null, boss: true, threat: 'strong' },
    ]);
    assert.deepEqual(parseEncounter('3 weak marsh wolves and a deadly wyvern'), [
        { name: 'Marsh Wolf', count: 3, rank: null, role: null, boss: false, threat: 'weak' },
        { name: 'Wyvern', count: 1, rank: null, role: null, boss: false, threat: 'deadly' },
    ]);
    // Synonyms, by what they mean.
    const threatOf = text => parseEncounter(text)[0].threat ?? null;
    assert.equal(threatOf('rat (minor)'), 'weak');
    assert.equal(threatOf('rat (lesser)'), 'weak');
    assert.equal(threatOf('rat (puny)'), 'trivial');
    assert.equal(threatOf('rat (fair)'), 'even');
    assert.equal(threatOf('rat (tough)'), 'strong');
    assert.equal(threatOf('rat (elite, caster)'), 'deadly');
    assert.equal(threatOf('rat (calamity)'), 'deadly');
    // Before a name, only words that are never part of one: "Lesser Demon" and "High Priest" are names.
    assert.deepEqual(parseEncounter('lesser demon'), [{ name: 'Lesser Demon', count: 1, rank: null, role: null, boss: false }]);
    assert.deepEqual(parseEncounter('high priest (deadly)'), [{ name: 'High Priest', count: 1, rank: null, role: null, boss: false, threat: 'deadly' }]);
    assert.deepEqual(parseEncounter('2 tough bandits'), [{ name: 'Bandit', count: 2, rank: null, role: null, boss: false, threat: 'strong' }]);
    // A power written outright wins over the threat word.
    assert.deepEqual(parseEncounter('bandit (strong, rank D)'), [{ name: 'Bandit', count: 1, rank: 'D', role: null, boss: false }]);
    const soul = makeRules({ terms: { levelName: 'Soul Class', tiers: { size: 10 } } });
    assert.deepEqual(parseEncounter('wolf (deadly, Soul Class II)', undefined, soul), [{ name: 'Wolf', count: 1, rank: null, role: null, boss: false, level: 11 }]);
    assert.deepEqual(THREATS, ['trivial', 'weak', 'even', 'strong', 'deadly']);
});

test('threatLevel: the party\'s level plus steps of rules.threat; a step is a tier with tier titles on', async () => {
    const { DEFAULT_RULES, makeRules } = await import('../src/rules.js');
    const step = DEFAULT_RULES.threat.step;
    assert.equal(threatLevel('even', 10), 10);
    assert.equal(threatLevel('weak', 10), 10 - step);
    assert.equal(threatLevel('strong', 10), 10 + step);
    assert.equal(threatLevel('deadly', 10), 10 + 2 * step);
    assert.equal(threatLevel('trivial', 10), 10 - 2 * step);
    assert.equal(threatLevel('trivial', 3), 1, 'never below level 1');
    assert.equal(threatLevel('nonsense', 10), null);
    const soul = makeRules({ terms: { levelName: 'Soul Class', tiers: { size: 10 }, cap: 50 } });
    assert.equal(threatLevel('strong', 24, soul), 34, 'one tier up');
    assert.equal(threatLevel('deadly', 45, soul), 50, 'never past the cap');
    assert.equal(threatLevel('strong', 10, makeRules({ threat: { step: 2 } })), 12);
    // Rows: a threat becomes a level, kept beside it; written powers stay as they are.
    assert.deepEqual(resolveThreats([
        { name: 'Marsh Wolf', count: 3, rank: null, threat: 'weak' },
        { name: 'Bandit', count: 1, rank: 'D' },
        { name: 'Ogre', count: 1, rank: null, level: 12, threat: 'deadly' },
        { name: 'Goblin', count: 1, rank: null },
    ], 9), [
        { name: 'Marsh Wolf', count: 3, rank: null, threat: 'weak', level: 9 - step },
        { name: 'Bandit', count: 1, rank: 'D' },
        { name: 'Ogre', count: 1, rank: null, level: 12, threat: 'deadly' },
        { name: 'Goblin', count: 1, rank: null },
    ]);
});

// ---------------------------------------------------------------------------
// 0.4: the party's story

test('Joins: name, role, level in any form, hints for level, focus and skills', () => {
    const soul = makeRules({ terms: { levelName: 'Soul Class', tiers: { size: 10, numerals: 'roman' } } });
    assert.deepEqual(parseJoins('Lyra — healer, level 6\n- **Bram** – old soldier, Lv 3\nMira'), [
        { name: 'Lyra', role: 'healer', level: 6, focus: [], skills: [], line: 'Lyra — healer, level 6' },
        { name: 'Bram', role: 'old soldier', level: 3, focus: [], skills: [], line: 'Bram – old soldier, Lv 3' },
        { name: 'Mira', role: '', level: null, focus: [], skills: [], line: 'Mira' },
    ]);
    assert.equal(parseJoins('Kael — scout (Soul Class II)'.replace(' (', ', ').replace(')', ''), soul)[0].level, 11);
    const hinted = parseJoins('Lyra — healer, level 3 | focus: int, VIT, xyz | skills: Frost Lance, Mend', rules)[0];
    assert.deepEqual([hinted.level, hinted.focus, hinted.skills], [3, ['INT', 'VIT'], ['Frost Lance', 'Mend']]);
    assert.equal(parseJoins('Lyra — healer, level 400', rules)[0].level, rules.character.maxLevel, 'capped');
    assert.deepEqual(parseJoins('none\n</Joins>'), []);
});

test('Leaves, XP and Rest lines', () => {
    assert.deepEqual(parseLeaves('Lyra: returned to her village\nBram — stayed behind.'), [
        { name: 'Lyra', reason: 'returned to her village', line: 'Lyra: returned to her village' },
        { name: 'Bram', reason: 'stayed behind', line: 'Bram — stayed behind.' },
    ]);
    assert.deepEqual(parseXp('Major: rescued the caravan\nhuge: nope\nmilestone — the dragon is dead').map(entry => [entry.kind, entry.reason]), [['major', 'rescued the caravan'], ['milestone', 'the dragon is dead']]);
    assert.deepEqual(parseRest('nap\nLong rest: slept at the inn\nshort: tea'), [{ kind: 'long', reason: 'slept at the inn', line: 'Long rest: slept at the inn' }]);
    assert.deepEqual(parseRest(''), []);
});

test('Learned: who, the skill and its words; hints validated; a template guessed from the words', () => {
    const [line] = parseLearned('You — Shadow Step: dash behind a foe | type: physical, stat: agi, target: one, effect: stun, colour: red');
    assert.deepEqual([line.name, line.skill, line.words], ['You', 'Shadow Step', 'dash behind a foe']);
    assert.deepEqual(line.hints, { type: 'physical', stat: 'AGI', target: 'one', element: 'lightning' });
    assert.deepEqual(guessSkill(line.words, line.hints), { type: 'physical', stat: 'AGI', target: 'one', element: 'lightning' });
    assert.deepEqual(parseHints('type: wizardry, stat: MIGHT, target: everyone'), {}, 'unknown words are dropped');
    assert.deepEqual(guessSkill('ice magic, hits all'), { type: 'magic', stat: 'INT', target: 'all', element: 'ice' });
    assert.deepEqual(guessSkill('heals the whole party'), { type: 'heal', stat: 'INT', target: 'allies', element: 'none' });
    assert.deepEqual(guessSkill('a quick shot that poisons'), { type: 'physical', stat: 'DEX', target: 'one', element: 'poison' });
    assert.deepEqual(guessSkill('a protective ward'), { type: 'buff', stat: 'INT', target: 'self', element: 'none' });
    assert.deepEqual(guessSkill('a heavy swing'), { type: 'physical', stat: 'STR', target: 'one', element: 'none' });
    assert.deepEqual(parseLearned('Lyra learned a lot\nLyra — : nothing'), []);
});

test('encounter: "then:" starts the next engagement, fought back to back', () => {
    assert.deepEqual(parseEncounter('3 bandit; then: bandit captain (boss), 2 wolves\nthen 1 ogre').map(row => [row.name, row.count, row.wave ?? 0]), [
        ['Bandit', 3, 0], ['Bandit Captain', 1, 1], ['Wolf', 2, 1], ['Ogre', 1, 2],
    ]);
});
