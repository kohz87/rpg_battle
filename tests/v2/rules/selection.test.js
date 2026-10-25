// Production boot (no injected rules), installed packs, Setup's real command widget and the real host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomId } from '../../vendor/story-block/src/id.js';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { setupScreen, setupActive } from '../../../src/v2/screens/rules/screens.js';
import { openCreation } from '../../../src/v2/creation/open.js';
import { staticParts } from '../../vendor/story-block/src/v2/prompt.js';
import { smallRulesPack, inputsPack } from '../progress/helpers/fixture.js';
import { SD } from '../progress/helpers/world.js';
import { seeded } from '../integration/helpers/host.js';
import { all, click, draw, text } from '../screens/helpers/render.js';

// Avoid the entry point's automatic boot installing a module on a test's host twice.
const original = globalThis.StoryBlock;
globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve({ settings: () => ({}), preflight: () => ({}), registerModule: async () => {} }) };
const { boot, booted } = await import('../../../index.js');
await booted;
if (original === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = original;

const director = { ...SD, version: '2.0.0' };
const ok = result => { assert.equal(result.ok, true, `${result.code}: ${result.message}`); return result; };
const payload = offer => { const { name, ...choice } = offer; return choice; };
async function world(t, { packs = [smallRulesPack()], st, plain = false, sd = true } = {}) {
    const h = await createHost({ st, modules: sd ? [director] : [] });
    t.after(() => h.close());
    for (const pack of packs) ok(await h.packs.packs.install(pack));
    if (plain) await h.sdk.registerModule(createModule({ settings: () => h.sdk.settings('rpg-battle'), query: (name, args) => h.sdk.query(name, args) }));
    else ok(await boot({ global: { StoryBlock: { apiVersion: 2, ready: Promise.resolve(h.sdk) } }, doc: null }));
    h.q = (name, args = {}) => h.sdk.query(name, args);
    h.selection = () => h.q('rules.selection');
    h.pin = offer => h.sdk.command('rules.pin', payload(offer ?? h.selection().offers[0]));
    h.draw = () => draw(setupScreen, h.head(), { queries: Object.fromEntries(Object.keys(h.registry.module('rpg-battle').queries)
        .concat(['packs.rules', 'savepoint.list', 'savepoint.contract', 'director.time']).map(name => [name, args => h.q(name, args)])),
        result: (type, args) => h.sdk.command(type, args) });
    return h;
}
async function stable(h) {
    const before = JSON.stringify(h.head());
    await h.st.loadChat(structuredClone(h.ctx.chat));
    assert.equal(JSON.stringify(h.head()), before, 'reload retains exact domain bytes');
    h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), before, 'rebuild retains exact domain bytes');
    assert.deepEqual(h.store.problems(), []);
}
const create = h => h.sdk.command('creation.finish', { name: 'Astra', race: 'rpg-battle/human', talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: 'pack.fixture/c0', checkActor: null });

test('fresh bare boot: Setup offers the sole pack, the refusal-reporting widget pins it, C01 creates three 0/5 skills and reload/rebuild retain frozen rules', async t => {
    const h = await world(t);
    assert.equal(h.q('rules.identity'), null);
    assert.equal(h.head().domains.rules, undefined, 'no eager rules marker');
    assert.equal(h.selection().state, 'offered');
    assert.equal(setupActive(null, { query: h.q }).on, true);
    const opened = [];
    ok(openCreation({ query: h.q, dialog: { open: id => { opened.push(id); return { screenId: id }; } } }));
    assert.deepEqual(opened, ['rpg-battle/setup']);
    const card = h.registry.module('rpg-battle').cards.start.for(h.head());
    assert.equal(card.actions[0].open, 'rpg-battle/setup');
    assert.equal((await create(h)).code, 'REFUSED', 'direct creation cannot bypass the offered choice');
    const d = h.draw();
    const pin = all(d.el, 'button').find(button => text(button) === 'Pin Fixture rules');
    assert.ok(pin, text(d.el));
    assert.deepEqual(d.warnings, []);
    await click(pin);
    assert.equal(d.commands[0].type, 'rules.pin');
    const frozen = structuredClone(h.head().domains.rules);
    assert.equal(h.q('rules.identity').hash, frozen.rulesHash);
    assert.equal(frozen.pin.identity.packHash, h.selection().packHash);
    const receipts = h.sdk.receipts().map(({ receipt }) => receipt).filter(receipt => receipt.type === 'rules.pin');
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].data.v2.guard.predicate.kind, 'rules.pin');
    assert.ok(staticParts(h.registry)[0].text.includes('! skill-use'));
    d.rerender(h.head());
    assert.match(text(d.el), /Pinned: fixture 2.0.0/);
    assert.ok(all(d.el, 'button').some(button => text(button) === 'Create your character'));
    ok(openCreation({ query: h.q, dialog: { open: id => { opened.push(id); return { screenId: id }; } } }));
    assert.equal(opened.at(-1), 'rpg-battle/create', 'after pinning the normal wizard and its basic class picker are available');
    ok(await create(h));
    const sheet = h.q('rules.sheet');
    assert.equal(sheet.level, 1);
    assert.deepEqual(sheet.skills.map(skill => skill.mastery), [0, 0, 0]);
    await stable(h);
    const changed = smallRulesPack();
    changed.content.rules[0].classes[0].name = 'Reinstalled class';
    ok(await h.packs.packs.install(changed));
    assert.notEqual(h.q('packs.rules', { resolve: true })[0].pin.rulesHash, frozen.rulesHash);
    assert.equal((await h.pin(d.commands[0].payload)).code, 'REFUSED');
    assert.deepEqual(h.head().domains.rules, frozen);
    await h.packs.packs.remove('fixture');
    assert.equal(h.q('rules.classes')[0].name, 'Class 0');
    await stable(h);
    const loaded = await world(t, { packs: [], st: { chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) } });
    assert.deepEqual(loaded.q('rules.identity'), h.q('rules.identity'));
    assert.deepEqual(loaded.q('rules.sheet'), h.q('rules.sheet'));
    assert.deepEqual(loaded.head().domains.rules, frozen);
    await stable(loaded);
});

