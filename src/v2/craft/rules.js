// RPG Battle v2, part **craft**: the rules, all code's (MODULES §F102). Pure.
//
// * **Crafts.** Each recipe belongs to a craft: smithing, leatherwork, alchemy, enchanting or
//   cooking (CRAFTS below), or one a pack's `crafts` records add. A craft names the stat that
//   answers it (smithing STR, leatherwork DEX, alchemy INT, enchanting INT, cooking DEX) and the
//   station it needs. A pack's `crafts` record (`{ name, stat?, station?, words? }`) or a recipe's
//   own `stat` / `station` wins over these defaults.
// * **Stations.** Smithing needs a forge, alchemy an alchemy bench, enchanting an enchanting table:
//   the place has one when its name or kind says so (a smithy, an apothecary, a mage tower…) or its
//   pack place lists it (`stations: [...]`). Cooking and simple leatherwork need only a fire: a
//   campfire or an inn (a camp, an inn, a tavern, a kitchen, any settlement), or a campfire the line
//   says was made (`at: campfire`). A pack place may give a station a bonus (`{ station, bonus }`, 0–3).
// * **The roll** (F80: the reply's own d20, positional like a check): d20 + the stat's check modifier
//   (+ what the checks part counts for crafting: tools, a talent, a skill, at most +3) + the craft's
//   rank + the station's bonus + the materials' quality (their rarity, on average: common 0 …
//   legendary +4) − the recipe's DC. The DC is the recipe's own (`dc`), else its output's rarity's
//   (DC_BY_RARITY); a story-taught recipe's comes from its output's rarity or a rank (`rank: D`).
// * **Quality** by how far the total is over the DC: under it, a fail (half the materials lost);
//   0–4 the item as made; 5–9 fine (×1.2 its stats); 10 or more, or a natural 20, masterwork (×1.5,
//   and a piece of gear carries +1 refinement). A natural 1 ruins it: every material lost and a named
//   junk item (gear with a small debuff) made instead.
// * **Skill.** Every craft (made or not) is one use of that craft for the crafter. A craft's rank
//   grows the way RPG Battle's skills do (rules.masteryUses, up to rules.masteryMax): the first use
//   makes rank 1, then masteryUses[rank] uses for each next rank.

import { DEFAULT_RULES, RANKS, RARITIES, STATS } from '../../rules.js';

export const FEATURE = 'rpg-battle.crafting';

export const QUALITIES = Object.freeze(['ruined', 'fail', 'normal', 'fine', 'masterwork']);
export const QUALITY_TEXT = Object.freeze({ ruined: 'ruined (a natural 1)', fail: 'failed', normal: 'made', fine: 'fine', masterwork: 'masterwork' });
export const SCALE = Object.freeze({ normal: 1, fine: 1.2, masterwork: 1.5 });
export const FINE_AT = 5;
export const MASTER_AT = 10;

export const DC_BY_RARITY = Object.freeze({ common: 10, uncommon: 12, rare: 15, epic: 18, legendary: 21 });
export const DC_BY_RANK = Object.freeze({ F: 10, E: 11, D: 12, C: 14, B: 16, A: 18, S: 20, SS: 22, SSS: 24 });
export const DC_MIN = 5;
export const DC_MAX = 30;
export const MATERIAL_BONUS = Object.freeze({ common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 });
export const STATION_BONUS_MAX = 3;

/** The stations a craft may need; `fire` is a campfire or an inn. */
export const STATIONS = Object.freeze({
    forge: { name: 'a forge', words: /\b(?:forges?|smithy|smithies|smithing|anvils?|blacksmiths?|foundry|foundries|smelter\w*|smiths?)\b/ },
    alchemy: { name: 'an alchemy bench', words: /\b(?:alchem\w*|apothecar\w*|laborator\w*|lab|labs|herbalists?|distiller\w*)\b/ },
    enchanting: { name: 'an enchanting table', words: /\b(?:enchant\w*|arcan\w*|sanctum|sanctums|mage towers?|wizard\w*|runeforges?|ritual circles?)\b/ },
    fire: { name: 'a campfire or an inn', words: /\b(?:camps?|campsites?|campfires?|camping|fires?|firepits?|hearths?|inns?|taverns?|kitchens?|cookhouses?|lodges?)\b/ },
});
// A settlement has an inn: a fire to cook at, though not a station worth telling the story about.
const TOWN = /\b(?:settlements?|villages?|towns?|city|cities|hamlets?)\b/;

