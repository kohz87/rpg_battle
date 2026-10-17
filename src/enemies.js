// Enemies: the bestiary of named creatures, the rank × role projection that gives any name the
// story invents its numbers (DESIGN §7), and the loot an enemy leaves behind.
//
// A name not in the bestiary keeps its name and gets its numbers from the row's rank and role,
// so the story's bog wight stays a bog wight. Every individual varies a little from the seed,
// and every number comes from the rules object. Pure.

import { DEFAULT_RULES, RANKS, RARITIES } from './rules.js';
import { findSkill, skillFromTemplate } from './skills.js';

const ROLES = ['brute', 'skirmisher', 'caster', 'tank', 'support'];

const monster = (name, type, stat, power, mp, cooldown, target, effect, description) =>
    Object.freeze({ name, tier: 1, type, stat, power, mp, cooldown, target, effect, requires: null, description });

/**
 * Skills only monsters use. They are looked up after the player library so the starter list
 * the reader picks from stays free of "Bite" and "Web".
 */
export const MONSTER_SKILLS = Object.freeze([
    monster('Bite', 'physical', 'STR', 1.3, 0, 2, 'one', { bleed: 2 }, 'Teeth that tear.'),
    monster('Claw', 'physical', 'STR', 1.2, 0, 1, 'one', null, 'A raking swipe.'),
    monster('Smash', 'physical', 'STR', 1.6, 0, 2, 'one', null, 'A crushing overhead blow.'),
    monster('Venom Bite', 'physical', 'STR', 1, 0, 2, 'one', { poison: 3 }, 'A poisoned bite.'),
    monster('Stomp', 'physical', 'STR', 0.8, 0, 4, 'all', { stun: 1 }, 'The ground shakes under every foe.'),
    monster('Engulf', 'physical', 'STR', 1.1, 0, 2, 'one', { slow: 2 }, 'Sticky ooze that slows.'),
    monster('Spark', 'magic', 'INT', 1.2, 3, 0, 'one', null, 'A crackling spark.'),
    monster('Shadow Bolt', 'magic', 'INT', 1.5, 5, 1, 'one', null, 'A bolt of darkness.'),
    monster('Acid Spit', 'magic', 'INT', 1, 4, 2, 'one', { burn: 2 }, 'Acid that keeps burning.'),
    monster('Chill Touch', 'magic', 'INT', 1.2, 4, 2, 'one', { weaken: 2 }, 'Cold that saps strength.'),
    monster('Hex', 'debuff', 'INT', 0, 4, 2, 'one', { weaken: 2 }, 'A curse that weakens attacks.'),
    monster('Web', 'debuff', 'DEX', 0, 3, 3, 'one', { slow: 2 }, 'Sticky threads that slow.'),
    monster('Howl', 'debuff', 'CHA', 0, 0, 4, 'all', { weaken: 1 }, 'A howl that shakes resolve.'),
    monster('Dark Mending', 'heal', 'INT', 1.6, 5, 1, 'ally', null, 'Unholy healing for an ally.'),
    monster('Bone Shield', 'buff', 'VIT', 1, 4, 4, 'self', { shield: 3 }, 'Bones knit into armour.'),
    monster('Regenerate', 'buff', 'VIT', 1, 0, 4, 'self', { regen: 3 }, 'Flesh closes over wounds.'),
    // Boss signatures, one per role.
    monster('Crushing Blow', 'physical', 'STR', 2.2, 0, 3, 'one', { stun: 1 }, 'A blow that floors its target.'),
    monster('Flurry', 'physical', 'DEX', 0.9, 0, 3, 'all', { bleed: 2 }, 'A storm of cuts.'),
    monster('Dark Nova', 'magic', 'INT', 1, 8, 3, 'all', null, 'Darkness bursts over everyone.'),
    monster('Bulwark', 'buff', 'VIT', 2, 0, 4, 'self', { shield: 3, guard: 1 }, 'An impenetrable stance.'),
    monster('Blessing of Night', 'heal', 'INT', 1.2, 8, 3, 'allies', { regen: 2 }, 'Heals every ally.'),
]);

