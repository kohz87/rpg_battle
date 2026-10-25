// The fixed modifier coverage survives the flip in rules/, where SD now asks for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTRA_CAP, extrasOf, itemTopics, modifiersFor, tableLine, topicsOf } from '../../../src/v2/rules/modifiers.js';

test('topics: a check\'s skill word falls under fixed topics; items by their name or tags', () => {
    assert.deepEqual(topicsOf('stealth'), ['stealth']);
    assert.deepEqual(topicsOf('Perception'), ['perception']);
    assert.deepEqual(topicsOf('lockpicking'), ['lock']);
    assert.deepEqual(topicsOf('climbing'), ['climb']);
    assert.deepEqual(topicsOf('resist poison'), ['endurance', 'will']);
    assert.deepEqual(topicsOf('dance'), []);
    assert.deepEqual(itemTopics({ name: 'Hempen Rope' }), ['climb']);
    assert.deepEqual(itemTopics({ name: 'Thieves\' Tools' }), ['lock', 'craft']);
    assert.deepEqual(itemTopics({ name: 'Odd Stone', tags: ['luck'] }), ['luck']);
});

test('modifiers: the stat, +2 a skill in use, +1 a talent by its tags, +1 one item; at most +3 on top', () => {
    const actor = {
        id: 'ac_x', name: 'Ren', stats: { DEX: 9, INT: 5 },
        skills: [{ name: 'Sneak Attack', active: true }, { name: 'Lockpicking', active: true }, { name: 'Stealthy Step', active: false }],
    };
    const member = {
        actor,
        extras: extrasOf({
            actor,
            talents: [{ name: 'Night Owl', tags: ['dark'] }, { name: 'Keen Eyes', tags: ['perception'] }, { name: 'Shadow-born', tags: [] }],
            items: [{ name: 'Rope', kind: 'goods' }, { name: 'Lockpicks', kind: 'goods' }, { name: 'Lantern', kind: 'goods' }, { name: 'Torch', kind: 'goods' }, { name: 'Lockpick Draught', kind: 'consumable' }],
        }),
    };
    assert.deepEqual(member.extras.map(extra => [extra.source, extra.name, extra.topics, extra.amount]), [
        ['skill', 'Lockpicking', ['lock'], 2],
        ['skill', 'Sneak Attack', ['stealth'], 2],
        ['talent', 'Keen Eyes', ['perception'], 1],
        ['talent', 'Night Owl', ['stealth'], 1],
        ['item', 'Lantern', ['perception'], 1],
        ['item', 'Lockpicks', ['lock'], 1],
        ['item', 'Rope', ['climb'], 1],
        ['item', 'Torch', ['perception'], 1],
    ], 'an inactive skill, a talent without a topic and a consumable do not count');
    assert.deepEqual(modifiersFor(member, 'stealth'), [
        { source: 'stat', amount: 2, reason: 'DEX' }, { source: 'skill', amount: 2, reason: 'Sneak Attack' }, { source: 'talent', amount: 1, reason: 'Night Owl' },
    ]);
    assert.deepEqual(modifiersFor(member, 'perception'), [
        { source: 'stat', amount: 0, reason: 'INT' }, { source: 'talent', amount: 1, reason: 'Keen Eyes' }, { source: 'item', amount: 1, reason: 'Lantern' },
    ], 'only one item counts');
    const lots = modifiersFor({ actor, extras: [...member.extras, { source: 'skill', name: 'Picklock Master', topics: ['lock'], amount: 2 }] }, 'pick the lock');
    assert.equal(lots.slice(1).reduce((sum, entry) => sum + entry.amount, 0), EXTRA_CAP, 'capped at +3');
    assert.deepEqual(modifiersFor(member, 'dance'), [{ source: 'stat', amount: 0, reason: 'LUK' }]);
    assert.equal(tableLine(member, { you: true }), 'Ren (you): STR +0, VIT +0, AGI +0, DEX +2, INT +0, LUK +0, CHA +0; +2 lock (Lockpicking), +2 stealth (Sneak Attack), +1 perception (Keen Eyes), +1 stealth (Night Owl), +1 perception (Lantern), +1 lock (Lockpicks), +1 climb (Rope), +1 perception (Torch).');
});

