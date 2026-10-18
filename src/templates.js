// Creature templates: a monster the bestiary does not know, made up from its name (DESIGN §7.4).
//
// The story names foes the bestiary has never heard of ("a marsh wolf", "the bog wight's
// lantern-bearer"). Projected from rank × role alone they all fight alike: a Smash and a
// rank's loot table. So a name is read for what it is, by keyword (wolf → beast, wight →
// undead, golem → construct, shaman → caster, captain → a leader), and the matching template
// gives it a role, traits, a temperament, two or three skills of its kind and a loot table of
// its kind. Every number still comes from the rules: the role weights and the rank table set
// its numbers (projectEnemy), traits multiply them within bounds, skills are built by the
// skill machinery (skills.creatureSkill) at the level it is fought at, gear by the rarity
// budget. Words only change which of those knobs are turned, which is what makes a model's
// flavour (flavour.js) safe to take: it can rename and describe, never inflate.
//
// The result is an ordinary bestiary entry plus `generated: true`, kept in the chat (index.js)
// so the same name is the same creature next time. Generation is deterministic for the same
// name, level and seed. Pure.

import { DEFAULT_RULES, RANKS, RARITIES, STATS, rarityBudget } from './rules.js';
import { DEFAULT_BESTIARY, LOOT_TABLES, closeCreature, findCreature, rankRowForLevel } from './enemies.js';
import { HARMFUL_CONDITIONS, HELPFUL_CONDITIONS } from './skills.js';
import { makeRng } from './rng.js';

const ROLES = ['brute', 'skirmisher', 'caster', 'tank', 'support'];
const TYPES = ['physical', 'magic', 'heal', 'buff', 'debuff'];
const TARGETS = ['one', 'all', 'self', 'ally', 'allies'];

// Traits that only move numbers (their multipliers are rules.generated.traits), traits that
// put a condition on the creature's first harmful skill, and one that gives it a way to heal.
// `leader` comes from the name alone (captain, chief, matriarch…), never from flavour.
export const STAT_TRAITS = Object.freeze(['armoured', 'swift', 'slow', 'frail', 'hulking', 'fierce', 'leader']);
export const CONDITION_TRAITS = Object.freeze({ venomous: 'poison', fiery: 'burn', savage: 'bleed', chilling: 'slow' });
export const TRAITS = Object.freeze([...STAT_TRAITS, ...Object.keys(CONDITION_TRAITS), 'regenerating']);
export const TEMPERAMENTS = Object.freeze(['relentless', 'mindless', 'disciplined', 'proud', 'cunning', 'wild', 'cowardly']);
// A creature is not both quick and slow, nor both frail and hulking: the first one named stays.
const OPPOSITES = [['swift', 'slow'], ['frail', 'hulking']];
// Beyond `leader`, at most this many traits, so a description cannot pile them up.
const MAX_TRAITS = 3;
const MAX_SKILLS = 4;
const MAX_LOOT = 6;
const MAX_NAME = 48;

const move = (name, type, target, effect, cooldown, stat, description) => Object.freeze({
    name, type, stat: stat ?? (type === 'physical' ? 'STR' : type === 'debuff' ? 'CHA' : 'INT'), target, effect, cooldown, description,
});

/**
 * The templates. `skills`: the first is the creature's signature and always taken, the others
 * picked from the seed; `loot`: material name patterns ({name} the creature, {noun} its kind,
 * "Wolf") and at most one piece of gear with the stat it carries.
 */
