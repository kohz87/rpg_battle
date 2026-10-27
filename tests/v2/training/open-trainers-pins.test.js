// Pinned packs and open trainers (RB open trainers §9): the pin is the only source. A chat pinned to a pack with templates offers trainers from
// the pinned copy whatever happens to the installed pack; one pinned to a pack without templates, or to none, is untouched. (The chat recorded
// with RPG Battle 2.1.0 opens unchanged in pinned-2.1.0.test.js.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { drillsTemplate, openTrainerPack, trainerPack } from '../progress/helpers/fixture.js';
import { DAY } from '../progress/helpers/world.js';
import { ok, openWorld } from './helpers/pinned.js';

const HAVEN = 'pack.fixture/haven';
const START = 4 * DAY + 1410;
const CHARACTER = { name: 'Astra', race: 'rpg-battle/human', talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: 'pack.fixture/c0', checkActor: null };
const offersOf = h => h.head().domains.training.offers ?? {};

/** A production host pinned to `pack`, a character made, at Haven with Old Reka present. */
async function started(t, pack = openTrainerPack()) {
    const h = await openWorld({ packs: [pack] });
    t.after(() => h.close());
    ok(await h.pin());
    ok(await h.sdk.command('creation.finish', CHARACTER));
    await h.say('Haven at dusk.', [`~ time ${START}`, `~ here ${HAVEN}`, '+ present Old Reka', '+ coin 50']);
    return h;
}
const lesson = async (h, offer, line) => {
    const pc = h.q('party.pc').id;
    const row = h.q('rules.training', { actor: pc }).offers.find(item => item.trainer === offer.id && item.skill === 'pack.fixture/s00');
    ok(await h.sdk.command('skill.train', row.payload));
    await h.say(line, [`~ here ${HAVEN}`]);
    return row.session;
};
const stable = async h => {
    const live = JSON.stringify(h.head());
    h.store.rebuild();
    assert.equal(JSON.stringify(h.head()), live, 'a rebuild equals live');
    await h.st.loadChat(structuredClone(h.ctx.chat));
    assert.equal(JSON.stringify(h.head()), live, 'a reload equals live');
    assert.deepEqual(h.store.problems(), []);
};

test('pinned to a pack with templates: disabling or removing the pack after an offer changes nothing; the lesson and the next offer use the pin', async t => {
    const h = await started(t);
    await h.say('Reka offers drills.', ['+ trainer Old Reka — drills | like: drills']);
    const [offer] = Object.values(offersOf(h));
    assert.ok(offer.fee >= 10 && offer.fee <= 40);
    const session = await lesson(h, offer, 'The first lesson.');
    assert.equal(h.head().domains.training.sessions[session].status, 'completed');
    await stable(h);
    const before = JSON.stringify(h.head().domains);
    await h.packs.packs.setEnabled('fixture', false);
    assert.equal(JSON.stringify(h.head().domains), before);
    assert.equal(h.q('training.openTemplates', {}).length, 1, 'the pin still has its template');
    await h.packs.packs.remove('fixture');
    assert.equal(JSON.stringify(h.head().domains), before);
    assert.equal(h.registry.module('rpg-battle').capture.kinds.trainer.enabled, true, 'the line is still taught');
    await stable(h);
    // Zed is offered from the pinned copy of the pack, which is no longer installed.
    await h.say('Zed too.', ['+ present Zed', '+ trainer Zed | like: drills | teaches: s01']);
    assert.deepEqual(Object.values(offersOf(h)).map(item => item.name).sort(), ['Old Reka', 'Zed']);
    assert.deepEqual(h.turn.problems().filter(item => /trainer/.test(item.line ?? '')), []);
    await stable(h);
});

test('pinned to a pack with templates: installing a changed version of the pack never changes the fee range or the template list of the pin', async t => {
    const h = await started(t);
    const changed = openTrainerPack([drillsTemplate({ fee: { coinMin: 900, coinMax: 1000 } }), drillsTemplate({ slug: 'extra', name: 'Extra' })]);
    changed.version = '2.1.0';
    ok(await h.packs.packs.install(changed));
    assert.deepEqual(h.q('training.openTemplates', {}).map(entry => [entry.id, entry.fee]), [['pack.fixture/drills', { coinMin: 10, coinMax: 40 }]]);
    await h.say('Reka offers drills.', ['+ trainer Old Reka | like: drills', '+ present Zed', '+ trainer Zed | like: extra']);
    assert.deepEqual(Object.values(offersOf(h)).map(item => [item.name, item.fee >= 10 && item.fee <= 40]), [['Old Reka', true]]);
    assert.match(h.turn.problems().at(-1).message, /Choose an open trainer template/);
});

test('pinned to a pack with trainers but no template: the line is unknown and the training slice has no offers key', async t => {
    const h = await started(t, trainerPack());
    await h.say('Reka offers drills.', ['+ trainer Old Reka — drills | like: drills']);
    assert.deepEqual(h.turn.problems().map(item => item.code), ['UNKNOWN_KIND']);
    assert.equal(Object.hasOwn(h.head().domains.training, 'offers'), false);
    await stable(h);
});

test('the real pin starts a pack with templates with an empty map of offers, and a pack without with none', async t => {
    const withTemplates = await started(t);
    assert.deepEqual(withTemplates.head().domains.training, { schema: 2, sessions: {}, offers: {} });
    const without = await started(t, trainerPack());
    assert.deepEqual(without.head().domains.training, { schema: 2, sessions: {} });
});

test('a chat that pins nothing: no trainer kind, command or query at all', async t => {
    const h = await openWorld({ packs: [openTrainerPack()] });
    t.after(() => h.close());
    assert.equal(h.registry.module('rpg-battle').capture.kinds.trainer.enabled, false);
    assert.equal(h.head().domains.training, undefined, 'the training domain waits for the pin');
    assert.throws(() => h.sdk.query('training.openTemplates', {}), /no module answers the query/);
    assert.equal((await h.sdk.command('trainer.open', { name: 'Old Reka', template: 'drills' })).ok, false);
});
