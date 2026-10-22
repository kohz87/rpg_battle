// RPG Battle v2, part **craft**: learning, forgetting and crafting (MODULES §F102), as commands
// and as the story's change lines.
//
// * `+ recipe Iron Sword | from: Hollis | who: Lyra` teaches a pack recipe, found by its name (a
//   recipe whose `teaches` names who may teach it is learned only from one of them). A recipe the
//   packs do not have is taught by the story when the line says what it makes and from what:
//   `+ recipe Ember Tonic | makes: Ember Tonic | with: Fire Salt x2, Water Flask | craft: alchemy`.
//   It is kept for this chat only, and code sets its DC from what it makes (that item's rarity, else
//   the materials', never above epic) or a rank written on the line (`rank: D`), whichever is higher.
//   `- recipe Iron Sword | who: Lyra` forgets one. Nobody learns or forgets anything else.
// * `! craft Iron Sword | with: Iron Ore x2 | by: Lyra | roll: 1 | result: fine`: someone crafts a
//   recipe they know. Code checks the station (rules.js), that the materials are there (their own
//   and the party's bag), takes the reply's roll by its place among the reply's checks and crafts
//   (F80, positional: the first uncertain attempt takes Roll 1, the next Roll 2, whatever the line
//   names), adds its modifiers (book.js) and decides the quality (rules.js). It consumes the
//   materials (a fail: half of them; a natural 1: all, and a botched item), makes the item (the
//   quality's numbers, the materials' elements, worth what went into it; trade's resale cap set to
//   what the materials would fetch), counts a use of the craft, and moves the clock on by the
//   recipe's minutes (Story Director's `director.advance`; without it no story time passes, and the
//   receipt says so). A story quality that disagrees with the dice is flagged on the reply's card
//   (`craft.last`) and in the receipt. Refused (nothing consumed): an unknown recipe, a recipe the
//   crafter does not know, no station, missing materials, a third craft in one reply.
//
// The commands `craft.learn`, `craft.forget` and `craft.make` are the same rules for templates and
// tests: never from a reader's click (F95, F96: crafting is the story's). The trade part's
// `craft.commission` and `craft.collect` (having a crafter make something for a fee) are unchanged.

import { KEEPER, advanceClock, consume, grant, keepPaid, scaleOf, tryQuery } from './calls.js';
import { MAX_KNOWN_EACH, MAX_MATERIALS, MAX_MADE, MAX_PER_REPLY, MAX_TAUGHT, draftCraft, knowKey, madeEntries, prune, usesOf } from './domain.js';
import { defByName, envOfCtx, findRecipe, knownBy, planOf, recipes, rulesOf, tableOf } from './book.js';
import { STORY_WORTH_TIMES, baseOutput, fitToWorth, inputWorth, junkDef, outputDef, outputWorth, qualityWithin } from './make.js';
import {
    DC_BY_RARITY, QUALITY_TEXT, clip, craftKey, dcOfRank, halfOf, mismatchOf, nameKey, qualityOf, saidQuality, slugOf, stationKey, usesToMax,
} from './rules.js';
import { RARITIES } from '../../rules.js';
import { slotFromWord } from '../../items.js';
import { storyRarity } from '../limits.js';
import { clipped } from '../lines.js';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Rejects the command (ctx.fail throws); a ctx without it still gets a coded throw. */
export function fail(ctx, code, message) {
    if (typeof ctx?.fail === 'function') ctx.fail(code, message);
    const error = new Error(message);
    error.code = code;
    throw error;
}

const revOf = ctx => (Number.isInteger(ctx?.rev) ? ctx.rev : 0);

function notFromScreen(ctx) {
    if (ctx?.cause === 'ui') fail(ctx, 'REFUSED', 'Crafting is told by the story: write it in the reply, not from a screen.');
}

/** The member a line names (`who:`, `by:`), else your character. */
function actorOf(ctx, who) {
    const name = clip(who, 60);
    if (name) return tryQuery(ctx, 'party.actor', { name }) ?? fail(ctx, 'NOT_FOUND', `${name} is not in the party.`);
    return tryQuery(ctx, 'party.pc', {}) ?? fail(ctx, 'NOT_FOUND', 'Make your character first.');
}

