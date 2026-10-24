// RPG Battle v2, part **rules** (contract §3, §4, §7): the `rules` domain that pins one resolved ruleset to the
// character timeline, `rules.progress` (the progression view), the lookups the screens read (`rules.identity`,
// `rules.classes`, `rules.names`, `rules.training`; ./queries.js) and `rules.settle` (the host's step that credits
// paid attempts; the training steps are later work). Not registered by module.js yet; see ../progress/index.js.

import { initialRules, rulesProblems } from './pin.js';
import { commands } from '../progress/commands.js';
import { queries } from '../progress/queries.js';
import { queries as lookups } from './queries.js';

export { RULES_VERSION, ENGINE, pinRules, pinOf, initialRules, rulesProblems, xpPerLevelProblem } from './pin.js';
export { indexOf, indexOfState } from './graph.js';

export const part = {
    domains: { rules: { initial: initialRules, validate: rulesProblems } },
    commands: { 'rules.settle': commands['rules.settle'] },
    queries: { 'rules.progress': queries['rules.progress'], ...lookups },
};
