// RPG Battle's side of the Story Suite (src/handshake.js): what it announces, the party it
// shares as api.members(), when the Character Sheet notice shows, and who the settings say the
// story follows. Each test gets an empty registry on globalThis.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeRules } from '../src/rules.js';
import { PRESETS } from '../src/skills.js';
import { formatCharacter, formatParty, newSheet, parseCharacter, parseParty } from '../src/sheet.js';
import { newCompanion } from '../src/party.js';
import { storySuite } from '../src/suite.js';
import { SHARED_AREAS, SUITE_ID, announcement, partyMembers, sheetNotice, sources, suiteSignature, truthChoices } from '../src/handshake.js';

beforeEach(() => {
    delete globalThis.StorySuite;
});

const rules = makeRules();
const BLOCK = { id: 'story-block', name: 'Story Block', version: '0.8.0', owns: ['scene', 'items', 'stats'] };

function announced(enabled = true) {
    const suite = storySuite();
    const api = { members: () => [] };
    if (enabled) suite.announce(announcement({ version: '0.3.0', api }));
    return { suite, api };
}

test('choices: one per shared area, anything unknown is auto', () => {
    assert.deepEqual(SHARED_AREAS, ['stats', 'rolls', 'items']);
    assert.deepEqual(truthChoices(null), { stats: 'auto', rolls: 'auto', items: 'auto' });
    assert.deepEqual(truthChoices({ stats: 'theirs', rolls: 'mine', items: 'everything', scene: 'mine' }), { stats: 'theirs', rolls: 'mine', items: 'auto' });
});

test('the announcement: rpg-battle owns stats and rolls, and items after Story Block', () => {
    const api = { members: () => [] };
    const entry = announcement({ version: '0.3.0', api });
    assert.deepEqual({ ...entry, api: null }, { id: 'rpg-battle', name: 'RPG Battle', version: '0.3.0', owns: ['stats', 'rolls', 'items'], api: null });
    assert.equal(entry.api, api);
    const { suite } = announced();
    suite.announce(BLOCK);
    assert.equal(suite.owner('stats'), SUITE_ID);
    assert.equal(suite.owner('rolls'), SUITE_ID);
    assert.equal(suite.owner('items'), 'story-block');
    suite.withdraw(SUITE_ID);
    assert.equal(suite.owner('stats'), 'story-block');
});

