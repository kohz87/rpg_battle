// RPG Battle v2, part `combat` (MODULES §B3): fights the story starts, played on the Fight screen
// (the board part's `rpg-battle/fight`),
// their results applied through the owners of the party and the inventory.
//
// The story writes `! encounter …` and stops at the first blow; capture keeps it as an offer.
// The reader fights it (combat.start) or turns it down (combat.dismiss). A fight is stored as
// v1 stores it: its setup and the player's actions, nothing else; every view of it is rebuilt
// with v1's replay (combat.js), so a swipe or a deleted reply that takes the actions back takes
// the fight back with them. A draught drunk or a flask thrown is taken out of the inventory the
// moment it is used (combat.act → inventory.consume), so nothing is left to take at the end; one
// sold, dropped or given away mid-fight is cut from the fight's items before the next action (the
// action's `stock`, replayed with it), so nobody drinks what is gone. The party's HP, MP and SP
// follow the fight action by action (party.fightPools), so every view shows the board's numbers.
// combat.end settles it: HP,
// conditions and skill uses through party.applyResult, XP through party.grantXp,
// loot through inventory.grant (what the party cannot carry, items.carry F39, is left behind and
// told) and wallet.receive, the foes beaten kept for Story Director's
// quests (combat.foesBeaten), and v1's hand-off as the receipt summary the next reply narrates.
//
// Handlers are synchronous and draw every random number from ctx.rng (the session's seed comes
// from it); nothing outside the State is kept.

import { act, availableActions, summarize } from '../../combat.js';
import { DEFAULT_BESTIARY } from '../../enemies.js';
import { itemSlot, oneCurrency, parseEffect } from '../../items.js';
import { cleanCreature, combinedBestiary } from '../../templates.js';
import { countReading, cutText, foesCard, foesText, MAX_ENCOUNTER_FOES, rankContext, readEncounter, STAKES, TIERS } from './encounter.js';
import { questSized, questTargets } from './quest.js';
import { rulesFrom } from '../party/sheets.js';
import { buildSetup, COMBAT_DEFAULTS, COMBAT_LIMITS, fieldCap, fightNumbers, heldText, heldToTiers, moneyScale, partyCombatants, scaledMoney, tierRoom } from './setup.js';
import { beatenOf, bestiaryList, byRev, draftSession, dropSession, sessionOf, creatureSlug, fightRules, lastOf, latinSlug, offersOf, packCreature, packSetup, sessionStatus, unpackSetup, valuesOf } from './stored.js';
export { beatenOf, lastOf, offersOf } from './stored.js';
import { clipped } from '../lines.js';
import { lastParts, partsProblems } from '../board/parts.js';
import { fitParty } from '../party/pools.js';
import { foldStoryTime } from '../party/recovery.js';
import { hasOpenQuests, keepRoute, readsFreely } from '../quests/offer-feature.js';
import { pinned as rulesPin } from '../quests/seams.js';
import { bindEncounter, actionWithId, beginUnits, guardAction, guardStart, lootProblem, pinnedFight, pinnedOf, pinnedSetup, settleEnd } from '../fight/index.js';
import { cleanFormFields } from '../fight/records.js';
import { resolveOpposition } from '../fight/danger.js';
import { settleFightDeaths } from '../death/fight.js';
import { applyStock, beatenFoes, boardToken, endSummary, foeNames, foeRanks, partyNames, rebuild, sessionView, tailLines } from './view.js';

export { MAX_BEATEN, MAX_OFFERS } from './stored.js';
import { MAX_BEATEN, MAX_OFFERS } from './stored.js';
export const MAX_CREATURES = 200;
// The most creatures read from the enabled packs (packs.content creatures) for one fight or offer.
export const MAX_PACK_CREATURES = 200;

/**
 * The enabled packs' creatures (PACKS.md: records for RPG Battle's bestiary), cleaned as any imported
 * creature (templates.cleanCreature: their level, moves, loot and look kept), with their aliases: so a
 * pack's River Drake is fought as the pack wrote it and drops its loot. [] without packs.
 */
