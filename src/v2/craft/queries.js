// RPG Battle v2, part **craft**: its queries (read-only, plain copies) and the tail's crafting line.
//
// * `craft.view {}` → the Crafting screen's data (RPG Battle's screens part draws it, read-only):
//   { people: [{ id, name, you, skills: [{ craft, rank, uses, toNext, max }], count, recipes: [{ id, name,
//   craft, from, station?: { name, here }, materials: [{ name, need, have }], chances: { fail, normal,
//   fine, masterwork } (whole percents; a natural 1 is in fail), dc, mod, ready, why? }] }] }, your
//   character first.
// * `craft.known { actor? }` → the recipes a member knows (your character's when unsaid).
// * `craft.recipes {}` → every recipe there is (packs', then the story's).
// * `craft.last {}` → the latest reply's crafts, for its card: { carrier, rev, results: [{ id, actor,
//   name, text, quality, qualityText, item, mismatch, note }] } or null.
// * `craft.log {}` → the crafts kept, oldest first.
// * `craft.rollsUsed { carrier }` → the roll each of that reply's crafts took, in order (0: rolled by
//   code), so the checks part counts them in its place and a check after a craft takes the next roll.
// * `craft.skills { actor? }` → [{ craft, rank, uses, toNext, max }] for a member.

import { madeEntries, usesOf } from './domain.js';
import { envOfState, knownBy, planOf, recipes, rulesOf, stationsOf, tableOf } from './book.js';
import { CRAFT_TALK, FEATURE, QUALITY_TEXT, rankOf } from './rules.js';

const copy = value => JSON.parse(JSON.stringify(value ?? null));
const list = value => (Array.isArray(value) ? value : []);

function people(env) {
    const pc = env.ask('party.pc', {});
    if (!pc) return { pc: null, actors: [] };
    const actors = list(env.ask('party.actors', {}));
    return { pc, actors: actors.length ? actors : [pc] };
}

function skillsOf(env, actorId, rules) {
    const uses = usesOf(env.craft)[actorId] ?? {};
    return Object.keys(tableOf(env)).map(craft => ({ craft, ...rankOf(uses[craft] ?? 0, rules) }));
}

function recipeRow(plan, recipe) {
    const row = {
        id: recipe.id, name: recipe.name, craft: recipe.craft, from: recipe.from ?? '',
        materials: plan.parts.map(part => ({ name: part.name, need: part.need, have: part.have })),
        chances: plan.chances, dc: plan.dc, mod: plan.mod, ready: plan.ready,
    };
    if (plan.station) row.station = { name: plan.station.name, here: plan.station.here };
    if (plan.why) row.why = plan.why;
    return row;
}

/** The Crafting screen's data (see the head). */
export function view(state, args = {}, tools = null) {
    const env = envOfState(state, tools?.query);
    const rules = rulesOf(tools?.settings ?? args?.settings ?? null);
    const { pc, actors } = people(env);
    const book = recipes(env);
    const here = stationsOf(env, [], book);
    return copy({
        people: actors.map(actor => {
            const recipes = knownBy(env, actor.id, book).map(recipe => recipeRow(planOf(env, actor, recipe, { rules, here }), recipe));
            return { id: actor.id, name: actor.name, you: actor.id === pc?.id, skills: skillsOf(env, actor.id, rules), count: recipes.length, recipes };
        }),
    });
}

export function known(state, args = {}, tools = null) {
    const env = envOfState(state, tools?.query);
    const actor = args?.actor ? env.ask('party.actor', { id: args.actor }) : env.ask('party.pc', {});
    if (!actor) return [];
    return copy(knownBy(env, actor.id).map(recipe => ({ id: recipe.id, name: recipe.name, craft: recipe.craft, dc: recipe.dc, source: recipe.source, from: recipe.from, makes: recipe.makes?.name ?? '' })));
}

export function all(state, args = {}, tools = null) {
    const env = envOfState(state, tools?.query);
    return copy(recipes(env).map(recipe => ({
        id: recipe.id, name: recipe.name, craft: recipe.craft, stats: recipe.stats, stations: recipe.stations, dc: recipe.dc, minutes: recipe.minutes,
        known: recipe.known, source: recipe.source, makes: recipe.makes?.name ?? '', materials: recipe.materials.map(part => ({ name: part.name, qty: part.qty })),
    })));
}

