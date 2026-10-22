// RPG Battle v2, part **craft**: the recipe book and what a craft would be (pure apart from the
// queries it is handed).
//
// Recipes come from two places: the enabled packs (`packs.content({ kind: 'recipes' })`, PACKS.md:
// `{ id, name, makes, qty?, materials: [{ item, qty }], fee?, minutes?, craft?, dc?, station?, stat?,
// known?, teaches? }`, every field after `materials` optional) and the story (`craft.taught`, this chat
// only). Who knows what is per member: a pack recipe marked `known: true` everyone knows from the
// start (unless they forgot it), the rest only once the story taught them (`craft.known`).
//
// `env` is how this reads the world, the same for a command and a query: { ask(name, args) (a query,
// null when it is not there or fails), craft, inventory, party (slices) }. planOf works out a craft
// before the dice: the station, the materials had and missing, code's modifiers and the DC; the
// quality chances follow from them (rules.js chancesOf).

import { DEFAULT_RULES, RARITIES, checkModifier, makeRules } from '../../rules.js';
import { knowKey, usesOf } from './domain.js';
import {
    STATIONS, chancesOf, clip, craftOfRecipe, craftTable, dcOf, materialBonus, nameKey, rankOf,
    stationOf, stationsHere, statOf,
} from './rules.js';

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const list = value => (Array.isArray(value) ? value : []);

/** The forms a name is matched in: as written, with and without a plural s. */
export function nameForms(name) {
    const key = nameKey(name);
    if (!key) return [];
    return [...new Set([key, `${key}s`, key.replace(/e?s$/, ''), key.replace(/s$/, '')])].filter(Boolean);
}
const sameName = (a, b) => {
    const forms = nameForms(a);
    return nameForms(b).some(form => forms.includes(form));
};

/** env for a command: its ctx's queries and reads. */
export function envOfCtx(ctx) {
    const ask = (name, args) => {
        try { return ctx.query(name, args) ?? null; } catch { return null; }
    };
    const read = domain => {
        try { return ctx.read(domain) ?? null; } catch { return null; }
    };
    return withPacks({ ask, craft: read('craft'), inventory: read('inventory'), party: read('party'), scene: read('scene'), time: () => { try { return ctx.time?.() ?? null; } catch { return null; } } });
}

/** env for a query or a view: the state, and the host's query tools (null-safe). */
export function envOfState(state, query) {
    const ask = (name, args) => {
        if (typeof query !== 'function') return null;
        try { return query(name, args) ?? null; } catch { return null; }
    };
    const domains = state?.domains ?? {};
    return withPacks({ ask, craft: domains.craft ?? null, inventory: domains.inventory ?? null, party: domains.party ?? null, scene: domains.scene ?? null, time: () => domains.director?.time?.minutes ?? null });
}

function withPacks(env) {
    const cache = {};
    const content = kind => (cache[kind] ??= list(env.ask('packs.content', { kind })).filter(isRecord));
    return Object.freeze({ ...env, content });
}

/** The rules a craft reads: v1's, with a rules file's numbers (settings `rules`) over them. */
export function rulesOf(settings) {
    try { return makeRules(isRecord(settings?.rules) ? settings.rules : null); } catch { return DEFAULT_RULES; }
}

// ---------------------------------------------------------------------------------------
// Defs

/** A def by id: the inventory's, else a pack item's. */
export function defById(env, id) {
    if (typeof id !== 'string' || !id) return null;
    const defs = env.inventory?.defs ?? {};
    if (Object.hasOwn(defs, id)) return defs[id];
    return env.content('items').find(item => item.id === id) ?? null;
}

/** A def by name: the inventory's (by its aliases or name), else a pack item's, else null. */
export function defByName(env, name) {
    const key = nameKey(name);
    if (!key) return null;
    const inventory = env.inventory ?? {};
    const aliased = inventory.aliases?.[key];
    if (aliased && inventory.defs?.[aliased]) return inventory.defs[aliased];
    const defs = Object.values(inventory.defs ?? {}).filter(def => sameName(def?.name, name)).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (defs.length) return defs[0];
    return env.content('items').find(item => sameName(item.name, name) || list(item.aliases).some(alias => sameName(alias, name))) ?? null;
}

// ---------------------------------------------------------------------------------------
// Recipes

