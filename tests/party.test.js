// From sheets to fighters: gear capped into the numbers, consumables carried, enemies by row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRules } from '../src/rules.js';
import { makeRng } from '../src/rng.js';
import { DEFAULT_SKILLS, PRESETS } from '../src/skills.js';
import { DEFAULT_BESTIARY } from '../src/enemies.js';
import { newSheet } from '../src/sheet.js';
import { parseInventory } from '../src/items.js';
import { combatantFromSheet, enemiesFromRows } from '../src/party.js';

const rules = makeRules();
const sheet = newSheet({ name: 'Ren', stats: PRESETS[0].points, skills: PRESETS[0].skills }, rules);

test('a sheet becomes a party combatant: gear capped by rarity, consumables, resolved skills', () => {
    const items = parseInventory('[Equipment > Weapons]\nGodsword | 1 | equipped · common · ATK +50\n[Consumables]\nHealing Draught | 2 | heal 30').items;
    const bare = combatantFromSheet(sheet, { gear: [], items: [], library: DEFAULT_SKILLS, rules });
    const armed = combatantFromSheet(sheet, { gear: items.filter(item => item.equipped), items, library: DEFAULT_SKILLS, rules });
    assert.equal(armed.side, 'party');
    assert.equal(armed.memberId, 'pc');
    assert.ok(armed.patk > bare.patk, 'the sword helps');
    assert.ok(armed.patk - bare.patk <= 3, 'but a common sword at level 1 is capped, not +50');
    assert.deepEqual(armed.capped.map(entry => entry.name), ['Godsword']);
    assert.deepEqual(armed.items.map(item => item.name), ['Healing Draught']);
    assert.deepEqual(armed.skills.map(skill => skill.name), PRESETS[0].skills);
    assert.equal(armed.hp.cur, sheet.hp.cur);
});

test('enemy rows: counts become lettered individuals with stable ids', () => {
    const enemies = enemiesFromRows([{ name: 'Goblin', count: 2, rank: 'F' }, { name: '', count: 3 }, { name: 'Bog Wight', count: 1, rank: 'E', role: 'brute', boss: true }], { bestiary: DEFAULT_BESTIARY, library: DEFAULT_SKILLS, rules, rng: makeRng('t') });
    assert.deepEqual(enemies.map(enemy => [enemy.id, enemy.name]), [['e1', 'Goblin A'], ['e2', 'Goblin B'], ['e3', 'Bog Wight']]);
    assert.ok(enemies[2].boss);
    assert.equal(enemies[2].side, 'enemy');
});

test('a new companion: built from a preset, raised to the level, gear capped into max HP/MP, unique id', async () => {
    const { newCompanion } = await import('../src/party.js');
    const healer = PRESETS.find(preset => preset.id === 'healer');
    const astra = newCompanion({ name: 'Astra', role: 'mage', level: 4, preset: healer, gearLines: 'Ashwood Staff (rare) · MATK +7, INT +1' }, { rules, existing: [] });
    assert.equal(astra.id, 'astra');
    assert.equal(astra.sheet.level, 4);
    const spent = Object.values(astra.sheet.stats).reduce((sum, value) => sum + value, 0) - 7 * rules.character.startStat;
    assert.equal(spent, rules.character.startPoints + 3 * rules.character.pointsPerLevel);
    assert.equal(astra.sheet.hp.cur, astra.sheet.hp.max);
    assert.deepEqual(astra.gear.map(item => item.name), ['Ashwood Staff']);
    assert.deepEqual(astra.sheet.skills.map(skill => skill.name), healer.skills);
    const twin = newCompanion({ name: 'Astra', preset: healer }, { rules, existing: [astra] });
    assert.equal(twin.id, 'astra-2');
    assert.throws(() => newCompanion({ name: ' ', preset: healer }, { rules }), /name/);
});

test('enemy rows may carry a level (a power in the reader\'s terms)', () => {
    const enemies = enemiesFromRows([{ name: 'Bog Wight', count: 2, level: 11, role: 'brute' }, { name: 'Goblin', count: 1, rank: 'E' }], { bestiary: DEFAULT_BESTIARY, library: DEFAULT_SKILLS, rules, rng: makeRng('rows') });
    assert.deepEqual(enemies.map(enemy => [enemy.id, enemy.name, enemy.level, enemy.rank]), [['e1', 'Bog Wight A', 11, 'C'], ['e2', 'Bog Wight B', 11, 'C'], ['e3', 'Goblin', 3, 'E']]);
});

test('a new companion joins no higher than the level cap', async () => {
    const { newCompanion } = await import('../src/party.js');
    const capped = makeRules({ terms: { cap: 5 } });
    assert.equal(newCompanion({ name: 'Astra', level: 30, preset: PRESETS[2] }, { rules: capped }).sheet.level, 5);
});