const SIGNATURE = { brute: 'Crushing Blow', skirmisher: 'Flurry', caster: 'Dark Nova', tank: 'Bulwark', support: 'Blessing of Night' };
// What a projected (unknown) enemy can do, so a caster casts and a support heals.
const ROLE_SKILLS = { brute: ['Smash'], skirmisher: ['Claw'], caster: ['Spark'], tank: ['Bone Shield'], support: ['Dark Mending', 'Hex'] };

const beast = (name, rank, role, skills, loot, extra = {}) => ({ name, rank, role, talks: false, morale: 2, fleesBelow: 0.25, skills, loot, ...extra });
const person = (name, rank, role, morale, skills, loot, extra = {}) => ({ name, rank, role, talks: true, morale, fleesBelow: 0.3, skills, loot, ...extra });

export const DEFAULT_BESTIARY = Object.freeze([
    beast('Giant Rat', 'F', 'skirmisher', ['Bite'], 'vermin', { aliases: ['Rat', 'Sewer Rat'] }),
    beast('Slime', 'F', 'tank', ['Engulf'], 'slime', { aliases: ['Ooze'], fleesBelow: 0, morale: 1 }),
    person('Goblin', 'F', 'skirmisher', 3, ['Claw'], 'goblin', { aliases: ['Goblin Scout'] }),
    beast('Wolf', 'F', 'skirmisher', ['Bite'], 'beast', { aliases: ['Grey Wolf'] }),
    person('Kobold', 'F', 'brute', 2, ['Smash'], 'goblin'),
    person('Goblin Shaman', 'E', 'caster', 4, ['Hex', 'Spark'], 'goblin-caster'),
    person('Bandit', 'E', 'skirmisher', 4, ['Quick Stab'], 'bandit', { aliases: ['Brigand', 'Highwayman'] }),
    beast('Skeleton', 'E', 'tank', ['Bone Shield'], 'undead', { aliases: ['Skeleton Warrior'], fleesBelow: 0, morale: 9 }),
    person('Cultist', 'E', 'caster', 5, ['Shadow Bolt'], 'cultist', { aliases: ['Acolyte'] }),
    beast('Giant Spider', 'E', 'skirmisher', ['Venom Bite', 'Web'], 'spider', { aliases: ['Spider'] }),
    beast('Dire Wolf', 'D', 'brute', ['Bite', 'Howl'], 'beast-large'),
    person('Bandit Captain', 'D', 'brute', 6, ['Power Strike', 'Intimidate'], 'bandit-leader'),
    beast('Bear', 'D', 'brute', ['Claw', 'Smash'], 'beast-large', { aliases: ['Brown Bear', 'Cave Bear'] }),
    { name: 'Wraith', rank: 'D', role: 'caster', talks: false, morale: 9, fleesBelow: 0, skills: ['Chill Touch', 'Shadow Bolt'], loot: 'spirit' },
    person('Cult Priest', 'D', 'support', 6, ['Dark Mending', 'Hex'], 'cultist'),
    person('Orc Warrior', 'D', 'brute', 5, ['Smash'], 'orc', { aliases: ['Orc'] }),
    person('Ogre', 'C', 'brute', 6, ['Smash', 'Stomp'], 'giant', { fleesBelow: 0.2 }),
    beast('Troll', 'C', 'tank', ['Regenerate', 'Claw'], 'troll', { fleesBelow: 0.15, morale: 6 }),
    { name: 'Wight', rank: 'C', role: 'caster', talks: true, morale: 9, fleesBelow: 0, skills: ['Chill Touch', 'Dark Nova'], loot: 'spirit' },
    beast('Wyvern', 'C', 'skirmisher', ['Venom Bite', 'Claw'], 'wyvern'),
]);

const drop = (name, chance, qty, kind, extra = {}) => ({ name, chance, qty, kind, ...extra });
const gear = (name, chance, rarity, stats) => ({ name, chance, qty: [1, 1], kind: 'equipment', rarity, stats });
const potion = (name, chance, effect, qty = [1, 1]) => ({ name, chance, qty, kind: 'consumable', rarity: 'common', effect });

