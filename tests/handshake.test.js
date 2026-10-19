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
import { SETTINGS_ROOT, SHARED_AREAS, SUITE_ID, announcement, manageApi, partyMembers, sheetNotice, sources, suiteOverlay, suiteSignature, truthChoices } from '../src/handshake.js';

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
    assert.deepEqual({ ...entry, api: null }, {
        id: 'rpg-battle', name: 'RPG Battle', version: '0.3.0', owns: ['stats', 'rolls', 'items'],
        enabled: true, settings: '#rpg_battle_settings', api: null,
    });
    assert.equal(SETTINGS_ROOT, '#rpg_battle_settings', 'the panel\'s root under Extensions (index.js mounts it there)');
    assert.equal(entry.api, api);
    const { suite } = announced();
    suite.announce(BLOCK);
    assert.equal(suite.owner('stats'), SUITE_ID);
    assert.equal(suite.owner('rolls'), SUITE_ID);
    assert.equal(suite.owner('items'), 'story-block');
    suite.withdraw(SUITE_ID);
    assert.equal(suite.owner('stats'), 'story-block');
});

test('switched off: announced with enabled: false, keeping its panel and api.manage, and skipped for ownership', () => {
    const suite = storySuite();
    const manage = manageApi({ choices: () => null, choose: () => {}, enabled: () => false, enable: () => {} });
    const api = { members: () => [], manage };
    suite.announce(BLOCK);
    suite.announce(announcement({ version: '0.3.3', api, enabled: false }));
    const entry = suite.providers().find(provider => provider.id === SUITE_ID);
    assert.equal(entry.enabled, false);
    assert.equal(entry.settings, '#rpg_battle_settings');
    assert.equal(entry.api.manage, manage, 'the overlay reads it from providers() to switch it back on');
    assert.equal(suite.has(SUITE_ID), false);
    assert.equal(suite.api(SUITE_ID), null);
    assert.equal(suite.owner('stats'), 'story-block');
    assert.equal(suite.owner('rolls'), null);
    const before = suiteSignature(suite);
    suite.announce(announcement({ version: '0.3.3', api, enabled: true }));
    assert.notEqual(suiteSignature(suite), before, 'switching back on is a change');
    assert.equal(suite.owner('stats'), SUITE_ID);
    assert.equal(suite.api(SUITE_ID), api);
});

test('api.manage: the areas, the choices as saved, setSource validated, the switch', () => {
    const saved = { enabled: true, sourceOfTruth: { stats: 'auto', rolls: 'auto', items: 'auto' } };
    const applied = [];
    const manage = manageApi({
        choices: () => saved.sourceOfTruth,
        choose: (area, choice) => { applied.push([area, choice]); saved.sourceOfTruth = { ...saved.sourceOfTruth, [area]: choice }; },
        enabled: () => saved.enabled,
        enable: on => { applied.push(['enabled', on]); saved.enabled = on; },
    });
    assert.ok(Object.isFrozen(manage));
    assert.deepEqual(manage.areas, ['stats', 'rolls', 'items']);
    assert.deepEqual(manage.sources(), { stats: 'auto', rolls: 'auto', items: 'auto' });
    const copy = manage.sources();
    copy.stats = 'mine';
    assert.equal(saved.sourceOfTruth.stats, 'auto', 'sources() is a copy');
    assert.equal(manage.setSource('stats', 'theirs'), true);
    assert.equal(manage.setSource('items', 'mine'), true);
    assert.deepEqual(saved.sourceOfTruth, { stats: 'theirs', rolls: 'auto', items: 'mine' });
    assert.deepEqual(manage.sources(), { stats: 'theirs', rolls: 'auto', items: 'mine' });
    for (const [area, choice] of [['scene', 'mine'], ['stats', 'everything'], ['stats', undefined], [undefined, 'auto'], ['toString', 'auto']]) {
        assert.equal(manage.setSource(area, choice), false, `${area}/${choice}`);
    }
    assert.deepEqual(applied, [['stats', 'theirs'], ['items', 'mine']], 'nothing unknown reaches the settings');
    assert.equal(manage.enabled(), true);
    manage.setEnabled(false);
    assert.equal(manage.enabled(), false);
    manage.setEnabled(1);
    assert.deepEqual(applied.slice(-2), [['enabled', false], ['enabled', true]], 'always a boolean');
    assert.equal(manage.enabled(), true);
    // Saved choices from an older version read as Automatic.
    const old = manageApi({ choices: () => ({ stats: 'nonsense' }), choose: () => {}, enabled: () => undefined, enable: () => {} });
    assert.deepEqual(old.sources(), { stats: 'auto', rolls: 'auto', items: 'auto' });
    assert.equal(old.enabled(), true, 'on unless switched off');
});