test('editCompanion: name, role and control change; the sheet, gear and stats stay; ids follow the name', async () => {
    const { editCompanion, newCompanion, remapIds } = await import('../src/party.js');
    const astra = newCompanion({ name: 'Astra', role: 'companion', level: 4, preset: PRESETS[2], gearLines: 'Ashwood Staff (rare) · MATK +7' }, { rules });
    const merrit = newCompanion({ name: 'Merrit', role: 'hireling', control: 'command', level: 3, preset: PRESETS[0] }, { rules, existing: [astra] });
    const members = [astra, merrit];
    const { members: edited, idMap } = editCompanion(members, 'astra', { name: 'Astra the Bold', role: 'mage | ally', control: 'command' }, { pcName: 'Ren' });
    assert.equal(edited[0].id, 'astra-the-bold');
    assert.equal(edited[0].name, 'Astra the Bold');
    assert.equal(edited[0].sheet.name, 'Astra the Bold');
    assert.equal(edited[0].role, 'mage ally', 'a bar would split the heading');
    assert.equal(edited[0].control, 'command');
    assert.deepEqual(edited[0].sheet.stats, astra.sheet.stats);
    assert.deepEqual(edited[0].sheet.skills, astra.sheet.skills);
    assert.deepEqual(edited[0].gear, astra.gear);
    assert.equal(edited[0].sheet.level, 4);
    assert.deepEqual(edited[1], merrit);
    assert.deepEqual(idMap, { astra: 'astra-the-bold', merrit: 'merrit' });
    // What the chat keeps by id (the NPC links) moves with it; anyone else's stays.
    assert.deepEqual(remapIds({ pc: 'x', astra: 'npc-7', merrit: 'npc-9' }, idMap), { pc: 'x', 'astra-the-bold': 'npc-7', merrit: 'npc-9' });
    // Role or control alone keeps the id.
    const quiet = editCompanion(members, 'merrit', { name: 'Merrit', role: 'guard', control: 'auto' });
    assert.deepEqual(quiet.idMap, { astra: 'astra', merrit: 'merrit' });
    assert.equal(quiet.members[1].role, 'guard');
    assert.equal(quiet.members[1].control, 'auto');
    // Refused: unknown member, empty name, a name already taken.
    assert.throws(() => editCompanion(members, 'nobody', { name: 'X' }), /not in the party/);
    assert.throws(() => editCompanion(members, 'astra', { name: '  ' }), /name/);
    assert.throws(() => editCompanion(members, 'astra', { name: 'merrit' }), /already a merrit/);
    assert.throws(() => editCompanion(members, 'astra', { name: 'Ren' }, { pcName: 'Ren' }), /your character/);
});

test('editCompanion: the written Party block reads back with the new ids', async () => {
    const { editCompanion, newCompanion } = await import('../src/party.js');
    const { formatParty, parseParty } = await import('../src/sheet.js');
    const first = newCompanion({ name: 'Astra', level: 2, preset: PRESETS[2] }, { rules });
    const second = { ...newCompanion({ name: 'Astra', level: 2, preset: PRESETS[1] }, { rules, existing: [first] }) };
    assert.equal(second.id, 'astra-2');
    // Renaming the first Astra makes the second one plain "astra".
    const { members, idMap } = editCompanion([first, second], 'astra', { name: 'Vel' });
    assert.deepEqual(idMap, { astra: 'vel', 'astra-2': 'astra' });
    assert.deepEqual(parseParty(formatParty(members, rules), rules).members.map(member => member.id), ['vel', 'astra']);
});

test('a renamed companion keeps their mastery progress: it is on the sheet, in the block', async () => {
    const { editCompanion, newCompanion } = await import('../src/party.js');
    const { formatParty, parseParty } = await import('../src/sheet.js');
    const lyra = newCompanion({ name: 'Lyra', level: 3, preset: PRESETS[2] }, { rules });
    const skill = lyra.sheet.skills[0].name;
    const read = parseParty(formatParty([{ ...lyra, sheet: { ...lyra.sheet, uses: { [skill]: 3 } } }], rules), rules).members;
    const { members } = editCompanion(read, 'lyra', { name: 'Lyra Vance' });
    const back = parseParty(formatParty(members, rules), rules).members;
    assert.deepEqual([back[0].id, back[0].sheet.uses[skill]], ['lyra-vance', 3]);
});

