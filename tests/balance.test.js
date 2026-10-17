// The balance target of docs/DESIGN.md §7.1: an even fight (one character against three
// enemies of suggestRank(level), mixed roles), fought to the end on auto, lasts 4 to 6 rounds
// and costs about half the character's HP. Hundreds of seeded fights per level; if this fails
// after a change to the rules, retune DEFAULT_RULES.ranks rather than the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES as rules, STATS, derive, maxHp, maxMp, suggestRank } from '../src/rules.js';
import { makeRng } from '../src/rng.js';
import { DEFAULT_SKILLS, PRESETS, resolveSkills } from '../src/skills.js';
import { projectEnemy } from '../src/enemies.js';
import { startFight, summarize } from '../src/combat.js';

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

function simulate(level) {
    const rank = suggestRank(level, rules);
    const rounds = [];
    const lost = [];
    let wins = 0;
    for (let i = 0; i < FIGHTS; i++) {
        const preset = PRESETS[i % PRESETS.length];
        const seed = `balance:${level}:${i}`;
        const rng = makeRng(seed);
        // Unknown names, so every enemy is a pure rank × role projection.
        const enemies = [1, 2, 3].map(n => projectEnemy({ name: 'Foe', rank, role: rng.pick(ROLES) }, { bestiary: [], rules, rng, id: `e${n}` }));
        const fight = startFight({ id: seed, seed, party: [character(preset, level)], enemies, stakes: 'normal', rules });
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
