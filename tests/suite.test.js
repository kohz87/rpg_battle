// The Story Suite registry (src/suite.js, shared byte for byte with the other extensions):
// announcing, who owns an area, fallbacks, withdrawing, listeners, taking over an older
// registry, and isSourceOfTruth for each choice. Every test starts from an empty globalThis.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, SUITE_VERSION, isSourceOfTruth, storySuite } from '../src/suite.js';

beforeEach(() => {
    delete globalThis.StorySuite;
});

const BLOCK = { id: 'story-block', name: 'Story Block', version: '0.8.0', owns: ['scene', 'stats', 'items', 'rolls', 'timeline'] };
const BATTLE = { id: 'rpg-battle', name: 'RPG Battle', version: '0.3.0', owns: ['stats', 'rolls', 'items'] };

test('the first use creates the registry on globalThis; later uses join it', () => {
    assert.equal(globalThis.StorySuite, undefined);
    const suite = storySuite();
    assert.equal(globalThis.StorySuite, suite);
    assert.equal(storySuite(), suite, 'the same registry, in any load order');
    assert.equal(suite.version, SUITE_VERSION);
    assert.equal(suite.areas, AREAS);
    assert.ok(Object.isFrozen(suite));
});

test('announce: copies, deduplicated areas, enabled by default, updated in place; an id is required', () => {
    const suite = storySuite();
    const owns = ['stats', 'stats', 'rolls'];
    suite.announce({ id: ' rpg-battle ', name: 'RPG Battle', owns });
    owns.push('items');
    assert.deepEqual(suite.providers().map(provider => [provider.id, provider.owns, provider.enabled]), [['rpg-battle', ['stats', 'rolls'], true]]);
    suite.providers()[0].owns.push('scene');
    assert.deepEqual(suite.providers()[0].owns, ['stats', 'rolls'], 'providers() hands out copies');
    suite.announce({ ...BATTLE, enabled: false });
    assert.equal(suite.providers().length, 1, 'announcing again replaces the earlier announcement');
    assert.equal(suite.has('rpg-battle'), false);
    suite.announce({ name: 'nobody' });
    suite.announce({ id: '  ', owns: ['stats'] });
    assert.equal(suite.providers().length, 1);
});

test('owner: the first in AREAS\' order that offers the area, then anyone, else null', () => {
    const suite = storySuite();
    assert.equal(suite.owner('stats'), null);
    suite.announce(BLOCK);
    assert.equal(suite.owner('stats'), 'story-block', 'alone, the next in line owns it');
    suite.announce(BATTLE);
    assert.equal(suite.owner('stats'), 'rpg-battle', 'the specialist wins');
    assert.equal(suite.owner('rolls'), 'rpg-battle');
    assert.equal(suite.owner('items'), 'story-block', 'items: Story Block first, RPG Battle the fallback');
    suite.announce({ ...BLOCK, owns: ['scene'] });
    assert.equal(suite.owner('items'), 'rpg-battle', 'the fallback owns it when Story Block stops offering it');
    suite.announce({ id: 'someone-else', owns: ['weather'] });
    assert.equal(suite.owner('weather'), 'someone-else', 'an area outside AREAS: whoever offers it');
    assert.equal(suite.owner('nothing'), null);
});

test('a disabled provider offers nothing; offering lists the owner first', () => {
    const suite = storySuite();
    suite.announce({ id: 'npc-state-delta', owns: ['stats'] });
    suite.announce(BLOCK);
    suite.announce(BATTLE);
    assert.deepEqual(suite.offering('stats'), ['rpg-battle', 'npc-state-delta', 'story-block']);
    suite.announce({ ...BATTLE, enabled: false });
    assert.equal(suite.owner('stats'), 'story-block');
    assert.deepEqual(suite.offering('stats'), ['story-block', 'npc-state-delta']);
    assert.equal(suite.api('rpg-battle'), null, 'a disabled provider shares nothing');
    assert.deepEqual(suite.offering('calendar'), []);
});

test('api: what a provider chose to share, or null', () => {
    const suite = storySuite();
    const api = { members: () => [] };
    suite.announce({ ...BATTLE, api });
    assert.equal(suite.api('rpg-battle'), api);
    suite.announce(BLOCK);
    assert.equal(suite.api('story-block'), null);
    assert.equal(suite.api('story-director'), null);
});

