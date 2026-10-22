// RPG Battle v2, part **craft** (MODULES §F102): crafting with stats, told by the story and
// refereed by code. Feature `rpg-battle.crafting` (F100), on by default.
//
// * Known recipes per member (domain.js): a pack's basic recipes (`known: true`) everyone knows; the
//   rest the story teaches (`+ recipe … | from: …`), a recipe the packs lack kept for this chat with
//   code's DC; `- recipe` forgets. Companions learn and craft with their own stats.
// * `! craft X | with: … | by: Name | roll: N | result: fine` (commands.js): code recomputes it with the
//   reply's own roll (the checks part's dice, F80, positional), its modifiers (stat, tools, rank,
//   station, materials) against the DC, and decides the quality (rules.js): it consumes the materials
//   and makes the item through Story Block's inventory commands, counts a craft use (ranks grow like
//   RPG Battle's skills), moves the clock by the recipe's minutes and flags a story quality that
//   disagrees on the reply's card (`craft.last`).
// * The tail gets a crafting line only when crafting is likely (queries.js tail). The Crafting screen
//   is drawn by the screens part from `craft.view`. No static text of its own: the two kinds'
//   grammar is all the fixed prompt it adds (Story Block writes it from `kinds`), and only while the
//   feature is on.
// The coordinator's src/v2/module.js merges this part with the others.

import { commands, kinds } from './commands.js';
import { initialCraft, validateCraft } from './domain.js';
import { queries, tail } from './queries.js';
import { FEATURE } from './rules.js';

export { FEATURE } from './rules.js';

export const BUDGET = 160;

const tag = item => Object.assign(item, { feature: FEATURE });

export const part = {
    features: [{
        id: FEATURE,
        label: 'Crafting',
        describe: 'Characters and companions learn recipes and craft from the story; code rolls the result with the reply\'s dice and decides the quality.',
        default: true,
    }],
    domains: {
        craft: { initial: initialCraft, validate: slice => validateCraft(slice) },
    },
    commands: Object.fromEntries(Object.entries(commands).map(([type, handler]) => [type, tag(handler)])),
    queries,
    kinds: Object.fromEntries(Object.entries(kinds).map(([kind, spec]) => [kind, { ...spec, feature: FEATURE }])),
    context: { static: () => '', tail, budget: BUDGET },
    hooks: {},
};