test('the overlay link: two or more announced and Story Block sharing openSuite, opened on RPG Battle\'s tab', () => {
    const suite = storySuite();
    assert.equal(suiteOverlay(null), null);
    suite.announce(announcement({ version: '0.3.3', api: {}, enabled: false }));
    assert.equal(suiteOverlay(suite), null, 'alone');
    const opened = [];
    const blockApi = { openSuite(tab) { opened.push([this === blockApi, tab]); } };
    suite.announce({ ...BLOCK, api: {} });
    assert.equal(suiteOverlay(suite), null, 'an older Story Block without the overlay');
    suite.announce({ ...BLOCK, api: blockApi });
    const open = suiteOverlay(suite);
    assert.equal(typeof open, 'function', 'shown with RPG Battle switched off too');
    open();
    assert.deepEqual(opened, [[true, 'rpg-battle']]);
    suite.announce({ ...BLOCK, api: blockApi, enabled: false });
    assert.equal(suiteOverlay(suite), null, 'Story Block switched off shares nothing');
    suite.announce({ ...BLOCK, api: blockApi });
    suite.withdraw(SUITE_ID);
    assert.equal(suiteOverlay(suite), null, 'Story Block alone');
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
        ['id', 'name', 'role', 'level', 'levelLabel', 'hp', 'mp', 'sp', 'state'],
        ['id', 'name', 'role', 'level', 'levelLabel', 'hp', 'mp', 'sp', 'state'],
    ]);
    assert.deepEqual(list[0], {
        id: 'pc', name: 'Ren', role: null, level: 1, levelLabel: 'Soul Class I (Lv 1)',
        hp: { cur: pc.hp.cur, max: pc.hp.max }, mp: { cur: pc.mp.cur, max: pc.mp.max }, sp: { cur: pc.sp.cur, max: pc.sp.max },
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

test('api.manage.tokens: what RPG Battle adds to the next reply, about four characters a token, never throwing', async () => {
    const { HIDDEN_BLOCKS_ALLOWANCE, manageApi, tokenEstimate } = await import('../src/handshake.js');
    const { STORY_INSTRUCTION } = await import('../src/story.js');
    assert.deepEqual(tokenEstimate(), { input: 0, output: 0, parts: [] });
    const asks = tokenEstimate({ instruction: STORY_INSTRUCTION });
    assert.deepEqual(asks.parts, [{ label: 'Story instruction (rpg_battle_rules)', input: Math.ceil(STORY_INSTRUCTION.length / 4), output: HIDDEN_BLOCKS_ALLOWANCE }]);
    assert.equal(asks.input, Math.ceil(STORY_INSTRUCTION.length / 4));
    const narrating = tokenEstimate({ instruction: STORY_INSTRUCTION, handoff: 'x'.repeat(400) });
    assert.deepEqual(narrating, { input: 100, output: 0, parts: [{ label: 'Fight hand-off (rpg_battle)', input: 100, output: 0 }] }, 'the hand-off goes instead of the instruction');
    const base = { choices: () => ({}), choose: () => {}, enabled: () => true, enable: () => {} };
    assert.deepEqual(manageApi({ ...base, tokens: () => { throw new Error('boom'); } }).tokens(), { input: 0, output: 0, parts: [] });
    assert.equal(manageApi({ ...base, tokens: () => asks }).tokens(), asks);
    assert.deepEqual(manageApi(base).tokens(), { input: 0, output: 0, parts: [] });
});
