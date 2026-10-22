// The field setting (user decision, wave C): the reader caps the foes on the field at once (per party
// member and in all, default four a member); an encounter with more comes in later waves, each when
// the one before is down, and every foe the story wrote is fought. Bosses take the first places of
// their wave. The tier reads the whole encounter: waves count by Lanchester's square law
// (effectiveHeadcount). And an area skill rolls for each target on its own, saying who it missed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRules } from '../../../src/rules.js';
import { startFight } from '../../../src/combat.js';
import { DEFAULT_BESTIARY } from '../../../src/enemies.js';
import { COMBAT_DEFAULTS, buildSetup, effectiveHeadcount, fightNumbers, levelShift, offerRows, planWaves } from '../../../src/v2/combat/setup.js';

const hero = (over = {}) => ({ id: 'pc', memberId: 'pc', name: 'Ren', side: 'party', controller: 'player', level: 10, stats: { STR: 10, VIT: 8, AGI: 8, DEX: 8, INT: 8, LUK: 5, CHA: 5 }, hp: { cur: 200, max: 200 }, mp: { cur: 50, max: 50 }, patk: 20, matk: 16, pdef: 8, mdef: 8, crit: 0, skills: [], items: [], conditions: [], ...over });
const waveCounts = rows => rows.reduce((out, row) => { out[row.wave ?? 0] = (out[row.wave ?? 0] ?? 0) + row.count; return out; }, []);

test('planWaves: no more on the field than the setting; the rest in later waves, every foe kept', () => {
    assert.deepEqual(waveCounts(planWaves([{ name: 'Wolf', count: 9 }], 1)), [4, 4, 1]);
    assert.deepEqual(waveCounts(planWaves([{ name: 'Wolf', count: 9 }], 2)), [8, 1]);
    assert.deepEqual(waveCounts(planWaves([{ name: 'Wolf', count: 9 }], 1, { perMember: 9, max: 24 })), [9]);
    assert.deepEqual(waveCounts(planWaves([{ name: 'Wolf', count: 9 }], 3, { perMember: 4, max: 5 })), [5, 4], 'the overall cap');
    // The story's own waves keep their order, each split the same way.
    const story = planWaves([{ name: 'Wolf', count: 6 }, { name: 'Bear', count: 2, wave: 1 }], 1);
    assert.deepEqual(story.map(row => [row.name, row.count, row.wave ?? 0]), [['Wolf', 4, 0], ['Wolf', 2, 1], ['Bear', 2, 2]]);
});

test('planWaves: a boss takes the first places of its wave, never pushed later than its followers', () => {
    const rows = planWaves([{ name: 'Wolf', count: 4 }, { name: 'Rat King', count: 1, boss: true }], 1);
    assert.ok(rows.some(row => row.name === 'Rat King' && !row.wave));
    assert.deepEqual(waveCounts(rows), [4, 1]);
    // Written in a later wave by the story, it stays there.
    const later = planWaves([{ name: 'Wolf', count: 2 }, { name: 'Rat King', count: 1, boss: true, wave: 1 }], 1);
    assert.equal(later.find(row => row.name === 'Rat King').wave, 1);
});

test('effectiveHeadcount: waves by the square law; all at once, the count', () => {
    assert.equal(effectiveHeadcount([4]), 4);
    assert.ok(Math.abs(effectiveHeadcount([4, 4, 1]) - Math.sqrt(33)) < 1e-9);
    assert.equal(effectiveHeadcount([8, 8], 2), Math.sqrt(128) / 2);
    assert.equal(effectiveHeadcount([]), 1);
});

test('the tier reads the whole encounter: nine in waves of four are about 5.7 at once; the setting changes the budget', () => {
    const level = rows => rows.find(row => row.threat).level;
    const nine = setting => offerRows({ foes: [{ name: 'Wolf', count: 9, tier: 'even' }] }, { pcLevel: 20, bestiary: DEFAULT_BESTIARY, field: setting });
    const four = offerRows({ foes: [{ name: 'Wolf', count: 4, tier: 'even' }] }, { pcLevel: 20, bestiary: DEFAULT_BESTIARY });
    assert.ok(level(nine()) <= level(four), 'more foes in all, each no stronger');
    assert.ok(level(nine({ perMember: 9, max: 24 })) <= level(nine()), 'all nine at once: each smaller still');
    const raw = 20 + levelShift('even', 20, Math.sqrt(33));
    assert.ok(Math.abs(level(nine()) - Math.max(1, Math.ceil(raw - 1e-9))) <= 1);
});

