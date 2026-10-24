// RPG Battle v2, screen `rpg-battle/party` (UI 8h, 8f): the EQUIPMENT tiles of one member. Pure: from what the
// items part says the member wears (items.gear's counted and unused pieces), the rules' slot counts (items.slots:
// how many worn pieces and accessories count), and whether the weapon is two-handed, it returns the tiles in this
// order: Main hand (weapon), Off hand, Body (armour), Worn, Accessory 1, Accessory 2 (the counts follow the rules, so a
// rules split adds tiles here), then anything worn that does not count (dashed, with why). The rules define no tool
// slot, and head, hands, feet and waist are the one worn slot (src/items.js).
//
// A tile shows only what the widget draws: the slot name, the item name, its stats line and a condition bar; an empty
// tile shows "Empty". The widget (equipment.js) turns a tap into the unequip, the commands are the items part's.

/** The slot groups the rules define, in the order the card draws them. */
export const SLOT_GROUPS = Object.freeze(['weapon', 'offhand', 'armour', 'worn', 'accessory']);

/** The name a tile's slot has on the card (small caps). */
export const SLOT_LABEL = Object.freeze({ weapon: 'Main hand', offhand: 'Off hand', armour: 'Body', worn: 'Worn', accessory: 'Accessory' });

// A piece's condition band as the tone the bar and its colour take: good stays plain, worn is amber, the rest red.
const TONE = Object.freeze({ good: 'good', worn: 'warn', tattered: 'bad', broken: 'bad' });

/** The number at the end of a slot key (`accessory-2` → 2; a key without one is the first). */
export const keyNumber = key => {
    const found = /-(\d+)$/.exec(String(key ?? ''));
    return found ? Number(found[1]) : 1;
};

const tileOf = ({ key, group, label, piece = null, extra = false, note = '' }) => {
    if (!piece) return { key, group, label, filled: false, empty: true, extra: false, stack: '', name: '', stats: '', why: '', cond: '', condTone: '', condBroken: false, meter: false, cur: 0, max: 0, note };
    const condition = piece.condition ?? null;
    const max = Number.isFinite(condition?.max) ? Math.max(0, Math.round(condition.max)) : 0;
    const cur = Number.isFinite(condition?.cur) ? Math.max(0, Math.min(max, Math.round(condition.cur))) : 0;
    const band = String(condition?.band ?? '');
    const refine = piece.refine?.label ? ` ${piece.refine.label}` : '';
    return {
        key, group, label, filled: true, empty: false, extra, stack: String(piece.stack), name: `${piece.name ?? ''}${refine}`,
        stats: String(piece.stats ?? ''), why: piece.counted ? '' : String(piece.why ?? 'not counted'),
        cond: condition ? (max > 0 ? `${condition.label} ${cur}/${max}` : String(condition.label ?? '')) : '',
        condTone: TONE[band] ?? '', condBroken: band === 'broken', meter: max > 0, cur, max, note: '',
    };
};

/**
 * The tiles of one member's EQUIPMENT. `pieces` are items.gear's entries for them ({ stack, name, slot, slotLabel,
 * stats, counted, why, condition, refine }); `keys` maps a stack id to its key as worn (`weapon`, `worn-1`,
 * `accessory-2`); `limits` is { worn, accessory } (the rules' counts); `twoHanded` says the weapon takes both
 * hands, so there is no off-hand to fill.
 */
export function paperdollOf({ actorId = '', pieces = [], keys = {}, limits = {}, twoHanded = false } = {}) {
    void actorId;
    const counted = pieces.filter(piece => piece?.counted);
    const extras = pieces.filter(piece => piece && !piece.counted);
    const worn = group => counted.filter(piece => piece.slot === group);
    const single = group => {
        const piece = worn(group)[0] ?? null;
        // An off-hand beside a two-handed weapon is not a slot to fill: the tile says why.
        const blocked = group === 'offhand' && !piece && twoHanded;
        return tileOf({ key: group, group, label: SLOT_LABEL[group], piece, note: blocked ? 'Two-handed' : '' });
    };
    const many = group => {
        const pieces = worn(group).sort((a, b) => keyNumber(keys[a.stack]) - keyNumber(keys[b.stack]) || (a.stack < b.stack ? -1 : 1));
        const count = Math.max(Math.max(0, Math.round(Number(limits[group]) || 0)), pieces.length);
        return Array.from({ length: count }, (_, index) => {
            const piece = pieces[index] ?? null;
            const label = group === 'accessory' ? `${SLOT_LABEL.accessory} ${index + 1}` : SLOT_LABEL[group];
            return tileOf({ key: `${group}-${index + 1}`, group, label, piece });
        });
    };
    const tiles = [
        single('weapon'),
        single('offhand'),
        single('armour'),
        ...many('worn'),
        ...many('accessory'),
        ...extras.map(piece => tileOf({ key: `extra-${piece.stack}`, group: piece.slot, label: SLOT_LABEL[piece.slot] ?? String(piece.slot ?? ''), piece, extra: true })),
    ];
    return { tiles, filled: tiles.filter(tile => tile.filled).length, empty: tiles.filter(tile => tile.empty).length };
}