// Consumable `effect` is the inventory note the item is used by ("heal 30"), so a looted
// potion is usable in the next fight as soon as it is written into the Inventory block.
const RANK_TABLES = {
    F: [drop('Scrap Hide', 40, [1, 2], 'material'), potion('Minor Healing Draught', 15, 'heal 20')],
    E: [drop('Worn Leather', 35, [1, 2], 'material'), potion('Healing Draught', 15, 'heal 30'), gear('Iron Dagger', 6, 'common', { ATK: 3 })],
    D: [drop('Tough Hide', 35, [1, 2], 'material'), potion('Healing Draught', 20, 'heal 30'), potion('Mana Tonic', 10, 'mp 20'), gear('Steel Blade', 6, 'uncommon', { ATK: 6, DEX: 1 })],
    C: [drop('Fine Pelt', 35, [1, 2], 'material'), potion('Greater Healing Draught', 20, 'heal 60'), potion('Mana Tonic', 15, 'mp 20'), gear('Knight\'s Shield', 6, 'rare', { DEF: 8, MDEF: 3 })],
    B: [drop('Rare Essence', 30, [1, 2], 'material'), potion('Greater Healing Draught', 25, 'heal 60'), gear('Runed Mail', 6, 'rare', { DEF: 12, HP: 20 })],
    A: [drop('Dragonbone Shard', 30, [1, 2], 'material'), potion('Elixir', 20, 'heal 120'), gear('Starsteel Sword', 6, 'epic', { ATK: 20, crit: 4 })],
    S: [drop('Star Crystal', 30, [1, 2], 'material'), potion('Elixir', 25, 'heal 120'), gear('Aegis Charm', 6, 'epic', { DEF: 10, MDEF: 10, VIT: 2 })],
    SS: [drop('Primordial Ash', 30, [1, 2], 'material'), potion('Grand Elixir', 25, 'heal 250'), gear('Crown of Embers', 6, 'legendary', { MATK: 30, INT: 4 })],
    SSS: [drop('Godsblood', 30, [1, 2], 'material'), potion('Grand Elixir', 30, 'heal 250'), gear('Worldsplitter', 6, 'legendary', { ATK: 45, STR: 4 })],
};

export const LOOT_TABLES = Object.freeze({
    ...Object.fromEntries(Object.entries(RANK_TABLES).map(([rank, table]) => [`rank-${rank}`, table])),
    vermin: [drop('Rat Tail', 60, [1, 2], 'material'), drop('Gnawed Bone', 25, [1, 1], 'material')],
    slime: [drop('Slime Jelly', 70, [1, 3], 'material'), potion('Antidote', 10, 'cure poison')],
    goblin: [drop('Goblin Ear', 50, [1, 1], 'material'), drop('Bone Fetish', 20, [1, 1], 'material'), potion('Minor Healing Draught', 15, 'heal 20'), gear('Rusty Dagger', 8, 'common', { ATK: 2 })],
    'goblin-caster': [drop('Bone Fetish', 60, [1, 1], 'material'), potion('Mana Tonic', 20, 'mp 20'), gear('Shaman\'s Charm', 10, 'uncommon', { MATK: 3, INT: 1 })],
    beast: [drop('Wolf Pelt', 55, [1, 1], 'material'), drop('Fang', 40, [1, 2], 'material')],
    'beast-large': [drop('Thick Pelt', 60, [1, 1], 'material'), drop('Great Fang', 40, [1, 2], 'material'), potion('Healing Draught', 10, 'heal 30')],
    bandit: [potion('Healing Draught', 25, 'heal 30'), drop('Lockpick', 20, [1, 2], 'material'), gear('Bandit\'s Knife', 8, 'common', { ATK: 3 }), gear('Leather Jerkin', 6, 'common', { DEF: 3 })],
    'bandit-leader': [potion('Healing Draught', 50, 'heal 30', [1, 2]), drop('Stolen Signet', 30, [1, 1], 'material'), gear('Captain\'s Sabre', 20, 'uncommon', { ATK: 6, DEX: 1 }), gear('Studded Coat', 12, 'uncommon', { DEF: 6, HP: 10 })],
    undead: [drop('Old Bone', 60, [1, 3], 'material'), gear('Notched Shield', 8, 'common', { DEF: 3 })],
    cultist: [drop('Ritual Candle', 40, [1, 2], 'material'), potion('Mana Tonic', 20, 'mp 20'), potion('Ember Flask', 10, 'fire 25, all enemies'), gear('Cult Robe', 8, 'uncommon', { MDEF: 5, INT: 1 })],
    spider: [drop('Spider Silk', 60, [1, 3], 'material'), drop('Venom Sac', 30, [1, 1], 'material'), potion('Antidote', 15, 'cure poison')],
    spirit: [drop('Ectoplasm', 60, [1, 2], 'material'), potion('Mana Tonic', 20, 'mp 30'), gear('Grave Ring', 6, 'rare', { MDEF: 6, INT: 2 })],
    orc: [drop('Orc Tusk', 50, [1, 1], 'material'), potion('Healing Draught', 15, 'heal 30'), gear('Orcish Axe', 8, 'uncommon', { ATK: 8, AGI: -1 })],
    giant: [drop('Ogre Hide', 60, [1, 1], 'material'), potion('Greater Healing Draught', 20, 'heal 60'), gear('Giant\'s Club', 8, 'rare', { ATK: 12, AGI: -1 })],
    troll: [drop('Troll Blood', 60, [1, 2], 'material'), potion('Regeneration Tonic', 15, 'heal 60'), gear('Troll-hide Vest', 6, 'rare', { DEF: 8, HP: 25 })],
    wyvern: [drop('Wyvern Scale', 60, [1, 3], 'material'), drop('Venom Sac', 40, [1, 1], 'material'), gear('Scale Mail', 8, 'rare', { DEF: 10, AGI: -1 })],
});

