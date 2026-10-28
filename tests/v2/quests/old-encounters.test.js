// Chats recorded before the mode was fixed at the pin (fixtures/old-encounters-*.json, recorded by record-old-encounters.mjs on RPG Battle 2.2.0, on ce3dbec, on 1617742 and on e869c13) have no mode
// in their rules: they read as 2.2.0 did (strict), whatever the reader's switch says now and whether the pack has open quest templates. A named kind with a count in front
// ("3 Rats Of Doom | like: …") is one foe called "3 Rats Of Doom" there. A chat opens as it was recorded (its stored steps are replayed, nothing is read again); a Re-read of one of its
// replies reads its lines in the chat's mode, which is strict; so does a reply written after the chat is opened, whatever the switch says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seeded } from '../integration/helpers/host.js';
import { bluewatch } from './helpers/bluewatch.js';

const FEATURE = 'rpg-battle.generative-offers';
const load = name => JSON.parse(readFileSync(new URL(`./fixtures/old-encounters-${name}.json`, import.meta.url), 'utf8'));
const at = (h, text) => h.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
const names = h => Object.values(h.head().domains.combat.offers ?? {}).map(offer => offer.foes.map(foe => [foe.name, foe.count]));
const beaten = h => Object.values(h.head().domains.combat.beaten ?? {}).map(entry => entry.foes.map(foe => [foe.name, foe.count]));
const foesOf = h => Object.values(h.head().domains.combat.offers ?? {}).map(offer => ({ foes: offer.foes, stakes: offer.stakes, place: offer.place }));
const gist = (director, training, rules) => JSON.stringify({
    threads: Object.values(director.threads ?? {}).map(thread => [thread.id, thread.key, thread.kind, thread.rpg?.template ?? null]).sort(),
    teachers: Object.values(training.offers ?? {}).map(offer => [offer.id, offer.name, offer.template, offer.fee, offer.settled?.feeBy ?? null]).sort(),
    offers: Object.keys(rules).filter(key => key.startsWith('offer.')).sort(),
});
const lastText = h => JSON.stringify([h.head().domains.combat.last].flat().filter(Boolean).map(entry => entry.summary));
const offerKeys = h => Object.keys(h.head().domains.rules).filter(key => key.startsWith('offer.'));
const TEXTS = ['Rats, left on offer.', 'Plague rats, fought.', 'Rats in the cellar.', 'The river guild is owed.', 'Reka offers drills.'];

async function opened(t, fixture, switchNow) {
    const settings = structuredClone(fixture.extensionSettings);
    settings.storySuite.features = { ...(settings.storySuite.features ?? {}), [FEATURE]: switchNow };
    return bluewatch(t, { st: { chat: structuredClone(fixture.chat), extensionSettings: settings } });
}

// [the RPG Battle it was recorded on, what it read, the fixture, whether it read freely when it was recorded]
const CASES = [
    ['ce3dbec', 'free', 'ce3dbec-free', true],
    ['ce3dbec', 'strict', 'ce3dbec-strict', false],
    ['ce3dbec', 'bare (the pack has no open quest template)', 'ce3dbec-bare', false],
    ['1617742', 'free (a route kept for each line)', '1617742-free', true],
    ['e869c13', 'free (a mode stamp on each reply)', 'e869c13-free', true],
    ['2.2.0', 'free setting (but 2.2.0 reads no further than one foe)', '2.2.0-free', false],
];

for (const [code, what, file, freely] of CASES) {
    for (const switchNow of [true, false]) {
        test(`${code} chat, ${what}: opens as recorded, and a Re-read of any of its replies reads it as 2.2.0 did, with the switch ${switchNow ? 'on' : 'off'}`, async t => {
            await seeded(9801, async () => {
                const fixture = load(file);
                const h = await opened(t, fixture, switchNow);
                assert.deepEqual(h.store.problems(), fixture.problems);
                assert.equal(h.head().domains.rules.mode, undefined, 'a chat pinned before 2.3.0 records no mode');
                const held = { foes: foesOf(h), offers: names(h), beaten: beaten(h), last: lastText(h), combat: JSON.stringify(h.head().domains.combat) };
                assert.deepEqual(held.offers, fixture.offers, 'the chat opens as recorded');
                const gistNow = () => gist(h.head().domains.director, h.head().domains.training, h.head().domains.rules);
                assert.equal(gistNow(), gist(fixture.director, fixture.training, Object.fromEntries(fixture.offerKeys.map(key => [key, 1]))), 'the chat opens as recorded');
                for (const text of TEXTS) assert.equal((await h.turn.reread(at(h, text))).ok, true, text);
                assert.equal(h.head().domains.rules.mode, undefined, 'a Re-read records no mode');
                // Every line is read as strict mode does: no count in front of a name, no offer record, no teacher settled by the story's words.
                assert.ok(names(h).every(row => row.every(([name, count]) => count === 1 && !/^Rats Of Doom$/.test(name))), JSON.stringify(names(h)));
                assert.deepEqual(offerKeys(h), []);
                assert.ok(Object.values(h.head().domains.training.offers ?? {}).every(offer => offer.settled === undefined));
                if (!freely) {
                    // A chat that was strict all along is read again exactly as it was.
                    assert.deepEqual(names(h), held.offers);
                    assert.deepEqual(beaten(h), held.beaten);
                    assert.equal(lastText(h), held.last);
                    if (code === 'ce3dbec') assert.equal(JSON.stringify(h.head().domains.combat), held.combat, 'the whole combat record');
                    else assert.deepEqual(foesOf(h), held.foes, 'the foes, tiers and stakes (a foe of 2.2.0 was balanced by that day\'s numbers)');
                }
                // The same on a second Re-read: nothing moves.
                const settled = JSON.stringify([gistNow(), names(h), beaten(h)]);
                for (const text of TEXTS) assert.equal((await h.turn.reread(at(h, text))).ok, true, text);
                assert.equal(JSON.stringify([gistNow(), names(h), beaten(h)]), settled);
            });
        });
    }
}

test('a reply written after an old chat is opened is read strict too, whatever the switch says; the chat stays so through a Re-read, a rebuild and a reload', async t => {
    for (const switchNow of [true, false]) {
        await seeded(9802, async () => {
            const h = await opened(t, load('ce3dbec-free'), switchNow);
            await h.say('Rats again.', ['! encounter 3 Rats Of Doom | like: cellar-rat-swarm']);
            assert.equal(h.head().domains.rules.mode, undefined, 'no mode is recorded afterwards');
            assert.deepEqual(names(h).at(-1), [['3 Rats Of Doom', 1]], `switch ${switchNow ? 'on' : 'off'}: one foe called "3 Rats Of Doom"`);
            assert.equal((await h.turn.reread(at(h, 'Rats again.'))).ok, true);
            assert.deepEqual(names(h).at(-1), [['3 Rats Of Doom', 1]]);
            const live = JSON.stringify(h.head());
            h.store.rebuild();
            assert.equal(JSON.stringify(h.head()), live, 'rebuild equals live');
            await h.st.loadChat(JSON.parse(JSON.stringify(h.ctx.chat)));
            assert.equal(JSON.stringify(h.head()), live, 'reload equals live');
        });
    }
});
