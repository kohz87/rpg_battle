// A chat that pins no rules has no equipment planner: module.js leaves `rules.equipPlan` out (and there is no `rules.sheet`
// either), so Story Block keeps storing equipment as it always did and item.equip is inventory.equipOn's own placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModule } from '../../../src/v2/module.js';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { EQUIP_PARTS } from './helpers/equip-parts.js';
import { questPin } from '../quests/helpers/real-host.js';
import { part as rules } from '../../../src/v2/rules/index.js';

const quiet = t => t.mock.method(console, 'warn', () => {});

test('the plain module answers neither rules.equipPlan nor rules.sheet; the planner parts add them; the slot queries stay', () => {
    const plain = createModule({ settings: () => ({}), query: () => [] });
    for (const name of ['rules.equipPlan', 'rules.sheet', 'rules.item', 'rules.identity']) assert.equal(Object.hasOwn(plain.queries, name), false, name);
    for (const name of ['items.slots', 'items.canWear', 'items.gear']) assert.equal(typeof plain.queries[name], 'function', name);
    const planning = createModule({ settings: () => ({}), query: () => [], parts: [...EQUIP_PARTS] });
    for (const name of ['rules.equipPlan', 'rules.sheet']) assert.equal(typeof planning.queries[name], 'function', name);
});

test('behind a successful pinned preflight the planner is registered beside the rules parts\' own rules.sheet, never a stand-in', () => {
    const preflight = { hostApi: 2, restore: 'idle', classification: 'empty', peers: [{ module: 'story-director', enabled: true, version: '2.0.0' }] };
    const pinned = createModule({ settings: () => ({}), query: () => [], rules: questPin(), preflight });
    assert.equal(typeof pinned.queries['rules.equipPlan'], 'function');
    for (const name of ['rules.sheet', 'rules.item', 'rules.identity']) assert.equal(typeof pinned.queries[name], 'function', name);
    assert.deepEqual(Object.keys(pinned.queries).filter(name => name === 'rules.sheet'), ['rules.sheet']);
    assert.ok(Object.hasOwn(rules.queries, 'rules.sheet'), 'the answer is the rules part\'s');
});

test('item.equip on a chat that pins no rules: Story Block places the piece itself, a two-hander still puts the off-hand away', async t => {
    quiet(t);
    await seeded(31, async () => {
        const host = await rpgHost();
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await host.send('We set out.', host.reply('Bluewatch Town.', ['~ place Bluewatch Town | kind: settlement', '+ coin 900',
                '+ item Iron Sword | note: weapon, ATK +4', '+ item Oak Buckler | note: offhand, DEF +2', '+ item Greatsword | note: ATK +9, two-handed, rare']));
            const rows = () => host.q('inventory.items', {});
            const stackOf = name => rows().find(item => item.name === name).stack;
            const at = name => rows().find(item => item.name === name).equipped;
            assert.throws(() => host.q('rules.equipPlan', { stack: stackOf('Iron Sword'), actor: host.q('party.pc').id }), /rules\.equipPlan/);
            for (const name of ['Iron Sword', 'Oak Buckler']) assert.equal((await host.cmd('item.equip', { stack: stackOf(name) })).ok, true, name);
            assert.deepEqual([at('Iron Sword'), at('Oak Buckler')], ['weapon', 'offhand']);
            const great = await host.cmd('item.equip', { stack: stackOf('Greatsword') });
            assert.equal(great.ok, true, great.message);
            assert.deepEqual([at('Greatsword'), at('Iron Sword'), at('Oak Buckler')], ['weapon', null, null]);
            assert.equal(host.q('items.gear', {}).counted.length, 1);
            assert.deepEqual(host.store.problems(), []);
        } finally {
            host.close();
        }
    });
});
