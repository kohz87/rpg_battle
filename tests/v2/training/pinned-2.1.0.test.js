// A chat recorded with RPG Battle 2.1.0 on Story Block 2.3.0 (fixtures/pinned-2.1.0.json: pinned to the trainers pack, fixed
// trainers only, three training sessions) opens under the current code with the same state, no Problems, the same static
// prompt and the same Progress answers. The file was recorded before any open-trainer change (fixtures/record-pinned-2.1.0.mjs);
// a failure here means a chat that already exists would change, so fix the code, never the fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { staticParts } from '../../vendor/story-block/src/v2/prompt.js';
import { trainerPack } from '../progress/helpers/fixture.js';
import { openWorld } from './helpers/pinned.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pinned-2.1.0.json', import.meta.url), 'utf8'));
const json = value => JSON.parse(JSON.stringify(value));
// RPG Battle 2.2.0 adds two fields to each row of the Progress offers (`open`, `where`; RB open trainers §10.1) and nothing else: take
// them off and the 2.2.0 answer is the 2.1.0 one, byte for byte; and for a pack trainer they always say "not open, no place of its own".
const withoutAdditions = answer => ({ ...answer, offers: answer.offers.map(({ open, where, ...row }) => {
    assert.deepEqual([open, where], [false, null]);
    return row;
}) });

async function opened(t) {
    const h = await openWorld({ packs: [], st: { chat: structuredClone(fixture.chat), extensionSettings: structuredClone(fixture.extensionSettings) } });
    t.after(() => h.close());
    return h;
}
const sameAsRecorded = (h, when) => {
    assert.deepEqual(json(h.head()), fixture.head, `${when}: the state`);
    assert.deepEqual(h.store.problems(), [], `${when}: no Problems`);
    assert.deepEqual(withoutAdditions(json(h.q('rules.training', { actor: fixture.pc }))), fixture.training, `${when}: the Progress training answer`);
    assert.deepEqual(json(h.q('rules.sheet')), fixture.sheet, `${when}: the sheet`);
};

test('the fixture is what it says: pinned, fixed trainers only, three sessions, recorded on 2.1.0 / 2.3.0', () => {
    assert.equal(fixture.recordedWith.rpgBattle, '2.1.0');
    assert.match(fixture.recordedWith.storyBlock, /^Story Block 2\.3\.0 commit dd130d7/);
    assert.deepEqual(fixture.problems, []);
    const rules = fixture.head.domains.rules;
    assert.equal(rules.rulesVersion, 2);
    assert.ok(rules.pin.resolved.manifest.trainers.length > 0);
    assert.ok(rules.pin.resolved.manifest.trainers.every(trainer => trainer.open !== true), 'no template in the pin');
    assert.equal(Object.hasOwn(fixture.head.domains.training, 'offers'), false, 'the training slice has no offers key');
    assert.deepEqual(Object.values(fixture.head.domains.training.sessions).map(session => session.status).sort(), ['completed', 'completed', 'refused']);
});

test('a chat recorded on 2.1.0 replays under the current code with the same state, no Problems and the same answers', async t => {
    const h = await opened(t);
    sameAsRecorded(h, 'opened');
    h.store.rebuild();
    sameAsRecorded(h, 'rebuilt');
    await h.st.loadChat(structuredClone(h.ctx.chat));
    sameAsRecorded(h, 'reloaded');
});

test('the static prompt of that pinned chat (every module\'s part: the kinds, RPG Battle\'s rules) is byte-identical to the one recorded on 2.1.0', async t => {
    const h = await opened(t);
    // Story Block 2.3.0 and 2.4.0 write the same static text; a later host that does not is a reason to look at the host's change, not at the fixture.
    assert.deepEqual(json(staticParts(h.registry)), fixture.prompt);
    const text = staticParts(h.registry).map(part => part.text).join('\n');
    assert.ok(text.includes('! skill-use'), 'rules v2 is active in it');
    assert.equal(text.includes('+ trainer'), false, 'and it says nothing of trainer lines');
});

test('a new reply on that chat keeps working: the next lesson is the next session and nothing else moves', async t => {
    const h = await opened(t);
    const before = json(h.head().domains.training.sessions);
    await h.say('Another day.', []);
    assert.deepEqual(json(h.head().domains.training.sessions), before);
    assert.deepEqual(h.store.problems(), []);
});

test('the same pack installed under Story Block 2.4.0 has another rules hash; the old pin keeps its own and nothing is compared to the installed one', async t => {
    const h = await openWorld({ packs: [trainerPack()], st: { chat: structuredClone(fixture.chat), extensionSettings: structuredClone(fixture.extensionSettings) } });
    t.after(() => h.close());
    const installed = h.q('packs.rules', { resolve: true })[0].pin;
    const pinned = fixture.head.domains.rules;
    assert.notEqual(installed.rulesHash, pinned.rulesHash, 'every rules hash moved with the 2.4.0 schema');
    assert.equal(h.q('rules.identity').hash, pinned.rulesHash, 'the chat still runs the rules it pinned');
    sameAsRecorded(h, 'opened with the pack installed');
    h.store.rebuild();
    sameAsRecorded(h, 'rebuilt');
});
