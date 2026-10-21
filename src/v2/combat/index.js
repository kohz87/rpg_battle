// RPG Battle v2, part `combat` (MODULES §B3): fights the story starts, played on the Fight screen
// (the board part's `rpg-battle/fight`),
// their results applied through the owners of the party and the inventory.
//
// The story writes `! encounter …` and stops at the first blow; capture keeps it as an offer.
// The reader fights it (combat.start) or turns it down (combat.dismiss). A fight is stored as
// v1 stores it: its setup and the player's actions, nothing else; every view of it is rebuilt
// with v1's replay (combat.js), so a swipe or a deleted reply that takes the actions back takes
// the fight back with them. A draught drunk or a flask thrown is taken out of the inventory the
// moment it is used (combat.act → inventory.consume), so it can be neither sold nor given away
// while the fight goes on, and nothing is left to take at the end. combat.end settles it: HP,
// conditions and skill uses through party.applyResult, XP through party.grantXp,
// loot through inventory.grant and wallet.receive, the foes beaten kept for Story Director's
// quests (combat.foesBeaten), and v1's hand-off as the receipt summary the next reply narrates.
//
// Handlers are synchronous and draw every random number from ctx.rng (the session's seed comes
// from it); nothing outside the State is kept.

import { act, availableActions, summarize } from '../../combat.js';
import { DEFAULT_BESTIARY } from '../../enemies.js';
import { itemSlot, oneCurrency, parseEffect } from '../../items.js';
import { combinedBestiary } from '../../templates.js';
import { foesText, readEncounter, STAKES, TIERS } from './encounter.js';
import { buildSetup, COMBAT_DEFAULTS, fightNumbers, partyCombatants } from './setup.js';
import { bestiaryList, creatureSlug, fightRules, packCreature, packSetup, sessionStatus, unpackSetup } from './stored.js';
import { beatenFoes, endSummary, foeNames, partyNames, rebuild, sessionView, tailLines } from './view.js';

export const MAX_OFFERS = 10;
export const MAX_BEATEN = 200;
export const MAX_CREATURES = 200;
const STATUSES = ['active', 'won', 'lost', 'fled'];
const ACTION_TYPES = ['attack', 'skill', 'item', 'defend', 'flee', 'parley', 'auto'];
const ACTION_FIELDS = ['target', 'skill', 'item', 'actor'];
const MAX_SUMMARY = 400;

// The instruction every reply carries (byte-identical: no names, no numbers). The line's own
// grammar is added by Story Block from `kinds.encounter.grammar`.
export const STATIC_TEXT = 'Fights are RPG Battle\'s: when one starts, write its encounter line (tier: how dangerous the foes are to the party; stakes: death only when losing means dying), then stop at the first blow. Never narrate a fight\'s blows or how it ends: the reader plays it, and the next reply is told what happened.';

// v1's example (story.STORY_INSTRUCTION: "3 wolf (weak)"): a count of single foes. A swarm is one
// foe made of many in v1's reading ("a swarm of rats"), so an example of six swarms taught the
// model to write six whole swarms against a fresh character (the Ersveil test, QA #75).
const GRAMMAR = '! encounter 3 Wolf — circling the camp | tier: trivial|weak|even|strong|deadly | stakes: normal|death';

// --- small helpers ----------------------------------------------------------------------------

/** An `<prefix>_<8 base36>` id drawn from the receipt's dice. */
function newId(ctx, prefix) {
    let text = '';
    for (let i = 0; i < 8; i++) text += Math.floor(ctx.rng() * 36).toString(36);
    return `${prefix}_${text}`;
}

/** meta.rev once this command is committed: the receipt's rev (MODULES §F2). */
const nextRev = ctx => ctx.rev;

/** The chat's one currency as v1's wording takes it (inventory.currency; gold when absent). */
function chatCurrency(ctx) {
    let found = null;
    try { found = ctx.query('inventory.currency'); } catch { found = null; }
    return oneCurrency(found);
}

