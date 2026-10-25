// Old saves and old (v1) packs keep working exactly as today. The rules-v2 parts are new files; nothing that
// exists was edited, and module.js does not register them yet (the lead wires them behind the host's lifecycle,
// contract §9). These tests hold that down:
//   * the merged module's surface is what it was: no rules-v2 name in it, the same parts in the same order;
//   * a chat that pins no rules is left alone by the parts when they are loaded next to the real module: they
//     answer null or refuse, run nothing after a reply, and write nothing;
//   * a chat recorded by the real module replays the same with them loaded (their hook is never asked about a
//     legacy block), and the real module's state is the same with and without them;
//   * with a rules pack pinned, the real party's level is what rules.progress and the guards read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { part as progressPart } from '../../../src/v2/progress/index.js';
import { PARTS, createModule } from '../../../src/v2/module.js';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { MODULE_ID } from '../../../src/v2/module.js';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { CLOCK, DAY, mergeInto, nextKey, rulesModule } from './helpers/world.js';
import { ref } from './helpers/fixture.js';

const NEW_NAMES = {
    domains: ['rules', 'progress', 'training'],
    commands: ['class.choose', 'path.choose', 'rules.settle', 'skill.train', 'skill.use', 'party.setActive', 'summon.end', 'rules.flagSet', 'rules.registerItem'],
    queries: ['rules.progress', 'rules.identity', 'rules.classes', 'rules.names', 'rules.training', 'rules.sheet', 'rules.party', 'rules.quests', 'rules.flags', 'rules.item'],
    hooks: ['replayGuard'],
};
const SLICE = 'rb-rules-slice';
const json = value => JSON.stringify(value);

test('module.js is as it was: the same ten parts in the same order, and no rules-v2 domain, command, query or hook in the merged module', () => {
    assert.deepEqual(PARTS.map(([id]) => id), ['party', 'creation', 'checks', 'items', 'combat', 'board', 'return', 'trade', 'craft', 'screens']);
    const module = createModule({ settings: () => ({}), query: () => [] });
    for (const name of NEW_NAMES.domains) assert.equal(Object.hasOwn(module.domains, name), false, `domain ${name}`);
    for (const name of NEW_NAMES.commands) assert.equal(Object.hasOwn(module.commands, name), false, `command ${name}`);
    for (const name of NEW_NAMES.queries) assert.equal(Object.hasOwn(module.queries, name), false, `query ${name}`);
    for (const name of NEW_NAMES.hooks) assert.equal(Object.hasOwn(module.hooks, name), false, `hook ${name}`);
    assert.equal(Object.hasOwn(module.hooks, 'afterCapture'), false, 'the real module asks for no step after a reply, so none can be added by accident');
});

test('a chat that pins no rules: the parts answer null or refuse, add no step after a reply and write nothing', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(11, async () => {
        const host = await rpgHost({ modules: [CLOCK, rulesModule({ id: SLICE })] });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            const pc = host.q('party.pc').id;
            await host.send('We go on.', host.reply('Dawn.', ['~ time 600', '+ xp minor — a good start']));
            assert.equal(host.q('rules.progress', { actor: pc }), null);
            assert.equal(host.q('rules.progress', {}), null);
            for (const [type, payload] of [
                ['class.choose', { actor: pc, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash: 'a'.repeat(64) }],
                ['path.choose', { actor: pc, milestone: 40, skill: ref('s30'), fromForm: ref('s30-base'), option: ref('s30-base-g'), rulesHash: 'a'.repeat(64) }],
                ['rules.settle', {}],
            ]) {
                const out = await host.cmd(type, payload);
                assert.equal(out.ok, false, type);
                assert.equal(out.code, 'REFUSED', type);
            }
            // The only receipts are the real module's and the host's set-up: nothing of the new parts after the reply.
            const types = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []).map(receipt => receipt.type);
            assert.equal(types.some(type => ['rules.settle', 'class.choose', 'path.choose'].includes(type)), false);
            assert.deepEqual(Object.keys(host.head().domains.progress.attempts), []);
            assert.deepEqual(Object.keys(host.head().domains.progress.choices), []);
            assert.equal(host.head().domains.rules.pin, null);
            assert.deepEqual(host.store.problems(), []);
        } finally {
            host.close();
        }
    });
});

