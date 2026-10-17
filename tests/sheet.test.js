import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, makeRules, maxHp, maxMp, xpToNext } from '../src/rules.js';
import {
    applyResult, formatCharacter, formatParty, learnSkill, newSheet, parseCharacter, parseParty, recompute, slug, spendPoints,
} from '../src/sheet.js';

const R = DEFAULT_RULES;

const REN = [
    'Name: Ren',
    'Level: 4 | XP: 310/800 | Points: 2',
    'HP: 58/62 | MP: 21/30',
    'STR: 9 | VIT: 7 | AGI: 8 | DEX: 8 | INT: 4 | LUK: 5 | CHA: 6',
    'Checks: STR +2 | VIT +1 | AGI +1 | DEX +1 | INT -1 | LUK +0 | CHA +0',
    'State: unhurt',
    'Skills: Rending Strike (Lv 2) | Guard Break | Second Wind',
    'Conditions: none',
].join('\n');

const PARTY = [
    '## Astra — companion | control: auto',
    'Level: 4 | XP: 120/800 | Points: 0',
    'HP: 44/44 | MP: 38/38',
    'State: unhurt',
    'STR: 4 | VIT: 5 | AGI: 7 | DEX: 6 | INT: 10 | LUK: 4 | CHA: 7',
    'Skills: Ember Lance | Mend | Ward',
    'Equipped: Ashwood Staff (rare) · MATK +7, INT +1 | Traveller\'s Robe (common) · DEF +2, MDEF +3',
    '',
    '## Merrit — hireling | control: command',
    'Level: 4 | XP: 120/800 | Points: 0',
    'HP: 20/94 | MP: 22/30',
    'State: badly hurt (bleeding, slow to move) · poisoned',
    'STR: 8 | VIT: 8 | AGI: 5 | DEX: 6 | INT: 3 | LUK: 4 | CHA: 4',
    'Skills: Shield Bash (Lv 3)',
    'Conditions: poisoned (2)',
].join('\n');

function result(overrides = {}) {
    return {
        outcome: 'victory', rounds: 4, seconds: 24, stakes: 'normal',
        party: [{ memberId: 'pc', name: 'Ren', hp: { cur: 30, max: 62 }, mp: { cur: 10, max: 30 }, down: false, conditions: [] }],
        enemies: [], defeated: [], fled: [], parleyed: [],
        xp: { pc: 0 }, loot: { items: [], money: 0 }, keyMoments: [],
        uses: {}, itemsUsed: {},
        ...overrides,
    };
}

test('newSheet starts at level 1 with full HP/MP and spends exactly the start points', () => {
    const sheet = newSheet({ name: 'Ren', stats: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, skills: ['Rending Strike', 'Guard Break', 'Second Wind'] }, R);
    assert.equal(sheet.level, 1);
    assert.equal(sheet.xp, 0);
    assert.equal(sheet.points, 0);
    assert.deepEqual(sheet.stats, { STR: 9, VIT: 7, AGI: 7, DEX: 7, INT: 5, LUK: 5, CHA: 5 });
    assert.deepEqual(sheet.hp, { cur: maxHp(sheet.stats, 1, R), max: maxHp(sheet.stats, 1, R) });
    assert.deepEqual(sheet.mp, { cur: maxMp(sheet.stats, 1, R), max: maxMp(sheet.stats, 1, R) });
    assert.deepEqual(sheet.skills.map(skill => [skill.name, skill.mastery]), [['Rending Strike', 1], ['Guard Break', 1], ['Second Wind', 1]]);
    assert.deepEqual(sheet.conditions, []);
    assert.deepEqual(sheet.uses, {});
    assert.throws(() => newSheet({ name: 'Ren', stats: { STR: 9 } }, R), /exactly 10/);
    assert.throws(() => newSheet({ name: 'Ren', stats: { STR: 11 } }, R), /exactly 10/);
    assert.throws(() => newSheet({ name: 'Ren', stats: { STR: 12, VIT: -2 } }, R), /0 or more/);
    assert.throws(() => newSheet({ name: 'Ren', stats: { STR: 9.5, VIT: 0.5 } }, R), /whole number/);
    assert.throws(() => newSheet({ name: '', stats: { STR: 10 } }, R), /name/);
});

