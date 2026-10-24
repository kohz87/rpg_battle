// QA (wave C balance): a tier means the same danger whatever the creature, the headcount and the
// character's level. The fast version of scripts/balance-sim.mjs (200 seeds, every creature,
// preset, headcount and level band): 40 seeds over a spread of cells, floors a little wider than the
// targets (trivial ≥ 98 % won, weak ≥ 90 %, even 50–75 %, strong 20–50 %, deadly < 20 %).
// The fights run through scripts/balance-lib.mjs (v2's encounter and setup code, v1's engine, no
// bus); the first test shows they are the fights combat.start makes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATURES, PRESET_IDS, cellRate, directFight, heroParty } from '../../../scripts/balance-lib.mjs';
import { unpackSetup } from '../../../src/v2/combat/stored.js';
import { COMBAT_DEFAULTS, offerRows } from '../../../src/v2/combat/setup.js';
import { DEFAULT_BESTIARY } from '../../../src/enemies.js';
import { withHero } from './helpers/harness.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

const SEEDS = 40;
const creature = name => CREATURES.find(entry => `${entry.set}:${entry.name}` === name);

test('the simulation\'s fights are combat.start\'s: same setup seed, same outcome', () => {
    for (const [words, tier, preset] of [['3 Wolf', 'even', 'fighter'], ['1 Troll', 'strong', 'caster'], ['6 Giant Rat', 'weak', 'healer']]) {
        for (let seed = 1; seed <= 4; seed += 1) {
            const { h } = withHero({ seed, preset });
            h.capture({ op: '!', kind: 'encounter', name: words, text: '', labels: { tier } });
            assert.equal(h.command('combat.start', { offer: h.query('combat.offers').at(-1).id }).ok, true);
            const fightSeed = unpackSetup(sessionOf(h.state().domains.combat).setup).seed;
            for (let n = 0; n < 400 && h.query('combat.session').status === 'active'; n += 1) h.command('combat.act', { action: { type: 'auto' } });
            const live = h.query('combat.session').status;
            assert.equal(directFight({ words, tier, seed: fightSeed, party: heroParty(preset, 1) }), live, `${words} (${tier}) ${preset}, seed ${seed}`);
        }
    }
});

test('the budget is the party\'s: four foes against two members are two each; past the field, waves', () => {
    const rows = (count, partySize) => offerRows({ foes: [{ name: 'Wolf', count, tier: 'deadly' }] }, { pcLevel: 1, bestiary: DEFAULT_BESTIARY, partySize });
    const pick = list => list.map(row => [row.level, row.scale ?? 1, row.levelScale ?? 1]);
    assert.deepEqual(pick(rows(4, 2)), pick(rows(2, 1)));
    assert.equal(rows(4, 2)[0].count, 4, 'all four come');
    // Nine against one: four on the field (the default setting), the rest in later waves, all fought.
    const nine = rows(9, 1);
    assert.equal(nine.reduce((sum, row) => sum + row.count, 0), 9);
    assert.equal(nine.filter(row => !row.wave).reduce((sum, row) => sum + row.count, 0), COMBAT_DEFAULTS.fieldPerMember);
});

// The cells: [tier, level, headcount, creature]; every preset fights each.
const CELLS = [
    ['trivial', 1, 6, 'bestiary:Giant Rat'], ['trivial', 10, 3, 'ersveil:Starved Crag Wolf'], ['trivial', 40, 9, 'bestiary:Bandit'],
    ['weak', 1, 3, 'bestiary:Wolf'], ['weak', 5, 4, 'made:Cellar Rat Swarm'], ['weak', 20, 4, 'ersveil:Cellar Rat Swarm'], ['weak', 60, 2, 'bestiary:Troll'],
    ['even', 1, 1, 'bestiary:Bandit'], ['even', 10, 2, 'bestiary:Wolf'], ['even', 20, 3, 'ersveil:River Drake'], ['even', 40, 1, 'bestiary:Skeleton'],
    ['strong', 1, 2, 'bestiary:Goblin'], ['strong', 5, 1, 'bestiary:Wolf'], ['strong', 20, 1, 'bestiary:Troll'], ['strong', 60, 3, 'bestiary:Cultist'],
    ['deadly', 1, 1, 'bestiary:Wolf'], ['deadly', 10, 4, 'bestiary:Troll'], ['deadly', 40, 2, 'ersveil:Crag Wolf Matriarch'],
];
// Floors for 40 seeds, regression guards a little wider than what the 200-seed run measured (the
// PR's table): for trivial, weak and deadly the share of cells past a line; for even and strong the
// cells' median inside a band and a share of cells inside a wider one (the presets and creatures
// differ more than those bands: a caster beats a lone foe that a healer loses to).
const FLOORS = {
    trivial: { at: [90, 100], share: 85 },
    weak: { at: [80, 100], share: 85 },
    even: { median: [35, 85], at: [25, 92], share: 50 },
    strong: { median: [15, 60], at: [8, 75], share: 50 },
    deadly: { at: [0, 27], share: 85 },
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const results = Object.fromEntries(Object.keys(FLOORS).map(tier => [tier, []]));
for (const [tier, level, count, name] of CELLS) {
    test(`every preset against ${count} ${name} (${tier}) at level ${level}`, () => {
        for (const preset of PRESET_IDS) {
            const rate = cellRate({ creature: creature(name), count, tier, preset, level, seeds: SEEDS, first: 1000 });
            results[tier].push({ preset, level, count, name, rate });
        }
        assert.ok(results[tier].length > 0);
    });
}

for (const [tier, floor] of Object.entries(FLOORS)) {
    const [lo, hi] = floor.at;
    test(`${tier}: at least ${floor.share} % of the cells won ${lo}–${hi} % of the time${floor.median ? `, their median ${floor.median.join('–')} %` : ''}`, () => {
        const cells = results[tier];
        assert.ok(cells.length > 0);
        const inside = cells.filter(cell => cell.rate >= lo && cell.rate <= hi);
        const off = cells.filter(cell => cell.rate < lo || cell.rate > hi).map(cell => `${cell.preset} L${cell.level} ×${cell.count} ${cell.name} ${Math.round(cell.rate)} %`);
        assert.ok(inside.length / cells.length * 100 >= floor.share, `${inside.length}/${cells.length} inside; off: ${off.join('; ')}`);
        if (floor.median) {
            const middle = median(cells.map(cell => cell.rate));
            assert.ok(middle >= floor.median[0] && middle <= floor.median[1], `median ${middle} %`);
        }
    });
}
