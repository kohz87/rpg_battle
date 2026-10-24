// RPG Battle v2, part **rules** (contract §3, §4, §7): the `rules` domain that pins one resolved ruleset to the
// character timeline, `rules.progress` (the progression view), the lookups the screens read (`rules.identity`,
// `rules.classes`, `rules.names`, `rules.training`; ./queries.js), the inputs other tracks read (`rules.flags`, `rules.item`), and the
// commands `rules.settle` (the host's step that credits paid attempts and runs training), `rules.flagSet` and `rules.registerItem`. Not registered by module.js yet; see ../progress/index.js.

import { initialRules, rulesProblems } from './pin.js';
import { commands } from '../progress/commands.js';
import { part as progressPart } from '../progress/index.js';
import { queries } from '../progress/queries.js';
import { queries as lookups } from './queries.js';
import { queries as trainingQueries } from '../training/queries.js';
import { commands as inputCommands } from './commands.js';
import { queries as flagQueries } from './flags.js';
import { queries as itemQueries, registerPackDefs } from './items.js';

export { RULES_VERSION, ENGINE, pinRules, pinOf, initialRules, rulesProblems, xpPerLevelProblem } from './pin.js';
export { indexOf, indexOfState } from './graph.js';
export { declaredFlags } from './pin.js';
export { registerPackDefs };

export const part = {
    domains: { rules: { initial: initialRules, validate: rulesProblems } },
    commands: { 'rules.settle': commands['rules.settle'], ...inputCommands },
    queries: { 'rules.progress': queries['rules.progress'], ...lookups, ...trainingQueries, ...flagQueries, ...itemQueries },
};

/**
 * The two parts of rules v2, **registered together or not at all**: `rules.settle` writes the `progress` domain and every guard of
 * `progress` reads the pin in the `rules` domain, so either one alone is a chat that cannot settle or check anything. `[id, part]`
 * pairs in the order module.js lists its parts.
 */
export const rulesParts = Object.freeze([['rules', part], ['progress', progressPart]]);