test('the canonical Character text round-trips exactly', () => {
    const { sheet, errors } = parseCharacter(REN, R);
    assert.deepEqual(errors, []);
    assert.equal(sheet.name, 'Ren');
    assert.equal(sheet.level, 4);
    assert.equal(sheet.xp, 310);
    assert.equal(sheet.points, 2);
    assert.deepEqual(sheet.hp, { cur: 58, max: 62 });
    assert.deepEqual(sheet.mp, { cur: 21, max: 30 });
    assert.deepEqual(sheet.skills, [{ name: 'Rending Strike', mastery: 2 }, { name: 'Guard Break', mastery: 1 }, { name: 'Second Wind', mastery: 1 }]);
    assert.equal(formatCharacter(sheet, R), REN);
});

test('formatCharacter computes Checks and shows XP against xpToNext', () => {
    const sheet = newSheet({ name: 'Ada', stats: { INT: 6, DEX: 4 } }, R);
    const text = formatCharacter(sheet, R);
    assert.match(text, new RegExp(`^Level: 1 \\| XP: 0/${xpToNext(1, R)} \\| Points: 0$`, 'm'));
    assert.match(text, /^Checks: STR \+0 \| VIT \+0 \| AGI \+0 \| DEX \+2 \| INT \+3 \| LUK \+0 \| CHA \+0$/m);
    assert.match(text, /^Skills: none$/m);
    assert.match(text, /^Conditions: none$/m);
    const low = { ...sheet, stats: { ...sheet.stats, CHA: 2 }, conditions: [{ name: 'poisoned', rounds: 2 }, { name: 'exhausted', rounds: null }] };
    assert.match(formatCharacter(low, R), /CHA -2$/m);
    assert.match(formatCharacter(low, R), /^Conditions: poisoned \(2\), exhausted$/m);
});

test('the State line follows HP, MP and conditions and is never read back', () => {
    const { sheet } = parseCharacter(REN, R);
    const hurt = { ...sheet, hp: { cur: 15, max: 62 }, mp: { cur: 3, max: 30 }, conditions: [{ name: 'poison', rounds: 2 }] };
    const text = formatCharacter(hurt, R);
    const lines = text.split('\n');
    assert.equal(lines[lines.findIndex(line => line.startsWith('Checks:')) + 1], 'State: badly hurt (bleeding, slow to move) · drained of magic · poisoned');
    // An edited State line changes nothing, and one with stray labels is not read as fields.
    const edited = text.replace(/^State: .*$/m, 'State: unhurt · HP: 62/62 | Conditions: none');
    const back = parseCharacter(edited, R);
    assert.deepEqual(back.errors, []);
    assert.deepEqual(back.sheet.hp, { cur: 15, max: 62 });
    assert.deepEqual(back.sheet.conditions, [{ name: 'poison', rounds: 2 }]);
    assert.equal(formatCharacter(back.sheet, R), text);
    // A sheet written before the State line existed reads the same.
    const old = REN.replace(/^State: .*\n/m, '');
    assert.deepEqual(parseCharacter(old, R), parseCharacter(REN, R));
    assert.equal(formatCharacter(parseCharacter(old, R).sheet, R), REN);
    assert.deepEqual(parseParty(PARTY.replace(/^State: .*\n/gm, ''), R), parseParty(PARTY, R));
    // A block that is only a State line has no fields.
    assert.equal(parseCharacter('**State:** down', R).sheet, null);
});

test('formatParty puts each State line under its HP/MP line', () => {
    const members = parseParty(PARTY, R).members;
    const down = { ...members[0], sheet: { ...members[0].sheet, hp: { cur: 0, max: 44 } } };
    const lines = formatParty([down], R).split('\n');
    assert.deepEqual(lines.slice(2, 4), ['HP: 0/44 | MP: 38/38', 'State: down (unconscious or unable to fight)']);
});

