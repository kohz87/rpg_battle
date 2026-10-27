// src/v2/module.js (MODULES §A): the parts merged into one module definition, checked by Story
// Block's own registry; and index.js, the v2 bootstrap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { definitionProblems } from '../vendor/story-block/src/v2/registry.js';
import { KIND_OVERRIDES, MODULE_ID, PARTS, REV_QUERY, SHARED_SETTINGS, VERSION, createModule, mergeTerms, packTerms, partSettings, withTerms } from '../../src/v2/module.js';

const module = createModule({ settings: () => ({}) });

test('the merged module is a valid Story Block module with every part\'s pieces', () => {
    assert.deepEqual(definitionProblems(module), []);
    assert.equal(module.id, MODULE_ID);
    assert.equal(module.version, VERSION);
    assert.deepEqual(PARTS.map(([id]) => id), ['rules', 'progress', 'training', 'modifiers', 'party', 'creation', 'quests', 'items', 'combat', 'board', 'return', 'trade', 'craft', 'screens']);
    assert.deepEqual(Object.keys(module.domains).sort(), ['bestiary', 'combat', 'craft', 'creation', 'effects', 'gear', 'party', 'trade']);
    for (const [, part] of PARTS.filter(([id]) => !['rules', 'progress', 'training'].includes(id))) {
        for (const type of Object.keys(part.commands ?? {})) assert.equal(typeof module.commands[type], 'function', type);
        for (const name of Object.keys(part.queries ?? {})) {
            // What a part lists in pinnedQueries answers only on a pinned chat, as the rules parts do (legacy.test.js).
            if (part.pinnedQueries?.includes(name)) assert.equal(Object.hasOwn(module.queries, name), false, `${name} awaits pinned preflight`);
            else assert.equal(typeof module.queries[name], 'function', name);
        }
        for (const name of Object.keys(part.widgets ?? {})) assert.ok(module.widgets[name], name);
        for (const screen of part.screens ?? []) assert.ok(module.screens.includes(screen), screen.id);
    }
    assert.deepEqual(Object.keys(module.capture.kinds).sort(), ['craft', 'effect', 'encounter', 'join', 'leave', 'market', 'quest', 'recipe', 'refine', 'repair', 'rest', 'skill', 'use', 'wound', 'xp']);
    assert.deepEqual(Object.keys(module.widgets).sort(), ['rpg-battle.battle-board', 'rpg-battle.character-file', 'rpg-battle.choice-pick', 'rpg-battle.class-pick', 'rpg-battle.command-button', 'rpg-battle.command-input', 'rpg-battle.create-character', 'rpg-battle.draft-start', 'rpg-battle.equipment', 'rpg-battle.import-pick', 'rpg-battle.item-detail', 'rpg-battle.member-toggle', 'rpg-battle.permanent-choice', 'rpg-battle.preset-pick', 'rpg-battle.quest-binding', 'rpg-battle.return-card', 'rpg-battle.rules-pin', 'rpg-battle.skill-tree', 'rpg-battle.stat-radar', 'rpg-battle.talent-roll', 'rpg-battle.trainer-binding']);
    assert.deepEqual(module.screens.map(screen => screen.id), ['rpg-battle/create', 'rpg-battle/fight', 'rpg-battle/party', 'rpg-battle/trade', 'rpg-battle/crafting', 'rpg-battle/hud', 'rpg-battle/status-card', 'rpg-battle/progress', 'rpg-battle/quests', 'rpg-battle/roster', 'rpg-battle/links', 'rpg-battle/setup']);
    assert.equal(typeof module.queries[REV_QUERY], 'function');
    // Party keeps check.resolve; the check line is the checks part's.
    assert.equal(module.commands['check.resolve'], undefined);
    assert.deepEqual(KIND_OVERRIDES, {});
    assert.equal(module.capture.kinds.check, undefined);
    assert.equal(module.domains.checks, undefined);
});

