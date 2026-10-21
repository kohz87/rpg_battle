// Size limits and fixed word lists for packs (SPEC §9). One place, so the docs, the
// validator and the tests agree. Limits are generous for hand-made packs and small enough
// that a pack kept in settings.json (saved on every settings change) stays cheap.

export const LIMITS = Object.freeze({
    packBytes: 512 * 1024,          // one pack.json, as UTF-8
    installedBytes: 2 * 1024 * 1024, // every installed pack together
    installed: 32,                   // packs in the installed list
    depth: 16,                       // nesting of objects and arrays
    keys: 200,                       // keys in one object
    array: 1000,                     // entries in one array (records of one kind included)
    string: 4000,                    // characters in one string
    code: 64 * 1024,                 // characters in a screen's `template` or `css` (SPEC §13.3)
    name: 80,                        // a display name
    errors: 20,                      // problems reported for one pack before giving up
});

// Content kinds a pack may carry (SPEC §9). Each is a list of records.
// races and talents are choices for the character creation wizard (MODULES §F12).
export const CONTENT_KINDS = Object.freeze(['items', 'creatures', 'shops', 'recipes', 'events', 'quests', 'races', 'talents']);

// Top-level fields of pack.json; anything else is refused so a typo is not silently ignored.
export const PACK_FIELDS = Object.freeze(['id', 'version', 'name', 'author', 'description', 'requires', 'currency', 'content', 'start', 'layouts', 'screens', 'theme']);

// Item definitions follow Story Block's inventory def (SPEC §7).
export const ITEM_KINDS = Object.freeze(['goods', 'material', 'consumable', 'equipment', 'quest', 'money']);
export const RARITIES = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);
export const ITEM_FIELDS = Object.freeze(['name', 'slug', 'aliases', 'kind', 'rarity', 'value', 'stack', 'slot', 'stats', 'effect', 'tags', 'note']);
export const EVENT_FIELDS = Object.freeze(['id', 'when', 'cue', 'once', 'after', 'then']);
// The events part's own limits (src/v2/events), so a pack that passes here also runs there.
export const EVENT_LIMITS = Object.freeze({ when: 500, cue: 500, then: 8 });
export const CHOICE_FIELDS = Object.freeze(['id', 'name', 'note', 'stats', 'tags']);
export const START_FIELDS = Object.freeze(['scene', 'inventory']);
// Screens (SPEC §13.1) a pack adds or overrides by id.
export const SCREEN_FIELDS = Object.freeze(['id', 'title', 'icon', 'mounts', 'template', 'layout', 'css', 'theme', 'data', 'steps']);
export const MOUNTS = Object.freeze(['tab', 'screen', 'card', 'hud', 'dialog']);

// Slugs are lowercase words joined by single dashes, as Story Block's definition IDs need.
export const PACK_ID = /^(?=.{1,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-[0-9A-Za-z.-]{1,40})?(?:\+[0-9A-Za-z.-]{1,40})?$/;
// A command an event runs: `inventory.grant`, `wallet.receive`, `quest.take` …
export const COMMAND = /^[a-z][a-z0-9-]{0,39}(?:\.[a-z][A-Za-z0-9-]{0,39}){1,3}$/;
// A reference to a def outside the pack: `story/rope`, `pack.fantasy/iron-sword`.
export const DEF_ID = /^(?:story|pack\.[a-z0-9]+(?:-[a-z0-9]+)*)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A screen id: a module's (`rpg-battle/party`) to override, or the pack's own.
export const SCREEN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