export const TEMPLATES = Object.freeze({
    beast: {
        role: 'skirmisher', traits: ['swift'], talks: false, temperament: 'wild',
        skills: [
            move('Bite', 'physical', 'one', ['bleed'], 2, 'STR', 'Teeth that tear.'),
            move('Rend', 'physical', 'one', [], 1, 'STR', 'A raking swipe.'),
            move('Pounce', 'physical', 'one', ['stun'], 3, 'AGI', 'A leap that bowls its prey over.'),
            move('Howl', 'debuff', 'all', ['weaken'], 4, 'CHA', 'A howl that shakes resolve.'),
        ],
        loot: { materials: ['{name} Pelt', '{noun} Fang'], gear: { name: '{noun}-fang Charm', stat: 'ATK' } },
    },
    undead: {
        role: 'brute', traits: [], talks: false, temperament: 'mindless',
        skills: [
            move('Bone Claw', 'physical', 'one', ['weaken'], 2, 'STR', 'Cold claws that sap strength.'),
            move('Grave Chill', 'magic', 'one', ['slow'], 2, 'INT', 'The cold of the grave.'),
            move('Bone Ward', 'buff', 'self', ['shield'], 4, 'VIT', 'Bones knit into armour.'),
            move('Death Rattle', 'debuff', 'all', ['weaken'], 4, 'CHA', 'A rattle that chills the living.'),
        ],
        loot: { materials: ['Grave Dust', 'Old Bone'], gear: { name: 'Grave-iron Ring', stat: 'MDEF' } },
    },
    humanoid: {
        role: 'skirmisher', traits: [], talks: true, temperament: 'cunning',
        skills: [
            move('Quick Cut', 'physical', 'one', ['bleed'], 2, 'DEX', 'A fast, mean cut.'),
            move('Shield Shove', 'physical', 'one', ['stun'], 3, 'STR', 'A shove that knocks the wind out.'),
            move('Dirty Trick', 'debuff', 'one', ['weaken'], 3, 'DEX', 'Sand in the eyes.'),
            move('Heavy Swing', 'physical', 'one', [], 1, 'STR', 'A two-handed blow.'),
        ],
        loot: { materials: ['Worn Insignia', 'Whetstone'], gear: { name: '{noun}\'s Blade', stat: 'ATK' } },
    },
    leader: {
        role: 'brute', traits: ['leader'], talks: true, temperament: 'proud',
        skills: [
            move('Heavy Blow', 'physical', 'one', ['stun'], 3, 'STR', 'A blow that floors its target.'),
            move('Cleaving Sweep', 'physical', 'all', [], 2, 'STR', 'A swing through the whole line.'),
            move('Battle Cry', 'buff', 'allies', ['regen'], 4, 'CHA', 'A shout that steadies its own.'),
            move('Commanding Strike', 'physical', 'one', ['weaken'], 2, 'STR', 'A strike that breaks the guard.'),
        ],
        loot: { materials: ['Signet', 'Battle Standard Scrap'], gear: { name: '{name}\'s Sabre', stat: 'ATK' } },
    },
    caster: {
        role: 'caster', traits: [], talks: true, temperament: 'cunning',
        skills: [
            move('Dark Bolt', 'magic', 'one', [], 0, 'INT', 'A bolt of darkness.'),
            move('Hex', 'debuff', 'one', ['weaken'], 3, 'INT', 'A curse that weakens attacks.'),
            move('Fire Burst', 'magic', 'all', ['burn'], 3, 'INT', 'Fire bursts over every foe.'),
            move('Mending', 'heal', 'ally', [], 2, 'INT', 'Closes an ally\'s wounds.'),
        ],
        loot: { materials: ['Ritual Candle', 'Arcane Dust'], gear: { name: '{noun}\'s Focus', stat: 'MATK' } },
    },
    construct: {
        role: 'tank', traits: ['armoured', 'slow'], talks: false, temperament: 'mindless',
        skills: [
            move('Slam', 'physical', 'one', ['stun'], 3, 'STR', 'A blow like a falling wall.'),
            move('Grinding Sweep', 'physical', 'all', [], 2, 'STR', 'Stone arms sweep the line.'),
            move('Iron Guard', 'buff', 'self', ['guard'], 4, 'VIT', 'It locks itself shut.'),
            move('Crush', 'physical', 'one', [], 1, 'STR', 'A grinding grip.'),
        ],
        loot: { materials: ['Rune Shard', 'Iron Cog'], gear: { name: 'Plate Fragment', stat: 'DEF' } },
    },
    ooze: {
        role: 'tank', traits: ['slow'], talks: false, temperament: 'mindless',
        skills: [
            move('Engulf', 'physical', 'one', ['slow'], 2, 'STR', 'Sticky ooze that slows.'),
            move('Acid Splash', 'magic', 'one', ['burn'], 2, 'INT', 'Acid that keeps burning.'),
            move('Reform', 'buff', 'self', ['regen'], 4, 'VIT', 'It pulls itself back together.'),
        ],
        loot: { materials: ['{noun} Jelly', 'Acid Residue'], gear: null },
    },
    insect: {
        role: 'skirmisher', traits: ['venomous'], talks: false, temperament: 'wild',
        skills: [
            move('Sting', 'physical', 'one', ['poison'], 2, 'DEX', 'A barbed sting.'),
            move('Web Spit', 'debuff', 'one', ['slow'], 3, 'DEX', 'Sticky threads that slow.'),
            move('Mandible Snap', 'physical', 'one', [], 1, 'STR', 'Jaws that snap shut.'),
            move('Swarm', 'physical', 'all', [], 3, 'AGI', 'A skittering rush over everyone.'),
        ],
        loot: { materials: ['Chitin Plate', 'Venom Sac'], gear: { name: 'Chitin Bracer', stat: 'DEF' } },
    },
    drake: {
        role: 'brute', traits: ['armoured'], talks: false, temperament: 'proud',
        skills: [
            move('Fire Breath', 'magic', 'all', ['burn'], 3, 'INT', 'Flame over everyone in front of it.'),
            move('Tail Lash', 'physical', 'one', ['stun'], 3, 'STR', 'A tail like a club.'),
            move('Rending Bite', 'physical', 'one', ['bleed'], 2, 'STR', 'Teeth like knives.'),
            move('Scale Guard', 'buff', 'self', ['shield'], 4, 'VIT', 'It curls behind its scales.'),
        ],
        loot: { materials: ['{noun} Scale', '{noun} Tooth'], gear: { name: 'Scale Guard', stat: 'DEF' } },
    },
    spirit: {
        role: 'caster', traits: ['swift'], talks: false, temperament: 'relentless',
        skills: [
            move('Soul Chill', 'magic', 'one', ['weaken'], 2, 'INT', 'Cold that saps strength.'),
            move('Wail', 'debuff', 'all', ['slow'], 4, 'CHA', 'A wail that freezes the blood.'),
            move('Spirit Bolt', 'magic', 'one', [], 0, 'INT', 'A bolt of pale light.'),
            move('Fade', 'buff', 'self', ['shield'], 4, 'INT', 'It thins to mist.'),
        ],
        loot: { materials: ['Ectoplasm', 'Spirit Mote'], gear: { name: 'Ghostlight Ring', stat: 'MDEF' } },
    },
    plant: {
        role: 'tank', traits: ['slow'], talks: false, temperament: 'mindless',
        skills: [
            move('Vine Lash', 'physical', 'one', ['slow'], 2, 'STR', 'A lash that wraps and holds.'),
            move('Thorn Burst', 'physical', 'all', ['bleed'], 3, 'STR', 'Thorns fly in every direction.'),
            move('Root Mend', 'buff', 'self', ['regen'], 4, 'VIT', 'It drinks from the ground.'),
            move('Crushing Roots', 'physical', 'one', ['stun'], 3, 'STR', 'Roots heave up underfoot.'),
        ],
        loot: { materials: ['Heartwood', 'Thorn Cluster'], gear: { name: 'Barkskin Bracer', stat: 'DEF' } },
    },
    generic: {
        role: 'brute', traits: [], talks: false, temperament: 'wild',
        skills: [
            move('Heavy Blow', 'physical', 'one', [], 1, 'STR', 'A heavy, committed blow.'),
            move('Wild Swing', 'physical', 'all', [], 2, 'STR', 'A wide swing at everyone.'),
            move('Savage Strike', 'physical', 'one', ['bleed'], 2, 'STR', 'A strike that tears.'),
        ],
        loot: { materials: ['{noun} Trophy'], gear: null },
    },
});

