// A template that carries what Story Block 2.5.0 lets a pack write (a count with bounds, a written type) opens the 2.2.0 way too: by a `| like:` line in strict mode and by
// the reader's "Make this a quest". Story Director's quest has no place for those fields, so they stay with the template.
import test from 'node:test';
import assert from 'node:assert/strict';
import { foesPack, pinFor } from '../progress/helpers/fixture.js';
import { STRICT, realQuestHost, skip } from './helpers/real-host.js';

const ok = out => assert.equal(out.ok, true, JSON.stringify(out));
/** The host of open-templates.test.js: the pack installed, Haven known, a tier 1 world. */
async function areaHost(t, given, settings = null) {
    const h = await realQuestHost(t, { given, settings });
    ok(await h.packs.packs.install(JSON.stringify({ id: 'fixture', version: '2.0.0', name: 'Places', requires: { storyBlock: '^2' }, content: { places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }] } })));
    await h.send('At Haven.', '<Changes>\n~ place Haven\n</Changes>');
    ok(await h.sdk.command('atlas.dangerSet', { write: 'wr_area0001', scope: 'world', key: null, policy: { tier: 1, allowedFoes: ['pack.fixture/wolf'], allowedTags: ['beast', 'forest'], lore: [] }, expectedHash: h.sdk.query('atlas.policy').hash }));
    return h;
}

function boundedPin() {
    const pack = foesPack();
    pack.content.ranks = [{ id: 'F', title: 'F', levels: [1, 10], reward: [10, 100] }];
    const reward = { coinMin: 10, coinMax: 100, xpMin: 10, xpMax: 100, items: [] };
    pack.content.quests = [
        { slug: 'task', name: 'Open task', open: true, offerType: 'task', rank: 'F', category: 'side', giver: null, turnInPlace: null, requirements: [], objectives: [{ id: 'ob_00000001', kind: 'story' }], reward, durationMinutes: null, repeat: null, chain: null },
        { slug: 'hunt', name: 'Open hunt', open: true, offerType: 'hunt', rank: 'F', category: 'bounty', giver: null, turnInPlace: null, requirements: [], objectives: [{ id: 'ob_00000001', kind: 'kill', count: 2, countMin: 1, countMax: 6, allowVariants: true }], reward, durationMinutes: null, repeat: null, chain: null },
        { slug: 'fetch', name: 'Open fetch', open: true, offerType: 'gather', rank: 'F', category: 'side', giver: null, turnInPlace: null, requirements: [], objectives: [{ id: 'ob_00000001', kind: 'collect', count: 2, countMin: 1, countMax: 4, consume: true }], reward, durationMinutes: null, repeat: null, chain: null },
    ];
    return { ...pinFor('bounded-open', pack), defs: { 'pack.fixture/rope': { id: 'pack.fixture/rope', name: 'Rope', kind: 'goods', rarity: 'common', value: 2, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' } } };
}

test('strict mode: a "| like:" line for a template with bounds and a written type opens it, and the quest carries neither', { skip }, async t => {
    const h = await areaHost(t, boundedPin(), STRICT);
    await h.send('A hunt.', '<Changes>\n+ quest Wolf Hunt | like: hunt | text: Hunt the wolves | foe: pack.fixture/wolf\n</Changes>');
    const thread = h.sdk.query('director.thread', { key: 'Wolf Hunt' });
    assert.equal(thread?.rpg?.template, 'pack.fixture/hunt', JSON.stringify(h.ctx.chat.at(-1).extra?.storySuite).slice(0, 400));
    assert.deepEqual(thread.rpg.objectives.map(objective => ['countMin', 'countMax'].filter(key => key in objective)), [[]]);
    assert.equal(thread.rpg.objectives[0].count, 2, 'the template\'s own count');
    assert.deepEqual(h.store.problems(), []);
    await h.send('A delivery.', '<Changes>\n+ quest Rope Run | like: fetch | text: Fetch rope | item: pack.fixture/rope\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { key: 'Rope Run' })?.rpg?.template, 'pack.fixture/fetch');
});

test('"Make this a quest" opens a template with bounds and a written type from a neutral goal, offered and accepted', { skip }, async t => {
    const h = await areaHost(t, boundedPin());
    for (const [n, via] of [[1, 'offered'], [2, 'accepted']]) {
        const id = `th_goal000${n}`;
        ok(await h.sdk.command('threads.offer', { write: `wr_goal000${n}`, thread: id, kind: 'hook', key: `Goal ${n}`, summary: 'Hunt the wolves', fields: {}, expectedHash: null }));
        if (via === 'accepted') ok(await h.sdk.command('threads.accept', { write: `wr_take000${n}`, thread: id, expectedHash: h.sdk.query('threads.hash', { thread: id }) }));
        ok(await h.sdk.command('quest.open', { id, template: 'hunt', text: 'Hunt the wolves', foe: 'pack.fixture/wolf' }));
        const quest = h.sdk.query('director.thread', { id }).rpg;
        assert.equal(quest.template, 'pack.fixture/hunt');
        assert.deepEqual(quest.objectives.map(objective => ['countMin', 'countMax'].filter(key => key in objective)), [[]]);
    }
    assert.deepEqual(h.store.problems(), []);
});

test('the same open from the click and the line replays: reload and rebuild equal the live chat', { skip }, async t => {
    const h = await areaHost(t, boundedPin(), STRICT);
    await h.send('A hunt.', '<Changes>\n+ quest Wolf Hunt | like: hunt | text: Hunt the wolves | foe: pack.fixture/wolf\n</Changes>');
    assert.equal(h.sdk.query('director.thread', { key: 'Wolf Hunt' })?.rpg?.template, 'pack.fixture/hunt');
    const live = JSON.stringify(h.head());
    h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), live);
    await h.st.loadChat(JSON.parse(JSON.stringify(h.ctx.chat)));
    assert.equal(JSON.stringify(h.head()), live);
});
