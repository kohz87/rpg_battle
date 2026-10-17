// RPG Battle's side of the Story Suite handshake (src/suite.js, docs/STORY_SUITE.md).
//
// With Story Block, Story Director or NPC State Delta beside it, RPG Battle announces the areas
// it can own (stats, rolls, and items as the fallback to Story Block's Inventory) and shares
// its party, so the others can read who is hurt without parsing the sheets themselves. The
// reader picks a source of truth per area in the settings; this module turns those choices and
// the suite's announcements into what RPG Battle shows. Pure: the suite is always passed in, so
// nothing here reads globalThis (index.js does, through storySuite()).

import { DEFAULT_RULES } from './rules.js';
import { isSourceOfTruth } from './suite.js';
import { stateWords } from './narrative.js';
import { levelText } from './terms.js';

export const SUITE_ID = 'rpg-battle';
export const SUITE_NAME = 'RPG Battle';
// The areas RPG Battle offers while it is on. 'items' is a fallback: Story Block's Inventory
// owns it first in the suite's order, and RPG Battle reads gear from it and writes loot into it.
export const SHARED_AREAS = Object.freeze(['stats', 'rolls', 'items']);
export const TRUTH_CHOICES = Object.freeze(['auto', 'mine', 'theirs']);
const STORY_BLOCK = 'story-block';

/** The reader's saved choices, one per shared area; anything unknown is 'auto'. */
export function truthChoices(saved) {
    const source = saved && typeof saved === 'object' ? saved : {};
    return Object.fromEntries(SHARED_AREAS.map(area => [area, TRUTH_CHOICES.includes(source[area]) ? source[area] : 'auto']));
}

/** What RPG Battle announces to the suite (its api is the caller's: index.js reads the sheets). */
export function announcement({ version, api }) {
    return { id: SUITE_ID, name: SUITE_NAME, version: String(version ?? ''), owns: [...SHARED_AREAS], api };
}

const whole = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

function memberCopy(id, name, role, sheet, rules) {
    return Object.freeze({
        id,
        name: String(name ?? sheet.name ?? ''),
        role,
        level: whole(sheet.level),
        levelLabel: levelText(whole(sheet.level), rules),
        hp: Object.freeze({ cur: whole(sheet.hp?.cur), max: whole(sheet.hp?.max) }),
        mp: Object.freeze({ cur: whole(sheet.mp?.cur), max: whole(sheet.mp?.max) }),
        state: stateWords(sheet, rules).text,
    });
}

/**
 * The party as api.members() gives it: the Character (id 'pc', role null) then each companion,
 * frozen copies of what the sheets say, so a reader elsewhere cannot change RPG Battle's
 * numbers by accident. [] when there is no sheet.
 */
export function partyMembers(pc, members = [], rules = DEFAULT_RULES) {
    const list = [];
    if (pc?.hp) list.push(memberCopy('pc', pc.name, null, pc, rules));
    for (const member of Array.isArray(members) ? members : []) {
        if (member?.sheet?.hp) list.push(memberCopy(String(member.id ?? ''), member.name, member.role ?? null, member.sheet, rules));
    }
    return Object.freeze(list);
}

/**
 * Whether to show the Character Sheet notice (two HP values will disagree). Story Block in the
 * suite says itself whether its Character Sheet is on, by offering 'stats'; the notice shows
 * while it does and RPG Battle is the source of truth for stats ("The other one" means the
 * reader keeps Story Block's sheet on purpose). An older Story Block that does not join the
 * suite falls back to `storySheetOn` (a boolean, or a function asked only then), as before.
 */
export function sheetNotice({ suite, choice = 'auto', storySheetOn = false }) {
    const joined = Boolean(suite) && suite.providers().some(provider => provider.id === STORY_BLOCK);
    if (!joined) return Boolean(typeof storySheetOn === 'function' ? storySheetOn() : storySheetOn);
    return suite.offering('stats').includes(STORY_BLOCK) && isSourceOfTruth(SUITE_ID, 'stats', choice, suite);
}

/** Who the story follows for each shared area now, for the settings: { [area]: { mine, name } }. */
export function sources(suite, choices) {
    const chosen = truthChoices(choices);
    const names = new Map(suite.providers().map(provider => [provider.id, provider.name || provider.id]));
    return Object.fromEntries(SHARED_AREAS.map(area => {
        const mine = isSourceOfTruth(SUITE_ID, area, chosen[area], suite);
        const other = chosen[area] === 'theirs' ? suite.offering(area).find(id => id !== SUITE_ID) : suite.owner(area);
        return [area, { mine, name: mine ? SUITE_NAME : names.get(other) ?? other }];
    }));
}

/** What the announcements say (not their apis), so a repeated identical announcement is no change. */
export function suiteSignature(suite) {
    return JSON.stringify(suite.providers()
        .map(provider => [provider.id, provider.enabled, [...provider.owns].sort()])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}