export const TEMPLATE_IDS = Object.freeze(Object.keys(TEMPLATES));

// What a creature IS (its nature) outranks what it DOES (a profession): a skeleton archer is
// undead, a goblin shaman a caster. Among natures the last word wins, since an English name
// ends on its head noun (a bone golem is a construct, a spider queen an insect).
const NATURES = ['beast', 'undead', 'construct', 'ooze', 'insect', 'drake', 'spirit', 'plant'];
const KEYWORDS = {
    beast: ['wolf', 'hound', 'dog', 'jackal', 'boar', 'bear', 'cat', 'lion', 'tiger', 'panther', 'lynx', 'rat', 'bat', 'ape', 'bull', 'stag', 'elk', 'hyena', 'fox', 'badger', 'weasel', 'crocodile', 'croc', 'shark', 'serpent', 'snake', 'viper', 'eel', 'toad', 'frog', 'owl', 'hawk', 'eagle', 'raven', 'crow', 'vulture', 'beast', 'worg', 'warg', 'mastiff', 'gator', 'leopard', 'cougar', 'hog'],
    undead: ['ghoul', 'wight', 'skeleton', 'zombie', 'wraith', 'lich', 'revenant', 'mummy', 'vampire', 'draugr', 'corpse', 'undead', 'barrow', 'deathless', 'bones'],
    construct: ['golem', 'sentinel', 'automaton', 'construct', 'statue', 'gargoyle', 'colossus', 'clockwork', 'machine', 'armour', 'armor'],
    ooze: ['slime', 'ooze', 'jelly', 'blob', 'pudding', 'sludge', 'gel'],
    insect: ['spider', 'scorpion', 'beetle', 'wasp', 'ant', 'mantis', 'centipede', 'tick', 'locust', 'hornet', 'bee', 'moth', 'larva', 'worm', 'leech', 'crawler', 'insect'],
    drake: ['drake', 'wyvern', 'dragon', 'lizard', 'basilisk', 'wyrm', 'salamander', 'hydra', 'raptor', 'whelp'],
    spirit: ['spirit', 'ghost', 'wisp', 'elemental', 'shade', 'phantom', 'specter', 'spectre', 'banshee', 'poltergeist', 'apparition', 'djinn', 'wraithling'],
    plant: ['treant', 'vine', 'shambler', 'mandrake', 'fungus', 'mushroom', 'myconid', 'briar', 'creeper', 'bloom', 'thornling'],
    // Cultists cast in the shipped bestiary, so the word is a caster's.
    caster: ['shaman', 'witch', 'warlock', 'mage', 'wizard', 'sorcerer', 'sorceress', 'priest', 'priestess', 'druid', 'necromancer', 'cleric', 'oracle', 'seer', 'hexer', 'conjurer', 'enchanter', 'magus', 'summoner', 'acolyte', 'cultist'],
    humanoid: ['bandit', 'thug', 'soldier', 'guard', 'knight', 'brigand', 'raider', 'pirate', 'mercenary', 'sellsword', 'assassin', 'thief', 'rogue', 'warrior', 'fighter', 'hunter', 'archer', 'ranger', 'scout', 'goblin', 'hobgoblin', 'orc', 'kobold', 'gnoll', 'ogre', 'troll', 'giant', 'man', 'woman', 'elf', 'dwarf', 'highwayman', 'poacher', 'smuggler', 'zealot', 'duelist', 'berserker', 'gladiator', 'sentry', 'watchman', 'militia', 'legionnaire', 'footman', 'spearman', 'swordsman', 'cutthroat', 'ruffian', 'marauder', 'outlaw', 'deserter', 'slaver', 'inquisitor', 'paladin', 'templar'],
};
const LEADER_WORDS = new Set(['captain', 'chief', 'chieftain', 'boss', 'warlord', 'lord', 'king', 'queen', 'matriarch', 'patriarch', 'alpha', 'leader', 'commander', 'general', 'overlord', 'master', 'mistress', 'elder', 'prince', 'princess', 'baron', 'tyrant', 'champion', 'warchief', 'broodmother', 'sergeant']);
// A few kinds are bigger or tougher than their template's average.
const WORD_TRAITS = { ogre: ['hulking'], giant: ['hulking'], troll: ['hulking', 'regenerating'], colossus: ['hulking'], bear: ['hulking'], rat: ['frail'], bat: ['frail'], knight: ['armoured'], paladin: ['armoured'], templar: ['armoured'], sentinel: ['armoured'], dragon: ['hulking'], viper: ['venomous'], snake: ['venomous'], serpent: ['venomous'], scorpion: ['venomous'], spider: ['venomous'], wasp: ['venomous'], salamander: ['fiery'], berserker: ['fierce'], hydra: ['regenerating'] };
// Words that make a profession: an archer skirmishes, a knight holds the line.
const WORD_ROLES = { archer: 'skirmisher', ranger: 'skirmisher', scout: 'skirmisher', assassin: 'skirmisher', thief: 'skirmisher', knight: 'tank', guard: 'tank', sentry: 'tank', paladin: 'tank', templar: 'tank', berserker: 'brute', ogre: 'brute', troll: 'brute', giant: 'brute', priest: 'support', priestess: 'support', cleric: 'support', druid: 'support' };

