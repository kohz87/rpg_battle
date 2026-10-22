// RPG Battle v2, part **craft**: the rules, all code's (MODULES §F102). Pure.
//
// * **Crafts** are Story Block's craft table (PACKS.md "crafts", query `packs.crafts`: `[{ craft, title,
//   stats, stations, note?, pack }]`, the defaults with the enabled packs' crafts laid over them): which
//   stats a craft's check rolls with and where it can be worked. A recipe's own `stat` (`STR+DEX`, 1 to 3
//   stats joined by +) and `station` win over its craft's. RPG Battle keeps no copy of that table; it
//   only knows words a story may write for a craft (CRAFT_WORDS: "blacksmithing" is smithing,
//   "leatherwork" is leather) and how long each takes by default (CRAFT_MINUTES).
// * **Stations** are slugs (`forge`, `alchemy-table`, `campfire`, `inn`, `workbench`, or a pack's own
//   such as `salt-yard`). The place has one when its name or kind says so, its pack place's kind, note or
//   aliases, or a pack shop there (an apothecary has an alchemy table, a smith a forge and a workbench,
//   an inn an inn): STATION_WORDS; a pack's own slug when every word of it is in those. A settlement has
//   an inn. A campfire can be made where the party is (`at: campfire`); nothing else can.
// * **The roll** (F80: the reply's own d20, positional like a check): d20 + the stats' check modifier
//   (the average of the listed stats' v1 check modifiers, rounded down) + what the checks part counts for
//   crafting (tools, a talent, a skill, at most +3) + the craft's rank + the materials' quality (their
//   rarity, on average: common 0 … legendary +4) − the recipe's DC. The DC is the recipe's own (`dc`,
//   5–40), else its output's rarity's (DC_BY_RARITY); a story-taught recipe's comes from its output's
//   rarity or a rank (`rank: D`).
// * **Quality** by how far the total is over the DC: under it, a fail (half the materials lost);
//   0–4 the item as made; 5–9 fine (×1.2 its stats); 10 or more, or a natural 20, masterwork (×1.5,
//   and a piece of gear carries +1 refinement). A natural 1 ruins it: every material lost and a named
//   junk item (gear with a small debuff) made instead.
// * **Skill.** Every craft (made or not) is one use of that craft for the crafter. A craft's rank
//   grows the way RPG Battle's skills do (rules.masteryUses, up to rules.masteryMax): the first use
//   makes rank 1, then masteryUses[rank] uses for each next rank.

import { DEFAULT_RULES, RANKS, RARITIES, STATS, checkModifier } from '../../rules.js';

export const FEATURE = 'rpg-battle.crafting';

export const QUALITIES = Object.freeze(['ruined', 'fail', 'normal', 'fine', 'masterwork']);
export const QUALITY_TEXT = Object.freeze({ ruined: 'ruined (a natural 1)', fail: 'failed', normal: 'made', fine: 'fine', masterwork: 'masterwork' });
export const SCALE = Object.freeze({ normal: 1, fine: 1.2, masterwork: 1.5 });
export const FINE_AT = 5;
export const MASTER_AT = 10;

export const DC_BY_RARITY = Object.freeze({ common: 10, uncommon: 12, rare: 15, epic: 18, legendary: 21 });
export const DC_BY_RANK = Object.freeze({ F: 10, E: 11, D: 12, C: 14, B: 16, A: 18, S: 20, SS: 22, SSS: 24 });
export const DC_MIN = 5;
export const DC_MAX = 40;
export const MATERIAL_BONUS = Object.freeze({ common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 });
export const STATION_BONUS_MAX = 3;

/** What a place's words say it has: station slug → { name (for a sentence), words }. */
export const STATION_WORDS = Object.freeze({
    forge: { name: 'a forge', words: /\b(?:forges?|smithy|smithies|smithing|anvils?|blacksmiths?|foundry|foundries|smelter\w*|smiths?)\b/ },
    'alchemy-table': { name: 'an alchemy table', words: /\b(?:alchem\w*|apothecar\w*|laborator\w*|lab|labs|herbalists?|distiller\w*|dispensar\w*)\b/ },
    workbench: { name: 'a workbench', words: /\b(?:workbench\w*|workshops?|benches|bench|carpenter\w*|tinker\w*|tanner\w*|tannery|leatherwork\w*|crafters?|smithy|smithies|smiths?|forges?)\b/ },
    campfire: { name: 'a campfire', words: /\b(?:camps?|campsites?|campfires?|camping|firepits?|fires?|hearths?)\b/ },
    inn: { name: 'an inn', words: /\b(?:inns?|taverns?|kitchens?|cookhouses?|lodges?|hostels?|alehouses?)\b/ },
});
// A settlement has an inn: a fire to cook at, though not a station worth telling the story about.
const TOWN = /\b(?:settlements?|villages?|towns?|city|cities|hamlets?|capitals?|ports?|outposts?)\b/;

