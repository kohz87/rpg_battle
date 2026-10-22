// The balance target of docs/DESIGN.md §7.1: an even fight (one character against three
// enemies of suggestRank(level), mixed roles), fought to the end on auto, lasts 4 to 6 rounds
// and costs about half the character's HP. Hundreds of seeded fights per level; if this fails
// after a change to the rules, retune DEFAULT_RULES.ranks rather than the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES as rules, STATS, derive, maxHp, maxMp, suggestRank } from '../src/rules.js';
import { makeRng } from '../src/rng.js';
import { DEFAULT_SKILLS, resolveSkills } from '../src/skills.js';

// The creation presets the rank table was tuned with (DESIGN §7.1, v1 0.5.x). v2 wave C rebalanced
// skills.PRESETS for v2's fight rules; this v1 tuning keeps measuring v1's presets on v1's engine.
const PRESETS = Object.freeze([
    { id: 'fighter', points: { STR: 4, VIT: 3, AGI: 1, DEX: 2 }, skills: ['Power Strike', 'Sweep', 'Second Wind'] },
    { id: 'skirmisher', points: { STR: 2, VIT: 2, AGI: 3, DEX: 3 }, skills: ['Quick Stab', 'Poison Dart', 'Power Strike'] },
    { id: 'caster', points: { VIT: 3, AGI: 1, DEX: 1, INT: 5 }, skills: ['Firebolt', 'Frost Shard', 'Ward'] },
    { id: 'healer', points: { VIT: 3, AGI: 1, INT: 4, CHA: 2 }, skills: ['Mend', 'Firebolt', 'Rally'] },
    { id: 'archer', points: { STR: 1, VIT: 2, AGI: 2, DEX: 4, LUK: 1 }, skills: ['Aimed Shot', 'Poison Dart', 'Second Wind'] },
]);
import { projectEnemy } from '../src/enemies.js';
import { startFight, summarize } from '../src/combat.js';
import { generateCreature } from '../src/templates.js';

const ROLES = ['brute', 'skirmisher', 'caster', 'tank', 'support'];
const FIGHTS = 300;

/** A level-N character made like a new sheet: 5 everywhere, the preset's points, and every
 * later level's points spread in the preset's proportions (largest remainder). No gear. */
function presetStats(preset, level) {
    const c = rules.character;
    const extra = (level - 1) * c.pointsPerLevel;
    const stats = Object.fromEntries(STATS.map(s => [s, c.startStat + (preset.points[s] ?? 0)]));
    const shares = STATS.map(s => ({ s, exact: (extra * (preset.points[s] ?? 0)) / c.startPoints }));
    let given = 0;
    for (const share of shares) {
        stats[share.s] += Math.floor(share.exact);
        given += Math.floor(share.exact);
    }
    shares.sort((a, b) => (b.exact % 1) - (a.exact % 1));
    for (let i = 0; given < extra; i++, given++) stats[shares[i].s] += 1;
    return stats;
}

function character(preset, level) {
    const stats = presetStats(preset, level);
    const hp = maxHp(stats, level, rules);
    const mp = maxMp(stats, level, rules);
    return {
        id: 'pc', memberId: 'pc', name: 'Hero', side: 'party', controller: 'auto',
        level, rank: null, role: null, boss: false, stats,
        hp: { cur: hp, max: hp }, mp: { cur: mp, max: mp }, ...derive(stats, {}, rules),
        skills: resolveSkills(preset.skills, DEFAULT_SKILLS, level, rules).map(s => ({ ...s, cooldownLeft: 0 })),
        items: [], conditions: [], morale: 0, talks: false, fleesBelow: 0, xp: 0, loot: null, gone: null,
    };
}

