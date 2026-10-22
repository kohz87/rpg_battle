// RPG Battle v2, trade part: a smith's or tailor's work on a piece of the party's gear (TRS ideas 2
// and 9; the numbers of condition and refinement are items/condition.js).
//
// **Repair** (`trade.repair { stack, at? }`, the story's `! repair Chain Shirt | at: smith`): at a
// market, a smith (or a tailor, leatherworker, armourer: a crafter) puts the piece back to full, its
// maximum too (what field patches frayed). The fee is the condition missing × the piece's worth × the
// place's prices × its refinement: missing counted from the lowest the piece has been since its last
// proper repair (a patched piece is redone); never more than REPAIR_CAP of what the piece costs new at
// the cheapest shop here. The fee is kept with the repair: a piece never sells for more than it would
// have at the worst it ever was plus the repair fees paid (condition.js resaleOf), so a repair cannot
// be sold back at a profit.
//
// **Refinement** (`trade.refine { stack, at?, materials? }`, `! refine Iron Sword | at: smith | with:
// Iron Ore x2`): a level up, to +3 at most, for that many materials (the party's, named or picked by
// what the piece is made of) and a fee (a share of its worth by the level, at least what it adds to the
// resale). Levels +1 and +2 always take; the +3 attempt takes REFINE_LAST_CHANCE of the time (the
// receipt's seed, ctx.rng): when it fails, the materials and the fee are spent and the piece stays +2.
// A piece must be in fair repair (worn or better) to be refined. One refinement per piece per reply.
//
// Money and materials go through Story Block's wallet and inventory (calls.js); the piece's record
// as an event of its own in the items part's gear domain (items/wear.js recordEvent). Every plan is pure and is what trade.quote returns.

import {
    FULL, MAX_REFINE, REFINE_OFF, WEAR_OFF, REFINE_FEATURE, REFINE_STEP, WEAR_FEATURE, bandOf, bareName, maxResaleShare, pieceName, pieceOf, refineFactor,
} from '../items/condition.js';
import { pieceNamed, recordEvent, replyOf } from '../items/wear.js';
import { isMaterial } from '../../trade.js';
import { CODES, legacyItem, money, summaryOf, traderKind, worthOf } from './core.js';
import { consume, pay } from './calls.js';

/** Who repairs and refines: a smith, or a crafter (a tailor, a leatherworker, an armourer…). */
export const REPAIRERS = Object.freeze(['smith', 'crafter']);
/** A refinement's fee by the level it reaches, as a share of the piece's worth (× the place's prices). */
export const REFINE_FEE = Object.freeze([0, 0.15, 0.3, 0.5]);
/** The chance the last level (+3) takes. */
export const REFINE_LAST_CHANCE = 0.6;
/** A repair costs at most this share of the piece's price new at the cheapest shop here. */
export const REPAIR_CAP = 0.9;

const no = (code, message) => ({ ok: false, code, message });
const clean = (value, max = 80) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const key = value => clean(value, 200).normalize('NFKC').toLowerCase();
const isCount = value => Number.isInteger(value) && value >= 1;

// What a piece is made of, by its slot: the materials that refine it (their name or tags).
const METAL = /\b(?:ore|ingot|iron|steel|bronze|copper|silver|gold|mithril|metal|scrap|nails?|rivets?|chain)\b/i;
const CLOTH = /\b(?:cloth|leather|hide|pelt|skin|silk|thread|wool|linen|fur|felt|cord|sinew|scales?)\b/i;
const GEM = /\b(?:gem|crystal|jewel|shard|quartz|amber|pearl|silver|gold|stone|bone|horn)\b/i;

/** The words a piece's refining materials carry: metal for arms and armour, cloth for worn pieces, gems for accessories. */
export function materialFor(def) {
    const slot = String(def?.slot ?? '');
    if (slot === 'worn') return CLOTH;
    if (slot === 'accessory') return GEM;
    return METAL;
}

/** Whether a material suits a piece by its name or tags (materialFor). */
const suits = (piece, material) => {
    const fits = materialFor(piece);
    return fits.test(material?.name ?? '') || (material?.tags ?? []).some(tag => fits.test(tag));
};

function noMarket(world) {
    const where = world.place.name ? ` (${world.place.name})` : '';
    return no(CODES.noMarket, `No smith or tailor here${where}: gear is repaired and refined at a market.`);
}

