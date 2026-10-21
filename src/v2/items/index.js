// RPG Battle v2, part **items** (MODULES §B2): the rules' numbers for the story's items, using
// and wearing them, and the Items page. No domain of its own: the things are Story Block's
// `inventory`, the people RPG Battle's `party`; this part changes them only through their
// owners' commands. src/v2/module.js (the coordinator's) merges this into the module.

import { itemEquip, itemGive, itemUnequip, itemUse } from './commands.js';
import { currencyHook, defineItem } from './define.js';
import { itemsTab } from './page.js';
import { gear, usable } from './queries.js';

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
    },
    kinds: {},
    context: { static: () => '', tail: () => ({ lines: [], optional: [] }), budget: 0 },
    hooks: {
        'item.define': (def, info) => defineItem(def, info ?? {}),
        currency: settings => currencyHook(settings),
    },
    tabs: [itemsTab],
};

export { coinValue, currencyHook, defineItem } from './define.js';
export { itemEquip, itemGive, itemUnequip, itemUse } from './commands.js';
export { gear, usable } from './queries.js';
export { renderItems, itemsTab } from './page.js';
