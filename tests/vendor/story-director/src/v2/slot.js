// Story Director v2: how bookkeeping that later replies rewrite is kept, so that deleting a reply never
// breaks the replies after it (B-b1r2-12, the SPEC §2 rule for module state). Pure.
//
// Story Block saves each reply's changes as ops and, after a reply is deleted, replays the later ones on
// the state as it now stands. An op inside something only the deleted reply made (`replace` of a field it
// added, `add` at a list position past the end of a list it lengthened, `remove` of a key it set) no longer
// applies, and the whole line it came with is skipped: its threads, places and the rest are lost. So:
// * Things are kept by key (a thread, a place, a problem), each added whole; one that goes is removed,
//   which Story Block (2.0.0-alpha.2) passes over on replay when a deleted reply had made it.
// * Bookkeeping one value at a time (the reply being read, the last settle, the tail's last pick) is a
//   *slot*: `null`, or a one-entry list `[value]`. Story Block writes a list that changed other than by
//   additions at its end as one `replace` of the whole list (ops.js diff), so a slot is always written
//   whole, at a path that is always there; nothing is ever changed inside what an earlier reply wrote.

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The value a slot holds (a bare object, as older states kept it, reads the same), or null. */
export function slotValue(stored) {
    if (Array.isArray(stored)) return isRecord(stored[0]) ? stored[0] : null;
    return isRecord(stored) ? stored : null;
}

/** `value` as it is kept in a slot. */
export const toSlot = value => (isRecord(value) ? [value] : null);

/**
 * The value in `holder[name]` (a draft) to change in place, made a slot first when an older state kept
 * it bare, so that the change writes the slot whole. Null when the slot is empty.
 */
export function slotIn(holder, name) {
    const value = slotValue(holder?.[name]);
    if (!value) return null;
    if (!Array.isArray(holder[name])) holder[name] = [value];
    return holder[name][0];
}
