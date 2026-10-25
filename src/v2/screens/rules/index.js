// RPG Battle v2, screens for the rules-v2 views (track C): what the screens part adds to the module.
//
//   rulesScreens   progress, quests, roster, links, setup (screens.js), each shown only while RPG Battle's rules queries exist
//   rulesQueries   their view queries (`rpg-battle.progressView`, …): read the contract's queries, change nothing
//   rulesWidgets   permanent-choice, class-pick, command-input, command-button (widgets.js)
//
// RB_PHASE0 §10 track C: query projections and commands only. Nothing in this folder computes a rule.

import { progressView, offersView } from './progress.js';
import { questsView } from './quests.js';
import { rosterView } from './roster.js';
import { linksView } from './links.js';
import { depsBanner, setupView } from './setup.js';
import { classPickerView } from './class-step.js';

export { ask, ASK } from './ask.js';
export { dependencyView, hostModules, ownStatus } from './deps.js';
export { progressView } from './progress.js';
export { questsView } from './quests.js';
export { rosterView, slotTilesOf } from './roster.js';
export { linksView } from './links.js';
export { depsBanner, setupView } from './setup.js';
export { CLASS_STEP_TEMPLATE, classPickerView } from './class-step.js';
export {
    CLASS_PICK_WIDGET, COMMAND_BUTTON_WIDGET, COMMAND_INPUT_WIDGET, PERMANENT_CHOICE_WIDGET, RULES_WIDGET_CSS, rulesWidgets,
} from './widgets.js';
export { linksScreen, progressScreen, questsScreen, rosterScreen, rulesActive, rulesScreens, setupActive, setupScreen } from './screens.js';

export const rulesQueries = Object.freeze({
    'rpg-battle.progressView': progressView,
    'rpg-battle.offers': offersView,
    'rpg-battle.questsView': questsView,
    'rpg-battle.rosterView': rosterView,
    'rpg-battle.linksView': linksView,
    'rpg-battle.setupView': setupView,
    'rpg-battle.rulesDeps': depsBanner,
    'rpg-battle.classPicker': classPickerView,
});
