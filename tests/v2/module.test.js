// src/v2/module.js (MODULES §A): the parts merged into one module definition, checked by Story
// Block's own registry; and index.js, the v2 bootstrap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { definitionProblems } from '../vendor/story-block/src/v2/registry.js';
import { KIND_OVERRIDES, MODULE_ID, PARTS, REV_QUERY, VERSION, createModule, partSettings } from '../../src/v2/module.js';

const module = createModule({ settings: () => ({}) });

test('the merged module is a valid Story Block module with every part\'s pieces', () => {
    assert.deepEqual(definitionProblems(module), []);
    assert.equal(module.id, MODULE_ID);
    assert.equal(module.version, VERSION);
    assert.deepEqual(PARTS.map(([id]) => id), ['party', 'checks', 'items', 'combat', 'return', 'trade']);
    assert.deepEqual(Object.keys(module.domains).sort(), ['bestiary', 'checks', 'combat', 'party', 'trade']);
    for (const [, part] of PARTS) {
        for (const type of Object.keys(part.commands ?? {})) assert.equal(typeof module.commands[type], 'function', type);
        for (const name of Object.keys(part.queries ?? {})) assert.equal(typeof module.queries[name], 'function', name);
        for (const tab of part.tabs ?? []) assert.ok(module.tabs.some(entry => entry.id === tab.id), tab.id);
        for (const name of Object.keys(part.widgets ?? {})) assert.ok(module.widgets[name], name);
    }
    assert.deepEqual(Object.keys(module.capture.kinds).sort(), ['check', 'encounter', 'join', 'rest', 'skill', 'wound']);
    assert.deepEqual(Object.keys(module.widgets).sort(), ['rpg-battle.check-card', 'rpg-battle.return-card']);
    assert.equal(typeof module.queries[REV_QUERY], 'function');
    // Party keeps check.resolve; the check line is the checks part's.
    assert.equal(typeof module.commands['check.resolve'], 'function');
    assert.deepEqual(KIND_OVERRIDES, { check: 'checks' });
    const checks = PARTS.find(([id]) => id === 'checks')[1];
    assert.equal(module.capture.kinds.check.grammar, checks.kinds.check.grammar);
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
    assert.deepEqual(partSettings(all, 'combat'), { rules: { gear: {} }, xpRate: 2, turnOrder: 'timeline', speedOffset: 10, hitBase: 60, hitPerPoint: 3 });
    assert.equal(partSettings(all, 'party').hitBase, undefined);
    assert.equal(partSettings(all, 'party').xpRate, 2);
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
    assert.deepEqual(await module.hooks.canGenerate({ state: state({ pc: null, order: [], actors: {}, custom: {}, offers: [] }) }), { ok: false, reason: 'Create your character first.' });
    assert.equal((await module.hooks.canGenerate({ state: state(pc([{ kind: 'dead', stacks: 1 }])) })).ok, false);
    assert.match((await module.hooks.canGenerate({ state: state(pc([{ kind: 'dead', stacks: 1 }])) })).reason, /You died/);
    assert.deepEqual(await module.hooks.canGenerate({ state: state(pc([])) }), { ok: true });
});

test('item.define: the items part\'s rules with its settings; beforeGenerate: the checks part\'s rolls', async () => {
    const def = { id: 'story/mana-tonic', name: 'Mana Tonic', kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' };
    const out = module.hooks['item.define'](def, { note: 'mp 20', owner: 'party' });
    assert.equal(out.kind, 'consumable');
    assert.equal(out.effect.mp, 20);
    const pending = { pending: [{ id: 'ck_00000001', actor: 'ac_00000001' }] };
    const cues = await module.hooks.beforeGenerate({ state: { domains: { checks: pending, party: { actors: { ac_00000001: { name: 'Ren' } } } } }, query: () => { throw new Error('none'); } });
    assert.deepEqual(cues, { lines: [], commands: [{ type: 'check.roll', payload: { id: 'ck_00000001' } }] });
});

test('index.js: registers the module with Story Block v2; without it, one drawer line and nothing else', async () => {
    const registered = [];
    const sdk = { settings: () => ({}), registerModule: async def => { registered.push(def); return sdk; } };
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

test('manifest: 2.0.0-alpha.1, depends on Story Block, no v1 interceptor', async () => {
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.equal(manifest.version, VERSION);
    assert.equal(pkg.version, VERSION);
    assert.deepEqual(manifest.dependencies, ['third-party/Story_block']);
    assert.equal(manifest.generate_interceptor, undefined);
    assert.equal(manifest.js, 'index.js');
});