const KEYWORD_INDEX = new Map(Object.entries(KEYWORDS).flatMap(([id, words]) => words.map(word => [word, id])));

const key = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const wordsOf = name => String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
const titleCase = text => String(text ?? '').replace(/(^|[\s-])([a-z])/g, (_, gap, letter) => gap + letter.toUpperCase());
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** A word and the singulars it may stand for ("wolves" → wolf, "golems" → golem). */
function forms(word) {
    const out = [word];
    if (word.endsWith('ves')) out.push(`${word.slice(0, -3)}f`, `${word.slice(0, -3)}fe`);
    if (word.endsWith('ies')) out.push(`${word.slice(0, -3)}y`);
    if (word.endsWith('men')) out.push(`${word.slice(0, -3)}man`);
    if (word.endsWith('es')) out.push(word.slice(0, -2));
    if (word.endsWith('s') && !word.endsWith('ss')) out.push(word.slice(0, -1));
    return out;
}

/** The keyword a word is, also as a plural or at the end of a compound ("hellhound" → hound). */
function keywordOf(word) {
    for (const form of forms(word)) {
        if (KEYWORD_INDEX.has(form)) return form;
        if (LEADER_WORDS.has(form)) return form;
    }
    // Compounds only on longer keywords: "werewolf", "hellhound", "stonegolem"; never "pirate" → rat.
    for (const form of forms(word)) {
        for (const keyword of KEYWORD_INDEX.keys()) {
            if (keyword.length >= 4 && form.length > keyword.length + 1 && form.endsWith(keyword)) return keyword;
        }
    }
    return null;
}

