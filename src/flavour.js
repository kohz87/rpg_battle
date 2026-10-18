// Flavour: one model call that dresses a made-up creature in the story's words (DESIGN §7.4).
//
// A template creature (templates.js) fights like its kind but reads like one: every marsh
// wolf bites and howls and drops a Wolf Fang. So when a new creature is made, the model is
// asked once, with the creature's name, power, template and the scene, for words only: how
// it looks, a few traits, whether it talks, its temperament, names for its skills with a few
// words each, and names for its loot. Code maps those words onto the template's knobs
// (known traits, conditions, targets and stat names only), renames the skills and the loot,
// and works every number out again from the rules (templates.finishCreature). Any number the
// model writes is dropped, and so is any word it does not know, so the worst a confused or
// creative answer can do is leave the template as it was. Pure: index.js makes the call.

import { DEFAULT_RULES, RARITIES } from './rules.js';
import { CONDITION_TRAITS, TEMPERAMENTS, TEMPLATES, cleanTraits, finishCreature, gearRarityFor, gearValue } from './templates.js';
import { HARMFUL_CONDITIONS, HELPFUL_CONDITIONS } from './skills.js';

const MAX_LOOK = 240;
const MAX_SKILL_NAME = 32;
const MAX_ITEM_NAME = 40;
const GEAR_STATS = ['ATK', 'MATK', 'DEF', 'MDEF', 'HP', 'MP', 'STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'];
// The traits a description may name; `leader` comes from the name alone.
const FLAVOUR_TRAITS = ['armoured', 'swift', 'slow', 'frail', 'hulking', 'fierce', ...Object.keys(CONDITION_TRAITS), 'regenerating'];