test('npcRenames: a linked companion follows their NPC\'s name when it changes, once per change', async () => {
    const { npcRenames } = await import('../src/party.js');
    const members = [
        { id: 'lyra', name: 'Lyra', npcId: 'n1' },
        { id: 'bram', name: 'Bram', npcId: 'n2' },
        { id: 'oskar', name: 'Oskar' },
        { id: 'vel', name: 'Vel', npcId: 'n5' },
        { id: 'quill', name: 'Quill', npcId: 'n6' },
    ];
    const seen = { n1: 'Lyra', n2: 'Bram', n5: 'Vel', n6: 'Quill' };
    const profiles = [
        { id: 'n1', name: 'Lyra Vance', aliases: ['Lyra'] },
        { id: 'n2', name: 'Bram', aliases: [] },
        { id: 'n4', name: 'Oskar the Grey' },
        { id: 'n5', name: 'Bram' },
        { id: 'n6', name: 'Quill | the #Scribe' },
    ];
    const out = npcRenames(members, profiles, { seen, pcName: 'Ren' });
    assert.deepEqual(out.renames, [
        { memberId: 'lyra', from: 'Lyra', to: 'Lyra Vance' },
        { memberId: 'quill', from: 'Quill', to: 'Quill the Scribe' },
    ], 'the old name kept as an alias is still a rename; unchanged, unlinked or a name another companion has: none; the heading kept clean');
    assert.deepEqual(out.seen, { n1: 'Lyra Vance', n2: 'Bram', n5: 'Bram', n6: 'Quill | the #Scribe' }, 'remembered, taken or not');
    // Once per change: with the new names remembered, nothing more, even with the old names back
    // in the block (a reply deleted) or a name changed back by hand.
    assert.deepEqual(npcRenames(members, profiles, { seen: out.seen }).renames, []);
    assert.deepEqual(npcRenames(members, [{ id: 'n1', name: 'Lyra Moon' }], { seen: out.seen }).renames, [{ memberId: 'lyra', from: 'Lyra', to: 'Lyra Moon' }], 'a later change is followed');
    // Not seen before (an older chat): a name that is not theirs nor an alias, not put away.
    const fresh = npcRenames([{ id: 'tess', name: 'Tess', npcId: 'n3' }], [{ id: 'n3', name: 'Tessaly', aliases: ['Tess'] }]);
    assert.deepEqual([fresh.renames, fresh.seen], [[], { n3: 'Tessaly' }], 'the companion carries a short name of theirs');
    assert.deepEqual(npcRenames([{ id: 'tess', name: 'Tess', npcId: 'n3' }], [{ id: 'n3', name: 'Tessaly' }]).renames, [{ memberId: 'tess', from: 'Tess', to: 'Tessaly' }]);
    assert.deepEqual(npcRenames([{ id: 'tess', name: 'Tess', npcId: 'n3' }], [{ id: 'n3', name: 'Tessaly' }], { done: ['npc:n3:Tessaly'] }).renames, [], 'put away as an offer before');
    assert.deepEqual(npcRenames(members, [{ id: 'n1', name: 'Ren' }], { seen, pcName: 'ren' }).renames, [], 'not to your name');
    assert.deepEqual(npcRenames(members, [{ id: 'n1', name: 'Lyra (healer)' }], { seen }).renames, [], 'what the heading would keep is the same name');
    assert.deepEqual(npcRenames(members, null), { renames: [], seen: {} });
});

test('combatNumbers: attack, defence, crit with capped gear; hit and dodge against a typical foe of the level (0.5.13)', async () => {
    const { combatNumbers } = await import('../src/party.js');
    const wessel = { name: 'Wessel', level: 1, stats: { STR: 6, VIT: 5, AGI: 10, DEX: 8, INT: 6, LUK: 5, CHA: 5 }, hp: { cur: 74, max: 74 }, mp: { cur: 36, max: 36 }, skills: [] };
    const gear = parseInventory('[Equipment > Weapons]\nCane-Blade | 1 | Equipped · Common · ATK +4\n[Equipment > Armour]\nPatched Oilcloth Coat | 1 | Equipped · Common · DEF +1').items.filter(item => item.equipped);
    const n = combatNumbers(wessel, { gear, rules });
    // A common weapon at level 1 is capped to its budget: +2 of the +4 counts.
    assert.equal(n.attack, 6 * 2 + 2);
    assert.equal(n.defence, 5 + 1);
    assert.equal(n.magic, 12);
    assert.equal(n.mdef, 6);
    assert.equal(n.crit, 3 + 8 * 0.5 + 5);
    // A level-1 foe has DEX and AGI 6: 75% + 3% per point of difference.
    assert.equal(n.foe, 6);
    assert.equal(n.hit, 75 + (8 - 6) * 3);
    assert.equal(n.dodge, 100 - (75 + (6 - 10) * 3));
    assert.equal(combatNumbers({ ...wessel, stats: { ...wessel.stats, AGI: 12 } }, { gear, rules }).dodge, n.dodge + 6);
});