test('context: statics joined in part order (fixed text), budgets summed', () => {
    const parts = PARTS.map(([, part]) => part).filter(part => typeof part.context?.static === 'function');
    assert.equal(module.context.static(), parts.map(part => part.context.static().trim()).filter(Boolean).join('\n'));
    assert.equal(module.context.static(), module.context.static());
    const budget = PARTS.reduce((sum, [, part]) => sum + (part.context?.budget ?? 0), 0);
    assert.equal(module.context.budget, budget);
    assert.deepEqual(module.context.tail({ state: { v: 2, meta: { rev: 0, claims: {} }, domains: {} }, settings: () => ({}) }), { lines: [], optional: [] });
});

test('settings: each part\'s keys under its part id, labelled with its section; a part reads its own bare', () => {
    assert.equal(module.settings.defaults['combat.hitBase'], 75);
    assert.equal(module.settings.defaults['party.autoSpend'], true);
    assert.deepEqual(module.settings.defaults['trade.placePrices'], []);
    assert.equal(module.settings.schema['party.startPoints'].label, 'Character: Points a new character spends');
    assert.equal(module.settings.schema['trade.placePrices'].label, 'Trade: Prices by place');
    const all = { ...module.settings.defaults, 'combat.hitBase': 60, rules: { gear: {} }, xpRate: 2 };
    assert.deepEqual(partSettings(all, 'combat'), { rules: { gear: {} }, xpRate: 2, turnOrder: 'timeline', speedOffset: 10, hitBase: 60, hitPerPoint: 3, fieldPerMember: 4, fieldMax: 9 });
    assert.equal(partSettings(all, 'party').hitBase, undefined);
    assert.equal(partSettings(all, 'party').xpRate, 2);
});

