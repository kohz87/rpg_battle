// RPG Battle v2, items part: wearing gear down and patching it in the field (TRS ideas 1 and 2,
// condition.js has the numbers). Handlers follow SPEC §3.2: everything through ctx.
//
// Wear comes from code events only, never from a number the story writes:
// - `item.fightWear` (internal: combat.end sends it once a fight): each armour piece a member wears
//   loses ARMOUR_WEAR × the share of their max HP the fight's blows took (at least 1 when they were
//   hit, at most ARMOUR_WEAR_MAX), each weapon WEAPON_WEAR.
// - `item.wear { name | stack, wear: scuff|tear|ruin, why?, story: true }` (Story Block routes a
//   `~ item Coat — torn by brambles | wear: tear` line here, as it routes a used `- item` to
//   item.use): code's number for the word, once per piece per reply (claim `wear:<reply>:<stack>`).
// A piece that breaks may lose a refinement level (seeded, ctx.rng). The receipt tells the next reply
// when a piece moved to another band ("Ren's Chain Shirt is now worn").
//
// A repair kit (a consumable with `effect.repair`, an amount) patches a piece in the field
// (`! use Repair Kit | on: Chain Shirt`, or `| on: Ren` for their most worn piece): the condition comes
// back by that much, up to the piece's maximum, and the maximum frays by PATCH_FRAY (never below
// MIN_MAX). A smith's repair (trade.repair) puts both back.
//
// Where condition is kept (condition.js): RPG Battle's gear domain alone, as events each receipt
// adds under its own key; a piece's numbers are folded from them (Story Block's own `stack.cond` is
// for a chat without RPG Battle and is not written here).

import {
    ARMOUR_WEAR, ARMOUR_WEAR_MAX, FULL, MIN_MAX, PATCH_FRAY, REFINE_FEATURE, STORY_WEAR, WEAPON_WEAR, WEAR_FEATURE,
    WEAR_OFF, addEvent, bandOf, bareName, featureOn, gearFeatures, pieceName, pieceOf, wearWord,
} from './condition.js';
import { inventoryOf, partyOwns, stackIds, wearerOf } from './shared.js';

const text = value => (typeof value === 'string' ? value.trim() : '');
const key = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function safeRead(ctx, domain) {
    try {
        return ctx.read(domain) ?? null;
    } catch {
        return null;
    }
}

/** The reply a story line came from: `sid:<sid>` (a middle delete never moves it), else `<index>:<swipe>`, else null. */
export function replyOf(ctx) {
    const carrier = ctx?.carrier;
    if (typeof carrier?.sid === 'string' && carrier.sid) return `sid:${carrier.sid.slice(0, 60)}`;
    if (typeof carrier?.key === 'string') return carrier.key;
    if (Number.isInteger(carrier?.index)) return `${carrier.index}:${Number.isInteger(carrier.swipe) ? carrier.swipe : 0}`;
    return null;
}

/** Whether a piece is armour (takes blows) or strikes: armour and worn pieces, an off-hand with DEF or MDEF. */
export function wearRole(def, slotKey) {
    const slot = String(def?.slot || slotKey || '').replace(/-\d+$/, '');
    if (slot === 'armour' || slot === 'worn') return 'armour';
    if (slot === 'weapon') return 'weapon';
    if (slot === 'offhand') return (def?.stats?.DEF || def?.stats?.MDEF) ? 'armour' : 'weapon';
    return null;
}

/** Whose a piece is, for the story's words: "Ren's" (the wearer, or the main character for the bag's). */
function ownerWords(party, stack) {
    const who = party?.actors?.[wearerOf(stack, party)]?.name;
    return who ? `${who}'s` : 'The party\'s';
}

/**
 * Records what this receipt did to a piece (condition.js events: `{ wear, lost }`, `{ patch, fray }`,
 * `{ repair: true }`, `{ refine }`) in the gear domain, the one place condition is kept.
 */
export function recordEvent(ctx, stackId, event) {
    return addEvent(ctx.draft('gear'), stackId, event, Number.isInteger(ctx.rev) ? ctx.rev : 0);
}

