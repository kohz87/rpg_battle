// RPG Battle v2, part **creation** (MODULES §F12, §F14; SPEC §13.6): making your character.
// Built-in races and talents (used for each kind no enabled pack provides), the packs'
// ready-made characters (the wizard's Start step, widget `rpg-battle.preset-pick`), the commands
// `creation.finish` (the wizard's whole draft, checked, then `party.create` in the same
// transaction), `creation.import` (a character file from `party.export` instead of the wizard,
// MODULES §F66: party.import checks and makes it, then its items, worn gear and purse are granted)
// and `creation.rollTalent` (a seeded random talent, through preview and commit),
// the queries the wizard reads, the small `creation` domain that keeps rolled talents, and the
// dialog wizard screen `rpg-battle/create`. The coordinator's src/v2/module.js merges this part
// with the others; it also passes `screens` to registerModule (SPEC §13.1).
//
// What the party part's `party.create` must accept (MODULES §B1 plus §F14, §F22):
//   party.create { name, points, background?, portrait?, origin?: { race: id | null, talents: [ids] } }
// `background` (the persona description, at most 2000 characters) is kept on the actor as text.
// With `origin` given, it asks `ctx.query('creation.build', { race, talents, points, settings })`
// for the checked result (refusing with its code and message when `ok` is false), builds the
// sheet with those final `stats` (HP/MP/SP from them, as v1 newSheet does from start + points),
// and keeps `origin` (the result's `origin`: { race: { id, name } | null, talents: [{ id, name }] })
// on the actor. Without `origin`, the stats are v1 newSheet's from the points (the no-content flow).
//
// Opening the wizard: openCreation(api) (open.js), from Story Block's canGenerate-blocked notice
// or this part's `onBlocked` hook, which uses the sdk on globalThis.StoryBlock when it has a dialog.

import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from './build.js';
import { commands, initialCreation, queries, validateCreation } from './commands.js';
import { openCreation } from './open.js';
import { createScreen } from './screen.js';
import { PRESET_WIDGET, presetPick } from './preset-pick.js';

/**
 * onBlocked(reason, moduleId) (Story Block's turn calls the blocking module's hook): when the
 * story was stopped because there is no character yet, open the wizard through the host sdk.
 */
export function onBlocked(reason, moduleId) {
    if (moduleId !== undefined && moduleId !== 'rpg-battle') return;
    const sdk = globalThis.StoryBlock?.sdk;
    if (!sdk) return;
    const party = (typeof sdk.view === 'function' ? sdk.view() : null)?.state?.domains?.party;
    if (party?.pc && party.actors?.[party.pc]) return;     // blocked for another reason
    openCreation(sdk);
}

export const part = {
    domains: {
        creation: { initial: initialCreation, validate: slice => validateCreation(slice) },
    },
    commands,
    queries,
    kinds: {},
    context: { static: () => '', tail: () => ({ lines: [], optional: [] }), budget: 0 },
    hooks: { onBlocked },
    settings: { section: 'Character creation', defaults: { ...SETTINGS_DEFAULTS }, schema: SETTINGS_SCHEMA },
    tabs: [],
    widgets: { [PRESET_WIDGET]: presetPick },
    screens: [createScreen],
};

export { BUILT_IN_RACES, BUILT_IN_TALENTS, STAT_LABELS, bonusText, creationContent, statChanges, talentCost } from './content.js';
export { buildCharacter, creationRules, SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from './build.js';
export { buildQuery, cleanPortrait, commands, contentQuery, initialCreation, queries, validateCreation } from './commands.js';
export { openCreation, startDraft } from './open.js';
export { BACKGROUND_LIMIT, avatarUrl, personaFor, readPersona } from './persona.js';
export { CREATE_SCREEN_ID, CREATE_STEPS, createScreen } from './screen.js';
export { PRESET_WIDGET, presetDraft, presetPick, renderPresetPick } from './preset-pick.js';
