// RPG Battle v2, part **screens** (MODULES §A, SPEC §13): RPG Battle's default screens as data (§13.1
// screen definitions with §13.2 templates, scoped CSS and `data` query bindings), drawn by Story
// Block with its standard widgets (ss.meter, ss.portrait, ss.badge, ss.radar, ss.skill-tree,
// ss.stepper) and this part's own (widgets.js), and the view queries they bind (view.js). Packs and
// cards restyle or replace any of them by id (§13.7).
//
//   rpg-battle/party         tab, screen   a card per member: pools, effects, what they wear (condition,
//                                          refinement), companion switches, skills, stats, spend points,
//                                          your character file
//   rpg-battle/trade         tab, screen   market line; Sell, Buy, Commission, On order
//   rpg-battle/crafting      tab, screen   read-only: recipes per character, materials, chances
//                                          (feature `rpg-battle.crafting`)
//   rpg-battle/hud           hud           your character's HP / MP, points to spend, conditions, effects
//   rpg-battle/status-card   card          under each reply: the party's HP / MP and what it changed
//
// There is no Items screen: Story Block's Inventory is the one bag (MODULES §F99) and places the widget
// `rpg-battle.item-detail` in its rows for what only RPG Battle knows (slot and stats, condition,
// refinement, whom a draught would help).
//
// Screens and widgets a feature owns (MODULES §F100) carry `feature: <id>`; a host without the
// Features API ignores the key (an unknown screen field is not checked).
//
// `screens` is a key the MODULES §A part shape does not list yet: the coordinator's module.js passes
// it to registerModule({ screens }) as it is (SPEC §13.1). No domain, commands or kinds of its own;
// every button runs another part's command.

import { craftingScreen } from './crafting.js';
import { hudScreen } from './hud.js';
import { partyScreen } from './party.js';
import { statusCardScreen } from './status-card.js';
import { tradeScreen } from './trade.js';
import { viewQueries } from './view.js';
import { screenWidgets } from './widgets.js';

export const screens = Object.freeze([partyScreen, tradeScreen, craftingScreen, hudScreen, statusCardScreen]);

export const part = {
    domains: {},
    commands: {},
    queries: { ...viewQueries },
    kinds: {},
    context: { static: () => '', tail: () => ({ lines: [], optional: [] }), budget: 0 },
    hooks: {},
    settings: {
        section: 'Screens',
        defaults: { cardOnlyChanged: false },
        schema: { cardOnlyChanged: { type: 'bool', label: 'Cards under replies show only what that reply changed' } },
    },
    tabs: [],
    widgets: { ...screenWidgets },
    screens,
};

export { craftingScreen, hudScreen, partyScreen, statusCardScreen, tradeScreen };
export {
    BANDS, actorCard, cards, carry, carryText, conditionBadge, conditionView, crafting, effectBadge, hud, itemDetail, skillTree, trade, tryQuery, viewQueries,
} from './view.js';
export { CHARACTER_FILE_WIDGET, ITEM_DETAIL_WIDGET, characterFileWidget, itemDetailWidget, saveTextFile, screenWidgets } from './widgets.js';
export { BASE_CSS, CONTAINER_CSS, THEME } from './style.js';
