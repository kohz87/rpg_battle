// RPG Battle v2, part `board`: the battle screen on SPEC §13's screen and widget layer.
//
// - widget `rpg-battle.battle-board` (MODULES §F9): the fight as the reader plays it, drawn from the
//   combat part's views and acting only through its commands (combat.act, combat.end);
// - query `combat.board`: the `combat.session` view with the costs, cooldowns, condition turns and
//   result the board shows;
// - screen `rpg-battle/fight` (tab and screen mounts): the board, the offers with Fight and Not now,
//   the last fight's summary.
//
// The part has no domain and no command of its own: it only reads, and every change goes through
// the combat part's commands.

import { battleBoard, WIDGET_NAME } from './widget.js';
import { boardView } from './query.js';
import { fightScreen } from './screen.js';

export { battleBoard, WIDGET_NAME, OUTCOME_TITLES, LOG_LINES } from './widget.js';
export { CONDITION_LABELS, boardView, resultOf } from './query.js';
export { fightScreen, FIGHT_SCREEN_ID } from './screen.js';
export { boardCss } from './styles.js';

export const part = {
    domains: {},
    commands: {},
    // Never throws to the reader (a fight that cannot be rebuilt reads as no fight).
    queries: { 'combat.board': (state, args, tools) => { try { return boardView(state, args, tools); } catch { return null; } } },
    kinds: {},
    hooks: {},
    tabs: [],
    widgets: { [WIDGET_NAME]: battleBoard },
    screens: [fightScreen],
};