/** The worker named by `at` (a kind or a name): { kind, who }, or a refusal. */
function workerOf(world, at) {
    const said = clean(at) || 'smith';
    const kind = traderKind(said, world.rules);
    if (!REPAIRERS.includes(kind)) return no(CODES.refused, 'Only a smith or a tailor (a leatherworker, an armourer) works on gear.');
    const plain = /^[a-z-]+$/i.test(said) ? `the ${said.toLowerCase()}` : said;
    return { ok: true, kind, who: plain };
}

/** The party's equipment stack `stack` names, or a refusal. */
function pieceFor(world, stackId) {
    const row = typeof stackId === 'string' ? world.inventory.stacks[stackId] : null;
    const def = row ? world.inventory.defs[row.def] : null;
    const owner = row?.owner;
    const ours = owner === 'party' || Boolean(owner && world.party?.actors?.[owner]);
    if (!row || !def || !ours || !(row.qty > 0)) return no(CODES.notFound, 'That piece is not among the party\'s gear.');
    if (def.kind !== 'equipment') return no(CODES.refused, `The ${def.name} is not a piece of gear to work on.`);
    return { ok: true, row, def };
}

const ceil = value => Math.max(1, Math.ceil(value - 1e-9));

/** What the piece costs new at the cheapest shop here: a pack shop's line for it, else its worth at the place's prices. */
export function newPrice(world, def) {
    const listed = (world.packShops ?? []).flatMap(shop => shop.stock ?? []).filter(line => line.def?.id === def.id);
    const rate = world.prices.shortage ? world.prices.shortage / 100 : 1;
    const prices = [worthOf(def, world) * (world.prices.buy ?? 1), ...listed.map(line => (line.price !== null ? line.price * rate : worthOf(line.def, world) * (world.prices.buy ?? 1)))];
    return Math.max(1, Math.min(...prices));
}

/**
 * What a smith's repair of `stack` would come to: { ok, type: 'repair', stack, def, name, from, max,
 * missing, fee, kind, who, line } or a refusal (no market, not a smith, not gear, nothing to repair,
 * gear wear off).
 */
export function planRepair(world, { stack, at = '' } = {}) {
    if (!world.features?.wear) return no('FEATURE_OFF', `${WEAR_OFF}.`);
    if (!world.market.open) return noMarket(world);
    const worker = workerOf(world, at);
    if (!worker.ok) return worker;
    const found = pieceFor(world, stack);
    if (!found.ok) return found;
    const { def } = found;
    const piece = pieceOf(world.inventory, world.gear, stack, world.features);
    const name = pieceName(def.name, piece.refine);
    const kept = Math.min(piece.cond, piece.low, piece.max);
    const missing = FULL - kept;
    if (missing <= 0) return no(CODES.refused, `The ${name} is in good repair already.`);
    const worth = worthOf(def, world);
    const fee = ceil(Math.min(missing / FULL * worth * refineFactor(piece.refine) * (world.prices.buy ?? 1), REPAIR_CAP * newPrice(world, def)));
    const line = `has ${worker.who} repair the ${name} for ${money(world, fee)} (${piece.cond}/${piece.max} → ${FULL}/${FULL})`;
    return { ok: true, type: 'repair', stack, def: def.id, name, from: piece.cond, max: piece.max, band: piece.band, missing, fee, kind: worker.kind, who: worker.who, refine: piece.refine, line };
}

// "Iron Ore x2", "2 Iron Ore", "Iron Ore" → { name, qty }.
function materialWords(text) {
    const said = clean(text, 120);
    let match = /^(.*?)\s*[x×]\s*(\d{1,2})$/i.exec(said);
    if (match) return { name: match[1], qty: Number(match[2]) };
    match = /^(\d{1,2})\s+(.*)$/.exec(said);
    if (match) return { name: match[2], qty: Number(match[1]) };
    return { name: said, qty: 1 };
}

/** The party's loose material stacks, cheapest first then by id: [{ stack, def, qty }]. */
function materialsHeld(world) {
    const ours = owner => owner === 'party' || Boolean(owner && world.party?.actors?.[owner]);
    return Object.keys(world.inventory.stacks).sort().map(id => world.inventory.stacks[id])
        .filter(row => row && row.qty > 0 && !row.equipped && ours(row.owner))
        .map(row => ({ stack: row.id, def: world.inventory.defs[row.def], qty: row.qty }))
        // Materials, and goods whose name says what they are (Iron Ore, a Wolf Pelt).
        .filter(entry => entry.def && (isMaterial(legacyItem(entry.def)) || entry.def.kind === 'goods'))
        .sort((a, b) => worthOf(a.def, world) - worthOf(b.def, world) || (a.stack < b.stack ? -1 : 1));
}

