// The numbers: every constant of docs/DESIGN.md section 5 and the formulas built on them.
//
// `DEFAULT_RULES` is what ships; a rules.json the reader edits is merged over it with
// `makeRules(overrides)`. Every other module takes a rules object and never hardcodes a
// number this file owns. Pure.

export const STATS = Object.freeze(['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA']);
export const RARITIES = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);
export const RANKS = Object.freeze(['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS']);

export const DEFAULT_RULES = Object.freeze({
    version: 1,
    character: {
        startStat: 5,
        startPoints: 10,
        pointsPerLevel: 4,
        starterSkills: 3,
        // XP to reach the next level = round10(xpBase × level ^ xpExponent).
        xpBase: 100,
        xpExponent: 1.5,
        maxLevel: 99,
    },
    derived: {
        hpBase: 30, hpPerVit: 8, hpPerLevel: 4,
        mpBase: 10, mpPerInt: 4, mpPerLevel: 2,
        atkPerStr: 2, matkPerInt: 2,
    },
    checks: { pivot: 5, divisor: 2, min: -3, max: 10 },
    attack: {
        hitBase: 75, hitPerPoint: 3, hitMin: 5, hitMax: 95,
        critBase: 3, critPerDex: 0.5, critPerLuk: 1, critMax: 50, critMultiplier: 1.5,
        varianceLow: 0.9, varianceHigh: 1.1,
        defendTaken: 0.5, defendMpBack: 0.05,
    },
    initiative: { perAgi: 2, perDex: 1, die: 6 },
    flee: { base: 50, perAgi: 4, min: 10, max: 90, bossPenalty: 30 },
    parley: { base: 30, perPoint: 5, woundedBonus: 20, woundedBelow: 0.5, min: 5, max: 85, xpFactor: 0.5 },
    masteryMax: 5,
    masteryPowerPerLevel: 0.1,
    // Uses of a skill in fights to reach each next mastery level (index = current level).
    masteryUses: [0, 5, 12, 22, 35],
    rarityBudget: {
        common: { base: 2, perLevel: 0.5 },
        uncommon: { base: 4, perLevel: 0.8 },
        rare: { base: 6, perLevel: 1.2 },
        epic: { base: 9, perLevel: 1.6 },
        legendary: { base: 12, perLevel: 2 },
    },
    // Budget cost of one point of each item stat; negatives refund `negativeRefund` of it.
    statCost: { ATK: 1, MATK: 1, DEF: 1, MDEF: 1, HP: 0.2, MP: 0.25, STR: 2, VIT: 2, AGI: 2, DEX: 2, INT: 2, LUK: 2, CHA: 2, crit: 0.5 },
    negativeRefund: 0.5,
    ranks: {
        F: { level: 1, hp: 30, attack: 8, defence: 3, xp: 15 },
        E: { level: 3, hp: 55, attack: 12, defence: 5, xp: 35 },
        D: { level: 6, hp: 95, attack: 18, defence: 8, xp: 70 },
        C: { level: 10, hp: 160, attack: 26, defence: 12, xp: 140 },
        B: { level: 15, hp: 260, attack: 36, defence: 17, xp: 280 },
        A: { level: 22, hp: 420, attack: 50, defence: 24, xp: 560 },
        S: { level: 32, hp: 700, attack: 68, defence: 33, xp: 1100 },
        SS: { level: 45, hp: 1150, attack: 92, defence: 45, xp: 2200 },
        SSS: { level: 60, hp: 1900, attack: 125, defence: 60, xp: 4500 },
    },
    roles: {
        brute: { hp: 1.3, attack: 1.2, defence: 1, agi: 0.7, dex: 0.9, magic: 0.5 },
        skirmisher: { hp: 0.8, attack: 1, defence: 0.9, agi: 1.4, dex: 1.3, magic: 0.5 },
        caster: { hp: 0.7, attack: 0.6, defence: 0.8, agi: 1, dex: 1, magic: 1.5 },
        tank: { hp: 1.4, attack: 0.7, defence: 1.6, agi: 0.7, dex: 0.9, magic: 0.5 },
        support: { hp: 0.9, attack: 0.7, defence: 1, agi: 1, dex: 1, magic: 1.2 },
    },
    boss: { hp: 3, attack: 1.2, defence: 1.2, xp: 3, noParleyAbove: 0.5 },
    variation: 0.1,
    // XP factor by (enemy level − member level): ×1.5 when it outranks, down to ×0.1.
    xp: { perLevelAbove: 0.1, maxFactor: 1.5, perLevelBelow: 0.15, minFactor: 0.1 },
    secondsPerRound: 6,
    currency: {
        mode: 'tiers',
        // Smallest first; `rate` = how many of the previous unit make one of this.
        tiers: [{ name: 'copper', rate: 1 }, { name: 'silver', rate: 10 }, { name: 'gold', rate: 10 }],
        single: 'coins',
        row: 'Coins',
    },
    // Coins (in the smallest unit) a defeated enemy of each rank may drop.
    moneyByRank: { F: [2, 8], E: [5, 20], D: [15, 50], C: [40, 120], B: [100, 300], A: [250, 700], S: [600, 1600], SS: [1500, 4000], SSS: [4000, 10000] },
});

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

