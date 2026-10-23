// RB v2, screen `rpg-battle/party` (UI 8h): the paper-doll card's slots, one member's EQUIPMENT. Pure: from
// what the items part says the member wears (items.gear's counted and unused pieces), the rules' slot counts
// (how many worn pieces and accessories count: gearLimits), whether the weapon is two-handed, and the bag's
// pieces that fit each empty slot, it returns the tiles, in this order: weapon, off-hand, armour, the worn
// pieces, the accessories, then anything worn that does not count (with why). The rules define these slots;
// head, hands, feet and waist are all the one worn slot (src/items.js), so there is no tool slot.
//
// A tile is one of: filled (a piece, with the actions Take off, Give… and Drop), or empty (Empty, and an
// Equip… chooser when the bag has pieces for it). Every number and command is the items part's; this file
// only arranges what they say.

/** The slot groups the rules define, in the order the card draws them. */
export const SLOT_GROUPS = Object.freeze(['weapon', 'offhand', 'armour', 'worn', 'accessory']);

/** The label a tile shows (small, caps). */
export const SLOT_LABEL = Object.freeze({ weapon: 'Weapon', offhand: 'Off-hand', armour: 'Armour', worn: 'Worn', accessory: 'Accessory' });

// A piece's condition band as a tone the card's tags use: good stays plain, worn is amber, the rest red.
const TONE = Object.freeze({ good: 'good', worn: 'warn', tattered: 'bad', broken: 'bad' });

/** The number at the end of a slot key (`accessory-2` → 2; a key without one is the first). */
export const keyNumber = key => {
    const found = /-(\d+)$/.exec(String(key ?? ''));
    return found ? Number(found[1]) : 1;
};

const tileOf = ({ key, group, label, piece = null, extra = false, equip = [], givers = [], note = '', qty = 1 }) => {
    if (!piece) return { key, group, label, filled: false, empty: true, extra: false, stack: '', name: '', rarity: 'common', refine: '', stats: '', why: '', cond: '', condTitle: '', condTone: '', condBroken: false, meter: false, cur: 0, max: 0, qty: 1, note, equip: [...equip], givers: [] };
    const condition = piece.condition ?? null;
    const max = Number.isFinite(condition?.max) ? Math.max(0, Math.round(condition.max)) : 0;
    const cur = Number.isFinite(condition?.cur) ? Math.max(0, Math.min(max, Math.round(condition.cur))) : 0;
    const band = String(condition?.band ?? '');
    return {
        key, group, label, filled: true, empty: false, extra, stack: String(piece.stack), name: String(piece.name ?? ''),
        rarity: String(piece.rarity ?? 'common'), refine: piece.refine?.label ?? '',
        stats: [label, piece.stats].filter(Boolean).join(' · '),
        why: piece.counted ? '' : String(piece.why ?? 'not counted'),
        cond: condition ? (max > 0 ? `${condition.label} ${cur}/${max}` : String(condition.label ?? '')) : '',
        condTitle: condition ? `Condition: ${condition.text ?? condition.label ?? ''}` : '',
        condTone: TONE[band] ?? '', condBroken: band === 'broken', meter: max > 0, cur, max,
        qty: Math.max(1, Math.round(Number(qty) || 1)), note: '', equip: [], givers: [...givers],
    };
};

/**
 * The tiles of one member's card. `pieces` are items.gear's entries for them ({ stack, name, slot, slotLabel,
 * rarity, stats, counted, why, condition, refine }); `keys` maps a stack id to its key as worn (`weapon`,
 * `worn-1`, `accessory-2`); `limits` is { worn, accessory } (the rules' counts); `twoHanded` says the weapon
 * takes both hands (no off-hand); `bag` is { [group]: [{ id, name }] } the pieces that fit an empty slot; and
 * `members` the party's [{ id, name }] for Give….
 */
export function paperdollOf({ actorId = '', pieces = [], keys = {}, qtys = {}, limits = {}, twoHanded = false, bag = {}, members = [] } = {}) {
    const givers = members.filter(member => member.id !== actorId).map(member => ({ id: member.id, name: member.name }));
    const counted = pieces.filter(piece => piece?.counted);
    const extras = pieces.filter(piece => piece && !piece.counted);
    const worn = group => counted.filter(piece => piece.slot === group);
    const offer = group => (bag[group] ?? []).map(entry => ({ id: entry.id, name: entry.name }));

    const single = group => {
        const piece = worn(group)[0] ?? null;
        // An off-hand beside a two-handed weapon is not a slot to fill: the card says why.
        const blocked = group === 'offhand' && !piece && twoHanded;
        return tileOf({ key: group, group, label: SLOT_LABEL[group], piece, givers, qty: qtys[piece?.stack], equip: piece || blocked ? [] : offer(group), note: blocked ? 'Two-handed weapon' : '' });
    };
    const many = group => {
        const pieces = worn(group).sort((a, b) => keyNumber(keys[a.stack]) - keyNumber(keys[b.stack]) || (a.stack < b.stack ? -1 : 1));
        const count = Math.max(Math.max(0, Math.round(Number(limits[group]) || 0)), pieces.length);
        return Array.from({ length: count }, (_, index) => {
            const piece = pieces[index] ?? null;
            return tileOf({ key: `${group}-${index + 1}`, group, label: SLOT_LABEL[group], piece, givers, qty: qtys[piece?.stack], equip: piece ? [] : offer(group) });
        });
    };
    const tiles = [
        single('weapon'),
        single('offhand'),
        single('armour'),
        ...many('worn'),
        ...many('accessory'),
        ...extras.map(piece => tileOf({ key: `extra-${piece.stack}`, group: piece.slot, label: piece.slotLabel || SLOT_LABEL[piece.slot] || String(piece.slot ?? ''), piece, extra: true, givers, qty: qtys[piece.stack] })),
    ];
    return { tiles, filled: tiles.filter(tile => tile.filled).length, empty: tiles.filter(tile => tile.empty).length };
}
