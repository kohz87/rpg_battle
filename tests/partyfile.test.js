// Party files: exported plainly, read back cleaned (names, bounds, maxima, gear, skills).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES as R, maxHp } from '../src/rules.js';
import { DEFAULT_SKILLS, skillFromTemplate } from '../src/skills.js';
import { newSheet, formatPartyBlock, parsePartyBlock } from '../src/sheet.js';
import { newCompanion } from '../src/party.js';
import { parseGearEntry } from '../src/items.js';
import { cleanParty, exportParty } from '../src/partyfile.js';

test('a party round-trips through its file', () => {
    const pc = { ...newSheet({ name: 'Ren', stats: { STR: 10 }, skills: ['Power Strike'] }, R), level: 4, xp: 12, points: 2 };
    const lyra = newCompanion({ name: 'Lyra', role: 'healer', focus: ['INT'], skills: ['Mend'], gearLines: 'Ashwood Staff (rare) · MATK +7' }, { rules: R });
    const custom = skillFromTemplate({ name: 'Frost Lance', type: 'magic', stat: 'INT', target: 'all', element: 'ice' }, 4, R);
    const file = JSON.parse(JSON.stringify(exportParty({ pc: { ...pc, skills: [...pc.skills, { name: 'Frost Lance', mastery: 1 }] }, members: [lyra], yourGear: [parseGearEntry('Iron Sword (uncommon) · ATK +6')], skills: [custom, skillFromTemplate({ name: 'Unknown By Anyone' }, 1, R)] })));
    assert.equal(file.rpgBattleParty, 1);
    assert.deepEqual(file.gear, ['Iron Sword (uncommon) · ATK +6']);
    assert.deepEqual(file.skills.map(skill => skill.name), ['Frost Lance'], 'only skills someone knows');
    const back = cleanParty(file, R, DEFAULT_SKILLS);
    assert.equal(back.pc.name, 'Ren');
    assert.deepEqual([back.pc.level, back.pc.xp, back.pc.points], [4, 12, 2]);
    assert.deepEqual(back.members.map(member => [member.name, member.role, member.gear.map(item => item.name)]), [['Lyra', 'healer', ['Ashwood Staff']]]);
    assert.deepEqual(back.yourGear.map(item => item.name), ['Iron Sword']);
    assert.deepEqual(back.skills.map(skill => [skill.name, skill.type, skill.target]), [['Frost Lance', 'magic', 'all']]);
    // It writes and reads as a Party block.
    assert.equal(parsePartyBlock(formatPartyBlock(back.pc, back.members, R), R).pc.name, 'Ren');
});

test('a hand-edited file is cleaned: bounds, names, maxima worked out again, numbers in skills ignored', () => {
    const file = {
        rpgBattleParty: 1,
        character: { name: 'Ren | ## <b>', level: 4000, xp: -5, points: 'lots', hp: { cur: 9999, max: 9999 }, mp: {}, stats: { STR: 1e9, VIT: -3 }, skills: [{ name: 'Power Strike', mastery: 77 }, 'Sweep'], conditions: [{ name: 'poisoned', rounds: 500 }] },
        companions: [{ name: 'ren b' }, { name: 'Lyra', control: 'weird', sheet: { level: 2 } }, { name: '' }],
        skills: [{ name: 'Power Strike', power: 99 }, { name: 'Glow', type: 'heal', power: 99, mp: 0 }],
    };
    const back = cleanParty(file, R, DEFAULT_SKILLS);
    assert.equal(back.pc.name, 'Ren b');
    assert.equal(back.pc.level, R.character.maxLevel);
    assert.deepEqual([back.pc.xp, back.pc.points, back.pc.stats.STR, back.pc.stats.VIT], [0, 0, 999, 0]);
    assert.equal(back.pc.hp.max, maxHp(back.pc.stats, back.pc.level, R), 'max HP from the stats, not the file');
    assert.equal(back.pc.hp.cur, back.pc.hp.max);
    assert.deepEqual(back.pc.skills, [{ name: 'Power Strike', mastery: R.masteryMax }, { name: 'Sweep', mastery: 1 }]);
    assert.deepEqual(back.pc.conditions, [{ name: 'poisoned', rounds: 99 }]);
    assert.deepEqual(back.members.map(member => [member.name, member.control, member.sheet.level]), [['Lyra', 'auto', 2]], 'your name and an empty one are dropped');
    assert.deepEqual(back.skills.map(skill => [skill.name, skill.power]), [['Glow', skillFromTemplate({ name: 'Glow', type: 'heal' }, 1, R).power]], 'a library name is the library\'s; numbers built again');
    assert.throws(() => cleanParty({ creatures: [] }, R), /not an RPG Battle party file/);
    assert.throws(() => cleanParty({ rpgBattleParty: 1, companions: [] }, R), /holds nobody/);
});