test('two packs: no automatic choice; the reader picks the second through Setup', async t => {
    const second = smallRulesPack();
    second.id = 'second'; second.name = 'Second'; second.content.rules[0].name = 'Second rules';
    const h = await world(t, { packs: [smallRulesPack(), second] });
    assert.equal(h.selection().offers.length, 2);
    assert.equal(h.q('rules.identity'), null);
    const d = h.draw();
    assert.equal(all(d.el, 'button').filter(button => text(button).startsWith('Pin ')).length, 2);
    await click(all(d.el, 'button').find(button => text(button) === 'Pin Second rules'));
    assert.equal(h.q('rules.identity').packId, 'second');
    assert.equal((await h.pin(d.commands[0].payload)).code, 'REFUSED');
    await stable(h);
    await h.st.loadChat([{ is_user: false, mes: 'A new beginning.', extra: {} }], 'new-character');
    assert.equal(h.q('rules.identity'), null);
    assert.equal(h.selection().offers.length, 2, 'a new character timeline may choose again');
    ok(await h.pin(h.selection().offers[0]));
    assert.equal(h.q('rules.identity').packId, 'fixture');
});

test('no pack: bare boot and a legacy module produce byte-identical chat, domains and prompt before and after character creation', async t => {
    async function session(plain) {
        return seeded(703, async () => {
            // Seed persistent record UUIDs as well as receipt IDs, so compare actual bytes.
            globalThis.crypto.randomUUID = () => randomId({ getRandomValues: globalThis.crypto.getRandomValues });
            const h = await world(t, { packs: [], plain });
            assert.equal(setupActive(null, { query: h.q }).on, false);
            assert.equal(h.head().domains.rules, undefined);
            ok(await h.sdk.command('party.create', { name: 'Legacy', preset: 'fighter' }));
            await h.send('Continue.', 'The road stretches ahead.\n<Changes>\n+ coin 90\n+ item Iron Sword | note: weapon, ATK +4\n</Changes>');
            const stack = h.q('inventory.items').find(item => item.name === 'Iron Sword').stack;
            ok(await h.sdk.command('item.equip', { stack }));
            await stable(h);
            return { chat: h.ctx.chat, head: h.head(), prompt: staticParts(h.registry) };
        });
    }
    assert.deepEqual(await session(false), await session(true));
});

test('a stale, disabled or forged pack choice refuses in the existing widget without partial rules state', async t => {
    const h = await world(t);
    const d = h.draw();
    await h.packs.packs.setEnabled('fixture', false);
    await click(all(d.el, 'button').find(button => text(button) === 'Pin Fixture rules'));
    assert.match(text(d.el), /changed or was disabled/);
    assert.equal(h.head().domains.rules, undefined);
    assert.equal(h.head().domains.progress, undefined);
    await h.packs.packs.setEnabled('fixture', true);
    const old = h.selection().offers[0];
    const changed = smallRulesPack(); changed.description = 'Changed outside the rules';
    ok(await h.packs.packs.install(changed));
    const current = h.selection().offers[0];
    assert.equal(old.rulesHash, current.rulesHash);
    assert.notEqual(old.packHash, current.packHash);
    assert.equal((await h.pin(old)).code, 'STALE', 'packHash guards same-rules envelope changes too');
    assert.equal((await h.sdk.command('rules.pin', { ...payload(current), resolved: {} })).code, 'INVALID');
    assert.equal(h.head().domains.rules, undefined);
    ok(await h.pin(current));
});

