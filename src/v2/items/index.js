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
import { itemsTab } from './page.js';
import { DEFAULTS as CARRY_DEFAULTS } from './carry.js';
import { carry, gear, usable } from './queries.js';

// The one line every reply carries about using things (byte-identical).
export const USE_STATIC = 'When someone drinks, eats or applies one of the party\'s consumables, write `! use <item> | on: <who>` in <Changes> (not `- item`); code applies its effect, and a dose that would do nothing stays in the bag.';

export const part = {
    domains: {},
    commands: {
        'item.use': itemUse,
        'item.equip': itemEquip,
        'item.unequip': itemUnequip,
        'item.give': itemGive,
    },
    queries: {
        'items.usable': (state, args) => usable(state, args ?? {}),
        'items.gear': (state, args) => gear(state, args ?? {}),
        'items.carry': (state, args, tools) => carry(state, args ?? {}, tools),
    },
    // A story's use (MODULES §F96): `! use <item> | on: Name`, applied by code (story-use.js).
    kinds: {
        use: { grammar: USE_GRAMMAR, apply: applyUse },
    },
    context: { static: () => USE_STATIC, tail: () => ({ lines: [], optional: [] }), budget: 0 },
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
export { carry, gear, usable } from './queries.js';
export { canCarry, capacityOf, carrySettings, carryView, weightOf, WEIGHTS } from './carry.js';
export { renderItems, itemsTab } from './page.js';
