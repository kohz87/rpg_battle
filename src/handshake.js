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
// The root of RPG Battle's panel under Extensions; Story Suite's overlay moves it into its tab.
export const SETTINGS_ROOT = '#rpg_battle_settings';
const STORY_BLOCK = 'story-block';

/** The reader's saved choices, one per shared area; anything unknown is 'auto'. */
export function truthChoices(saved) {
    const source = saved && typeof saved === 'object' ? saved : {};
    return Object.fromEntries(SHARED_AREAS.map(area => [area, TRUTH_CHOICES.includes(source[area]) ? source[area] : 'auto']));
}

/**
 * What RPG Battle announces to the suite (its api is the caller's: index.js reads the sheets).
 * Switched off it is still announced, with `enabled: false`, so Story Suite's overlay can show
 * it and switch it back on through api.manage; the registry skips it for owner, has and api.
 */
export function announcement({ version, api, enabled = true }) {
    return { id: SUITE_ID, name: SUITE_NAME, version: String(version ?? ''), owns: [...SHARED_AREAS], enabled: enabled !== false, settings: SETTINGS_ROOT, api };
}

/**
 * api.manage, for Story Suite's overlay (docs/STORY_SUITE.md): the Source of truth choices and
 * the on/off switch. The glue passes how to read and apply them (saving, the panel, the tab),
 * so the overlay changes them exactly as the panel's own controls do. setSource ignores an
 * area or a choice RPG Battle does not know and says whether it applied the change.
 */
export function manageApi({ choices, choose, enabled, enable, tokens = null }) {
    return Object.freeze({
        // (0.4) What RPG Battle itself adds to the next ordinary reply, estimated (tokenEstimate).
        tokens() {
            try {
                return tokens ? tokens() : tokenEstimate();
            } catch {
                return tokenEstimate();
            }
        },
        areas: [...SHARED_AREAS],
        sources: () => ({ ...truthChoices(choices()) }),
        setSource(area, choice) {
            if (!SHARED_AREAS.includes(area) || !TRUTH_CHOICES.includes(choice)) return false;
            choose(area, choice);
            return true;
        },
        enabled: () => enabled() !== false,
        setEnabled(on) { enable(Boolean(on)); },
    });
}

// About four characters a token: an estimate for the overlay, no tokenizer and no model call.
const CHARS_PER_TOKEN = 4;
// The hidden blocks the instruction asks for are written only when the story makes them true,
// mostly not at all: a small allowance per reply rather than their full size.
export const HIDDEN_BLOCKS_ALLOWANCE = 20;

/**
 * What RPG Battle injects into the next ordinary reply, estimated: { input, output, parts:
 * [{ label, input, output }] }. `handoff`: a fight result waiting to be narrated (sent instead of
 * the instruction, as the interceptor does); `instruction`: the story instruction, when it would
 * be sent. The kept Party block is not counted: Story Block counts it as its own. Never throws.
 */
export function tokenEstimate({ instruction = '', handoff = '' } = {}) {
    const count = text => Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);
    const parts = [];
    if (String(handoff ?? '').trim()) parts.push({ label: 'Fight hand-off (rpg_battle)', input: count(handoff), output: 0 });
    else if (String(instruction ?? '').trim()) parts.push({ label: 'Story instruction (rpg_battle_rules)', input: count(instruction), output: HIDDEN_BLOCKS_ALLOWANCE });
    return {
        input: parts.reduce((sum, part) => sum + part.input, 0),
        output: parts.reduce((sum, part) => sum + part.output, 0),
        parts,
    };
}

/**
 * Opens Story Suite's overlay on RPG Battle's tab, while it can be offered (two or more
 * extensions announced, on or off, and Story Block on and sharing openSuite), else null: what
 * the settings' "Manage all in Story Suite" link does, and whether it shows.
 */
export function suiteOverlay(suite) {
    if (!suite || suite.providers().length < 2) return null;
    const api = suite.api(STORY_BLOCK);
    return typeof api?.openSuite === 'function' ? () => api.openSuite(SUITE_ID) : null;
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
        sp: Object.freeze({ cur: whole(sheet.sp?.cur), max: whole(sheet.sp?.max) }),
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
