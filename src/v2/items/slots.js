// RPG Battle v2, items part: the eight equipment slots (contract §4 Slot, §5 P07) and the read
// adapters for what older saves and packs call them (§9). Pure; nothing here writes.
//
// The eight canonical IDs are the only slots a rule, a plan or a new record uses. §9 gives the
// content adapters: `mainhand`/`main-hand` -> weapon, `off-hand` -> offhand, `armour`/`armor`
// -> body, accessory-1/-2 unchanged. A generic `worn`, `hands`, `waist` or a bare `accessory`
// (and the numbered `worn-1` / `accessory-3` keys the six-slot runtime wrote) says which
// kind of slot but not which one, so it is never guessed: such a record stays exactly as stored,
// is shown as "unplaced", and changes only when the reader explicitly chooses a v2 slot (slotsForLegacy lists
// the slots such a word may go in; the reader picks, the rules never do).

export const EQUIP_SLOTS = Object.freeze(['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2']);
export const SLOT_LABELS = Object.freeze({ weapon: 'Main hand', offhand: 'Off hand', head: 'Head', body: 'Body', legs: 'Legs', feet: 'Feet', 'accessory-1': 'Accessory 1', 'accessory-2': 'Accessory 2' });
export const CANONICAL_ALIASES = Object.freeze({ mainhand: 'weapon', 'main-hand': 'weapon', 'off-hand': 'offhand', armor: 'body', armour: 'body' });
export const AMBIGUOUS_SLOTS = Object.freeze(['worn', 'hands', 'waist', 'accessory']);

/**
 * The compatibility counts of `items.slots` (§3): the four worn slots (head, body, legs, feet)
 * and the two accessories. Fixed by the eight slots, never a setting.
 */
export const SLOT_COUNTS = Object.freeze({ accessory: 2, worn: 4 });

/**
 * The v1 gear category each slot counts as (src/items.js `equipped`): the shared stat counting
 * reads these. Head, legs and feet are "worn pieces", the body is the armour.
 */
export const SLOT_CATEGORY = Object.freeze({ weapon: 'weapon', offhand: 'offhand', head: 'worn', body: 'armour', legs: 'worn', feet: 'worn', 'accessory-1': 'accessory', 'accessory-2': 'accessory' });

/** Authoring/import alias adapter: a canonical ID or one of the §9 aliases -> the canonical ID, else null. */
export function normalizeSlot(slot) {
    if (typeof slot !== 'string') return null;
    if (EQUIP_SLOTS.includes(slot)) return slot;
    return Object.hasOwn(CANONICAL_ALIASES, slot) ? CANONICAL_ALIASES[slot] : null;
}

/**
 * What a legacy slot word (the six-slot runtime's weapon, offhand, armour, worn, accessory, and the older hands and
 * waist) stands for in the eight slots (§9): pure, never guesses, and it never picks among kinds of slot.
 *   { slot }                    one slot: weapon, offhand, armour/armor -> body, mainhand/main-hand/off-hand, or a canonical ID
 *   { choose: [...], auto }     several slots the piece may go in. `auto: true` (a bare accessory: accessory-1 or -2, which
 *                               are interchangeable) lets the planner take the first empty one, else an explicit target.
 *                               `auto: false` (worn -> head/body/legs/feet, hands -> weapon/offhand, waist -> the two
 *                               accessories) means the READER chooses: with no targetSlot the plan is refused with the list.
 *   null                        names no slot at all (unknown words, non-text)
 * A caller that needs a stored slot for a registration keeps the word as it is and lets this answer how it is worn.
 */
export function slotsForLegacy(legacySlot) {
    const one = normalizeSlot(legacySlot);
    if (one !== null) return { slot: one };
    if (typeof legacySlot !== 'string' || !Object.hasOwn(LEGACY_CHOICES, legacySlot)) return null;
    const { slots, auto } = LEGACY_CHOICES[legacySlot];
    return { choose: [...slots], auto };
}
const LEGACY_CHOICES = Object.freeze({
    accessory: Object.freeze({ slots: Object.freeze(['accessory-1', 'accessory-2']), auto: true }),
    worn: Object.freeze({ slots: Object.freeze(['head', 'body', 'legs', 'feet']), auto: false }),
    hands: Object.freeze({ slots: Object.freeze(['weapon', 'offhand']), auto: false }),
    waist: Object.freeze({ slots: Object.freeze(['accessory-1', 'accessory-2']), auto: false }),
});

/** "Head, Body, Legs or Feet" for a list of slot IDs. */
export function slotWords(slots) {
    const names = slots.map(slot => SLOT_LABELS[slot] ?? slot);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names.join('');
}

/** Whether `slot` is one of the generic words §9 says to require an explicit v2 slot for. */
export const isAmbiguousSlot = slot => AMBIGUOUS_SLOTS.includes(slot);

/**
 * How a stored `equipped` key or a def's `slot` reads in v2: { slot, legacy, unplaced }.
 * `slot` is the canonical ID or null; `legacy` is true when an alias was applied (the record
 * keeps its old text); `unplaced` is true for anything that names no single v2 slot.
 */
export function readSlot(value) {
    const slot = normalizeSlot(value);
    return { slot, legacy: slot !== null && slot !== value, unplaced: slot === null };
}

/** Why a stored key or def slot names no v2 slot, in words for the reader. */
export function unplacedWhy(value) {
    const word = typeof value === 'string' && value ? value : 'no slot';
    return `its old slot "${word}" does not name one of the eight slots: choose a slot to wear it in`;
}
