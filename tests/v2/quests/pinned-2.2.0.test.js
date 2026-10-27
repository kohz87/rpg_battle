// A chat recorded with RPG Battle 2.2.0 on Story Block 2.5.0 and Story Director 2.1.0 (fixtures/pinned-2.2.0.json: pinned to Ersveil:
// Bluewatch Starter 1.6.0; an open quest offered by `like:`, a free-form offer 2.2.0 refuses, an open trainer, a fight and a turn-in)
// opens under the current code with the same state, no Problems, the same static prompt and the same answers. The file was recorded
// before any generative-offers change (fixtures/record-pinned-2.2.0.mjs); a failure here means a chat that already exists would
// change, so fix the code, never the fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { staticParts } from '../../vendor/story-block/src/v2/prompt.js';
import { questTail } from '../../../src/v2/quests/prompt.js';
import { bluewatch } from './helpers/bluewatch.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pinned-2.2.0.json', import.meta.url), 'utf8'));
const json = value => JSON.parse(JSON.stringify(value));

async function opened(t) {
    const h = await bluewatch(t, { st: { chat: structuredClone(fixture.chat), extensionSettings: structuredClone(fixture.extensionSettings) } });
    return h;
}
const sameAsRecorded = (h, when) => {
    assert.deepEqual(json(h.head()), fixture.head, `${when}: the state`);
    assert.deepEqual(h.store.problems(), fixture.problems, `${when}: the Problems`);
    const thread = h.q('director.thread', { key: 'Rats' });
    assert.deepEqual({ state: thread.rpg.state, settlement: thread.rpg.settlement }, fixture.quest, `${when}: the quest`);
    assert.deepEqual(json(h.q('quest.openTemplates', {})), fixture.openTemplates, `${when}: the open templates`);
    assert.deepEqual(json(h.q('rules.training', { actor: fixture.pc })), fixture.training, `${when}: the Progress training answer`);
    assert.deepEqual(json(h.q('inventory.wallet', { owner: 'party' })), fixture.wallet, `${when}: the purse`);
    assert.equal(h.q('party.pc').xp, fixture.xp, `${when}: the XP`);
};

test('the fixture is what it says: pinned to Bluewatch 1.6.0, open templates, one RPG quest done, one open trainer, recorded on 2.2.0', () => {
    assert.equal(fixture.recordedWith.rpgBattle, '2.2.0');
    assert.match(fixture.recordedWith.storyBlock, /^Story Block 2\.5\.0 commit 528f239/);
    const rules = fixture.head.domains.rules;
    assert.equal(rules.pin.identity.packVersion, '1.6.0');
    assert.ok(Object.values(rules.pin.resolved.quests).some(quest => quest.open === true));
    assert.equal(Object.hasOwn(rules, 'offers'), false, 'the rules slice has no generative offers');
    assert.equal(Object.values(fixture.head.domains.training.offers).length, 1);
    assert.equal(fixture.quest.state, 'done');
    assert.deepEqual(fixture.wallet, { coin: 50 });
    const kinds = fixture.chat.flatMap(message => message.extra?.storySuite?.spans ?? []).map(span => span.guard?.predicate?.kind).filter(Boolean);
    assert.ok(kinds.includes('quest.open') && kinds.includes('trainer.open'), kinds.join());
    assert.equal(kinds.some(kind => kind === 'quest.offer' || kind === 'trainer.offer'), false);
    const refused = fixture.chat.filter(message => /\+ quest Granary Vermin/.test(message.mes) && message.extra?.storySuite?.ops?.length === 0);
    assert.equal(refused.length, 1, 'the free-form offer was refused: its reply holds no op');
});

test('a chat recorded on 2.2.0 replays under the current code with the same state, no Problems and the same answers', async t => {
    const h = await opened(t);
    sameAsRecorded(h, 'opened');
    h.store.rebuild();
    sameAsRecorded(h, 'rebuilt');
    await h.st.loadChat(structuredClone(h.ctx.chat));
    sameAsRecorded(h, 'reloaded');
});

test('its quest.open block is replayed by the 2.2.0 guard and its free-form refusal leaves no thread', async t => {
    const h = await opened(t);
    const spans = h.ctx.chat.flatMap(message => message.extra?.storySuite?.spans ?? []);
    const opening = spans.find(span => span.guard?.predicate?.kind === 'quest.open');
    assert.ok(opening);
    assert.equal(h.q('director.thread', { key: 'Granary Vermin' }), null);
    assert.equal(h.q('director.thread', { key: 'Rats' }).rpg.template, 'pack.ersveil-bluewatch/open-hunt-f');
});

test('the static prompt of that pinned chat (every module\'s part) and its open-quest tail line are byte-identical to the ones recorded on 2.2.0', async t => {
    const h = await opened(t);
    assert.deepEqual(json(staticParts(h.registry)), fixture.prompt);
    const recorded = fixture.tails.at(-1).split('\n').find(line => line.startsWith('Open quest:'));
    assert.ok(recorded, 'the recorded tail names the open quest line');
    assert.deepEqual(questTail({ state: h.head() }).lines, [recorded]);
});

test('a new reply on that chat keeps working: nothing already settled moves', async t => {
    const h = await opened(t);
    const before = json({ quest: h.q('director.thread', { key: 'Rats' }).rpg, offers: h.head().domains.training.offers, wallet: h.q('inventory.wallet', { owner: 'party' }) });
    await h.say('Another day.', []);
    assert.deepEqual(json({ quest: h.q('director.thread', { key: 'Rats' }).rpg, offers: h.head().domains.training.offers, wallet: h.q('inventory.wallet', { owner: 'party' }) }), before);
    assert.deepEqual(h.store.problems(), []);
});
