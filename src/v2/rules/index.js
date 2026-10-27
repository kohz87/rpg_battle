// RPG Battle v2, part **rules** (contract §3, §4, §7): the `rules` domain that pins one resolved ruleset to the
// character timeline, `rules.progress` (the progression view), the lookups the screens read (`rules.identity`,
// `rules.classes`, `rules.names`, `rules.sheet`, `rules.party`; ./queries.js; `rules.training` is the training part's), the inputs other tracks read (`rules.flags`, `rules.item`), and the
// commands `rules.settle` (the host's step that credits paid attempts and runs training), `rules.flagSet`, `rules.registerItem` and `rules.recordOffer`.
// module.js registers these with progress/training; selection.js supplies Setup's deferred rules.pin bootstrap.

import { initialRules, rulesProblems } from './pin.js';
import { commands } from '../progress/commands.js';
import { part as progressPart } from '../progress/index.js';
import { queries } from '../progress/queries.js';
import { queries as lookups, rulesModifier } from './queries.js';
import { part as trainingPart } from '../training/index.js';
import { commands as inputCommands } from './commands.js';
import { queries as flagQueries } from './flags.js';
import { queries as itemQueries, registerPackDefs } from './items.js';
import { replyNow, stampAfterCapture } from './mode.js';

export { RULES_VERSION, ENGINE, pinRules, pinOf, initialRules, rulesProblems, xpPerLevelProblem } from './pin.js';
export { indexOf, indexOfState } from './graph.js';
export { declaredFlags } from './pin.js';
export { OFFERS_FEATURE, noteRead, readsFreely, switchMode } from './mode.js';
export { registerPackDefs };

// The modifier projection also serves legacy crafting; it has no domain or dice.
export const modifierPart = { queries: { 'rules.modifier': rulesModifier } };

export const part = {
    domains: { rules: { initial: initialRules, validate: rulesProblems } },
    commands: { 'rules.settle': commands['rules.settle'], ...inputCommands },
    queries: { 'rules.progress': queries['rules.progress'], 'rules.pace': queries['rules.pace'], ...lookups, ...flagQueries, ...itemQueries, 'rules.replyNow': replyNow },
    hooks: { afterCapture: stampAfterCapture },
};

/**
 * The three parts of rules v2, **registered together or not at all**: `rules.settle` writes the `progress` and `training` domains, every
 * guard of `progress` reads the pin in the `rules` domain, and a training request needs the settlement that answers it, so any one alone
 * is a chat that cannot settle or check something. `[id, part]` pairs in the order module.js lists its parts.
 */
export const rulesParts = Object.freeze([['rules', part], ['progress', progressPart], ['training', trainingPart]]);