const clip = text => (text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1).trimEnd()}…` : text);

/** The action a player sent, as a plain copy with only the fields v1 reads; null when it is none. */
function cleanAction(action) {
    if (!action || typeof action !== 'object' || !ACTION_TYPES.includes(action.type)) return null;
    const out = { type: action.type };
    for (const field of ACTION_FIELDS) {
        if (action[field] === undefined || action[field] === null) continue;
        if (typeof action[field] !== 'string' || !action[field].trim() || action[field].length > 80) return null;
        out[field] = action[field];
    }
    return out;
}

function activeSession(ctx) {
    const session = ctx.read('combat').session;
    if (!session) ctx.fail('NOT_FOUND', 'There is no fight under way.');
    if (session.status !== 'active') ctx.fail('REFUSED', 'That fight is over: finish it to see the result.');
    return session;
}

// --- consumables taken at use ------------------------------------------------------------------

function readInventory(ctx) {
    try {
        return ctx.read('inventory') ?? null;
    } catch {
        return null;
    }
}

function readPc(ctx) {
    try {
        return ctx.read('party')?.pc ?? null;
    } catch {
        return null;
    }
}

const byId = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/**
 * The stacks a fight item can come out of, best first: the stack the setup recorded, then the
 * member's own stacks of the same item, then (your character only) the party's bag. Each as
 * [stack id, qty available].
 */
function sourcesFor(inventory, item, memberId, pc) {
    const stacks = inventory?.stacks ?? {};
    const defs = inventory?.defs ?? {};
    const same = stack => (item.def ? stack.def === item.def : defs[stack.def]?.name === item.name);
    const owners = memberId === pc ? [memberId, 'party'] : [memberId];
    const out = [];
    const recorded = item.stack ? stacks[item.stack] : null;
    if (recorded && recorded.qty > 0 && same(recorded) && owners.includes(recorded.owner)) out.push([item.stack, recorded.qty]);
    for (const owner of owners) {
        for (const [id, stack] of Object.entries(stacks).sort(byId)) {
            if (id === item.stack || stack.owner !== owner || !(stack.qty > 0) || !same(stack)) continue;
            out.push([id, stack.qty]);
        }
    }
    return out;
}

const available = (inventory, item, memberId, pc) => sourcesFor(inventory, item, memberId, pc).reduce((sum, [, qty]) => sum + qty, 0);

/**
 * What each party member's fight items lost between two states of the fight: [{ memberId, item,
 * qty }], item being the setup's row ({ name, stack, def? }).
 */
function itemsSpent(before, after) {
    const out = [];
    for (const member of after.combatants.filter(c => c.side === 'party')) {
        const was = before.combatants.find(c => c.side === 'party' && c.memberId === member.memberId);
        (member.items ?? []).forEach((item, index) => {
            const qty = Math.round(Number(was?.items?.[index]?.qty) || 0) - Math.round(Number(item.qty) || 0);
            if (qty > 0) out.push({ memberId: member.memberId, item, qty });
        });
    }
    return out;
}

/**
 * The consumables a played action used, taken out of the inventory now (inventory.consume, from
 * the stacks sourcesFor names). A member on auto who drinks a draught that is no longer there
 * (sold or given away after the fight began) drinks nothing from the inventory: what is gone is
 * not taken twice. → [{ stack, qty }] taken, [{ name, qty }] not found.
 */
function consumeSpent(ctx, spent) {
    const taken = [];
    const missing = [];
    if (!spent.length) return { taken, missing };
    const pc = readPc(ctx);
    const inventory = readInventory(ctx);
    // What this action already took, so two uses from one stack never count it twice.
    const out = {};
    for (const { memberId, item, qty } of spent) {
        let left = qty;
        for (const [stack, had] of sourcesFor(inventory, item, memberId, pc)) {
            const have = had - (out[stack] ?? 0);
            if (!left) break;
            if (have <= 0) continue;
            const n = Math.min(left, have);
            ctx.call('inventory.consume', { stack, qty: n });
            out[stack] = (out[stack] ?? 0) + n;
            taken.push({ stack, qty: n });
            left -= n;
        }
        if (left) missing.push({ name: item.name, qty: left });
    }
    return { taken, missing };
}

/** One player action on the session: the fight rebuilt, the action played, the session updated. */
function playAction(ctx, action) {
    const session = activeSession(ctx);
    const { fight, rules } = rebuild(session);
    // A draught the player picks must still be in the inventory: it is taken out now.
    if (action.type === 'item' && readInventory(ctx)) {
        const actor = availableActions(fight, rules).actor;
        const norm = text => String(text ?? '').trim().toLowerCase();
        const item = (actor?.items ?? []).find(entry => norm(entry.name) === norm(action.item) && entry.effect && Number(entry.qty) > 0);
        if (item && actor.side === 'party' && !available(readInventory(ctx), item, actor.memberId, readPc(ctx))) {
            ctx.fail('REFUSED', `There is no ${item.name} left in the inventory.`);
        }
    }
    let next;
    try {
        next = act(fight, action, rules);
    } catch (error) {
        ctx.fail('REFUSED', error?.message || 'That action is not possible now.');
    }
    const used = readInventory(ctx) ? consumeSpent(ctx, itemsSpent(fight, next)) : { taken: [], missing: [] };
    const combat = ctx.draft('combat');
    combat.session.actions.push(action);
    combat.session.status = sessionStatus(next.status);
    const told = next.log.slice(fight.log.length).map(entry => entry.text);
    return {
        summary: clip(told.join(' ') || 'The fight goes on.'),
        narrate: false,
        data: { session: session.id, status: combat.session.status, log: told, used: used.taken, ...(used.missing.length ? { missing: used.missing } : {}) },
    };
}

/**
 * A loot drop as the def `inventory.grant` takes (SPEC §7): `story/<slug>`, its kind, rarity,
 * stats and tags as v1 rolled them, its effect read from v1's words ("heal 20" → { heal: 20 }).
 * Its value is left to the item.define hook, as for any item the story brings in.
 */
function lootDef(item) {
    const effect = item.effect ? parseEffect(String(item.effect)) : {};
    const kind = ['material', 'consumable', 'equipment'].includes(item.kind) ? item.kind : 'goods';
    return {
        id: `story/${creatureSlug(item.name)}`,
        name: item.name,
        kind,
        rarity: item.rarity ?? 'common',
        // No value: the item.define hook prices it (inventory.grant keeps a value the caller sets).
        stack: kind !== 'equipment',
        slot: kind === 'equipment' ? item.slot ?? itemSlot(item.name, item.stats ?? {}) ?? null : null,
        stats: { ...(item.stats ?? {}) },
        effect,
        tags: [...(item.tags ?? [])],
        note: item.effect ? String(item.effect) : '',
    };
}

// --- commands ---------------------------------------------------------------------------------

/** combat.start({ offer }): the offer becomes the fight; the session holds its setup. */
function start(ctx, payload) {
    const offerId = payload?.offer;
    const combat = ctx.read('combat');
    const offer = combat.offers.find(entry => entry.id === offerId);
    if (!offer) ctx.fail('NOT_FOUND', 'That fight is no longer on offer.');
    if (combat.session) ctx.fail('REFUSED', combat.session.status === 'active' ? 'A fight is already under way.' : 'Finish the last fight first.');
    const numbers = fightNumbers(ctx.settings() ?? {});
    const party = partyCombatants(ctx, { rules: fightRules(numbers) });
    const chatBestiary = bestiaryList(ctx.read('bestiary'));
    const id = newId(ctx, 'fi');
    const seed = Math.floor(ctx.rng() * 4294967296) >>> 0;
    let built;
    try {
        built = buildSetup({ id, seed, offer, party, chatBestiary, numbers });
    } catch (error) {
        ctx.fail('REFUSED', error?.message || 'That fight cannot start.');
    }
    const { setup, made } = built;
    // Rebuilt once now: a setup that cannot be fought is refused before anything is kept.
    let status;
    try {
        status = sessionStatus(rebuild({ setup: packSetup(setup), actions: [] }).fight.status);
    } catch (error) {
        ctx.fail('INVALID', `That fight cannot start: ${error?.message ?? 'its setup does not hold.'}`);
    }
    const rev = nextRev(ctx);
    if (made.length) {
        const bestiary = ctx.draft('bestiary');
        for (const entry of made) bestiary.creatures[creatureSlug(entry.name)] = packCreature({ ...entry, rev });
        const keys = Object.keys(bestiary.creatures);
        if (keys.length > MAX_CREATURES) {
            const oldest = keys.sort((a, b) => (bestiary.creatures[a].rev - bestiary.creatures[b].rev) || (a < b ? -1 : 1)).slice(0, keys.length - MAX_CREATURES);
            for (const key of oldest) delete bestiary.creatures[key];
        }
    }
    const draft = ctx.draft('combat');
    draft.offers = draft.offers.filter(entry => entry.id !== offer.id);
    draft.session = { id, setup: packSetup(setup), actions: [], status };
    return {
        summary: `A fight begins: ${partyNames(setup)} against ${foeNames(setup)}.`,
        narrate: false,
        // `place`: where the fight began (the return part finds the fatal fight's start by it).
        data: { session: id, offer: offer.id, place: setup.place ?? '', made: made.map(entry => entry.name) },
    };
}

/** combat.act({ action }): one player action, then every automatic turn up to the next choice. */
function actCommand(ctx, payload) {
    const action = cleanAction(payload?.action);
    if (!action) ctx.fail('INVALID', 'Choose an action: attack, a skill, an item, defend, flee, parley or auto.');
    return playAction(ctx, action);
}

/** combat.flee(): the player whose turn it is tries to get the party away (v1's flee chance). */
function flee(ctx) {
    return playAction(ctx, { type: 'flee' });
}

/** The party's actor ids now (null when the party cannot be read: then nobody is skipped). */
function partyIds(ctx) {
    try {
        const party = ctx.read('party');
        return party?.actors ? new Set(Object.keys(party.actors)) : null;
    } catch {
        return null;
    }
}

/**
 * combat.end(): a finished fight settled, once on this line of history. It always settles: only
 * the members still in the party get the fight's result and XP (one who is gone is skipped), XP
 * to a member at the level cap is nothing, and the consumables were already taken at use.
 */
function end(ctx) {
    const session = ctx.read('combat').session;
    if (!session) ctx.fail('NOT_FOUND', 'There is no fight to finish.');
    if (session.status === 'active') ctx.fail('REFUSED', 'The fight is not over yet.');
    if (!ctx.claim(`combat:${session.id}:end`)) ctx.fail('CLAIMED', 'That fight was already settled.');
    const { fight, rules } = rebuild(session);
    const setup = unpackSetup(session.setup);
    const result = summarize(fight, rules);
    const rev = nextRev(ctx);
    const present = partyIds(ctx);
    const here = id => !present || present.has(id);

    // The party's side: HP, MP, SP and lasting conditions as the fight left them, skill uses.
    const members = result.party.filter(member => here(member.memberId));
    const applied = !members.length ? null : ctx.call('party.applyResult', {
        outcome: result.outcome,
        stakes: result.stakes,
        actors: members.map(member => ({
            id: member.memberId,
            hp: { ...member.hp },
            mp: { ...member.mp },
            ...(member.sp ? { sp: { ...member.sp } } : {}),
            down: member.down,
            conditions: member.conditions.map(cond => ({ kind: cond.name, rounds: cond.rounds })),
            uses: { ...(result.uses?.[member.memberId] ?? {}) },
        })),
    });

    // A companion who died in a fight to the death is gone from the party (MODULES §F26): no XP.
    const died = Array.isArray(applied?.data?.died) ? applied.data.died : [];
    const gone = new Set(died.map(entry => entry.id));
    for (const member of setup.party) {
        if (gone.has(member.memberId) || !here(member.memberId)) continue;
        const xp = Math.max(0, Math.round(Number(result.xp?.[member.memberId]) || 0));
        if (xp > 0) ctx.call('party.grantXp', { actor: member.memberId, amount: xp });
    }

    if (result.outcome === 'victory') {
        // No stack note: the item.define hook would take it for the item's own words, and loot of
        // one kind stacks; the stack's `from` is this receipt.
        for (const item of result.loot.items) ctx.call('inventory.grant', { def: lootDef(item), qty: item.qty, owner: 'party' });
        if (result.loot.money > 0) ctx.call('wallet.receive', { owner: 'party', amount: result.loot.money, note: `loot: ${foeNames(setup)}` });
    }

    const foes = beatenFoes(result);
    const pcName = setup.party[0]?.name ?? 'the hero';
    const names = Object.fromEntries(fight.combatants.map(c => [c.memberId ?? c.id, c.name]));
    // The loot's money in the chat's one currency (MODULES §F1: Story Block's inventory.currency).
    // In the reader's terms (or a pack's, MODULES §F25): the fight's own numbers stay its setup's.
    const terms = ctx.settings()?.terms;
    const shown = terms && typeof terms === 'object' ? { ...rules, terms: { ...rules.terms, ...terms } } : rules;
    const lost = died.length ? ` ${died.map(entry => entry.name).join(', ').replace(/, ([^,]*)$/, ' and $1')} died and ${died.length === 1 ? 'is' : 'are'} gone from the party for good.` : '';
    const summary = `${endSummary(result, { pcName, rules: shown, names, currency: chatCurrency(ctx) })}${lost}`;
    const combat = ctx.draft('combat');
    if (foes.length) {
        combat.beaten.push({ rev, foes, won: result.outcome === 'victory' });
        if (combat.beaten.length > MAX_BEATEN) combat.beaten.splice(0, combat.beaten.length - MAX_BEATEN);
    }
    combat.last = { summary, moments: [...result.keyMoments], outcome: session.status, rev };
    combat.session = null;
    return {
        summary,
        narrate: true,
        data: {
            session: session.id,
            outcome: session.status,
            stakes: setup.stakes === 'death' ? 'death' : 'normal',
            died: died.map(entry => ({ ...entry })),
            foes,
            xp: { ...result.xp },
            loot: { money: result.loot.money, items: result.loot.items.map(item => ({ name: item.name, qty: item.qty, rarity: item.rarity })) },
        },
    };
}

/** combat.dismiss({ offer }): the reader turns an offered fight down. */
function dismiss(ctx, payload) {
    const combat = ctx.read('combat');
    const offer = combat.offers.find(entry => entry.id === payload?.offer);
    if (!offer) ctx.fail('NOT_FOUND', 'That fight is no longer on offer.');
    const draft = ctx.draft('combat');
    draft.offers = draft.offers.filter(entry => entry.id !== offer.id);
    return { summary: `The reader turns down the fight with ${foesText(offer.foes, { tiers: false })}.`, narrate: false, data: { offer: offer.id } };
}

// --- capture ----------------------------------------------------------------------------------

/** `! encounter …`: an offer, or a plain reason it cannot be one. */
function captureEncounter(ctx, line) {
    const bestiary = combinedBestiary(bestiaryList(ctx.read('bestiary')), DEFAULT_BESTIARY);
    const read = readEncounter(line, { bestiary });
    if (!read.ok) ctx.fail('INVALID', read.message);
    let place = read.place;
    if (!place) {
        try { place = String(ctx.read('scene')?.place?.name ?? '').trim().slice(0, 60); } catch { place = ''; }
    }
    const id = newId(ctx, 'en');
    const offer = { id, foes: read.foes, stakes: read.stakes, place, rev: nextRev(ctx), ...(read.note ? { note: read.note } : {}) };
    const draft = ctx.draft('combat');
    draft.offers.push(offer);
    if (draft.offers.length > MAX_OFFERS) draft.offers.splice(0, draft.offers.length - MAX_OFFERS);
    return {
        summary: `A fight is offered: ${foesText(offer.foes)}${offer.stakes === 'death' ? ', to the death' : ''}.`,
        narrate: false,
        data: { offer: id },
    };
}

// --- validators -------------------------------------------------------------------------------

const isInt = (value, min = 0) => Number.isInteger(value) && value >= min;
const isText = (value, max = 400) => typeof value === 'string' && value.length <= max;

export function validateCombat(slice) {
    const errors = [];
    if (!slice || typeof slice !== 'object') return ['The combat record is missing.'];
    if (!Array.isArray(slice.offers)) errors.push('combat.offers must be a list.');
    else {
        if (slice.offers.length > MAX_OFFERS) errors.push(`combat.offers holds ${MAX_OFFERS} fights at most.`);
        slice.offers.forEach((offer, n) => {
            const at = `combat.offers[${n}]`;
            if (!isText(offer?.id, 20) || !/^en_[0-9a-z]{8}$/.test(offer.id)) errors.push(`${at}.id must be an offer id like en_k3f9a2qz.`);
            if (!Array.isArray(offer?.foes) || !offer.foes.length) errors.push(`${at} names no foe.`);
            else offer.foes.forEach((foe, i) => {
                if (!isText(foe?.name, 60) || !foe.name.trim()) errors.push(`${at}.foes[${i}] has no name.`);
                if (!isInt(foe?.count, 1) || foe.count > 9) errors.push(`${at}.foes[${i}].count must be a whole number from 1 to 9.`);
                if (!TIERS.includes(foe?.tier)) errors.push(`${at}.foes[${i}].tier must be ${TIERS.join(', ')}.`);
            });
            if (!STAKES.includes(offer?.stakes)) errors.push(`${at}.stakes must be normal or death.`);
            if (!isText(offer?.place, 60)) errors.push(`${at}.place must be text.`);
            if (!isInt(offer?.rev)) errors.push(`${at}.rev must be a whole number.`);
        });
    }
    const s = slice.session;
    if (s !== null && s !== undefined) {
        if (!isText(s.id, 20) || !/^fi_[0-9a-z]{8}$/.test(s.id)) errors.push('combat.session.id must be a fight id like fi_k3f9a2qz.');
        if (!s.setup || typeof s.setup !== 'object' || !Array.isArray(s.setup.party) || !Array.isArray(s.setup.enemies)) errors.push('combat.session.setup must hold the party and the foes.');
        if (!Array.isArray(s.actions) || s.actions.some(action => !cleanAction(action))) errors.push('combat.session.actions must be a list of actions.');
        if (!STATUSES.includes(s.status)) errors.push(`combat.session.status must be ${STATUSES.join(', ')}.`);
    } else if (s === undefined) errors.push('combat.session must be a fight or null.');
    if (!Array.isArray(slice.beaten)) errors.push('combat.beaten must be a list.');
    else {
        if (slice.beaten.length > MAX_BEATEN) errors.push(`combat.beaten keeps ${MAX_BEATEN} fights at most.`);
        slice.beaten.forEach((entry, n) => {
            if (!isInt(entry?.rev) || typeof entry?.won !== 'boolean' || !Array.isArray(entry?.foes)
                || entry.foes.some(foe => !isText(foe?.name, 60) || !isInt(foe?.count, 1))) errors.push(`combat.beaten[${n}] must be { rev, foes: [{ name, count }], won }.`);
        });
    }
    const last = slice.last;
    if (last !== null && last !== undefined) {
        if (!isText(last.summary, 4000) || !Array.isArray(last.moments) || last.moments.some(moment => typeof moment !== 'string')) errors.push('combat.last must be { summary, moments }.');
    } else if (last === undefined) errors.push('combat.last must be a result or null.');
    return errors;
}

export function validateBestiary(slice) {
    if (!slice || typeof slice !== 'object' || !slice.creatures || typeof slice.creatures !== 'object' || Array.isArray(slice.creatures)) return ['bestiary.creatures must be a record.'];
    const errors = [];
    const keys = Object.keys(slice.creatures);
    if (keys.length > MAX_CREATURES) errors.push(`The bestiary keeps ${MAX_CREATURES} creatures at most.`);
    for (const key of keys) {
        const entry = slice.creatures[key];
        if (!isText(entry?.name, 60) || !entry.name.trim()) errors.push(`bestiary.creatures.${key} has no name.`);
        else if (creatureSlug(entry.name) !== key) errors.push(`bestiary.creatures.${key} is filed under the wrong name (${entry.name}).`);
        if (!isInt(entry?.level, 1)) errors.push(`bestiary.creatures.${key}.level must be a whole number, 1 or more.`);
    }
    return errors;
}

// --- queries ----------------------------------------------------------------------------------

const combatOf = state => state?.domains?.combat ?? { offers: [], session: null, beaten: [], last: null };

/** combat.foesBeaten({ sinceRev }) → [{ rev, foes: [{ name, count }], won }]: the fights settled after `sinceRev`. */
export function foesBeaten(state, { sinceRev = -1 } = {}) {
    const since = Number.isFinite(Number(sinceRev)) ? Number(sinceRev) : -1;
    return combatOf(state).beaten.filter(entry => entry.rev > since).map(entry => structuredClone(entry));
}

// --- the part ---------------------------------------------------------------------------------

export const part = {
    domains: {
        combat: {
            initial: () => ({ offers: [], session: null, beaten: [], last: null }),
            validate: validateCombat,
        },
        bestiary: {
            initial: () => ({ creatures: {} }),
            validate: validateBestiary,
        },
    },
    commands: {
        'combat.start': start,
        'combat.act': actCommand,
        'combat.flee': flee,
        'combat.end': end,
        'combat.dismiss': dismiss,
    },
    queries: {
        'combat.offers': state => combatOf(state).offers.map(offer => ({ ...structuredClone(offer), text: foesText(offer.foes) })),
        'combat.session': state => sessionView(combatOf(state).session),
        'combat.last': state => (combatOf(state).last ? structuredClone(combatOf(state).last) : null),
        'combat.foesBeaten': foesBeaten,
        'bestiary.creatures': state => bestiaryList(state?.domains?.bestiary).map(entry => ({ name: entry.name, level: entry.level, template: entry.template ?? null, look: entry.look ?? '' })),
    },
    kinds: {
        encounter: { grammar: GRAMMAR, apply: captureEncounter },
    },
    context: {
        static: () => STATIC_TEXT,
        tail: view => tailLines(view?.state?.domains?.combat),
        budget: 150,
    },
    hooks: {},
    settings: {
        section: 'Combat',
        defaults: { ...COMBAT_DEFAULTS },
        schema: {
            turnOrder: { type: 'choice', label: 'Turn order', options: ['timeline', 'rounds'], help: 'Timeline: faster fighters act more often. Rounds: everyone once a round.' },
            speedOffset: { type: 'int', label: 'Speed (AGI +)', min: 0, max: 50 },
            hitBase: { type: 'int', label: 'Hit chance base %', min: 5, max: 95 },
            hitPerPoint: { type: 'int', label: 'Hit chance per DEX–AGI point', min: 0, max: 10 },
        },
    },
    // The Fight tab is the board part's screen `rpg-battle/fight` (SPEC §13.1).
    tabs: [],
};