// A scripted legacy session that needs no dice: it must read the same with and without the new parts beside it.
async function mergedHost({ modules = [] } = {}) {
    let sdk = null;
    const merged = mergeInto(createModule({ settings: () => sdk?.settings(MODULE_ID) ?? {} }), rulesModule({}));
    const host = await createHost({ modules: [...modules, merged, { id: 'rb-test-caller', name: 'Caller', version: '0.0.0', commands: { 'rbtest.call': (ctx, { type, payload } = {}) => ctx.call(type, payload ?? {}) } }] });
    sdk = host.sdk;
    const saved = globalThis.StoryBlock;
    globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve(sdk), sdk };
    const close = host.close;
    host.close = () => { close(); if (saved === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = saved; };
    host.q = (name, args) => sdk.query(name, args);
    host.cmd = (type, payload = {}, opts) => sdk.command(type, payload, opts);
    host.internal = (type, payload = {}) => sdk.command('rbtest.call', { type, payload });
    host.reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
    return host;
}

async function session(modules, { merge = false } = {}) {
    return seeded(5, async () => {
        const host = merge ? await mergedHost() : await rpgHost({ modules });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await host.send('We walk into the village.', host.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement', '+ item Rope | qty: 1']));
            assert.equal((await host.internal('party.grantXp', { amount: 950, claim: 'test-xp' })).ok, true);
            await host.send('I drink it.', host.reply('Her eyes sharpen.', ['+ effect Keen Sight — sharper eyes | on: perception | for: 3 replies', '+ xp minor — a good deed']));
            await host.send('Onward.', host.reply('The road.', ['~ wound Ren | hp: -3']));
            const { party, effects, gear, creation, combat, bestiary, trade, craft } = host.head().domains;
            const owned = { party, effects, gear, creation, combat, bestiary, trade, craft, scene: host.head().domains.scene, inventory: host.head().domains.inventory };
            return { owned: json(owned), chat: json(host.ctx.chat.map(message => ({ mes: message.mes, is_user: Boolean(message.is_user) }))), pc: host.q('party.pc'), problems: host.store.problems().map(problem => problem.code) };
        } finally {
            host.close();
        }
    });
}

test('the real module\'s state and story are the same with the rules-v2 parts loaded beside it as without', async t => {
    t.mock.method(console, 'warn', () => {});
    const alone = await session([]);
    // Merged into the real module (id rpg-battle), as module.js will register them: Story Block's item grant now finds rules.registerItem.
    const beside = await session([], { merge: true });
    assert.equal(alone.pc.level, 10, 'the script did something: 950 XP and a story award');
    // Every id and dice seed comes from a seeded source that the extra module's own set-up receipt also draws from, so the
    // ids differ; what the module keeps (names, levels, XP, points, pools, effects, items) must not.
    const strip = text => text.replace(/"(?:id|sid|rc|swipeKey|evidence)":"[^"]*"/g, '').replace(/(?:it|ef|rc|ac|sr|sw|ev)_[0-9a-z]{8,12}/g, 'ID').replace(/"seed":\d+/g, '').replace(/"rev":\d+/g, '').replace(/"at":\d+/g, '');
    const [a, b] = [strip(alone.owned), strip(beside.owned)];
    let i = 0;
    while (i < a.length && a[i] === b[i]) i += 1;
    assert.equal(b, a, `the real module's slices differ at ${i}: …${a.slice(Math.max(0, i - 60), i + 80)} / …${b.slice(Math.max(0, i - 60), i + 80)}`);
    assert.equal(beside.chat, alone.chat);
    assert.equal(beside.pc.level, alone.pc.level);
    assert.equal(beside.pc.xp, alone.pc.xp);
    assert.deepEqual(beside.pc.hp, alone.pc.hp);
    assert.deepEqual(beside.problems, alone.problems);
});