/**
 * The singular of a word that is the plural of a creature word ("wights" → 'wight',
 * "wolves" → 'wolf', "hellhounds" → 'hellhound'), or null (already singular, or no creature
 * word). story.parseEncounter uses it so "3 bog wights" makes one Bog Wight, three times.
 */
export function creatureSingular(word) {
    const lower = String(word ?? '').toLowerCase();
    if (!/^[a-z]+$/.test(lower) || KEYWORD_INDEX.has(lower) || LEADER_WORDS.has(lower)) return null;
    return forms(lower).slice(1).find(form => keywordOf(form) !== null) ?? null;
}

/**
 * What a name says about a creature: { template, noun, leader, role, traits }. `noun` is the
 * word that chose the template ("Wolf" for "Wolf Matriarch"), `role` one a profession word
 * implies (null: the template's), `traits` the ones its words bring (an ogre is hulking).
 */
export function classify(name) {
    const words = wordsOf(name);
    let nature = null;
    let profession = null;
    let leader = false;
    let role = null;
    const traits = [];
    for (const word of words) {
        const keyword = keywordOf(word);
        if (!keyword) continue;
        if (LEADER_WORDS.has(keyword)) {
            leader = true;
            continue;
        }
        const id = KEYWORD_INDEX.get(keyword);
        if (NATURES.includes(id)) nature = { id, keyword };
        // A caster word beats a race word ("goblin shaman"); otherwise the last one counts.
        else if (!(profession?.id === 'caster' && id === 'humanoid')) profession = { id, keyword };
        if (WORD_ROLES[keyword]) role = WORD_ROLES[keyword];
        for (const trait of WORD_TRAITS[keyword] ?? []) if (!traits.includes(trait)) traits.push(trait);
    }
    let template = nature?.id ?? profession?.id ?? (leader ? 'leader' : 'generic');
    if (template === 'humanoid' && leader) template = 'leader';
    // A caster under a nature ("skeleton mage") casts; a leader's role is its template's.
    if (nature && profession?.id === 'caster') role = role ?? 'caster';
    if (template === 'leader') role = null;
    const nounWord = (nature ?? profession)?.keyword ?? words.at(-1) ?? 'creature';
    return { template, noun: titleCase(nounWord), leader, role, traits };
}

/** The template id a name picks: 'beast', 'undead', 'humanoid', 'leader', …, 'generic'. */
export function templateFor(name) {
    return classify(name).template;
}

// ---------------------------------------------------------------------------------------
// Building a creature

/** Traits cleaned: known ones only, opposites resolved (first wins), at most MAX_TRAITS plus leader. */
export function cleanTraits(list) {
    const out = [];
    for (const raw of list ?? []) {
        const trait = String(raw ?? '').toLowerCase();
        if (!TRAITS.includes(trait) || out.includes(trait)) continue;
        if (OPPOSITES.some(pair => pair.includes(trait) && pair.some(other => other !== trait && out.includes(other)))) continue;
        out.push(trait);
    }
    const leader = out.includes('leader');
    return [...out.filter(trait => trait !== 'leader').slice(0, MAX_TRAITS), ...(leader ? ['leader'] : [])];
}

/** The stat multipliers of a set of traits, each within rules.generated's bounds. */
export function traitMods(traits, rules = DEFAULT_RULES) {
    const g = rules.generated ?? DEFAULT_RULES.generated;
    const mods = { hp: 1, attack: 1, defence: 1, agi: 1 };
    for (const trait of traits ?? []) {
        for (const [stat, factor] of Object.entries(g.traits?.[trait] ?? {})) {
            if (stat in mods && Number.isFinite(Number(factor))) mods[stat] *= Number(factor);
        }
    }
    return Object.fromEntries(Object.entries(mods).map(([stat, value]) => [stat, Math.round(clamp(value, g.modMin, g.modMax) * 100) / 100]));
}

