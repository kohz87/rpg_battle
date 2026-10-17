// The skill library: what a named skill does in a fight, the optional character presets, and
// skills built from a template when the story teaches something the library does not have.
//
// The Character and Party blocks list only skill names (DESIGN §6), so the numbers live here
// and the model cannot inflate a skill by renaming it. Tier 1 asks for nothing and is what a
// new character picks from; tiers 2 and 3 ask for stats instead of a class. Pure.

import { DEFAULT_RULES, STATS } from './rules.js';

const TYPES = ['physical', 'magic', 'heal', 'buff', 'debuff'];
const TARGETS = ['one', 'all', 'self', 'ally', 'allies'];

const skill = (name, tier, type, stat, power, mp, cooldown, target, effect, requires, description) =>
    Object.freeze({ name, tier, type, stat, power, mp, cooldown, target, effect, requires, description });

export const DEFAULT_SKILLS = Object.freeze([
    // Tier 1: no requirements; the starter pool.
    skill('Power Strike', 1, 'physical', 'STR', 1.6, 4, 1, 'one', null, null, 'A heavy, committed blow.'),
    skill('Quick Stab', 1, 'physical', 'DEX', 1.2, 2, 0, 'one', { bleed: 2 }, null, 'A fast jab that leaves a bleeding wound.'),
    skill('Shield Bash', 1, 'physical', 'STR', 0.9, 4, 3, 'one', { stun: 1 }, null, 'A shove that can stun the target for a turn.'),
    skill('Sweep', 1, 'physical', 'STR', 0.7, 5, 2, 'all', null, null, 'A wide swing that catches every enemy.'),
    skill('Aimed Shot', 1, 'physical', 'DEX', 1.7, 4, 1, 'one', null, null, 'A careful shot at a weak spot.'),
    skill('Poison Dart', 1, 'physical', 'DEX', 0.8, 3, 1, 'one', { poison: 3 }, null, 'A light dart that poisons for three rounds.'),
    skill('Firebolt', 1, 'magic', 'INT', 1.2, 5, 0, 'one', { burn: 2 }, null, 'A bolt of fire that sets the target burning.'),
    skill('Frost Shard', 1, 'magic', 'INT', 1.3, 5, 1, 'one', { slow: 2 }, null, 'A shard of ice that slows the target.'),
    skill('Mend', 1, 'heal', 'INT', 1.8, 6, 0, 'ally', null, null, 'Closes wounds on one ally.'),
    skill('Second Wind', 1, 'heal', 'VIT', 2.2, 4, 3, 'self', null, null, 'Catch your breath and recover.'),
    skill('Guard Up', 1, 'buff', 'VIT', 1, 3, 3, 'self', { guard: 2 }, null, 'Brace: damage taken is halved for two rounds.'),
    skill('Ward', 1, 'buff', 'INT', 1, 5, 3, 'ally', { shield: 3 }, null, 'A shield of force that absorbs damage.'),
    skill('Rally', 1, 'buff', 'CHA', 1, 6, 4, 'allies', { regen: 3 }, null, 'Words that steady the party; everyone regenerates.'),
    skill('Intimidate', 1, 'debuff', 'CHA', 0, 4, 3, 'all', { weaken: 2 }, null, 'A threat that weakens every enemy\'s attacks.'),

    // Tier 2 and 3: open to anyone who builds the stat.
    skill('Rending Strike', 2, 'physical', 'STR', 1.6, 6, 2, 'one', { bleed: 2 }, { STR: 8 }, 'A tearing cut that bleeds.'),
    skill('Guard Break', 2, 'physical', 'STR', 1.3, 5, 2, 'one', { weaken: 2 }, { STR: 8 }, 'Batters the guard aside and weakens the target.'),
    skill('Stunning Blow', 2, 'physical', 'STR', 1.2, 6, 3, 'one', { stun: 1 }, { STR: 9, DEX: 7 }, 'A precise blow to the head.'),
    skill('Cleave', 2, 'physical', 'STR', 1, 8, 2, 'all', null, { STR: 10 }, 'A full-strength swing through every enemy.'),
    skill('Backstab', 2, 'physical', 'AGI', 2, 7, 2, 'one', null, { AGI: 9 }, 'Slip behind the target and strike.'),
    skill('Venom Edge', 2, 'physical', 'DEX', 1.3, 6, 2, 'one', { poison: 3 }, { DEX: 8, AGI: 7 }, 'A poisoned cut.'),
    skill('Volley', 2, 'physical', 'DEX', 0.9, 8, 2, 'all', null, { DEX: 9 }, 'Arrows across the whole enemy line.'),
    skill('Ember Lance', 2, 'magic', 'INT', 1.9, 9, 1, 'one', null, { INT: 8 }, 'A spear of fire.'),
    skill('Fireball', 2, 'magic', 'INT', 1.1, 12, 2, 'all', { burn: 2 }, { INT: 9 }, 'Fire bursts over every enemy.'),
    skill('Greater Heal', 2, 'heal', 'INT', 3, 12, 1, 'ally', null, { INT: 9 }, 'A deep, fast healing.'),
    skill('Renewal', 2, 'heal', 'INT', 1.2, 14, 2, 'allies', { regen: 2 }, { INT: 8, CHA: 7 }, 'Heals the whole party and keeps healing.'),
    skill('Warcry', 2, 'debuff', 'CHA', 0, 7, 4, 'all', { weaken: 2, slow: 1 }, { CHA: 9 }, 'A roar that weakens and slows every enemy.'),
    skill('Piercing Shot', 3, 'physical', 'DEX', 2.4, 10, 2, 'one', { bleed: 2 }, { DEX: 13 }, 'A shot that goes clean through armour.'),
    skill('Thunder Slam', 3, 'physical', 'STR', 1.4, 16, 4, 'all', { stun: 1 }, { STR: 14, VIT: 10 }, 'The ground shakes and enemies reel.'),
    skill('Chain Lightning', 3, 'magic', 'INT', 1.5, 18, 3, 'all', null, { INT: 14 }, 'Lightning leaps from enemy to enemy.'),
    skill('Fortress', 3, 'buff', 'VIT', 1.5, 10, 5, 'self', { guard: 3, regen: 3 }, { VIT: 13 }, 'An unbreakable stance that also heals.'),
]);