/** A pack recipe in the book's shape. */
function packRecipe(env, record, table) {
    const makes = defById(env, record.makes);
    const madeName = makes?.name ?? String(record.makes ?? '').split('/').at(-1);
    const craft = craftOfRecipe(record, table, madeName);
    const materials = list(record.materials).map(part => {
        const def = defById(env, part.item);
        return { id: part.item, name: clip(def?.name ?? String(part.item ?? '').split('/').at(-1), 80), qty: Number.isInteger(part.qty) && part.qty > 0 ? part.qty : 1 };
    });
    const teaches = (Array.isArray(record.teaches) ? record.teaches : record.teaches ? [record.teaches] : []).map(name => clip(name, 60)).filter(Boolean);
    return {
        id: record.id, name: clip(record.name, 80), source: 'pack', craft, stat: statOf(record, craft, table), station: stationOf(record, craft, table),
        dc: dcOf(record, makes?.rarity), minutes: minutesOf(record, craft, table), qty: Number.isInteger(record.qty) && record.qty > 0 ? Math.min(record.qty, 20) : 1,
        known: record.known === true, teaches, materials, makes: { id: record.makes ?? null, name: clip(madeName, 80), def: makes ?? null },
        rarity: RARITIES.includes(makes?.rarity) ? makes.rarity : 'common',
    };
}

const minutesOf = (record, craft, table) => (Number.isInteger(record?.minutes) && record.minutes >= 0 ? Math.min(record.minutes, 24 * 60) : table[craft]?.minutes ?? 60);

/** A story-taught recipe (craft.taught) in the book's shape. */
function storyRecipe(env, record, table) {
    const craft = table[record.craft] ? record.craft : craftOfRecipe(record, table, record.makes?.name);
    const def = defByName(env, record.makes?.name);
    return {
        id: record.id, name: record.name, source: 'story', craft, stat: statOf(record, craft, table), station: stationOf(record, craft, table),
        dc: record.dc, minutes: record.minutes, qty: 1, known: false, teaches: [], from: record.from ?? '',
        materials: list(record.materials).map(part => ({ id: defByName(env, part.name)?.id ?? null, name: part.name, qty: part.qty })),
        makes: { id: def?.id ?? null, name: record.makes.name, def: def ?? null }, rarity: record.rarity ?? 'common',
    };
}

/** The crafts in use (the packs' `crafts` records over the built-in ones). */
export const tableOf = env => craftTable(env.content('crafts'));

/** Every recipe there is: the packs' (in pack order), then the story's; [{ …book shape }]. */
export function recipes(env) {
    const table = tableOf(env);
    const out = env.content('recipes').filter(record => typeof record.id === 'string' && record.name).map(record => packRecipe(env, record, table));
    const taught = Object.values(env.craft?.taught ?? {}).filter(isRecord).sort((a, b) => (a.rev ?? 0) - (b.rev ?? 0));
    for (const record of taught) out.push(storyRecipe(env, record, table));
    return out;
}

/** The recipe a name means (by its name, else by what it makes), or null. */
export function findRecipe(book, name, among = null) {
    const pool = among ?? book;
    const key = nameKey(name);
    if (!key) return null;
    return pool.find(recipe => sameName(recipe.name, name)) ?? pool.find(recipe => sameName(recipe.makes?.name, name)) ?? null;
}

/** What a member knows: [{ ...recipe, from }] (the basics, less any forgotten, then what was learned). */
export function knownBy(env, actorId, book = recipes(env)) {
    const known = env.craft?.known ?? {};
    const forgot = env.craft?.forgot ?? {};
    const out = [];
    for (const recipe of book) {
        const key = knowKey(actorId, recipe.id);
        if (Object.hasOwn(known, key)) out.push({ ...recipe, from: known[key].from ?? '' });
        else if (recipe.known && !Object.hasOwn(forgot, key)) out.push({ ...recipe, from: 'known from the start' });
    }
    return out;
}

// ---------------------------------------------------------------------------------------
// Where the party is

/** The place as the scene has it, and its pack place when a pack names it. */
export function placeOf(env) {
    const place = env.ask('scene.place', {}) ?? env.scene?.place ?? {};
    const name = String(place?.name ?? '');
    const packPlace = name ? env.content('places').find(entry => sameName(entry.name, name) || list(entry.aliases).some(alias => sameName(alias, name))) ?? null : null;
    return { place: { name, kind: String(place?.kind ?? '') }, packPlace };
}

/** The stations here (rules.js stationsHere); `made`: a station the line says was made (a campfire). */
export function stationsOf(env, made = []) {
    return stationsHere({ ...placeOf(env), made });
}

// ---------------------------------------------------------------------------------------
// What a member has

