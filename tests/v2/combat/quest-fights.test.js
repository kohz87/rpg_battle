// Quest-sized fights (user decision, wave C): a fight against the foes an active quest is about brings
// enough of them for real progress (a third of the goal or more, what is missing at most), in waves
// past the field, and the quest's item drops from every one; a count the story wrote is kept. Story
// Director's queries are stood in for by a small test module (director.threads, quest.progress).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withHero, fightOut } from '../qa/helpers/harness.js';
import { nounNames, questSized } from '../../../src/v2/combat/quest.js';
import { reliableLoot } from '../../../src/v2/combat/setup.js';
import { sessionOf, unpackSetup } from '../../../src/v2/combat/stored.js';
import { DEFAULT_BESTIARY } from '../../../src/enemies.js';

function withQuest(quest, { seed = 2 } = {}) {
    const { h, pc } = withHero({ seed, queryOverrides: quest ? {
        'quest.progress': () => ({ have: quest.have ?? 0, need: quest.need, met: false, countable: true, source: quest.source, noun: quest.noun }),
    } : {} });
    if (quest) {
        h.registry.register({
            id: 'quest-test', name: 'Quest test', version: '1.0.0',
            queries: {
                'director.threads': () => [{ id: 'th_00000001', kind: 'quest', status: 'active', key: 'Rats', taken: { rev: 1 } }],
            },
        });
    }
    return { h, pc };
}
const offerOf = (h, line, tier = 'trivial') => {
    const offered = h.capture({ op: '!', kind: 'encounter', name: line, text: '', labels: { tier } });
    assert.equal(offered.ok, true, offered.message);
    return { offer: h.query('combat.offers').at(-1), offered };
};
const total = foes => foes.reduce((sum, foe) => sum + foe.count, 0);

test('nounNames: a quest\'s noun names the thing when every word of it is there (plurals singular)', () => {
    assert.equal(nounNames('rat tails', 'Cellar Rat Tail'), true);
    assert.equal(nounNames('cellar rats', 'Cellar Rat'), true);
    assert.equal(nounNames('wolf pelts', 'Cellar Rat Tail'), false);
    assert.equal(nounNames('', 'Wolf'), false);
});

test('a collection quest: the fight brings a third of the goal, in rows of nine, and every foe drops the item', () => {
    const { h } = withQuest({ need: 30, noun: 'rat tails', source: 'inventory' });
    const { offer, offered } = offerOf(h, 'Giant Rat');
    assert.equal(total(offer.foes), 10);
    assert.ok(offer.foes.every(foe => foe.count <= 9 && foe.quest === 'th_00000001'));
    assert.match(offered.receipt.summary, /Sized for the quest: Giant Rat 1 → 10/);
    assert.equal(h.command('combat.start', { offer: offer.id }).ok, true);
    const setup = unpackSetup(sessionOf(h.state().domains.combat).setup);
    const all = [...setup.enemies, ...(setup.waves ?? []).flatMap(wave => wave.enemies)];
    assert.equal(all.length, 10, 'every foe is fought, past the field in waves');
    assert.ok(setup.waves.length >= 1);
    for (const enemy of all) assert.equal(enemy.loot.find(row => /Rat Tail/.test(row.name))?.chance, 100);
    if (h.query('combat.session').status === 'active') h.command('combat.act', { action: { type: 'auto' } });
    fightOut(h);
    const end = h.command('combat.end');
    assert.equal(end.ok, true, end.message);
    assert.equal(end.receipt.data.outcome, 'won', 'ten trivial rats in waves');
    {
        const tails = end.receipt.data.loot.items.filter(item => /Rat Tail/.test(item.name)).reduce((sum, item) => sum + item.qty, 0);
        assert.ok(tails >= 10, `${tails} tails from ten rats`);
    }
});

test('a kill quest: the fight brings a third of the goal; never more than is missing', () => {
    const { h } = withQuest({ need: 12, noun: 'wolves', source: 'fights' });
    assert.equal(total(offerOf(h, 'Wolf').offer.foes), 4);
    const { h: near } = withQuest({ need: 12, have: 10, noun: 'wolves', source: 'fights' });
    assert.equal(total(offerOf(near, 'Wolf').offer.foes), 2);
});

test('a count the story wrote is kept as written (its drops are still sure); other foes and bosses are left alone', () => {
    const { h } = withQuest({ need: 30, noun: 'rat tails', source: 'inventory' });
    const { offer } = offerOf(h, '2 Giant Rat, Wolf');
    assert.deepEqual(offer.foes.map(foe => [foe.name, foe.count, Boolean(foe.questItem)]), [['Giant Rat', 2, true], ['Wolf', 1, false]]);
    const boss = questSized([{ name: 'Giant Rat', count: 1, boss: true, tier: 'strong' }], [{ id: 'q', noun: 'rat tails', kind: 'items', need: 30, left: 30 }], DEFAULT_BESTIARY);
    assert.equal(boss.foes[0].count, 1);
});

test('without Story Director (or with no countable quest) a fight is as written', () => {
    const { h } = withQuest(null);
    assert.deepEqual(offerOf(h, 'Giant Rat').offer.foes.map(foe => [foe.name, foe.count]), [['Giant Rat', 1]]);
    assert.equal(offerOf(h, 'Giant Rat').offer.foes[0].quest, undefined);
});

test('reliableLoot: the quest item\'s row is sure, at least one; an item the table lacks is added', () => {
    const vermin = reliableLoot('vermin', 'rat tails');
    assert.equal(vermin.find(row => row.name === 'Rat Tail').chance, 100);
    const added = reliableLoot([{ name: 'Fang', chance: 40, qty: [1, 2], kind: 'material' }], 'rat tails');
    assert.deepEqual(added[0], { name: 'Rat Tails', chance: 100, qty: [1, 1], kind: 'material' });
});