export function last(state) {
    const entries = madeEntries(state?.domains?.craft);
    const newest = entries.at(-1);
    if (!newest) return null;
    const results = entries.filter(entry => entry.carrier === newest.carrier).map(entry => ({
        id: entry.id, actor: entry.actor, name: entry.name, text: entry.text, quality: entry.quality, qualityText: QUALITY_TEXT[entry.quality],
        item: entry.item?.name ?? '', mismatch: entry.mismatch ?? '', note: entry.note ?? '',
    }));
    return copy({ carrier: newest.carrier, rev: newest.rev, results });
}

export const log = state => copy(madeEntries(state?.domains?.craft));

export function rollsUsed(state, args = {}) {
    const carrier = String(args?.carrier ?? '');
    return madeEntries(state?.domains?.craft).filter(entry => entry.carrier === carrier).map(entry => (Number.isInteger(entry.roll) ? entry.roll : 0));
}

export function skills(state, args = {}, tools = null) {
    const env = envOfState(state, tools?.query);
    const actor = args?.actor ? env.ask('party.actor', { id: args.actor }) : env.ask('party.pc', {});
    return actor ? copy(skillsOf(env, actor.id, rulesOf(tools?.settings ?? null))) : [];
}

const tagged = fn => Object.assign(fn, { feature: FEATURE });

export const queries = {
    'craft.view': tagged(view),
    'craft.known': tagged(known),
    'craft.recipes': tagged(all),
    'craft.last': tagged(last),
    'craft.log': tagged(log),
    'craft.rollsUsed': tagged(rollsUsed),
    'craft.skills': tagged(skills),
};

// ---------------------------------------------------------------------------------------
// The tail

const TAIL_PEOPLE = 3;
const TAIL_RECIPES = 4;
const signed = amount => (amount < 0 ? `−${-amount}` : `+${amount}`);

function settingsOf(view) {
    try {
        const value = typeof view?.settings === 'function' ? view.settings() : view?.settings;
        return value && typeof value === 'object' ? value : null;
    } catch {
        return null;
    }
}

/**
 * The tail's crafting lines, only when crafting is likely: at a station worth telling (a forge, an
 * alchemy bench, an enchanting table, an inn's kitchen, a camp), or when the reader's message speaks
 * of crafting. Each member who knows a recipe: up to 4 of them with code's modifier against the DC
 * (or why not here), then how a craft is rolled. Nothing when crafting is off or nobody knows one.
 */
export function tail(view) {
    if (typeof view?.feature === 'function' && view.feature(FEATURE) === false) return { lines: [], optional: [] };
    const env = envOfState(view?.state, typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null);
    const here = stationsOf(env);
    const atStation = Object.values(here).some(station => station.notable);
    const said = String(view?.chat?.lastUser ?? '').slice(0, 2000).toLowerCase();
    if (!atStation && !CRAFT_TALK.test(said)) return { lines: [], optional: [] };
    const { actors } = people(env);
    if (!actors.length) return { lines: [], optional: [] };
    const rules = rulesOf(settingsOf(view));
    const book = recipes(env);
    const parts = [];
    for (const actor of actors) {
        const plans = knownBy(env, actor.id, book).map(recipe => planOf(env, actor, recipe, { rules, here }));
        if (!plans.length) continue;
        plans.sort((a, b) => Number(b.ready) - Number(a.ready));
        const shown = plans.slice(0, TAIL_RECIPES).map(plan => `${plan.recipe.name} (${plan.recipe.craft}) ${signed(plan.mod)} vs DC ${plan.dc}${plan.ready ? '' : plan.station && !plan.station.here ? `, needs ${plan.station.name}` : ', materials short'}`);
        const more = plans.length > TAIL_RECIPES ? `, and ${plans.length - TAIL_RECIPES} more` : '';
        parts.push(`${actor.name}: ${shown.join('; ')}${more}`);
        if (parts.length >= TAIL_PEOPLE) break;
    }
    if (!parts.length) return { lines: [], optional: [] };
    return {
        lines: [
            `[Crafting] ${parts.join(' · ')}.`,
            '[Crafting] A craft is an uncertain attempt: it takes the reply\'s next roll; d20 + modifier against the DC: short of it fails (half the materials lost), 0–4 over made, 5–9 fine, 10+ or a natural 20 masterwork; a natural 1 ruins it all.',
        ],
        optional: [],
    };
}
