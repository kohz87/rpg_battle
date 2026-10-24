// RPG Battle v2, items part: the tail's one line about worn gear (TRS idea 1). Only the pieces the
// party wears that are worse than good are named (at most TAIL_PIECES; the rest counted), so the
// story keeps a torn coat torn. Nothing when every piece is fine or gear wear is off. Pure.

import { WEAR_FEATURE, featureOn, gearFeatures, pieceName, pieceOf } from './condition.js';
import { inventoryOf, partyOf, stackIds, wearerOf } from './shared.js';

export const TAIL_PIECES = 4;

/** The tail: `[Gear] Not in good repair: Ren's Chain Shirt (worn), Iron Sword +1 (broken: gives nothing).` */
export function gearTail(view) {
    if (!featureOn(view, WEAR_FEATURE)) return { lines: [], optional: [] };
    const state = view?.state;
    const inventory = inventoryOf(state);
    const party = partyOf(state);
    const features = gearFeatures(view);
    const rows = [];
    for (const id of stackIds(inventory)) {
        const stack = inventory.stacks[id];
        const def = inventory.defs?.[stack?.def];
        if (!stack?.equipped || !(stack.qty > 0) || def?.kind !== 'equipment') continue;
        const wearer = party.actors?.[wearerOf(stack, party)];
        if (!wearer) continue;
        const piece = pieceOf(inventory, state?.domains?.gear ?? null, id, features);
        if (piece.band === 'good') continue;
        rows.push({ cond: piece.cond, text: `${wearer.name}'s ${pieceName(def.name, piece.refine)} (${piece.band === 'broken' ? 'broken: gives nothing' : piece.band})` });
    }
    if (!rows.length) return { lines: [], optional: [] };
    rows.sort((a, b) => a.cond - b.cond || (a.text < b.text ? -1 : 1));
    const more = rows.length > TAIL_PIECES ? `, and ${rows.length - TAIL_PIECES} more` : '';
    return { lines: [`[Gear] Not in good repair: ${rows.slice(0, TAIL_PIECES).map(row => row.text).join(', ')}${more}.`], optional: [] };
}