/** The words a story may write for a craft of Story Block's table ("blacksmithing" → smithing). */
export const CRAFT_WORDS = Object.freeze({
    smithing: /\b(?:smith\w*|forg\w*|blacksmith\w*|metal\w*|armou?ry|weaponsmith\w*)\b/,
    leather: /\b(?:leather\w*|tann\w*|tan|hide\w*|skinn\w*)\b/,
    alchemy: /\b(?:alchem\w*|brew\w*|potion\w*|draughts?|elixirs?|apothecar\w*)\b/,
    enchanting: /\b(?:enchant\w*|rune\w*|imbu\w*|arcan\w*)\b/,
    cooking: /\b(?:cook\w*|bak\w*|roast\w*|stew\w*|meals?|food|kitchen)\b/,
});
/** How long a craft takes when its recipe does not say (minutes). */
export const CRAFT_MINUTES = Object.freeze({ smithing: 120, leather: 60, alchemy: 60, enchanting: 120, cooking: 30 });

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// Names are flattened as Story Block flattens item names (domains/names.js cleanName): invisible format
// characters (U+202E, zero-width spaces…) dropped, NFC, one line; then cut by code points.
const flat = value => String(value ?? '').replace(/\p{Cf}+/gu, '').normalize('NFC').replace(/\s+/g, ' ').trim();
export const nameKey = value => flat(value).normalize('NFKC').toLowerCase();
export const clip = (value, max) => [...flat(value)].slice(0, max).join('').trim();
const lower = value => ` ${nameKey(value).replace(/[-_]+/g, ' ')} `;
export const slugOf = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'thing';

/** Stats from a written list (`STR+DEX`, ['INT', 'DEX']): the real stats, each once, at most 3; [] for none. */
export function statList(value) {
    const list = Array.isArray(value) ? value : String(value ?? '').split('+');
    return [...new Set(list.map(stat => String(stat ?? '').trim().toUpperCase()).filter(stat => STATS.includes(stat)))].slice(0, 3);
}

/**
 * The craft table: Story Block's `packs.crafts` records as { [craft]: { key, title, stats, stations,
 * minutes, note } }. Nothing when there is no table (a Story Block before it).
 */
export function craftTable(records = []) {
    const out = {};
    for (const record of Array.isArray(records) ? records : []) {
        if (!isRecord(record) || typeof record.craft !== 'string' || !record.craft) continue;
        const key = record.craft;
        out[key] = {
            key, title: clip(record.title || key, 30), stats: statList(record.stats),
            stations: (Array.isArray(record.stations) ? record.stations : []).map(station => slugOf(station)).filter(station => station !== 'thing'),
            minutes: CRAFT_MINUTES[key] ?? 60, note: clip(record.note ?? '', 200),
        };
    }
    return out;
}

/** A station word (`forge`, `anvil`, `campfire`, `alchemy table`, `salt-yard`) as a station slug, or null. */
export function stationKey(word) {
    const said = lower(word);
    if (!said.trim()) return null;
    const slug = slugOf(word);
    if (Object.hasOwn(STATION_WORDS, slug)) return slug;
    for (const [key, station] of Object.entries(STATION_WORDS)) if (station.words.test(said)) return key;
    return null;
}

/** The craft a written word means (`craft: leatherwork` → leather, `Fieldcraft` → fieldcraft), or null. */
export function craftKey(word, table = {}) {
    const said = lower(word);
    if (!said.trim()) return null;
    const slug = slugOf(word);
    if (Object.hasOwn(table, slug)) return slug;
    for (const [key, craft] of Object.entries(table)) if (nameKey(craft.title) === nameKey(word)) return key;
    for (const [key, pattern] of Object.entries(CRAFT_WORDS)) if (Object.hasOwn(table, key) && pattern.test(said)) return key;
    return null;
}

/** A recipe's craft: its own `craft` (an id of the table), else read from what it makes or its name. */
export function craftOfRecipe(recipe, table = {}, madeName = '') {
    if (typeof recipe?.craft === 'string' && Object.hasOwn(table, recipe.craft)) return recipe.craft;
    return craftKey(recipe?.craft, table) ?? craftKey(madeName, table) ?? craftKey(recipe?.name, table) ?? (typeof recipe?.craft === 'string' && recipe.craft ? slugOf(recipe.craft) : 'smithing');
}

/** The stats a recipe is crafted with: its own `stat` (`STR+DEX`), else its craft's, else INT. */
export function statsOf(recipe, craft, table = {}) {
    const own = statList(recipe?.stat);
    if (own.length) return own;
    const of = table[craft]?.stats ?? [];
    return of.length ? [...of] : ['INT'];
}

