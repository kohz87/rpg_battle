// Story Director v2, part **screens** (SPEC §13, MODULES §A): the module's default screens, as data
// Story Block renders: `story-director/quests` (tab, screen), `story-director/director` (tab, screen),
// `story-director/status-card` (card, under each reply, from that reply's state). The story time and place are
// in the Status fold, not a HUD strip (Story Block's HUD shows party data only). Cards and packs restyle or replace any of
// them by id (§13.7).
//
// The screens bind to the tracker's and quests' queries (`director.time`, `director.threads`,
// `quest.progress`, `quest.details`) and to four view queries this part adds (queries.js: `director.goal`,
// `director.next`, `quest.board`, `director.problems`), which work out what a template cannot
// (sorting, dates, each quest's status line and details, `{{user}}` in problem texts) from those same
// queries. No screen draws a command button (F95): quests follow the reader's words and the story. No commands, domains or change-line kinds of its own.
// Behind the scenes (agendas, beats, clocks, secrets) is hidden on the Director screen until the reader
// presses Reveal, per chat (reveal.js, widget `story-director.behind`; setting `hideBehind`, on). HIDE_SETTING
// is its namespaced key. The status card is
// on under every reply by default (`defaultOn: true`, MODULES §F24; the reader can turn it off).

import { directorScreen } from './director.js';
import { questsScreen } from './quests.js';
import { screenQueries } from './queries.js';
import { statusCardScreen } from './status-card.js';
import { BEHIND_WIDGET, behindWidget } from './behind.js';

export { DIRECTOR_ID, KIND_GROUPS } from './director.js';
export { QUESTS_ID } from './quests.js';
export { STATUS_CARD_ID } from './status-card.js';
export { BEHIND_WIDGET, behindWidget, createBehindWidget } from './behind.js';
export { BEHIND, BEHIND_KINDS, HIDE_SETTING, browserStore, createReveal, reveal } from './reveal.js';
export { calendarSetting, currentGoal, finishState, nextDue, problemsList, readerWords, screenQueries } from './queries.js';

export const MODULE_ID = 'story-director';

/** The default screens, in the order the tab bar shows them. */
export const screens = Object.freeze([questsScreen, directorScreen, statusCardScreen]);

// The module's settings (its calendar), read when a query runs; Story Block's sdk when it is there.
function hostSettings() {
    try {
        return globalThis.StoryBlock?.sdk?.settings?.(MODULE_ID) ?? null;
    } catch {
        return null;
    }
}

/**
 * The part. `settings` (a function or an object) gives the module's settings, for the calendar
 * `director.next` reads dates on; by default Story Block's `sdk.settings('story-director')`.
 */
export function createScreensPart({ settings = hostSettings } = {}) {
    return {
        domains: {},
        commands: {},
        queries: screenQueries({ settings }),
        kinds: {},
        hooks: {},
        tabs: [],
        screens: [...screens],
        widgets: { [BEHIND_WIDGET]: behindWidget },
        settings: {
            defaults: { hideBehind: true },
            schema: {
                // Per chat, Reveal shows them (remembered in this browser); this hides nothing from the story.
                hideBehind: { type: 'bool', label: 'Behind the scenes: Hide agendas, planned beats, clocks and secrets until you press Reveal' },
            },
        },
    };
}

export const part = createScreensPart();