function merge(base, over) {
    if (!isObject(over)) return base;
    const out = { ...base };
    for (const [key, value] of Object.entries(over)) {
        out[key] = isObject(value) && isObject(base[key]) ? merge(base[key], value) : value;
    }
    return out;
}

/** DEFAULT_RULES with the reader's overrides merged in (objects deeply, arrays replaced). */
export function makeRules(overrides = null) {
    return merge(DEFAULT_RULES, overrides);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

export function maxHp(stats, level, rules = DEFAULT_RULES, bonus = 0) {
    const d = rules.derived;
    return Math.max(1, Math.round(d.hpBase + num(stats?.VIT) * d.hpPerVit + num(level, 1) * d.hpPerLevel + num(bonus)));
}

export function maxMp(stats, level, rules = DEFAULT_RULES, bonus = 0) {
    const d = rules.derived;
    return Math.max(0, Math.round(d.mpBase + num(stats?.INT) * d.mpPerInt + num(level, 1) * d.mpPerLevel + num(bonus)));
}

/**
 * Combat numbers from stats and gear bonuses ({ ATK, MATK, DEF, MDEF, crit, STR… }):
 * { patk, matk, pdef, mdef, crit } (crit in %).
 */
export function derive(stats, gear = {}, rules = DEFAULT_RULES) {
    const s = name => num(stats?.[name]) + num(gear?.[name]);
    const d = rules.derived;
    const a = rules.attack;
    return {
        patk: Math.round(s('STR') * d.atkPerStr + num(gear.ATK)),
        matk: Math.round(s('INT') * d.matkPerInt + num(gear.MATK)),
        pdef: Math.round(s('VIT') + num(gear.DEF)),
        mdef: Math.round((s('INT') + s('VIT')) / 2 + num(gear.MDEF)),
        crit: clamp(a.critBase + s('DEX') * a.critPerDex + s('LUK') * a.critPerLuk + num(gear.crit), 0, a.critMax),
    };
}

/** The bonus a stat gives to a roll outside combat: floor((stat − pivot) / divisor), bounded. */
export function checkModifier(stat, rules = DEFAULT_RULES) {
    const c = rules.checks;
    return clamp(Math.floor((num(stat) - c.pivot) / c.divisor), c.min, c.max);
}

/** { STR: 2, VIT: 1, … } for every stat. */
export function checkModifiers(stats, rules = DEFAULT_RULES) {
    return Object.fromEntries(STATS.map(name => [name, checkModifier(stats?.[name] ?? rules.character.startStat, rules)]));
}

/** XP needed to go from `level` to the next one. */
export function xpToNext(level, rules = DEFAULT_RULES) {
    const c = rules.character;
    return Math.max(10, Math.round((c.xpBase * Math.max(1, num(level, 1)) ** c.xpExponent) / 10) * 10);
}

/** Hit chance in % for an attack (spells use 100 and are not rolled). */
export function hitChance(attackerDex, targetAgi, rules = DEFAULT_RULES) {
    const a = rules.attack;
    return clamp(a.hitBase + (num(attackerDex) - num(targetAgi)) * a.hitPerPoint, a.hitMin, a.hitMax);
}

/** Damage before variance: raw² / (raw + defence), at least 1 (0 for a raw of 0). */
export function mitigate(raw, defence) {
    const r = Math.max(0, num(raw));
    if (r === 0) return 0;
    return Math.max(1, (r * r) / (r + Math.max(0, num(defence))));
}

/** XP factor for a member of `memberLevel` defeating an enemy of `enemyLevel`. */
export function xpFactor(memberLevel, enemyLevel, rules = DEFAULT_RULES) {
    const x = rules.xp;
    const diff = num(enemyLevel, 1) - num(memberLevel, 1);
    if (diff >= 0) return Math.min(x.maxFactor, 1 + diff * x.perLevelAbove);
    return Math.max(x.minFactor, 1 + diff * x.perLevelBelow);
}

/** The rank a fair enemy has for a party of this level. */
export function suggestRank(level, rules = DEFAULT_RULES) {
    let best = RANKS[0];
    for (const rank of RANKS) if (rules.ranks[rank] && rules.ranks[rank].level <= num(level, 1)) best = rank;
    return best;
}

/** Flee chance in % from average AGI on each side. */
export function fleeChance(partyAgi, enemyAgi, { boss = false } = {}, rules = DEFAULT_RULES) {
    const f = rules.flee;
    return clamp(f.base + (num(partyAgi) - num(enemyAgi)) * f.perAgi - (boss ? f.bossPenalty : 0), f.min, f.max);
}

/** Parley chance in % from CHA against morale, better against a wounded enemy. */
export function parleyChance(cha, morale, hpShare, rules = DEFAULT_RULES) {
    const p = rules.parley;
    const wounded = num(hpShare, 1) < p.woundedBelow ? p.woundedBonus : 0;
    return clamp(p.base + (num(cha) - num(morale)) * p.perPoint + wounded, p.min, p.max);
}

/** An item's stat budget for its rarity at a wearer's level. */
export function rarityBudget(rarity, level, rules = DEFAULT_RULES) {
    const entry = rules.rarityBudget[String(rarity ?? '').toLowerCase()] ?? rules.rarityBudget.common;
    return entry.base + entry.perLevel * Math.max(1, num(level, 1));
}
