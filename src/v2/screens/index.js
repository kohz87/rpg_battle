// RPG Battle v2, part **screens** (MODULES §A, SPEC §13): RPG Battle's default screens as data (§13.1
// screen definitions with §13.2 templates, scoped CSS and `data` query bindings), drawn by Story
// Block with its standard widgets (ss.meter, ss.portrait, ss.badge, ss.radar, ss.skill-tree,
// ss.stepper), and the view queries they bind (view.js). Packs and cards restyle or replace any of
// them by id (§13.7).
//
//   rpg-battle/party         tab, screen   a character card per member; spend points; skills; stats
//   rpg-battle/items         tab, screen   consumables (Use on…), equipment (Equip / Take off), Give
//   rpg-battle/trade         tab, screen   market line; Sell, Buy, Commission, On order
//   rpg-battle/hud           hud           your character's HP / MP, conditions, checks waiting
//   rpg-battle/status-card   card          under each reply: the party's HP / MP and what it changed
//
// `screens` is a key the MODULES §A part shape does not list yet: the coordinator's module.js passes
// it to registerModule({ screens }) as it is (SPEC §13.1). No domain, commands or kinds of its own;
// every button runs another part's command.

import { hudScreen } from './hud.js';
import { itemsScreen } from './items.js';
import { partyScreen } from './party.js';
import { statusCardScreen } from './status-card.js';
import { tradeScreen } from './trade.js';
import { viewQueries } from './view.js';

export const screens = Object.freeze([partyScreen, itemsScreen, tradeScreen, hudScreen, statusCardScreen]);

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
    screens,
};

export { hudScreen, itemsScreen, partyScreen, statusCardScreen, tradeScreen };
export { actorCard, cards, conditionBadge, hud, items, skillTree, trade, viewQueries } from './view.js';
export { BASE_CSS, THEME } from './style.js';