test('a chat the real module recorded replays the same with the parts loaded; their guard hook is never asked about its legacy blocks', async t => {
    t.mock.method(console, 'warn', () => {});
    const recorded = await seeded(7, async () => {
        const host = await rpgHost();
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await host.send('Village.', host.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement']));
            assert.equal((await host.internal('party.grantXp', { amount: 250, claim: 'xp-1' })).ok, true);
            await host.send('Rest.', host.reply('A long night.', ['~ wound Ren | hp: -4']));
            return { chat: JSON.parse(JSON.stringify(host.ctx.chat)), party: json(host.head().domains.party), spans: host.ctx.chat.flatMap(message => message.extra?.storySuite?.spans ?? []) };
        } finally {
            host.close();
        }
    });
    assert.ok(recorded.spans.length > 0 && recorded.spans.every(span => !span.id), 'all of it legacy blocks: no block id, no guard');
    const asked = [];
    const slice = rulesModule({ id: SLICE });
    const hook = slice.hooks.replayGuard;
    slice.hooks = { ...slice.hooks, replayGuard: (...args) => { asked.push(args); return hook(...args); } };
    await seeded(7, async () => {
        const host = await rpgHost({ modules: [CLOCK, slice] });
        try {
            await host.st.loadChat(recorded.chat);
            assert.equal(json(host.head().domains.party), recorded.party);
            assert.deepEqual(host.store.problems(), []);
            host.store.rebuild();
            assert.equal(json(host.head().domains.party), recorded.party);
            assert.equal(asked.length, 0, 'no legacy block was asked a rules-v2 guard');
        } finally {
            host.close();
        }
    });
});

test('with a rules pack pinned the real party\'s level is what rules.progress shows and what the guard reads', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(3, async () => {
        // One module, as the real one is: Story Block answers a replay guard only its owner's own queries.
        const host = await mergedHost({ modules: [CLOCK] });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            const pc = host.q('party.pc').id;
            await host.send('Dawn.', host.reply('The road.'));
            assert.equal(host.bus.command('test.pin', {}, { cause: 'ui' }).ok, true);
            assert.equal(host.bus.command('test.start', { actor: pc, class: ref('c0') }, { cause: 'ui' }).ok, true);
            assert.equal(host.q('rules.progress', {}).level, 1, 'your character by default, at the real party\'s level');
            await host.send('Years.', host.reply('Years pass.'));
            const xpReply = host.ctx.chat.length - 1;
            assert.equal((await host.internal('party.grantXp', { amount: 900, claim: 'years' })).ok, true);
            assert.equal(host.q('rules.progress', { actor: pc }).level, host.q('party.pc').level);
            assert.equal(host.q('rules.progress', { actor: pc }).level, 10);
            // Master the three skills (the pack's day and reply caps apply), then promote.
            const forms = ['s00-base', 's01-base', 's02-base'].map(ref);
            for (let n = 0; n < 18; n += 1) {
                const day = 1 + Math.floor(n / 5);
                const body = [`~ time ${day * DAY + 600}`];
                for (const form of forms) for (let i = 0; i < 2 && !(n === 17 && i === 1); i += 1) body.push(`! attempt ${pc} | skill: ${form.replace('pack.fixture/', '').replace('-base', '')} | form: ${form.replace('pack.fixture/', '')} | key: ${nextKey()}`);
                await host.send('Go on.', host.reply(`Practice ${n}.`, body));
            }
            const view = host.q('rules.progress', { actor: pc });
            assert.deepEqual(view.checklist.map(item => item.mastery), [5, 5, 5]);
            assert.equal(view.promotions[0].eligible, true);
            const rulesHash = host.head().domains.rules.rulesHash;
            const out = host.bus.command('class.choose', { actor: pc, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash }, { cause: 'ui' });
            assert.equal(out.ok, true, out.message);
            assert.equal(host.q('rules.progress', { actor: pc }).class, ref('c1'));
            // Take back the XP: the real party drops to level 1 and the stored promotion goes off, with nothing in its place.
            await host.st.deleteMessage(xpReply);
            await host.st.deleteMessage(xpReply - 1);
            assert.equal(host.q('party.pc').level, 1);
            assert.equal(host.q('rules.progress', { actor: pc }).class, ref('c0'));
            assert.deepEqual(host.store.problems().map(problem => problem.code), ['REPLAY_PREREQUISITE']);
        } finally {
            host.close();
        }
    });
});
