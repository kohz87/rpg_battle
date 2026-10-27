// Chats recorded before 2.3.0 (fixtures/old-encounters-*.json, recorded by record-old-encounters.mjs on RPG Battle 2.2.0, on ce3dbec and on 1617742) have no stamp on any reply: they
// read as 2.2.0 did (strict), whatever the reader's switch says now and whether the pack has open quest templates. A named kind with a count in front
// ("3 Rats Of Doom | like: …") is one foe called "3 Rats Of Doom" there. A chat opens as it was recorded (its stored steps are replayed, nothing is read again); a Re-read of one of its
// replies reads its lines in the mode at that reply, which is strict. A reply written after the chat is opened takes the switch as it stands, and from there on it is a chat of 2.3.0.
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
const stamps = h => Object.keys(h.head().domains.rules).filter(key => key.startsWith('mode.')).length;
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
    ['2.2.0', 'free setting (but 2.2.0 reads no further than one foe)', '2.2.0-free', false],
];

for (const [code, what, file, freely] of CASES) {
    for (const switchNow of [true, false]) {
        test(`${code} chat, ${what}: opens as recorded, and a Re-read of any of its replies reads it as 2.2.0 did, with the switch ${switchNow ? 'on' : 'off'}`, async t => {
            await seeded(9801, async () => {
                const fixture = load(file);
                const h = await opened(t, fixture, switchNow);
                assert.deepEqual(h.store.problems(), fixture.problems);
                assert.equal(stamps(h), 0, 'a chat recorded before 2.3.0 has no stamp on any reply');
                const held = { foes: foesOf(h), offers: names(h), beaten: beaten(h), last: lastText(h), combat: JSON.stringify(h.head().domains.combat) };
                assert.deepEqual(held.offers, fixture.offers, 'the chat opens as recorded');
                const gistNow = () => gist(h.head().domains.director, h.head().domains.training, h.head().domains.rules);
                assert.equal(gistNow(), gist(fixture.director, fixture.training, Object.fromEntries(fixture.offerKeys.map(key => [key, 1]))), 'the chat opens as recorded');
                for (const text of TEXTS) assert.equal((await h.turn.reread(at(h, text))).ok, true, text);
                assert.equal(stamps(h), 0, 'a Re-read of a reply with no stamp records none');
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

test('a reply written after an old chat is opened takes the switch of its moment; the old replies keep reading as strict', async t => {
    for (const switchNow of [true, false]) {
        await seeded(9802, async () => {
            const h = await opened(t, load('ce3dbec-free'), switchNow);
            const counted = () => names(h).map(row => row.map(([name, count]) => `${count} ${name}`).join(', '));
            await h.say('Rats again.', ['! encounter 3 Rats Of Doom | like: cellar-rat-swarm']);
            // On: the new reply is stamped free. Off: nothing to keep, a reply with no stamp reads strict.
            assert.equal(stamps(h), switchNow ? 1 : 0, 'the new reply takes the switch of its moment');
            assert.deepEqual(counted().at(-1), switchNow ? '3 Rats Of Doom' : '1 3 Rats Of Doom');
            const kept = JSON.stringify(names(h));
            // Old replies stay strict; the new one reads as it did.
            assert.equal((await h.turn.reread(at(h, 'Rats, left on offer.'))).ok, true);
            assert.deepEqual(counted().at(-1), switchNow ? '3 Rats Of Doom' : '1 3 Rats Of Doom');
            assert.equal(names(h)[0].length, 1);
            assert.equal(names(h).flat().filter(([name]) => name === 'Rats Of Doom').length, switchNow ? 1 : 0, kept);
            assert.deepEqual(h.store.problems().filter(problem => /mode/i.test(JSON.stringify(problem))), []);
        });
    }
});
