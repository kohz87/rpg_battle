// What the combat part keeps in the State, and how it turns back into what v1's engine reads.
//
// v2 state holds plain JSON under Story Block's generic rules (SPEC §2.5): a key called `qty` is a
// whole number, a key called `id` (or ending in `Id`) is an ID like `fo_00000001`. v1's fight data
// breaks both in two places: a loot row's `qty` is a range ([1, 2]), and enemies are `e1`, `e2`.
// So a loot row is stored with `range` in place of its `qty` range, and enemies get record-shaped
// ids when the setup is built. `unpack*` give v1 back exactly what it wrote. Pure.

import { makeRules } from '../../rules.js';

/** A loot row as stored: its `qty` range under `range`. Rows without a range stay as they are. */
export function packLootRow(row) {
    if (!row || typeof row !== 'object' || !Array.isArray(row.qty)) return row;
    const { qty, ...rest } = row;
    return { ...rest, range: [...qty] };
}

/** A stored loot row as v1 reads it (`qty: [lo, hi]`). */
export function unpackLootRow(row) {
    if (!row || typeof row !== 'object' || !Array.isArray(row.range)) return row;
    const { range, ...rest } = row;
    return { ...rest, qty: [...range] };
}

const mapLoot = (loot, fn) => (Array.isArray(loot) ? loot.map(fn) : loot);

/** A bestiary template (templates.js) as stored, and back. */
export const packCreature = entry => ({ ...entry, loot: mapLoot(entry.loot, packLootRow) });
export const unpackCreature = entry => ({ ...entry, loot: mapLoot(entry.loot, unpackLootRow) });

const packCombatant = c => ({ ...c, loot: mapLoot(c.loot, packLootRow) });
const unpackCombatant = c => ({ ...c, loot: mapLoot(c.loot, unpackLootRow) });

/** A v1 startFight setup as stored, and back. */
export function packSetup(setup) {
    return {
        ...setup,
        party: (setup.party ?? []).map(packCombatant),
        enemies: (setup.enemies ?? []).map(packCombatant),
        ...(setup.waves ? { waves: setup.waves.map(wave => ({ ...wave, enemies: (wave.enemies ?? []).map(packCombatant) })) } : {}),
    };
}

export function unpackSetup(setup) {
    return {
        ...setup,
        party: (setup.party ?? []).map(unpackCombatant),
        enemies: (setup.enemies ?? []).map(unpackCombatant),
        ...(setup.waves ? { waves: setup.waves.map(wave => ({ ...wave, enemies: (wave.enemies ?? []).map(unpackCombatant) })) } : {}),
    };
}

/** The id the n-th enemy of a setup gets (1-based): fo_00000001. */
export const foeId = n => `fo_${String(n).padStart(8, '0')}`;

/**
 * The rules a stored fight runs on: v1's defaults with only the numbers its setup began with
 * (turn system, speed, hit chance, XP rate). Nothing comes from the settings of the moment, so a
 * fight rebuilt from the State is the same fight whatever the settings say later.
 */
export function fightRules(setup) {
    const hit = setup?.hit ?? {};
    return makeRules({
        turns: { mode: setup?.turns === 'rounds' ? 'rounds' : 'timeline', ...(Number.isFinite(setup?.speedOffset) ? { speedOffset: setup.speedOffset } : {}) },
        attack: {
            ...(Number.isFinite(hit.base) ? { hitBase: hit.base } : {}),
            ...(Number.isFinite(hit.perPoint) ? { hitPerPoint: hit.perPoint } : {}),
        },
        ...(Number.isFinite(setup?.xpRate) ? { xpRate: setup.xpRate } : {}),
    });
}

/** v1's fight status as the session's. */
export function sessionStatus(fightStatus) {
    if (fightStatus === 'victory') return 'won';
    if (fightStatus === 'defeat') return 'lost';
    if (fightStatus === 'fled') return 'fled';
    return 'active';
}

/** The slug before B-b4-5: Latin letters and digits only ('creature' when none are left). */
export function latinSlug(name) {
    return String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'creature';
}

// FNV-1a of a name, base 36: the same name always gives the same few letters.
function nameHash(text) {
    let hash = 0x811c9dc5;
    for (const char of text) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

/**
 * A short lower-case slug for a bestiary key: "Cellar Rat Swarm" → "cellar-rat-swarm". A name with
 * letters or digits outside a–z ("狼", "Волк", "Λύκος 2") gets a hash of the whole name after its
 * Latin part ("creature-1x2k3a", "2-9fq0d1"), so creatures named in another script each keep their
 * own entry (B-b4-5) and the key stays ASCII, as item ids are (Story Block's slugify).
 */
export function creatureSlug(name) {
    const latin = latinSlug(name);
    const key = String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    const plain = key.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (!/[^\x00-\x7f]/.test(plain) || !/[\p{L}\p{N}]/u.test(plain.replace(/[a-z0-9]/g, ''))) return latin;
    const tag = nameHash(key);
    return `${latin === 'creature' ? 'creature' : latin.slice(0, 50).replace(/-+$/, '')}-${tag}`;
}

/** The chat's creatures as v1's list (templates.js), oldest first (`rev`, then slug). */
export function bestiaryList(bestiary) {
    return Object.entries(bestiary?.creatures ?? {})
        .sort(([a, x], [b, y]) => (Number(x?.rev) || 0) - (Number(y?.rev) || 0) || (a < b ? -1 : a > b ? 1 : 0))
        .map(([, entry]) => unpackCreature(entry));
}
