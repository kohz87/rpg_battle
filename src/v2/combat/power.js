// A creature's power (wave C balance): how dangerous one of it is to a standard character of the
// level it is fought at, so that a tier's level means the same danger for a wolf, a troll or a
// made-up river drake.
//
// Power is the damage a reference character takes while killing one of the creature: its damage
// per round times the rounds its HP lasts against the reference's blows (defences, evasion,
// regeneration, shields, stuns and curses all count, because the real fight engine measures them).
// What makes a foe dangerous changes with the level gap (far above the character, hit and evasion
// stop counting), so it is measured for the band levels (POWER_BANDS: 1, 5, 10, 20, 40, 60) around
// the character's, the creature at the same gap above (or below) the band as the foe is above the
// character, against the five creation presets as standard characters of the band's level (their
// points spent in the preset's proportions, their skills at the mastery the level brings), DUELS
// fixed-seed duels each, the creature as enemies.projectEnemy makes it with no random variation,
// both sides too hardy to fall, so each duel runs DUEL_ROUNDS rounds (about a fight's length: a
// caster's MP lasts as it does in one); the presets' geometric mean is the power. The reference is
// the median power of the shipped bestiary's creatures measured the same way. Deterministic: the
// same creature at the same band and gap always has the same power; it is worked out once and
// kept (POWER_CACHE entries).
//
// The fight scales a foe's HP and damage each by powerScale = √(reference / power), clamped to
// SCALE_MIN–SCALE_MAX, read along a straight line between the two bands around the character's
// level, so its power (HP × damage) comes near the reference's: a level-9 troll is a level-9
// wolf's danger. Pure.

import { DEFAULT_RULES, STATS, makeRules } from '../../rules.js';
import { DEFAULT_SKILLS, PRESETS } from '../../skills.js';
import { DEFAULT_BESTIARY, projectEnemy } from '../../enemies.js';
import { combatantFromSheet } from '../../party.js';
import { startFight } from '../../combat.js';
import { fightRules } from './stored.js';

export const POWER_BANDS = Object.freeze([1, 5, 10, 20, 40, 60]);
export const DUELS = 6;
// Rounds a duel lasts: about a fight's length, so a caster's MP and a buff's first turn count as they do in one.
export const DUEL_ROUNDS = 8;
export const SCALE_MIN = 0.4;
export const SCALE_MAX = 2;
export const POWER_CACHE = 4096;

const HARDY = 1e6;
const NUMBERS = { turns: 'timeline', speedOffset: 10, hit: { base: 75, perPoint: 3 } };

/** The mastery a standard character's skills have at `level`: 1, 2 from 5, 3 from 10, 4 from 20, 5 from 40. */
export const masteryAt = level => (level >= 40 ? 5 : level >= 20 ? 4 : level >= 10 ? 3 : level >= 5 ? 2 : 1);

/**
 * A preset's standard character at `level` as fight stats: the starting points and four a level
 * after the first spread in the preset's proportions (whole points, the rest to its last stat; a
 * stat at the cap passes on what it cannot take), on the start stat.
 */
export function presetStats(preset, level, rules = DEFAULT_RULES) {
    const c = rules.character;
    const total = c.startPoints + c.pointsPerLevel * (Math.max(1, level) - 1);
    const keys = Object.keys(preset.points);
    const weight = keys.reduce((sum, key) => sum + preset.points[key], 0);
    const stats = Object.fromEntries(STATS.map(stat => [stat, c.startStat]));
    const cap = Number(c.statCap) > 0 ? Number(c.statCap) : Infinity;
    let left = total;
    keys.forEach((key, index) => {
        const want = index === keys.length - 1 ? left : Math.floor(total * preset.points[key] / weight);
        const given = Math.min(want, cap - stats[key]);
        stats[key] += given;
        left -= given;
    });
    for (const key of [...keys, 'VIT', 'AGI', 'DEX', 'LUK', 'CHA', 'STR', 'INT']) {
        const more = Math.min(left, cap - stats[key]);
        if (more > 0) { stats[key] += more; left -= more; }
    }
    return stats;
}

const heroes = new Map();
/** The five presets' standard characters at `level`, too hardy to fall (and never low enough to stop and heal). */
function referenceCombatants(level) {
    if (heroes.has(level)) return heroes.get(level);
    const rules = fightRules(NUMBERS);
    const list = PRESETS.map(preset => {
        const sheet = { name: `Reference ${preset.id}`, level, stats: presetStats(preset, level, rules), skills: preset.skills.map(name => ({ name, mastery: masteryAt(level) })) };
        const c = combatantFromSheet(sheet, { memberId: `ref-${preset.id}`, controller: 'auto', library: DEFAULT_SKILLS, rules });
        return Object.freeze({ ...c, hp: { cur: HARDY, max: HARDY }, mp: { cur: HARDY, max: HARDY }, sp: { cur: HARDY, max: HARDY } });
    });
    heroes.set(level, list);
    return list;
}

