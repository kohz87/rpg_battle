// The built-in races and talents (MODULES §F14): six races and twelve talents in the pack shape
// (PACKS.md "races, talents"), balanced against v1's start points, and the persona adapter
// (MODULES §F22) that gives the wizard its name, background and portrait.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { STATS } from '../../../src/rules.js';
import { BUILT_IN_RACES, BUILT_IN_TALENTS, avatarUrl, bonusText, personaFor, readPersona, talentCost } from '../../../src/v2/creation/index.js';

const CHOICE_FIELDS = ['id', 'name', 'note', 'stats', 'tags'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

for (const [kind, list, count] of [['races', BUILT_IN_RACES, 6], ['talents', BUILT_IN_TALENTS, 12]]) {
    test(`built-in ${kind}: ${count} records in the pack shape`, () => {
        assert.equal(list.length, count);
        assert.equal(new Set(list.map(record => record.id)).size, count, 'ids are unique');
        for (const record of list) {
            assert.deepEqual(Object.keys(record).filter(key => !CHOICE_FIELDS.includes(key)), [], `${record.name}: only pack fields`);
            assert.match(record.id, SLUG);
            assert.ok(record.name.length >= 1 && record.name.length <= 80);
            assert.ok(typeof record.note === 'string' && record.note.length <= 500);
            for (const [stat, value] of Object.entries(record.stats)) {
                assert.ok(STATS.includes(stat), `${record.name}: ${stat}`);
                assert.ok(Number.isInteger(value) && value !== 0);
            }
            assert.ok(record.tags.every(tag => typeof tag === 'string' && tag.trim() && tag.length <= 40));
        }
    });
}

test('balance: every race nets +2, no stat moves more than 2, no talent gives more than it costs', () => {
    for (const race of BUILT_IN_RACES) {
        assert.equal(Object.values(race.stats).reduce((a, b) => a + b, 0), 2, race.name);
        assert.ok(Object.values(race.stats).every(value => Math.abs(value) <= 2));
    }
    for (const talent of BUILT_IN_TALENTS) {
        const net = Object.values(talent.stats).reduce((a, b) => a + b, 0);
        assert.ok(net <= talentCost(talent), talent.name);
        assert.ok(talentCost(talent) >= 1 && talentCost(talent) <= 2);
    }
    assert.equal(talentCost({ stats: { STR: 2, CHA: -3 } }), 1);
    assert.equal(talentCost({}), 1);
    assert.equal(bonusText({ DEX: 2, VIT: -1, HP: 5 }), '−1 VIT, +2 DEX');
});

// Story Block's own pack validator, when a checkout is next to this one (CI has none).
const PACKS = ['/home/user/_main/story_block/src/v2/packs/validate.js'].find(path => existsSync(path));
test('the built-ins pass Story Block\'s pack validator', { skip: PACKS ? false : 'no Story Block checkout here to load src/v2/packs/validate.js from' }, async () => {
    const { validatePack } = await import(pathToFileURL(PACKS).href);
    const pack = { id: 'rpg-battle-builtins', version: '1.0.0', requires: { storyBlock: '^2' }, content: { races: BUILT_IN_RACES, talents: BUILT_IN_TALENTS } };
    const out = validatePack(JSON.parse(JSON.stringify(pack)));
    assert.equal(out.ok, true, JSON.stringify(out.problems ?? out.errors ?? out));
});

test('persona avatar: the context\'s file, else the global user_avatar, else the default persona (Story Block\'s readHeroContext order)', () => {
    // The context carries neither user_avatar nor userAvatar: the settings' default persona is the file.
    assert.equal(readPersona({ context: { name1: 'Ren', powerUserSettings: { default_persona: 'def.png' } } }).avatar, '/thumbnail?type=persona&file=def.png');
    assert.equal(readPersona({ context: { name1: 'Ren' }, powerUser: { default_persona: 'pow.png' } }).avatar, '/thumbnail?type=persona&file=pow.png');
    // The context\'s own file wins over the default.
    assert.equal(readPersona({ context: { user_avatar: 'ctx.png', powerUserSettings: { default_persona: 'def.png' } } }).avatar, '/thumbnail?type=persona&file=ctx.png');
    // The live read: SillyTavern without the file on its context, then the global user_avatar.
    globalThis.SillyTavern = { getContext: () => ({ name1: 'Ren' }) };
    globalThis.user_avatar = 'glob.png';
    try {
        assert.equal(readPersona().avatar, '/thumbnail?type=persona&file=glob.png');
        globalThis.user_avatar = undefined;
        globalThis.power_user = { default_persona: 'global-default.png' };
        assert.equal(readPersona().avatar, '/thumbnail?type=persona&file=global-default.png');
    } finally {
        delete globalThis.SillyTavern;
        delete globalThis.user_avatar;
        delete globalThis.power_user;
    }
});

test('persona: name, description and avatar from SillyTavern, empty when missing', () => {
    const st = { context: { name1: '  Ren Avel ', powerUserSettings: { persona_description: ' Raised on the river. ' }, user_avatar: 'ren 1.png' } };
    assert.deepEqual(readPersona(st), { name: 'Ren Avel', background: 'Raised on the river.', avatar: '/thumbnail?type=persona&file=ren%201.png' });
    assert.deepEqual(readPersona({ context: null }), { name: '', background: '', avatar: '' });
    assert.equal(readPersona({ context: { name1: 'A' }, powerUser: { persona_description: 'x'.repeat(2500) } }).background.length, 2000);
    assert.equal(avatarUrl('https://img.example/a.png'), 'https://img.example/a.png');
    assert.equal(avatarUrl(''), '');
    // Without SillyTavern at all (this test run) the live read is empty, never a throw.
    assert.deepEqual(readPersona(), { name: '', background: '', avatar: '' });
    // The host's own persona wins.
    assert.deepEqual(personaFor({ persona: { name: 'Ada', background: 'A smith.', avatar: 'ada.png' } }), { name: 'Ada', background: 'A smith.', avatar: '/thumbnail?type=persona&file=ada.png' });
});