/**
 * Wears the pieces `entries` ([{ stack, amount }]) down, each once (amounts of one piece added).
 * A piece that breaks loses a refinement level half the time (ctx.rng). → [{ stack, name, whose,
 * from, to, band, was, lost }] for each piece that changed.
 */
export function applyWear(ctx, entries) {
    const features = gearFeatures(ctx);
    if (!features.wear) return [];
    const totals = new Map();
    for (const entry of entries) {
        const amount = Math.max(0, Math.round(Number(entry?.amount) || 0));
        if (amount && typeof entry?.stack === 'string') totals.set(entry.stack, (totals.get(entry.stack) ?? 0) + amount);
    }
    const out = [];
    const party = safeRead(ctx, 'party');
    for (const [stackId, amount] of [...totals].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const inventory = ctx.read('inventory');
        const stack = inventory?.stacks?.[stackId];
        const def = stack ? inventory.defs?.[stack.def] : null;
        if (!stack || def?.kind !== 'equipment') continue;
        const piece = pieceOf(inventory, safeRead(ctx, 'gear'), stackId, { wear: true, refine: true });
        const cond = Math.max(0, piece.cond - amount);
        if (cond === piece.cond) continue;
        const band = bandOf(cond);
        let refine = piece.refine;
        let lost = false;
        // Breaking may cost a refinement level (seeded: the same receipt breaks it the same way).
        if (band === 'broken' && piece.band !== 'broken' && refine > 0 && features.refine && ctx.rng() < 0.5) {
            refine -= 1;
            lost = true;
        }
        recordEvent(ctx, stackId, { wear: amount, ...(lost ? { lost: 1 } : {}) });
        out.push({
            stack: stackId, name: pieceName(def.name, features.refine ? piece.refine : 0), whose: ownerWords(party, stack),
            from: piece.cond, to: cond, max: piece.max, was: piece.band, band, lost, refine,
        });
    }
    return out;
}

/** What the next reply is told of the pieces worn: "Ren's Chain Shirt is now worn." for each band change. */
export function wearWords(changes) {
    return changes.filter(change => change.band !== change.was).map(change => {
        const lost = change.lost ? ` and loses a level of refinement (now ${change.refine ? `+${change.refine}` : 'plain'})` : '';
        return `${change.whose} ${change.name} is now ${change.band}${lost}.`;
    }).join(' ');
}

/** The equipped pieces a member wears: [{ stack, def }] in a stable order. */
function wornBy(inventory, party, actorId) {
    return stackIds(inventory).map(id => inventory.stacks[id])
        .filter(stack => stack?.equipped && stack.qty > 0 && wearerOf(stack, party) === actorId)
        .map(stack => ({ stack, def: inventory.defs?.[stack.def] ?? null }))
        .filter(entry => entry.def?.kind === 'equipment');
}

/**
 * `item.fightWear { fight, members: [{ actor, taken, maxHp }] }` (internal: combat.end sends it once
 * for a settled fight, claim `wear:fight:<fight>`): the armour each member wears takes the blows,
 * their weapon the fight. Nothing when the feature is off. → { summary: what changed band, data }.
 */
export function fightWear(ctx, payload = {}) {
    if (ctx.cause === 'ui' && !ctx.caller) ctx.fail('REFUSED', 'Gear wears in a fight by itself.');
    if (!featureOn(ctx, WEAR_FEATURE)) return { summary: '', narrate: false, data: { changes: [] } };
    const fight = text(payload?.fight);
    if (fight && !ctx.claim(`wear:fight:${fight.slice(0, 40)}`)) return { summary: '', narrate: false, data: { changes: [], claimed: true } };
    const inventory = inventoryOf({ domains: { inventory: ctx.read('inventory') } });
    const party = safeRead(ctx, 'party') ?? { actors: {} };
    const entries = [];
    for (const member of Array.isArray(payload?.members) ? payload.members.slice(0, 12) : []) {
        const actor = text(member?.actor);
        if (!actor || !party.actors?.[actor]) continue;
        const taken = Math.max(0, Number(member?.taken) || 0);
        const maxHp = Math.max(1, Number(member?.maxHp) || 1);
        const armour = taken > 0 ? Math.min(ARMOUR_WEAR_MAX, Math.max(1, Math.round(ARMOUR_WEAR * taken / maxHp))) : 0;
        for (const { stack, def } of wornBy(inventory, party, actor)) {
            const role = wearRole(def, stack.equipped);
            if (role === 'armour' && armour) entries.push({ stack: stack.id, amount: armour });
            if (role === 'weapon') entries.push({ stack: stack.id, amount: WEAPON_WEAR });
        }
    }
    const changes = applyWear(ctx, entries);
    return { summary: wearWords(changes), narrate: false, data: { changes } };
}

