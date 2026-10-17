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
    // Equipped gear that counts beyond one weapon, off-hand and armour: worn pieces (head,
    // hands, feet, waist) and accessories (rings, amulets…). More equipped is listed, not used.
    gear: { worn: 1, accessories: 2 },
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
    // Tuned by tests/balance.test.js for the §7.1 target: one character against three enemies
    // of suggestRank(level) lasts 4–6 rounds and costs about half the character's HP. The
    // first draft (F 30/8/3 … SSS 1900/125/60) suited a full party; solo it was unwinnable
    // from rank D up.
    ranks: {
        F: { level: 1, hp: 20, attack: 14.5, defence: 4, xp: 15 },
        E: { level: 3, hp: 34, attack: 19, defence: 5, xp: 35 },
        D: { level: 6, hp: 41, attack: 22, defence: 7, xp: 70 },
        C: { level: 10, hp: 52, attack: 29.5, defence: 10, xp: 140 },
        B: { level: 15, hp: 70, attack: 38, defence: 13, xp: 280 },
        A: { level: 22, hp: 94, attack: 50, defence: 17, xp: 560 },
        S: { level: 32, hp: 128, attack: 68, defence: 23, xp: 1100 },
        SS: { level: 45, hp: 172, attack: 90, defence: 31, xp: 2200 },
        SSS: { level: 60, hp: 224, attack: 116, defence: 40, xp: 4500 },
    },
    roles: {
        brute: { hp: 1.3, attack: 1.2, defence: 1, agi: 0.7, dex: 0.9, magic: 0.5 },
        skirmisher: { hp: 0.8, attack: 1, defence: 0.9, agi: 1.4, dex: 1.3, magic: 0.5 },
        caster: { hp: 0.7, attack: 0.6, defence: 0.8, agi: 1, dex: 1, magic: 1.3 },
        tank: { hp: 1.4, attack: 0.7, defence: 1.6, agi: 0.7, dex: 0.9, magic: 0.5 },
        support: { hp: 0.9, attack: 0.7, defence: 1, agi: 1, dex: 1, magic: 1.2 },
    },
    boss: { hp: 3, attack: 1.2, defence: 1.2, xp: 3, noParleyAbove: 0.5 },
    variation: 0.1,
    // XP factor by (enemy level − member level): ×1.5 when it outranks, down to ×0.1.
    xp: { perLevelAbove: 0.1, maxFactor: 1.5, perLevelBelow: 0.15, minFactor: 0.1 },
    secondsPerRound: 6,
    // Out of a fight: a short rest gives back this share of max HP/MP; story time heals
    // `perHour` of max HP/MP per hour, and a gap of `longRestHours` or more is a full rest.
    recovery: { shortRestShare: 0.25, perHour: 0.05, longRestHours: 6 },
    // Story wounds (story.applyWounds): the share of max HP each word of a <Wounds> line takes
    // (or gives back, for a heal). The model only picks the word, never a number; a grievous
    // blow leaves someone at full HP with a fifth, so only an already hurt person goes down.
    wounds: { scratch: 0.1, wound: 0.3, severe: 0.5, grievous: 0.8 },
    // The State line (narrative.stateWords): [share of max, word], best first. HP at or above
    // a share gets that word (0 HP is "down"); MP below the last band is "drained", and an MP
    // word is shown as "<word> of magic". A max MP under `mpQuietBelow` is no caster's pool,
    // so their MP is never mentioned.
    narrative: {
        hpBands: [[0.9, 'unhurt'], [0.7, 'bruised'], [0.45, 'hurt'], [0.2, 'badly hurt'], [0.01, 'barely standing']],
        mpBands: [[0.6, 'fresh'], [0.25, 'tired']],
        mpQuietBelow: 10,
    },
    // How the fight resolves the things §5 leaves open (conditions, AI thresholds, safety stop).
    combat: {
        // Damage per tick of a damage-over-time condition, × the attack value of whoever applied it.
        dot: { poison: 0.2, burn: 0.25, bleed: 0.2 },
        // A condition carried in from the sheet has no source; it ticks for this share of max HP.
        dotMaxHpShare: 0.05,
        regen: 0.3,        // heal per tick, × the caster's skill value × power
        shield: 1,         // absorbed damage, × the caster's skill value × power
        weaken: 0.75,      // attack × this while weakened
        healBelow: 0.4,    // AI heals an ally under this HP share
        itemHealBelow: 0.3,
        nearDeath: 0.2,    // a party member at or under this HP share is a key moment
        maxRounds: 60,     // a fight that has not ended by then is broken off (never in practice)
    },
    // Numbers for enemies the rank table does not give directly.
    enemy: {
        statBase: 5, statPerLevel: 0.6,          // the seven stats, before role weights
        mpBase: 10, mpPerLevel: 3,               // × the role's magic weight
        moraleBase: 3,                           // + rank index
        fleesBelow: 0.25,
    },
    // Story-taught skills (skills.skillFromTemplate): numbers per type at level 1.
    templates: {
        physical: { power: 1.5, mp: 4, cooldown: 1, effect: null },
        magic: { power: 1.5, mp: 5, cooldown: 0, effect: null },
        heal: { power: 1.8, mp: 6, cooldown: 1, effect: null },
        buff: { power: 1, mp: 5, cooldown: 3, effect: { shield: 3 } },
        debuff: { power: 0, mp: 4, cooldown: 3, effect: { weaken: 2 } },
        widePower: 0.6, wideMp: 1.6,
        powerPerLevel: 0.02, maxLevelPower: 1.6, mpPerLevel: 0.5,
        tier2Level: 8, tier3Level: 16,
    },
    // Loot (enemies.rollLoot): how much each point of LUK above the start stat helps.
    loot: { luckChancePerPoint: 0.03, luckRarityPerPoint: 2, luckMoneyPerPoint: 0.02, bossMoney: 3, bossRolls: 2 },
    currency: {
        mode: 'tiers',
        // Smallest first; `rate` = how many of the previous unit make one of this.
        tiers: [{ name: 'copper', rate: 1 }, { name: 'silver', rate: 10 }, { name: 'gold', rate: 10 }],
        single: 'coins',
        row: 'Coins',
    },
    // Display terms (terms.js, DESIGN §5.7): what the reader's world calls levels and XP, optional
    // tier titles ({ size, numerals: 'roman' | 'arabic' }: levels 1–10 are "<levelName> I"…)
    // and a level cap (null: character.maxLevel). Words only; no number above depends on them.
    terms: { levelName: 'Level', xpName: 'XP', tiers: null, cap: null },
    // Threat words in an <Encounter> (story.threatLevel): how far a foe the story calls "weak"
    // or "deadly" sits from the party's level, in steps. A step is one tier when tier titles
    // are on (a world that counts in tiers means "a tier above" when it says strong), else
    // `step` levels, about the distance between two of the rank table's low ranks.
    threat: { step: 4, offsets: { trivial: -2, weak: -1, even: 0, strong: 1, deadly: 2 } },
    // Creatures made up on the fly (templates.js, DESIGN §7.4). The template picks the role,
    // skills and loot; these are the only numbers a trait or a temperament may change.
    generated: {
        // Multipliers a trait puts on the projected numbers (projectEnemy's `mods`).
        traits: {
            armoured: { defence: 1.3, agi: 0.9 },
            swift: { agi: 1.35, hp: 0.9 },
            slow: { agi: 0.7, defence: 1.1 },
            frail: { hp: 0.75, defence: 0.85 },
            hulking: { hp: 1.3, agi: 0.8 },
            fierce: { attack: 1.15, defence: 0.9 },
            leader: { hp: 1.15, attack: 1.1 },
        },
        // Stacked traits multiply, within these bounds: three traits never make a foe twice as tough.
        modMin: 0.6,
        modMax: 1.5,
        // Morale (against the party's CHA in a parley) and the HP share at which it flees.
        temperaments: {
            relentless: { morale: 9, fleesBelow: 0 },
            mindless: { morale: 9, fleesBelow: 0 },
            disciplined: { morale: 6, fleesBelow: 0.15 },
            proud: { morale: 6, fleesBelow: 0.15 },
            cunning: { morale: 4, fleesBelow: 0.3 },
            wild: { morale: 2, fleesBelow: 0.25 },
            cowardly: { morale: 1, fleesBelow: 0.4 },
        },
        moralePerRank: 0.5,   // + rank index × this: a foe from higher up is harder to talk down
        leaderMorale: 2,      // + for a leader, who also flees no sooner than `leaderFleesBelow`
        leaderFleesBelow: 0.1,
        // Rounds of each condition a generated skill applies.
        effectRounds: { poison: 3, burn: 2, bleed: 2, stun: 1, slow: 2, weaken: 2, shield: 3, regen: 3, guard: 2 },
        // skillFromTemplate is tuned for players, who pay MP; a monster's skill is × this (and a
        // physical one costs no MP, like the bestiary's). Lower than the bestiary's skills because
        // a made-up creature has two or three in rotation; tuned by tests/balance.test.js so an
        // even fight against made-up foes costs about what one against projected foes does.
        skillPower: 0.65,
        stunCooldown: 3,      // a skill that stuns waits at least this long
        extraSkillLevel: 8,   // a third skill from this level, and always for leaders and bosses
        // Loot: drop chances in %, and the gear rarity a creature of each rank drops (a
        // flavoured rarity may go at most one step above it).
        materialChance: [55, 30],
        gearChance: 8,
        potionChance: 12,
        gearBudgetShare: 0.75, // gear stats: this share of the rarity's budget at the creature's level
        gearRarity: { F: 'common', E: 'common', D: 'uncommon', C: 'uncommon', B: 'rare', A: 'rare', S: 'epic', SS: 'epic', SSS: 'legendary' },
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