/** The stacks a member may craft from: their own and the party's shared bag, not worn, oldest first. */
export function stacksFor(env, actorId) {
    const stacks = Object.values(env.inventory?.stacks ?? {});
    const mine = stack => stack.owner === actorId ? 0 : 1;
    return stacks.filter(stack => isRecord(stack) && stack.qty > 0 && !stack.equipped && (stack.owner === actorId || stack.owner === 'party'))
        .sort((a, b) => (mine(a) - mine(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Whether a stack's def is a recipe's material: the same def id, else the same name. */
function matches(env, stack, part) {
    if (part.id && stack.def === part.id) return true;
    const def = env.inventory?.defs?.[stack.def];
    return Boolean(def) && sameName(def.name, part.name);
}

/** The materials as had: [{ name, need, have, def, takes: [{ stack, qty }] }]; a stack counts for one line only. */
export function materialsFor(env, actorId, recipe) {
    const left = new Map(stacksFor(env, actorId).map(stack => [stack.id, stack.qty]));
    const stacks = stacksFor(env, actorId);
    return recipe.materials.map(part => {
        let need = part.qty;
        let have = 0;
        const takes = [];
        let def = part.id ? defById(env, part.id) : null;
        for (const stack of stacks) {
            if (!matches(env, stack, part)) continue;
            const free = left.get(stack.id) ?? 0;
            if (!free) continue;
            have += free;
            def ??= env.inventory?.defs?.[stack.def] ?? null;
            const take = Math.min(free, need);
            if (take > 0) {
                takes.push({ stack: stack.id, qty: take, def: stack.def });
                left.set(stack.id, free - take);
                need -= take;
            }
        }
        def ??= defByName(env, part.name);
        return { name: part.name, need: part.qty, have, def, takes };
    });
}

// ---------------------------------------------------------------------------------------
// Code's modifiers

/** The member's craft rank: { rank, uses, toNext, max } for `craft`. */
export function rankFor(env, actorId, craft, rules) {
    return rankOf(usesOf(env.craft)[actorId]?.[craft] ?? 0, rules);
}

/**
 * The modifiers of a craft for a member, by the rule (rules.js): [{ source, amount, reason }]: the
 * stat and what the checks part counts for crafting (its `checks.modifiers` query: tools, a talent, a
 * skill, at most +3), the craft's rank, the station's bonus, the materials' quality.
 */
export function modifiersFor(env, actor, recipe, { station = null, parts = [], rules = DEFAULT_RULES } = {}) {
    const out = [];
    const counted = env.ask('checks.modifiers', { actor: actor.id, skill: `craft ${recipe.craft}`, stat: recipe.stat });
    if (Array.isArray(counted) && counted.length) {
        for (const entry of counted) {
            if (isRecord(entry) && Number.isInteger(entry.amount)) out.push({ source: entry.source === 'stat' ? 'stat' : entry.source, amount: entry.amount, reason: clip(entry.reason, 60) || recipe.stat });
        }
    } else {
        const value = actor?.stats?.[recipe.stat];
        out.push({ source: 'stat', amount: checkModifier(Number.isFinite(value) ? value : rules.character.startStat, rules), reason: recipe.stat });
    }
    const rank = rankFor(env, actor.id, recipe.craft, rules).rank;
    if (rank) out.push({ source: 'rank', amount: rank, reason: `${recipe.craft} rank ${rank}` });
    if (station?.bonus) out.push({ source: 'station', amount: station.bonus, reason: clip(station.from || STATIONS[station.key]?.name || 'station', 60) });
    const quality = materialBonus(parts.map(part => ({ qty: part.need, def: part.def })));
    if (quality) out.push({ source: 'materials', amount: quality, reason: 'material quality' });
    return out;
}

export const sumOf = modifiers => modifiers.reduce((sum, entry) => sum + entry.amount, 0);

/**
 * A craft before the dice: { recipe, station: { key, name, here, bonus, from } | null, parts, modifiers,
 * mod, dc, chances, ready, why, code }. `made`: stations the line says were made (a campfire).
 */
export function planOf(env, actor, recipe, { made = [], rules = DEFAULT_RULES, here = null } = {}) {
    const stations = here ?? stationsOf(env, made);
    const station = recipe.station ? { key: recipe.station, name: STATIONS[recipe.station]?.name ?? recipe.station, here: Object.hasOwn(stations, recipe.station), bonus: stations[recipe.station]?.bonus ?? 0, from: stations[recipe.station]?.from ?? '' } : null;
    const parts = materialsFor(env, actor.id, recipe);
    const modifiers = modifiersFor(env, actor, recipe, { station: station?.here ? station : null, parts, rules });
    const mod = sumOf(modifiers);
    const missing = parts.filter(part => part.have < part.need);
    let why = '';
    let code = '';
    if (station && !station.here) {
        why = `${cap(recipe.craft)} needs ${station.name}, and there is none here.`;
        code = 'REFUSED';
    } else if (missing.length) {
        why = `Missing ${missing.map(part => `${part.need - part.have} ${part.name}`).join(', ')}.`;
        code = 'NOT_ENOUGH';
    }
    return { recipe, station, parts, modifiers, mod, dc: recipe.dc, chances: chancesOf(mod, recipe.dc), ready: !why, why, code };
}

const cap = text => String(text).charAt(0).toUpperCase() + String(text).slice(1);
