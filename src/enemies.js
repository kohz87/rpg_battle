// Enemies: the bestiary of named creatures, the rank × role projection that gives any name the
// story invents its numbers (DESIGN §7), and the loot an enemy leaves behind.
//
// A name not in the bestiary keeps its name and gets its numbers from the row's rank and role,
// so the story's bog wight stays a bog wight. Every individual varies a little from the seed,
// and every number comes from the rules object.
//
// A world with its own terms (terms.js) picks an enemy's power as a level or a tier instead of
// F–SSS; that level is placed on the same tuned rank table by interpolating between the two
// ranks whose levels bracket it (rankRowForLevel), so "Soul Class II" is as hard as the table
// says a level-11 foe should be, and F–SSS keep working unchanged. Pure.

import { DEFAULT_RULES, RANKS, RARITIES } from './rules.js';
import { creatureSkill, findSkill, skillFromTemplate } from './skills.js';

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

// `coins`: whether it carries money (carriesCoin): people do, beasts and the dead do not, and
// 'boss' only as a boss (a wyvern on its hoard).
const beast = (name, rank, role, skills, loot, extra = {}) => ({ name, rank, role, talks: false, coins: false, morale: 2, fleesBelow: 0.25, skills, loot, ...extra });
const person = (name, rank, role, morale, skills, loot, extra = {}) => ({ name, rank, role, talks: true, coins: true, morale, fleesBelow: 0.3, skills, loot, ...extra });

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
    { name: 'Wraith', rank: 'D', role: 'caster', talks: false, coins: false, morale: 9, fleesBelow: 0, skills: ['Chill Touch', 'Shadow Bolt'], loot: 'spirit' },
    person('Cult Priest', 'D', 'support', 6, ['Dark Mending', 'Hex'], 'cultist'),
    person('Orc Warrior', 'D', 'brute', 5, ['Smash'], 'orc', { aliases: ['Orc'] }),
    person('Ogre', 'C', 'brute', 6, ['Smash', 'Stomp'], 'giant', { fleesBelow: 0.2 }),
    beast('Troll', 'C', 'tank', ['Regenerate', 'Claw'], 'troll', { fleesBelow: 0.15, morale: 6 }),
    { name: 'Wight', rank: 'C', role: 'caster', talks: true, coins: false, morale: 9, fleesBelow: 0, skills: ['Chill Touch', 'Dark Nova'], loot: 'spirit' },
    beast('Wyvern', 'C', 'skirmisher', ['Venom Bite', 'Claw'], 'wyvern', { coins: 'boss' }),
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

// The made-up kinds (templates.js) that carry coin: people, their leaders and casters. A
// drake that is a boss sits on a hoard; beasts, insects, oozes, plants, constructs, spirits,
// the dead and the plain fallback carry none.
const COIN_TEMPLATES = ['humanoid', 'leader', 'caster'];

/**
 * Whether a foe carries money (0.4.2): a wolf drops pelts and fangs, not silver. A creature's
 * own `coins` decides (true, false, or 'boss': only as a boss); else a made-up creature's
 * template (COIN_TEMPLATES, and a drake boss); else none. Takes a bestiary entry or a
 * projected enemy (which carries `coins`).
 */
export function carriesCoin(creature, { boss = false } = {}) {
    const coins = creature?.coins;
    const asBoss = Boolean(boss || creature?.boss);
    if (typeof coins === 'boolean') return coins;
    if (coins === 'boss') return asBoss;
    const template = creature?.template;
    if (template) return COIN_TEMPLATES.includes(template) || (template === 'drake' && asBoss);
    return false;
}

/**
 * The rank table's numbers at any level: { level, hp, attack, defence, xp, rank }, linear
 * between the two ranks whose levels bracket `level` (rank C is level 10 and B level 15, so a
 * level-11 foe is a fifth of the way from C to B). Below the lowest rank its numbers; above
 * the highest, the last step's slope goes on, so a cap past SSS's level still grows. `rank` is
 * the highest rank at or below the level, for what stays per rank (loot table, money, morale).
 */
export function rankRowForLevel(level, rules = DEFAULT_RULES) {
    const rows = RANKS.filter(rank => rules.ranks?.[rank]).map(rank => ({ rank, ...rules.ranks[rank] })).sort((a, b) => a.level - b.level);
    const lv = Math.max(1, Math.round(Number(level) || 1));
    const keys = ['hp', 'attack', 'defence', 'xp'];
    const blend = (a, b, t) => Object.fromEntries(keys.map(key => [key, a[key] + (b[key] - a[key]) * t]));
    let below = rows[0];
    for (const row of rows) if (row.level <= lv) below = row;
    if (lv <= rows[0].level || rows.length === 1) return { level: lv, ...blend(rows[0], rows[0], 0), rank: rows[0].rank };
    const index = rows.indexOf(below);
    const [a, b] = index < rows.length - 1 ? [below, rows[index + 1]] : [rows.at(-2), rows.at(-1)];
    const t = (lv - a.level) / (b.level - a.level);
    const out = blend(a, b, t);
    return { level: lv, ...out, xp: Math.round(out.xp), rank: below.rank };
}