/** The check modifier of a list of stats for a member: the average of each one's (v1 checkModifier), rounded down. */
export function statsModifier(actor, stats, rules = DEFAULT_RULES) {
    const list = stats.length ? stats : ['INT'];
    const sum = list.reduce((total, stat) => {
        const value = actor?.stats?.[stat];
        return total + checkModifier(Number.isFinite(value) ? value : rules.character.startStat, rules);
    }, 0);
    return Math.floor(sum / list.length);
}

/** The stations a recipe can be made at: its own `station`, else its craft's ([]: anywhere). */
export function stationsOfRecipe(recipe, craft, table = {}) {
    if (typeof recipe?.station === 'string' && recipe.station.trim()) {
        return nameKey(recipe.station) === 'none' ? [] : [stationKey(recipe.station) ?? slugOf(recipe.station)];
    }
    return [...(table[craft]?.stations ?? [])];
}

/** "a forge", "an alchemy table", "a salt yard": a station in a sentence. */
export function stationName(slug) {
    if (STATION_WORDS[slug]) return STATION_WORDS[slug].name;
    const words = String(slug).replace(/-/g, ' ');
    return `${/^[aeiou]/.test(words) ? 'an' : 'a'} ${words}`;
}

/** "a campfire or an inn" for a list of stations. */
export const stationsText = list => list.map(stationName).join(' or ');

/**
 * The stations here: { [slug]: { bonus, from, notable } }, from what is said about the place (`texts`: its
 * name and kind, its pack place's kind, note and aliases, the pack shops there and their kinds), the
 * stations a pack names (`known`: a pack's own slugs, found when every word of one is said), and a
 * campfire the line says was made (`made`: ['campfire']). `notable`: worth telling the story about (not
 * only "a town has an inn").
 */
export function stationsHere({ texts = [], known = [], made = [] } = {}) {
    const out = {};
    const add = (key, from, notable = true) => {
        if (!key) return;
        const was = out[key];
        if (!was) out[key] = { bonus: 0, from: clip(from, 60), notable };
        else if (notable) was.notable = true;
    };
    const said = texts.map(value => clip(value, 200)).filter(Boolean);
    for (const text of said) {
        const words = lower(text);
        for (const [key, station] of Object.entries(STATION_WORDS)) if (station.words.test(words)) add(key, text);
        if (TOWN.test(words)) add('inn', text, false);
    }
    for (const slug of known) {
        if (Object.hasOwn(STATION_WORDS, slug) || Object.hasOwn(out, slug)) continue;
        const parts = String(slug).split('-').filter(Boolean);
        const text = said.find(value => parts.length && parts.every(part => lower(value).includes(` ${part}`)));
        if (text) add(slug, text);
    }
    for (const key of made) add(key, 'a campfire made here', true);
    return out;
}

/** The DC of a recipe: its own `dc` (5–40), else its output's rarity's. */
export function dcOf(recipe, outputRarity = 'common') {
    if (Number.isInteger(recipe?.dc)) return Math.max(DC_MIN, Math.min(DC_MAX, recipe.dc));
    return DC_BY_RARITY[RARITIES.includes(outputRarity) ? outputRarity : 'common'];
}

/** The DC a rank word means (`D`, `rank D`), or null. */
export function dcOfRank(word) {
    const said = String(word ?? '').trim().toUpperCase().replace(/^RANK\s+/, '');
    return RANKS.includes(said) ? DC_BY_RANK[said] ?? null : null;
}

/** The materials' quality: the average rarity bonus over every unit used, rounded down. */
export function materialBonus(parts = []) {
    let units = 0;
    let sum = 0;
    for (const part of parts) {
        const qty = Number.isInteger(part?.qty) && part.qty > 0 ? part.qty : 1;
        units += qty;
        sum += (MATERIAL_BONUS[part?.def?.rarity] ?? 0) * qty;
    }
    return units ? Math.floor(sum / units) : 0;
}

/** The quality a die and a total reach against a DC (natural 1 ruins, natural 20 is masterwork). */
export function qualityOf(die, total, dc) {
    if (die === 1) return 'ruined';
    if (die === 20) return 'masterwork';
    const over = total - dc;
    if (over < 0) return 'fail';
    if (over >= MASTER_AT) return 'masterwork';
    if (over >= FINE_AT) return 'fine';
    return 'normal';
}

/**
 * The chance of each quality with modifier `mod` against `dc`, in whole percents: { fail, normal,
 * fine, masterwork } (a natural 1, ruined, is counted in `fail`), from the 20 faces of the die.
 */
