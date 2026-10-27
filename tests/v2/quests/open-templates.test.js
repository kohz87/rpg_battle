import test from 'node:test';
import assert from 'node:assert/strict';
import { foesPack, pinFor } from '../progress/helpers/fixture.js';
import { STRICT, realQuestHost, skip } from './helpers/real-host.js';
import { seeded } from '../integration/helpers/host.js';

const ok = out => assert.equal(out.ok, true, JSON.stringify(out));
export function openPin(over = {}, foeStats = null) {
    const pack = foesPack();
    if (foeStats) pack.content.creatures[0].stats = foeStats;
    pack.content.ranks = [{ id: 'F', title: 'F', levels: [1, 10], reward: [10, 100] }];
    pack.content.quests = [
        { slug: 'task', name: 'Open task', open: true, rank: 'F', category: 'side', giver: null, turnInPlace: null, requirements: [],
            objectives: [{ id: 'ob_00000001', kind: 'story' }], reward: { coinMin: 10, coinMax: 100, xpMin: 10, xpMax: 100, items: [] }, durationMinutes: null, repeat: null, chain: null, ...over },
        { slug: 'hunt', name: 'Open hunt', open: true, rank: 'F', category: 'bounty', giver: null, turnInPlace: null, requirements: [],
            objectives: [{ id: 'ob_00000001', kind: 'kill', count: 1, allowVariants: true }], reward: { coinMin: 10, coinMax: 100, xpMin: 10, xpMax: 100, items: [] }, durationMinutes: null, repeat: null, chain: null },
        { slug: 'closed', name: 'Closed task', category: 'side', giver: null, turnInPlace: null, requirements: [],
            objectives: [{ id: 'ob_00000001', kind: 'story', text: 'Listen' }], reward: { coin: 10, xp: 10, items: [] }, durationMinutes: null, repeat: null, chain: null },
    ];
    return { ...pinFor(`open${JSON.stringify([over, foeStats])}`, pack), defs: { 'pack.fixture/rope': { id: 'pack.fixture/rope', name: 'Rope', kind: 'goods', rarity: 'common', value: 2, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' } } };
}
export async function areaHost(t, given = openPin(), settings = null) {
    const h = await realQuestHost(t, { given, settings });
    ok(await h.packs.packs.install(JSON.stringify({ id: 'fixture', version: '2.0.0', name: 'Places', requires: { storyBlock: '^2' }, content: { places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }] } })));
    await h.send('At Haven.', '<Changes>\n~ place Haven\n</Changes>');
    ok(await h.sdk.command('atlas.dangerSet', { write: 'wr_area0001', scope: 'world', key: null, policy: { tier: 1, allowedFoes: ['pack.fixture/wolf'], allowedTags: ['beast', 'forest'], lore: [] }, expectedHash: h.sdk.query('atlas.policy').hash }));
    return h;
}
const opening = '+ quest Listen | like: task | text: Hear the miller';
for (const via of ['line', 'click-offer', 'click-accepted']) test(`open story via ${via}: fixed reward, reload/rebuild/Re-read, met/retraction and one settlement`, { skip }, async t => {
    const h = await areaHost(t);
    if (via === 'line') await h.send('A goal.', `<Changes>\n${opening}\n</Changes>`);
    else {
        ok(await h.sdk.command('threads.offer', { write: 'wr_goal0001', thread: 'th_goal0001', kind: 'hook', key: 'Listen', summary: 'Hear the miller', fields: {}, expectedHash: null }));
        if (via === 'click-accepted') ok(await h.sdk.command('threads.accept', { write: 'wr_take0001', thread: 'th_goal0001', expectedHash: h.sdk.query('threads.hash', { thread: 'th_goal0001' }) }));
        ok(await h.sdk.command('quest.open', { id: 'th_goal0001', template: 'task', text: 'Hear the miller' }));
    }
    const id = h.sdk.query('director.thread', { key: 'Listen' }).id;
    const offerAt = h.ctx.chat.length - 1;
    const reward = { coin: 20, xp: 20, items: [] };
    assert.deepEqual(h.sdk.query('director.thread', { id }).rpg.reward, reward);
    if (h.sdk.query('director.thread', { id }).offer) ok(await h.sdk.command('quest.take', { id }));
    await h.send('Listen.', '<Changes>\n~ quest Listen | met: yes\n</Changes>');
    await h.send('Undo.', '<Changes>\n~ quest Listen | met: no\n</Changes>');
    assert.equal((await h.sdk.command('quest.finish', { id })).ok, false);
    await h.send('Listen again.', '<Changes>\n~ quest Listen | met: yes\n- quest Listen — done\n</Changes>');
    const check = () => {
        assert.deepEqual(h.sdk.query('director.thread', { id }).rpg.reward, reward);
        assert.equal(h.sdk.query('director.thread', { id }).rpg.state, 'done', JSON.stringify({ problems: h.store.problems(), quest: h.sdk.query('director.thread', { id }).rpg, progress: h.sdk.query('quest.progress', { id }) }));
        assert.equal(h.sdk.query('inventory.wallet').coin, 20);
        assert.equal(h.sdk.query('party.pc').xp, 20);
        assert.deepEqual(h.store.problems(), []);
    };
    check(); await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
    ok(await h.turn.reread(offerAt)); check();
    assert.equal((await h.sdk.command('quest.finish', { id })).code, 'CLAIMED');
    await h.st.deleteMessage(offerAt);
    assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0);
    assert.equal(h.sdk.query('party.pc').xp, 0);
});