/** "Iron Ore x2, Coal, 3 Leather Strips" → [{ name, qty }] (at most MAX_MATERIALS; the same name added up). */
export function parseMaterials(text) {
    const out = [];
    for (const raw of String(text ?? '').slice(0, 400).split(/\s*(?:,|;|\+|&|\band\b)\s*/i)) {
        const piece = raw.replace(/[*_`.]/g, '').trim();
        if (!piece) continue;
        const lead = /^(\d{1,3})\s*[x×]?\s+(.+)$/i.exec(piece);
        const tail = /^(.+?)\s*[x×]\s*(\d{1,3})$/i.exec(piece);
        const qty = lead ? Number(lead[1]) : tail ? Number(tail[2]) : 1;
        const name = clip((lead ? lead[2] : tail ? tail[1] : piece).replace(/^(?:an?|the|one|some)\s+/i, ''), 80);
        if (!name) continue;
        const same = out.find(entry => nameKey(entry.name) === nameKey(name));
        if (same) same.qty = Math.min(99, same.qty + qty);
        else out.push({ name, qty: Math.max(1, Math.min(99, qty)) });
    }
    return out.slice(0, MAX_MATERIALS);
}

/** A new `cr_xxxxxxxx` id no craft or use has: ctx.id when the host offers it, else the receipt's dice. */
function newId(ctx, craft) {
    const taken = id => Object.hasOwn(craft.made, id) || Object.hasOwn(craft.uses, id);
    for (let guard = 0; guard < 100; guard++) {
        let id = typeof ctx?.id === 'function' ? ctx.id('cr') : null;
        if (typeof id !== 'string' || !/^cr_[0-9a-z]{8}$/.test(id)) {
            id = 'cr_';
            for (let n = 0; n < 8; n++) id += BASE36[Math.floor(ctx.rng() * 36) % 36];
        }
        if (!taken(id)) return id;
    }
    return fail(ctx, 'FAILED', 'No free id could be made.');
}

// ---------------------------------------------------------------------------------------
// Learning and forgetting

const fromOf = value => clip(value, 60) || 'the story';

// Words that name nobody: "the lay sealer at the yard" and "the lay sealer at the Salt-and-Ash Yard" share "sealer".
const PLAIN_WORDS = new Set(['the', 'and', 'at', 'of', 'a', 'an', 'or', 'from', 'as', 'by', 'with', 'in', 'on', 'to', 'for', 'work', 'old', 'his', 'her', 'their']);
const wordsOf = text => nameKey(text).split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3 && !PLAIN_WORDS.has(word));

/** Whether `from` (what the line says taught it) is the pack's `teaches`: one name word in common. */
export function teachesFrom(teaches, from) {
    const theirs = new Set(wordsOf(teaches));
    return wordsOf(from).some(word => theirs.has(word));
}

/**
 * craft.learn { name, who?, from?, makes?, with?, craft?, rank?, slot? }: a pack recipe by its name, or a
 * story-taught one (makes + with), for `who` (your character when unsaid).
 */
export function learn(ctx, request = {}) {
    const actor = actorOf(ctx, request.who);
    const name = clip(request.name, 80);
    if (!name) fail(ctx, 'INVALID', 'Name the recipe: `+ recipe Iron Sword | from: Hollis`.');
    const env = envOfCtx(ctx);
    const book = recipes(env);
    const from = fromOf(request.from);
    // A pack's recipe, or one the story already taught in this chat, by its name only.
    let recipe = book.find(entry => nameKey(entry.name) === nameKey(name)) ?? null;
    const craft = draftCraft(ctx);
    let taughtNew = null;
    if (recipe?.source === 'pack' && recipe.teaches.length && !recipe.teaches.some(who => teachesFrom(who, from))) {
        fail(ctx, 'REFUSED', `${recipe.name} is taught only by ${recipe.teaches.join(' or ')}.`);
    }
    if (!recipe) {
        const makes = clip(request.makes, 80);
        const materials = parseMaterials(request.with);
        if (!makes || !materials.length) fail(ctx, 'REFUSED', `There is no recipe called ${name} in the packs. A recipe the story teaches says what it makes and from what: \`+ recipe ${name} | makes: Item | with: Material x2, Material | craft: alchemy\`.`);
        const table = tableOf(env);
        const said = clip(request.craft, 40);
        const kind = craftKey(said, table) ?? (said ? null : craftKey(makes, table) ?? craftKey(name, table));
        if (!kind) fail(ctx, 'INVALID', `${said ? `${said} is not a craft` : 'Say the craft'}: ${Object.keys(table).join(', ')}.`);
        if (Object.keys(craft.taught).length >= MAX_TAUGHT) fail(ctx, 'REFUSED', `This chat keeps ${MAX_TAUGHT} story-taught recipes at most.`);
        const rarity = rarityOfStoryOutput(env, makes, materials);
        // RX-E-3: an item a pack or the inventory already has may be named only when it is worth at most
        // STORY_WORTH_TIMES × what it is made from (a material nobody has priced yet counts as nothing).
        const named = defByName(env, makes);
        if (named) {
            const settings = rulesOf(ctx.settings?.() ?? null);
            const level = Number.isInteger(actor.level) && actor.level > 0 ? actor.level : 1;
            const scale = scaleOf((n, a) => tryQuery(ctx, n, a));
            const inputs = inputWorth(materials.map(part => ({ def: defByName(env, part.name), qty: part.qty })), { level, rules: settings, scale }).worth;
            const worth = outputWorth(baseOutput({ name, makes: { name: makes, def: named }, craft: kind }, []), 'normal', { level, rules: settings, scale, def: named });
            if (worth > Math.floor(STORY_WORTH_TIMES * inputs)) {
                fail(ctx, 'REFUSED', `${clip(named.name, 80)} is worth ${worth}, more than ${STORY_WORTH_TIMES}× what ${materials.map(part => part.name).join(', ')} ${materials.length === 1 && materials[0].qty === 1 ? 'is' : 'are'} worth (${inputs}): a recipe the story teaches cannot make it from that.`);
            }
        }
        const rankDc = dcOfRank(request.rank);
        const dc = Math.max(DC_BY_RARITY[rarity], rankDc ?? 0);
        let id = `story/${slugOf(name)}`;
        for (let n = 2; Object.hasOwn(craft.taught, id); n += 1) id = `story/${slugOf(name).slice(0, 44)}-${n}`;
        const slot = slotFromWord(clip(request.slot, 20)) ?? null;
        taughtNew = { id, name, craft: kind, makes: { name: makes, ...(slot ? { slot } : {}) }, materials, dc, minutes: table[kind]?.minutes ?? 60, rarity, from, rev: revOf(ctx) };
        recipe = { id, name, craft: kind, dc, known: false, source: 'story' };
    }
    const key = knowKey(actor.id, recipe.id);
    if (knownBy(env, actor.id, book).some(entry => entry.id === recipe.id)) fail(ctx, 'REFUSED', `${actor.name} already knows ${recipe.name}.`);
    if (Object.values(craft.known).filter(entry => entry?.actor === actor.id).length >= MAX_KNOWN_EACH) fail(ctx, 'REFUSED', `${actor.name} knows ${MAX_KNOWN_EACH} recipes already: forget one first.`);
    if (taughtNew) craft.taught[taughtNew.id] = taughtNew;
    if (Object.hasOwn(craft.forgot, key)) delete craft.forgot[key];
    // A basic recipe (known by everyone) forgotten and learned again needs only the forgetting undone.
    if (!recipe.known) craft.known[key] = { actor: actor.id, recipe: recipe.id, name: recipe.name, from, rev: revOf(ctx) };
    const what = taughtNew ? ` (${taughtNew.craft}, DC ${taughtNew.dc}, made from ${taughtNew.materials.map(part => `${part.qty > 1 ? `${part.qty} ` : ''}${part.name}`).join(', ')})` : '';
    return {
        summary: `${actor.name} learns the recipe for ${recipe.name}${from !== 'the story' ? ` from ${from}` : ''}${what}.`,
        data: { actor: actor.id, recipe: recipe.id, name: recipe.name, from, story: Boolean(taughtNew), craft: recipe.craft, dc: recipe.dc },
        narrate: false,
    };
}

/** The rarity a story-taught recipe's item has: its def's when one exists, else its materials' (best, one up for 3 of it), never legendary. */
function rarityOfStoryOutput(env, makes, materials) {
    const def = defByName(env, makes);
    if (RARITIES.includes(def?.rarity)) return storyRarity(def.rarity);
    const rarities = materials.map(part => ({ qty: part.qty, rarity: RARITIES.includes(defByName(env, part.name)?.rarity) ? defByName(env, part.name).rarity : 'common' }));
    const top = rarities.reduce((best, part) => (RARITIES.indexOf(part.rarity) > RARITIES.indexOf(best) ? part.rarity : best), 'common');
    const atTop = rarities.filter(part => part.rarity === top).reduce((sum, part) => sum + part.qty, 0);
    return storyRarity(RARITIES[Math.min(RARITIES.length - 1, RARITIES.indexOf(top) + (atTop >= 3 ? 1 : 0))]);
}

/** craft.forget { name, who? }: a recipe forgotten (a basic one stays forgotten until learned again). */
export function forget(ctx, request = {}) {
    const actor = actorOf(ctx, request.who);
    const name = clip(request.name, 80);
    if (!name) fail(ctx, 'INVALID', 'Name the recipe: `- recipe Iron Sword`.');
    const env = envOfCtx(ctx);
    const recipe = findRecipe([], name, knownBy(env, actor.id)) ?? fail(ctx, 'REFUSED', `${actor.name} does not know a recipe called ${name}.`);
    const craft = draftCraft(ctx);
    const key = knowKey(actor.id, recipe.id);
    if (Object.hasOwn(craft.known, key)) delete craft.known[key];
    if (recipe.known) craft.forgot[key] = { actor: actor.id, recipe: recipe.id, rev: revOf(ctx) };
    return { summary: `${actor.name} forgets the recipe for ${recipe.name}.`, data: { actor: actor.id, recipe: recipe.id, name: recipe.name }, narrate: false };
}

// ---------------------------------------------------------------------------------------
// The dice (the checks part's, by its queries)

/**
 * The key one reply's crafts and checks share: its record id (`s:<sid>`), else its carrier
 * ("index:swipe"), else the receipt's rev: the checks part's own rule (checks/commands.js replyKey).
 */
export function replyKey(ctx, prepared) {
    if (typeof ctx?.carrier?.sid === 'string' && ctx.carrier.sid) return `s:${ctx.carrier.sid.slice(0, 36)}`;
    if (typeof ctx?.carrier?.key === 'string') return ctx.carrier.key.slice(0, 40);
    if (Number.isInteger(ctx?.carrier?.index)) return `${ctx.carrier.index}:${Number.isInteger(ctx.carrier.swipe) ? ctx.carrier.swipe : 0}`;
    return prepared ? `r${prepared.for ?? 'x'}:${prepared.rev}` : `rev${revOf(ctx)}`;
}

/** The rolls handed over for this reply: the latest when it is this reply's, else this index's (checks.rolls). */
function rollsFor(ctx) {
    const index = ctx?.carrier?.index;
    const latest = tryQuery(ctx, 'checks.rolls', {});
    if (!latest || !Number.isInteger(index) || latest.for === null || latest.for === index || latest.for === index + 1) return latest;
    return tryQuery(ctx, 'checks.rolls', { for: index }) ?? latest;
}

const ORDINALS = ['first', 'second', 'third', 'fourth'];

function d20(ctx) {
    const rolled = typeof ctx.roll === 'function' ? ctx.roll('1d20') : null;
    const value = typeof rolled === 'number' ? rolled : rolled?.dice?.[0] ?? rolled?.total;
    if (Number.isInteger(value) && value >= 1 && value <= 20) return value;
    return Math.floor(ctx.rng() * 20) + 1;
}

/**
 * The die a craft takes: by its place among the reply's uncertain attempts (its checks and crafts so
 * far), F80's positional rule; what the line names never picks another die (a note says so).
 * → { roll (0: rolled by code), die, note, key }.
 */
function dieFor(ctx, craft, written) {
    const prepared = rollsFor(ctx);
    const key = replyKey(ctx, prepared);
    const checks = (tryQuery(ctx, 'checks.log', {}) ?? []).filter(entry => isRecord(entry) && entry.carrier === key);
    const crafts = madeEntries(craft).filter(entry => entry.carrier === key);
    if (crafts.length >= MAX_PER_REPLY) return { refused: true, key };
    const used = new Set([...checks, ...crafts].map(entry => entry.roll).filter(roll => Number.isInteger(roll) && roll > 0));
    const place = checks.length + crafts.length + 1;
    const rolls = Array.isArray(prepared?.rolls) ? prepared.rolls : [];
    if (!rolls.length) return { roll: 0, die: d20(ctx), note: 'no dice were handed over for this reply: code rolled', key };
    if (place > rolls.length || used.has(place)) return { roll: 0, die: d20(ctx), note: 'every roll handed over was used: code rolled', key };
    const die = rolls[place - 1];
    const number = Number.parseInt(/(\d+)/.exec(String(written ?? ''))?.[1] ?? '', 10);
    let note = '';
    const nth = ORDINALS[place - 1] ?? `${place}th`;
    if (!Number.isInteger(number)) note = `no roll was named: Roll ${place} taken`;
    else if (number >= 1 && number <= rolls.length) {
        if (number !== place && die !== number) note = `the line named Roll ${number}, but this is the reply's ${nth} uncertain attempt: Roll ${place} taken`;
    } else if (number !== die) note = `${number} is not a roll that was handed over: Roll ${place} taken`;
    return { roll: place, die, note, key };
}

// ---------------------------------------------------------------------------------------
// Crafting

/**
 * The materials as they count toward what the item is worth: a key item (a story gift, a stack with
 * `key: true`) counts for nothing, so gift → craft → sell pays nothing.
 */
export const worthParts = parts => parts.map(part => ({ def: part.def, qty: part.takes.length ? part.takes.reduce((sum, take) => sum + (take.key ? 0 : take.qty), 0) : part.need }));

const plural = (qty, name) => (qty === 1 ? name : `${qty} ${name}`);
const signed = amount => (amount < 0 ? `−${-amount}` : `+${amount}`);

/**
 * craft.make { name, by?, with?, roll?, result?, at? }: the craft, with this reply's roll. See the
 * file's head for the rules.
 */
export function make(ctx, request = {}) {
    const actor = actorOf(ctx, request.by ?? request.who);
    const name = clip(request.name, 80);
    if (!name) fail(ctx, 'INVALID', 'Name what is crafted: `! craft Iron Sword | with: Iron Ore x2`.');
    const env = envOfCtx(ctx);
    const rules = rulesOf(ctx.settings?.() ?? null);
    const book = recipes(env);
    const known = knownBy(env, actor.id, book);
    const recipe = findRecipe(book, name, known);
    if (!recipe) {
        const any = findRecipe(book, name);
        if (any) fail(ctx, 'REFUSED', `${actor.name} does not know how to make ${any.name}: the story has to teach the recipe first (\`+ recipe ${any.name} | from: …\`).`);
        fail(ctx, 'NOT_FOUND', `There is no recipe for ${name}.`);
    }
    // A campfire can be made where the party is; a forge, a bench or a table cannot.
    const at = stationKey(request.at);
    const made = at === 'campfire' ? ['campfire'] : [];
    const plan = planOf(env, actor, recipe, { made, rules });
    if (!plan.ready) fail(ctx, plan.code || 'REFUSED', `${actor.name} cannot craft ${recipe.name}: ${plan.why}`);
    // RX-E-3: what a story-taught recipe makes is worth at most STORY_WORTH_TIMES × what goes into it, at
    // whatever quality the dice give (pack recipes are as their pack wrote them).
    const level = Number.isInteger(actor.level) && actor.level > 0 ? actor.level : 1;
    const scale = scaleOf((n, a) => tryQuery(ctx, n, a));
    const story = recipe.source === 'story';
    const cap = story ? Math.floor(STORY_WORTH_TIMES * inputWorth(worthParts(plan.parts), { level, rules, scale }).worth) : Infinity;
    const worthOptions = { level, rules, scale, def: recipe.makes?.def ?? null };
    // What code builds is sized to the cap (a masterwork of it fits); a pack's or the inventory's item is not.
    const built = baseOutput(recipe, plan.parts, { level, rules });
    const base = story && !recipe.makes?.def ? fitToWorth(built, cap, worthOptions) ?? built : built;
    if (story && outputWorth(base, 'normal', worthOptions) > cap) {
        fail(ctx, 'REFUSED', `${actor.name} cannot craft ${recipe.name}: ${base.name} is worth more than ${STORY_WORTH_TIMES}× what goes into it (${cap}).`);
    }

    const craft = draftCraft(ctx);
    const dice = dieFor(ctx, craft, request.roll);
    if (dice.refused) fail(ctx, 'REFUSED', `Only ${MAX_PER_REPLY} crafts count in one reply: ${recipe.name} was not made.`);
    const total = dice.die + plan.mod;
    const rolled = qualityOf(dice.die, total, plan.dc);
    const held = story && ['fine', 'masterwork'].includes(rolled) ? qualityWithin(base, rolled, cap, worthOptions) : rolled;
    const quality = held ?? 'normal';
    const said = saidQuality(request.result);
    const mismatch = mismatchOf(said, quality);
    const notes = [dice.note, quality !== rolled ? `held to ${QUALITY_TEXT[quality]}: the dice gave ${QUALITY_TEXT[rolled]}, but the materials are worth too little for more` : ''];
    const named = parseMaterials(request.with).filter(part => !recipe.materials.some(own => nameKey(own.name) === nameKey(part.name) || nameKey(own.name).replace(/s$/, '') === nameKey(part.name).replace(/s$/, '')));
    if (named.length) notes.push(`the recipe does not use ${named.map(part => part.name).join(', ')}`);
    if (request.at && !at) notes.push(`${clip(request.at, 30)} is not a station`);
    else if (at && at !== 'campfire') notes.push('a station is where the party is, not what the line says');

    // The materials: all of them, but half on a fail.
    const parts = plan.parts.map(part => ({ ...part, qty: part.need }));
    const losing = quality === 'fail' ? halfOf(parts) : parts.map(part => ({ ...part, lose: part.need }));
    const lost = [];
    for (const part of losing) {
        let left = part.lose;
        for (const take of part.takes) {
            if (left <= 0) break;
            const qty = Math.min(take.qty, left);
            consume(ctx, take.stack, qty);
            left -= qty;
        }
        if (part.lose > 0) lost.push({ name: part.name, qty: part.lose });
    }

    // The item made (or the botched one).
    let item = null;
    let qty = 0;
    let refine = 0;
    if (quality === 'normal' || quality === 'fine' || quality === 'masterwork') {
        const out = outputDef(recipe, quality, parts, { level, rules, scale, worthParts: worthParts(parts), base });
        qty = recipe.qty ?? 1;
        const granted = grant(ctx, out.def, qty, out.def.note);
        const defId = typeof granted?.data?.def === 'string' ? granted.data.def : out.def.id;
        // It never sells for more than its materials would have fetched (B-b3-13): no value made from nothing.
        const { fetch } = inputWorth(worthParts(parts), { level, rules, scale });
        keepPaid(ctx, defId, Math.floor(fetch / Math.max(1, qty)));
        item = { def: defId, name: out.def.name };
        refine = out.refine;
    } else if (quality === 'ruined') {
        const junk = junkDef(recipe, parts, { level, rules });
        const granted = grant(ctx, junk, 1, junk.note);
        item = { def: typeof granted?.data?.def === 'string' ? granted.data.def : junk.id, name: junk.name };
        qty = 1;
        keepPaid(ctx, item.def, 0);
    }

    const id = newId(ctx, craft);
    const rev = revOf(ctx);
    // One use of the craft (a fail teaches too); none kept past the top rank.
    const had = usesOf(craft)[actor.id]?.[recipe.craft] ?? 0;
    if (had < usesToMax(rules)) craft.uses[id] = { actor: actor.id, craft: recipe.craft, rev };
    const minutes = recipe.minutes ?? 0;
    const modText = plan.modifiers.map(entry => `${entry.reason} ${signed(entry.amount)}`).join(', ');
    const dieText = dice.roll ? `Roll ${dice.roll} = ${dice.die}` : `d20 ${dice.die}`;
    const text = clip(`${recipe.name} (${recipe.craft}): ${dieText}${modText ? `, ${modText}` : ''} → ${total} against DC ${plan.dc}: ${QUALITY_TEXT[quality]}`, 300);
    craft.made[id] = {
        id, actor: actor.id, name: clip(actor.name, 80), recipe: recipe.id, recipeName: recipe.name, craft: recipe.craft, carrier: dice.key, rev,
        roll: dice.roll, die: dice.die, modifiers: plan.modifiers, mod: plan.mod, dc: plan.dc, total, quality, said, mismatch,
        note: clip(notes.filter(Boolean).join('; '), 200), item, qty, lost, refine, minutes, text,
    };
    prune(craft.made, MAX_MADE, id);

    const clock = advanceClock(ctx, minutes, `${actor.name} crafts ${recipe.name}`);
    const madeText = item ? ` Made ${plural(qty, item.name)}.` : '';
    const lostText = lost.length ? ` ${quality === 'fail' ? 'Lost' : 'Used'} ${lost.map(part => plural(part.qty, part.name)).join(', ')}.` : '';
    const flag = mismatch ? ` The story ${mismatch.replace(/^narrated/, 'narrated it')}.` : '';
    return {
        summary: `${actor.name} crafts ${text}.${madeText}${lostText}${minutes ? (clock ? ` It took ${minutes} minutes.` : ` No story time passes (no story clock moves here; it would take ${minutes} minutes).`) : ''}${flag}`,
        data: {
            craft: id, actor: actor.id, recipe: recipe.id, kind: recipe.craft, roll: dice.roll, die: dice.die, modifiers: JSON.parse(JSON.stringify(plan.modifiers)), mod: plan.mod,
            dc: plan.dc, total, quality, said, mismatch, note: craft.made[id].note, item, qty, lost, refine, minutes, clock, owner: KEEPER, carrier: dice.key,
        },
        narrate: Boolean(mismatch),
    };
}

// ---------------------------------------------------------------------------------------
// Change lines

const labelsOf = line => {
    const out = {};
    for (const [key, value] of Object.entries(isRecord(line?.labels) ? line.labels : {})) out[nameKey(key)] = String(value ?? '').trim();
    return out;
};

/** `+ recipe …` learns, `- recipe …` forgets. */
function applyRecipe(ctx, line) {
    const labels = labelsOf(line);
    const request = {
        name: line?.name, who: labels.who ?? labels.by ?? labels.learner ?? null,
        from: labels.from ?? labels['taught by'] ?? labels.teacher ?? (String(line?.text ?? '').replace(/^from\s+/i, '') || null),
        makes: labels.makes ?? null, with: labels.with ?? labels.materials ?? null, craft: labels.craft ?? null, rank: labels.rank ?? null, slot: labels.slot ?? null,
    };
    if (line?.op === '-') return forget(ctx, request);
    if (line?.op === '+' || line?.op === '~' || !line?.op) return learn(ctx, request);
    return fail(ctx, 'INVALID', 'A recipe is learned with `+ recipe` and forgotten with `- recipe`.');
}

/** `! craft …` */
function applyCraft(ctx, line) {
    const labels = labelsOf(line);
    return make(ctx, {
        name: line?.name, by: labels.by ?? labels.who ?? labels.crafter ?? null, with: labels.with ?? labels.materials ?? null,
        roll: labels.roll ?? null, result: labels.result ?? labels.quality ?? null, at: labels.at ?? labels.station ?? null,
    });
}

export const GRAMMAR = Object.freeze({
    recipe: '+ recipe Name | from: who or what taught it | who: Name (someone learns a recipe; one the packs lack also says | makes: Item | with: Material x2, Material | craft: smithing|leather|alchemy|enchanting|cooking or a pack\'s craft, and | slot: weapon|armour|… for gear); - recipe Name | who: Name when forgotten',
    craft: '! craft Recipe | with: Material x2, Material | by: Name | roll: <1 or 2> | result: fail|made|fine|masterwork (someone crafts a recipe they know; it takes the reply\'s next roll like a check; add | at: campfire for a fire made on the spot)',
});

const guarded = handler => (ctx, payload) => {
    notFromScreen(ctx);
    return handler(ctx, payload);
};

export const commands = {
    'craft.learn': guarded(learn),
    'craft.forget': guarded(forget),
    'craft.make': guarded(make),
};

export const kinds = {
    recipe: { grammar: GRAMMAR.recipe, apply: clipped(applyRecipe) },
    craft: { grammar: GRAMMAR.craft, apply: clipped(applyCraft) },
};