// Words a model is likely to use for each trait, temperament, condition and target.
const TRAIT_WORDS = {
    armoured: ['armoured', 'armored', 'plated', 'shelled', 'scaled', 'hard', 'tough-skinned', 'thick-skinned'],
    swift: ['swift', 'fast', 'quick', 'nimble', 'agile', 'darting'],
    slow: ['slow', 'sluggish', 'lumbering', 'ponderous', 'plodding'],
    frail: ['frail', 'fragile', 'brittle', 'scrawny', 'gaunt'],
    hulking: ['hulking', 'huge', 'massive', 'large', 'big', 'giant', 'towering', 'bulky', 'heavy'],
    fierce: ['fierce', 'ferocious', 'vicious', 'brutal', 'aggressive', 'savage-tempered'],
    venomous: ['venomous', 'poisonous', 'toxic', 'venom', 'poison'],
    fiery: ['fiery', 'burning', 'flaming', 'fire', 'molten'],
    savage: ['savage', 'bloodthirsty', 'rending', 'tearing'],
    chilling: ['chilling', 'icy', 'cold', 'frost', 'freezing', 'frozen'],
    regenerating: ['regenerating', 'regenerates', 'regeneration', 'self-healing', 'undying'],
};
const TEMPERAMENT_WORDS = {
    relentless: ['relentless', 'fearless', 'tireless', 'unyielding', 'implacable', 'unrelenting', 'never flees'],
    mindless: ['mindless', 'unthinking', 'hollow', 'empty'],
    disciplined: ['disciplined', 'loyal', 'steadfast', 'orderly', 'drilled'],
    proud: ['proud', 'arrogant', 'haughty', 'territorial', 'imperious'],
    cunning: ['cunning', 'sly', 'wary', 'cautious', 'calculating', 'clever', 'devious'],
    wild: ['wild', 'feral', 'hungry', 'skittish-but-hungry', 'predatory', 'savage'],
    cowardly: ['cowardly', 'timid', 'skittish', 'craven', 'fearful', 'nervous'],
};
const CONDITION_WORDS = {
    poison: ['poison', 'poisons', 'poisoned', 'poisoning', 'venom', 'venomous', 'toxic', 'toxin'],
    burn: ['burn', 'burns', 'burning', 'fire', 'flame', 'flames', 'scorch', 'scorching', 'acid'],
    bleed: ['bleed', 'bleeds', 'bleeding', 'tear', 'tears', 'rend', 'rends', 'lacerate', 'gash'],
    stun: ['stun', 'stuns', 'stunning', 'daze', 'dazes', 'stagger', 'staggers', 'knockdown', 'knock', 'paralyse', 'paralyze'],
    slow: ['slow', 'slows', 'grab', 'grabs', 'grip', 'grips', 'hold', 'holds', 'entangle', 'entangles', 'snare', 'snares', 'web', 'root', 'roots', 'drag', 'drown', 'chill', 'freeze'],
    weaken: ['weaken', 'weakens', 'weakening', 'sap', 'saps', 'drain', 'drains', 'enfeeble', 'curse', 'curses', 'terrify', 'fear'],
    shield: ['shield', 'shields', 'ward', 'wards', 'barrier', 'armour', 'armor'],
    regen: ['regen', 'regenerate', 'regenerates', 'regeneration', 'renew'],
    guard: ['guard', 'guards', 'brace', 'braces', 'block', 'blocks', 'defend'],
};
const HEAL_WORDS = ['heal', 'heals', 'healing', 'mend', 'mends', 'restore', 'restores', 'cure'];
const MAGIC_WORDS = ['magic', 'spell', 'bolt', 'arcane', 'shadow', 'lightning', 'psychic', 'sorcery', 'hex', 'beam', 'blast', 'breath'];
const DEBUFF_WORDS = ['debuff', 'curse', 'hex'];
const RARITY_WORDS = { common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic', legendary: 'legendary', unique: 'epic', fine: 'uncommon' };
// Money is the code's (rules.moneyByRank), so "300 gold" in the loot line is no item.
const MONEY_NAMES = /^(?:gold|silver|copper|coins?|money|crowns?|marks?|shillings?|pennies|pence)(?: (?:pieces?|coins?))?$/i;
const POTION_WORDS = /\b(?:potion|draught|elixir|tonic|salve|philter|philtre|vial|flask)\b/i;

const clean = value => String(value ?? '').normalize('NFKC').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
// Numbers are the code's, never the model's: every digit (and what hangs off it, "+5", "2d6") goes.
const noNumbers = text => clean(String(text ?? '').replace(/(?:[+\-−×]\s*)?\d+(?:[.,]\d+)?(?:\s*%|d\d+)?/gi, ' '));
const wordsOf = text => clean(text).toLowerCase().split(/[^a-z'-]+/).filter(Boolean);

/** "drowning grip" → "Drowning Grip"; letters, spaces, apostrophes and hyphens only. */
function tidyName(text, max) {
    const plain = noNumbers(text).replace(/[^\p{L}' -]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
    return plain.replace(/(^|[\s-])(\p{Ll})/gu, (_, gap, letter) => gap + letter.toUpperCase());
}

function lookup(table, words) {
    for (const [id, list] of Object.entries(table)) if (list.some(word => words.includes(word))) return id;
    return null;
}

// ---------------------------------------------------------------------------------------
// The prompt

/**
 * The system prompt: what to write, in fixed lines, with the words each line may use. The
 * lists are what code understands; a word outside them is simply ignored.
 */
export const FLAVOUR_SYSTEM = [
    'You describe one monster for a turn-based fight in an ongoing story. Code sets every number; you give words only, and never write a number.',
    'Answer with exactly these lines and nothing else:',
    'look: one sentence, how it looks and moves, fitting the scene',
    `traits: up to 3 of ${FLAVOUR_TRAITS.join(', ')}`,
    'talks: yes or no (can it be reasoned with in words?)',
    `temperament: one of ${TEMPERAMENTS.join(', ')}`,
    'skills: one per skill you are given, in the same order, as Name — a few words; separate them with ";". Words code understands: one foe, all foes, self, one ally, all allies, heal, magic, poison, burn, bleed, stun, slow, grab, weaken, shield, regen, guard',
    'loot: up to 3 items as name (rarity) or name (rarity, stat), separated by ","; rarity is common, uncommon or rare; stat is one of ATK, MATK, DEF, MDEF, HP, MP for something worn',
].join('\n');

/** A skill as the prompt shows it: "Bite (one foe, bleed)". */
function moveText(entry) {
    const target = { one: 'one foe', all: 'all foes', self: 'self', ally: 'one ally', allies: 'all allies' }[entry.target] ?? 'one foe';
    const kind = entry.type === 'physical' ? '' : `${entry.type}, `;
    return `${entry.name} (${kind}${[target, ...(entry.effect ?? [])].join(', ')})`;
}

/**
 * The two messages for one creature: [{ role: 'system', content }, { role: 'user', content }].
 * `power` is its power in the reader's terms ("Soul Class II", "Level 6"), `party` the party's
 * ("Soul Class I"), `scene` a few hundred words of the latest story (sceneText).
 */
export function flavourPrompt(entry, { power = '', party = '', scene = '' } = {}) {
    const template = TEMPLATES[entry?.template] ? entry.template : 'generic';
    const loot = (entry?.loot ?? []).filter(row => row.kind !== 'consumable').map(row => (row.kind === 'equipment' ? `${row.name} (${row.rarity}, ${Object.keys(row.stats ?? {})[0] ?? 'ATK'})` : row.name));
    const lines = [
        // (0.5.2) Kin of a creature the story has: its look should fit the family.
        `Creature: ${entry?.name ?? 'Creature'}${entry?.kin ? ` (a relative of the ${entry.kin}: make its look fit that kin)` : ''}`,
        power ? `Power: ${power}${party ? `; the party is ${party}` : ''}` : '',
        `Kind: ${template}, fights as a ${entry?.role ?? 'brute'}${entry?.traits?.length ? `; traits now ${entry.traits.filter(trait => trait !== 'leader').join(', ') || 'none'}` : ''}${entry?.traits?.includes('leader') ? '; it leads others' : ''}; temperament now ${entry?.temperament ?? 'wild'}; talks now ${entry?.talks ? 'yes' : 'no'}`,
        `Skills (${(entry?.moves ?? []).length}): ${(entry?.moves ?? []).map(moveText).join('; ')}`,
        loot.length ? `Loot now: ${loot.join(', ')}` : '',
        '',
        'The scene so far:',
        clean(scene) || '(no story yet)',
    ];
    return [
        { role: 'system', content: FLAVOUR_SYSTEM },
        { role: 'user', content: lines.filter((line, index) => line || index === 5).join('\n') },
    ];
}

/**
 * The latest story as plain prose for the prompt: [{ name, text }] oldest first, with HTML
 * comments (Story Block's hidden envelope) and tagged blocks taken out, cut to the last
 * `maxWords` words.
 */
export function sceneText(messages, maxWords = 300) {
    const text = (messages ?? []).map(message => {
        const body = String(message?.text ?? '')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<([A-Za-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g, ' ')
            .replace(/<[^>]+>/g, ' ');
        const said = clean(body);
        return said ? `${clean(message?.name) || 'Narrator'}: ${said}` : '';
    }).filter(Boolean).join('\n');
    const words = text.split(/ +/);
    return words.length > maxWords ? `… ${words.slice(-maxWords).join(' ')}` : text;
}

// ---------------------------------------------------------------------------------------
// Reading the answer

const KEYS = {
    look: /^(?:look|looks|appearance|description|desc)$/,
    traits: /^(?:traits?|features?)$/,
    talks: /^(?:talks?|speaks?|speech|can talk)$/,
    temperament: /^(?:temperament|temper|nature|behaviou?r|mood|attitude)$/,
    skills: /^(?:skills?|abilities|ability|moves?|attacks?)$/,
    loot: /^(?:loot|drops?|items?|treasure)$/,
};

const stripBullet = line => line.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '');

/** "Drowning Grip — grab, weaken" → { name, words }. */
function parseSkill(text) {
    const line = clean(stripBullet(text));
    if (!line) return null;
    const parts = line.match(/^(.+?)\s*(?:[—–]|--|\s-\s|:)\s*(.*)$/) ?? line.match(/^(.+?)\s*\((.*)\)\s*$/) ?? [null, line, ''];
    const name = tidyName(parts[1].replace(/\(.*$/, ''), MAX_SKILL_NAME);
    if (!name) return null;
    return { name, words: wordsOf(noNumbers(`${parts[2]} ${(parts[1].match(/\((.*)\)/) ?? [])[1] ?? ''}`)) };
}

/** "wight's lantern (rare, MATK)" → { name, rarity, stat }. */
function parseItem(text) {
    const line = clean(stripBullet(text));
    if (!line) return null;
    const inside = (line.match(/\(([^)]*)\)/) ?? [])[1] ?? '';
    const name = tidyName(line.replace(/\([^)]*\)/g, ' ').replace(/^(?:an?|the|some)\s+/i, ''), MAX_ITEM_NAME);
    if (!name || MONEY_NAMES.test(name)) return null;
    const notes = inside.split(/[,;/]/).map(part => clean(part));
    const rarity = notes.map(part => RARITY_WORDS[part.toLowerCase()]).find(Boolean) ?? null;
    const stat = notes.map(part => noNumbers(part).toUpperCase().replace(/[^A-Z]/g, '')).find(part => GEAR_STATS.includes(part)) ?? null;
    return { name, rarity, stat };
}

/** Commas that are not inside brackets. */
function splitTop(text, separators) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const char of String(text ?? '')) {
        if (char === '(' || char === '[') depth += 1;
        else if ((char === ')' || char === ']') && depth > 0) depth -= 1;
        if (depth === 0 && separators.includes(char)) {
            parts.push(current);
            current = '';
        } else current += char;
    }
    parts.push(current);
    return parts.map(part => part.trim()).filter(Boolean);
}

/**
 * The model's answer as words: { look, traits: [known], talks: true | false | null,
 * temperament: known | null, skills: [{ name, words }], loot: [{ name, rarity, stat }] }.
 * Lenient: any case, bold, bullets, a value on the line after its key, skills and loot one
 * per line or separated by ';' and ','. Numbers are dropped everywhere; unknown traits and
 * temperaments are left out. Never throws.
 */
export function parseFlavour(text) {
    const out = { look: '', traits: [], talks: null, temperament: null, skills: [], loot: [] };
    const sections = {};
    let currentKey = null;
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = clean(raw.replace(/^\s*#+\s*/, ''));
        if (!line) continue;
        const keyed = line.match(/^[-*•]?\s*([A-Za-z ]{2,14}?)\s*[:=]\s*(.*)$/);
        const id = keyed ? Object.keys(KEYS).find(name => KEYS[name].test(keyed[1].trim().toLowerCase())) : null;
        if (id) {
            currentKey = id;
            sections[id] = [...(sections[id] ?? []), keyed[2]];
        } else if (currentKey) {
            sections[currentKey].push(line);
        }
    }
    const joined = id => (sections[id] ?? []).filter(Boolean);
    out.look = noNumbers(joined('look').join(' ')).replace(/^["“']|["”']$/g, '').slice(0, MAX_LOOK).trim();
    const traitWords = wordsOf(noNumbers(joined('traits').join(', ')));
    const phrase = joined('traits').join(', ').toLowerCase();
    out.traits = cleanTraits(FLAVOUR_TRAITS.filter(trait => TRAIT_WORDS[trait].some(word => traitWords.includes(word) || (word.includes('-') && phrase.includes(word))))
        .sort((a, b) => firstIndex(traitWords, TRAIT_WORDS[a]) - firstIndex(traitWords, TRAIT_WORDS[b])));
    const talk = wordsOf(joined('talks').join(' '));
    if (talk.some(word => ['yes', 'true', 'y', 'can', 'does', 'speaks', 'talks'].includes(word)) && !talk.some(word => ['no', 'not', 'never', 'cannot', "can't", 'false'].includes(word))) out.talks = true;
    else if (talk.some(word => ['no', 'not', 'never', 'cannot', "can't", 'false', 'mute', 'silent'].includes(word))) out.talks = false;
    const temperWords = joined('temperament').join(' ').toLowerCase();
    out.temperament = TEMPERAMENTS.find(name => wordsOf(temperWords).includes(name))
        ?? lookup(Object.fromEntries(Object.entries(TEMPERAMENT_WORDS).map(([name, list]) => [name, list.filter(word => !word.includes(' '))])), wordsOf(temperWords))
        ?? (temperWords.includes('never flees') ? 'relentless' : null);
    out.skills = joined('skills').flatMap(part => splitTop(part, [';'])).map(parseSkill).filter(Boolean).slice(0, 4);
    out.loot = joined('loot').flatMap(part => splitTop(part, [',', ';'])).map(parseItem).filter(Boolean).slice(0, 4);
    return out;
}

function firstIndex(words, list) {
    const found = words.map((word, index) => (list.includes(word) ? index : -1)).filter(index => index >= 0);
    return found.length ? found[0] : Infinity;
}

// ---------------------------------------------------------------------------------------
// Applying it

/**
 * A move with a flavour skill's name and words: the name taken (numbers already gone), and
 * the words turned into knobs: a target ("all foes", "self"…), a type when they clearly say
 * one (heal, a shield or guard with nothing harmful, magic, a curse), conditions (known ones;
 * they replace the template's when any are given). Words that mean nothing are ignored.
 */
function flavourMove(base, skill) {
    const words = skill.words ?? [];
    const has = list => list.some(word => words.includes(word));
    const text = ` ${words.join(' ')} `;
    let type = base.type;
    const conditions = Object.keys(CONDITION_WORDS).filter(name => has(CONDITION_WORDS[name]));
    const harmful = conditions.filter(name => HARMFUL_CONDITIONS.includes(name));
    const helpful = conditions.filter(name => HELPFUL_CONDITIONS.includes(name));
    if (has(HEAL_WORDS)) type = 'heal';
    else if (helpful.length && !harmful.length && !/ (?:foe|foes|enemy|enemies) /.test(text)) type = 'buff';
    else if (has(DEBUFF_WORDS) && !has(MAGIC_WORDS.filter(word => !DEBUFF_WORDS.includes(word)))) type = 'debuff';
    else if (has(MAGIC_WORDS) && (base.type === 'physical' || base.type === 'magic')) type = 'magic';
    else if ((type === 'heal' || type === 'buff') && harmful.length) type = base.type === 'magic' ? 'magic' : 'physical';
    let target = base.target;
    if (/ all (?:allies|friends|kin) | allies /.test(text)) target = 'allies';
    else if (/ (?:one )?ally /.test(text)) target = 'ally';
    else if (/ self | itself /.test(text)) target = 'self';
    else if (/ all(?: foes| enemies)? | every(?:one)? | area | sweeping /.test(text)) target = 'all';
    else if (/ (?:one|single) (?:foe|enemy|target) /.test(text)) target = 'one';
    const friendly = type === 'heal' || type === 'buff';
    // A move that changed sides aims at that side: a glare is cast on a foe, not on itself.
    if (friendly && target === 'one') target = 'ally';
    if (friendly && target === 'all') target = 'allies';
    if (!friendly && (target === 'self' || target === 'ally')) target = 'one';
    if (!friendly && target === 'allies') target = 'all';
    const kept = friendly ? helpful : harmful;
    const stat = type === 'physical' ? (base.type === 'physical' ? base.stat : 'STR') : type === 'debuff' ? base.stat : 'INT';
    return {
        ...base,
        name: skill.name,
        type,
        stat,
        target,
        effect: kept.length ? kept.slice(0, 2) : friendly === (base.type === 'heal' || base.type === 'buff') ? base.effect : [],
        description: '',
    };
}

/** A rarity no more than one step above the creature's own gear rarity (and never below common). */
function capRarity(rarity, rank, rules) {
    const own = RARITIES.indexOf(gearRarityFor(rank, rules));
    const wanted = RARITIES.indexOf(rarity);
    return RARITIES[Math.min(Math.max(0, wanted), own + 1)];
}

/**
 * The loot table renamed: flavour items with a stat are gear (the template's gear row takes
 * the name, the stat and the rarity, its value worked out again from the rarity budget; a
 * template without gear gets one at the gear chance), the others are materials (in order),
 * and one named like a potion renames the potion. Rarities are capped one step above what
 * the creature's rank drops. Anything left over is dropped.
 */
function flavourLoot(rows, items, entry, rules) {
    const g = rules.generated ?? DEFAULT_RULES.generated;
    const out = rows.map(row => structuredClone(row));
    const materials = out.filter(row => row.kind === 'material');
    let gear = out.find(row => row.kind === 'equipment') ?? null;
    const potion = out.find(row => row.kind === 'consumable') ?? null;
    let nextMaterial = 0;
    for (const item of items ?? []) {
        if (item.stat) {
            const rarity = capRarity(item.rarity ?? gear?.rarity ?? gearRarityFor(entry.rank, rules), entry.rank, rules);
            if (!gear) {
                gear = { name: item.name, chance: g.gearChance, qty: [1, 1], kind: 'equipment', rarity, stats: {} };
                out.push(gear);
            } else if (gear.flavoured) continue;
            Object.assign(gear, { name: item.name, rarity, stats: { [item.stat]: gearValue(item.stat, rarity, entry.level, rules) }, flavoured: true });
        } else if (POTION_WORDS.test(item.name) && potion && !potion.flavoured) {
            Object.assign(potion, { name: item.name, flavoured: true });
        } else if (nextMaterial < materials.length) {
            const row = materials[nextMaterial++];
            row.name = item.name;
            if (item.rarity) row.rarity = capRarity(item.rarity, entry.rank, rules);
        }
    }
    return out.map(({ flavoured, ...row }) => row);
}

/**
 * The creature with the flavour applied: its look; the flavour's traits (known ones, a
 * leader stays a leader) in place of the template's when any are given; talks and
 * temperament when given; its skills renamed in order with their words mapped
 * (flavourMove); its loot renamed (flavourLoot); then every number worked out again
 * (templates.finishCreature). `flavoured: true` only when something was taken. Pure.
 */
export function applyFlavour(entry, flavour, { rules = DEFAULT_RULES } = {}) {
    if (!entry || !flavour) return entry;
    const next = structuredClone(entry);
    let changed = false;
    if (flavour.look) {
        next.look = flavour.look;
        changed = true;
    }
    if (flavour.traits?.length) {
        next.traits = cleanTraits([...flavour.traits, ...(entry.traits?.includes('leader') ? ['leader'] : [])]);
        changed = true;
    }
    if (typeof flavour.talks === 'boolean') {
        next.talks = flavour.talks;
        changed = true;
    }
    if (TEMPERAMENTS.includes(flavour.temperament)) {
        next.temperament = flavour.temperament;
        changed = true;
    }
    const skills = flavour.skills ?? [];
    if (skills.length) {
        next.moves = (entry.moves ?? []).map((base, index) => (skills[index] ? flavourMove(base, skills[index]) : base));
        // Two skills of one name would be one button: a repeat keeps the template's name.
        const seen = new Set();
        next.moves = next.moves.map((move, index) => {
            const nameKey = move.name.toLowerCase();
            if (seen.has(nameKey)) return { ...move, name: entry.moves[index].name };
            seen.add(nameKey);
            return move;
        });
        changed = true;
    }
    if (flavour.loot?.length && Array.isArray(entry.loot)) {
        next.loot = flavourLoot(entry.loot, flavour.loot, entry, rules);
        changed = true;
    }
    if (!changed) return entry;
    return finishCreature({ ...next, flavoured: true }, rules);
}