const key = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// "Goblin 2", "Goblin #3" and "goblin (b)" are the second and third goblins of a row.
const baseName = name => key(String(name ?? '').replace(/\s*(#?\d+|\([a-z0-9]\)|\b[a-z]\b)\s*$/i, ''));

/** The bestiary entry for a name or alias (case-insensitive; a trailing row number ignored), or null. */
export function findCreature(bestiary, name) {
    const list = bestiary ?? DEFAULT_BESTIARY;
    for (const wanted of [key(name), baseName(name)]) {
        if (!wanted) continue;
        const hit = list.find(entry => key(entry.name) === wanted || (entry.aliases ?? []).some(alias => key(alias) === wanted));
        if (hit) return hit;
    }
    return null;
}

const vary = (rng, amount) => (rng ? 1 + rng.between(-amount, amount) : 1);
const round = value => Math.max(0, Math.round(value));

function lookupSkill(name, library, level, rules) {
    const found = findSkill(library ?? [], name) ?? findSkill(MONSTER_SKILLS, name);
    const base = found ? structuredClone(found) : skillFromTemplate({ name, type: 'physical', stat: 'STR', target: 'one' }, level, rules);
    return { ...base, mastery: 1, cooldownLeft: 0 };
}

/**
 * A Combatant for an enemy row. A bestiary creature brings its role, skills, morale and loot
 * (its rank too, unless the row gives one); anything else is projected from rank × role.
 */
export function projectEnemy({ name, rank = null, role = null, boss = false } = {}, { bestiary = DEFAULT_BESTIARY, library = [], rules = DEFAULT_RULES, rng = null, id = 'e1' } = {}) {
    const entry = findCreature(bestiary, name);
    const useRank = RANKS.includes(rank) && rules.ranks[rank] ? rank : RANKS.includes(entry?.rank) ? entry.rank : 'F';
    const useRole = ROLES.includes(role) ? role : ROLES.includes(entry?.role) ? entry.role : 'brute';
    const r = rules.ranks[useRank];
    const w = rules.roles[useRole];
    const e = rules.enemy;
    const b = boss ? rules.boss : { hp: 1, attack: 1, defence: 1, xp: 1 };
    const mods = { hp: 1, attack: 1, defence: 1, agi: 1, ...(entry?.mods ?? {}) };
    const v = rules.variation;
    const level = r.level;

    const base = e.statBase + level * e.statPerLevel;
    const stats = {
        STR: round(base * w.attack * vary(rng, v)),
        VIT: round(base * w.defence),
        AGI: round(base * w.agi * mods.agi * vary(rng, v)),
        DEX: round(base * w.dex * vary(rng, v)),
        INT: round(base * w.magic),
        LUK: round(base * 0.8),
        CHA: round(base * 0.8),
    };
    const hpMax = Math.max(1, round(r.hp * w.hp * mods.hp * b.hp * vary(rng, v)));
    const attack = r.attack * mods.attack * b.attack * vary(rng, v);
    const defence = r.defence * mods.defence * b.defence * vary(rng, v);
    const mpMax = round((e.mpBase + level * e.mpPerLevel) * w.magic);
    const a = rules.attack;

    const names = entry?.skills?.length ? [...entry.skills] : [...(ROLE_SKILLS[useRole] ?? [])];
    if (boss && !names.includes(SIGNATURE[useRole])) names.push(SIGNATURE[useRole]);
    const rankIndex = RANKS.indexOf(useRank);

    return {
        id,
        name: String(name ?? '').trim() || entry?.name || 'Enemy',
        side: 'enemy',
        controller: 'auto',
        level,
        rank: useRank,
        role: useRole,
        boss: Boolean(boss),
        stats,
        hp: { cur: hpMax, max: hpMax },
        mp: { cur: mpMax, max: mpMax },
        patk: Math.max(1, round(attack * w.attack)),
        matk: Math.max(1, round(attack * w.magic)),
        pdef: round(defence * w.defence),
        mdef: round(defence * (w.defence + w.magic) / 2),
        crit: Math.min(a.critMax, a.critBase + stats.DEX * a.critPerDex + stats.LUK * a.critPerLuk * 0.5),
        skills: names.map(skillName => lookupSkill(skillName, library, level, rules)),
        items: [],
        conditions: [],
        morale: Number.isFinite(entry?.morale) ? entry.morale : e.moraleBase + rankIndex,
        talks: typeof entry?.talks === 'boolean' ? entry.talks : useRole === 'caster' || useRole === 'support',
        fleesBelow: boss ? 0 : Number.isFinite(entry?.fleesBelow) ? entry.fleesBelow : e.fleesBelow,
        xp: round(r.xp * b.xp),
        loot: entry?.loot ?? `rank-${useRank}`,
        gone: null,
        memberId: null,
    };
}

function bumpRarity(rarity, steps) {
    const index = Math.max(0, RARITIES.indexOf(rarity ?? 'common'));
    return RARITIES[Math.min(RARITIES.length - 1, index + steps)];
}

/**
 * What one defeated enemy drops: items from its loot table (or its rank's default table) and
 * money in the smallest currency unit. Luck above the start stat raises drop chances, can lift
 * an equipment drop one rarity, and adds a little money.
 */
export function rollLoot(enemy, { rng, luck = null, rules = DEFAULT_RULES, tables = LOOT_TABLES } = {}) {
    const l = rules.loot;
    const lucky = (Number.isFinite(Number(luck)) ? Number(luck) : rules.character.startStat) - rules.character.startStat;
    const rank = RANKS.includes(enemy?.rank) ? enemy.rank : 'F';
    const table = tables[enemy?.loot] ?? tables[`rank-${rank}`] ?? [];
    const rolls = enemy?.boss ? l.bossRolls : 1;
    const items = [];
    for (let roll = 0; roll < rolls; roll++) {
        for (const row of table) {
            const chance = row.chance * Math.max(0.5, 1 + lucky * l.luckChancePerPoint);
            if (!rng.chance(chance)) continue;
            const [lo, hi] = Array.isArray(row.qty) ? row.qty : [1, 1];
            let rarity = row.rarity ?? 'common';
            if (row.kind === 'equipment' && lucky > 0 && rng.chance(lucky * l.luckRarityPerPoint)) rarity = bumpRarity(rarity, 1);
            const item = { name: row.name, qty: rng.int(lo, hi), rarity, kind: row.kind, stats: { ...(row.stats ?? {}) } };
            if (row.effect) item.effect = row.effect;
            items.push(item);
        }
    }
    const [low, high] = rules.moneyByRank[rank] ?? [0, 0];
    const money = Math.max(0, Math.round(rng.int(low, high) * (enemy?.boss ? l.bossMoney : 1) * Math.max(0.5, 1 + lucky * l.luckMoneyPerPoint)));
    return { items, money };
}