/** The materials a refinement takes: `given` ([{ stack, qty }] or [{ name, qty }]), else picked; or a refusal. */
function pickMaterials(world, def, need, given) {
    const held = materialsHeld(world);
    if (Array.isArray(given) && given.length) {
        const picked = new Map();
        for (const entry of given.slice(0, 6)) {
            const qty = entry?.qty ?? 1;
            if (!isCount(qty)) return no(CODES.invalid, 'Say how many of each material: a whole number, at least 1.');
            const row = entry?.stack
                ? held.find(item => item.stack === entry.stack)
                : held.find(item => key(item.def.name) === key(entry?.name));
            if (!row) return no(CODES.notFound, `There is no ${clean(entry?.name) || 'such material'} among the party's loose materials.`);
            if (!isMaterial(legacyItem(row.def)) && !suits(def, row.def)) return no(CODES.refused, `The ${row.def.name} is no material for the ${def.name}.`);
            picked.set(row.stack, { ...row, take: (picked.get(row.stack)?.take ?? 0) + qty });
        }
        const parts = [...picked.values()];
        for (const part of parts) if (part.take > part.qty) return no(CODES.notEnough, `There ${part.qty === 1 ? 'is' : 'are'} only ${part.qty} ${part.def.name}.`);
        const count = parts.reduce((sum, part) => sum + part.take, 0);
        if (count < need) return no(CODES.notEnough, `Refining the ${def.name} to +${need} takes ${need} materials; ${count} ${count === 1 ? 'was' : 'were'} named.`);
        return { ok: true, parts: parts.map(part => ({ stack: part.stack, def: part.def.id, name: part.def.name, qty: part.take })) };
    }
    const fits = materialFor(def);
    const suited = held.filter(item => suits(def, item.def));
    const parts = [];
    let left = need;
    for (const item of suited) {
        if (!left) break;
        const take = Math.min(left, item.qty);
        parts.push({ stack: item.stack, def: item.def.id, name: item.def.name, qty: take });
        left -= take;
    }
    const kind = fits === CLOTH ? 'cloth or leather' : fits === GEM ? 'gems, bone or precious metal' : 'metal';
    if (left) return no(CODES.notEnough, `Refining the ${def.name} to +${need} takes ${need} ${kind} materials; the party has ${need - left}.`);
    return { ok: true, parts };
}

/**
 * What refining `stack` one level would come to: { ok, type: 'refine', stack, def, name, level,
 * next (its name after), materials: [{ stack, def, name, qty }], fee, chance (%), kind, who, line }
 * or a refusal. `materials`: [{ stack | name, qty }] (else the party's suited ones, cheapest first).
 */
export function planRefine(world, { stack, at = '', materials = null } = {}) {
    if (!world.features?.refine) return no('FEATURE_OFF', `${REFINE_OFF}.`);
    if (!world.market.open) return noMarket(world);
    const worker = workerOf(world, at);
    if (!worker.ok) return worker;
    const found = pieceFor(world, stack);
    if (!found.ok) return found;
    const { def } = found;
    const piece = pieceOf(world.inventory, world.gear, stack, world.features);
    const name = pieceName(def.name, piece.refine);
    if (piece.refine >= MAX_REFINE) return no(CODES.refused, `The ${name} cannot be refined any further.`);
    if (world.features.wear && (piece.band === 'tattered' || piece.band === 'broken')) return no(CODES.refused, `The ${name} is ${piece.band}: have it repaired before it is refined.`);
    const level = piece.refine + 1;
    const picked = pickMaterials(world, def, level, materials);
    if (!picked.ok) return picked;
    const worth = worthOf(def, world);
    // Never under what a level adds to what the piece fetches anywhere (no profit from refining).
    const fee = ceil(worth * Math.max(REFINE_FEE[level] * (world.prices.buy ?? 1), REFINE_STEP * maxResaleShare(world.rules)));
    const chance = level === MAX_REFINE ? Math.round(REFINE_LAST_CHANCE * 100) : 100;
    const from = picked.parts.map(part => (part.qty > 1 ? `${part.qty} ${part.name}` : part.name)).join(', ');
    const line = `has ${worker.who} refine the ${name} to +${level} with ${from} for ${money(world, fee)}${chance < 100 ? ` (${chance}% to take)` : ''}`;
    return { ok: true, type: 'refine', stack, def: def.id, name, level, next: pieceName(def.name, level), materials: picked.parts, fee, chance, kind: worker.kind, who: worker.who, line };
}

const must = (ctx, plan) => {
    if (!plan.ok) ctx.fail(plan.code, plan.message);
    return plan;
};