test('an existing legacy character cannot pin when a pack is installed later', async t => {
    const h = await world(t, { packs: [] });
    ok(await h.sdk.command('party.create', { name: 'Legacy', preset: 'fighter' }));
    const before = JSON.stringify(h.head());
    ok(await h.packs.packs.install(smallRulesPack()));
    assert.equal(h.selection().state, 'legacy');
    const pin = h.q('packs.rules', { resolve: true })[0].pin;
    assert.equal((await h.sdk.command('rules.pin', { pack: pin.packKey, version: pin.packVersion, rulesHash: pin.rulesHash, packHash: pin.packHash })).code, 'REFUSED');
    assert.equal(JSON.stringify(h.head()), before);
});

test('late Story Director activates Setup offers; a restore barrier prevents pinning', async t => {
    const h = await world(t, { sd: false });
    assert.equal(h.selection(), null, 'the required peer keeps all RB queries dormant');
    assert.equal(h.sdk.modules().find(module => module.id === 'rpg-battle').status, 'dormant');
    const pin = h.q('packs.rules', { resolve: true })[0].pin;
    const choice = { pack: pin.packKey, version: pin.packVersion, rulesHash: pin.rulesHash, packHash: pin.packHash };
    assert.equal((await h.sdk.command('rules.pin', choice)).code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(h.head().domains.rules, undefined);
    await h.sdk.registerModule(director);
    assert.equal(h.sdk.modules().find(module => module.id === 'rpg-battle').status, 'ready');
    const offer = h.selection().offers[0];
    assert.ok(offer);
    h.registry.setRestore('pending');
    assert.equal((await h.pin(offer)).ok, false);
    assert.equal(h.head().domains.rules, undefined);
    h.registry.setRestore('idle');
    ok(await h.pin(offer));
});

for (const operation of ['delete', 'swipe']) test(`reply-bound pin: ${operation} retracts the pin and dependent creation cleanly`, async t => {
    const h = await world(t);
    ok(await h.pin());
    // Put character creation on a later reply, so only its prerequisite is removed.
    ok(await h.sdk.command('creation.skipStart', {}));
    await h.send('Start.', 'A second reply.');
    ok(await create(h));
    assert.ok(h.q('rules.sheet'));
    if (operation === 'delete') await h.st.deleteMessage(0);
    else {
        const message = h.ctx.chat[0];
        message.swipes.push('Another beginning.');
        message.swipe_info.push({ send_date: '', extra: {} });
        await h.st.swipeTo(0, message.swipes.length - 1);
    }
    assert.equal(h.q('rules.identity'), null);
    assert.equal(h.q('party.pc'), null, 'the dependent creation guard retracts the character');
    assert.equal(h.head().domains.rules, undefined);
    assert.equal(h.head().domains.progress, undefined);
    assert.equal(h.head().domains.training, undefined);
    assert.ok(h.store.problems().every(problem => problem.code === 'REPLAY_PREREQUISITE'));
    const before = JSON.stringify(h.head());
    await h.st.loadChat(structuredClone(h.ctx.chat)); h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), before);
});


test('pinning freezes and atomically registers complete item definitions before creation', async t => {
    const h = await world(t, { packs: [inputsPack()] });
    ok(await h.pin());
    const defs = structuredClone(h.head().domains.rules.pin.defs);
    assert.deepEqual(Object.keys(defs).sort(), ['pack.fixture/rope', 'pack.fixture/sword']);
    assert.deepEqual(h.q('inventory.definitions'), Object.keys(defs).sort().map(id => defs[id]));
    await h.packs.packs.remove('fixture');
    ok(await create(h));
    assert.deepEqual(h.q('inventory.definitions'), Object.keys(defs).sort().map(id => defs[id]));
    await stable(h);
});


test('definition conflicts roll back the whole pin transaction', async t => {
    const h = await world(t, { packs: [inputsPack()] });
    ok(await h.sdk.command('creation.skipStart', {}));
    await h.send('A sword.', '<Changes>\n+ item Iron Sword\n</Changes>');
    assert.ok(h.q('inventory.definitions').find(def => def.id === 'pack.fixture/sword'));
    const replacement = inputsPack();
    replacement.content.items.find(item => item.slug === 'sword').name = 'Changed Sword';
    ok(await h.packs.packs.install(replacement));
    const before = JSON.stringify(h.head());
    assert.equal((await h.pin()).code, 'CONFLICT');
    assert.equal(JSON.stringify(h.head()), before);
    assert.equal(h.head().domains.rules, undefined);
    assert.equal(h.head().domains.progress, undefined);
    assert.equal(h.head().domains.training, undefined);
});
