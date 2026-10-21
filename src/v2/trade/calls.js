// RPG Battle v2, trade part: every command, query and hook of another part or of Story Block
// that trade uses, in one place (SPEC §7, MODULES §B1). The spec names these but not every
// payload, so the shapes trade assumes are kept here alone, where the coordinator can change
// them in one edit.

/** The wallet trade pays from and is paid into (SPEC §7 `wallets: { [owner]: … }`). */
export const PURSE = 'party';
/** Who goods bought or collected go to (an inventory stack's `owner`). */
export const KEEPER = 'party';

/** Pay `amount` (smallest unit) from the party's wallet; wallet.pay rejects with NOT_ENOUGH. */
export function pay(ctx, amount) {
    if (amount > 0) ctx.call('wallet.pay', { owner: PURSE, amount });
}

/** Take `amount` (smallest unit) into the party's wallet. */
export function receive(ctx, amount) {
    if (amount > 0) ctx.call('wallet.receive', { owner: PURSE, amount });
}

/** Take `qty` from a stack (inventory.consume rejects with NOT_ENOUGH). */
export function consume(ctx, stack, qty) {
    ctx.call('inventory.consume', { stack, qty });
}

/**
 * Put `qty` of `def` (a whole inventory def, SPEC §7) in the party's keeping; `from` is this
 * receipt (inventory.grant is internal and needs a receipt-backed cause).
 */
export function grant(ctx, def, qty) {
    ctx.call('inventory.grant', { def, qty, owner: KEEPER, from: ctx.receiptId ?? '' });
}

// A query that may not be registered (its part absent): null instead of a throw.
function tryQuery(query, name, args) {
    if (typeof query !== 'function') return undefined;
    try {
        return query(name, args);
    } catch {
        return undefined;
    }
}

/** The scene as trade reads it: { place: { name, kind, region }, present: [names] }. */
export function sceneOf({ query = null, read = null } = {}) {
    const slice = typeof read === 'function' ? read('scene') ?? {} : {};
    const place = tryQuery(query, 'scene.place') ?? slice.place ?? {};
    const present = tryQuery(query, 'scene.present') ?? slice.present ?? [];
    return {
        place: { name: String(place?.name ?? ''), kind: String(place?.kind ?? ''), region: String(place?.region ?? '') },
        present: (Array.isArray(present) ? present : []).map(name => String(name?.name ?? name ?? '')).filter(Boolean),
    };
}

/** The player character's level and name from the party domain (MODULES §B1); level 1 without one. */
export function pcOf(party) {
    const pc = party?.pc ? party.actors?.[party.pc] : null;
    const level = Number.isInteger(pc?.level) && pc.level > 0 ? pc.level : 1;
    return { level, name: String(pc?.name ?? '') };
}

/**
 * The chat's coins: the `currency` hook (RB-items, MODULES §B2) when the host hands a way to
 * call it, else the rules' own. Only words depend on it; every amount is in the smallest unit.
 */
export function currencyOf(source, fallback) {
    const hook = typeof source?.hook === 'function' ? source.hook : null;
    if (hook) {
        try {
            const found = hook('currency');
            const value = Array.isArray(found) ? found.find(Boolean) : found;
            if (value && (Array.isArray(value.tiers) || value.single)) return { ...fallback, ...value, ...(value.tiers?.length ? {} : { mode: 'single' }) };
        } catch {
            // A hook that throws leaves the rules' coins.
        }
    }
    return fallback;
}