/** The party's equipment stack a story name means: worn ones first, then the wearer's, the bag's, anyone's. */
export function pieceNamed(inventory, party, name, who = null) {
    const wanted = key(bareName(name));
    if (!wanted) return null;
    const ids = new Set();
    const alias = inventory.aliases?.[wanted];
    if (alias) ids.add(alias);
    for (const [id, def] of Object.entries(inventory.defs ?? {})) if (key(def?.name) === wanted) ids.add(id);
    const rows = stackIds(inventory).map(id => inventory.stacks[id])
        .filter(stack => ids.has(stack.def) && stack.qty > 0 && partyOwns(party, stack.owner) && inventory.defs?.[stack.def]?.kind === 'equipment');
    const order = stack => (stack.equipped ? 0 : 2) + (who && wearerOf(stack, party) === who ? 0 : 1);
    return rows.sort((a, b) => order(a) - order(b) || (a.id < b.id ? -1 : 1))[0] ?? null;
}

/**
 * `item.wear { name | stack, wear, why?, story: true }`: the story's word for what happened to a piece
 * (scuff, tear, ruin, or a word for one of them); code's number for it (STORY_WEAR), once per piece
 * per reply. Not from a screen. A piece not found, or a second word for it in one reply, refuses
 * the line (a Problem); nothing changes.
 */
export function storyWear(ctx, payload = {}) {
    if (ctx.cause === 'ui' && !ctx.caller) ctx.fail('REFUSED', 'Gear wears by what happens in the story or a fight, not by a click.');
    if (!featureOn(ctx, WEAR_FEATURE)) ctx.fail('FEATURE_OFF', `${WEAR_OFF}.`);
    const word = wearWord(payload?.wear);
    if (!word) ctx.fail('INVALID', 'Say how the piece suffered: `wear: scuff`, `wear: tear` or `wear: ruin`.');
    const inventory = inventoryOf({ domains: { inventory: ctx.read('inventory') } });
    const party = safeRead(ctx, 'party') ?? { actors: {} };
    const named = text(payload?.name);
    const stack = text(payload?.stack) ? inventory.stacks?.[text(payload.stack)] ?? null : pieceNamed(inventory, party, named);
    const def = stack ? inventory.defs?.[stack.def] : null;
    if (!stack || def?.kind !== 'equipment' || !partyOwns(party, stack.owner)) ctx.fail('NOT_FOUND', `There is no ${named || 'such piece'} among the party's gear.`);
    const reply = replyOf(ctx) ?? `rev:${Number.isInteger(ctx.rev) ? ctx.rev : 0}`;
    if (!ctx.claim(`wear:${reply}:${stack.id}`)) ctx.fail('CLAIMED', `The ${def.name} already took its wear in this reply.`);
    const changes = applyWear(ctx, [{ stack: stack.id, amount: STORY_WEAR[word] }]);
    const change = changes[0];
    if (!change) {
        return { summary: `${ownerWords(party, stack)} ${def.name} cannot be worn any further.`, narrate: false, data: { stack: stack.id, word, changes: [] } };
    }
    const moved = change.band !== change.was;
    const how = { scuff: 'scuffed', tear: 'damaged', ruin: 'badly damaged' }[word];
    return {
        summary: moved ? wearWords(changes) : `${change.whose} ${change.name} is ${how} (${change.to}/${change.max}, still ${change.band}).`,
        narrate: moved,
        data: { stack: stack.id, word, amount: STORY_WEAR[word], changes },
    };
}

// ---------------------------------------------------------------------------------------
// Repair kits: field patches

/** A def's repair amount (a repair kit's `effect.repair`), 0 for anything else. */
export const repairOf = def => (def?.kind === 'consumable' ? Math.max(0, Math.round(Number(def?.effect?.repair) || 0)) : 0);

