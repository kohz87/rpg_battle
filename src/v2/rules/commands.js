// RPG Battle v2, the commands of the rules part that are not progression: `rules.flagSet` (flags.js) and `rules.registerItem`
// (items.js). Both attach a replay guard (progress/guard.js), so a block whose reason is gone turns off with it.

import { attachGuard } from '../progress/guard.js';
import { flagSet } from './flags.js';
import { registerItem } from './items.js';

export const commands = {
    'rules.flagSet': (ctx, payload) => flagSet(ctx, payload, attachGuard),
    'rules.registerItem': (ctx, payload) => registerItem(ctx, payload, attachGuard),
};
