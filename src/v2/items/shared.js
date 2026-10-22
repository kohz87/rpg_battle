// RPG Battle v2, items part: what the hooks, commands, queries and the Items page share (pure).
//
// Items live in Story Block's `inventory` domain and the people who use them in the `party`
// domain; this part owns neither. These helpers only read the two slices and turn a stack into
// the Item shape v1's pure logic (src/items.js, src/recovery.js) works on.

import { makeRules } from '../../rules.js';

export const MODULE_ID = 'rpg-battle';

/**
 * The rules in force: v1's DEFAULT_RULES with the reader's settings over them. Settings are
 * RPG Battle's module settings (SPEC §6); as in v1, `rules` holds a rules.json's overrides and
 * the panel's own `gear` wins over it. Money is Story Block's one currency, not the rules'.
 */
export function rulesFrom(settings = null) {
    const own = settings && typeof settings === 'object' ? settings : {};
    const custom = own.rules && typeof own.rules === 'object' ? own.rules : {};
    return makeRules({
        ...custom,
        ...(own.gear && typeof own.gear === 'object' ? { gear: { ...(custom.gear ?? {}), ...own.gear } } : {}),
    });
}

/** The module's settings when the host is up and nothing passed them in, else null. */
export function hostSettings() {
    try {
        const sdk = globalThis.StoryBlock?.sdk;
        return typeof sdk?.settings === 'function' ? sdk.settings(MODULE_ID) ?? null : null;
    } catch {
        return null;
    }
}

/** The chat's one currency (Story Block's `inventory.currency`, MODULES §F1) when the host is up, else null. */
export function hostCurrency() {
    try {
        const sdk = globalThis.StoryBlock?.sdk;
        return typeof sdk?.query === 'function' ? sdk.query('inventory.currency') ?? null : null;
    } catch {
        return null;
    }
}

/**
 * The pack's money scale (MODULES §F104: Story Block's `inventory.economy` → { scale }) when the host
 * is up and answers it, else 1. `query`: a query function to ask instead of the host's.
 */
export function hostEconomyScale(query = null) {
    try {
        const ask = typeof query === 'function' ? query : globalThis.StoryBlock?.sdk?.query;
        const found = typeof ask === 'function' ? ask('inventory.economy') : null;
        const scale = Number(found?.scale);
        return Number.isFinite(scale) && scale > 0 ? scale : 1;
    } catch {
        return 1;
    }
}

export const inventoryOf = state => state?.domains?.inventory ?? { defs: {}, stacks: {}, wallets: {}, aliases: {} };
export const partyOf = state => state?.domains?.party ?? { pc: null, order: [], actors: {} };

/** Whether `owner` is the party's: the shared bag or one of its people. */
export function partyOwns(party, owner) {
    return owner === 'party' || Boolean(owner && party?.actors?.[owner]);
}

/** Who wears a stack's piece: its owner, or the main character for the shared bag (v1's "yours"). */
export function wearerOf(stack, party) {
    return stack?.owner === 'party' ? party?.pc ?? null : stack?.owner ?? null;
}

/** The slot a worn stack's key stands for: `accessory-2` → `accessory` (item.equip gives each allowed copy its own key). */
export const baseSlot = key => (typeof key === 'string' ? key.replace(/-\d+$/, '') : null);

/** A stack as v1's Item: { name, qty, rarity, slot, equipped, stats, tags, effect, note, stack }. */
export function itemOf(stack, def) {
    return {
        name: def?.name ?? 'something',
        qty: stack?.qty ?? 0,
        category: '',
        rarity: def?.rarity ?? 'common',
        slot: def?.slot || baseSlot(stack?.equipped) || null,
        equipped: Boolean(stack?.equipped),
        stats: { ...(def?.stats ?? {}) },
        tags: [...(def?.tags ?? [])],
        effect: def?.kind === 'consumable' ? def.effect ?? null : null,
        note: def?.note ?? '',
        stack: stack?.id ?? null,
    };
}

/** Stack ids in a stable order (the record's keys sorted), so "the first one" never depends on JSON order. */
export const stackIds = inventory => Object.keys(inventory?.stacks ?? {}).sort();

/** What a consumable can do outside a fight (heal, MP, a cure), as v1's useItemOutside reads it. */
export function helpsOutside(effect) {
    return Boolean(effect && (effect.heal > 0 || effect.mp > 0 || effect.cure?.length));
}

/** A party actor as the sheet v1's useItemOutside takes (conditions by name). */
export function sheetOf(actor) {
    return {
        name: actor?.name ?? 'Someone',
        hp: { cur: actor?.hp?.cur ?? 0, max: actor?.hp?.max ?? 0 },
        mp: { cur: actor?.mp?.cur ?? 0, max: actor?.mp?.max ?? 0 },
        conditions: (actor?.conditions ?? []).map(entry => ({ name: entry.kind, stacks: entry.stacks })),
    };
}