test('parseCharacter is lenient: bold labels, any order, commas, missing fields defaulted', () => {
    const text = [
        '<Character>',
        '- **HP:** 58 / 62, **MP:** 21',
        '**Name:** Ren',
        '**STR:** 9 | **VIT:** 7 | AGI: 8 | DEX: 8 | INT: 4 | LUK: 5',
        'Level: 4 | XP: 310/400',
        'Skills: Rending Strike (Lv 2), Guard Break, Second Wind Lv 3',
        'Conditions: poisoned (2), exhausted',
        '</Character>',
    ].join('\n');
    const { sheet, errors } = parseCharacter(text, R);
    assert.equal(sheet.name, 'Ren');
    assert.equal(sheet.level, 4);
    assert.equal(sheet.xp, 310, 'the /400 is display only');
    assert.equal(sheet.points, 0);
    assert.deepEqual(sheet.hp, { cur: 58, max: 62 });
    assert.deepEqual(sheet.mp, { cur: 21, max: maxMp(sheet.stats, 4, R) });
    assert.equal(sheet.stats.CHA, R.character.startStat);
    assert.deepEqual(sheet.skills, [{ name: 'Rending Strike', mastery: 2 }, { name: 'Guard Break', mastery: 1 }, { name: 'Second Wind', mastery: 3 }]);
    assert.deepEqual(sheet.conditions, [{ name: 'poisoned', rounds: 2 }, { name: 'exhausted', rounds: null }]);
    assert.deepEqual(errors, ['Character: no CHA, using 5.']);
});

test('parseCharacter never throws and reports what it defaulted', () => {
    assert.deepEqual(parseCharacter('', R), { sheet: null, errors: ['Character: no fields found.'] });
    assert.deepEqual(parseCharacter(null, R).sheet, null);
    const { sheet, errors } = parseCharacter('Name: Bo\nLevel: high\nHP: 999/40', R);
    assert.equal(sheet.level, 1);
    assert.deepEqual(sheet.hp, { cur: 40, max: 40 }, 'current HP clamped to max');
    assert.equal(sheet.mp.cur, sheet.mp.max);
    assert.ok(errors.some(error => /Level "high"/.test(error)));
    assert.ok(errors.some(error => /no MP/.test(error)));
    assert.equal(parseCharacter('Skills: Mastered (Lv 9)', R).sheet.skills[0].mastery, R.masteryMax);
});

test('parseParty reads sections, control, gear and stable slug ids', () => {
    const { members, errors } = parseParty(PARTY, R);
    assert.deepEqual(errors, []);
    assert.deepEqual(members.map(member => [member.id, member.name, member.role, member.control]), [
        ['astra', 'Astra', 'companion', 'auto'],
        ['merrit', 'Merrit', 'hireling', 'command'],
    ]);
    const [astra, merrit] = members;
    assert.deepEqual(astra.sheet.hp, { cur: 44, max: 44 });
    assert.equal(astra.sheet.stats.INT, 10);
    assert.deepEqual(astra.gear.map(item => [item.name, item.rarity, item.slot, item.equipped, item.stats]), [
        ['Ashwood Staff', 'rare', 'weapon', true, { MATK: 7, INT: 1 }],
        ['Traveller\'s Robe', 'common', 'armour', true, { DEF: 2, MDEF: 3 }],
    ]);
    assert.deepEqual(merrit.sheet.skills, [{ name: 'Shield Bash', mastery: 3 }]);
    assert.deepEqual(merrit.sheet.conditions, [{ name: 'poisoned', rounds: 2 }]);
    assert.deepEqual(merrit.gear, []);
    assert.equal(formatParty(members, R), PARTY);
});

test('parseParty is lenient about headings and missing lines', () => {
    const text = '### **Jean-Luc (sellsword)** | control: sometimes\nLevel: 2\nSTR: 7\n## Ünä\n## Astra\n## Astra\n## PC';
    const { members, errors } = parseParty(text, R);
    assert.deepEqual(members.map(member => [member.id, member.name, member.role, member.control]), [
        ['jean-luc', 'Jean-Luc', 'sellsword', 'auto'],
        ['una', 'Ünä', 'companion', 'auto'],
        ['astra', 'Astra', 'companion', 'auto'],
        ['astra-2', 'Astra', 'companion', 'auto'],
        ['pc-2', 'PC', 'companion', 'auto'],
    ]);
    assert.ok(errors.some(error => /control "sometimes"/.test(error)));
    const jean = members[0].sheet;
    assert.equal(jean.level, 2);
    assert.deepEqual(jean.hp, { cur: maxHp(jean.stats, 2, R), max: maxHp(jean.stats, 2, R) });
    assert.deepEqual(parseParty('', R), { members: [], errors: [] });
    assert.equal(slug('  Sir   Bors, the Red! '), 'sir-bors-the-red');
    assert.equal(slug('???'), 'member');
});

