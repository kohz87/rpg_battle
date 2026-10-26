// Story Director v2, part **world** (the user's design, 2026-10-22): the World screen, what the player
// character knows, as a tab and a game-view screen with two views, Now and Journal (screen.js).
//
// * Feature `story-director.world` (on by default; MODULES §F100): the screen, the people widget, the
//   queries and the setting. Off, none of it is drawn or asked. Nothing is stored: every answer is worked
//   out on read from the state and the other parts' and modules' queries (known.js, journal.js), so a swipe,
//   a middle delete or a reload shows what a rebuild shows.
// * Queries: `director.world` (the Now view), `director.world.here` (the place and who is present, with
//   NPC State Delta's stance and dossier when it is there; NPC State Delta asks it to know who is here) and
//   `director.journal` (the Journal: each story day from the day digest, and today so far).
// * Setting `world.upcomingDays` (30): how many story days ahead Upcoming looks.
// * The Days screen is folded into the Journal; its id `story-director/days` stays as a dialog of the
//   Journal alone, for older layouts.
// Works with any set of modules (WAVE rule 11): without NPC State Delta the people are plain names, without
// a pack there are no holidays, without the story clock nothing has a date, without the day digest the
// Journal says it is off.

import { DEFAULT_UPCOMING_DAYS, FEATURE, MAX_UPCOMING_DAYS, hereView, worldView } from './known.js';
import { journalDay, journalView } from './journal.js';
import { PEOPLE_WIDGET, peopleWidget } from './people.js';
import { daysScreen, worldScreen } from './screen.js';

export { FEATURE };
export { WORLD_ID, DAYS_ID, worldScreen, daysScreen } from './screen.js';
export { PEOPLE_WIDGET, createPeopleWidget, peopleWidget } from './people.js';
export { hereView, hiddenNames, knownFactions, knownNews, knownUpcoming, holidays, worldView } from './known.js';
export { journalDay, journalView, knownDay } from './journal.js';

const tagged = fn => Object.assign(fn, { feature: FEATURE });

export const part = {
    features: [{
        id: FEATURE,
        label: 'World view',
        describe: 'The World screen: where you are and who is here, the news, events and factions you know, what you know is coming, and a journal of each story day. Only what your character knows.',
        default: true,
    }],
    domains: {},
    commands: {},
    queries: {
        'director.world': tagged((state, args, tools) => worldView(state, args, tools)),
        'director.world.here': tagged((state, args, tools) => hereView(state, args, tools)),
        'director.journal': tagged((state, args, tools) => journalView(state, args, tools)),
        // Not feature-tagged: other modules' recap works whether or not the World screen or the digest is on (contract P: journal.day).
        'journal.day': (state, args, tools) => journalDay(state, args, tools),
    },
    kinds: {},
    hooks: {},
    settings: {
        defaults: { upcomingDays: DEFAULT_UPCOMING_DAYS },
        schema: {
            upcomingDays: { type: 'int', label: 'World: Upcoming looks this many story days ahead', min: 1, max: MAX_UPCOMING_DAYS, feature: FEATURE },
        },
    },
    tabs: [],
    screens: [worldScreen, daysScreen],
    widgets: { [PEOPLE_WIDGET]: peopleWidget },
};