/** The built-in crafts: craft → { stat, station, words (what a recipe's or a line's `craft:` may say) }. */
export const CRAFTS = Object.freeze({
    smithing: { stat: 'STR', station: 'forge', minutes: 120, words: /\b(?:smith\w*|forg\w*|blacksmith\w*|metal\w*|armou?ry|weaponsmith\w*)\b/ },
    leatherwork: { stat: 'DEX', station: 'fire', minutes: 60, words: /\b(?:leather\w*|tann\w*|tan|hide\w*|skinn\w*)\b/ },
    alchemy: { stat: 'INT', station: 'alchemy', minutes: 60, words: /\b(?:alchem\w*|brew\w*|potion\w*|draughts?|elixirs?|apothecar\w*)\b/ },
    enchanting: { stat: 'INT', station: 'enchanting', minutes: 120, words: /\b(?:enchant\w*|rune\w*|imbu\w*|arcan\w*)\b/ },
    cooking: { stat: 'DEX', station: 'fire', minutes: 30, words: /\b(?:cook\w*|bak\w*|roast\w*|stew\w*|meals?|food|kitchen)\b/ },
});
export const DEFAULT_CRAFT = 'smithing';

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const nameKey = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
export const clip = (value, max) => [...String(value ?? '').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
const lower = value => ` ${nameKey(value)} `;
export const slugOf = value => String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'thing';

/**
 * The crafts in use: the built-in ones, with a pack's `crafts` records laid over them (by name or
 * slug: `{ name: 'smithing', stat: 'STR', station: 'forge' }`; a new name adds a craft).
 */
export function craftTable(packCrafts = []) {
    const out = {};
    for (const [key, value] of Object.entries(CRAFTS)) out[key] = { key, ...value };
    for (const record of Array.isArray(packCrafts) ? packCrafts : []) {
        if (!isRecord(record)) continue;
        const key = slugOf(record.slug ?? record.name).replace(/-/g, '');
        if (!key || key === 'thing') continue;
        const was = out[key] ?? { key, stat: 'DEX', station: null, minutes: 60, words: null };
        const stat = STATS.includes(String(record.stat ?? '').toUpperCase()) ? String(record.stat).toUpperCase() : was.stat;
        const station = stationKey(record.station) ?? (record.station === null || record.station === 'none' ? null : was.station);
        const minutes = Number.isInteger(record.minutes) && record.minutes >= 0 ? Math.min(record.minutes, 24 * 60) : was.minutes;
        out[key] = { ...was, key, stat, station, minutes, label: clip(record.name ?? key, 40) };
    }
    return out;
}

/** A station word (`forge`, `anvil`, `campfire`, `inn`…) as a station key, or null. */
export function stationKey(word) {
    const said = lower(word);
    if (!said.trim()) return null;
    if (Object.hasOwn(STATIONS, said.trim())) return said.trim();
    for (const [key, station] of Object.entries(STATIONS)) if (station.words.test(said)) return key;
    return null;
}

/** The craft a written word means (`craft: brewing` → alchemy), or null. */
export function craftKey(word, table = craftTable()) {
    const said = lower(word);
    if (!said.trim()) return null;
    const bare = said.trim().replace(/[^a-z0-9]/g, '');
    if (Object.hasOwn(table, bare)) return bare;
    for (const [key, craft] of Object.entries(table)) {
        if (craft.label && nameKey(craft.label) === said.trim()) return key;
        if (craft.words?.test(said)) return key;
    }
    return null;
}

/** A recipe's craft: its own `craft`, else read from what it makes, else smithing. */
export function craftOfRecipe(recipe, table = craftTable(), madeName = '') {
    return craftKey(recipe?.craft, table) ?? craftKey(madeName, table) ?? craftKey(recipe?.name, table) ?? DEFAULT_CRAFT;
}

/** The stat a recipe is crafted with: the recipe's own, else its craft's. */
export function statOf(recipe, craft, table = craftTable()) {
    const own = String(recipe?.stat ?? '').toUpperCase();
    return STATS.includes(own) ? own : table[craft]?.stat ?? 'DEX';
}

/** The station a recipe needs: the recipe's own (`station: forge`, `none`), else its craft's (null: none). */
export function stationOf(recipe, craft, table = craftTable()) {
    if (recipe?.station === null || nameKey(recipe?.station) === 'none') return null;
    return stationKey(recipe?.station) ?? table[craft]?.station ?? null;
}

/**
 * The stations here: { [station]: { bonus, from, notable } } from the place's name and kind, its pack
 * place (kind, note, `stations`), and a campfire the line says was made (`made`: ['fire']).
 * `notable`: a station worth telling the story about (not only "a town has an inn").
 */
export function stationsHere({ place = {}, packPlace = null, made = [] } = {}) {
    const out = {};
    const add = (key, bonus, from, notable = true) => {
        if (!key) return;
        const was = out[key];
        const amount = Math.max(0, Math.min(STATION_BONUS_MAX, Number.isInteger(bonus) ? bonus : 0));
        if (!was || amount > was.bonus) out[key] = { bonus: amount, from: clip(from, 60), notable: notable || Boolean(was?.notable) };
        else if (notable) was.notable = true;
    };
    const words = [place?.name, place?.kind, packPlace?.kind, packPlace?.note].map(value => clip(value, 200)).filter(Boolean);
    for (const text of words) {
        const said = lower(text);
        for (const [key, station] of Object.entries(STATIONS)) if (station.words.test(said)) add(key, 0, text);
        if (TOWN.test(said)) add('fire', 0, text, false);
    }
    for (const entry of Array.isArray(packPlace?.stations) ? packPlace.stations : []) {
        if (typeof entry === 'string') add(stationKey(entry), 0, entry);
        else if (isRecord(entry)) add(stationKey(entry.station ?? entry.name ?? entry.craft) ?? stationOf({}, craftKey(entry.craft) ?? '', craftTable()), entry.bonus, String(entry.name ?? entry.station ?? entry.craft ?? ''));
    }
    for (const key of made) add(stationKey(key), 0, 'a campfire made here', true);
    return out;
}

/** The DC of a recipe: its own `dc` (5–30), else its output's rarity's. */
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
