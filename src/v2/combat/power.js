// A creature's power (wave C balance): how dangerous one of it is, whatever its level, so that a
// tier's level means the same danger for a wolf, a troll or a made-up river drake.
//
// Power is the damage a reference character takes while killing one of the creature: its damage
// per round times the rounds its HP lasts against the reference's blows (defences, evasion,
// regeneration, shields, stuns and curses all count, because the real fight engine measures them).
// It is measured at REFERENCE_LEVEL by DUELS fixed-seed duels of each reference character (a blade
// who only attacks and a mage who only casts, both at that level) against the creature as
// enemies.projectEnemy makes it there with no random variation, both sides too hardy to fall, so
// each duel runs DUEL_ROUNDS rounds (about a fight's length: a caster's MP lasts as it does in one). Deterministic: the same creature
// always has the same power; it is worked out once and kept (POWER_CACHE entries).
//
// The fight scales a foe's HP and damage each by powerScale = √(REFERENCE_POWER / power), clamped
// to SCALE_MIN–SCALE_MAX, so its power (HP × damage) comes near the reference. REFERENCE_POWER is
// the median of the shipped bestiary's creatures (a test keeps it equal to what they measure).
// Pure.

import { DEFAULT_RULES, STATS, makeRules } from '../../rules.js';
import { DEFAULT_SKILLS } from '../../skills.js';
import { projectEnemy } from '../../enemies.js';
import { combatantFromSheet } from '../../party.js';
import { startFight } from '../../combat.js';
import { fightRules } from './stored.js';

export const REFERENCE_LEVEL = 10;
export const DUELS = 12;
// Rounds a duel lasts: about a fight's length, so a caster's MP and a buff's first turn count as they do in one.
export const DUEL_ROUNDS = 8;
export const SCALE_MIN = 0.6;
export const SCALE_MAX = 1.6;
// The median power of DEFAULT_BESTIARY at REFERENCE_LEVEL (tests/v2/combat/power.test.js measures it).
export const REFERENCE_POWER = 24.2;
export const POWER_CACHE = 512;

// The reference characters: a level-10 character's 46 points (start 10, 4 a level) spread like the
// Fighter and the Caster presets.
const REFERENCES = Object.freeze([
    { id: 'blade', points: { STR: 18, VIT: 14, AGI: 5, DEX: 9 }, skills: [] },
    { id: 'mage', points: { VIT: 14, AGI: 5, DEX: 4, INT: 23 }, skills: [{ name: 'Firebolt', mastery: 1 }] },
]);
const HARDY = 1e6;
const NUMBERS = { turns: 'timeline', speedOffset: 10, hit: { base: 75, perPoint: 3 } };

let references = null;
function referenceCombatants() {
    if (references) return references;
    const rules = fightRules(NUMBERS);
    references = REFERENCES.map(ref => {
        const stats = Object.fromEntries(STATS.map(stat => [stat, rules.character.startStat + (ref.points[stat] ?? 0)]));
        const c = combatantFromSheet({ name: `Reference ${ref.id}`, level: REFERENCE_LEVEL, stats, skills: ref.skills }, { memberId: `ref-${ref.id}`, controller: 'auto', library: DEFAULT_SKILLS, rules });
        // Too hardy to fall (and never low enough to stop and heal): the duel runs until the creature is gone.
        return Object.freeze({ ...c, hp: { cur: HARDY, max: HARDY }, mp: { cur: HARDY, max: HARDY }, sp: { cur: HARDY, max: HARDY } });
    });
    return references;
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
 * The creature's power: the mean damage a reference character takes while killing it (the
 * geometric mean of the blade's and the mage's), from a bestiary entry (the shipped bestiary's, a
 * chat's, a pack's or one made up for a fight). Null without an entry.
 */
export function creaturePower(entry, rules = DEFAULT_RULES) {
    if (!entry || typeof entry !== 'object' || !String(entry.name ?? '').trim()) return null;
    const key = powerKey(entry, rules);
    if (cache.has(key)) return cache.get(key);
    const numbers = fightRules(NUMBERS);
    const fightWith = makeRules({ ...numbers, combat: { ...numbers.combat, maxRounds: DUEL_ROUNDS } });
    const powers = referenceCombatants().map(hero => {
        let dealt = 0;
        let lost = 0;
        let rounds = 0;
        let hp = 1;
        for (let duel = 0; duel < DUELS; duel += 1) {
            const enemy = projectEnemy({ name: entry.name, level: REFERENCE_LEVEL }, { bestiary: [entry], library: DEFAULT_SKILLS, rules, rng: null, id: 'e1' });
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
    const power = Math.round(Math.sqrt(powers.reduce((a, b) => a * b, 1)) * 10) / 10;
    cache.set(key, power);
    if (cache.size > POWER_CACHE) cache.delete(cache.keys().next().value);
    return power;
}

/**
 * The scale a foe's HP and damage each take so its power comes near REFERENCE_POWER:
 * √(REFERENCE_POWER / power), within SCALE_MIN–SCALE_MAX, three decimals; 1 without an entry.
 */
export function powerScale(entry, rules = DEFAULT_RULES) {
    const power = creaturePower(entry, rules);
    if (!power) return 1;
    const scale = Math.sqrt(REFERENCE_POWER / power);
    return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale)) * 1000) / 1000;
}