test('tabs: a hand-built tab a screen covers gives way to it; every screen and widget is merged once', () => {
    // Party, Trade and Crafting are the screens part's; Fight is the board part's screen. The items
    // part's hand-built Items tab is retired: Story Block's Inventory is the one bag (MODULES §F99).
    assert.deepEqual(module.tabs.map(tab => tab.id), []);
    const tabbed = module.screens.filter(screen => screen.mounts.includes('tab')).map(screen => screen.id);
    assert.deepEqual(tabbed, ['rpg-battle/fight', 'rpg-battle/party', 'rpg-battle/trade', 'rpg-battle/crafting', 'rpg-battle/progress', 'rpg-battle/quests', 'rpg-battle/roster', 'rpg-battle/links', 'rpg-battle/setup']);
    const ids = module.screens.map(screen => screen.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('a screen or a widget two parts claim is refused', () => {
    const board = PARTS.find(([id]) => id === 'board')[1];
    const trade = PARTS.find(([id]) => id === 'trade')[1];
    trade.screens = [board.screens[0]];
    try {
        assert.throws(() => createModule(), /the screen "rpg-battle\/fight" is in two parts \(board and trade\)/);
    } finally {
        delete trade.screens;
    }
    trade.widgets = { 'rpg-battle.battle-board': board.widgets['rpg-battle.battle-board'] };
    try {
        assert.throws(() => createModule(), /the widget "rpg-battle\.battle-board" is in two parts \(board and trade\)/);
    } finally {
        delete trade.widgets;
    }
});

test('settings: creation reads the Character points budget as party.startPoints and party.statCap', () => {
    assert.deepEqual(SHARED_SETTINGS, { creation: { party: ['startPoints', 'statCap'] } });
    const all = { ...module.settings.defaults, 'party.startPoints': 12, 'party.statCap': 20, 'creation.maxTalents': 1 };
    const own = partSettings(all, 'creation');
    assert.equal(own['party.startPoints'], 12);
    assert.equal(own['party.statCap'], 20);
    assert.equal(own.maxTalents, 1);
    assert.equal(own.startPoints, undefined, 'never bare: a part\'s bare keys are its own');
    assert.equal(partSettings(all, 'combat')['party.startPoints'], undefined);
    // The creation query's rules through the merged module.
    const content = module.queries['creation.content']({ v: 2, meta: { rev: 0, claims: {} }, domains: {} }, { settings: all });
    assert.equal(content.rules.startPoints, 12);
    assert.equal(content.rules.statCap, 20);
});

test('terms (§F25): a pack\'s suggestion under the reader\'s own, field by field; read defensively', () => {
    const query = list => (name, args) => {
        assert.equal(name, 'packs.content');
        assert.deepEqual(args, { kind: 'terms' });
        return list;
    };
    assert.equal(packTerms(null), null);
    assert.equal(packTerms(() => { throw new Error('no packs part'); }), null);
    assert.equal(packTerms(query([])), null);
    assert.equal(packTerms(query('nonsense')), null);
    assert.deepEqual(packTerms(query([{ pack: 'a' }, { pack: 'ersveil', levelName: ' Soul  Class ', xp: 'Soul Growth', tiers: { size: 10, numerals: 'roman' }, cap: 50 }])),
        { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' } });
    assert.deepEqual(packTerms(query([{ pack: 'p', terms: { levelName: 'Rank', tiers: true } }])), { levelName: 'Rank', tiers: { size: 10, numerals: 'roman' } });
    const pack = { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' } };
    assert.deepEqual(mergeTerms(undefined, pack), pack);
    assert.deepEqual(mergeTerms({ levelName: 'Circle', xpName: '' }, pack), { levelName: 'Circle', xpName: 'Soul Growth', tiers: pack.tiers });
    assert.deepEqual(mergeTerms({ tiers: { enabled: false } }, pack).tiers, { enabled: false });
    assert.equal(mergeTerms(undefined, null), undefined);
    const settings = { xpRate: 1 };
    assert.equal(withTerms(settings, query([])), settings, 'unchanged when no pack suggests any');
    assert.deepEqual(withTerms({ terms: { xpName: 'Growth' } }, query([pack])).terms, { xpName: 'Growth', levelName: 'Soul Class', tiers: pack.tiers });
});

test('terms reach a part through its ctx, its view and its query tools', () => {
    const pack = [{ pack: 'ersveil', levelName: 'Soul Class', xpName: 'Soul Growth' }];
    const host = name => (name === 'packs.content' ? pack : null);
    const state = { v: 2, meta: { rev: 0, claims: {} }, domains: {} };
    assert.deepEqual(module.queries['party.terms'](state, {}, { query: host }), { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: null });
    assert.deepEqual(module.queries['party.terms'](state, {}, { query: () => [] }), { levelName: 'Level', xpName: 'XP', tiers: null });
    const reader = createModule({ settings: () => ({ terms: { xpName: 'Power Growth' } }) });
    assert.deepEqual(reader.queries['party.terms'](state, {}, { query: host }), { levelName: 'Soul Class', xpName: 'Power Growth', tiers: null }, 'the reader\'s own word wins');
});

test('a name two parts claim is refused when the module is built', async () => {
    const { part: party } = await import('../../src/v2/party/index.js');
    const twice = PARTS.find(([id]) => id === 'trade')[1];
    const saved = twice.commands['party.create'];
    twice.commands['party.create'] = party.commands['party.create'];
    try {
        assert.throws(() => createModule(), /the command "party\.create" is in two parts \(party and trade\)/);
    } finally {
        if (saved === undefined) delete twice.commands['party.create'];
        else twice.commands['party.create'] = saved;
    }
});

test('canGenerate: any part\'s no blocks (no character yet; a dead character)', async () => {
    const state = party => ({ v: 2, meta: { rev: 0, claims: {} }, domains: { party } });
    const pc = conditions => ({ pc: 'ac_00000001', order: ['ac_00000001'], actors: { ac_00000001: { id: 'ac_00000001', name: 'Ren', kind: 'pc', conditions } }, custom: {}, offers: [] });
    assert.deepEqual(await module.hooks.canGenerate({ state: state({ pc: null, order: [], actors: {}, custom: {}, offers: [] }) }), { ok: false, reason: 'Create your character first.', action: 'Create your character' });
    assert.equal((await module.hooks.canGenerate({ state: state(pc([{ kind: 'dead', stacks: 1 }])) })).ok, false);
    assert.match((await module.hooks.canGenerate({ state: state(pc([{ kind: 'dead', stacks: 1 }])) })).reason, /You died/);
    assert.deepEqual(await module.hooks.canGenerate({ state: state(pc([])) }), { ok: true });
});

test('canGenerate: a skipped start card (creation.skipStart) lets replies through with no character; the other parts still block', async () => {
    const empty = { pc: null, order: [], actors: {}, custom: {}, offers: [] };
    const skipped = party => ({ v: 2, meta: { rev: 0, claims: {} }, domains: { party, creation: { rolled: [], skipped: true } } });
    const open = { v: 2, meta: { rev: 0, claims: {} }, domains: { party: empty, creation: { rolled: [], skipped: false } } };
    assert.deepEqual(await module.hooks.canGenerate({ state: skipped(empty) }), { ok: true });
    assert.equal((await module.hooks.canGenerate({ state: open })).ok, false, 'not skipped: still blocked');
    const dead = { pc: 'ac_00000001', order: ['ac_00000001'], actors: { ac_00000001: { id: 'ac_00000001', name: 'Ren', kind: 'pc', conditions: [{ kind: 'dead', stacks: 1 }] } }, custom: {}, offers: [] };
    assert.equal((await module.hooks.canGenerate({ state: skipped(dead) })).ok, false, 'a dead character still stops the story');
});

test('item.define: the items part\'s rules with its settings; beforeGenerate: the checks part\'s rolls', async () => {
    const def = { id: 'story/mana-tonic', name: 'Mana Tonic', kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' };
    const out = module.hooks['item.define'](def, { note: 'mp 20', owner: 'party' });
    assert.equal(out.kind, 'consumable');
    assert.equal(out.effect.mp, 20);
    // MODULES §F80: fresh rolls for the reply about to be written (module.js hands the hook the view).
    const cues = await module.hooks.beforeGenerate({ state: { domains: { checks: { prepared: [], log: [], last: null } } }, chat: { length: 6, lastUser: '' }, query: () => { throw new Error('none'); } });
    assert.deepEqual(cues, { lines: [], commands: [] });
});

test('index.js: registers the module with Story Block v2; without it, one drawer line and nothing else', async () => {
    const registered = [];
    const sdk = { settings: () => ({}), preflight: () => ({ hostApi: 2, classification: 'empty', peers: [], restore: 'idle' }), registerModule: async def => { registered.push(def); return sdk; } };
    globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve(sdk), sdk };
    try {
        const { booted, boot, MISSING_TEXT } = await import('../../index.js');
        assert.deepEqual(await booted, { ok: true, sdk });
        assert.equal(registered[0].id, MODULE_ID);
        assert.deepEqual(definitionProblems(registered[0]), []);

        const appended = [];
        const drawer = { querySelector: () => null, appendChild: node => appended.push(node) };
        const doc = { createElement: () => ({}), querySelector: selector => (selector === '#extensions_settings2' ? drawer : null) };
        const missing = await boot({ global: {}, doc, waitMs: 0 });
        assert.deepEqual(missing, { ok: false, reason: 'no-host' });
        assert.equal(appended.length, 1);
        assert.equal(appended[0].textContent, MISSING_TEXT);
        assert.match(MISSING_TEXT, /needs Story Block v2/);
        // A v1 Story Block is no host for RPG Battle 2.
        assert.equal((await boot({ global: { StoryBlock: { apiVersion: 1 } }, doc, waitMs: 0 })).ok, false);
    } finally {
        delete globalThis.StoryBlock;
    }
});

test('manifest: 2.0.0-beta.2, depends on Story Block, no v1 interceptor', async () => {
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.equal(manifest.version, VERSION);
    assert.equal(pkg.version, VERSION);
    assert.deepEqual(manifest.dependencies, ['third-party/Story_block']);
    assert.equal(manifest.generate_interceptor, undefined);
    assert.equal(manifest.js, 'index.js');
});

test('the module forwards the parts\' replayQueries (Story Block answers a guard\'s query only from this list)', async () => {
    const { createModule } = await import('../../src/v2/module.js');
    const def = createModule();
    assert.ok(def.replayQueries.includes('party.actor') && def.replayQueries.includes('party.actors'));
    for (const name of def.replayQueries) assert.equal(typeof def.queries[name], 'function', `${name} is a query of the module`);
});