/** A skill spec cleaned: a short name, a known type, target and conditions, a bounded cooldown. */
function cleanMove(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name ?? '').replace(/[\r\n|<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return null;
    const type = TYPES.includes(raw.type) ? raw.type : 'physical';
    const effect = (Array.isArray(raw.effect) ? raw.effect : Object.keys(raw.effect ?? {}))
        .map(entry => String(entry).toLowerCase())
        .filter(entry => HARMFUL_CONDITIONS.includes(entry) || HELPFUL_CONDITIONS.includes(entry));
    return {
        name,
        type,
        stat: STATS.includes(raw.stat) ? raw.stat : type === 'physical' ? 'STR' : 'INT',
        target: TARGETS.includes(raw.target) ? raw.target : 'one',
        effect: [...new Set(effect)].slice(0, 2),
        cooldown: clamp(Math.round(Number(raw.cooldown) || 0), 0, 6),
        description: String(raw.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    };
}

/**
 * The skills a creature fights with: its moves, with each condition trait's condition put
 * first on its first harmful skill (a venomous creature's bite poisons), and `regenerating`
 * adding a self-heal over time (in place of the last move when it already has three).
 */
function skillsFor(moves, traits) {
    const skills = moves.map(entry => ({ ...entry, effect: [...entry.effect] }));
    for (const [trait, condition] of Object.entries(CONDITION_TRAITS)) {
        if (!traits.includes(trait)) continue;
        const harmful = skills.find(skill => skill.type === 'physical' || skill.type === 'magic');
        if (harmful && !harmful.effect.includes(condition)) harmful.effect = [condition, ...harmful.effect].slice(0, 2);
    }
    if (traits.includes('regenerating') && !skills.some(skill => skill.effect.includes('regen'))) {
        const regrowth = { name: 'Regrowth', type: 'buff', stat: 'VIT', target: 'self', effect: ['regen'], cooldown: 4, description: 'Its wounds close as you watch.' };
        if (skills.length >= 3) skills[skills.length - 1] = regrowth;
        else skills.push(regrowth);
    }
    return skills;
}

const fill = (pattern, name, noun) => String(pattern).replace(/\{name\}/g, name).replace(/\{noun\}/g, noun).replace(/\s+/g, ' ').trim();

function rarityIndex(rarity) {
    return Math.max(0, RARITIES.indexOf(rarity));
}

/** The gear rarity a creature of this rank drops (rules.generated.gearRarity). */
export function gearRarityFor(rank, rules = DEFAULT_RULES) {
    const table = (rules.generated ?? DEFAULT_RULES.generated).gearRarity ?? {};
    return RARITIES.includes(table[rank]) ? table[rank] : 'common';
}

/** A gear stat's value: the rarity's budget at the level, × gearBudgetShare, over the stat's cost. */
export function gearValue(stat, rarity, level, rules = DEFAULT_RULES) {
    const g = rules.generated ?? DEFAULT_RULES.generated;
    const cost = Number(rules.statCost?.[stat]) || 1;
    return Math.max(1, Math.round((rarityBudget(rarity, level, rules) * (Number(g.gearBudgetShare) || 0.75)) / cost));
}

/** The creature's loot table: its materials, perhaps one piece of gear, and its rank's potion. */
function lootFor(template, { name, noun, rank, level }, rules) {
    const g = rules.generated ?? DEFAULT_RULES.generated;
    const chances = Array.isArray(g.materialChance) ? g.materialChance : [55, 30];
    const rows = template.loot.materials.map((pattern, index) => ({
        name: fill(pattern, name, noun),
        chance: chances[Math.min(index, chances.length - 1)],
        qty: index === 0 ? [1, 2] : [1, 1],
        kind: 'material',
    }));
    if (template.loot.gear) {
        const rarity = gearRarityFor(rank, rules);
        const stat = template.loot.gear.stat;
        rows.push({ name: fill(template.loot.gear.name, name, noun), chance: g.gearChance, qty: [1, 1], kind: 'equipment', rarity, stats: { [stat]: gearValue(stat, rarity, level, rules) } });
    }
    const potion = (LOOT_TABLES[`rank-${rank}`] ?? []).find(row => row.kind === 'consumable');
    if (potion) rows.push({ ...structuredClone(potion), chance: g.potionChance });
    return rows;
}

/**
 * Morale, flee threshold and multipliers for a creature's temperament and traits; a leader
 * stands firmer (rules.generated.leaderMorale, leaderFleesBelow).
 */
function temperamentNumbers(temperament, traits, rank, rules) {
    const g = rules.generated ?? DEFAULT_RULES.generated;
    const base = g.temperaments?.[temperament] ?? g.temperaments?.wild ?? { morale: 3, fleesBelow: 0.25 };
    const leader = traits.includes('leader');
    const morale = Math.round(Number(base.morale) + Math.max(0, RANKS.indexOf(rank)) * g.moralePerRank + (leader ? g.leaderMorale : 0));
    let fleesBelow = clamp(Number(base.fleesBelow) || 0, 0, 0.9);
    if (leader) fleesBelow = Math.min(fleesBelow, g.leaderFleesBelow);
    return { morale: clamp(morale, 0, 20), fleesBelow };
}

/**
 * An entry's numbers worked out again from its words: mods from its traits, morale and
 * fleesBelow from its temperament, skills from its moves and traits, its rank from its level.
 * Used after generation, after flavour and on import, so a stored entry can never carry
 * numbers its words do not give.
 */
export function finishCreature(entry, rules = DEFAULT_RULES) {
    const level = clamp(Math.round(Number(entry.level) || 1), 1, 999);
    const rank = rankRowForLevel(level, rules).rank;
    const traits = cleanTraits(entry.traits);
    const temperament = TEMPERAMENTS.includes(entry.temperament) ? entry.temperament : TEMPLATES[entry.template]?.temperament ?? 'wild';
    const moves = (entry.moves ?? []).map(cleanMove).filter(Boolean).slice(0, MAX_SKILLS);
    return {
        ...entry,
        level,
        rank,
        traits,
        temperament,
        ...temperamentNumbers(temperament, traits, rank, rules),
        mods: traitMods(traits, rules),
        moves,
        skills: skillsFor(moves, traits),
    };
}

/**
 * A bestiary entry for a name nobody has written up: the template its words pick, at
 * `level`, with 2 skills (3 from rules.generated.extraSkillLevel, and for a leader or a
 * boss), its kind's loot table, its traits and temperament. `role` (a row's) wins over the
 * template's. Deterministic: the same name, level and `seed` (or `rng`) give the same creature.
 * { name, generated: true, template, level, rank, role, talks, temperament, traits, morale,
 *   fleesBelow, mods, moves, skills, loot: [rows], look: '', flavoured: false }.
 */
export function generateCreature({ name, level = 1, role = null, boss = false } = {}, { rules = DEFAULT_RULES, rng = null, seed = '' } = {}) {
    const g = rules.generated ?? DEFAULT_RULES.generated;
    const shown = titleCase(String(name ?? '').replace(/[\r\n|<>#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)) || 'Creature';
    const lv = clamp(Math.round(Number(level) || 1), 1, 999);
    const random = rng ?? makeRng(`creature:${key(shown)}:${lv}:${seed}`);
    const info = classify(shown);
    const template = TEMPLATES[info.template];
    const count = Math.min(template.skills.length, 2 + (lv >= g.extraSkillLevel || info.leader || boss ? 1 : 0));
    // The signature move always; the rest from the seed, kept in the template's order.
    const pool = template.skills.slice(1).map((entry, index) => ({ entry, index, order: random.next() }));
    const picked = pool.sort((a, b) => a.order - b.order).slice(0, count - 1).sort((a, b) => a.index - b.index).map(({ entry }) => entry);
    const rank = rankRowForLevel(lv, rules).rank;
    return finishCreature({
        name: shown,
        generated: true,
        template: info.template,
        level: lv,
        rank,
        role: ROLES.includes(role) ? role : info.role ?? template.role,
        talks: template.talks,
        temperament: template.temperament,
        traits: [...template.traits, ...info.traits, ...(info.leader ? ['leader'] : [])],
        moves: [template.skills[0], ...picked].map(entry => ({ ...entry, effect: [...entry.effect] })),
        loot: lootFor(template, { name: shown, noun: info.noun, rank, level: lv }, rules),
        look: '',
        flavoured: false,
    }, rules);
}

// ---------------------------------------------------------------------------------------
// The chat's bestiary

/** A loot row cleaned: a known kind, a chance in 1–100, a small quantity, a known rarity. */
function cleanLootRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name ?? '').replace(/[\r\n|<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!name || !['material', 'consumable', 'equipment'].includes(raw.kind)) return null;
    const qty = Array.isArray(raw.qty) ? raw.qty.map(value => clamp(Math.round(Number(value) || 1), 1, 9)) : [1, 1];
    const row = { name, chance: clamp(Number(raw.chance) || 0, 1, 100), qty: [qty[0], Math.max(qty[0], qty[1] ?? qty[0])], kind: raw.kind };
    if (raw.rarity !== undefined) row.rarity = RARITIES.includes(raw.rarity) ? raw.rarity : 'common';
    if (raw.kind === 'equipment') {
        row.rarity = row.rarity ?? 'common';
        row.stats = Object.fromEntries(Object.entries(raw.stats ?? {}).filter(([stat, value]) => (stat in DEFAULT_RULES.statCost) && Number.isFinite(Number(value))).slice(0, 3).map(([stat, value]) => [stat, Math.round(Number(value))]));
        if (!Object.keys(row.stats).length) return null;
    }
    if (raw.kind === 'consumable') {
        const effect = String(raw.effect ?? '').trim();
        if (!/^(heal|mp|cure|fire|ice|holy|poison)\b/i.test(effect)) return null;
        row.effect = effect.slice(0, 60);
        row.rarity = row.rarity ?? 'common';
    }
    return row;
}

/**
 * A stored or imported bestiary entry made safe: a name, a known template, role and level,
 * clean moves and loot, a short look, and every number worked out again from its words
 * (finishCreature). Gear stats are kept as written, since equipping caps them by rarity
 * anyway. Null when it has no name.
 */
export function cleanCreature(raw, rules = DEFAULT_RULES) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name ?? '').replace(/[\r\n|<>#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!name) return null;
    const template = TEMPLATE_IDS.includes(raw.template) ? raw.template : classify(name).template;
    const moves = (Array.isArray(raw.moves) ? raw.moves : Array.isArray(raw.skills) ? raw.skills.filter(entry => entry && typeof entry === 'object') : []).map(cleanMove).filter(Boolean);
    const loot = (Array.isArray(raw.loot) ? raw.loot : []).map(cleanLootRow).filter(Boolean).slice(0, MAX_LOOT);
    const level = clamp(Math.round(Number(raw.level) || 1), 1, 999);
    return finishCreature({
        name,
        generated: true,
        template,
        level,
        role: ROLES.includes(raw.role) ? raw.role : TEMPLATES[template].role,
        talks: typeof raw.talks === 'boolean' ? raw.talks : TEMPLATES[template].talks,
        temperament: raw.temperament,
        traits: Array.isArray(raw.traits) ? raw.traits : [],
        moves: moves.length ? moves : TEMPLATES[template].skills.slice(0, 2),
        // No usable loot written: its kind's table, as if it had been made up here.
        loot: loot.length ? loot : lootFor(TEMPLATES[template], { name, noun: classify(name).noun, rank: rankRowForLevel(level, rules).rank, level }, rules),
        look: String(raw.look ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
        flavoured: Boolean(raw.flavoured),
    }, rules);
}

/**
 * Where a name's creature comes from, in order: the chat's own bestiary (made up earlier in
 * this story, or imported), then the shipped one. { entry, source: 'chat' | 'default' } or
 * null (a name to make up).
 */
export function lookupCreature(name, chatBestiary = [], defaults = DEFAULT_BESTIARY) {
    const own = findCreature(chatBestiary ?? [], name, { close: false });
    if (own) return { entry: own, source: 'chat' };
    const shipped = findCreature(defaults ?? DEFAULT_BESTIARY, name, { close: false });
    if (shipped) return { entry: shipped, source: 'default' };
    // Then (0.5.1) the closest differently worded one over both, the story's first on a tie:
    // "young wolf" is the Wolf, "wolf matriarch" the story's Grey Wolf Matriarch.
    const close = closeCreature(combinedBestiary(chatBestiary, defaults), name);
    if (!close) return null;
    return { entry: close, source: (chatBestiary ?? []).includes(close) ? 'chat' : 'default' };
}

/** The bestiary a fight looks names up in: the chat's creatures before the shipped ones. */
export function combinedBestiary(chatBestiary = [], defaults = DEFAULT_BESTIARY) {
    return [...(chatBestiary ?? []), ...(defaults ?? DEFAULT_BESTIARY)];
}

/**
 * The creatures a fight's rows need made up: one per name neither bestiary knows (the first
 * row with that name sets its level and role), generated at the row's `level`. Rows are
 * resolved setup rows ({ name, level, role, boss }, level already a number).
 */
export function creaturesToMake(rows, { chatBestiary = [], defaults = DEFAULT_BESTIARY, rules = DEFAULT_RULES, seed = '' } = {}) {
    const made = [];
    for (const row of rows ?? []) {
        const name = String(row?.name ?? '').trim();
        if (!name || lookupCreature(name, chatBestiary, defaults) || findCreature(made, name)) continue;
        made.push(generateCreature({ name, level: row.level, role: row.role || null, boss: Boolean(row.boss) }, { rules, seed }));
    }
    return made;
}

/** The chat's bestiary with `entries` put in (replacing any of the same name), newest last, at most `max`. */
export function storeCreatures(chatBestiary, entries, max = 200) {
    const incoming = (entries ?? []).filter(Boolean);
    const kept = (chatBestiary ?? []).filter(entry => !incoming.some(other => key(other.name) === key(entry.name)));
    return [...kept, ...incoming].slice(-max);
}
