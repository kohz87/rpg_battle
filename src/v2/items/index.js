// RPG Battle v2, part **items** (MODULES §B2): the rules' numbers for the story's items, using
// and wearing them, and the Items page. Using a thing is the story's (MODULES §F96): the `use`
// change line, applied by code (story-use.js); the Items page keeps only bag management (Equip,
// Take off, Give), and `item.use` stays a command for templates, packs, Studio and tests. Money is Story Block's one currency (MODULES §F1): this
// part has no currency hook. No domain of its own: the things are Story Block's
// `inventory`, the people RPG Battle's `party`; this part changes them only through their
// owners' commands. The carry limit (MODULES §F39) is this part's: its rule and numbers are in
// carry.js, its settings below, and other parts ask `items.carry` before they add weight.
// src/v2/module.js (the coordinator's) merges this into the module.

import { USE_GRAMMAR, applyUse, itemEquip, itemGive, itemUnequip, itemUse } from './commands.js';
import { defineItem } from './define.js';
import { clipped } from '../lines.js';
import { itemsTab } from './page.js';
import { DEFAULTS as CARRY_DEFAULTS } from './carry.js';
import { canWear, carry, condition, gear, slots, usable } from './queries.js';
import { REFINE_FEATURE, WEAR_FEATURE, initialGear, validateGear } from './condition.js';
import { fightWear, storyWear } from './wear.js';
import { gearTail } from './gear-tail.js';

// The one line every reply carries about using things (byte-identical).
export const USE_STATIC = 'When someone drinks, eats or applies one of the party\'s consumables, write `! use <item> | on: <who>` in <Changes> (not `- item`); code applies its effect, and a dose that would do nothing stays in the bag.';

// The line about gear condition (feature rpg-battle.wear; byte-identical while it is on and the host
// stays the same). The story's wear line is asked for only when Story Block reads it: its inventory
// routes `~ item X | wear: …` to item.wear in the same change that brought `inventory.wear`.
export const WEAR_STATIC = 'Gear wears by code in fights. When the story itself scuffs, tears or ruins a piece someone wears, write `~ item <piece> — what happened | wear: scuff|tear|ruin` (code sets the condition); a repair kit is used with `! use <kit> | on: <piece>`.';
export const WEAR_STATIC_KITS = 'Gear wears by code in fights; a repair kit is used with `! use <kit> | on: <piece>`.';

/** Whether the host's inventory reads the story's `| wear:` word (a module answering `inventory.wear`). */
export function hostReadsWear(sdk = globalThis.StoryBlock?.sdk) {
    try {
        const list = typeof sdk?.modules === 'function' ? sdk.modules() : [];
        return (Array.isArray(list) ? list : []).some(entry => Array.isArray(entry?.commands) && entry.commands.includes('inventory.wear'));
    } catch {
        return false;
    }
}

/** The gear static line for this host. */
export const wearStatic = (sdk = globalThis.StoryBlock?.sdk) => (hostReadsWear(sdk) ? WEAR_STATIC : WEAR_STATIC_KITS);

/** The features this part's mechanics sit behind (MODULES §F100). */
export const FEATURES = Object.freeze([
    Object.freeze({ id: WEAR_FEATURE, label: 'Gear wear and repair', describe: 'Equipment wears in fights and by the story\'s word (good, worn, tattered, broken: less of its stats); repair kits patch it, smiths and tailors repair it for coin.', default: true }),
    Object.freeze({ id: REFINE_FEATURE, label: 'Gear refinement', describe: 'A smith refines a piece to +1, +2 or +3 for materials and a fee (+8% stats a level; the +3 attempt can fail).', default: true }),
]);

export const part = {
    features: FEATURES,
    domains: {
        // A piece's condition record and refinement (condition.js), keyed per write.
        gear: { initial: initialGear, validate: validateGear },
    },
    commands: {
        'item.use': itemUse,
        'item.equip': itemEquip,
        'item.unequip': itemUnequip,
        'item.give': itemGive,
        // The story's word for a piece's wear (Story Block routes `~ item X | wear: tear` here).
        'item.wear': Object.assign((ctx, payload) => storyWear(ctx, payload), { feature: WEAR_FEATURE }),
        // Internal: combat.end sends it once a fight.
        'item.fightWear': Object.assign((ctx, payload) => fightWear(ctx, payload), { feature: WEAR_FEATURE }),
    },
    queries: {
        'items.usable': (state, args) => usable(state, args ?? {}),
        'items.gear': (state, args, tools) => gear(state, args ?? {}, tools),
        'items.carry': (state, args, tools) => carry(state, args ?? {}, tools),
        'items.condition': (state, args, tools) => condition(state, args ?? {}, tools),
        // Story Block's Equip on… picker (SB #104): slot counts and who can wear a piece, by these rules.
        'items.slots': (state, args, tools) => slots(state, args ?? {}, tools),
        'items.canWear': (state, args, tools) => canWear(state, args ?? {}, tools),
    },
    // A story's use (MODULES §F96): `! use <item> | on: Name`, applied by code (story-use.js).
    kinds: {
        use: { grammar: USE_GRAMMAR, apply: clipped(applyUse) },
    },
    context: {
        static: () => USE_STATIC,
        tail: () => ({ lines: [], optional: [] }),
        budget: 60,
        // Gear wear's static line and tail line, left out while the feature is off (MODULES §F100).
        parts: [{ feature: WEAR_FEATURE, static: () => wearStatic(), tail: view => gearTail(view) }],
    },
    hooks: {
        'item.define': (def, info) => defineItem(def, info ?? {}),
    },
    // The carry limit (MODULES §F39, carry.js): on by default; the size scales every member's capacity.
    settings: {
        section: 'Items',
        defaults: { ...CARRY_DEFAULTS },
        schema: {
            carryLimit: { type: 'bool', label: 'Carry limit', help: 'Each member carries up to (20 + 4 × STR) weight; things that would go over are refused, never lost.' },
            carrySize: { type: 'int', label: 'Carry limit size (%)', min: 10, max: 500 },
        },
    },
    tabs: [itemsTab],
};

export { coinValue, defineItem } from './define.js';
export { applyUse, itemEquip, itemGive, itemUnequip, itemUse, storyUse } from './commands.js';
export { GONE_WORDS, USED_WORDS, planStoryUse, stackNamed, usedByLine } from './story-use.js';
export { canWear, carry, condition, gear, slots, usable, wornGear } from './queries.js';
export * from './condition.js';
export { applyWear, fightWear, pieceNamed, recordEvent, repairOf, storyWear, useKit, wearRole, wearWords } from './wear.js';
export { REPAIR_MAX, REPAIR_WORTH, repairKitAmount } from './define.js';
export { canCarry, capacityOf, carrySettings, carryView, weightOf, WEIGHTS } from './carry.js';
export { renderItems, itemsTab } from './page.js';