for (const [label, over, line, code] of [
    ['unknown template', {}, opening.replace('like: task', 'like: missing'), 'RULES_MISMATCH'],
    ['absent binding', {}, opening.replace(' | text: Hear the miller', ''), 'INVALID'],
    ['requirements', { requirements: [{ kind: 'level', min: 99 }] }, opening, 'REFUSED'],
    ['wrong kind', {}, `${opening} | foe: pack.fixture/wolf`, 'INVALID'],
    ['unknown foe', {}, opening.replace('like: task', 'like: hunt') + ' | foe: invented', 'NOT_FOUND'],
    ['forbidden foe', {}, opening.replace('like: task', 'like: hunt') + ' | foe: pack.fixture/warlord', 'LEVEL'],
    ['invented number', {}, `${opening} | reward: 99999`, 'INVALID'],
    ['missing kill target', {}, opening.replace('like: task', 'like: hunt'), 'INVALID'],
    ['unknown place', { objectives: [{ id: 'ob_00000001', kind: 'visit' }] }, `${opening} | place: Nowhere`, 'NOT_FOUND'],
    ['unknown item', { objectives: [{ id: 'ob_00000001', kind: 'collect', count: 1, consume: true }] }, `${opening} | item: Unknown`, 'NOT_FOUND'],
]) test(`line opening refusal is visible and leaves a plain goal (strict mode, RPG Battle 2.2.0's refusals): ${label}`, { skip }, async t => {
    const h = await areaHost(t, openPin(over), STRICT);
    await h.send('A goal.', `<Changes>\n${line}\n</Changes>`);
    const thread = h.sdk.query('director.thread', { key: 'Listen' });
    assert.ok(thread); assert.equal(thread.rpg, undefined);
    assert.match(JSON.stringify(h.ctx.chat.at(-1).extra.storySuite), new RegExp(code));
    assert.match(JSON.stringify(h.ctx.chat.at(-1).extra.storySuite), /Quest refused/);
});

test('click refuses a closed template, missing target and absent area without altering the goal', { skip }, async t => {
    const h = await areaHost(t);
    ok(await h.sdk.command('threads.offer', { write: 'wr_goal0001', thread: 'th_goal0001', kind: 'hook', key: 'Listen', summary: '', fields: {}, expectedHash: null }));
    for (const binding of [{ template: 'missing', text: 'Listen' }, { template: 'closed', text: 'Listen' }, { template: 'hunt', text: 'Hunt' }]) {
        const before = structuredClone(h.head());
        const out = await h.sdk.command('quest.open', { id: 'th_goal0001', ...binding });
        assert.equal(out.ok, false); assert.ok(out.message); assert.deepEqual(h.head(), before);
    }
    ok(await h.sdk.command('atlas.dangerSet', { write: 'wr_area0002', scope: 'world', key: null, policy: null, expectedHash: h.sdk.query('atlas.policy').hash }));
    assert.equal((await h.sdk.command('quest.open', { id: 'th_goal0001', template: 'task', text: 'Listen' })).code, 'AREA');
});

for (const target of ['pack.fixture/wolf~ash-wolf', 'pack.fixture/wolf']) test(`a hunt on ${target} seals canonical refs and pays once through replay`, { skip }, async t => seeded(13, async () => {
    const h = await areaHost(t);
    await h.send('A hunt.', `<Changes>\n+ quest Hunt | like: hunt | text: Hunt the ash wolf | foe: ${target}\n</Changes>`);
    const id = h.sdk.query('director.thread', { key: 'Hunt' }).id;
    ok(await h.sdk.command('quest.take', { id }));
    // This tests kill evidence and settlement; use the reliable Auto tier for the fixture fight.
    await h.send('The wolf.', '<Changes>\n! encounter Ash Wolf | like: wolf | tier: trivial\n</Changes>');
    const offer = h.sdk.query('combat.offers').at(-1);
    assert.equal(offer.foes[0].ref, 'pack.fixture/wolf~ash-wolf');
    ok(await h.sdk.command('combat.start', { offer: offer.id }));
    for (let n = 0; n < 100; n++) {
        const v = h.sdk.query('combat.session'); if (v.status !== 'active') break;
        ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: v.id, board: v.board }));
    }
    ok(await h.sdk.command('combat.end', { session: h.sdk.query('combat.session').id }));
    await h.send('Return.', '<Changes>\n- quest Hunt — done\n</Changes>');
    const check = () => {
        assert.equal(h.sdk.query('director.thread', { id }).rpg.state, 'done', JSON.stringify({ problems: h.store.problems(), quest: h.sdk.query('director.thread', { id }).rpg, progress: h.sdk.query('quest.progress', { id }) }));
        assert.equal(h.sdk.query('inventory.wallet').coin, 20);
        const result = Object.values(h.head().domains.progress.batches).find(b => b.bytes.kind === 'fight');
        assert.equal(result.bytes.enemies[0].foe, 'pack.fixture/wolf~ash-wolf');
        assert.deepEqual(h.store.problems(), []);
    };
    check(); await h.st.loadChat(structuredClone(h.ctx.chat)); check(); h.store.rebuild(); check();
    assert.equal((await h.sdk.command('quest.finish', { id })).code, 'CLAIMED');
}));

