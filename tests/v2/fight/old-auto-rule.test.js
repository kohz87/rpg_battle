// A fight is played with the Auto rule it was recorded with (`autoRule`, rules v2): an offer and a fight recorded on 2.2.0, before Auto played each unmastered form once, keep
// playing as they did when the reply that made them is read again (a Re-read, unchanged or rebuilt), never with today's default; an offer made now records the rule it was made with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seeded } from '../integration/helpers/host.js';
import { bluewatch } from '../quests/helpers/bluewatch.js';

const FEATURE = 'rpg-battle.generative-offers';
const fixture = JSON.parse(readFileSync(new URL('../quests/fixtures/old-fights-2.2.0.json', import.meta.url), 'utf8'));
const at = (h, text) => h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
const offers = h => Object.values(h.head().domains.combat.offers ?? {});
const fights = h => Object.values(h.head().domains.combat.fights ?? {});
const rules = h => ({ offers: offers(h).map(offer => [offer.autoRule ?? null, offer.opposition?.autoRule ?? null]), fights: fights(h).map(fight => [fight.setup.autoRule ?? null, fight.status, fight.actions.length]) });
async function opened(t, switchNow) {
    const settings = structuredClone(fixture.extensionSettings);
    settings.storySuite.features = { ...(settings.storySuite.features ?? {}), [FEATURE]: switchNow };
    return bluewatch(t, { st: { chat: structuredClone(fixture.chat), extensionSettings: settings } });
}

test('the fixture is what it says: recorded on 2.2.0, an offer and a fight that carry no Auto rule', () => {
    assert.equal(fixture.recordedWith.rpgBattle, '2.2.0');
    const offered = Object.values(fixture.combat.offers);
    const played = Object.values(fixture.combat.fights);
    assert.deepEqual([offered.length, played.length], [1, 1]);
    assert.ok(offered.every(offer => offer.autoRule === undefined && offer.opposition?.autoRule === undefined));
    assert.ok(played.every(fight => fight.setup.autoRule === undefined));
});

for (const switchNow of [true, false]) {
    test(`a chat recorded on 2.2.0 keeps its offer's and its fight's Auto rule (none) when their replies are read again, with the switch ${switchNow ? 'on' : 'off'}`, async t => {
        await seeded(9951, async () => {
            const h = await opened(t, switchNow);
            assert.deepEqual(h.store.problems(), fixture.problems);
            const recorded = rules(h);
            assert.deepEqual(recorded.offers, [[null, null]]);
            assert.deepEqual(recorded.fights.map(([rule]) => rule), [null]);
            for (const text of ['Rats, left on offer.', 'Rats, fought.']) {
                assert.equal((await h.turn.reread(at(h, text))).ok, true, text);
                assert.deepEqual(rules(h), recorded, `${text}: the rule of the offer and of the fight`);
                assert.deepEqual(h.store.problems(), fixture.problems, `${text}: no Problems`);
            }
            const live = JSON.stringify(h.head().domains.combat);
            h.store.rebuild();
            assert.equal(JSON.stringify(h.head().domains.combat), live, 'rebuilt: the same');
            assert.deepEqual(rules(h), recorded);
        });
    });
}

test('an offer made now records its Auto rule, and starting it plays by that rule; a Re-read of the unchanged line keeps it', async t => {
    await seeded(9952, async () => {
        const h = await bluewatch(t);
        await h.say('Rats.', ['! encounter 3 Cellar Rat Swarm | tier: weak']);
        const [offer] = offers(h);
        assert.equal(offer.autoRule, 'practice');
        assert.equal((await h.turn.reread(at(h, 'Rats.'))).ok, true);
        assert.equal(offers(h)[0].autoRule, 'practice');
        const started = await h.sdk.command('combat.start', { offer: offers(h)[0].id });
        assert.equal(started.ok, true, started.message);
        assert.equal(fights(h)[0].setup.autoRule, 'practice');
    });
});