test('missing HP maxima on a Party section count its gear HP', () => {
    const text = '## Tor — companion\nLevel: 1\nSTR: 5 | VIT: 5 | AGI: 5 | DEX: 5 | INT: 5 | LUK: 5 | CHA: 5\nEquipped: Iron Ring (common) · HP +10';
    const [tor] = parseParty(text, R).members;
    assert.equal(tor.gear[0].slot, 'accessory');
    assert.equal(tor.sheet.hp.max, maxHp(tor.sheet.stats, 1, R, 10));
});

test('spendPoints raises stats, maxima and current HP/MP by the gain', () => {
    const { sheet } = parseCharacter(REN, R);
    const next = spendPoints(sheet, { VIT: 1, INT: 1 }, R);
    assert.equal(next.points, 0);
    assert.equal(next.stats.VIT, 8);
    assert.equal(next.stats.INT, 5);
    assert.deepEqual(next.hp, { cur: 58 + R.derived.hpPerVit, max: 62 + R.derived.hpPerVit });
    assert.deepEqual(next.mp, { cur: 21 + R.derived.mpPerInt, max: 30 + R.derived.mpPerInt });
    assert.equal(sheet.stats.VIT, 7, 'the argument is not changed');
    assert.equal(spendPoints(sheet, { STR: 1 }, R).points, 1);
    assert.throws(() => spendPoints(sheet, { STR: 3 }, R), /3 points asked, 2 unspent/);
    assert.throws(() => spendPoints(sheet, { STR: -1 }, R), /0 or more/);
    assert.throws(() => spendPoints(sheet, { FOO: 1 }, R), /not a stat/);
});

test('learnSkill adds at mastery 1 without duplicates', () => {
    const { sheet } = parseCharacter(REN, R);
    const next = learnSkill(sheet, '  Fireball ');
    assert.deepEqual(next.skills.at(-1), { name: 'Fireball', mastery: 1 });
    assert.equal(learnSkill(next, 'fireball').skills.length, next.skills.length);
    assert.equal(learnSkill(sheet, 'rending  strike').skills.find(skill => skill.name === 'Rending Strike').mastery, 2);
    assert.equal(sheet.skills.length, 3);
    assert.throws(() => learnSkill(sheet, ' '), /name/);
});

test('applyResult takes HP/MP and lasting conditions from the result', () => {
    const { sheet } = parseCharacter(REN.replace('Conditions: none', 'Conditions: poisoned (3), exhausted'), R);
    const out = applyResult(sheet, 'pc', result({
        party: [{ memberId: 'pc', name: 'Ren', hp: { cur: 12, max: 62 }, mp: { cur: 3, max: 30 }, down: false, conditions: [{ name: 'poison', rounds: 1 }] }],
    }), R);
    assert.deepEqual(out.sheet.hp, { cur: 12, max: 62 });
    assert.deepEqual(out.sheet.mp, { cur: 3, max: 30 });
    // The fight decided the poison; it cannot see "exhausted", so that stays.
    assert.deepEqual(out.sheet.conditions, [{ name: 'poison', rounds: 1 }, { name: 'exhausted', rounds: null }]);
    assert.equal(out.levelsGained, 0);
    assert.deepEqual(out.masteryGained, []);
    const untouched = applyResult(sheet, 'someone-else', result(), R);
    assert.deepEqual(untouched.sheet.hp, sheet.hp);
});

test('applyResult levels up with carry-over, points and raised HP/MP', () => {
    const { sheet } = parseCharacter(REN, R);
    const need4 = xpToNext(4, R);
    const need5 = xpToNext(5, R);
    const gained = need4 - 310 + need5 + 7;
    const out = applyResult(sheet, 'pc', result({ xp: { pc: gained } }), R);
    assert.equal(out.levelsGained, 2);
    assert.equal(out.pointsGained, 2 * R.character.pointsPerLevel);
    assert.equal(out.sheet.level, 6);
    assert.equal(out.sheet.xp, 7);
    assert.equal(out.sheet.points, 2 + 2 * R.character.pointsPerLevel);
    const hpGain = 2 * R.derived.hpPerLevel;
    const mpGain = 2 * R.derived.mpPerLevel;
    assert.deepEqual(out.sheet.hp, { cur: 30 + hpGain, max: 62 + hpGain });
    assert.deepEqual(out.sheet.mp, { cur: 10 + mpGain, max: 30 + mpGain });
    const exact = applyResult(sheet, 'pc', result({ xp: { pc: need4 - 310 } }), R);
    assert.equal(exact.sheet.level, 5);
    assert.equal(exact.sheet.xp, 0);
    assert.equal(applyResult(sheet, 'pc', result({ xp: { pc: 5 } }), R).sheet.xp, 315);
});

