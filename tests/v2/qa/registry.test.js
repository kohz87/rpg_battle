// QA: RPG Battle's module as Story Block registers it (the coordinator's src/v2/module.js),
// beside Story Block's core module in each host's real registry: no clash, a usable initial
// state, a static prompt part that never changes, a tail within its budget, settings in the
// registry's own words. Also: the first four parts merged by hand (MODULES §A, settings as the
// parts write them) register too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from './vendor/src/v2/registry.js';
import { createCoreModule } from './vendor/src/v2/domains/index.js';
import { PARTS, createHarness, each, mergeParts, storyItem, winFight, withHero } from './helpers/harness.js';

each('module.js registers beside the core module: every domain owned once, every initial slice valid', () => {
    const h = createHarness();
    for (const domain of ['party', 'combat', 'bestiary', 'trade']) assert.equal(h.registry.domainOwner(domain), 'rpg-battle', domain);
    for (const domain of ['scene', 'inventory']) assert.equal(h.registry.domainOwner(domain), 'story-block', domain);
    for (const kind of ['wound', 'join', 'skill', 'check', 'rest', 'encounter']) assert.equal(h.registry.captureOwner(kind), 'rpg-battle', kind);
    const state = h.registry.initialState();
    for (const name of Object.keys(state.domains)) {
        const validate = h.registry.validator(name);
        if (validate) assert.deepEqual(validate(state.domains[name], state), [], `${name} initial() passes its own validator`);
    }
});

test('the first four parts, merged by hand with their settings as written, register in Story Block v2\'s registry', () => {
    const registry = createRegistry();
    registry.register(createCoreModule());
    assert.doesNotThrow(() => registry.register(mergeParts(PARTS)));
});

each('the static prompt part is byte-identical across very different states (SPEC §5)', () => {
    const { h } = withHero({ seed: 4 });
    const ctx = h.registry.contexts().find(entry => entry.moduleId === 'rpg-battle');
    const first = ctx.static();
    storyItem(h, 'Minor Healing Draught', 3);
    winFight(h, 'Bandit');
    h.command('party.addCompanion', { name: 'Lyra', role: 'archer', level: 4 }, { cause: 'system' });
    h.capture({ op: '?', kind: 'check', name: 'stealth', text: 'past the guard', labels: { dc: 'hard' } });
    assert.equal(ctx.static(), first);
    assert.doesNotMatch(first, /Ren|Lyra|Bandit/, 'no names in the static part');
    for (const kind of ctx.kinds) assert.doesNotMatch(kind.grammar, /\n/, `${kind.kind} grammar is one line`);
});

each('the tail\'s always-sent lines fit the module budget with a busy state', () => {
    const { h } = withHero();
    for (const name of ['Lyra', 'Kael', 'Mira']) h.command('party.addCompanion', { name, role: 'fighter', level: 3 }, { cause: 'system' });
    for (let n = 0; n < 10; n++) h.capture({ op: '!', kind: 'encounter', name: `${n + 2} Cellar Rats`, text: 'more and more', labels: { tier: 'weak' } });
    const ctx = h.registry.contexts().find(entry => entry.moduleId === 'rpg-battle');
    const out = ctx.tail({ state: h.state(), query: (name, args) => h.query(name, args), settings: () => h.settingsOf('rpg-battle') });
    assert.ok(out.lines.length >= 4, 'a line per member');
    const chars = out.lines.reduce((n, line) => n + line.length + 1, 0);
    assert.ok(chars <= ctx.budget * 4, `always-sent lines ${chars} chars vs budget ${ctx.budget} tokens`);
});

each('settings: every part\'s keys under its part id, and a part reads its own bare', () => {
    const h = createHarness();
    const defaults = h.settingsOf('rpg-battle');
    for (const key of ['party.startPoints', 'combat.turnOrder', 'combat.hitBase', 'trade.placePrices']) assert.ok(Object.hasOwn(defaults, key), key);
    for (const field of Object.values(h.registry.module('rpg-battle').settings.schema)) {
        if (field.type === 'choice') assert.ok(Array.isArray(field.options) && field.options.length, `${field.label}: options`);
    }
});
