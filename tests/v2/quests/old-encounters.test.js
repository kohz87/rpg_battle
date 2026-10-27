// Encounters recorded before routes were kept (fixtures/old-encounters-*.json, recorded by record-old-encounters.mjs on RPG Battle 2.2.0 and on ce3dbec) Re-read unchanged exactly as
// they were first read, whatever the reader's switch says now and whether the pack has open quest templates: a named kind with a count in front ("3 Rats Of Doom | like: …") is how
// many of them where it was read so, and one foe called "3 Rats Of Doom" where it was not. The way is derived from what the chat stored, never from today's setting.
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

async function opened(t, fixture, switchNow) {
    const settings = structuredClone(fixture.extensionSettings);
    settings.storySuite.features = { ...(settings.storySuite.features ?? {}), [FEATURE]: switchNow };
    return bluewatch(t, { st: { chat: structuredClone(fixture.chat), extensionSettings: settings } });
}

const CASES = [
    ['ce3dbec', 'free', 'read with the count', 'ce3dbec-free'],
    ['ce3dbec', 'strict', 'read as one foe, 2.2.0\'s way', 'ce3dbec-strict'],
    ['ce3dbec', 'bare', 'read as one foe (the pack has no open quest template)', 'ce3dbec-bare'],
    ['2.2.0', 'free', 'read as one foe, 2.2.0\'s way', '2.2.0-free'],
];

for (const [code, mode, what, file] of CASES) {
    for (const switchNow of [true, false]) {
        test(`${code} chat, ${mode}: its encounters (${what}) Re-read unchanged with the switch ${switchNow ? 'on' : 'off'} as they were first read`, async t => {
            await seeded(9801, async () => {
                const fixture = load(file);
                assert.equal(fixture.recordedWith.rpgBattle, code);
                assert.deepEqual(fixture.routes, [], 'recorded before routes were kept');
                const h = await opened(t, fixture, switchNow);
                assert.deepEqual(h.store.problems(), fixture.problems);
                const held = { foes: foesOf(h), offers: names(h), beaten: beaten(h), last: lastText(h), combat: JSON.stringify(h.head().domains.combat) };
                assert.deepEqual(held.offers, fixture.offers, 'the chat opens as recorded');
                const gistNow = () => gist(h.head().domains.director, h.head().domains.training, h.head().domains.rules);
                assert.equal(gistNow(), gist(fixture.director, fixture.training, Object.fromEntries(fixture.offerKeys.map(key => [key, 1]))), 'the chat opens as recorded');
                let recorded = gistNow();
                for (const text of ['Rats, left on offer.', 'Plague rats, fought.', 'Rats in the cellar.', 'The river guild is owed.', 'Reka offers drills.']) {
                    assert.equal((await h.turn.reread(at(h, text))).ok, true, text);
                    // A free-form offer that 2.2.0 and strict mode refused changed nothing: no route to keep, so a Re-read reads it afresh under the switch of the moment.
                    if (text === 'The river guild is owed.' && fixture.offerKeys.length === 0) {
                        assert.equal(Object.keys(h.head().domains.rules).some(key => key.startsWith('offer.')), switchNow && mode !== 'bare', `${text}: a line that did nothing is read afresh (where the pack has open templates)`);
                        recorded = gistNow();
                        continue;
                    }
                    assert.equal(gistNow(), recorded, `${text}: the quests, the teachers and the recorded offers`);
                    assert.deepEqual(names(h), held.offers, `${text}: the offers`);
                    assert.deepEqual(beaten(h), held.beaten, `${text}: the foes beaten`);
                    assert.equal(lastText(h), held.last, `${text}: the result`);
                    // The whole record, but for a chat of 2.2.0: its offer was balanced by the numbers of that day, and a Re-read balances it by today's (a foe's hit points differ by one).
                    if (code === 'ce3dbec') assert.equal(JSON.stringify(h.head().domains.combat), held.combat, `${text}: the whole combat record`);
                    else assert.deepEqual(foesOf(h), held.foes, `${text}: the foes, tiers and stakes`);
                }
                assert.deepEqual(h.store.problems(), fixture.problems);
            });
        });
    }
}

test('a Re-read of such a chat keeps the way for the next one: the route is kept now, and an edited line is read under the setting of the moment', async t => {
    await seeded(9802, async () => {
        const fixture = load('ce3dbec-strict');
        const h = await opened(t, fixture, true);
        const index = at(h, 'Rats, left on offer.');
        assert.equal((await h.turn.reread(index)).ok, true);
        assert.deepEqual(names(h), [[['3 Rats Of Doom', 1]]]);
        assert.ok(Object.keys(h.head().domains.rules).some(key => key.startsWith('route.')), 'the route is kept now');
        const message = h.ctx.chat[index];
        message.mes = message.mes.replace('Rats Of Doom', 'Rats Of Ruin');
        message.swipes[message.swipe_id] = message.mes;
        assert.equal((await h.turn.reread(index)).ok, true);
        assert.deepEqual(names(h), [[['Rats Of Ruin', 3]]], 'edited: read with the switch on');
    });
});
