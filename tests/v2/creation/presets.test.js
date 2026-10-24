// The packs' ready-made characters (MODULES §F14, §F22): creation.content lists them checked against
// what is on offer; creation.finish with a preset makes the character from the draft (the reader's
// race, talents and points, which the preset filled) and teaches the preset's pack skills, built
// by v1 skillFromTemplate into party.custom. The real party part throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHost, pcOf, points } from './helpers/fake-host.js';
import { PACKS } from './helpers/packs.js';
import { presetDraft } from '../../../src/v2/creation/index.js';

const wessel = () => ({ name: 'Wessel', background: 'A boatman of the Confederacy.', ...presetDraft(PACKS.presets[0]) });

test('creation.content lists the presets with their names; a reference nothing offers is left out', () => {
    const odd = { ...PACKS, presets: [...PACKS.presets, { id: 'pack.ersveil/odd', name: 'Odd', race: 'pack.other/orc', talents: ['pack.ersveil/river-born', 'pack.other/x'], points: { DEX: 9 }, skills: ['pack.other/zap'] }] };
    const host = makeHost({ packs: odd, party: 'real' });
    const content = host.query('creation.content', {});
    assert.equal(content.hasPresets, true);
    const [kit, other] = content.presets;
    assert.deepEqual({ race: kit.race, raceName: kit.raceName, talentNames: kit.talentNames, skillNames: kit.skillNames }, { race: 'pack.ersveil/human', raceName: 'Human', talentNames: 'Shadow-bent, River-born', skillNames: 'Cane Draw, Shadow Cut' });
    assert.deepEqual(kit.skills.map(skill => [skill.name, skill.type, skill.stat, skill.target]), [['Cane Draw', 'physical', 'DEX', 'one'], ['Shadow Cut', 'magic', 'INT', 'all']]);
    assert.deepEqual({ race: other.race, talents: other.talents, skills: other.skills, points: other.points }, { race: '', talents: ['pack.ersveil/river-born'], skills: [], points: { DEX: 9 } });
    assert.equal(makeHost().query('creation.content', {}).hasPresets, false, 'no presets are built in');
});

test('finish with a preset: the draft\'s stats, the preset\'s skills learned and kept in party.custom', () => {
    const host = makeHost({ packs: PACKS, party: 'real' });
    const out = host.command('creation.finish', wessel());
    assert.equal(out.ok, true, out.message);
    const pc = pcOf(host.state);
    assert.equal(pc.name, 'Wessel');
    assert.equal(pc.background, 'A boatman of the Confederacy.');
    // start 5 + points, Shadow-bent +1 INT, River-born +1 AGI
    assert.deepEqual(pc.stats, { STR: 5, VIT: 6, AGI: 8, DEX: 8, INT: 7, LUK: 6, CHA: 5 });
    assert.deepEqual(pc.origin.race, { id: 'pack.ersveil/human', name: 'Human' });
    assert.deepEqual(pc.skills.map(skill => [skill.name, skill.active]), [['Cane Draw', true], ['Shadow Cut', true]]);
    const custom = host.state.domains.party.custom;
    assert.equal(custom['Cane Draw'].type, 'physical');
    assert.equal(custom['Cane Draw'].stat, 'DEX');
    assert.equal(custom['Shadow Cut'].target, 'all');
    assert.equal(custom['Cane Draw'].description, 'The hidden blade drawn and cut in one motion.');
    assert.ok(custom['Cane Draw'].power > 0, 'the numbers are RPG Battle\'s rules');
    assert.equal(out.receipt.summary, 'Wessel (Human; Shadow-bent and River-born; Cane Draw, Shadow Cut) is ready.');
    assert.deepEqual(out.receipt.data.skills, ['Cane Draw', 'Shadow Cut']);
    assert.equal(out.receipt.data.preset, 'pack.ersveil/wessel-kit');
});

test('finish with a preset the reader changed: their picks count, the preset\'s skills still come', () => {
    const host = makeHost({ packs: PACKS, party: 'real' });
    const out = host.command('creation.finish', { ...wessel(), race: 'pack.ersveil/elf', points: points({ VIT: 1, AGI: 2, DEX: 3, INT: 1, CHA: 1 }) });
    assert.equal(out.ok, true, out.message);
    const pc = pcOf(host.state);
    assert.equal(pc.origin.race.id, 'pack.ersveil/elf');
    assert.equal(pc.stats.CHA, 6);
    assert.equal(pc.skills.length, 2);
});

test('finish with an unknown or malformed preset is refused and nothing is saved', () => {
    const host = makeHost({ packs: PACKS, party: 'real' });
    const before = JSON.stringify(host.state);
    for (const [preset, code] of [['pack.ersveil/gone', 'NOT_FOUND'], [7, 'INVALID']]) {
        const out = host.command('creation.finish', { ...wessel(), preset });
        assert.equal(out.ok, false);
        assert.equal(out.code, code, out.message);
        assert.equal(JSON.stringify(host.state), before);
    }
    // A preset's budget is still the rules': with fewer start points it no longer adds up.
    const tight = makeHost({ packs: PACKS, party: 'real', settings: { startPoints: 6 } });
    const out = tight.command('creation.finish', wessel());
    assert.equal(out.ok, false);
    assert.equal(out.code, 'REFUSED');
});
