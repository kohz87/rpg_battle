// A count in front of a named kind ("120 Plague Rats | like: …") is the whole number written, whatever its digits: the name is what follows it, and the length of the
// name is checked on that. A count past what a fight holds is cut and told as for any other line; one that is not a count a line can hold is refused in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readEncounter, MAX_ENCOUNTER_FOES } from '../../../src/v2/combat/encounter.js';
import { matchOffer } from '../../../src/v2/quests/offer-match.js';
import { settledTerms } from '../../../src/v2/quests/offer-bands.js';
import { seeded } from '../integration/helpers/host.js';
import { COPPER, derivedPin, env, lineOf } from './helpers/offer-env.js';
import { bluewatch } from './helpers/bluewatch.js';

const read = (text, options = {}) => readEncounter(lineOf(text), { bestiary: [], literal: true, leadingCount: true, ...options });
const total = result => result.foes.reduce((sum, foe) => sum + foe.count, 0) + (result.cut ?? []).reduce((sum, foe) => sum + foe.count, 0);

test('a count of three digits is the count: 120 Plague Rat is a hundred and twenty of them (cut to what a fight holds), not one foe named "120 Plague Rat"', () => {
    for (const [count, kept] of [[9, 9], [10, 10], [12, 12], [99, 54], [100, 54], [120, 54], [999, 54]]) {
        const result = read(`! encounter ${count} Plague Rat | like: cellar-rat-swarm`);
        assert.equal(result.ok, true, `${count}: ${result.message}`);
        assert.ok(result.foes.every(foe => foe.name === 'Plague Rat'), `${count}: ${JSON.stringify(result.foes)}`);
        assert.equal(result.foes.reduce((sum, foe) => sum + foe.count, 0), kept, count);
        assert.equal(total(result), count, `${count}: what is cut is counted`);
    }
    assert.equal(MAX_ENCOUNTER_FOES, 54);
    assert.ok(read('! encounter 120 Plague Rat | like: cellar-rat-swarm').cut.length > 0, 'the cut is told');
});

test('the length of the name is checked on the name, not on the count in front of it', () => {
    const name = 'N'.repeat(45);
    for (const count of [6, 60, 120, 999]) assert.equal(read(`! encounter ${count} ${name} | like: cellar-rat-swarm`).ok, true, `${count} ${name.length}`);
    assert.match(read(`! encounter 120 ${'N'.repeat(49)} | like: cellar-rat-swarm`).message, /up to 48 characters/);
});

test('a count that is no count a line can hold is refused in plain words', () => {
    for (const written of ['0', '1000', '99999999999999999999']) {
        const result = read(`! encounter ${written} Plague Rat | like: cellar-rat-swarm`);
        assert.equal(result.ok, false, written);
        assert.match(result.message, /count/i, written);
    }
    // Without the count switch the name is the name, as in 2.2.0.
    assert.deepEqual(read('! encounter 120 Plague Rat | like: cellar-rat-swarm', { leadingCount: false }).foes.map(foe => foe.name), ['120 Plague Rat']);
});

test('a job whose count is three digits tells a fight line the reader accepts, count and name apart', () => {
    const wide = derivedPin(resolved => {
        for (const quest of Object.values(resolved.quests)) if (quest.open === true && quest.objectives[0].kind === 'kill') Object.assign(quest.objectives[0], { countMin: 1, countMax: 200 });
    });
    const result = matchOffer(env({ pin: wide }), lineOf('+ quest Plague | type: cull | goal: Kill 120 plague rats in the cellar | reward: 100 copper'));
    assert.equal(result.kind, 'offer');
    assert.equal(result.settled.count, 120);
    const told = /! encounter (.*?)\. These/.exec(settledTerms(result, 'Plague', COPPER))?.[1];
    assert.match(told, /^120 /);
    const accepted = read(`! encounter ${told}`);
    assert.equal(accepted.ok, true, accepted.message);
    assert.equal(accepted.foes[0].name, result.settled.foe.name);
    assert.equal(total(accepted), 120);
});

test('on the real host the line makes an offer of that many foes, held to a fight and told', async t => {
    await seeded(9601, async () => {
        const h = await bluewatch(t);
        await h.say('Rats.', ['! encounter 120 Plague Rat | like: cellar-rat-swarm']);
        const offer = h.q('combat.offers').at(-1);
        assert.ok(offer.foes.every(foe => foe.name === 'Plague Rat'), JSON.stringify(offer.foes));
        assert.equal(offer.foes.reduce((sum, foe) => sum + foe.count, 0), 54);
        await h.say('Rats again.', ['! encounter 1000 Plague Rat | like: cellar-rat-swarm']);
        assert.equal(h.q('combat.offers').length, 1, 'a count of a thousand makes no offer');
    });
});