test('withdraw removes a provider and notifies only when it was there', () => {
    const suite = storySuite();
    suite.announce(BLOCK);
    suite.announce(BATTLE);
    let calls = 0;
    suite.onChange(() => { calls += 1; });
    suite.withdraw('rpg-battle');
    assert.equal(calls, 1);
    assert.equal(suite.has('rpg-battle'), false);
    assert.equal(suite.owner('stats'), 'story-block');
    suite.withdraw('rpg-battle');
    assert.equal(calls, 1, 'nothing to withdraw: no change');
});

test('onChange: every announcement and withdrawal; a failing listener does not stop the others; unsubscribe', () => {
    const suite = storySuite();
    const seen = [];
    const warn = console.warn;
    console.warn = () => {};
    try {
        suite.onChange(() => { throw new Error('boom'); });
        const stop = suite.onChange(() => seen.push(suite.owner('stats')));
        suite.announce(BLOCK);
        suite.announce(BATTLE);
        suite.withdraw('rpg-battle');
        assert.deepEqual(seen, ['story-block', 'rpg-battle', 'story-block']);
        stop();
        suite.announce(BATTLE);
        assert.equal(seen.length, 3, 'unsubscribed');
    } finally {
        console.warn = warn;
    }
});

test('a newer suite takes over an older registry, keeping its providers and listeners', () => {
    let calls = 0;
    const listener = () => { calls += 1; };
    const older = {
        version: 0,
        snapshot: () => [['story-block', { ...BLOCK, enabled: true }]],
        listenersSnapshot: () => [listener],
    };
    globalThis.StorySuite = older;
    const suite = storySuite();
    assert.notEqual(suite, older);
    assert.equal(globalThis.StorySuite, suite);
    assert.equal(suite.version, SUITE_VERSION);
    assert.equal(suite.has('story-block'), true);
    assert.equal(suite.owner('items'), 'story-block');
    suite.announce(BATTLE);
    assert.equal(calls, 1, 'the older registry\'s listener still hears changes');
    // A registry as new as this one (or newer) is joined, not replaced.
    const newer = { ...suite, version: SUITE_VERSION + 1 };
    globalThis.StorySuite = newer;
    assert.equal(storySuite(), newer);
});

test('a registry without snapshots (or not a registry at all) is replaced by an empty one', () => {
    globalThis.StorySuite = { version: 'old' };
    const suite = storySuite();
    assert.equal(suite.version, SUITE_VERSION);
    assert.deepEqual(suite.providers(), []);
});

test('isSourceOfTruth alone: every choice is the source of truth', () => {
    const suite = storySuite();
    suite.announce(BATTLE);
    for (const choice of ['auto', 'mine', 'theirs']) assert.equal(isSourceOfTruth('rpg-battle', 'stats', choice, suite), true, choice);
    // Not even announced: still nobody else to defer to.
    assert.equal(isSourceOfTruth('rpg-battle', 'stats', 'auto', storySuite()), true);
    delete globalThis.StorySuite;
    assert.equal(isSourceOfTruth('rpg-battle', 'stats'), true, 'the default suite and choice');
});

test('isSourceOfTruth together: auto follows the owner; mine always; theirs whenever another offers it', () => {
    const suite = storySuite();
    suite.announce(BLOCK);
    suite.announce(BATTLE);
    assert.equal(isSourceOfTruth('rpg-battle', 'stats', 'auto', suite), true, 'RPG Battle owns stats');
    assert.equal(isSourceOfTruth('story-block', 'stats', 'auto', suite), false);
    assert.equal(isSourceOfTruth('rpg-battle', 'items', 'auto', suite), false, 'Story Block owns items');
    assert.equal(isSourceOfTruth('rpg-battle', 'items', 'mine', suite), true);
    assert.equal(isSourceOfTruth('story-block', 'stats', 'mine', suite), true);
    assert.equal(isSourceOfTruth('rpg-battle', 'stats', 'theirs', suite), false);
    assert.equal(isSourceOfTruth('rpg-battle', 'scene', 'theirs', suite), false, 'theirs: another offers it, even an area RPG Battle does not');
    suite.announce({ ...BLOCK, owns: ['scene'] });
    assert.equal(isSourceOfTruth('rpg-battle', 'stats', 'theirs', suite), true, 'theirs, but nobody else offers stats now');
    assert.equal(isSourceOfTruth('rpg-battle', 'scene', 'auto', suite), false);
});
