// RPG Battle v2, items part: the `item.define` hook (SPEC §6, MODULES §B2). Pure.
//
// When the story brings in an item Story Block does not know (`+ item Moonveil Trout | note: …`),
// Story Block makes a `story/<slug>` def with plain defaults (goods, common, worth 0) and asks
// the hooks to fill in the rules' numbers. This one reads the name and the note with v1's rules,
// unchanged: describeRow says whether it is gear (slot, rarity, stats, tags) or a potion (its
// effect, by the note or, as v1 0.5.35, by its name), materialAffinity what a material would lend
// a crafted piece (`uncommon material · MDEF, poison`), and trade's itemWorth what it is worth in
// the chat's one currency (v1's numbers kept as they are, MODULES §F1). A word like "minor" or
// "strong" in a potion's name is its size, as in v1 (Minor Healing Draught heals 20), never a
// foe's threat. An item named for the currency is money, one unit each. What the note's words give
// is held to code's limits (B1-5): stats to the rarity's budget (and priced capped), a potion to the largest
// built-in one, and never legendary (STORY_EFFECT_MAX, storyRarity).

import { describeRow, nameKey } from '../../items.js';
import { materialAffinity } from '../../craft.js';
import { isMaterial, itemWorth, kindOf } from '../../trade.js';
import { maxLevel } from '../../terms.js';
import { hostCurrency, hostSettings, rulesFrom } from './shared.js';
import { capEffect, capStats, storyRarity } from '../limits.js';

export { STORY_EFFECT_MAX, capEffect, capStats, storyRarity } from '../limits.js';

const SLOTS = ['weapon', 'offhand', 'armour', 'worn', 'accessory'];

const forms = name => {
    const n = String(name).toLowerCase();
    return [n, `${n}s`, n.replace(/s$/, '')];
};

/**
 * What one of a coin item is worth, in the chat's one currency (MODULES §F1), or null for a thing
 * that is no coin: an item named for the currency ("Gold", "Gold Coins", "Loose Gil") and plain
 * "Coins" or "Money" are one unit each. `currency` is Story Block's `inventory.currency`
 * ({ name, short }); gold when not given. There are no tiers: "Silver" in a gold chat is goods.
 */
export function coinValue(name, currency = null) {
    const unit = String(currency?.name ?? '').trim().toLowerCase() || 'gold';
    const key = nameKey(name);
    const bare = key.replace(/^loose\s+/, '').replace(/\s+(?:coins?|pieces?|bits?)$/, '').trim();
    if (forms(unit).includes(bare) || forms(unit).includes(key)) return 1;
    return /^(?:(?:loose\s+)?coins?|money)$/.test(key) ? 1 : null;
}

// v1 loot's note for a material that lends something (0.5.34): `uncommon material · MDEF, poison`.
function materialNote(rarity, affinity) {
    const lends = [affinity.stat, affinity.element].filter(Boolean).join(', ');
    if (!lends) return '';
    return `${rarity && rarity !== 'common' ? `${rarity} material` : 'material'} · ${lends}`;
}

const whole = value => Math.max(0, Math.round(Number(value) || 0));

function effectShape(effect) {
    const out = { heal: whole(effect?.heal), mp: whole(effect?.mp), cure: [...(effect?.cure ?? [])].map(String) };
    // A thrown flask's harm (v1 parseEffect's `damage`) goes along for a fight; outside one it does nothing.
    if (effect?.damage) out.damage = { amount: whole(effect.damage.amount), element: String(effect.damage.element), target: effect.damage.target === 'all' ? 'all' : 'one' };
    return out;
}

/**
 * The `item.define` hook: `def` with its kind, rarity, value (smallest unit), slot, stats,
 * effect (`{ heal, mp, cure }`, a consumable's only) and tags (a piece's elements and range, a
 * material's element) set by v1's rules. A new object; `def` is not changed.
 *
 * `note` is the note the story wrote (else the def's own); `owner` who holds it (not used by
 * the rules yet). Optional: `settings` (RPG Battle's settings; else the host's), `currency`
 * (Story Block's `inventory.currency`; else the host's), `level` (the level a piece's worth is
 * reckoned at, default 1).
 *
 * What the story said wins; where it said nothing the def keeps what it had (a pack's numbers),
 * except Story Block's plain defaults, which are only placeholders: `goods`, `common`, worth 0.
 */
export function defineItem(def, { note, owner = null, settings, currency, level = 1 } = {}) {
    void owner;
    const rules = rulesFrom(settings === undefined ? hostSettings() : settings);
    const name = String(def?.name ?? '').trim();
    const text = String(note ?? def?.note ?? '');
    const base = { ...(def ?? {}), name };
    // A quest's thing is the story's own: no price, no rules.
    if (def?.kind === 'quest') return { ...base, note: text };

    const coin = coinValue(name, currency === undefined ? hostCurrency() : currency);
    if (coin !== null || def?.kind === 'money') {
        return { ...base, kind: 'money', rarity: 'common', value: coin ?? whole(def?.value), stack: true, slot: null, stats: {}, effect: {}, tags: [], note: text };
    }

    // A pack's piece already says it is gear; the story's plain `goods` says nothing.
    const category = def?.kind === 'equipment' ? 'Equipment' : '';
    const described = describeRow({ name, category, note: text });
    // The story's words never make a thing legendary; a def's own rarity (a pack's, a loot drop's) stays.
    const rarity = described.rarity !== 'common' ? storyRarity(described.rarity) : def?.rarity ?? 'common';
    const slot = described.slot ?? (SLOTS.includes(def?.slot) ? def.slot : null);
    // Stats the note wrote are held to the most the rarity allows at all (its budget at the level
    // cap: a wearer's own level caps them again when worn, items.gear), and priced capped at `level`.
    const written = Object.keys(described.stats ?? {}).length ? capStats(described.stats, { slot, rarity, level: maxLevel(rules), rules }) : null;

    let kind;
    let out;
    if (slot) {
        kind = 'equipment';
        const stats = written ?? { ...(def?.stats ?? {}) };
        const tags = described.tags?.length ? described.tags : [...(def?.tags ?? [])];
        // One piece per stack, so wearing one of two swords never wears both.
        out = { slot, stats, tags, effect: {}, stack: false, note: text };
    } else if (described.effect || def?.kind === 'consumable') {
        kind = 'consumable';
        // An effect the note wrote is held to the largest built-in potion's; a def's own (a pack's) stays.
        const effect = described.effect ? capEffect(effectShape(described.effect)) : effectShape(def?.effect);
        out = { slot: null, stats: {}, tags: [], effect, stack: true, note: text };
    } else {
        const item = { name, note: text, slot: null, effect: null, ...(def?.kind === 'material' ? { kind: 'material' } : {}) };
        kind = kindOf(item) === 'material' || isMaterial(item) ? 'material' : 'goods';
        if (kind === 'material') {
            const affinity = materialAffinity(name, text);
            out = { slot: null, stats: {}, tags: affinity.element ? [affinity.element] : [], effect: {}, stack: true, note: text || materialNote(rarity, affinity) };
        } else {
            out = { slot: null, stats: {}, tags: [...(def?.tags ?? [])], effect: {}, stack: true, note: text };
        }
    }

    const priced = { name, rarity, kind, slot: out.slot, stats: out.stats, note: out.note, effect: kind === 'consumable' ? out.effect : null };
    const value = whole(def?.value) > 0 ? whole(def.value) : itemWorth(priced, { level: Math.max(1, whole(level) || 1), rules });
    return { ...base, ...out, kind, rarity, value };
}