// What makes one creature differ from another in a fight: the whole entry but its words and loot
// (a made-up or pack creature's template, traits, temperament and moves count as much as a shipped
// one's role and skills), and the rules it is projected by.
const COSMETIC = new Set(['look', 'loot', 'flavoured', 'kin', 'coins', 'family', 'aliases', 'description', 'eg', 'soulClass', 'rev', 'fresh']);
const stable = value => (Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value);
const rulesKey = rules => JSON.stringify(stable({ ranks: rules?.ranks, roles: rules?.roles, enemy: rules?.enemy, generated: rules?.generated, templates: rules?.templates, variation: rules?.variation }));
const powerKey = (entry, rules) => JSON.stringify([stable(Object.fromEntries(Object.entries(entry).filter(([key]) => !COSMETIC.has(key)))), rulesKey(rules)]);
const cache = new Map();

/**
 * The creature's power at level `foeLevel` against characters of level `band`: the geometric mean
 * over the five presets' standard characters of the damage one takes while killing it, from a
 * bestiary entry (the shipped bestiary's, a chat's, a pack's or one made up for a fight). Null
 * without an entry.
 */
export function creaturePower(entry, band = 10, foeLevel = band, rules = DEFAULT_RULES) {
    if (!entry || typeof entry !== 'object' || !String(entry.name ?? '').trim()) return null;
    band = Math.max(1, Math.round(Number(band) || 1));
    foeLevel = Math.max(1, Math.round(Number(foeLevel) || 1));
    const key = `${band}:${foeLevel}|${powerKey(entry, rules)}`;
    if (cache.has(key)) return cache.get(key);
    const numbers = fightRules(NUMBERS);
    const fightWith = makeRules({ ...numbers, combat: { ...numbers.combat, maxRounds: DUEL_ROUNDS } });
    const powers = referenceCombatants(band).map(hero => {
        let dealt = 0;
        let lost = 0;
        let rounds = 0;
        let hp = 1;
        for (let duel = 0; duel < DUELS; duel += 1) {
            const enemy = projectEnemy({ name: entry.name, level: foeLevel }, { bestiary: [entry], library: DEFAULT_SKILLS, rules, rng: null, id: 'e1' });
            hp = enemy.hp.max;
            // Both too hardy to fall: the duel runs its full DUEL_ROUNDS.
            enemy.hp = { cur: HARDY, max: HARDY };
            const f = startFight({ id: 'power', seed: `power:${duel}`, party: [structuredClone(hero)], enemies: [enemy], ...NUMBERS, stunRule: 'daze', rules: fightWith });
            const foe = f.combatants.find(c => c.side === 'enemy');
            dealt += f.stats.damageTaken[hero.id] ?? 0;
            lost += HARDY - foe.hp.cur;
            rounds += Math.max(1, f.round);
        }
        // Damage a round × the rounds its own HP lasts against what the reference takes off it a round.
        return Math.max(0.01, dealt / rounds) * hp / Math.max(0.01, lost / rounds);
    });
    const power = Math.round(Math.exp(powers.reduce((sum, value) => sum + Math.log(value), 0) / powers.length) * 100) / 100;
    cache.set(key, power);
    if (cache.size > POWER_CACHE) cache.delete(cache.keys().next().value);
    return power;
}

const references = new Map();
/** The median power of the shipped bestiary's creatures at `foeLevel` against characters of level `band` (kept). */
export function referencePower(band, foeLevel, rules = DEFAULT_RULES) {
    const key = `${band}:${foeLevel}|${rulesKey(rules)}`;
    if (references.has(key)) return references.get(key);
    const powers = DEFAULT_BESTIARY.map(entry => creaturePower(entry, band, foeLevel, rules)).sort((a, b) => a - b);
    const middle = powers.length % 2 ? powers[(powers.length - 1) / 2] : (powers[powers.length / 2 - 1] + powers[powers.length / 2]) / 2;
    references.set(key, middle);
    if (references.size > POWER_CACHE) references.delete(references.keys().next().value);
    return middle;
}

/** √(reference / power) for characters of level `band` and the foe `gap` levels above them, within SCALE_MIN–SCALE_MAX. */
function bandScale(entry, band, gap, rules) {
    const foeLevel = Math.max(1, Math.round(band + gap));
    const power = creaturePower(entry, band, foeLevel, rules);
    const reference = referencePower(band, foeLevel, rules);
    if (!power || !(reference > 0)) return 1;
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.sqrt(reference / power)));
}

/**
 * The scale a foe's HP and damage each take for a character of `pcLevel` meeting it at `foeLevel`,
 * so its power comes near the reference: bandScale at the two POWER_BANDS around the character's
 * level, the foe as far above each as it is above the character, read along a straight line
 * between them (held past both ends), three decimals; 1 without an entry.
 */
export function powerScale(entry, pcLevel = 10, foeLevel = pcLevel, rules = DEFAULT_RULES) {
    if (!entry || typeof entry !== 'object' || !String(entry.name ?? '').trim()) return 1;
    const level = Math.max(1, Number(pcLevel) || 1);
    const gap = Math.max(1, Number(foeLevel) || 1) - level;
    const upper = POWER_BANDS.find(band => band >= level) ?? POWER_BANDS.at(-1);
    const lower = [...POWER_BANDS].reverse().find(band => band <= level) ?? POWER_BANDS[0];
    const lo = bandScale(entry, lower, gap, rules);
    if (upper === lower) return Math.round(lo * 1000) / 1000;
    const hi = bandScale(entry, upper, gap, rules);
    const t = (level - lower) / (upper - lower);
    return Math.round((lo + (hi - lo) * t) * 1000) / 1000;
}