test('fightNumbers: the field setting within its bounds; buildSetup sends the extra foes in waves', () => {
    assert.deepEqual(fightNumbers({}).field, { perMember: COMBAT_DEFAULTS.fieldPerMember, max: COMBAT_DEFAULTS.fieldMax });
    assert.deepEqual(fightNumbers({ fieldPerMember: 40, fieldMax: 0 }).field, { perMember: 12, max: 1 });
    const { setup } = buildSetup({ id: 'fi_00000001', seed: 3, offer: { foes: [{ name: 'Wolf', count: 9, tier: 'weak' }, { name: 'Bandit', count: 1, tier: 'weak', boss: true }] }, party: [hero()], numbers: fightNumbers({}) });
    assert.equal(setup.enemies.length, 4);
    assert.ok(setup.enemies.some(enemy => enemy.boss), 'the boss is on the field from the start');
    assert.equal(setup.enemies.length + setup.waves.reduce((sum, wave) => sum + wave.enemies.length, 0), 10, 'every foe is fought');
    const names = [...setup.enemies, ...setup.waves.flatMap(wave => wave.enemies)].map(enemy => enemy.name);
    assert.equal(new Set(names).size, names.length, 'one name each across waves');
});

test('an area skill rolls for each target: it can miss some and hit others; the miss is a key moment', () => {
    const sweep = { name: 'Wide Bolt', type: 'magic', stat: 'INT', power: 0.5, mp: 0, cooldown: 0, target: 'all', effect: null, mastery: 1, cooldownLeft: 0 };
    const foe = n => ({ id: `e${n}`, name: `Wolf ${n}`, side: 'enemy', controller: 'auto', level: 10, stats: { STR: 8, VIT: 8, AGI: 14, DEX: 8, INT: 5, LUK: 5, CHA: 5 }, hp: { cur: 9999, max: 9999 }, mp: { cur: 0, max: 0 }, patk: 1, matk: 1, pdef: 0, mdef: 0, crit: 0, skills: [], items: [], conditions: [], morale: 9, talks: false, fleesBelow: 0, xp: 0, loot: 'beast', gone: null });
    let mixed = 0;
    for (let seed = 1; seed <= 20 && !mixed; seed += 1) {
        const f = startFight({ id: 'f1', seed: `aoe${seed}`, party: [hero({ controller: 'auto', skills: [sweep], hp: { cur: 99999, max: 99999 } })], enemies: [foe(1), foe(2), foe(3), foe(4)], turns: 'timeline', speedOffset: 10, hitRule: 'relative', spellRule: 'roll', rules: makeRules({ combat: { maxRounds: 3 } }) });
        const moment = f.log.find(entry => /Wide Bolt misses .* and hits/.test(entry.text));
        if (moment) {
            assert.equal(moment.important, true);
            mixed = seed;
        }
    }
    assert.ok(mixed, 'some cast missed part of the field and hit the rest');
});

test('live case: "! encounter 8 Weir Rat — cellar pack | tier: weak" against one level-1 character fights all eight, the rest in waves', async () => {
    const { withHero } = await import('../qa/helpers/harness.js');
    const { sessionOf, unpackSetup } = await import('../../../src/v2/combat/stored.js');
    const { h } = withHero({ seed: 1 });
    const offered = h.capture({ op: '!', kind: 'encounter', name: '8 Weir Rat — cellar pack', text: '', labels: { tier: 'weak' } });
    assert.equal(offered.ok, true, offered.message);
    const offer = h.query('combat.offers').at(-1);
    assert.equal(offer.foes.reduce((sum, foe) => sum + foe.count, 0), 8);
    const start = h.command('combat.start', { offer: offer.id });
    assert.equal(start.ok, true, start.message);
    const setup = unpackSetup(sessionOf(h.state().domains.combat).setup);
    const all = [...setup.enemies, ...(setup.waves ?? []).flatMap(wave => wave.enemies)];
    assert.equal(all.length, 8, `fought: ${all.map(enemy => enemy.name).join(', ')}`);
    assert.ok(setup.enemies.length <= COMBAT_DEFAULTS.fieldPerMember, 'no more on the field than the setting');
    assert.match(start.receipt.summary, /more in later waves/);
});