for (const kind of ['visit', 'collect']) test(`open ${kind} target is a real explicit binding and closes by owner evidence`, { skip }, async t => {
    const objective = kind === 'visit' ? { id: 'ob_00000001', kind } : { id: 'ob_00000001', kind, count: 2, consume: true };
    const h = await areaHost(t, openPin({ objectives: [objective] }));
    await h.send('A goal.', `<Changes>\n${opening} | ${kind === 'visit' ? 'place: pack.fixture/haven' : 'item: pack.fixture/rope'}\n</Changes>`);
    const id = h.sdk.query('director.thread', { key: 'Listen' }).id;
    ok(await h.sdk.command('quest.take', { id }));
    if (kind === 'collect') ok(h.bus.command('inventory.grant', { def: 'pack.fixture/rope', qty: 2, owner: 'party' }, { cause: 'system' }));
    await h.send('Finish.', '<Changes>\n- quest Listen — done\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { id }).rpg.state, 'done');
    assert.equal(h.sdk.query('inventory.wallet').coin, 20);
    await h.st.loadChat(structuredClone(h.ctx.chat)); h.store.rebuild();
    assert.equal(h.sdk.query('inventory.wallet').coin, 20); assert.deepEqual(h.store.problems(), []);
});

test('variant names bind only to an explicit surviving base declaration; an over-budget variant is refused visibly (strict mode)', { skip }, async t => {
    const h = await areaHost(t, undefined, STRICT);
    await h.send('A wolf.', '<Changes>\n! encounter Ash Wolf | like: wolf\n</Changes>');
    await h.send('A hunt.', '<Changes>\n+ quest Ash hunt | like: hunt | text: Hunt | foe: Ash Wolf\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { key: 'Ash hunt' }).rpg.objectives[0].foe, 'pack.fixture/wolf~ash-wolf');
    await h.st.loadChat(structuredClone(h.ctx.chat)); h.store.rebuild(); assert.deepEqual(h.store.problems(), []);
    const bad = await areaHost(t, openPin({}, { STR: 7, VIT: 7, AGI: 7, DEX: 7, INT: 7, LUK: 7, CHA: 7 }), STRICT);
    await bad.send('A wolf.', '<Changes>\n! encounter Impossible Wolf | like: wolf\n</Changes>');
    assert.equal(bad.sdk.query('combat.offers').length, 0);
    assert.match(JSON.stringify(bad.turn.problems()), /budget|BUDGET/);
});

test('open narrated coin is attributed once and a Continue cannot pay the reward again', { skip }, async t => {
    const h = await areaHost(t);
    await h.send('A goal.', `<Changes>\n${opening}\n</Changes>`);
    const id = h.sdk.query('director.thread', { key: 'Listen' }).id; ok(await h.sdk.command('quest.take', { id }));
    await h.send('Listen.', '<Changes>\n~ quest Listen | met: yes\n</Changes>');
    await h.send('Reward.', '<Changes>\n+ coin 20\n- quest Listen — done\n</Changes>');
    await h.cont('<Changes>\n+ coin 20\n</Changes>');
    assert.equal(h.sdk.query('inventory.wallet').coin, 20);
    await h.st.loadChat(structuredClone(h.ctx.chat)); h.store.rebuild();
    assert.equal(h.sdk.query('inventory.wallet').coin, 20); assert.equal(h.sdk.query('party.pc').xp, 20);
    assert.deepEqual(h.store.problems(), []);
});

test('a variant name colliding with a pack foe refuses rather than choosing an identity (strict mode)', { skip }, async t => {
    const h = await areaHost(t, undefined, STRICT);
    await h.send('A wolf.', '<Changes>\n! encounter Wolf | like: wolf\n</Changes>');
    await h.send('A hunt.', '<Changes>\n+ quest Ambiguous | like: hunt | text: Hunt | foe: Wolf\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { key: 'Ambiguous' }).rpg, undefined);
    assert.match(JSON.stringify(h.ctx.chat.at(-1).extra.storySuite), /AMBIGUOUS/);
});