export function chancesOf(mod, dc) {
    const count = { fail: 0, normal: 0, fine: 0, masterwork: 0 };
    for (let die = 1; die <= 20; die += 1) {
        const quality = qualityOf(die, die + mod, dc);
        count[quality === 'ruined' ? 'fail' : quality] += 1;
    }
    return { fail: count.fail * 5, normal: count.normal * 5, fine: count.fine * 5, masterwork: count.masterwork * 5 };
}

/** The quality the story wrote (`result: fine`), or null when it says none. */
export function saidQuality(text) {
    const words = lower(text);
    if (!words.trim()) return null;
    if (/\b(?:master\w*|exquisite|perfect|legendary)\b/.test(words)) return 'masterwork';
    if (/\b(?:ruin\w*|botch\w*|disaster\w*|nat(?:ural)?\s*1|critical\s*fail\w*|fumbl\w*|wreck\w*)\b/.test(words)) return 'ruined';
    if (/\b(?:fine|superior|excellent|great|quality)\b/.test(words)) return 'fine';
    if (/\b(?:fail\w*|spoil\w*|miss\w*|no)\b/.test(words)) return 'fail';
    if (/\b(?:normal|success\w*|made|ok|okay|good|plain|standard|done|works|yes|average)\b/.test(words)) return 'normal';
    return null;
}

/** "narrated as fine, the dice say made" when the story's quality and code's differ, else ''. */
export function mismatchOf(said, quality) {
    if (!said || said === quality) return '';
    return `narrated as ${QUALITY_TEXT[said]}, the dice say ${QUALITY_TEXT[quality]}`;
}

/**
 * What a fail loses: half of every unit, rounded up overall ([{ ...part, lose }]): each line its
 * half rounded down, then one more from the first odd lines until half (rounded up) is reached.
 */
export function halfOf(parts = []) {
    const total = parts.reduce((sum, part) => sum + part.qty, 0);
    const want = Math.ceil(total / 2);
    const out = parts.map(part => ({ ...part, lose: Math.floor(part.qty / 2) }));
    let left = want - out.reduce((sum, part) => sum + part.lose, 0);
    for (const part of out) {
        if (left <= 0) break;
        if (part.lose < part.qty) {
            part.lose += 1;
            left -= 1;
        }
    }
    return out;
}

/** A number scaled by a quality (×1.2, ×1.5), a positive one always at least one more. */
export function scaled(value, factor) {
    if (!(typeof value === 'number' && Number.isFinite(value)) || factor === 1) return value;
    if (value <= 0) return value;
    return Math.max(value + 1, Math.round(value * factor));
}

// ---------------------------------------------------------------------------------------
// Craft skill ranks (the way RPG Battle's skills grow: rules.masteryUses, rules.masteryMax)

/** { rank, uses, toNext (uses still needed; 0 at the top), max } for `uses` uses of a craft. */
export function rankOf(uses, rules = DEFAULT_RULES) {
    const max = Number.isInteger(rules?.masteryMax) && rules.masteryMax > 0 ? rules.masteryMax : DEFAULT_RULES.masteryMax;
    const table = Array.isArray(rules?.masteryUses) ? rules.masteryUses : DEFAULT_RULES.masteryUses;
    let rank = 0;
    let left = Math.max(0, Number.isInteger(uses) ? uses : 0);
    while (rank < max) {
        const need = rank === 0 ? 1 : Number(table[rank]) > 0 ? Number(table[rank]) : null;
        if (need === null || left < need) break;
        left -= need;
        rank += 1;
    }
    const need = rank >= max ? 0 : rank === 0 ? 1 : Number(table[rank]) > 0 ? Number(table[rank]) : 0;
    return { rank, uses: Math.max(0, uses | 0), toNext: need ? need - left : 0, max };
}

/** The uses a craft needs in all to reach the top rank (no more are kept after that). */
export function usesToMax(rules = DEFAULT_RULES) {
    const max = Number.isInteger(rules?.masteryMax) && rules.masteryMax > 0 ? rules.masteryMax : DEFAULT_RULES.masteryMax;
    const table = Array.isArray(rules?.masteryUses) ? rules.masteryUses : DEFAULT_RULES.masteryUses;
    let sum = 0;
    for (let rank = 0; rank < max; rank += 1) sum += rank === 0 ? 1 : Number(table[rank]) > 0 ? Number(table[rank]) : 0;
    return sum;
}

/** The pattern a reader's message matches when crafting is on their mind. */
export const CRAFT_TALK = /\b(?:craft\w*|forg(?:e|es|ed|ing)|smith\w*|brew\w*|cook\w*|tann\w*|tan|enchant\w*|sew\w*|stitch\w*|recipes?|alchem\w*|potions?|draughts?|anvil|workbench|smelt\w*|make (?:a|an|some|the)\b)/;