test('members: the Character then each companion, frozen plain copies in the reader\'s terms', () => {
    const r = makeRules({ terms: { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' } } });
    const pc = { ...newSheet({ name: 'Ren', stats: PRESETS[0].points, skills: PRESETS[0].skills }, r) };
    pc.hp = { cur: Math.round(pc.hp.max * 0.3), max: pc.hp.max };
    const astra = newCompanion({ name: 'Astra', role: 'healer', level: 14, preset: PRESETS[3] }, { rules: r, existing: [] });
    // Through the block text, as index.js reads them.
    const sheet = parseCharacter(formatCharacter(pc, r), r).sheet;
    const members = parseParty(formatParty([astra], r), r).members;
    const list = partyMembers(sheet, members, r);
    assert.deepEqual(list.map(member => Object.keys(member)), [
        ['id', 'name', 'role', 'level', 'levelLabel', 'hp', 'mp', 'state'],
        ['id', 'name', 'role', 'level', 'levelLabel', 'hp', 'mp', 'state'],
    ]);
    assert.deepEqual(list[0], {
        id: 'pc', name: 'Ren', role: null, level: 1, levelLabel: 'Soul Class I (Lv 1)',
        hp: { cur: pc.hp.cur, max: pc.hp.max }, mp: { cur: pc.mp.cur, max: pc.mp.max },
        state: 'badly hurt (bleeding, slow to move)',
    });
    assert.equal(list[1].id, 'astra');
    assert.equal(list[1].name, 'Astra');
    assert.equal(list[1].role, 'healer');
    assert.equal(list[1].level, 14);
    assert.equal(list[1].levelLabel, 'Soul Class II (Lv 14)');
    assert.equal(list[1].state, 'unhurt');
    assert.ok(Object.isFrozen(list) && Object.isFrozen(list[0]) && Object.isFrozen(list[0].hp) && Object.isFrozen(list[1].mp));
    assert.throws(() => { list[0].hp.cur = 999; }, TypeError);
    assert.equal(pc.hp.cur, Math.round(pc.hp.max * 0.3), 'the sheet is not touched');
    assert.doesNotThrow(() => JSON.stringify(list), 'plain data');
});

test('members: nothing to share is [], a party without a Character still shares its companions', () => {
    assert.deepEqual(partyMembers(null, []), []);
    assert.deepEqual(partyMembers(undefined, undefined), []);
    assert.deepEqual(partyMembers(null, [null, { id: 'x' }]), [], 'a member without a sheet is skipped');
    const astra = newCompanion({ name: 'Astra', role: 'healer', level: 2, preset: PRESETS[3] }, { rules, existing: [] });
    assert.deepEqual(partyMembers(null, [astra], rules).map(member => [member.id, member.levelLabel]), [['astra', 'Level 2']]);
});

test('notice: Story Block offering stats while RPG Battle owns them', () => {
    const { suite } = announced();
    suite.announce(BLOCK);
    assert.equal(sheetNotice({ suite, choice: 'auto' }), true);
    assert.equal(sheetNotice({ suite, choice: 'mine' }), true);
    assert.equal(sheetNotice({ suite, choice: 'theirs' }), false, 'the reader keeps Story Block\'s sheet on purpose');
    suite.announce({ ...BLOCK, owns: ['scene', 'items'] });
    assert.equal(sheetNotice({ suite, choice: 'auto', storySheetOn: true }), false, 'Story Block in the suite is believed over its settings');
    suite.announce({ ...BLOCK, enabled: false });
    assert.equal(sheetNotice({ suite, choice: 'auto', storySheetOn: true }), false);
});

test('notice: an older Story Block outside the suite is read as before, whatever the choice', () => {
    const { suite } = announced();
    for (const choice of ['auto', 'mine', 'theirs']) {
        assert.equal(sheetNotice({ suite, choice, storySheetOn: true }), true, choice);
        assert.equal(sheetNotice({ suite, choice, storySheetOn: false }), false, choice);
    }
    let asked = 0;
    assert.equal(sheetNotice({ suite, storySheetOn: () => { asked += 1; return true; } }), true);
    assert.equal(asked, 1);
    suite.announce(BLOCK);
    assert.equal(sheetNotice({ suite, storySheetOn: () => { asked += 1; return false; } }), true);
    assert.equal(asked, 1, 'not asked once Story Block speaks for itself');
    assert.equal(sheetNotice({ suite: null, storySheetOn: true }), true);
});

test('sources: who the story follows per area, by the choices', () => {
    const { suite } = announced();
    assert.deepEqual(sources(suite, null), {
        stats: { mine: true, name: 'RPG Battle' },
        rolls: { mine: true, name: 'RPG Battle' },
        items: { mine: true, name: 'RPG Battle' },
    }, 'alone: RPG Battle for everything');
    suite.announce(BLOCK);
    assert.deepEqual(sources(suite, {}), {
        stats: { mine: true, name: 'RPG Battle' },
        rolls: { mine: true, name: 'RPG Battle' },
        items: { mine: false, name: 'Story Block' },
    });
    assert.deepEqual(sources(suite, { stats: 'theirs', rolls: 'theirs', items: 'mine' }), {
        stats: { mine: false, name: 'Story Block' },
        rolls: { mine: true, name: 'RPG Battle' },
        items: { mine: true, name: 'RPG Battle' },
    }, 'theirs with nobody else offering rolls stays here');
});

test('the signature changes with what is offered, not with a repeated announcement', () => {
    const { suite, api } = announced();
    const before = suiteSignature(suite);
    suite.announce(announcement({ version: '0.3.0', api: { ...api } }));
    assert.equal(suiteSignature(suite), before);
    suite.announce(BLOCK);
    const together = suiteSignature(suite);
    assert.notEqual(together, before);
    suite.announce({ ...BLOCK, owns: ['stats', 'items', 'scene'] });
    assert.equal(suiteSignature(suite), together, 'the order of the areas does not matter');
    suite.announce({ ...BLOCK, owns: ['scene', 'items'] });
    assert.notEqual(suiteSignature(suite), together, 'the Character Sheet switched off');
});