const median = list => {
    const sorted = [...list].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// One name per template, so made-up foes are tried across every kind (DESIGN §7.4).
const MADE_UP = ['Marsh Wolf', 'Bog Wight', 'Road Thug', 'Raider Chief', 'Hedge Witch', 'Stone Golem', 'Acid Slime', 'Cave Spider', 'Ashen Drake', 'Grave Wisp', 'Thorn Shambler', 'Glimmerfolk'];

function foesFor(kind, rank, rng, seed) {
    if (kind === 'projected') {
        // Unknown names, so every enemy is a pure rank × role projection.
        return [1, 2, 3].map(n => projectEnemy({ name: 'Foe', rank, role: rng.pick(ROLES) }, { bestiary: [], rules, rng, id: `e${n}` }));
    }
    // Creatures made up from their names at the fair rank's level, as a story fight would make them.
    return [1, 2, 3].map(n => {
        const entry = generateCreature({ name: rng.pick(MADE_UP), level: rules.ranks[rank].level }, { rules, seed });
        return projectEnemy({ name: entry.name }, { bestiary: [entry], rules, rng, id: `e${n}` });
    });
}

function simulate(level, kind = 'projected', turns = 'rounds') {
    const rank = suggestRank(level, rules);
    const rounds = [];
    const lost = [];
    let wins = 0;
    for (let i = 0; i < FIGHTS; i++) {
        const preset = PRESETS[i % PRESETS.length];
        const seed = `balance:${level}:${i}`;
        const rng = makeRng(seed);
        const enemies = foesFor(kind, rank, rng, seed);
        const fight = startFight({ id: seed, seed, turns, party: [character(preset, level)], enemies, stakes: 'normal', rules });
        const result = summarize(fight, rules);
        if (result.outcome !== 'victory' && result.outcome !== 'defeat') continue;
        if (result.outcome === 'victory') wins += 1;
        const hero = result.party[0];
        rounds.push(result.rounds);
        lost.push(1 - hero.hp.cur / hero.hp.max);
    }
    return { rank, fought: rounds.length, wins, rounds: median(rounds), lost: median(lost) };
}

for (const level of [1, 5, 10]) {
    test(`balance at level ${level}: an even fight lasts 4–6 rounds and costs about half the HP`, () => {
        const r = simulate(level);
        const summary = `level ${level} vs rank ${r.rank}: median ${r.rounds} rounds, ${Math.round(r.lost * 100)}% HP lost, ${r.wins}/${r.fought} won`;
        assert.ok(r.fought >= FIGHTS * 0.9, summary);
        assert.ok(r.rounds >= 4 && r.rounds <= 6, summary);
        assert.ok(r.lost >= 0.35 && r.lost <= 0.65, summary);
        // Even, not hopeless: most such fights are won.
        assert.ok(r.wins >= r.fought * 0.6, summary);
    });
}

// Made-up creatures have two or three skills, traits and temperaments, so they fight harder
// per head than a bare projection; rules.generated.skillPower is tuned so an even fight
// against them stays a fair one (a little longer, a little costlier, still mostly won).
for (const level of [1, 5, 10]) {
    test(`balance at level ${level}: an even fight against made-up foes stays fair`, () => {
        const r = simulate(level, 'generated');
        const summary = `level ${level} vs made-up rank ${r.rank}: median ${r.rounds} rounds, ${Math.round(r.lost * 100)}% HP lost, ${r.wins}/${r.fought} won`;
        assert.ok(r.fought >= FIGHTS * 0.9, summary);
        assert.ok(r.rounds >= 4 && r.rounds <= 7, summary);
        assert.ok(r.lost >= 0.3 && r.lost <= 0.7, summary);
        assert.ok(r.wins >= r.fought * 0.6, summary);
    });
}

// (0.5.14) The turn timeline (the default for new fights) holds the same targets: speed is
// AGI + 10, so the gaps at even levels are small and fights keep their length and cost.
for (const level of [1, 5, 10]) {
    test(`balance at level ${level} on the turn timeline: even fights stay fair, projected and made up`, () => {
        for (const [kind, most, low, high] of [['projected', 6, 0.35, 0.65], ['generated', 7, 0.3, 0.7]]) {
            const r = simulate(level, kind, 'timeline');
            const summary = `timeline, level ${level} vs ${kind} rank ${r.rank}: median ${r.rounds} rounds, ${Math.round(r.lost * 100)}% HP lost, ${r.wins}/${r.fought} won`;
            assert.ok(r.fought >= FIGHTS * 0.9, summary);
            assert.ok(r.rounds >= 4 && r.rounds <= most, summary);
            assert.ok(r.lost >= low && r.lost <= high, summary);
            assert.ok(r.wins >= r.fought * 0.6, summary);
        }
    });
}