/**
 * The piece a kit is used on: `on` naming a piece of the party's (the user's own first), else naming
 * a member (their most worn piece), else the main character's most worn piece; null when none.
 */
function kitTarget(inventory, party, gear, on, by) {
    const said = text(on);
    if (said) {
        const piece = pieceNamed(inventory, party, said, by);
        if (piece) return piece;
    }
    const member = said
        ? Object.values(party.actors ?? {}).find(actor => key(actor?.name) === key(said))?.id ?? null
        : by || party.pc;
    if (said && !member) return undefined;
    const worn = wornBy(inventory, party, member);
    const ranked = worn.map(({ stack }) => ({ stack, piece: pieceOf(inventory, gear, stack.id) }))
        .filter(entry => entry.piece.cond < entry.piece.max)
        .sort((a, b) => a.piece.cond - b.piece.cond || (a.stack.id < b.stack.id ? -1 : 1));
    return ranked[0]?.stack ?? null;
}

/**
 * A repair kit used on a piece (`kit`: its stack; `on`: a piece or a member; `by`: the one using it).
 * The kit is used up only when the patch gives something back. → a receipt; a refusal is told with
 * `data.refused` (when `story`), else fails.
 */
export function useKit(ctx, { kit, on = '', by = '', story = false, inFight = false } = {}) {
    const refuse = (code, why) => {
        if (!story) ctx.fail(code, why);
        return { summary: why, narrate: true, data: { refused: true, reason: why, kit: kit?.id ?? null } };
    };
    const inventory = inventoryOf({ domains: { inventory: ctx.read('inventory') } });
    const def = inventory.defs?.[kit?.def];
    const amount = repairOf(def);
    // Off means off (MODULES §F100): nothing is used, and the story is not told of a switched-off mechanic.
    if (!featureOn(ctx, WEAR_FEATURE)) {
        if (!story) ctx.fail('FEATURE_OFF', `${WEAR_OFF}.`);
        return { summary: `The ${def?.name ?? 'kit'} is not used: ${WEAR_OFF.charAt(0).toLowerCase()}${WEAR_OFF.slice(1)}.`, narrate: false, data: { refused: true, reason: 'feature off', kit: kit?.id ?? null } };
    }
    if (!amount) return refuse('REFUSED', `The ${def?.name ?? 'thing'} mends nothing.`);
    if (inFight) return refuse('REFUSED', `Gear is not mended in the middle of a fight: the ${def.name} stays in the bag.`);
    const party = safeRead(ctx, 'party') ?? { actors: {} };
    const gear = safeRead(ctx, 'gear');
    const target = kitTarget(inventory, party, gear, on, by || null);
    if (target === undefined) return refuse('NOT_FOUND', `There is no ${text(on)} among the party's gear or people: the ${def.name} stays in the bag.`);
    if (!target) return refuse('REFUSED', `Nothing worn needs mending: the ${def.name} stays in the bag.`);
    const tdef = inventory.defs?.[target.def];
    const piece = pieceOf(inventory, gear, target.id);
    const max = Math.max(MIN_MAX, piece.max - PATCH_FRAY);
    const cond = Math.min(max, piece.cond + amount);
    const name = pieceName(tdef.name, featureOn(ctx, REFINE_FEATURE) ? piece.refine : 0);
    if (cond <= piece.cond) return refuse('REFUSED', `The ${name} is as mended as a field patch can make it (${piece.cond}/${piece.max}); it needs a smith or a tailor: the ${def.name} stays in the bag.`);
    ctx.call('inventory.consume', { stack: kit.id, qty: 1 });
    recordEvent(ctx, target.id, { patch: amount, fray: PATCH_FRAY });
    const band = bandOf(cond);
    const whose = ownerWords(party, target);
    return {
        summary: `${whose} ${name} is patched with the ${def.name}: ${piece.cond} → ${cond}/${max}${band !== piece.band ? `, now ${band}` : ''} (a patch frays it a little).`,
        narrate: true,
        data: { refused: false, kit: kit.id, stack: target.id, name, from: piece.cond, to: cond, max, was: piece.band, band },
    };
}