/** `trade.repair { stack, at? }`: pays the fee and puts the piece back to full (condition and maximum). */
export function tradeRepair(ctx, payload, world) {
    const plan = must(ctx, planRepair(world, payload ?? {}));
    pay(ctx, plan.fee);
    // The fee stays with the repair: what it adds to the resale never passes it (condition.js resaleOf).
    recordEvent(ctx, plan.stack, { repair: true, fee: plan.fee });
    return {
        summary: summaryOf(world, plan.line),
        narrate: true,
        data: { kind: 'repair', stack: plan.stack, def: plan.def, name: plan.name, fee: plan.fee, from: plan.from, to: FULL, was: plan.band, band: bandOf(FULL), who: plan.who },
    };
}

/**
 * `trade.refine { stack, at?, materials? }`: takes the materials and the fee; the level takes (the
 * +3 attempt by the receipt's seed). One per piece per reply when the story asks it.
 */
export function tradeRefine(ctx, payload, world) {
    const plan = must(ctx, planRefine(world, payload ?? {}));
    const reply = replyOf(ctx);
    if (reply !== null && !ctx.claim(`refine:${reply}:${plan.stack}`)) ctx.fail(CODES.claimed, `The ${plan.name} was already refined in this reply.`);
    for (const part of plan.materials) consume(ctx, part.stack, part.qty);
    pay(ctx, plan.fee);
    const roll = plan.chance < 100 ? ctx.rng() : 0;
    const took = plan.chance >= 100 || roll < plan.chance / 100;
    if (took) recordEvent(ctx, plan.stack, { refine: 1 });
    const from = plan.materials.map(part => (part.qty > 1 ? `${part.qty} ${part.name}` : part.name)).join(', ');
    const line = took
        ? `has ${plan.who} refine the ${plan.name} for ${money(world, plan.fee)} and ${from}: it is now the ${plan.next}`
        : `has ${plan.who} try to refine the ${plan.name} to +${plan.level} for ${money(world, plan.fee)}, but the work fails: the ${from} ${plan.materials.length === 1 && plan.materials[0].qty === 1 ? 'is' : 'are'} spent and the ${plan.name} stays as it was`;
    return {
        summary: summaryOf(world, line),
        narrate: true,
        data: { kind: 'refine', stack: plan.stack, def: plan.def, name: took ? plan.next : plan.name, level: took ? plan.level : plan.level - 1, took, chance: plan.chance, fee: plan.fee, materials: plan.materials, who: plan.who },
    };
}

const labelsOf = line => {
    const out = {};
    for (const [label, value] of Object.entries(line?.labels ?? {})) out[String(label).trim().toLowerCase()] = String(value ?? '').trim();
    return out;
};

/** The party's piece a story line names, or a refusal. */
function storyPiece(ctx, world, line) {
    const name = clean(line?.name, 120);
    if (!name) ctx.fail(CODES.invalid, 'Name the piece: `! repair Chain Shirt | at: smith`.');
    const stack = pieceNamed(world.inventory, world.party ?? { actors: {} }, name);
    if (!stack) ctx.fail(CODES.notFound, `There is no ${bareName(name)} among the party's gear.`);
    return stack.id;
}

/** `! repair Chain Shirt | at: smith` (a smith's or tailor's repair, paid from the party's purse). */
export function applyRepair(ctx, line, world) {
    if (!world.features?.wear) ctx.fail('FEATURE_OFF', `${WEAR_OFF}.`);
    const labels = labelsOf(line);
    return tradeRepair(ctx, { stack: storyPiece(ctx, world, line), at: labels.at ?? labels.by ?? '' }, world);
}

/** `! refine Iron Sword | at: smith | with: Iron Ore x2` (one level up, materials and a fee). */
export function applyRefine(ctx, line, world) {
    if (!world.features?.refine) ctx.fail('FEATURE_OFF', `${REFINE_OFF}.`);
    const labels = labelsOf(line);
    const materials = labels.with ? labels.with.split(/\s*[,;]\s*|\s+and\s+/i).filter(Boolean).slice(0, 6).map(materialWords) : null;
    return tradeRefine(ctx, { stack: storyPiece(ctx, world, line), at: labels.at ?? labels.by ?? '', materials }, world);
}

export const REPAIR_GRAMMAR = '! repair <piece> | at: smith|tailor (a smith or tailor puts it back to full; code sets the fee)';
export const REFINE_GRAMMAR = '! refine <piece> | at: smith | with: <materials> (one level, +3 at most; code sets the fee and whether it takes)';

export { WEAR_FEATURE, REFINE_FEATURE };