const vary = (rng, amount) => (rng ? 1 + rng.between(-amount, amount) : 1);
const round = value => Math.max(0, Math.round(value));

// A bestiary entry's skill is a name (the library, then MONSTER_SKILLS), or for a creature made
// up on the fly (templates.js) a spec built at the level it is fought at.
function lookupSkill(name, library, level, rules) {
    if (name && typeof name === 'object') return { ...creatureSkill(name, level, rules), mastery: 1, cooldownLeft: 0 };
    const found = findSkill(library ?? [], name) ?? findSkill(MONSTER_SKILLS, name);
    const base = found ? structuredClone(found) : skillFromTemplate({ name, type: 'physical', stat: 'STR', target: 'one' }, level, rules);
    return { ...base, mastery: 1, cooldownLeft: 0 };
}

/**
 * A Combatant for an enemy row. A bestiary creature brings its role, skills, morale and loot
 * (its rank too, unless the row gives one); anything else is projected from rank × role. A
 * row `level` (a power in the reader's terms) wins over both ranks: its numbers come from
 * rankRowForLevel, and its `rank` is the one at or below that level. A creature made up on the
 * fly (templates.js) has a `level` of its own instead of a rank, used when the row gives no
 * power, skill specs instead of names, and its loot table inline; `generated` and `look` go
 * along onto the Combatant for the Battle tab.
 */
export function projectEnemy({ name, rank = null, level: rowLevel = null, role = null, boss = false } = {}, { bestiary = DEFAULT_BESTIARY, library = [], rules = DEFAULT_RULES, rng = null, id = 'e1' } = {}) {
    const entry = findCreature(bestiary, name);
    const ownLevel = !RANKS.includes(rank) && Number(entry?.level) >= 1 ? entry.level : null;
    const byLevel = Number(rowLevel) >= 1 ? rankRowForLevel(rowLevel, rules) : ownLevel ? rankRowForLevel(ownLevel, rules) : null;
    const useRank = byLevel ? byLevel.rank : RANKS.includes(rank) && rules.ranks[rank] ? rank : RANKS.includes(entry?.rank) ? entry.rank : 'F';
    const useRole = ROLES.includes(role) ? role : ROLES.includes(entry?.role) ? entry.role : 'brute';
    const r = byLevel ?? rules.ranks[useRank];
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
    if (boss && !names.some(skill => (typeof skill === 'string' ? skill : skill?.name) === SIGNATURE[useRole])) names.push(SIGNATURE[useRole]);
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
        loot: Array.isArray(entry?.loot) ? structuredClone(entry.loot) : entry?.loot ?? `rank-${useRank}`,
        coins: carriesCoin(entry, { boss }),
        gone: null,
        memberId: null,
        ...(entry?.generated ? { generated: true, look: String(entry.look ?? '') } : {}),
    };
}

function bumpRarity(rarity, steps) {
    const index = Math.max(0, RARITIES.indexOf(rarity ?? 'common'));
    return RARITIES[Math.min(RARITIES.length - 1, index + steps)];
}

/**
 * What one defeated enemy drops: items from its loot table (its own rows for a made-up
 * creature, else the table its id names, or its rank's default table) and
 * money in the smallest currency unit. Luck above the start stat raises drop chances, can lift
 * an equipment drop one rarity, and adds a little money. A foe that carries no coin
 * (`coins: false`, carriesCoin) drops no money but something of itself instead: its first
 * material is at least rules.loot.coinlessMaterial % likely. An enemy without `coins` (a fight
 * stored before 0.4.2) pays as before. The rolls are the same either way, so a seed's drops
 * stay put.
 */
export function rollLoot(enemy, { rng, luck = null, rules = DEFAULT_RULES, tables = LOOT_TABLES } = {}) {
    const l = rules.loot;
    // No luck given is the start stat's (Number(null) would be 0, an unlucky party).
    const lucky = (luck !== null && luck !== undefined && Number.isFinite(Number(luck)) ? Number(luck) : rules.character.startStat) - rules.character.startStat;
    const rank = RANKS.includes(enemy?.rank) ? enemy.rank : 'F';
    const table = Array.isArray(enemy?.loot) ? enemy.loot : tables[enemy?.loot] ?? tables[`rank-${rank}`] ?? [];
    const rolls = enemy?.boss ? l.bossRolls : 1;
    const coins = enemy?.coins !== false;
    const first = coins ? -1 : table.findIndex(row => row.kind === 'material');
    const items = [];
    for (let roll = 0; roll < rolls; roll++) {
        for (const [index, row] of table.entries()) {
            const base = index === first ? Math.max(row.chance, Number(l.coinlessMaterial) || 0) : row.chance;
            const chance = base * Math.max(0.5, 1 + lucky * l.luckChancePerPoint);
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
    // Rolled either way, so the rolls after it do not move.
    const rolled = rng.int(low, high);
    const money = !coins ? 0 : Math.max(0, Math.round(rolled * (enemy?.boss ? l.bossMoney : 1) * Math.max(0.5, 1 + lucky * l.luckMoneyPerPoint)));
    return { items, money };
}
