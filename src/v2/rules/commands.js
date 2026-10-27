// RPG Battle v2, the commands of the rules part that are not progression: `rules.flagSet` (flags.js), `rules.registerItem` (items.js) and
// `rules.recordOffer` (offers.js), and `rules.mode` (mode.js: the switch of Jobs from the story on the timeline). The first two attach a replay guard (progress/guard.js), so a block whose reason is gone turns off with it;
// `rules.recordOffer` has none of its own: the offer that calls it carries the guard.

import { attachIfFree } from '../progress/guard.js';
import { flagSet } from './flags.js';
import { registerItem } from './items.js';
import { recordOffer } from './offers.js';
import { setMode } from './mode.js';

export const commands = {
    'rules.flagSet': (ctx, payload) => flagSet(ctx, payload, attachIfFree),
    'rules.registerItem': (ctx, payload) => registerItem(ctx, payload, attachIfFree),
    'rules.recordOffer': (ctx, payload) => recordOffer(ctx, payload),
    'rules.mode': (ctx, payload) => setMode(ctx, payload),
};
