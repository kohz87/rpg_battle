// The open trainer tests on the real Story Director (a sibling checkout; they skip in CI, where it is absent): the place is SD's canonical id,
// the clock is SD's, `director.advance` moves it, and Story Block's core module says who is present. Twins of open-trainers.test.js and
// open-trainers-replay.test.js, with nothing of Story Director stood in for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../integration/helpers/host.js';
import { openTrainersPin, ref } from '../progress/helpers/fixture.js';
import { STRICT, realQuestHost, skip } from '../quests/helpers/real-host.js';
import { feeFor } from '../../../src/v2/training/opening.js';
import { offers, spans, sessions } from './helpers/open.js';

const ok = out => { assert.equal(out.ok, true, `${out.code}: ${out.message}`); return out; };
const PLACES = JSON.stringify({ id: 'fixture', version: '2.0.0', name: 'Places', requires: { storyBlock: '^2' }, content: { places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }, { slug: 'mill', name: 'Mill', x: 1, y: 0 }] } });
const NOON = 'June 3, 1200, 12:00 pm';

async function townHost(t) {
    const h = await realQuestHost(t, { given: openTrainersPin(), settings: STRICT });
    ok(await h.packs.packs.install(PLACES));
    await h.send('At Haven.', `<Changes>\n~ place Haven\n~ time ${NOON}\n+ present Old Reka\n+ coin 50\n</Changes>`);
    // The helpers of this folder read a world with a `slice`, a `q` and a `say`.
    const w = {
        host: h, q: (name, args = {}) => h.sdk.query(name, args), slice: name => h.head().domains[name], pc: h.sdk.query('party.pc').id,
        say: (text, lines = []) => h.send('Go on.', lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text),
        ui: (type, payload) => h.bus.command(type, payload, { cause: 'ui' }),
    };
    return w;
}
const row = (w, trainer, skill = 's00') => w.q('rules.training', { actor: w.pc }).offers.find(item => item.trainer === trainer && item.skill === ref(skill));
const coin = w => w.q('inventory.wallet', { owner: 'party' }).coin ?? 0;
const minutes = w => w.q('director.time', {}).minutes;

test('on the real Story Director: a line offers a trainer at SD\'s canonical place; a lesson pays, moves SD\'s clock an hour and credits; elsewhere it is "not here"', { skip }, async t => {
    await seeded(51, async () => {
        const w = await townHost(t);
        const clock0 = minutes(w);
        assert.ok(Number.isSafeInteger(clock0));
        await w.say('Old Reka offers drills.', ['+ trainer Old Reka — drills | like: drills']);
        const [offer] = Object.values(offers(w));
        assert.deepEqual([offer.by, offer.place, offer.where, offer.name], ['story', 'pack.fixture/haven', 'Haven', 'Old Reka']);
        assert.equal(offer.fee, feeFor({ coinMin: 10, coinMax: 40 }, spans(w)[0].recorded.die));
        assert.equal(row(w, offer.id).blocked.length, 0);
        ok(w.ui('skill.train', row(w, offer.id).payload));
        await w.say('The lesson.', ['~ place Haven']);
        const [session] = Object.values(sessions(w));
        assert.deepEqual([session.status, session.fee, session.trainer], ['completed', offer.fee, offer.id]);
        assert.equal(coin(w), 50 - offer.fee);
        assert.equal(minutes(w), clock0 + 60, 'SD\'s clock moved by the hour');
        await w.say('To the mill.', ['~ place Mill']);
        assert.ok(row(w, offer.id).blocked.includes('Old Reka is not here.'), 'elsewhere: not here');
        assert.deepEqual(w.host.store.problems(), []);
        // Reload and rebuild keep it all.
        const live = JSON.stringify(w.host.head());
        w.host.store.rebuild();
        assert.equal(JSON.stringify(w.host.head()), live);
        await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
        assert.equal(JSON.stringify(w.host.head()), live);
        assert.deepEqual(w.host.store.problems(), []);
    });
});

test('on the real Story Director: Make this a trainer for someone present, the offer is the reader\'s; a Re-read keeps it, deleting its reply takes it', { skip }, async t => {
    await seeded(52, async () => {
        const w = await townHost(t);
        await w.say('Old Reka is here.');
        assert.equal(w.ui('trainer.open', { name: 'Nobody', template: 'drills' }).code, 'NOT_FOUND');
        ok(w.ui('trainer.open', { name: 'Old Reka', template: 'drills', skills: [ref('s01')] }));
        const offer = structuredClone(Object.values(offers(w))[0]);
        assert.deepEqual([offer.by, offer.skills, offer.place], ['reader', [ref('s01')], 'pack.fixture/haven']);
        const index = w.host.ctx.chat.findIndex(message => String(message.mes ?? '').includes('Old Reka is here.'));
        ok(await w.host.turn.reread(index));
        assert.deepEqual(Object.values(offers(w)), [offer]);
        await w.host.st.deleteMessage(index);
        await w.host.st.deleteMessage(index - 1);
        assert.deepEqual(offers(w), {});
    });
});

test('on the real Story Director: deleting the reply that offered a trainer takes the trainer and the lesson taken with it', { skip }, async t => {
    await seeded(53, async () => {
        const w = await townHost(t);
        await w.say('Old Reka offers drills.', ['+ trainer Old Reka — drills | like: drills']);
        const [offer] = Object.values(offers(w));
        await w.say('She asks.');
        ok(w.ui('skill.train', row(w, offer.id).payload));
        await w.say('The lesson.', ['~ place Haven']);
        assert.equal(Object.values(sessions(w))[0].status, 'completed');
        const index = w.host.ctx.chat.findIndex(message => String(message.mes ?? '').includes('Old Reka offers drills.'));
        await w.host.st.deleteMessage(index);
        await w.host.st.deleteMessage(index - 1);
        assert.deepEqual(offers(w), {});
        assert.deepEqual(sessions(w), {});
        assert.equal(coin(w), 50);
        assert.equal(w.host.store.problems().filter(item => item.code === 'REPLAY_PREREQUISITE').length, 1, JSON.stringify(w.host.store.problems()));
    });
});
