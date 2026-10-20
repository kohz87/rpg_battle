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
        // (0.5.14) The highest a stat can be raised with points (0: no cap). Gear adds on top.
        statCap: 99,
        starterSkills: 3,
        // Skills a member fights with; more are kept, set aside, and swapped in by hand.
        activeSkills: 6,
        // XP to reach the next level = round10(xpBase × level ^ xpExponent). (0.5.2) Every level
        // needs the same 100 by default (exponent 0); a rules.json may set a curve again (it
        // was 1.5 before). Every XP gain is a share of this, so a curve keeps working.
        xpBase: 100,
        xpExponent: 0,
        maxLevel: 99,
    },
    derived: {
        hpBase: 30, hpPerVit: 8, hpPerLevel: 4,
        mpBase: 10, mpPerInt: 4, mpPerLevel: 2,
        // (0.5.29) Stamina, what physical skills cost: from VIT and STR, as MP is from INT;
        // (0.5.30) and AGI, a little (running and footwork tire too): VIT most, then STR, then AGI.
        spBase: 10, spPerVit: 2, spPerStr: 1, spPerAgi: 0.5, spPerLevel: 2,
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
        // (0.5.29) Defending is also catching one's breath: this share of max stamina back.
        defendSpBack: 0.15,
    },
    initiative: { perAgi: 2, perDex: 1, die: 6 },
    // (0.5.14) Turns: 'timeline' (each fighter acts every 100 ÷ (AGI + speedOffset) of fight
    // time, so the faster act more often) or 'rounds' (everyone once a round, by initiative).
    turns: { mode: 'timeline', speedOffset: 10 },
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
    // (0.5.34) Crafting (craft.js): the piece is the best material's rarity, one step up when
    // `bumpAt` or more of the materials are of it; at most `maxStats` stats from their affinities.
    craft: { bumpAt: 3, maxStats: 2 },
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
    // Fight XP (combat.foeXpWorth): a defeated foe is worth `even` (a tenth) of the XP the
    // member's next level needs, × its band's factor (0.5.3): the level gap (foe − member), in
    // plain levels, picks the first band whose `from` it reaches, else `below`. The rank
    // table's `xp` no longer counts in a fight.
    xp: {
        even: 0.10,
        bands: [
            { from: 8, threat: 'deadly', factor: 4 },
            { from: 4, threat: 'strong', factor: 2 },
            { from: -3, threat: 'even', factor: 1 },
            { from: -7, threat: 'weak', factor: 0.5 },
        ],
        below: { threat: 'trivial', factor: 0.25 },
    },
    secondsPerRound: 6,
    // XP the story awards outside fights (growth.js): a share of the XP the member needs for
    // their next level, by how big the achievement was, or by the difficulty of a quest Story
    // Director closed. Everyone in the party gets it, each at their own level.
    xpAwards: { minor: 0.10, major: 0.25, milestone: 0.50 },
    questXp: { easy: 0.05, normal: 0.10, hard: 0.15, nightmare: 0.25 },
    // (0.5.2) The reader's XP rate (the setting): every XP gain, each foe's in a fight or a
    // parley (combat.foeXpWorth), a story award's and a quest's (scaleXp), is multiplied by
    // it, within XP_RATE.min–max.
    xpRate: 1,
    // Out of a fight: a short rest gives back this share of max HP/MP; story time heals
    // `perHour` of max HP/MP per hour, and a gap of `longRestHours` or more is a full rest.
    // (0.5.29) Stamina comes back faster: `spPerHour` of max per hour of story time (a whole hour
    // fills it), and any rest fills it.
    recovery: { shortRestShare: 0.25, perHour: 0.05, longRestHours: 6, spPerHour: 1 },
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
        // (0.5.29) Stamina in words, below the first band only: "breathing hard", then "winded".
        spBands: [[0.5, 'fresh'], [0.2, 'breathing hard']],
    },
    // How the fight resolves the things §5 leaves open (conditions, AI thresholds, safety stop).
    combat: {
        // Damage per tick of a damage-over-time condition, × the attack value of whoever applied it.
        dot: { poison: 0.2, burn: 0.25, bleed: 0.2 },
        // A condition carried in from the sheet has no source; it ticks for this share of max HP.
        dotMaxHpShare: 0.05,
        regen: 0.3,        // heal per tick, × the caster's skill value × power
        spPerTurn: 0.05,   // (0.5.29) stamina back at the start of each of one's turns, × max (at least 1)
        shield: 1,         // absorbed damage, × the caster's skill value × power
        weaken: 0.75,      // attack × this while weakened
        healBelow: 0.4,    // AI heals an ally under this HP share
        itemHealBelow: 0.3,
        nearDeath: 0.2,    // a party member at or under this HP share is a key moment
        // (0.5.33) What an element on worn gear (weapon, off-hand, accessory) does: fire, poison
        // and ice a chance (%) on each physical hit to burn, poison or slow, for so many rounds;
        // holy more damage (×) against the undead and spirits.
        gearEffects: { chance: 25, fire: { burn: 2 }, poison: { poison: 3 }, ice: { slow: 2 }, holy: 1.25 },
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
        // An element (fire, ice, lightning, poison) puts its condition on a harmful skill's hit
        // (generated.effectRounds rounds) for this share of its power.
        elementPower: 0.85,
    },
    // Loot (enemies.rollLoot): how much each point of LUK above the start stat helps, and (0.4.2)
    // how likely a foe that carries no coin is to leave its first material instead, in %.
    loot: { luckChancePerPoint: 0.03, luckRarityPerPoint: 2, luckMoneyPerPoint: 0.02, bossMoney: 3, bossRolls: 2, coinlessMaterial: 85 },
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
    // (0.5.2) A word that would put the foe below level 1 (weak or trivial for a low party)
    // keeps level 1 and scales the foe down instead (story.threatPower): HP, attack and XP ×
    // perLevelBelowOne per level short of 1 (counted in `step` levels, so a tier step is the
    // same distance), never below minScale. Weak at level 1 (4 short) is ×0.6, trivial ×0.36.
    threat: { step: 4, offsets: { trivial: -2, weak: -1, even: 0, strong: 1, deadly: 2 }, perLevelBelowOne: 0.88, minScale: 0.35 },
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
    // (0.5.37) The Trade tab (trade.js): what things are worth, in the smallest coin, and how the
    // place and the one trading change it. Every price is the code's; the story only tells it.
    trade: {
        sellRate: 0.5,      // a buyer pays this share of a thing's worth
        craftFee: 0.3,      // a crafter's labour: this share of the piece's worth
        // (0.5.44) How long a commission takes, in story hours, by the piece's rarity (from–to; the
        // day's own draw picks within), × the crafter's line and the place's craft factor below.
        craftHours: { common: [3, 6], uncommon: [18, 30], rare: [48, 72], epic: [144, 192], legendary: [288, 384] },
        craftLine: { specialist: 0.75, outside: 1.25 }, // in their own line (a smith's sword) faster, outside it slower
        material: { common: 3, uncommon: 30, rare: 120, epic: 500, legendary: 2000 },
        goods: 2,           // a plain thing (rope, a sack): worth this, × its rarity's factor
        gearPerPoint: 10,   // gear: this per point of its (capped) stat budget, × its rarity's factor
        rarityFactor: { common: 1, uncommon: 1.5, rare: 2.5, epic: 4, legendary: 7 },
        effect: { heal: 0.5, mp: 0.6, cure: 8, damage: 0.8 }, // a consumable: this per point of what it does
        // A place by the words of its name: what goods cost there (buy) and what is paid (sell);
        // (0.5.44) craft: × how long a commission takes there (a hamlet's carver is slower).
        areas: {
            remote: { craft: 1.3, buy: 0.85, sell: 0.75, words: ['hamlet', 'outpost', 'camp', 'frontier', 'wilds', 'waystation', 'ruins', 'steading', 'homestead', 'farmstead'] },
            village: { craft: 1.15, buy: 0.9, sell: 0.85, words: ['village', 'farm', 'mill', 'manor', 'crossing', 'ford', 'landing'] },
            town: { craft: 1, buy: 1, sell: 1, words: ['town', 'market', 'port', 'harbour', 'harbor', 'docks', 'quay', 'fort', 'keep'] },
            city: { craft: 0.9, buy: 1.2, sell: 1.15, words: ['city', 'metropolis', 'citadel'] },
            capital: { craft: 0.85, buy: 1.35, sell: 1.25, words: ['capital', 'royal', 'imperial', 'throne'] },
        },
        // The reader's word for a place (RPG Battle's settings, by place): × both.
        levels: { cheap: 0.8, fair: 1, dear: 1.25 },
        // (0.5.46) Where trade is open: a place with one of these words (a settlement, or somewhere
        // goods change hands), or someone present who trades (one of `traders` in their name or
        // trade: a peddler on the road). The wilds, a camp, ruins: no market.
        markets: ['hamlet', 'outpost', 'waystation', 'steading', 'homestead', 'farmstead', 'village', 'manor', 'landing', 'town', 'market', 'marketplace',
            'port', 'harbour', 'harbor', 'docks', 'quay', 'wharf', 'fort', 'keep', 'city', 'metropolis', 'citadel', 'capital', 'inn', 'tavern', 'guild',
            'bazaar', 'shop', 'store', 'square', 'emporium', 'caravanserai', 'trading post'],
        traders: ['merchant', 'trader', 'peddler', 'pedlar', 'hawker', 'vendor', 'tinker', 'caravan', 'shopkeeper', 'innkeeper', 'quartermaster', 'fence',
            'smuggler', 'broker', 'apothecary', 'alchemist', 'herbalist', 'smith', 'blacksmith', 'armourer', 'armorer', 'weaponsmith', 'fletcher', 'bowyer',
            'carver', 'bone-carver', 'tanner', 'leatherworker', 'jeweller', 'jeweler', 'tailor', 'artisan', 'crafter', 'cobbler', 'enchanter'],
        // Who trades, by the words of their name or trade: × what they pay, by the kind of thing.
        buyers: {
            general: { equipment: 1, consumable: 1, material: 1, goods: 1, words: ['merchant', 'trader', 'peddler', 'pedlar', 'shop', 'store', 'innkeeper', 'quartermaster'] },
            fence: { equipment: 0.6, consumable: 0.6, material: 0.6, goods: 0.6, words: ['fence', 'smuggler', 'pawn', 'broker', 'black market'] },
            guild: { equipment: 0.9, consumable: 0.9, material: 1.1, goods: 0.9, words: ['guild', 'clerk', 'board', 'factor', 'reeve', 'watch'] },
            apothecary: { equipment: 0.5, consumable: 1.3, material: 1.2, goods: 0.7, words: ['apothecary', 'alchemist', 'herbalist', 'healer', 'physician', 'chemist'] },
            smith: { equipment: 1.3, consumable: 0.4, material: 0.9, goods: 0.8, words: ['smith', 'blacksmith', 'armourer', 'armorer', 'weaponsmith', 'forge', 'fletcher', 'bowyer'] },
            crafter: { equipment: 0.8, consumable: 0.4, material: 1.3, goods: 0.8, words: ['carver', 'bone-carver', 'tanner', 'leatherworker', 'jeweller', 'jeweler', 'tailor', 'weaver', 'artisan', 'crafter', 'cobbler', 'enchanter'] },
        },
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

/** (0.5.29) Max stamina (SP): what physical skills cost, from VIT, STR and (0.5.30) AGI, and the level. */
export function maxSp(stats, level, rules = DEFAULT_RULES, bonus = 0) {
    const d = { ...DEFAULT_RULES.derived, ...(rules?.derived ?? {}) };
    return Math.max(0, Math.round(d.spBase + num(stats?.VIT) * d.spPerVit + num(stats?.STR) * d.spPerStr + num(stats?.AGI) * (d.spPerAgi ?? 0) + num(level, 1) * d.spPerLevel + num(bonus)));
}

/** (0.5.29) The pool a skill's cost comes from: stamina for a physical skill, MP for the rest. */
export function costPool(skill) {
    return skill?.type === 'physical' ? 'sp' : 'mp';
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

/** (0.5.14) The highest a stat can be raised with points: rules.character.statCap, Infinity at 0. */
export function statCap(rules = DEFAULT_RULES) {
    const cap = Math.round(num(rules?.character?.statCap, DEFAULT_RULES.character.statCap));
    return cap > 0 ? cap : Infinity;
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

/**
 * The levels one threat step spans (story.threatPower): rules.threat.step, 4 by default. Plain
 * levels always, never tiers (0.5.3): a strong foe is a few levels up, not a tier up.
 */
export function threatStep(rules = DEFAULT_RULES) {
    return Math.max(1, num(rules?.threat?.step, DEFAULT_RULES.threat.step) || DEFAULT_RULES.threat.step);
}

/**
 * (0.5.3) The threat a level gap (foe − member) is, in plain levels, by rules.xp.bands:
 * +8 or more deadly, +4 to +7 strong, −3 to +3 even, −4 to −7 weak, −8 or less trivial.
 */
export function threatForGap(gap, rules = DEFAULT_RULES) {
    const bands = rules?.xp?.bands ?? DEFAULT_RULES.xp.bands;
    const diff = Math.round(num(gap, 0));
    const band = bands.find(entry => diff >= entry.from);
    return band ? band.threat : (rules?.xp?.below?.threat ?? DEFAULT_RULES.xp.below.threat);
}

/**
 * (0.5.3) The level-gap factor of fight XP for a member of `memberLevel` defeating a foe of
 * `enemyLevel`: the band's, a fixed number per band (deadly ×4, strong ×2, even ×1, weak ×½,
 * trivial ×¼), so an even foe is 10, strong 20, deadly 40, weak 5 and trivial 3 at any level.
 */
export function xpFactor(memberLevel, enemyLevel, rules = DEFAULT_RULES) {
    const bands = rules?.xp?.bands ?? DEFAULT_RULES.xp.bands;
    const diff = Math.round(num(enemyLevel, 1) - num(memberLevel, 1));
    const band = bands.find(entry => diff >= entry.from);
    return band ? num(band.factor, 1) : num(rules?.xp?.below?.factor, DEFAULT_RULES.xp.below.factor);
}

/** The XP rate setting's bounds and step (0.5.2). */
export const XP_RATE = Object.freeze({ min: 0.25, max: 5, step: 0.05, default: 1 });

/** An XP rate as the setting allows it: within XP_RATE, on its step; anything unreadable is 1. */
export function clampXpRate(value) {
    const rate = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(rate)) return XP_RATE.default;
    const stepped = Math.round(rate / XP_RATE.step) * XP_RATE.step;
    return Math.round(clamp(stepped, XP_RATE.min, XP_RATE.max) * 100) / 100;
}

/**
 * An XP gain at the reader's rate (rules.xpRate): rounded, and at least 1 when the gain before
 * the rate was at least 1, so a slow rate never turns a gain into nothing.
 */
export function scaleXp(xp, rules = DEFAULT_RULES) {
    const base = Math.max(0, num(xp));
    const scaled = Math.round(base * clampXpRate(rules?.xpRate));
    return base >= 1 ? Math.max(1, scaled) : scaled;
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