export function packBestiary(ctx, rules) {
    let list;
    try { list = ctx.query('packs.content', { kind: 'creatures' }); } catch { return []; }
    const out = [];
    for (const raw of Array.isArray(list) ? list.slice(0, MAX_PACK_CREATURES) : []) {
        const entry = cleanCreature(raw, rules);
        if (!entry) continue;
        const aliases = (Array.isArray(raw.aliases) ? raw.aliases : []).map(alias => String(alias ?? '').replace(/[\r\n|<>#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 8);
        out.push(aliases.length ? { ...entry, aliases } : entry);
    }
    return out;
}

/** The creatures a fight's names are looked up in before the shipped ones: the chat's own, then the packs'. */
const fightBestiary = (ctx, rules) => [...bestiaryList(ctx.read('bestiary')), ...packBestiary(ctx, rules)];

/** How many of the party can fight now (HP above 0), from party.actors; at least 1. */
function fighters(ctx) {
    let listed = null;
    try { listed = ctx.query('party.actors'); } catch { listed = null; }
    const actors = (Array.isArray(listed) ? listed : Object.values(listed ?? {})).filter(actor => actor && typeof actor === 'object');
    const standing = actors.filter(actor => !(Number.isFinite(Number(actor.hp?.cur)) && Number(actor.hp.cur) <= 0)).length;
    return Math.max(1, standing);
}
// Bookkeeping later replies write is keyed (B-b1r2-13, SPEC §2): an offer under its id, a settled
// fight's foes under the fight's id, a made creature under its key, never a list position or a
// field of an entry an earlier reply made. The oldest are pruned past MAX_OFFERS, MAX_BEATEN and
// MAX_CREATURES (Story Block 2.0.0-alpha.2 passes over the remove of a key that is already gone).
// The latest result (`last`) is one value written whole, as a one-entry list (one replace), so the
// newest write left on the chat's line wins.

/** The oldest entries of `record` (by rev) removed until `most` are left; `keep` stays. */
function prune(record, most, keep) {
    const keys = Object.keys(record);
    if (keys.length <= most) return;
    const oldest = keys.filter(key => key !== keep)
        .sort((a, b) => ((record[a]?.rev ?? 0) - (record[b]?.rev ?? 0)) || (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, keys.length - most);
    for (const key of oldest) delete record[key];
}


/** The draft's `key` slice as a record (an older chat's list is turned into one, keyed by `field`). */
function recordOf(draft, key, field = 'id') {
    if (!draft[key] || typeof draft[key] !== 'object' || Array.isArray(draft[key])) {
        const list = Array.isArray(draft[key]) ? draft[key] : [];
        draft[key] = Object.fromEntries(list.filter(entry => entry && typeof entry === 'object').map((entry, n) => [typeof entry[field] === 'string' ? entry[field] : `old${n}`, entry]));
    }
    return draft[key];
}
const STATUSES = ['active', 'won', 'lost', 'fled'];
const ACTION_TYPES = ['attack', 'skill', 'item', 'defend', 'flee', 'parley', 'auto', 'form'];
const ACTION_FIELDS = ['target', 'skill', 'item', 'actor', 'form', 'id'];
const MAX_SUMMARY = 400;

// The instruction every reply carries (byte-identical: no names, no numbers). The line's own
// grammar is added by Story Block from `kinds.encounter.grammar`. "in <Changes>" (fix-encounter): told
// only "write its encounter line", a model wrote it in the story where the fight began, and no fight
// could start; the line goes in the block with the reply's other changes.
export const STATIC_TEXT = 'Fights are RPG Battle\'s: when one starts, write its encounter line in <Changes> (tier: how dangerous the foes are to the party; stakes: death only when losing means dying), then stop at the first blow. Never narrate a fight\'s blows or how it ends: the reader plays it, and the next reply is told what happened.';

// v1's example (story.STORY_INSTRUCTION: "3 wolf (weak)"): a count of single foes. A swarm is one
// foe made of many in v1's reading ("a swarm of rats"), so an example of six swarms taught the
// model to write six whole swarms against a fresh character (the Ersveil test, QA #75).
const GRAMMAR = '! encounter 3 Wolf — circling the camp | tier: trivial|weak|even|strong|deadly | stakes: normal|death';

// --- small helpers ----------------------------------------------------------------------------

/**
 * An `<prefix>_<8 base36>` id: the host's ctx.id (its own stream from the receipt's seed, so an id
 * never moves the dice a fight is fought with), else drawn from the receipt's dice.
 */
function newId(ctx, prefix) {
    const given = typeof ctx.id === 'function' ? ctx.id(prefix) : null;
    if (typeof given === 'string' && new RegExp(`^${prefix}_[0-9a-z]{8}$`).test(given)) return given;
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
    // (rules v2) A form action's choices: effect -> targets, a closed shape (fight/records.js).
    if (action.selections !== undefined && !cleanFormFields(action, out)) return null;
    return out;
}

/**
 * The fight a command names (`payload.session`, the board's fight id) must be the one under way: an
 * action from a board that still shows an older fight (a second window, a click across a
 * combat.end and a combat.start) is refused, never played on another fight. Without a session id
 * (an older caller) the fight under way is meant.
 */
function sameSession(ctx, session, payload) {
    const named = payload?.session;
    if (named === undefined || named === null) return;
    if (typeof named !== 'string' || named !== session.id) ctx.fail('REFUSED', 'That was meant for another fight: the board was out of date. Look again and choose.');
}

function activeSession(ctx, payload) {
    const session = sessionOf(ctx.read('combat'));
    if (!session) ctx.fail('NOT_FOUND', 'There is no fight under way.');
    sameSession(ctx, session, payload);
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
 * The fight items the inventory no longer holds as many of (sold, dropped or given away since the
 * fight began): [{ member, item (index in the member's fight items), left }]. A member's rows of
 * one item share what the inventory has, in order. Recorded with the action (`stock`), so the action
 * is played, and replayed, with what was really there (B-b4-1): nobody on auto drinks a draught that
 * is gone.
 */
function stockCuts(fight, inventory, pc) {
    const cuts = [];
    for (const member of fight.combatants.filter(c => c.side === 'party')) {
        const left = new Map();
        (member.items ?? []).forEach((item, index) => {
            const qty = Math.max(0, Math.round(Number(item.qty) || 0));
            if (!qty) return;
            const key = item.def ? `def:${item.def}` : `name:${String(item.name ?? '').toLowerCase()}`;
            if (!left.has(key)) left.set(key, available(inventory, item, member.memberId, pc));
            const have = left.get(key);
            const keep = Math.min(qty, have);
            left.set(key, have - keep);
            if (keep < qty) cuts.push({ member: member.memberId, item: index, left: keep });
        });
    }
    return cuts;
}

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

/**
 * The party's HP, MP and SP as the fight has them now (party.fightPools), so every view (the
 * Party screen, the HUD, the status card) shows what the battle board shows while a fight runs.
 * Only members whose numbers moved are sent; nothing is sent when none did.
 */
function syncPools(ctx, fight) {
    let party = null;
    try {
        // The pools as they stand now (party/pools.js), the numbers party.fightPools compares with.
        party = fitParty(ctx.read('party'));
    } catch {
        party = null;
    }
    if (!party?.actors) return;
    const moved = [];
    for (const c of fight.combatants.filter(entry => entry.side === 'party')) {
        const actor = party.actors[c.memberId];
        if (!actor) continue;
        const pools = {};
        for (const key of ['hp', 'mp', 'sp']) {
            const cur = Math.round(Number(c[key]?.cur));
            if (Number.isFinite(cur) && actor[key] && cur !== actor[key].cur) pools[key] = cur;
        }
        if (Object.keys(pools).length) moved.push({ id: c.memberId, ...pools });
    }
    if (moved.length) ctx.call('party.fightPools', { actors: moved });
}

/** One player action on the session: the fight rebuilt, the action played, the session updated. */
function playAction(ctx, action, payload = {}) {
    const session = activeSession(ctx, payload);
    const rebuilt = rebuild(session);
    const { rules } = rebuilt;
    // `board`: which moment of the fight the board showed when the action was chosen (the view's
    // `board`, boardToken: the actions played, B4r2-2); `logLength`, how long its log was (an older
    // caller's). A second click on the same board (the fight moved on), or a board from before a
    // swipe or delete, is refused rather than played on another moment.
    const moved = () => ctx.fail('REFUSED', 'The fight moved on since that was chosen: look again and choose.');
    if (payload?.board !== undefined && payload.board !== null && payload.board !== boardToken(session)) moved();
    if (payload?.logLength !== undefined && payload.logLength !== null && payload.logLength !== rebuilt.fight.log.length) moved();
    const inventory = readInventory(ctx);
    const stock = inventory ? stockCuts(rebuilt.fight, inventory, readPc(ctx)) : [];
    const fight = stock.length ? applyStock(structuredClone(rebuilt.fight), stock) : rebuilt.fight;
    // A draught the player picks must still be in the inventory: it is taken out now. (Looked up
    // in the fight as it stood, before the stock cuts, to say plainly why it cannot be used.)
    if (action.type === 'item' && inventory) {
        const actor = availableActions(rebuilt.fight, rules).actor;
        const norm = text => String(text ?? '').trim().toLowerCase();
        const item = (actor?.items ?? []).find(entry => norm(entry.name) === norm(action.item) && entry.effect && Number(entry.qty) > 0);
        if (item && actor.side === 'party' && !available(readInventory(ctx), item, actor.memberId, readPc(ctx))) {
            ctx.fail('REFUSED', `There is no ${item.name} left in the inventory.`);
        }
    }
    action = actionWithId(ctx, session, action);
    if (!action) ctx.fail('REFUSED', 'A form means nothing in a fight that does not run a ruleset.');
    let next;
    try {
        next = act(fight, action, rules);
    } catch (error) {
        ctx.fail('REFUSED', error?.message || 'That action is not possible now.');
    }
    const used = readInventory(ctx) ? consumeSpent(ctx, itemsSpent(fight, next)) : { taken: [], missing: [] };
    syncPools(ctx, next);
    beginUnits(ctx, session, fight, next);
    // Under the fight's own key (stored.js): replayed without this fight's start, the block does not apply.
    guardAction(ctx, session, stock.length ? { ...action, stock } : action);
    const stored = draftSession(ctx.draft('combat'), session.id);
    stored.actions.push(stock.length ? { ...action, stock } : action);
    stored.status = sessionStatus(next.status);
    const told = next.log.slice(fight.log.length).map(entry => entry.text);
    return {
        summary: clip(told.join(' ') || 'The fight goes on.'),
        narrate: false,
        data: { session: session.id, status: stored.status, log: told, used: used.taken, ...(used.missing.length ? { missing: used.missing } : {}) },
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

/** A query that may not be registered (or may refuse): its answer, or null. */
function ask(ctx, name, args) {
    try {
        return ctx.query(name, args) ?? null;
    } catch {
        return null;
    }
}

const kindOf = item => (['material', 'consumable', 'equipment'].includes(item.kind) ? item.kind : 'goods');

/**
 * What a loot drop is granted as: an item the chat already has of that name (its def, so the drop
 * joins that stack), else a pack's item of that name (Story Block's packs.item; granted by name,
 * so the pack's def is used), else the same for the name with the foe's extra words taken off the
 * front ("Starved Crag Wolf Pelt" → "Crag Wolf Pelt" → "Wolf Pelt": the base creature's part),
 * always of the drop's own kind. Null when nothing matches: the drop is a new story item (lootDef).
 * → { defId } | { name, def (the pack's) } with `shown`, the name the receipt tells.
 */
function lootTarget(ctx, item) {
    const words = String(item.name ?? '').trim().split(/\s+/).filter(Boolean);
    const kind = kindOf(item);
    for (let start = 0; start <= words.length - (start ? 2 : 1); start++) {
        const name = words.slice(start).join(' ');
        const found = ask(ctx, 'inventory.find', { name });
        const def = found?.status === 'found' ? found.defs?.[0] : null;
        if (def && def.kind === kind) return { defId: def.id, shown: def.name };
        const packed = ask(ctx, 'packs.item', { name });
        if (packed && typeof packed.id === 'string' && packed.name && (packed.kind ?? 'goods') === kind) return { name: packed.name, shown: packed.name, def: packed };
    }
    return null;
}

/**
 * Whether the party can carry `qty` of a drop (the items part's `items.carry`, MODULES §F39): true
 * when it can, or when no part keeps a carry limit.
 */
function canCarryLoot(ctx, carried, qty) {
    let fits = null;
    try {
        fits = ctx.query('items.carry', { add: [{ ...carried, qty }] });
    } catch {
        return true;
    }
    return !(fits && fits.ok === false);
}

/** The chat's item definitions by id, or null. */
function tryDefs(ctx) {
    try { return ctx.read('inventory')?.defs ?? null; } catch { return null; }
}

/**
 * The victory's drops granted (inventory.grant to the party, the receipt as their cause), each
 * as the item lootTarget finds; drops that turn out to be one item are told once, added up. A drop
 * the party cannot carry (items.carry, F39) is not granted: it is left behind, and told so.
 * → { items: [{ name, qty, rarity }] as granted, left: [{ name, qty, rarity }] left behind }.
 */
function grantLoot(ctx, items) {
    const told = [];
    const left = [];
    // A pinned chat says why a drop stayed ('weight': too heavy; 'held': the rules cannot register it here, with its `cause`); another chat's rows are v1's.
    const pinned = Boolean(pinnedOf(ctx));
    const add = (list, name, item, why = null) => {
        const same = list.find(entry => entry.name === name);
        if (same) same.qty += item.qty;
        else list.push({ name, qty: item.qty, rarity: item.rarity ?? 'common', ...(why && pinned ? why : {}) });
    };
    const ix = pinnedOf(ctx);
    for (const item of items) {
        // A drop that names its item's definition (a pinned foe's loot row) is that frozen definition: the chat's stack of it if the pack's
        // definitions are registered, else the definition itself; never a lookup by name.
        const frozen = ix && typeof item.def === 'string' ? ix.itemDef(item.def) : null;
        if (frozen) {
            const registered = Boolean(tryDefs(ctx)?.[frozen.id]);
            const problem = registered ? null : lootProblem(ctx, frozen);
            if (problem) {
                add(left, frozen.name, item, { reason: 'held', cause: problem.reason });
                continue;
            }
            const carriedFrozen = registered ? { defId: frozen.id } : { def: frozen };
            if (!canCarryLoot(ctx, carriedFrozen, item.qty)) {
                add(left, frozen.name, item, { reason: 'weight' });
                continue;
            }
            ctx.call('inventory.grant', { ...carriedFrozen, qty: item.qty, owner: 'party' });
            add(told, frozen.name, item);
            continue;
        }
        const target = lootTarget(ctx, item);
        // No stack note: the item.define hook would take it for the item's own words, and loot of
        // one kind stacks; the stack's `from` is this receipt.
        const payload = target?.defId ? { defId: target.defId } : target?.name ? { name: target.name } : { def: lootDef(item) };
        const shown = target?.shown ?? item.name;
        // What it weighs: the chat's def, a pack's (asked again by name), else the drop's own.
        const carried = target?.defId ? { defId: target.defId } : { def: target?.def ?? lootDef(item) };
        // A new definition the rules cannot register is held, never granted: nothing in the end may fail on a drop.
        const problem = payload.def ? lootProblem(ctx, payload.def) : null;
        if (problem) {
            add(left, shown, item, { reason: 'held', cause: problem.reason });
            continue;
        }
        if (!canCarryLoot(ctx, carried, item.qty)) {
            add(left, shown, item, { reason: 'weight' });
            continue;
        }
        ctx.call('inventory.grant', { ...payload, qty: item.qty, owner: 'party' });
        add(told, shown, item);
    }
    return { items: told, left };
}

// --- commands ---------------------------------------------------------------------------------

/** combat.start({ offer }): the offer becomes the fight; the session holds its setup. */
function start(ctx, payload) {
    const offerId = payload?.offer;
    const combat = ctx.read('combat');
    const offer = offersOf(combat).find(entry => entry.id === offerId);
    if (!offer) ctx.fail('NOT_FOUND', 'That fight is no longer on offer.');
    const under = sessionOf(combat);
    if (under) ctx.fail('REFUSED', under.status === 'active' ? 'A fight is already under way.' : 'Finish the last fight first.');
    // Story time since the last reply heals first (party/recovery.js), so the party fights as it stands now.
    foldStoryTime(ctx);
    const numbers = fightNumbers(ctx.settings() ?? {});
    const party = partyCombatants(ctx, { rules: fightRules(numbers) });
    // The chat's creatures, then the packs' (packBestiary): a pack's creature is fought as written.
    const chatBestiary = offer.opposition ? [] : fightBestiary(ctx, fightRules(numbers));
    const id = newId(ctx, 'fi');
    const seed = Math.floor(ctx.rng() * 4294967296) >>> 0;
    // The offer's foes held to what each tier can hold for the party as it stands now (B-a2-9): a
    // member down since the offer makes the same foes more dangerous. What stays out is told.
    const held = offer.opposition ? { foes: offer.foes, cut: [] } : heldToTiers(offer.foes, { pcLevel: party[0]?.level ?? 1, members: party.filter(c => c.hp.cur > 0).length || 1, field: numbers.field, rules: fightRules(numbers) });
    const fought = held.cut.length ? { ...offer, foes: held.foes } : offer;
    let built;
    try {
        built = offer.opposition
            ? { setup: { ...unpackSetup(offer.opposition), id, seed, party }, made: [] }
            : buildSetup({ id, seed, offer: fought, party, chatBestiary, numbers, money: moneyScale(ctx) });
    } catch (error) {
        ctx.fail('REFUSED', error?.message || 'That fight cannot start.');
    }
    const { made } = built;
    const setup = pinnedSetup(ctx, built.setup, offer);
    // The foes past the field (the reader's setting, setup.planWaves) come in later waves.
    const later = (setup.waves ?? []).reduce((sum, wave) => sum + (wave.enemies?.length ?? 0), 0);
    // The party as it stands before the opening (the automatic turns before the first choice,
    // B4r2-1): its fight items held to what the inventory has, as an action's stock cuts hold
    // them, so nobody in the opening drinks a draught that is not there.
    const inventory = readInventory(ctx);
    const ready = { combatants: (setup.party ?? []).map(c => ({ side: 'party', memberId: c.memberId ?? c.id, items: c.items ?? [] })) };
    if (inventory) {
        for (const cut of stockCuts(ready, inventory, readPc(ctx))) {
            const item = setup.party.find(c => (c.memberId ?? c.id) === cut.member)?.items?.[cut.item];
            if (item && Number(item.qty) > cut.left) item.qty = cut.left;
        }
    }
    const before = structuredClone(ready);
    // Rebuilt once now: a setup that cannot be fought is refused before anything is kept.
    let status;
    let opening;
    try {
        opening = rebuild({ setup: packSetup(setup), actions: [] }).fight;
        status = sessionStatus(opening.status);
    } catch (error) {
        ctx.fail('INVALID', `That fight cannot start: ${error?.message ?? 'its setup does not hold.'}`);
    }
    // What the opening used comes out of the inventory now (as combat.act does for its turns),
    // and the foes' first blows show on the party at once.
    if (inventory) consumeSpent(ctx, itemsSpent(before, opening));
    syncPools(ctx, opening);
    beginUnits(ctx, { id, setup }, { combatants: [] }, opening);
    const rev = nextRev(ctx);
    if (made.length) {
        const bestiary = ctx.draft('bestiary');
        // Each under its own key, added once (B-b1r2-13); the oldest go past MAX_CREATURES.
        for (const entry of made) {
            const key = creatureSlug(entry.name);
            if (Object.hasOwn(bestiary.creatures, key)) continue;
            bestiary.creatures[key] = packCreature({ ...entry, rev });
        }
        prune(bestiary.creatures, MAX_CREATURES, null);
    }
    // (rules v2) The offer and the forms each fighter takes in, bound to the state this stands on.
    guardStart(ctx, { offer: offer.id, fight: id, setup });
    const draft = ctx.draft('combat');
    delete recordOf(draft, 'offers')[offer.id];
    // The foes' written ranks (`rank: D`) go with the session, for the tail line (none: no key).
    const ranks = foeRanks(offer.foes);
    // Kept under its own id (stored.js sessionOf), with the rev it began at.
    draft.fights ??= {};
    draft.fights[id] = { id, rev, setup: packSetup(setup), actions: [], status, ...(ranks.length ? { ranks } : {}) };
    return {
        summary: `A fight begins: ${partyNames(setup)} against ${foeNames(setup)}${later ? ` (${later} more in later waves)` : ''}.`,
        narrate: false,
        // `place`: where the fight began (the return part finds the fatal fight's start by it).
        data: { session: id, offer: offer.id, place: setup.place ?? '', made: made.map(entry => entry.name), ...(later ? { later } : {}) },
        ...(held.cut.length ? { problem: heldText(held.cut) } : {}),
    };
}

/**
 * combat.act({ action, session?, board?, logLength? }): one player action, then every automatic turn
 * up to the next choice. `session` (the fight's id) and `board` (the view's moment token; or the
 * older `logLength`, its log's length as shown) say which fight, and which moment of it, the action
 * was chosen for: anything else is refused.
 */
function actCommand(ctx, payload) {
    const action = cleanAction(payload?.action);
    if (!action) ctx.fail('INVALID', 'Choose an action: attack, a skill, an item, defend, flee, parley or auto.');
    return playAction(ctx, action, payload);
}

/** combat.flee({ session?, board?, logLength? }): the player whose turn it is tries to get the party away (v1's flee chance). */
function flee(ctx, payload) {
    return playAction(ctx, { type: 'flee' }, payload);
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
function end(ctx, payload) {
    const session = sessionOf(ctx.read('combat'));
    if (!session) ctx.fail('NOT_FOUND', 'There is no fight to finish.');
    sameSession(ctx, session, payload);
    if (session.status === 'active') ctx.fail('REFUSED', 'The fight is not over yet.');
    if (!ctx.claim(`combat:${session.id}:end`)) ctx.fail('CLAIMED', 'That fight was already settled.');
    const { fight, rules } = rebuild(session);
    const setup = unpackSetup(session.setup);
    const result = summarize(fight, rules);
    // The foes' coin is RPG Battle's default money (rules.moneyByRank): × the pack's scale the fight began with (F104).
    result.loot.money = scaledMoney(result.loot.money, setup.moneyScale ?? 1);
    // (rules v2) The pinned fight's settlement, first, as the root's one guard: the paid uses and the sealed result of the fight as it ended.
    const sealed = settleEnd(ctx, { session, fight, result });
    const rev = nextRev(ctx);
    const present = partyIds(ctx);
    const here = id => !present || present.has(id);

    // The party's side: HP, MP, SP and lasting conditions as the fight left them, skill uses. Only
    // the current numbers: each member's maxima are the party's own now (points spent or a level
    // gained mid-fight raised them, B-b4-4), and the current ones are held to those.
    const members = result.party.filter(member => here(member.memberId));
    const applied = !members.length ? null : ctx.call('party.applyResult', {
        outcome: result.outcome,
        stakes: result.stakes,
        actors: members.map(member => ({
            id: member.memberId,
            hp: { cur: member.hp.cur },
            mp: { cur: member.mp.cur },
            ...(member.sp ? { sp: { cur: member.sp.cur } } : {}),
            down: member.down,
            conditions: member.conditions.map(cond => ({ kind: cond.name, rounds: cond.rounds })),
            // (rules v2) A pinned fight's uses are paid by its settlement (recordCombatUses), never by the v1 mastery path; a fight begun before the pin is v1's.
            uses: sealed ? {} : { ...(result.uses?.[member.memberId] ?? {}) },
        })),
    });
    const deathBatch = settleFightDeaths(ctx, { session, result });

    // A companion who died in a fight to the death is gone from the party (MODULES §F26): no XP.
    const died = Array.isArray(applied?.data?.died) ? applied.data.died : [];
    const gone = new Set(died.map(entry => entry.id));
    for (const member of setup.party) {
        if (gone.has(member.memberId) || !here(member.memberId)) continue;
        const xp = Math.max(0, Math.round(Number(result.xp?.[member.memberId]) || 0));
        if (xp > 0) ctx.call('party.grantXp', { actor: member.memberId, amount: xp, ...(pinnedFight(session) ? { claim: `combat:${session.id}:${member.memberId}` } : {}) });
    }

    // Gear wears once a fight (the items part, TRS idea 1): armour by the blows its wearer took, a weapon by the fight.
    let wear = null;
    try {
        wear = ctx.call('item.fightWear', {
            fight: session.id,
            members: fight.combatants.filter(c => c.side === 'party' && here(c.memberId) && !gone.has(c.memberId))
                .map(c => ({ actor: c.memberId, taken: Math.max(0, Number(fight.stats?.damageTaken?.[c.id]) || 0), maxHp: Math.max(1, Number(c.hp?.max) || 1) })),
        });
    } catch (error) {
        // Without the items part, or with gear wear off (nothing ran either way), there is no gear wear.
        if (error?.code !== 'UNKNOWN_COMMAND' && error?.code !== 'FEATURE_OFF') throw error;
    }
    const worn = typeof wear?.summary === 'string' && wear.summary ? ` ${wear.summary}` : '';

    let leftBehind = [];
    if (result.outcome === 'victory') {
        // The drops under the names they were granted as (the summary and receipt tell those).
        const granted = grantLoot(ctx, result.loot.items);
        result.loot.items = granted.items;
        leftBehind = granted.left;
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
    const told = list => list.map(item => (item.qty > 1 ? `${item.name} ×${item.qty}` : item.name)).join(', ');
    const heavy = leftBehind.filter(item => item.reason !== 'held');
    const held = leftBehind.filter(item => item.reason === 'held');
    const behind = heavy.length ? ` Left behind, too heavy to carry: ${told(heavy)}.` : '';
    // What the rules cannot register here is told apart from weight; with no danger tier (Story Director dormant, or no policy for the place) it says what to set.
    const kept = held.length ? ` Couldn't be kept here: ${told(held)}${held.some(item => item.cause === 'no-tier') ? ' (set the area\'s danger to keep loot like this)' : ''}.` : '';
    const summary = `${endSummary(result, { pcName, rules: shown, names, currency: chatCurrency(ctx) })}${behind}${kept}${lost}${worn}`;
    const combat = ctx.draft('combat');
    if (foes.length) {
        const beaten = recordOf(combat, 'beaten', 'fight');
        beaten[session.id] = { fight: session.id, rev, foes, won: result.outcome === 'victory' };
        prune(beaten, MAX_BEATEN, session.id);
    }
    // Written whole (a one-entry list is one replace): the newest result left on the chat's line wins.
    // `parts`: the same summary in parts, for the Fight screen (board/parts.js); the text stays as it was.
    const parts = lastParts(result, { names, pcName, rules: shown, currency: chatCurrency(ctx), notes: [behind, kept, lost, worn] });
    // `reply`: the reply the settle is stored on (ctx.reply, SPEC §4.2), so the Fight screen can fold the
    // result once a later reply has been written (lastFresh, combat.fold).
    const settledOn = replyOf(ctx);
    combat.last = [{ summary, moments: [...result.keyMoments], outcome: session.status, rev, parts, ...(settledOn ? { reply: settledOn } : {}), ...(sealed ? { batch: sealed.batch } : {}) }];
    dropSession(combat, session.id);
    return {
        summary,
        narrate: true,
        data: {
            session: session.id,
            outcome: session.status,
            stakes: setup.stakes === 'death' ? 'death' : 'normal',
            died: died.map(entry => ({ ...entry })),
            ...(wear?.data?.changes?.length ? { wear: wear.data.changes.map(change => ({ stack: change.stack, name: change.name, cond: change.to, band: change.band })) } : {}),
            foes,
            ...(sealed ? { batch: sealed.batch } : {}),
            ...(deathBatch ? { deathBatch: deathBatch.batch } : {}),
            xp: { ...result.xp },
            loot: {
                money: result.loot.money,
                items: result.loot.items.map(item => ({ name: item.name, qty: item.qty, rarity: item.rarity })),
                ...(leftBehind.length ? { left: leftBehind.map(item => ({ name: item.name, qty: item.qty, rarity: item.rarity, ...(item.reason ? { reason: item.reason, ...(item.cause ? { cause: item.cause } : {}) } : {}) })) } : {}),
            },
        },
    };
}

// --- the last fight, folded once the story has moved on ---------------------------------------
//
// Beta.1 live test: "it still shows the last battle result after 2 more messages". The Fight screen shows
// the last fight in full only while it is news: on the reply it was settled on and the reply right after
// (the one that tells it). Before any later reply, beforeGenerate folds it (`combat.fold`, a system step on
// the reply the reader last saw, like the settle's own cue); the Fight screen then says there is no fight,
// with the last one folded under it. A swipe or regenerate of the reply that tells it brings no fold (the
// head is still the settled reply, or the cue is for a swipe); a swipe or delete of the reply that carries
// the fold takes it back. The fold is a claim keyed by the result's rev (`combat:fold:r<rev>` in
// `meta.claims`, which every state has: a keyed add that a middle delete never leaves without its parent).

/** { sid, index } of the reply a command's changes are stored on (SPEC §4.2 ctx.reply), else null. */
function replyOf(ctx) {
    const reply = ctx?.reply;
    if (!reply || typeof reply !== 'object') return null;
    const sid = typeof reply.sid === 'string' && reply.sid ? reply.sid.slice(0, 64) : null;
    const index = Number.isInteger(reply.index) && reply.index >= 0 ? reply.index : null;
    return sid || index !== null ? { sid, index } : null;
}

const foldClaim = last => `combat:fold:r${Number.isInteger(last?.rev) ? last.rev : 0}`;

/** Whether the last result is folded on this line of history (`state`: the whole state, for its claims). */
export function lastFolded(state) {
    const last = lastOf(combatOf(state));
    const claims = state?.meta?.claims;
    return Boolean(last && claims && typeof claims === 'object' && claims[foldClaim(last)] === true);
}

/**
 * Whether the last result is still the latest reply's news: the reply now at the head (`reply`, a query's
 * tools.reply) is the one it was settled on. null when either is unknown; false for a result kept before
 * results named their reply.
 */
export function lastFresh(last, reply) {
    if (!last) return null;
    const at = last.reply;
    if (!at) return false;
    if (!reply || typeof reply !== 'object') return null;
    if (at.sid && typeof reply.sid === 'string' && reply.sid) return at.sid === reply.sid;
    if (Number.isInteger(at.index) && Number.isInteger(reply.index)) return at.index === reply.index;
    return null;
}

/** combat.last(state, args, tools) → the last result with `folded` (and `fresh` when the host says which reply is the head), or null. */
export function lastView(state, args, tools) {
    const combat = combatOf(state);
    const last = lastOf(combat);
    if (!last) return null;
    return { ...structuredClone(last), folded: lastFolded(state), fresh: lastFresh(last, tools?.reply ?? null) };
}

/** combat.fold({ rev }) (system; beforeGenerate's): the last result folded on the Fight screen. */
function fold(ctx, payload = {}) {
    if (ctx?.cause === 'ui') ctx.fail('REFUSED', 'The last fight folds by itself when the story moves on.');
    const last = lastOf(ctx.read('combat'));
    if (!last) ctx.fail('NOT_FOUND', 'There is no last fight to fold.');
    if (payload?.rev !== undefined && payload.rev !== last.rev) ctx.fail('NOT_FOUND', 'That is not the last fight any more.');
    if (!ctx.claim(foldClaim(last))) ctx.fail('CLAIMED', 'The last fight is folded already.');
    return { summary: '', narrate: false, data: { rev: last.rev } };
}

/**
 * beforeGenerate (SPEC §4.1 step 3; beta.1 live test "fight doesn't go off after a turn"): a fight that
 * is over (won, lost or fled) and not yet settled with Finish is settled before the next reply, as
 * Finish would (the `combat.end` cue, a system step kept on the turn it ran for): the board and the
 * tail's "being settled" line clear, the party gets its HP, XP, skill uses and loot, and this reply
 * tells the fight. Only for a new reply (not a swipe, a Continue, a quiet or an impersonated one); a
 * fight still under way stays the reader's to play. combat.end's claim settles it once.
 */
export function settleBeforeReply(view, info = {}) {
    const type = String(info?.type ?? 'normal').toLowerCase();
    if (type === 'swipe' || type === 'continue' || type === 'quiet' || type === 'impersonate') return { commands: [] };
    let session = null;
    try { session = sessionOf(view?.state?.domains?.combat); } catch { session = null; }
    if (session && session.status !== 'active' && STATUSES.includes(session.status)) return { commands: [{ type: 'combat.end', payload: { session: session.id } }] };
    // The last fight was told by the reply now at the head (or before): fold it for the reply to come.
    let last = null;
    try { last = view?.query?.('combat.last', {}) ?? null; } catch { last = null; }
    if (last && !last.folded && last.fresh === false) return { commands: [{ type: 'combat.fold', payload: { rev: last.rev } }] };
    return { commands: [] };
}

/** combat.dismiss({ offer }): the reader turns an offered fight down. */
function dismiss(ctx, payload) {
    const combat = ctx.read('combat');
    const offer = offersOf(combat).find(entry => entry.id === payload?.offer);
    if (!offer) ctx.fail('NOT_FOUND', 'That fight is no longer on offer.');
    const draft = ctx.draft('combat');
    delete recordOf(draft, 'offers')[offer.id];
    return { summary: `The reader turns down the fight with ${foesText(offer.foes, { tiers: false })}.`, narrate: false, data: { offer: offer.id } };
}

/** What an offer's card reads its ranks with: { ladder (party.ranks), pcLevel, rules }; none when the queries are not there. */
function cardContext(tools, state = null) {
    const ask = (name, query) => {
        try { return typeof tools?.query === 'function' ? tools.query(name, query) : null; } catch { return null; }
    };
    let rules;
    try { rules = rulesFrom(tools?.settings ?? null, state?.domains?.rules); } catch { rules = undefined; }
    const level = Number(ask('party.pc', {})?.level);
    return { ladder: ask('party.ranks', {}), pcLevel: Number.isInteger(level) && level >= 1 ? level : 1, ...(rules ? { rules } : {}) };
}

// --- capture ----------------------------------------------------------------------------------

/** The names of the foes this reply left in the combat record, as the reply stands in a Re-read and not as the state before it: its offers' foes and its fights' enemies. */
function storedNames(ctx) {
    const standing = ctx.standing?.domains?.combat;
    const base = ctx.read('combat');
    const baseOffers = new Set(valuesOf(base?.offers).map(offer => offer?.id));
    const names = [];
    for (const offer of valuesOf(standing?.offers)) if (!baseOffers.has(offer?.id)) for (const foe of offer?.foes ?? []) names.push(foe?.name);
    for (const [id, fight] of Object.entries(standing?.fights ?? {})) {
        if (base?.fights && Object.hasOwn(base.fights, id)) continue;
        let setup = null;
        try { setup = unpackSetup(structuredClone(fight?.setup)); } catch { setup = null; }
        for (const enemy of [...(setup?.enemies ?? []), ...(setup?.waves ?? []).flatMap(wave => wave?.enemies ?? [])]) names.push(enemy?.name);
    }
    return names.filter(name => typeof name === 'string');
}

/** What the fights this reply ended say of themselves (their result's summary and moments), and the foes it beat: the names of a fight that is over. */
function storedTexts(ctx) {
    const standing = ctx.standing?.domains?.combat;
    const base = ctx.read('combat');
    const sid = ctx.carrier?.sid ?? null;
    const texts = [];
    const lastNow = Array.isArray(standing?.last) ? standing.last : standing?.last ? [standing.last] : [];
    for (const entry of lastNow) if (sid && entry?.reply?.sid === sid) texts.push(entry.summary, ...(Array.isArray(entry.moments) ? entry.moments : []));
    for (const [id, entry] of Object.entries(standing?.beaten ?? {})) if (!(base?.beaten && Object.hasOwn(base.beaten, id))) for (const foe of entry?.foes ?? []) texts.push(foe?.name);
    return texts.filter(text => typeof text === 'string');
}

/**
 * The Auto rule a Re-read's offer had before it, `{ rule: 'practice' | 'none', field }` (`field`: the offer recorded it as its own field) from the offer of that id the reply left (it is the same line, so the same id), else from the fight the reply
 * began on foes of that name (the offer is spent by then); undefined for a line with no earlier offer or fight, which gets the rule of today.
 */
function earlierAutoRule(ctx, id, foes) {
    const standing = ctx.standing?.domains?.combat;
    if (!standing) return undefined;
    const base = ctx.read('combat');
    const held = valuesOf(standing.offers).find(offer => offer?.id === id && !valuesOf(base?.offers).some(other => other?.id === id));
    if (held) return { rule: (held.autoRule ?? held.opposition?.autoRule) === 'practice' ? 'practice' : 'none', field: held.autoRule !== undefined };
    const wanted = new Set(foes.map(foe => foe.name));
    for (const [fightId, fight] of Object.entries(standing.fights ?? {})) {
        if (base?.fights && Object.hasOwn(base.fights, fightId)) continue;
        let setup = null;
        try { setup = unpackSetup(structuredClone(fight?.setup)); } catch { setup = null; }
        const names = [...(setup?.enemies ?? []), ...(setup?.waves ?? []).flatMap(wave => wave?.enemies ?? [])].map(enemy => String(enemy?.questName ?? enemy?.name ?? '').replace(/ [A-Z]$/, ''));
        if (names.some(name => wanted.has(name))) return { rule: fight.setup?.autoRule === 'practice' ? 'practice' : 'none', field: true };
    }
    return undefined;
}

/** `! encounter …`: an offer, or a plain reason it cannot be one. */
function captureEncounter(ctx, line) {
    const numbers = fightNumbers(ctx.settings() ?? {});
    const rules = fightRules(numbers);
    // The chat's creatures, then the packs' (packBestiary), then the shipped ones.
    const bestiary = combinedBestiary(fightBestiary(ctx, rules), DEFAULT_BESTIARY);
    // A `rank:` is read on the suite's ladder for the character's level now (MODULES §F91).
    const ranks = rankContext(ctx);
    const literal = !!pinnedOf(ctx) && Object.hasOwn(line.labels ?? {}, 'like');
    // A count in front of a named kind is read where Jobs from the story shows its block: the way this line was first read, when this is a Re-read of it (offer-feature.js).
    let leadingCount = false;
    if (literal && hasOpenQuests(rulesPin(ctx.read('rules')))) {
        leadingCount = readsFreely(ctx, line, () => countReading(line, storedNames(ctx), storedTexts(ctx)));
        keepRoute(ctx, line, leadingCount);
    }
    const read = readEncounter(line, { bestiary, ...ranks, literal, leadingCount });
    if (!read.ok) ctx.fail('INVALID', read.message);
    // Every foe written is fought, in waves; what a fight cannot hold is told (B-a2-4, B-a2-9): past
    // MAX_ENCOUNTER_FOES, and past what each tier can hold for the party (heldToTiers).
    const written = [...read.foes, ...(read.cut ?? [])].reduce((sum, foe) => sum + foe.count, 0);
    const hold = { pcLevel: ranks.pcLevel, members: fighters(ctx), field: numbers.field, rules };
    const held = heldToTiers(read.foes, hold);
    // A fight against the foes an active quest is about is sized for real progress (combat/quest.js),
    // never past what its tier can hold, nor past MAX_ENCOUNTER_FOES in all.
    const total = held.foes.reduce((sum, foe) => sum + foe.count, 0);
    const room = tier => Math.min(MAX_ENCOUNTER_FOES - total,
        tierRoom(tier, { ...hold, cap: fieldCap(hold.members, hold.field) }) - held.foes.filter(foe => foe.tier === tier && !foe.rank).reduce((sum, foe) => sum + foe.count, 0));
    const quest = questSized(held.foes, questTargets(ctx), bestiary, { room });
    const problem = [cutText(read.cut, written), heldText(held.cut)].filter(Boolean).join(' ');
    let place = read.place;
    if (!place) {
        try { place = String(ctx.read('scene')?.place?.name ?? '').trim().slice(0, 60); } catch { place = ''; }
    }
    const id = newId(ctx, 'en');
    const binding = bindEncounter(ctx, quest.foes, line.labels?.like);
    const offer = { ...(binding ? { area: binding.area } : {}), id, foes: binding?.foes ?? quest.foes, stakes: read.stakes, place, rev: nextRev(ctx), ...(read.note ? { note: read.note } : {}) };
    // The Auto rule the offer is fought with is recorded with it; a Re-read of a line that made an offer before keeps the rule that offer had, whatever the default is now.
    if (pinnedOf(ctx)) {
        const earlier = earlierAutoRule(ctx, id, offer.foes);
        if (earlier === undefined || earlier.rule === 'practice') offer.autoRule = 'practice';
        resolveOpposition(ctx, offer, { numbers, chatBestiary: fightBestiary(ctx, rules) });
        // An offer recorded before the field keeps its shape (its opposition says the rule).
        if (earlier && !earlier.field) delete offer.autoRule;
    }
    const draft = ctx.draft('combat');
    const offers = recordOf(draft, 'offers');
    // Under its own id (B-b1r2-13); the oldest go past MAX_OFFERS.
    offers[id] = offer;
    prune(offers, MAX_OFFERS, id);
    return {
        summary: `A fight is offered: ${foesText(offer.foes)}${offer.stakes === 'death' ? ', to the death' : ''}.${quest.sized.length ? ` Sized for the quest: ${quest.sized.map(entry => `${entry.name} ${entry.from} → ${entry.to}`).join(', ')} (in waves past the field).` : ''}`,
        narrate: false,
        data: { offer: id },
        ...(problem ? { problem } : {}),
    };
}

// --- validators -------------------------------------------------------------------------------

const isInt = (value, min = 0) => Number.isInteger(value) && value >= min;
const isText = (value, max = 400) => typeof value === 'string' && value.length <= max;

// An action's `stock` (combat.act): absent, or [{ member, item, left }] with whole numbers.
const validStock = stock => stock === undefined || (Array.isArray(stock) && stock.length <= 200
    && stock.every(entry => isText(entry?.member, 40) && isInt(entry?.item) && isInt(entry?.left)));

export function validateCombat(slice) {
    const errors = [];
    if (!slice || typeof slice !== 'object') return ['The combat record is missing.'];
    const record = value => Boolean(value) && typeof value === 'object';
    if (!record(slice.offers)) errors.push('combat.offers must be a record.');
    else {
        const offers = valuesOf(slice.offers);
        // 4× the kept number: a replay after a middle delete may keep one the deleted reply had pruned.
        if (offers.length > MAX_OFFERS * 4) errors.push(`combat.offers holds about ${MAX_OFFERS} fights at most.`);
        if (!Array.isArray(slice.offers)) for (const [key, offer] of Object.entries(slice.offers)) if (offer?.id !== key) errors.push(`combat.offers.${key} is kept under another id.`);
        offers.forEach((offer, n) => {
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
    const checkSession = (s, where) => {
        if (!isText(s.id, 20) || !/^fi_[0-9a-z]{8}$/.test(s.id)) errors.push(`${where}.id must be a fight id like fi_k3f9a2qz.`);
        if (!s.setup || typeof s.setup !== 'object' || !Array.isArray(s.setup.party) || !Array.isArray(s.setup.enemies)) errors.push(`${where}.setup must hold the party and the foes.`);
        if (!Array.isArray(s.actions) || s.actions.some(action => !cleanAction(action) || !validStock(action.stock))) errors.push(`${where}.actions must be a list of actions.`);
        if (!STATUSES.includes(s.status)) errors.push(`${where}.status must be ${STATUSES.join(', ')}.`);
        if (s.ranks !== undefined && (!Array.isArray(s.ranks) || s.ranks.length > 6 || s.ranks.some(entry => !isText(entry?.name, 60) || !isText(entry?.rank, 40)))) errors.push(`${where}.ranks must be a short list of { name, rank }.`);
        if (s.rev !== undefined && !isInt(s.rev)) errors.push(`${where}.rev must be a whole number.`);
    };
    // An older chat's one fight (before fights were kept under their ids).
    const s = slice.session;
    if (s !== null && s !== undefined) checkSession(s, 'combat.session');
    else if (s === undefined && slice.fights === undefined) errors.push('combat.session must be a fight or null.');
    // The fights, each under its own id (stored.js sessionOf). More than one is there only when a replay
    // passed over an earlier fight's end; a generous bound, so no later block is refused for it.
    if (slice.fights !== undefined) {
        if (!record(slice.fights)) errors.push('combat.fights must be a record.');
        else {
            const keys = Object.keys(slice.fights);
            if (keys.length > MAX_BEATEN) errors.push(`combat.fights keeps ${MAX_BEATEN} fights at most.`);
            for (const key of keys) {
                const fight = slice.fights[key];
                if (!fight || typeof fight !== 'object') { errors.push(`combat.fights.${key} is not a fight.`); continue; }
                checkSession(fight, `combat.fights.${key}`);
                if (fight.id !== key) errors.push(`combat.fights.${key} is kept under another id.`);
            }
        }
    }
    if (!record(slice.beaten)) errors.push('combat.beaten must be a record.');
    else {
        const beaten = valuesOf(slice.beaten);
        if (beaten.length > MAX_BEATEN * 4) errors.push(`combat.beaten keeps about ${MAX_BEATEN} fights at most.`);
        beaten.forEach((entry, n) => {
            if (!isInt(entry?.rev) || typeof entry?.won !== 'boolean' || !Array.isArray(entry?.foes)
                || entry.foes.some(foe => !isText(foe?.name, 60) || !isInt(foe?.count, 1))) errors.push(`combat.beaten[${n}] must be { rev, foes: [{ name, count }], won }.`);
        });
    }
    if (Array.isArray(slice.last) && slice.last.length > 1) errors.push('combat.last holds one result.');
    const last = Array.isArray(slice.last) ? slice.last[0] ?? null : slice.last;
    if (last !== null && last !== undefined) {
        if (!isText(last.summary, 4000) || !Array.isArray(last.moments) || last.moments.some(moment => typeof moment !== 'string')) errors.push('combat.last must be { summary, moments }.');
        if (last.parts !== undefined) errors.push(...partsProblems(last.parts));
    } else if (last === undefined) errors.push('combat.last must be a result or null.');
    return errors;
}

export function validateBestiary(slice) {
    if (!slice || typeof slice !== 'object' || !slice.creatures || typeof slice.creatures !== 'object' || Array.isArray(slice.creatures)) return ['bestiary.creatures must be a record.'];
    const errors = [];
    const keys = Object.keys(slice.creatures);
    if (keys.length > MAX_CREATURES * 4) errors.push(`The bestiary keeps about ${MAX_CREATURES} creatures at most.`);
    for (const key of keys) {
        const entry = slice.creatures[key];
        if (!isText(entry?.name, 60) || !entry.name.trim()) errors.push(`bestiary.creatures.${key} has no name.`);
        // A chat saved before B-b4-5 keeps a creature under its Latin-only key.
        else if (creatureSlug(entry.name) !== key && latinSlug(entry.name) !== key) errors.push(`bestiary.creatures.${key} is filed under the wrong name (${entry.name}).`);
        if (!isInt(entry?.level, 1)) errors.push(`bestiary.creatures.${key}.level must be a whole number, 1 or more.`);
    }
    return errors;
}

// --- queries ----------------------------------------------------------------------------------

const combatOf = state => state?.domains?.combat ?? { offers: {}, session: null, beaten: {}, last: [] };

/** combat.foesBeaten({ sinceRev }) → [{ rev, foes: [{ name, count }], won }]: the fights settled after `sinceRev`. */
export function foesBeaten(state, { sinceRev = -1 } = {}) {
    const since = Number.isFinite(Number(sinceRev)) ? Number(sinceRev) : -1;
    return beatenOf(combatOf(state)).filter(entry => entry.rev > since).map(({ fight: _fight, ...entry }) => structuredClone(entry));
}

// --- the part ---------------------------------------------------------------------------------

export const part = {
    domains: {
        combat: {
            initial: () => ({ offers: {}, session: null, fights: {}, beaten: {}, last: [] }),
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
        'combat.fold': fold,
    },
    queries: {
        // `card` (terms2): each foe's rank on the suite's ladder and the fight's tier, for the Fight screen.
        'combat.offers': (state, args, tools) => {
            const offers = offersOf(combatOf(state));
            const card = offers.length ? cardContext(tools, state) : null;
            return offers.map(offer => ({ ...structuredClone(offer), text: foesText(offer.foes), card: foesCard(offer.foes, card) }));
        },
        // Never throws to the reader (a view that cannot be rebuilt reads as no fight).
        'combat.session': state => {
            try { return sessionView(sessionOf(combatOf(state))); } catch { return null; }
        },
        // The last result with `folded` (the Fight screen shows it in full only until a later reply) and `fresh`.
        'combat.last': lastView,
        'combat.foesBeaten': foesBeaten,
        'bestiary.creatures': state => bestiaryList(state?.domains?.bestiary).map(entry => ({ name: entry.name, level: entry.level, template: entry.template ?? null, look: entry.look ?? '' })),
    },
    kinds: {
        encounter: { grammar: GRAMMAR, apply: clipped(captureEncounter) },
    },
    context: {
        static: () => STATIC_TEXT,
        tail: view => tailLines(view?.state?.domains?.combat),
        budget: 150,
    },
    hooks: { beforeGenerate: settleBeforeReply },
    settings: {
        section: 'Combat',
        defaults: { ...COMBAT_DEFAULTS },
        schema: {
            turnOrder: { type: 'choice', label: 'Turn order', options: ['timeline', 'rounds'], help: 'Timeline: faster fighters act more often. Rounds: everyone once a round.' },
            speedOffset: { type: 'int', label: 'Speed (AGI +)', min: 0, max: 50 },
            hitBase: { type: 'int', label: 'Hit chance base %', min: 5, max: 95 },
            hitPerPoint: { type: 'int', label: 'Hit chance per DEX–AGI point', min: 0, max: 10 },
            // Fights: foes on the field at once; the rest of an encounter comes in later waves (setup.planWaves).
            fieldPerMember: { type: 'int', label: 'Fights: foes on the field per party member', min: COMBAT_LIMITS.fieldPerMember[0], max: COMBAT_LIMITS.fieldPerMember[1], help: 'More foes than this come in later waves, each when the one before is down. The tier still means the same danger: it counts the whole encounter.' },
            fieldMax: { type: 'int', label: 'Fights: foes on the field at most', min: COMBAT_LIMITS.fieldMax[0], max: COMBAT_LIMITS.fieldMax[1] },
        },
    },
    // The Fight tab is the board part's screen `rpg-battle/fight` (SPEC §13.1).
    tabs: [],
};
