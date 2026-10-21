// OPEN findings (B4r2-4, B4r2-7, B4r2-8): they wait for the user's balance decisions. These are
// measurements, not part of `npm test` (about 900 simulated fights: run in parallel with the suite they
// starve its timing tests). Run them with: node --test tests/v2/break/open/b4r2-open-balance.sim.js
// They are todo tests and are expected to fail until the decisions land.
// B4r2-3 / B4r2-4: the new balance (RB-fix1 #83: a tier is a threat budget for the group, hang-back,
// stun cap) against its own targets (scripts/balance-sim.mjs TARGETS: trivial ≥ 98 %, weak ≥ 90 %,
// even 50–75 %, strong 20–50 %, deadly < 20 %, even and strong read as the presets' middle),
// measured on seeds the calibration did not use (5000+, 8000+). Numbers: r2/sim/*.jsonl.
//
// B4r2-3: each row's foes move by the WHOLE offer's headcount, whatever tier the other rows are, so
// trivial fodder makes a deadly foe small: "deadly Ogre, 5 trivial Giant Rat" fields a level-2 Ogre
// (alone: level 9) and the fighter wins 99 % (alone 19 %). A boss row is shifted too ("Ancient
// Dragon (boss), 8 Wolf": the dragon drops from level 9 to 2).
// B4r2-4: lone foes keep v1's level (setup.js groupPower: headcount < 2 → no shift), so a lone
// strong or deadly foe is far off the targets: 1 Wolf strong 88–100 %, deadly 9–60 % (median 28).
// B4r2-7: the shifts were calibrated on six bestiary foes (Wolf, Giant Rat, Bandit, Goblin, Cellar Rat
// Swarm, Marsh Ghoul); other creatures at the same tier miss by far: 5 deadly Trolls are won 55–100 %
// (median 91), 5 deadly Skeletons 45–100 %, 3 strong Trolls 96–100 % (r2/sim/other-*.jsonl).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fight, TARGETS } from '../../../../scripts/balance-sim.mjs';
import { patch, withHero } from '../../qa/helpers/harness.js';
import { PRESETS as PRESET_DEFS } from '../../../../src/skills.js';
import { DEFAULT_RULES, xpToNext } from '../../../../src/rules.js';
import { gainXp } from '../../../../src/growth.js';
import { spendPoints } from '../../../../src/sheet.js';
import { fromSheet, toSheet } from '../../../../src/v2/party/sheets.js';

const PRESETS = ['fighter', 'skirmisher', 'caster', 'healer', 'archer'];
const rate = (words, tier, preset, first, seeds) => {
    let won = 0;
    for (let seed = first; seed < first + seeds; seed += 1) if (fight(words, tier, preset, seed) === 'won') won += 1;
    return won / seeds * 100;
};
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

// B4r2-4 and B4r2-7 wait for the user's balance decisions (open): kept as measurements (todo).
const OPEN = 'open: waits for the balance decision';

test('B4r2-4: a lone strong or deadly foe meets the tier targets (presets\' middle)', { timeout: 600000, todo: OPEN }, () => {
    for (const tier of ['strong', 'deadly']) {
        const rates = PRESETS.map(preset => rate('1 Wolf', tier, preset, 5000, 60));
        const [lo, hi] = TARGETS[tier];
        const mid = median(rates);
        assert.ok(mid >= lo && mid <= hi, `1 Wolf (${tier}): ${PRESETS.map((p, i) => `${p} ${rates[i].toFixed(0)}`).join(', ')}; middle ${mid.toFixed(0)} % is outside ${lo}–${hi} %`);
    }
});

test('B4r2-7: a deadly group of a creature outside the calibration set is still deadly (five Trolls)', { timeout: 600000, todo: OPEN }, () => {
    const rates = PRESETS.map(preset => rate('5 Troll', 'deadly', preset, 5000, 40));
    assert.ok(rates.every(value => value < TARGETS.deadly[1]), `5 Troll (deadly): ${PRESETS.map((p, i) => `${p} ${rates[i].toFixed(0)}`).join(', ')} won`);
});

// B4r2-8: "Counted in levels, the same budget holds at any level" (setup.js, RB-fix1 #83). A level-20
// character (made from the preset by v1's own gainXp and spendPoints, its points spent in the
// preset's proportions; skills left at mastery 1) loses to four WEAK Cellar Rat Swarms about half
// the time as a caster (46 %) and a quarter as a fighter (74 %), against the weak target ≥ 90 %;
// at level 10 the same character wins 100 %. Numbers: r2/sim/level10.jsonl, level20.jsonl.
/** Test setup only: your character raised to `level` by v1's rules, points spent like the preset. */
function levelled(h, preset, level) {
    patch(h, state => {
        const party = state.domains.party;
        const actor = party.actors[party.pc];
        let xp = 0;
        for (let lv = 1; lv < level; lv += 1) xp += xpToNext(lv, DEFAULT_RULES);
        let sheet = gainXp(toSheet(actor), xp, DEFAULT_RULES).sheet;
        const points = PRESET_DEFS.find(entry => entry.id === preset).points;
        const total = Object.values(points).reduce((a, b) => a + b, 0);
        const keys = Object.keys(points);
        let left = sheet.points;
        const allocation = {};
        keys.forEach((key, index) => {
            const n = index === keys.length - 1 ? left : Math.floor(sheet.points * points[key] / total);
            allocation[key] = n;
            left -= n;
        });
        sheet = spendPoints(sheet, allocation, DEFAULT_RULES);
        sheet.hp = { ...sheet.hp, cur: sheet.hp.max };
        sheet.mp = { ...sheet.mp, cur: sheet.mp.max };
        party.actors[party.pc] = fromSheet(actor, sheet, DEFAULT_RULES);
    });
}

function levelFight(words, tier, preset, seed, level) {
    const { h } = withHero({ seed, preset });
    levelled(h, preset, level);
    h.capture({ op: '!', kind: 'encounter', name: words, text: '', labels: { tier } });
    assert.equal(h.command('combat.start', { offer: h.query('combat.offers').at(-1).id }).ok, true);
    for (let n = 0; n < 400 && h.query('combat.session').status === 'active'; n += 1) h.command('combat.act', { action: { type: 'auto' } });
    return h.query('combat.session').status;
}

// Open: waits for the user's balance decision. Kept as a measurement (todo).
test('B4r2-8: weak foes stay weak at level 20 (four Cellar Rat Swarms, caster and fighter ≥ 90 %)', { timeout: 600000, todo: 'open: waits for the balance decision' }, () => {
    for (const preset of ['caster', 'fighter']) {
        let won = 0;
        for (let seed = 6000; seed < 6050; seed += 1) if (levelFight('4 Cellar Rat Swarm', 'weak', preset, seed, 20) === 'won') won += 1;
        assert.ok(won >= 45, `level-20 ${preset}: ${won}/50 won against four weak Cellar Rat Swarms`);
    }
});