export const PRESETS = Object.freeze([
    // Every spread puts a little into VIT: a character with base VIT falls over by level 10.
    { id: 'fighter', name: 'Fighter', points: { STR: 4, VIT: 3, AGI: 1, DEX: 2 }, skills: ['Power Strike', 'Sweep', 'Second Wind'] },
    { id: 'skirmisher', name: 'Skirmisher', points: { STR: 2, VIT: 2, AGI: 3, DEX: 3 }, skills: ['Quick Stab', 'Poison Dart', 'Power Strike'] },
    { id: 'caster', name: 'Caster', points: { VIT: 3, AGI: 1, DEX: 1, INT: 5 }, skills: ['Firebolt', 'Frost Shard', 'Ward'] },
    { id: 'healer', name: 'Healer', points: { VIT: 3, AGI: 1, INT: 4, CHA: 2 }, skills: ['Mend', 'Firebolt', 'Rally'] },
    { id: 'archer', name: 'Archer', points: { STR: 1, VIT: 2, AGI: 2, DEX: 4, LUK: 1 }, skills: ['Aimed Shot', 'Poison Dart', 'Second Wind'] },
]);

const normal = name => String(name ?? '').replace(/\(\s*lv\.?\s*\d+\s*\)\s*$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The library entry with this name (case, spacing and punctuation ignored), or null. */
export function findSkill(library, name) {
    const key = normal(name);
    if (!key) return null;
    return (library ?? []).find(entry => normal(entry?.name) === key) ?? null;
}

/** Whether these stats meet a skill's requirements; `missing` gives the points still needed per stat. */
export function canLearn(stats, skill) {
    const missing = {};
    for (const [stat, need] of Object.entries(skill?.requires ?? {})) {
        const have = Number(stats?.[stat]) || 0;
        if (have < need) missing[stat] = need - have;
    }
    return { ok: Object.keys(missing).length === 0, missing };
}

const defaultTarget = type => (type === 'heal' ? 'ally' : type === 'buff' ? 'self' : 'one');

// Healing and buffs can only land on your own side, harm only on the other, so a template's
// target is folded onto the side its type works on ('one' on a heal means one ally).
function fitTarget(type, target) {
    const friendly = type === 'heal' || type === 'buff';
    if (!TARGETS.includes(target)) return defaultTarget(type);
    if (friendly && target === 'one') return 'ally';
    if (friendly && target === 'all') return 'allies';
    if (!friendly && (target === 'ally' || target === 'self')) return 'one';
    if (!friendly && target === 'allies') return 'all';
    return target;
}

/**
 * A story-taught skill built from a template: the numbers come from rules.templates for its
 * type and target, scaled to the learner's level so a skill learned late is not a dud.
 */
export function skillFromTemplate({ name, type, stat, target } = {}, level = 1, rules = DEFAULT_RULES) {
    const t = rules.templates ?? DEFAULT_RULES.templates;
    const kind = TYPES.includes(type) ? type : 'physical';
    const where = fitTarget(kind, target);
    const wide = where === 'all' || where === 'allies';
    const base = t[kind];
    const lv = Math.max(1, Number(level) || 1);
    const power = base.power * (wide ? t.widePower : 1) * Math.min(t.maxLevelPower, 1 + (lv - 1) * t.powerPerLevel);
    const mp = Math.round((base.mp + (lv - 1) * t.mpPerLevel) * (wide ? t.wideMp : 1));
    const effect = base.effect ? { ...base.effect } : null;
    const fallbackStat = kind === 'physical' ? 'STR' : kind === 'buff' || kind === 'debuff' ? 'CHA' : 'INT';
    return {
        name: String(name ?? '').trim() || 'Technique',
        tier: lv >= t.tier3Level ? 3 : lv >= t.tier2Level ? 2 : 1,
        type: kind,
        stat: STATS.includes(stat) ? stat : fallbackStat,
        power: Math.round(power * 100) / 100,
        mp,
        cooldown: base.cooldown + (wide ? 1 : 0),
        target: where,
        effect,
        requires: null,
        description: `A ${kind} technique learned in the story.`,
    };
}

/** A skill's power at a mastery level: +masteryPowerPerLevel for each level above 1. */
export function effectivePower(skill, mastery = 1, rules = DEFAULT_RULES) {
    const level = Math.min(rules.masteryMax, Math.max(1, Math.round(Number(mastery) || 1)));
    return (Number(skill?.power) || 0) * (1 + (level - 1) * rules.masteryPowerPerLevel);
}

/**
 * The sheet's skill entries ([{ name, mastery }] or names) as full skills with their mastery.
 * A name the library lacks becomes a template skill (physical, STR, one unless the entry says
 * otherwise), so a hand-typed skill still works in a fight.
 */
export function resolveSkills(entries, library = DEFAULT_SKILLS, level = 1, rules = DEFAULT_RULES) {
    const out = [];
    for (const entry of entries ?? []) {
        const name = typeof entry === 'string' ? entry : entry?.name;
        if (!String(name ?? '').trim()) continue;
        const found = findSkill(library, name);
        const base = found
            ? structuredClone(found)
            : skillFromTemplate({ name, type: entry?.type ?? 'physical', stat: entry?.stat ?? 'STR', target: entry?.target ?? 'one' }, level, rules);
        const mastery = Math.min(rules.masteryMax, Math.max(1, Math.round(Number(entry?.mastery) || 1)));
        out.push({ ...base, mastery });
    }
    return out;
}