test('applyResult raises mastery from uses, accumulating across fights', () => {
    const rules = makeRules({ masteryUses: [0, 3, 4, 5, 6] });
    const sheet = { ...parseCharacter(REN, rules).sheet };
    const first = applyResult(sheet, 'pc', result({ uses: { pc: { 'Guard Break': 2, 'Rending Strike': 5, Attack: 9 } } }), rules);
    assert.deepEqual(first.masteryGained, ['Rending Strike']);
    assert.equal(first.sheet.skills.find(skill => skill.name === 'Guard Break').mastery, 1);
    assert.equal(first.sheet.uses['Guard Break'], 2);
    assert.equal(first.sheet.skills.find(skill => skill.name === 'Rending Strike').mastery, 3);
    assert.equal(first.sheet.uses['Rending Strike'], 1);
    const second = applyResult(first.sheet, 'pc', result({ uses: { pc: { 'guard break': 1, 'Rending Strike': 100 } } }), rules);
    assert.deepEqual(second.masteryGained, ['Guard Break', 'Rending Strike']);
    assert.equal(second.sheet.skills.find(skill => skill.name === 'Guard Break').mastery, 2);
    assert.equal(second.sheet.skills.find(skill => skill.name === 'Rending Strike').mastery, rules.masteryMax);
    assert.equal(second.sheet.uses['Rending Strike'], undefined);
    // The default thresholds: 5 uses take mastery 1 to 2.
    const fresh = parseCharacter(REN, R).sheet;
    assert.equal(applyResult(fresh, 'pc', result({ uses: { pc: { 'Second Wind': 5 } } }), R).sheet.skills.at(-1).mastery, 2);
    assert.equal(applyResult(fresh, 'pc', result({ uses: { pc: { 'Second Wind': 4 } } }), R).sheet.skills.at(-1).mastery, 1);
});

test('applyResult on a Party member uses its id', () => {
    const [astra] = parseParty(PARTY, R).members;
    const out = applyResult(astra.sheet, 'astra', result({
        party: [{ memberId: 'astra', name: 'Astra', hp: { cur: 0, max: 44 }, mp: { cur: 5, max: 38 }, down: true, conditions: [] }],
        xp: { astra: 38 },
    }), R);
    assert.deepEqual(out.sheet.hp, { cur: 0, max: 44 });
    assert.equal(out.sheet.xp, 158);
});

test('recompute derives maxima from stats, level and capped gear, clamping current', () => {
    const { sheet } = parseCharacter(REN, R);
    const plain = recompute(sheet, [], R);
    assert.equal(plain.hp.max, maxHp(sheet.stats, 4, R));
    assert.equal(plain.mp.max, maxMp(sheet.stats, 4, R));
    assert.equal(plain.hp.cur, Math.min(58, plain.hp.max));
    const gear = [
        { name: 'Ring of Vigour', slot: 'accessory', rarity: 'common', equipped: true, stats: { HP: 10 }, tags: [] },
        { name: 'Owl Charm', slot: 'accessory', rarity: 'legendary', equipped: true, stats: { MP: 8, INT: 1 }, tags: [] },
        { name: 'Spare Ring', slot: 'accessory', rarity: 'legendary', equipped: false, stats: { HP: 50 }, tags: [] },
    ];
    const geared = recompute(sheet, gear, R);
    assert.equal(geared.hp.max, maxHp(sheet.stats, 4, R, 10));
    assert.equal(geared.mp.max, maxMp({ ...sheet.stats, INT: sheet.stats.INT + 1 }, 4, R, 8));
    const hurt = recompute({ ...sheet, hp: { cur: 500, max: 500 } }, { HP: 0, MP: 0 }, R);
    assert.equal(hurt.hp.cur, hurt.hp.max);
});
