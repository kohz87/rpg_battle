// Wave C: a fight with a boss is never labelled below strong (the user's call: a boss is never made
// smaller, so "a weak boss fight" would not be weak), and a foe of a written rank (`rank: D`, #92)
// fights at the level its rank gives, not at the level of the tier worked out for its card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BESTIARY } from '../../../src/enemies.js';
import { readEncounter } from '../../../src/v2/combat/encounter.js';
import { offerRows } from '../../../src/v2/combat/setup.js';
import { unpackSetup } from '../../../src/v2/combat/stored.js';
import { withHero } from '../qa/helpers/harness.js';

const read = (name, tier) => readEncounter({ op: '!', name, labels: { tier } }, { bestiary: DEFAULT_BESTIARY }).foes;

test('a boss fight written trivial, weak or even is a strong one; strong and deadly stay', () => {
    for (const tier of ['trivial', 'weak', 'even']) {
        assert.deepEqual(read('Rat King (boss), 3 Giant Rat', tier).map(foe => foe.tier), ['strong', 'strong'], tier);
    }
    assert.deepEqual(read('Ogre (boss), 2 Wolf', 'deadly').map(foe => foe.tier), ['deadly', 'deadly']);
    assert.deepEqual(read('Ogre (boss)', 'strong').map(foe => foe.tier), ['strong']);
    // A minion's own word stays its own; the boss's is raised.
    assert.deepEqual(read('3 trivial Giant Rat, weak Ogre (boss)', 'even').map(foe => [foe.name, foe.tier]), [['Giant Rat', 'trivial'], ['Ogre', 'strong']]);
    // No boss, no change.
    assert.deepEqual(read('3 Wolf', 'trivial').map(foe => foe.tier), ['trivial']);
});

test('the offer and its receipt show the boss fight as strong', () => {
    const { h } = withHero({ seed: 4 });
    const offered = h.capture({ op: '!', kind: 'encounter', name: 'Rat King (boss)', text: '', labels: { tier: 'weak' } });
    assert.equal(offered.ok, true, offered.message);
    assert.deepEqual(h.query('combat.offers').at(-1).foes.map(foe => foe.tier), ['strong']);
    assert.match(JSON.stringify(offered.receipt), /strong/);
    assert.doesNotMatch(JSON.stringify(offered.receipt.summary ?? ''), /\bweak\b/);
});

test('a foe of a written rank fights at its rank\'s level, its power scaled like a tier foe\'s', () => {
    const rows = offerRows({ foes: [{ name: 'Wolf', count: 2, tier: 'strong', rank: 'D', level: 6 }] }, { pcLevel: 3, bestiary: DEFAULT_BESTIARY });
    assert.equal(rows[0].level, 6, 'the rank\'s level, not the tier\'s');
    assert.equal(rows[0].threat, 'strong', 'the tier stays for the card');
    const tiered = offerRows({ foes: [{ name: 'Wolf', count: 2, tier: 'strong' }] }, { pcLevel: 3, bestiary: DEFAULT_BESTIARY });
    assert.notEqual(tiered[0].level, 6);

    const { h } = withHero({ seed: 6 });
    const offered = h.capture({ op: '!', kind: 'encounter', name: '2 Wolf', text: '', labels: { rank: 'E' } });
    assert.equal(offered.ok, true, offered.message);
    const offer = h.query('combat.offers').at(-1);
    assert.ok(Number.isInteger(offer.foes[0].level), JSON.stringify(offer.foes));
    assert.equal(h.command('combat.start', { offer: offer.id }).ok, true);
    const setup = unpackSetup(h.state().domains.combat.session.setup);
    for (const enemy of setup.enemies) assert.equal(enemy.level, offer.foes[0].level);
});
